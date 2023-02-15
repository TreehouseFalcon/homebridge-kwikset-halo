import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { apiRequest } from './kwikset';

import { KwiksetHaloPlatform } from './platform';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class KwiksetHaloAccessory {
  private service: Service;

  /**
   * These are just used to create a working example
   * You should implement your own code to track the state of your accessory
   */
  private lockStates = {
    locked: this.platform.Characteristic.LockCurrentState.UNSECURED,
    isLocking: this.platform.Characteristic.LockTargetState.UNSECURED,
  };

  constructor(
    private readonly platform: KwiksetHaloPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    // set accessory information
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Kwikset')
      .setCharacteristic(
        this.platform.Characteristic.Model,
        this.accessory.context.device.modelnumber,
      )
      .setCharacteristic(this.platform.Characteristic.SerialNumber, 'Unknown');

    // get the LightBulb service if it exists, otherwise create a new LightBulb service
    // you can create multiple services for each accessory
    this.service =
      this.accessory.getService(this.platform.Service.LockMechanism) ||
      this.accessory.addService(this.platform.Service.LockMechanism);

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(
      this.platform.Characteristic.Name,
      accessory.context.device.devicename,
    );

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/Lightbulb
    this.service
      .getCharacteristic(this.platform.Characteristic.LockCurrentState)
      .onGet(this.getIsLocked.bind(this));

    this.service
      .getCharacteristic(this.platform.Characteristic.LockTargetState)
      .onGet(this.getShouldLock.bind(this))
      .onSet(this.setShouldLock.bind(this));

    /**
     * Creating multiple services of the same type.
     *
     * To avoid "Cannot add a Service with the same UUID another Service without also defining a unique 'subtype' property." error,
     * when creating multiple services of the same type, you need to use the following syntax to specify a name and subtype id:
     * this.accessory.getService('NAME') || this.accessory.addService(this.platform.Service.Lightbulb, 'NAME', 'USER_DEFINED_SUBTYPE_ID');
     *
     * The USER_DEFINED_SUBTYPE must be unique to the platform accessory (if you platform exposes multiple accessories, each accessory
     * can use the same sub type id.)
     */

    apiRequest(this.platform.log, {
      path: `prod_v1/devices_v2/${this.accessory.context.device.deviceid}`,
      method: 'GET',
    })
      .then((response) => response.json())
      .then((data: any) => data.data[0])
      .then((lock) => {
        let lockCurrentStatus;
        let lockTargetStatus;

        switch (lock.doorstatus) {
          case 'Locked':
            lockCurrentStatus = this.platform.Characteristic.LockCurrentState.SECURED;
            lockTargetStatus = this.platform.Characteristic.LockTargetState.SECURED;
            break;
          case 'Unlocked':
            lockCurrentStatus = this.platform.Characteristic.LockCurrentState.UNSECURED;
            lockTargetStatus = this.platform.Characteristic.LockTargetState.UNSECURED;
            break;
          case 'Jammed':
            lockCurrentStatus = this.platform.Characteristic.LockCurrentState.JAMMED;
            break;
          default:
            lockCurrentStatus = this.platform.Characteristic.LockCurrentState.UNKNOWN;
        }

        this.lockStates.locked = lockCurrentStatus;
        this.service.updateCharacteristic(
          this.platform.Characteristic.LockCurrentState,
          lockCurrentStatus,
        );

        if (lockTargetStatus) {
          this.lockStates.isLocking = lockTargetStatus;
          this.service.updateCharacteristic(
            this.platform.Characteristic.LockTargetState,
            lockTargetStatus,
          );
        }
      });
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, turning on a Light bulb.
   */
  async setShouldLock(value: CharacteristicValue) {
    // implement your own code to turn your device on/off
    this.lockStates.isLocking = value as any;

    let action;
    switch (value) {
      case this.platform.Characteristic.LockTargetState.SECURED:
        action = 'lock';
        break;
      case this.platform.Characteristic.LockTargetState.UNSECURED:
        action = 'unlock';
        break;
      default:
        this.platform.log.error(`Unrecognized characteristic value for setShouldLock: ${value}`);
    }

    apiRequest(this.platform.log, {
      path: `prod_v1/devices/${this.accessory.context.device.deviceid}/status`,
      method: 'PATCH',
      body: JSON.stringify({
        action,
        source: JSON.stringify({
          name: 'Homebridge',
          device: 'Homebridge',
        }),
      }),
    }).then(async (response) => {
      if (response.ok) {
        switch (value) {
          case this.platform.Characteristic.LockTargetState.SECURED:
            this.lockStates.locked = this.platform.Characteristic.LockCurrentState.SECURED;
            break;
          case this.platform.Characteristic.LockTargetState.UNSECURED:
            this.lockStates.locked = this.platform.Characteristic.LockCurrentState.UNSECURED;
            break;
          default:
            this.lockStates.locked = this.platform.Characteristic.LockCurrentState.UNKNOWN;
        }

        this.service.updateCharacteristic(
          this.platform.Characteristic.LockCurrentState,
          this.lockStates.locked,
        );
      }
    });
  }

  /**
   * Handle the "GET" requests from HomeKit
   * These are sent when HomeKit wants to know the current state of the accessory, for example, checking if a Light bulb is on.
   *
   * GET requests should return as fast as possible. A long delay here will result in
   * HomeKit being unresponsive and a bad user experience in general.
   *
   * If your device takes time to respond you should update the status of your device
   * asynchronously instead using the `updateCharacteristic` method instead.

   * @example
   * this.service.updateCharacteristic(this.platform.Characteristic.On, true)
   */
  async getIsLocked(): Promise<CharacteristicValue> {
    // implement your own code to check if the device is on
    const isLocked = this.lockStates.locked;

    // if you need to return an error to show the device as "Not Responding" in the Home app:
    // throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);

    apiRequest(this.platform.log, {
      path: `prod_v1/devices_v2/${this.accessory.context.device.deviceid}`,
      method: 'GET',
    })
      .then((response) => response.json())
      .then((data: any) => data.data[0])
      .then((lock) => {
        let lockStatus;

        switch (lock.doorstatus) {
          case 'Locked':
            lockStatus = this.platform.Characteristic.LockCurrentState.SECURED;
            break;
          case 'Unlocked':
            lockStatus = this.platform.Characteristic.LockCurrentState.UNSECURED;
            break;
          case 'Jammed':
            lockStatus = this.platform.Characteristic.LockCurrentState.JAMMED;
            break;
          default:
            lockStatus = this.platform.Characteristic.LockCurrentState.UNKNOWN;
        }

        this.service.updateCharacteristic(
          this.platform.Characteristic.LockCurrentState,
          lockStatus,
        );
        this.lockStates.locked = lockStatus;
      });

    return isLocked;
  }

  /**
   * Handle the "GET" requests from HomeKit
   * These are sent when HomeKit wants to know the current state of the accessory, for example, checking if a Light bulb is on.
   *
   * GET requests should return as fast as possible. A long delay here will result in
   * HomeKit being unresponsive and a bad user experience in general.
   *
   * If your device takes time to respond you should update the status of your device
   * asynchronously instead using the `updateCharacteristic` method instead.

   * @example
   * this.service.updateCharacteristic(this.platform.Characteristic.On, true)
   */
  async getShouldLock(): Promise<CharacteristicValue> {
    // implement your own code to check if the device is on
    const isLocking = this.lockStates.isLocking;

    // if you need to return an error to show the device as "Not Responding" in the Home app:
    // throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);

    return isLocking;
  }
}
