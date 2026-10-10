import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  NETWORK_QUICK_ACTION_ADDRESS_PARAM,
  NETWORK_QUICK_ACTION_PROBE_PARAM,
  NETWORK_QUICK_ACTION_QUERY_PARAM,
  NetworkQuickAction,
  isNetworkQuickActionInSearch,
  readAddDevicePrefill,
} from "../../FeatureSet/Dashboard/src/Components/Network/NetworkQuickActionQuery";

/*
 * "Add Device" and "Discover Devices" open their forms from anywhere that
 * offers them - the Overview's header and first-run choices, the Devices
 * list's empty state, the empty map - by carrying the action in the address
 * (?open=add-device) to the page whose form it is. These pin what a query
 * string has to say to open a form, and that nothing else does; the pages'
 * side (open once, then take the action out of the address) is rendered in
 * Common/Tests/App/Dashboard/NetworkQuickActionPages.test.tsx.
 */

describe("the quick actions", () => {
  test("are carried in one parameter", () => {
    expect(NETWORK_QUICK_ACTION_QUERY_PARAM).toBe("open");
  });

  test("are the two ways a device gets into Network", () => {
    expect(Object.values(NetworkQuickAction).sort()).toEqual([
      "add-device",
      "discover-devices",
    ]);
  });
});

describe("isNetworkQuickActionInSearch", () => {
  test.each([
    [NetworkQuickAction.AddDevice, "?open=add-device"],
    [NetworkQuickAction.DiscoverDevices, "?open=discover-devices"],
  ])(
    "%s is asked for by %s",
    (action: NetworkQuickAction, search: string): void => {
      expect(isNetworkQuickActionInSearch(action, search)).toBe(true);
    },
  );

  test("reads a query string without its leading question mark too", () => {
    expect(
      isNetworkQuickActionInSearch(
        NetworkQuickAction.AddDevice,
        "open=add-device",
      ),
    ).toBe(true);
  });

  test("finds the action among other parameters (a remembered filter, say)", () => {
    expect(
      isNetworkQuickActionInSearch(
        NetworkQuickAction.AddDevice,
        "?status=down&open=add-device&page=2",
      ),
    ).toBe(true);
  });

  test("one action never opens the other's form", () => {
    expect(
      isNetworkQuickActionInSearch(
        NetworkQuickAction.DiscoverDevices,
        "?open=add-device",
      ),
    ).toBe(false);
    expect(
      isNetworkQuickActionInSearch(
        NetworkQuickAction.AddDevice,
        "?open=discover-devices",
      ),
    ).toBe(false);
  });

  test.each([
    ["no query string", ""],
    ["null", null],
    ["undefined", undefined],
    ["a bare question mark", "?"],
    ["an empty value", "?open="],
    ["an unknown action", "?open=delete-everything"],
    ["a differently cased action", "?open=Add-Device"],
    ["the action under another parameter", "?add=add-device"],
    ["the action as a prefix", "?open=add-device-now"],
  ])(
    "%s opens nothing",
    (_label: string, search: string | null | undefined): void => {
      expect(
        isNetworkQuickActionInSearch(NetworkQuickAction.AddDevice, search),
      ).toBe(false);
    },
  );

  test("an encoded value is read decoded", () => {
    expect(
      isNetworkQuickActionInSearch(
        NetworkQuickAction.AddDevice,
        "?open=add%2Ddevice",
      ),
    ).toBe(true);
  });
});

/*
 * The Traffic page's "Add as device", for an address that sends flows but
 * is no device yet, opens Add Device with that address and the probe that
 * received the flows filled in. The address bar is untrusted: only an
 * address and a probe id are taken from it.
 */
describe("readAddDevicePrefill", () => {
  const PROBE_ID: string = "5d6f8e2a-1b3c-4d5e-8f70-9a1b2c3d4e5f";

  test("are carried in their own parameters", () => {
    expect(NETWORK_QUICK_ACTION_ADDRESS_PARAM).toBe("address");
    expect(NETWORK_QUICK_ACTION_PROBE_PARAM).toBe("probe");
  });

  test("reads the address and the probe beside the action", () => {
    expect(
      readAddDevicePrefill(
        `?open=add-device&address=10.9.9.9&probe=${PROBE_ID}`,
      ),
    ).toEqual({ address: "10.9.9.9", probeId: PROBE_ID });
  });

  test("an IPv6 address, or a hostname, is an address too", () => {
    expect(readAddDevicePrefill("?address=2001%3Adb8%3A%3A1")).toEqual({
      address: "2001:db8::1",
    });
    expect(readAddDevicePrefill("address=edge-01.example.com")).toEqual({
      address: "edge-01.example.com",
    });
  });

  test("a probe id is read in lower case, as ids are compared", () => {
    expect(readAddDevicePrefill(`?probe=${PROBE_ID.toUpperCase()}`)).toEqual({
      probeId: PROBE_ID,
    });
  });

  test.each([
    ["no query string", ""],
    ["null", null],
    ["undefined", undefined],
    ["markup in the address", "?address=%3Cimg%20src%3Dx%3E"],
    ["a path in the address", "?address=..%2F..%2Fetc"],
    ["spaces in the address", "?address=10.0.0.1%20OR%201%3D1"],
    ["an address too long to be one", `?address=${"a".repeat(254)}`],
    ["a probe that is not an id", "?probe=probe-1"],
    ["a probe id with more after it", `?probe=${PROBE_ID}x`],
  ])(
    "%s fills in nothing",
    (_label: string, search: string | null | undefined): void => {
      expect(readAddDevicePrefill(search)).toEqual({});
    },
  );
});

/*
 * The link half and the page half have to agree on the parameter and the
 * values: the links are built in NetworkQuickActions.ts, the pages read with
 * isNetworkQuickActionRequested, and both come from the module above.
 */
describe("the wiring", () => {
  const DASHBOARD_SRC: string = path.join(
    __dirname,
    "..",
    "..",
    "FeatureSet",
    "Dashboard",
    "src",
  );

  function readCode(...parts: Array<string>): string {
    return fs
      .readFileSync(path.join(DASHBOARD_SRC, ...parts), "utf8")
      .replace(/\s+/g, " ");
  }

  test("each action's link lands on the page whose form it opens", () => {
    const actions: string = readCode(
      "Components",
      "Network",
      "NetworkQuickActions.ts",
    );

    expect(actions).toContain(
      "[NetworkQuickAction.AddDevice]: PageMap.NETWORK_DEVICES,",
    );
    expect(actions).toContain(
      "[NetworkQuickAction.DiscoverDevices]: PageMap.NETWORK_DEVICE_DISCOVERY,",
    );
  });

  test("Add Device's link carries the address and probe, and only Add Device's", () => {
    const actions: string = readCode(
      "Components",
      "Network",
      "NetworkQuickActions.ts",
    );

    expect(actions).toContain(
      "if (action === NetworkQuickAction.AddDevice && prefill?.address) { params[NETWORK_QUICK_ACTION_ADDRESS_PARAM] = prefill.address; }",
    );
    expect(actions).toContain(
      "if (action === NetworkQuickAction.AddDevice && prefill?.probeId) { params[NETWORK_QUICK_ACTION_PROBE_PARAM] = prefill.probeId; }",
    );
    // Clearing the action clears what it filled in too.
    expect(actions).toContain(
      "[NETWORK_QUICK_ACTION_QUERY_PARAM]: null, [NETWORK_QUICK_ACTION_ADDRESS_PARAM]: null, [NETWORK_QUICK_ACTION_PROBE_PARAM]: null,",
    );
  });

  test("the Devices page fills the hostname, and the probe only when the form offers it", () => {
    const page: string = readCode("Pages", "NetworkDevice", "Devices.tsx");

    expect(page).toContain(
      "return isAddDeviceRequested ? getRequestedAddDevicePrefill() : {};",
    );
    expect(page).toContain("hostname: addDevicePrefill.address,");
    expect(page).toContain(
      "probeOptions.some((option: { value: string }): boolean => { return option.value === addDevicePrefill.probeId; })",
    );
    expect(page).toContain("createInitialValues={addDeviceInitialValues}");
  });

  test.each([
    [["Pages", "NetworkDevice", "Devices.tsx"], "AddDevice"],
    [["Pages", "NetworkDevice", "Discovery.tsx"], "DiscoverDevices"],
  ])(
    "%j opens its form for %s, once, and clears the address",
    (parts: Array<string>, action: string): void => {
      const page: string = readCode(...parts);

      expect(page).toContain(
        `isNetworkQuickActionRequested(NetworkQuickAction.${action})`,
      );
      expect(page).toContain("clearNetworkQuickAction();");
      expect(page).toMatch(/showCreateForm=\{is[A-Za-z]+Requested\}/);
    },
  );
});
