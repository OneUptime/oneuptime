import NetworkEventAttribute from "../../../Types/NetworkEvent/NetworkEventAttribute";
import NetworkEventType from "../../../Types/NetworkEvent/NetworkEventType";
import {
  SyslogDeviceIdentity,
  SyslogParseContext,
  SyslogParserId,
  SyslogVendorExtraction,
  SyslogVendorParser,
} from "../SyslogVendorParser";

/*
 * Ubiquiti UniFi.
 *
 * UniFi Network exports its system log in CEF: the console or controller
 * sends one message per event for every access point, switch and gateway
 * it manages (Integration > System Logging / SIEM;
 * https://help.ui.com/hc/en-us/articles/33349041044119-UniFi-System-Logs-SIEM-Integration):
 *
 *   CEF:0|Ubiquiti|UniFi Network|9.3.33|401|WiFi Client Disconnected|2|UNIFIcategory=Monitoring UNIFIsubCategory=WiFi UNIFIhost=Office UDM Pro UNIFIlastConnectedToDeviceName=Lobby AP UNIFIlastConnectedToDeviceMac=d8:b3:70:fb:fc:dd ... msg=Apple Watch 0d:87 disconnected from Employee WiFi.
 *
 * The event is the CEF name. The device it is about is named in the
 * extension (UNIFIdeviceName / Mac / Ip, or the device a client connected
 * to), which is how an event the console sends lands on the access point
 * or switch it happened on, not on the console.
 *
 * A CEF message's fields are stored as `cef.<key>` by the CEF reader, for
 * every product alike; this parser adds none of its own.
 */

function firstValue(
  extensions: Record<string, string>,
  keys: Array<string>,
): string | undefined {
  for (const key of keys) {
    const value: string | undefined = extensions[key];

    if (value && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

/*
 * The UniFi device an event is about: the device itself, else the one a
 * client is (or was last) connected to.
 */
function readDevice(extensions: Record<string, string>): SyslogDeviceIdentity {
  const identity: SyslogDeviceIdentity = {
    macAddress: firstValue(extensions, [
      "UNIFIdeviceMac",
      "UNIFIconnectedToDeviceMac",
      "UNIFIlastConnectedToDeviceMac",
    ]),
    hostname: firstValue(extensions, [
      "UNIFIdeviceName",
      "UNIFIconnectedToDeviceName",
      "UNIFIlastConnectedToDeviceName",
    ]),
    ipAddress: firstValue(extensions, [
      "UNIFIdeviceIp",
      "UNIFIconnectedToDeviceIp",
      "UNIFIlastConnectedToDeviceIp",
    ]),
  };

  // The console is telling about one of its devices, not about itself.
  if (identity.macAddress || identity.hostname || identity.ipAddress) {
    identity.managedDevice = true;
  }

  return identity;
}

const ubiquitiUniFi: SyslogVendorParser = {
  id: SyslogParserId.UbiquitiUniFi,
  vendor: "Ubiquiti",
  product: "UniFi Network",
  format: "CEF",
  attributePrefix: "",
  vendorKeywords: ["ubiquiti", "unifi"],

  detect: (context: SyslogParseContext): boolean => {
    return (
      context.cef !== null &&
      context.cef.deviceVendor.toLowerCase() === "ubiquiti"
    );
  },

  extract: (context: SyslogParseContext): SyslogVendorExtraction => {
    if (!context.cef) {
      return { fields: {}, text: "" };
    }

    return {
      /*
       * The CEF name and the pairs the rules read, under the names the
       * rules know them by. They are not stored again: `cef.*` holds them.
       */
      fields: {
        name: context.cef.name,
        ...context.cef.extensions,
      },
      text: context.cef.extensions["msg"] || context.cef.name,
      identity: readDevice(context.cef.extensions),
    };
  },

  rules: [
    /*
     * The rules name events as Ubiquiti's article does. An event it does
     * not list is still stored, with every field, and a log pipeline can
     * give it a name.
     */

    // System > Devices.
    {
      event: NetworkEventType.DeviceOffline,
      when: { name: "Device Offline" },
    },

    // Internet > Outage & Failover.
    {
      event: NetworkEventType.WanFailover,
      when: { name: "WAN Failover" },
      set: {
        [NetworkEventAttribute.GatewayName]: [
          "@UNIFIfailoverWanName",
          "@UNIFIfailoverWanIsp",
        ],
      },
    },

    // System > Admin Activity.
    {
      event: NetworkEventType.AuthLoginSuccess,
      when: { name: "Admin Accessed UniFi Network" },
      set: {
        [NetworkEventAttribute.UserName]: ["@UNIFIadmin", "@suser"],
        [NetworkEventAttribute.ClientAddress]: "@src",
        [NetworkEventAttribute.ProtocolName]: "@UNIFIaccessMethod",
      },
    },
    {
      event: NetworkEventType.DeviceConfigChange,
      when: { name: "Admin Made Config Changes" },
      set: {
        [NetworkEventAttribute.UserName]: ["@UNIFIadmin", "@suser"],
        [NetworkEventAttribute.ClientAddress]: "@src",
      },
    },

    // Monitoring > WiFi.
    {
      event: NetworkEventType.WirelessClientConnected,
      when: { name: "WiFi Client Connected" },
      set: {
        [NetworkEventAttribute.ClientMac]: "@UNIFIclientMac",
        [NetworkEventAttribute.WifiSsid]: "@UNIFIwifiName",
      },
    },
    {
      event: NetworkEventType.WirelessClientDisconnected,
      when: { name: "WiFi Client Disconnected" },
      set: {
        [NetworkEventAttribute.ClientMac]: "@UNIFIclientMac",
        [NetworkEventAttribute.WifiSsid]: "@UNIFIwifiName",
      },
    },

    // Power > PoE.
    {
      event: NetworkEventType.PoeFault,
      when: {
        name: [
          "Insufficient PoE Output",
          "PoE Availability Exceeded",
          "AP Underpowered",
        ],
      },
      set: { [NetworkEventAttribute.InterfaceName]: "@UNIFIdevicePort" },
    },
  ],
};

export default ubiquitiUniFi;
