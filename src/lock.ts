import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { apiRequest } from './kwikset';

import { KwiksetHaloPlatform } from './platform';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class KwiksetHaloAccessory {
  public service: Service;
  public batteryservice: Service;
  private batterylevel;
  lowBatteryLevel = 40;

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
      .getCharacteristic(this.platform.Characteristic.LockTargetState)
      .onSet(this.setShouldLock.bind(this));

    // get the Battery service if it exists, otherwise create a new Battery service
    // you can create multiple services for each accessory
    this.batteryservice =
      this.accessory.getService(this.platform.Service.Battery) ||
      this.accessory.addService(this.platform.Service.Battery);

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
    this.pollLock();
    setInterval(() => {
      this.pollLock();
    }, 30000);
  }

  async pollLock() {
    apiRequest(this.platform.log, {
      path: `prod_v1/devices_v2/${this.accessory.context.device.deviceid}`,
      method: 'GET',
    })
      .then((response) => response.json())
      .then((data: any) => data.data[0])
      .then((lock) => {
        this.platform.log.debug(this.accessory.context.device.devicename, lock.doorstatus);
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
        if (lockStatus !== this.lockStates.locked) {
          // the lock has been manually operated, so we sync LockTargetState too.
          this.lockStates.isLocking = lockStatus;
          this.service.updateCharacteristic(
            this.platform.Characteristic.LockTargetState,
            lockStatus,
          );
        }
        this.lockStates.locked = lockStatus;

        this.batterylevel = lock.batterypercentage;
        this.batteryservice.updateCharacteristic(
          this.platform.Characteristic.BatteryLevel,
          this.batterylevel,
        );
        if (this.batterylevel <= this.lowBatteryLevel) {
          this.batteryservice.updateCharacteristic(
            this.platform.Characteristic.StatusLowBattery,
            this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW,
          );
        } else {
          this.batteryservice.updateCharacteristic(
            this.platform.Characteristic.StatusLowBattery,
            this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
          );
        }
        this.accessory
          .getService(this.platform.Service.AccessoryInformation)!
          .setCharacteristic(this.platform.Characteristic.SerialNumber, lock.serialnumber);
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
}
