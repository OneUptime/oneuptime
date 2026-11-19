import URL from "../../../Types/API/URL";
import BadDataException from "../../../Types/Exception/BadDataException";
import MonitorType from "../../../Types/Monitor/MonitorType";
import DeviceUrlTarget, {
  DEFAULT_PORT_BY_SCHEME,
  DEVICE_ADDRESS_NOT_A_URL_HOST,
  DeviceUrlParts,
  URL_TEMPLATE_HOST_IS_VARIABLE,
  URL_TEMPLATE_NEEDS_HOST,
  URL_TEMPLATE_NEEDS_URL,
  URL_TEMPLATE_NEEDS_WEB_SCHEME,
  URL_TEMPLATE_PORT_NOT_A_NUMBER,
} from "../../../Utils/Monitor/DeviceUrlTarget";
import { describe, expect, it } from "@jest/globals";

/*
 * A WEB TEMPLATE'S URL, ON EACH DEVICE (OneUptime issue #9546).
 *
 * The template's URL with the device's address as its host, and every other
 * character as the template wrote it. Only the host is replaced - never by a
 * parser that re-encodes the rest - so a {{monitorSecrets.*}} in a password,
 * a path or a query reaches the probe exactly as written. A URL with no host,
 * a host written as a variable, a port that is not a number or a scheme with
 * no host to put an address in is refused, with what to change.
 */

function expectBadData(run: () => unknown, message: string): void {
  expect(run).toThrow(BadDataException);
  expect(run).toThrow(message);
}

describe("DeviceUrlTarget.readParts", () => {
  it("cuts a URL at its host, and the parts put back together are the URL", () => {
    const urls: Array<string> = [
      "https://device:8443/status?verbose=1#top",
      "http://admin:{{monitorSecrets.pw}}@printer/hp/device/",
      "https://[2001:db8::1]:8443/",
      "https://camera",
      "HTTPS://Device.Example.NET/Path",
    ];

    for (const url of urls) {
      const parts: DeviceUrlParts = DeviceUrlTarget.readParts(url)!;

      expect(
        `${parts.scheme}://${parts.userInfo}${parts.host}${parts.port}${parts.rest}`.toLowerCase(),
      ).toBe(url.toLowerCase());
    }
  });

  it("names each part", () => {
    expect(
      DeviceUrlTarget.readParts(
        "https://admin:{{monitorSecrets.pw}}@ups:8443/api?x=1",
      ),
    ).toEqual({
      scheme: "https",
      userInfo: "admin:{{monitorSecrets.pw}}@",
      host: "ups",
      port: ":8443",
      rest: "/api?x=1",
    });
    expect(DeviceUrlTarget.readParts("https://[2001:db8::1]:8443/")).toEqual({
      scheme: "https",
      userInfo: "",
      host: "[2001:db8::1]",
      port: ":8443",
      rest: "/",
    });
  });

  it("reads a URL object as it writes itself, and nothing from what is no URL", () => {
    expect(
      DeviceUrlTarget.readParts(URL.fromString("https://device:8443/x"))?.port,
    ).toBe(":8443");
    expect(DeviceUrlTarget.readParts("device/status")).toBeNull();
    expect(DeviceUrlTarget.readParts("")).toBeNull();
    expect(DeviceUrlTarget.readParts(null)).toBeNull();
    expect(DeviceUrlTarget.readParts(undefined)).toBeNull();
  });
});

describe("DeviceUrlTarget.assertTemplateUrl", () => {
  it("accepts an http or https URL with a host a device's address can take", () => {
    for (const url of [
      "https://device/",
      "http://device:8080/status",
      "https://printer.example.com/hp?x=1",
      "https://admin:{{monitorSecrets.pw}}@ups/",
      "https://[2001:db8::1]/",
    ]) {
      expect(() => {
        DeviceUrlTarget.assertTemplateUrl(url);
      }).not.toThrow();
    }
  });

  it("refuses each URL that has no host to replace, saying what to change", () => {
    const cases: Array<[string | null | undefined, string]> = [
      [undefined, URL_TEMPLATE_NEEDS_URL],
      ["  ", URL_TEMPLATE_NEEDS_URL],
      ["ws://device/socket", URL_TEMPLATE_NEEDS_WEB_SCHEME],
      ["device/status", URL_TEMPLATE_NEEDS_WEB_SCHEME],
      ["https://{{monitorSecrets.host}}/", URL_TEMPLATE_HOST_IS_VARIABLE],
      ["https://{{monitorSecrets.host}}:8443/", URL_TEMPLATE_HOST_IS_VARIABLE],
      ["https:///status", URL_TEMPLATE_NEEDS_HOST],
      ["https://user@/status", URL_TEMPLATE_NEEDS_HOST],
      ["https://device:https/", URL_TEMPLATE_PORT_NOT_A_NUMBER],
      [
        "https://device:{{monitorSecrets.port}}/",
        URL_TEMPLATE_PORT_NOT_A_NUMBER,
      ],
    ];

    for (const [url, message] of cases) {
      expectBadData(() => {
        DeviceUrlTarget.assertTemplateUrl(url);
      }, message);
    }
  });
});

describe("DeviceUrlTarget.toUrlHost", () => {
  it("writes an IPv6 address in brackets, anything else as it is, without a typed port", () => {
    expect(DeviceUrlTarget.toUrlHost("10.0.0.5")).toBe("10.0.0.5");
    expect(DeviceUrlTarget.toUrlHost("2001:db8::1")).toBe("[2001:db8::1]");
    expect(DeviceUrlTarget.toUrlHost("[2001:db8::1]")).toBe("[2001:db8::1]");
    expect(DeviceUrlTarget.toUrlHost("core-sw-01.example.net")).toBe(
      "core-sw-01.example.net",
    );
    expect(DeviceUrlTarget.toUrlHost(" 10.0.0.5:8080 ")).toBe("10.0.0.5");
  });

  it("refuses no address, and an address that cannot be a host", () => {
    expectBadData(() => {
      DeviceUrlTarget.toUrlHost("");
    }, "This device has no address, so a monitor cannot check it.");
    expectBadData(() => {
      DeviceUrlTarget.toUrlHost("not a host");
    }, DEVICE_ADDRESS_NOT_A_URL_HOST);
  });
});

describe("DeviceUrlTarget.buildDeviceUrl", () => {
  it("replaces only the host, and keeps every other character as the template wrote it", () => {
    const cases: Array<[string, string, string]> = [
      [
        "https://device:8443/status",
        "10.0.0.5",
        "https://10.0.0.5:8443/status",
      ],
      ["http://printer/hp/device/", "10.20.0.7", "http://10.20.0.7/hp/device/"],
      ["https://ups/", "2001:db8::1", "https://[2001:db8::1]/"],
      [
        "https://device/api?token={{monitorSecrets.Token}}&a=1",
        "10.0.0.5",
        "https://10.0.0.5/api?token={{monitorSecrets.Token}}&a=1",
      ],
      [
        "https://admin:{{monitorSecrets.pw}}@ups:8443/",
        "ups-01.example.net",
        "https://admin:{{monitorSecrets.pw}}@ups-01.example.net:8443/",
      ],
      ["HTTPS://Device/Status", "10.0.0.5", "https://10.0.0.5/Status"],
    ];

    for (const [templateUrl, address, expected] of cases) {
      const built: URL = DeviceUrlTarget.buildDeviceUrl({
        templateUrl: templateUrl,
        address: address,
      });

      expect(built).toBeInstanceOf(URL);
      expect(built.toString()).toBe(expected);
    }
  });

  it("refuses a template URL it cannot put an address in before it reads the device", () => {
    expectBadData(() => {
      DeviceUrlTarget.buildDeviceUrl({
        templateUrl: "https://{{monitorSecrets.host}}/",
        address: "",
      });
    }, URL_TEMPLATE_HOST_IS_VARIABLE);
  });
});

describe("DeviceUrlTarget.readHost and readPort", () => {
  it("the host a URL is on, without brackets; empty for none or a variable", () => {
    expect(DeviceUrlTarget.readHost("https://10.0.0.5:8443/x")).toBe(
      "10.0.0.5",
    );
    expect(DeviceUrlTarget.readHost("https://[2001:db8::1]/")).toBe(
      "2001:db8::1",
    );
    expect(DeviceUrlTarget.readHost("https://user:pw@host.example/")).toBe(
      "host.example",
    );
    expect(DeviceUrlTarget.readHost("https://{{monitorSecrets.h}}/")).toBe("");
    expect(DeviceUrlTarget.readHost("not a url")).toBe("");
  });

  it("the port a URL names, else its scheme's", () => {
    expect(DeviceUrlTarget.readPort("https://device:8443/")).toBe(8443);
    expect(DeviceUrlTarget.readPort("https://device/")).toBe(
      DEFAULT_PORT_BY_SCHEME["https"],
    );
    expect(DeviceUrlTarget.readPort("http://device/")).toBe(80);
    expect(DeviceUrlTarget.readPort("ws://device/")).toBeNull();
    expect(DeviceUrlTarget.readPort("https://device:http/")).toBeNull();
    expect(DeviceUrlTarget.readPort(undefined)).toBeNull();
  });
});

describe("DeviceUrlTarget.getCheckKey", () => {
  it("a Website or API monitor checks a scheme, a port and a path with its query - never the host", () => {
    for (const monitorType of [MonitorType.Website, MonitorType.API]) {
      const key: (url: string) => string | null = (
        url: string,
      ): string | null => {
        return DeviceUrlTarget.getCheckKey({
          monitorType: monitorType,
          url: url,
        });
      };

      // The host is the device's either way.
      expect(key("https://10.0.0.5/status")).toBe(
        key("https://printer-01.example.net/status"),
      );
      // A port named or the scheme's: the same server.
      expect(key("https://10.0.0.5:443/status")).toBe(
        key("https://10.0.0.5/status"),
      );
      expect(key("https://10.0.0.5")).toBe(key("https://10.0.0.5/"));
      // The fragment never reaches the server.
      expect(key("https://10.0.0.5/status#top")).toBe(
        key("https://10.0.0.5/status"),
      );

      expect(key("https://10.0.0.5/status")).toBe("https:443/status");
      expect(key("http://10.0.0.5/status")).not.toBe(
        key("https://10.0.0.5/status"),
      );
      expect(key("https://10.0.0.5:8443/status")).not.toBe(
        key("https://10.0.0.5/status"),
      );
      expect(key("https://10.0.0.5/other")).not.toBe(
        key("https://10.0.0.5/status"),
      );
      expect(key("https://10.0.0.5/status?a=1")).not.toBe(
        key("https://10.0.0.5/status?a=2"),
      );
    }
  });

  it("an SSL Certificate monitor checks the certificate on a port, whatever the path", () => {
    const key: (url: string) => string | null = (
      url: string,
    ): string | null => {
      return DeviceUrlTarget.getCheckKey({
        monitorType: MonitorType.SSLCertificate,
        url: url,
      });
    };

    expect(key("https://10.0.0.5/")).toBe("tls:443");
    expect(key("https://10.0.0.5/admin")).toBe(key("https://10.0.0.5/"));
    expect(key("https://10.0.0.5:8443/")).toBe("tls:8443");
  });

  it("nothing to read is no key", () => {
    expect(
      DeviceUrlTarget.getCheckKey({
        monitorType: MonitorType.Website,
        url: undefined,
      }),
    ).toBeNull();
    expect(
      DeviceUrlTarget.getCheckKey({
        monitorType: MonitorType.Website,
        url: "ws://device/",
      }),
    ).toBeNull();
  });
});

describe("DeviceUrlTarget.describeTemplateUrl", () => {
  it("shows the template's URL with the words for a device where the host is", () => {
    expect(
      DeviceUrlTarget.describeTemplateUrl({
        templateUrl: "https://printer:8443/status?x=1",
        deviceHost: "<device>",
      }),
    ).toBe("https://<device>:8443/status?x=1");
  });

  it("leaves off a path of / alone, which says nothing", () => {
    expect(
      DeviceUrlTarget.describeTemplateUrl({
        templateUrl: "https://camera/",
        deviceHost: "<device>",
      }),
    ).toBe("https://<device>");
  });

  it("is null for a URL a device's address cannot be put in", () => {
    expect(
      DeviceUrlTarget.describeTemplateUrl({
        templateUrl: "https://{{monitorSecrets.host}}/",
        deviceHost: "<device>",
      }),
    ).toBeNull();
    expect(
      DeviceUrlTarget.describeTemplateUrl({
        templateUrl: "",
        deviceHost: "<device>",
      }),
    ).toBeNull();
  });
});
