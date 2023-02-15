# Homebridge plugin for Kwikset Halo locks

This plugin allows you to integrate your Kwikset Halo locks with HomeKit.

## Installation

Make sure you have [Homebridge](https://github.com/homebridge/homebridge) installed and running first.
The recommended method to install is using the plugin catalog via the "Plugins" tab on the Homebridge control panel. Simply search for `homebridge-kwikset-halo` and install.

Alternatively, you may install the plugin via CLI:
`npm install -g homebridge-kwikset-halo`

## Config

```json
{
  "platforms": [
    {
      "platform": "homebridge-kwikset-halo",
      "email": "john.doe@fastmail.com",
      "password": "PASSWORD_HERE",
      "homeName": "Home Sweet Home",
      "mfaPort": 47279
    }
  ]
}
```

### Required config:

**`email`**: Email for your Kwikset Halo mobile app login

**`password`**: Password for your Kwikset Halo mobile app login

**`homeName`**: The name of your home (exactly as it appears) in your Kwikset mobile app

### Optional config:

**`mfaPort`**: Don't change this unless there's port overlap on your local network

## Known caveats:

- There is no officially supported API for Kwikset locks, so this can break without notice.
- Right now this plugin only supports the ability to lock and unlock your locks. LED status indicators are not implemented.
