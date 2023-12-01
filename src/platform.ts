import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
  UnknownContext,
} from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './const';
import { KwiksetHaloAccessory } from './lock';
import { apiRequest, fetchDevices, kwiksetLogin } from './kwikset';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class KwiksetHaloPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];

  public homeId = '';

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.debug('Finished initializing platform:', this.config.name);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      if (!this.config.email) {
        log.error('Invalid email');
        return;
      }
      if (!this.config.password) {
        log.error('Invalid password');
        return;
      }
      if (!this.config.homeName) {
        log.error('Invalid home name');
        return;
      }

      const mfaPort = Number(this.config.mfaPort);
      if (!mfaPort || 1024 > mfaPort || mfaPort > 65535) {
        log.error('Invalid MFA port (must be between 1024 and 65535)');
        return;
      }

      // run the method to discover / register your devices as accessories
      this.discoverDevices();
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.accessories.push(accessory);
  }

  /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  async discoverDevices() {
    this.log.debug('Discovering devices');
    await kwiksetLogin(this.config, this.log, this.api);

    const homes = await apiRequest(this.log, {
      path: 'prod_v1/users/me/homes?top=200',
      method: 'GET',
    })
      .then((response) => response.json())
      .then((data: any) => data.data);
    this.homeId = homes.find((home) => home.homename === this.config.homeName).homeid;

    const locks = await fetchDevices(this.log, this.homeId);

    for (const lock of locks) {
      const uuid = this.api.hap.uuid.generate(lock.deviceid);

      const existingAccessory = this.accessories.find((accessory) => accessory.UUID === uuid);

      if (existingAccessory) {
        existingAccessory.context.device = lock;
        this.api.updatePlatformAccessories([existingAccessory]);
        new KwiksetHaloAccessory(this, existingAccessory);
      } else {
        this.log.info(`Found new ${lock.modelnumber} device: ${lock.devicename}`);
        const accessory = new this.api.platformAccessory(lock.devicename, uuid);
        accessory.context.device = lock;
        new KwiksetHaloAccessory(this, accessory);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }

      if (lock.batterypercentage <= 10) {
        this.log.warn(
          `${lock.devicename} has a low battery (${lock.batterypercentage}% - "${lock.batterystatus}"). Consider replacing.`,
        );
      }
    }

    const staleAccessories: PlatformAccessory<UnknownContext>[] = [];
    this.accessories.forEach((lockAccessory) => {
      const foundLockFromApi = locks.some((cachedLock) => {
        return lockAccessory.context.device.deviceid === cachedLock.deviceid;
      });

      if (!foundLockFromApi) {
        this.log.warn(
          `Found stale accessory: ${lockAccessory.context.device.devicename} (${lockAccessory.context.device.deviceid})`,
        );
        staleAccessories.push(lockAccessory);
      }
    });
    if (staleAccessories.length > 0) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, staleAccessories);
    }
  }
}
