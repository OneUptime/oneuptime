import {
  MAX_NETWORK_EVENT_MESSAGE_LENGTH,
  MAX_NETWORK_EVENT_SUBJECT_LENGTH,
} from "../../../Types/NetworkEvent/NetworkEventAttribute";
import { MAX_KEY_VALUE_PAIRS } from "../../../Utils/Log/KeyValueParser";
import { MAX_CEF_EXTENSIONS } from "../../../Utils/Syslog/CefParser";
import SyslogEventNormalizer, {
  CEF_ATTRIBUTE_PREFIX,
  NormalizedSyslogMessage,
  ReadSyslogLine,
} from "../../../Utils/Syslog/SyslogEventNormalizer";
import { SyslogParserId } from "../../../Utils/Syslog/SyslogVendorParser";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { describe, expect, it } from "@jest/globals";

/*
 * What the normalizer makes of a syslog message, beyond which parser reads
 * it (SyslogVendorParsers.test.ts covers that, line by line): what goes
 * into the log's attributes and under which names, what never does, who
 * the message says it is from, and that no text - however long, however
 * broken - makes it fail or grow without bound.
 */

function read(line: string, deviceVendor?: string): NormalizedSyslogMessage {
  const result: ReadSyslogLine | null = SyslogEventNormalizer.readLine(
    line,
    deviceVendor ? { deviceVendor: deviceVendor } : undefined,
  );

  if (!result) {
    throw new Error(`Expected ${JSON.stringify(line)} to be read`);
  }

  return result.normalized;
}

const SOPHOS_LINE: string =
  'device_name="SFW" timestamp="2024-05-02T11:03:12+0200" device_model="XGS2100" device_serial_id="X21000ABCD12345" log_id="063211617802" log_type="Event" log_component="IPSec" log_subtype="System" severity="Information" con_name="HQ-Branch1" src_ip="10.171.4.117" dst_ip="10.171.4.118" status="Terminated" message="IPSec Connection HQ-Branch1 terminated."';

describe("a line no parser knows", () => {
  it("adds nothing at all", () => {
    const normalized: NormalizedSyslogMessage = read(
      "<34>Oct 11 22:14:15 mymachine su: 'su root' failed for lonvick on /dev/pts/8",
    );

    expect(normalized).toEqual({
      parserId: null,
      vendor: null,
      eventName: null,
      ruleIndex: null,
      attributes: {},
      identity: {},
      headerHostname: "mymachine",
    });
  });

  it("names nobody when the line has no host name either", () => {
    const normalized: NormalizedSyslogMessage = read("<13>disk almost full");

    expect(normalized.identity).toEqual({});
    expect(Object.keys(normalized)).not.toContain("headerHostname");
  });

  it("is nothing for an empty line", () => {
    expect(SyslogEventNormalizer.readLine("")).toBeNull();
    expect(SyslogEventNormalizer.readLine("   ")).toBeNull();
  });
});

describe("the attributes of a recognised line", () => {
  it("stores the vendor's fields under its prefix, and the parser and vendor beside them", () => {
    const attributes: Record<string, string> = read(SOPHOS_LINE).attributes;

    expect(attributes["syslog.parser"]).toBe("sophos-firewall");
    expect(attributes["syslog.vendor"]).toBe("Sophos");
    expect(attributes["sophos.con_name"]).toBe("HQ-Branch1");
    expect(attributes["sophos.log_component"]).toBe("IPSec");

    // Every key is the vendor's, the event's or syslog's: nothing unprefixed.
    for (const key of Object.keys(attributes)) {
      expect({
        key,
        namespaced:
          key.startsWith("sophos.") ||
          key.startsWith("syslog.") ||
          key.startsWith("event.") ||
          [
            "vpn.tunnel.name",
            "network.peer.address",
            "network.protocol.name",
          ].includes(key),
      }).toEqual({ key, namespaced: true });
    }
  });

  it("stores exactly the names a Key=Value Parser with the prefix sophos gives them", () => {
    /*
     * What OneUptime's docs told Sophos customers to set up before this
     * parser existed: their searches and monitors read these keys.
     */
    const attributes: Record<string, string> = read(SOPHOS_LINE).attributes;

    for (const key of [
      "device_name",
      "timestamp",
      "device_model",
      "device_serial_id",
      "log_id",
      "log_type",
      "log_component",
      "log_subtype",
      "severity",
      "con_name",
      "src_ip",
      "dst_ip",
      "status",
      "message",
    ]) {
      expect(Object.keys(attributes)).toContain(`sophos.${key}`);
    }
  });

  it("stores an event under event.domain, event.name and the device's own words", () => {
    const attributes: Record<string, string> = read(SOPHOS_LINE).attributes;

    expect(attributes["event.domain"]).toBe("network");
    expect(attributes["event.name"]).toBe("vpn.tunnel_down");
    expect(attributes["event.message"]).toBe(
      "IPSec Connection HQ-Branch1 terminated.",
    );
  });

  it("stores no event keys on a line that is not an event", () => {
    const attributes: Record<string, string> = read(
      'log_type="Firewall" log_component="Firewall Rule" log_subtype="Allowed" src_ip="10.1.1.20"',
    ).attributes;

    expect(attributes["syslog.parser"]).toBe("sophos-firewall");
    expect(
      Object.keys(attributes).filter((key: string): boolean => {
        return key.startsWith("event.");
      }),
    ).toEqual([]);
  });

  it("every value is text", () => {
    for (const value of Object.values(read(SOPHOS_LINE).attributes)) {
      expect(typeof value).toBe("string");
    }
  });

  it("cuts the device's words to the event message's limit", () => {
    const words: string = "x".repeat(MAX_NETWORK_EVENT_MESSAGE_LENGTH + 500);
    const attributes: Record<string, string> = read(
      `<187>%LINK-3-UPDOWN: Interface Gi0/1, changed state to down ${words}`,
    ).attributes;

    expect(attributes["event.name"]).toBe("interface.down");
    expect(attributes["event.message"]).toHaveLength(
      MAX_NETWORK_EVENT_MESSAGE_LENGTH,
    );
  });

  it("cuts what an event is about to the subject's limit", () => {
    const name: string = "t".repeat(MAX_NETWORK_EVENT_SUBJECT_LENGTH + 100);
    const attributes: Record<string, string> = read(
      `log_type="Event" log_component="IPSec" log_subtype="System" status="Terminated" con_name="${name}"`,
    ).attributes;

    expect(attributes["vpn.tunnel.name"]).toHaveLength(
      MAX_NETWORK_EVENT_SUBJECT_LENGTH,
    );
    // The vendor's own field keeps the whole value.
    expect(attributes["sophos.con_name"]).toBe(name);
  });

  it("leaves out a subject the message does not name", () => {
    const attributes: Record<string, string> = read(
      'log_type="Event" log_component="IPSec" log_subtype="System" status="Terminated"',
    ).attributes;

    expect(attributes["event.name"]).toBe("vpn.tunnel_down");
    expect(Object.keys(attributes)).not.toContain("vpn.tunnel.name");
    expect(Object.keys(attributes)).not.toContain("network.peer.address");
    // A fixed value needs no field.
    expect(attributes["network.protocol.name"]).toBe("ipsec");
  });

  it("takes the first source that has a value: the newer field name, then the older", () => {
    expect(
      read(
        'log_type="Event" log_component="IPSec" log_subtype="System" status="Terminated" con_name="new" connectionname="old"',
      ).attributes["vpn.tunnel.name"],
    ).toBe("new");
    expect(
      read(
        'log_type="Event" log_component="IPSec" log_subtype="System" status="Terminated" con_name="" connectionname="old"',
      ).attributes["vpn.tunnel.name"],
    ).toBe("old");
  });
});

describe("a CEF line", () => {
  const UNIFI: string =
    "CEF:0|Ubiquiti|UniFi Network|9.3.33|544|Admin Accessed UniFi Network|1|UNIFIhost=Office UDM Pro UNIFIadmin=Craig src=105.5.138.59 msg=Craig accessed UniFi Network.";

  it("stores the header and the extension under cef.", () => {
    const attributes: Record<string, string> = read(UNIFI).attributes;

    expect(CEF_ATTRIBUTE_PREFIX).toBe("cef");
    expect(attributes).toMatchObject({
      "cef.vendor": "Ubiquiti",
      "cef.product": "UniFi Network",
      "cef.device_version": "9.3.33",
      "cef.event_class_id": "544",
      "cef.name": "Admin Accessed UniFi Network",
      "cef.severity": "1",
      "cef.UNIFIhost": "Office UDM Pro",
      "cef.UNIFIadmin": "Craig",
      "cef.src": "105.5.138.59",
      "cef.msg": "Craig accessed UniFi Network.",
    });
  });

  it("is named for the product's own parser when it has one", () => {
    const normalized: NormalizedSyslogMessage = read(UNIFI);

    expect(normalized.parserId).toBe(SyslogParserId.UbiquitiUniFi);
    expect(normalized.attributes["syslog.parser"]).toBe("ubiquiti-unifi");
    expect(normalized.attributes["syslog.vendor"]).toBe("Ubiquiti");
  });

  it("is named cef, and for the vendor its header gives, when it has none", () => {
    const normalized: NormalizedSyslogMessage = read(
      "CEF:0|Example Corp|Controller|2.0|77|Port Flapping|5|msg=Port 3 is flapping",
    );

    expect(normalized.parserId).toBe(SyslogParserId.Cef);
    expect(normalized.vendor).toBe("Example Corp");
    expect(normalized.attributes["syslog.parser"]).toBe("cef");
    expect(normalized.attributes["syslog.vendor"]).toBe("Example Corp");
    expect(normalized.eventName).toBeNull();
  });

  it("an extension pair cannot replace a header field of the same name", () => {
    const attributes: Record<string, string> = read(
      "CEF:0|Real Vendor|Product|1.0|7|Real Name|5|vendor=forged name=forged severity=0 src=10.0.0.1",
    ).attributes;

    expect(attributes["cef.vendor"]).toBe("Real Vendor");
    expect(attributes["cef.name"]).toBe("Real Name");
    expect(attributes["cef.severity"]).toBe("5");
    expect(attributes["cef.src"]).toBe("10.0.0.1");
    expect(attributes["syslog.vendor"]).toBe("Real Vendor");
  });

  it("leaves out a header field the message leaves empty", () => {
    const attributes: Record<string, string> = read(
      "CEF:0|Vendor||||Name|5|src=10.0.0.1",
    ).attributes;

    expect(Object.keys(attributes)).not.toContain("cef.product");
    expect(Object.keys(attributes)).not.toContain("cef.device_version");
    expect(Object.keys(attributes)).not.toContain("cef.event_class_id");
    expect(attributes["cef.name"]).toBe("Name");
  });

  it("gives the syslog severity the CEF one stands for", () => {
    expect(read("CEF:0|V|P|1|1|N|10|").severity).toBe(2);
    expect(read("CEF:0|V|P|1|1|N|Low|").severity).toBe(6);
    expect(read("CEF:0|V|P|1|1|N|whatever|").severity).toBeUndefined();
  });
});

describe("who a message says it is from", () => {
  /*
   * Two different things, kept apart: what the message's own fields say
   * (identity), and the host name of the syslog header (headerHostname) -
   * the sender's word for itself, which a relay or a factory default can
   * make anything.
   */
  it("a line that names nobody in its fields has an empty identity, and its header's host name", () => {
    const normalized: NormalizedSyslogMessage = read(
      "<189>Oct 13 10:11:12 core-sw1 46: %LINK-3-UPDOWN: Interface Gi0/1, changed state to down",
    );

    expect(normalized.identity).toEqual({});
    expect(normalized.headerHostname).toBe("core-sw1");
  });

  it("keeps the message's own host name apart from the header's", () => {
    // A relay's name in the header, the firewall's in the message.
    const normalized: NormalizedSyslogMessage = read(
      '<189>Oct 13 10:11:12 relay-1 date=2024-01-01 time=10:00:00 devname="FG100-HQ" devid="FG100E4Q17000001" logid="0100032009" type="event" subtype="system" msg="FortiGate started"',
    );

    expect(normalized.identity).toEqual({
      hostname: "FG100-HQ",
      serialNumber: "FG100E4Q17000001",
    });
    expect(normalized.headerHostname).toBe("relay-1");
  });

  it("reads a serial number the message gives, beside the header's host name", () => {
    const normalized: NormalizedSyslogMessage = read(
      `<30>May  2 11:03:12 fw-hq ${SOPHOS_LINE}`,
    );

    expect(normalized.identity).toEqual({ serialNumber: "X21000ABCD12345" });
    expect(normalized.headerHostname).toBe("fw-hq");
  });

  it("trims the header's host name, and leaves a blank one out", () => {
    expect(
      SyslogEventNormalizer.normalize({ message: "text", hostname: "  sw-1 " })
        .headerHostname,
    ).toBe("sw-1");
    expect(
      Object.keys(
        SyslogEventNormalizer.normalize({ message: "text", hostname: "   " }),
      ),
    ).not.toContain("headerHostname");
  });

  it("leaves out a header host name that is the vendor's mnemonic, not a host", () => {
    // Cambium writes "timestamp mnemonic text": no host name in the line.
    const normalized: NormalizedSyslogMessage = read(
      "<14>May 23 21:15:20 WIFI-6-CLIENT-CONNECTED Client [00-24-D7-AB-FB-3C] connected to wireless lan [camb]",
    );

    expect(normalized.parserId).toBe(SyslogParserId.CambiumEnterpriseWifi);
    expect(normalized.identity).toEqual({});
    expect(Object.keys(normalized)).not.toContain("headerHostname");
  });

  it("reads a CEF message's own keys for the device", () => {
    expect(
      read(
        "<134>Oct 13 10:11:12 collector CEF:0|Example|Controller|2.0|77|Port Flapping|5|dvchost=sw-floor-2 dvc=10.20.0.7 dvcmac=00:0A:95:9D:68:16 deviceExternalId=SN12345",
      ).identity,
    ).toEqual({
      hostname: "sw-floor-2",
      ipAddress: "10.20.0.7",
      macAddress: "00:0A:95:9D:68:16",
      serialNumber: "SN12345",
    });
  });

  it("a UniFi event names the device it is about, not the console that sent it", () => {
    expect(
      read(
        "<14>Oct 13 10:12:12 udm-pro CEF:0|Ubiquiti|UniFi Network|9.3.33|3|Device Offline|5|UNIFIhost=Office UDM Pro UNIFIdeviceName=Warehouse Switch UNIFIdeviceIp=192.168.100.9 UNIFIdeviceMac=f4:e2:c6:aa:bb:cc",
      ).identity,
    ).toEqual({
      hostname: "Warehouse Switch",
      ipAddress: "192.168.100.9",
      macAddress: "f4:e2:c6:aa:bb:cc",
      // The console speaks for a device it manages.
      managedDevice: true,
    });
  });

  it("a UniFi event about nothing but the console names nobody", () => {
    const normalized: NormalizedSyslogMessage = read(
      "<14>Oct 13 10:12:12 udm-pro CEF:0|Ubiquiti|UniFi Network|9.3.33|544|Admin Accessed UniFi Network|1|UNIFIhost=Office UDM Pro UNIFIadmin=Craig",
    );

    expect(normalized.identity).toEqual({});
    expect(normalized.headerHostname).toBe("udm-pro");
  });

  it("a device's own CEF fields do not make it a managed device", () => {
    expect(
      read(
        "Oct  2 17:36:35 MikroTik CEF:0|MikroTik|hAP ax^2|7.25beta5|10|system,info|Low|dvchost=MikroTik dvc=192.168.88.36 msg=router rebooted",
      ).identity,
    ).toEqual({ hostname: "MikroTik", ipAddress: "192.168.88.36" });
  });

  it("drops blank identity values", () => {
    expect(
      read(
        'date=2024-01-01 time=10:00:00 devname="" devid="  " logid="0100032009" type="event" subtype="system" msg="FortiGate started"',
      ).identity,
    ).toEqual({});
  });
});

describe("what the normalizer is given", () => {
  it("reads the content when it is given, and the message otherwise", () => {
    // The tag is part of AOS-Switch's format: the content has it, the message does not.
    expect(
      SyslogEventNormalizer.normalize({
        message: "ports: port 3 is now off-line",
        content: "00077 ports: port 3 is now off-line",
      }).eventName,
    ).toBe("interface.down");
    expect(
      SyslogEventNormalizer.normalize({
        message: "00077 ports: port 3 is now off-line",
      }).eventName,
    ).toBe("interface.down");
    expect(
      SyslogEventNormalizer.normalize({
        message: "ports: port 3 is now off-line",
      }).eventName,
    ).toBeNull();
  });

  it("reads the program an RFC 5424 header names", () => {
    expect(
      SyslogEventNormalizer.normalize({
        message: "Failed password for root from 192.0.2.10 port 51234 ssh2",
        appName: "sshd",
      }).eventName,
    ).toBe("auth.login_failed");
    expect(
      SyslogEventNormalizer.normalize({
        message: "Failed password for root from 192.0.2.10 port 51234 ssh2",
        appName: "nginx",
      }).eventName,
    ).toBeNull();
  });

  it("answers with nothing, and does not throw, for input that is not text", () => {
    for (const message of [undefined, null, 12, {}, [], true]) {
      expect(
        SyslogEventNormalizer.normalize({
          message: message as unknown as string,
        }),
      ).toEqual({
        parserId: null,
        vendor: null,
        eventName: null,
        ruleIndex: null,
        attributes: {},
        identity: {},
      });
    }

    // Nor for no input at all.
    for (const input of [undefined, null]) {
      expect(
        SyslogEventNormalizer.normalize(
          input as unknown as { message: string },
        ),
      ).toEqual({
        parserId: null,
        vendor: null,
        eventName: null,
        ruleIndex: null,
        attributes: {},
        identity: {},
      });
    }
  });

  it("an empty device vendor is no vendor", () => {
    const line: string =
      "<27>Oct  2 17:36:35 MikroTik login failure for user guest from 192.168.88.17 via ssh";

    for (const deviceVendor of ["", null, undefined]) {
      expect(
        SyslogEventNormalizer.readLine(line, { deviceVendor })?.normalized
          .parserId,
      ).toBeNull();
    }
  });
});

describe("bounds", () => {
  it("never adds more attributes than the readers allow pairs", () => {
    const pairs: Array<string> = [];

    for (let index: number = 0; index < 500; index++) {
      pairs.push(`k${index}="v${index}"`);
    }

    const sophos: Record<string, string> = read(
      `log_type="Event" log_component="X" log_subtype="Y" ${pairs.join(" ")}`,
    ).attributes;

    // The pairs, the message id it may add, the parser and the vendor.
    expect(Object.keys(sophos).length).toBeLessThanOrEqual(
      MAX_KEY_VALUE_PAIRS + 3,
    );

    const cef: Record<string, string> = read(
      `CEF:0|V|P|1|1|N|5|${pairs.join(" ").replace(/"/g, "")}`,
    ).attributes;

    // The extension pairs, the six header fields, the parser and the vendor.
    expect(Object.keys(cef).length).toBeLessThanOrEqual(MAX_CEF_EXTENSIONS + 8);
  });

  it("reads only the start of a very long line", () => {
    const late: string = `${"x ".repeat(40_000)} %LINK-3-UPDOWN: Interface Gi0/1, changed state to down`;

    expect(read(`<187>${late}`).parserId).toBeNull();
    expect(
      read(
        `<187>%LINK-3-UPDOWN: Interface Gi0/1, changed state to down ${"x ".repeat(40_000)}`,
      ).eventName,
    ).toBe("interface.down");
  });

  it("never writes a key that could reach an object's prototype", () => {
    for (const line of [
      'log_type="Event" log_component="X" __proto__="polluted" constructor="c" toString="t"',
      "CEF:0|V|P|1|1|N|5|__proto__=polluted constructor=c toString=t",
    ]) {
      const attributes: Record<string, string> = read(line).attributes;

      expect(Object.getPrototypeOf(attributes)).toBe(Object.prototype);
      expect(
        Object.keys(attributes).filter((key: string): boolean => {
          return key === "__proto__" || !key.includes(".");
        }),
      ).toEqual([]);
    }

    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });
});

/*
 * Pieces every parser looks for, glued together at random: a line that is
 * half Cisco and half CEF, pairs that never close, marks with nothing
 * after them. The normalizer must make something bounded of each, and
 * never throw.
 */
const PIECES: Array<string> = [
  "CEF:0|",
  "CEF:",
  "|",
  "\\|",
  "\\",
  "=",
  '"',
  "'",
  " ",
  "\n",
  "\t",
  "%LINK-3-UPDOWN: ",
  "%ASA-1-104001: ",
  "%",
  "Interface ",
  "Gi0/1",
  ", changed state to down",
  "<Info> ",
  "<Info:vlan.msgs.portLinkStateDown> ",
  "<",
  ">",
  "Port 1:12 link down",
  "Event|403|LOG_INFO|AMM|1/1|",
  "Link status for interface 1/1/49 is up",
  "00077 ports: ",
  "port 3 is now off-line",
  "system,info ",
  "interface,info ",
  "ether1 link down",
  "login failure for user ",
  " from 10.0.0.1 via ssh",
  "WIFI-6-CLIENT-CONNECTED ",
  "Client [00-24-D7-AB-FB-3C] connected to wireless lan [camb]",
  "kernel: ",
  "sshd[1]: ",
  "hostapd: ",
  "log_type=",
  "log_component=",
  "log_subtype=",
  'status="Terminated" ',
  'message="',
  "logid=",
  '"0101037138" ',
  "type=",
  "subtype=",
  "action=tunnel-down ",
  "Ubiquiti|UniFi Network|9.3.33|3|Device Offline|5|",
  "MikroTik|hAP|7.18|10|system,error,critical|High|",
  "UNIFIdeviceMac=f4:e2:c6:aa:bb:cc ",
  "msg=",
  "dvchost=",
  "__proto__=",
  "[",
  "]",
  "(",
  ")",
  "CP1 [03/18/70 09:55:35.890] 0x0000c5e7 00300001.238 DYNAMIC SET GlobalRouter HW INFO ",
  "Link Down(1/47)",
  "é",
  "\u{1F600}",
  "\u0000",
];

describe("any text at all", () => {
  it("is read without failing, into bounded attributes with text values and safe keys", () => {
    const texts: Array<string> = generatedTexts(20000, 4728, PIECES);
    let recognised: number = 0;
    let events: number = 0;

    for (const text of texts) {
      const normalized: NormalizedSyslogMessage =
        SyslogEventNormalizer.normalize({ message: text });
      const keys: Array<string> = Object.keys(normalized.attributes);

      if (normalized.parserId) {
        recognised++;
      }

      if (normalized.eventName) {
        events++;
        expect(normalized.attributes["event.name"]).toBe(normalized.eventName);
        expect(normalized.attributes["event.domain"]).toBe("network");
      }

      expect(keys.length).toBeLessThanOrEqual(
        MAX_KEY_VALUE_PAIRS + MAX_CEF_EXTENSIONS + 32,
      );
      expect(Object.getPrototypeOf(normalized.attributes)).toBe(
        Object.prototype,
      );

      for (const key of keys) {
        if (
          typeof normalized.attributes[key] !== "string" ||
          key === "__proto__" ||
          !key.includes(".")
        ) {
          throw new Error(
            `${JSON.stringify(text)} gave the attribute ${JSON.stringify(key)}`,
          );
        }
      }

      // A parser and its vendor are stored exactly when they are known.
      expect(normalized.attributes["syslog.parser"]).toBe(
        normalized.parserId === null ? undefined : normalized.parserId,
      );
    }

    // The pieces do make recognisable lines: the sweep is not all noise.
    expect(recognised).toBeGreaterThan(2000);
    expect(events).toBeGreaterThan(100);
  });

  it("reads the same text the same way twice: no parser keeps state", () => {
    const texts: Array<string> = generatedTexts(3000, 1728, PIECES);
    const first: Array<string> = texts.map((text: string): string => {
      return JSON.stringify(SyslogEventNormalizer.normalize({ message: text }));
    });
    const second: Array<string> = texts.map((text: string): string => {
      return JSON.stringify(SyslogEventNormalizer.normalize({ message: text }));
    });

    expect(second).toEqual(first);
  });

  it("is read without failing as a whole syslog line too", () => {
    for (const text of generatedTexts(5000, 3164, [
      ...PIECES,
      "<134>",
      "<13>1 ",
      "Oct 13 10:11:12 ",
      "2026-10-13T10:11:12Z ",
      "host-1 ",
      "- ",
    ])) {
      expect((): void => {
        SyslogEventNormalizer.readLine(text);
      }).not.toThrow();
    }
  });
});
