import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  NETWORK_QUICK_ACTION_QUERY_PARAM,
  NetworkQuickAction,
  isNetworkQuickActionInSearch,
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
