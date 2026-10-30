import URL from "../../../Types/API/URL";
import DeviceWebUiUtil, {
  DEVICE_MONITOR_CHECK_QUERY_PARAM,
  DeviceMonitorCheck,
} from "../../../Utils/NetworkDevice/DeviceWebUiUtil";
import { describe, expect, test } from "@jest/globals";

/*
 * "Monitor web UI" on a network device's Monitors card (#5281, the
 * follow-up of #5145's device web UI templates): Create Monitor opens on a
 * Website monitor of the device's management page - https on the address
 * its probe polls - and the device's Monitors card finds that monitor again
 * by what it is, a Website monitor named after the device with a step on
 * its address.
 */

describe("the link Create Monitor reads", () => {
  test("names the check in a query parameter of its own", () => {
    expect(DEVICE_MONITOR_CHECK_QUERY_PARAM).toBe("check");
    expect(DeviceMonitorCheck.WebUi).toBe("web-ui");
  });
});

describe("DeviceWebUiUtil.getHost: the host part of a device's address", () => {
  test.each([
    ["10.20.0.1", "10.20.0.1"],
    ["  10.20.0.1  ", "10.20.0.1"],
    ["core-sw-01.example.net", "core-sw-01.example.net"],
    // A port typed after it is not the web UI's.
    ["10.20.0.1:161", "10.20.0.1"],
    ["core-sw-01:8443", "core-sw-01"],
    // IPv6, bare or in brackets, with or without a port.
    ["2001:db8::1", "2001:db8::1"],
    ["fe80::1", "fe80::1"],
    ["[2001:db8::1]", "2001:db8::1"],
    ["[2001:db8::1]:8443", "2001:db8::1"],
    // Nothing to go on.
    ["", ""],
    ["   ", ""],
    ["[]", ""],
  ])("%p is on %p", (address: string, host: string) => {
    expect(DeviceWebUiUtil.getHost(address)).toBe(host);
  });

  test("no address is no host", () => {
    expect(DeviceWebUiUtil.getHost(undefined)).toBe("");
  });
});

describe("DeviceWebUiUtil.getUrl: https on the device's own address", () => {
  test.each([
    ["10.20.0.1", "https://10.20.0.1/"],
    ["core-sw-01.example.net", "https://core-sw-01.example.net/"],
    ["10.20.0.1:161", "https://10.20.0.1/"],
    ["2001:db8::1", "https://[2001:db8::1]/"],
    ["[2001:db8::1]:8443", "https://[2001:db8::1]/"],
  ])("%p's web UI is at %p", (address: string, url: string) => {
    const webUi: URL | null = DeviceWebUiUtil.getUrl(address);

    expect(webUi).not.toBeNull();
    expect(webUi!.toString()).toBe(url);
    // A URL the Website monitor's step takes as it is.
    expect(URL.fromString(webUi!.toString()).toString()).toBe(url);
  });

  test.each([[""], ["   "], ["not a host!"], ["exa mple.com"], [undefined]])(
    "an address no URL can carry (%p) has no web UI address",
    (address: string | undefined) => {
      expect(DeviceWebUiUtil.getUrl(address)).toBeNull();
    },
  );
});

describe("DeviceWebUiUtil.getUrlHost and isOnAddress", () => {
  test("a URL's host, lower-cased, without brackets or port", () => {
    expect(DeviceWebUiUtil.getUrlHost("https://Core-SW-01.example.net:8443/x")).toBe(
      "core-sw-01.example.net",
    );
    expect(DeviceWebUiUtil.getUrlHost("http://[2001:DB8::1]:8080/")).toBe(
      "2001:db8::1",
    );
    expect(DeviceWebUiUtil.getUrlHost(URL.fromString("https://10.20.0.1/"))).toBe(
      "10.20.0.1",
    );
    expect(DeviceWebUiUtil.getUrlHost("not a url")).toBe("");
    expect(DeviceWebUiUtil.getUrlHost("")).toBe("");
    expect(DeviceWebUiUtil.getUrlHost(null)).toBe("");
  });

  test.each([
    // Any scheme, port or path on the device's address.
    ["https://10.20.0.1/", "10.20.0.1", true],
    ["http://10.20.0.1:8080/login", "10.20.0.1", true],
    ["https://CORE-SW-01.example.net/", "core-sw-01.example.net", true],
    ["https://[2001:db8::1]/", "2001:db8::1", true],
    // One IPv6 address written two ways.
    ["https://[2001:db8:0::1]/", "2001:DB8::1", true],
    ["https://10.20.0.1/", "10.20.0.1:161", true],
    // Another address, or a name that merely contains it.
    ["https://10.20.0.10/", "10.20.0.1", false],
    ["https://10.20.0.1.example.net/", "10.20.0.1", false],
    ["https://shop.example.net/core-sw-01", "core-sw-01", false],
    // Nothing to compare.
    ["", "10.20.0.1", false],
    ["https://10.20.0.1/", "", false],
  ])(
    "%p is on %p: %p",
    (url: string, address: string, expected: boolean) => {
      expect(
        DeviceWebUiUtil.isOnAddress({ url: url, address: address }),
      ).toBe(expected);
    },
  );
});

describe("DeviceWebUiUtil.isWebUiMonitorOf: the monitor the device's Monitors card lists", () => {
  const device: { deviceName: string; deviceAddress: string } = {
    deviceName: "core-sw-01",
    deviceAddress: "10.20.0.1",
  };

  test("a Website monitor named after the device, with a step on its address", () => {
    for (const monitorName of [
      "core-sw-01 web UI",
      // As German, Japanese and Persian name it.
      "Weboberfläche von core-sw-01",
      "core-sw-01 の Web UI",
      "رابط وب core-sw-01",
      // A person's own name for it, still naming the device.
      "CORE-SW-01 management page",
    ]) {
      expect(
        DeviceWebUiUtil.isWebUiMonitorOf({
          ...device,
          monitorName: monitorName,
          destinations: ["https://10.20.0.1/"],
        }),
      ).toBe(true);
    }
  });

  test("any of its steps may be on the address", () => {
    expect(
      DeviceWebUiUtil.isWebUiMonitorOf({
        ...device,
        monitorName: "core-sw-01 web UI",
        destinations: [undefined, "https://shop.example.net/", "http://10.20.0.1:8080/"],
      }),
    ).toBe(true);
  });

  test("not one named after another device, nor one on another address", () => {
    expect(
      DeviceWebUiUtil.isWebUiMonitorOf({
        ...device,
        monitorName: "edge-fw-02 web UI",
        destinations: ["https://10.20.0.1/"],
      }),
    ).toBe(false);
    expect(
      DeviceWebUiUtil.isWebUiMonitorOf({
        ...device,
        monitorName: "core-sw-01 web UI",
        destinations: ["https://10.20.0.2/"],
      }),
    ).toBe(false);
    expect(
      DeviceWebUiUtil.isWebUiMonitorOf({
        ...device,
        monitorName: "core-sw-01 web UI",
        destinations: [],
      }),
    ).toBe(false);
  });

  test("a device with no name or no address has no web UI monitor to find", () => {
    for (const unknown of [
      { deviceName: "", deviceAddress: "10.20.0.1" },
      { deviceName: "  ", deviceAddress: "10.20.0.1" },
      { deviceName: "core-sw-01", deviceAddress: "" },
      { deviceName: undefined, deviceAddress: undefined },
    ]) {
      expect(
        DeviceWebUiUtil.isWebUiMonitorOf({
          ...unknown,
          monitorName: "core-sw-01 web UI",
          destinations: ["https://10.20.0.1/"],
        }),
      ).toBe(false);
    }
  });
});
