import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Source invariants for the "Connected to" card on the device Overview.
 *
 * The card is a .tsx App's compile cannot reach, and its behaviour is
 * rendered under Common/Tests/App/Dashboard/DeviceAttachmentCard.test.tsx.
 * What THIS pins is the wiring that a render test of the card alone cannot
 * see: that the Overview actually mounts it, that the MAC field the card
 * depends on is shown on the Overview and edited on the device's Settings
 * page (the one place a device's details are edited - the Overview links
 * there), and that the card links the switch to the device page every
 * other endpoint surface links it to. Each of those is a one-line deletion
 * that leaves every other suite green.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function readDashboardSource(...parts: Array<string>): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, ...parts), "utf8");
}

const OVERVIEW_CODE: string = readDashboardSource(
  "Pages",
  "NetworkDevice",
  "View",
  "Index.tsx",
);

const SETTINGS_CODE: string = readDashboardSource(
  "Pages",
  "NetworkDevice",
  "View",
  "Settings.tsx",
);

const CARD_CODE: string = readDashboardSource(
  "Components",
  "NetworkDevice",
  "DeviceAttachmentCard.tsx",
);

describe("the device Overview wires the Connected to card", () => {
  test("renders DeviceAttachmentCard for the viewed device", () => {
    // The mount, however the element is later wrapped or given more props.
    expect(OVERVIEW_CODE).toMatch(
      /<DeviceAttachmentCard\b[^>]*modelId=\{modelId\}/,
    );
    expect(OVERVIEW_CODE).toContain(
      'from "../../../Components/NetworkDevice/DeviceAttachmentCard"',
    );
  });

  test("the MAC Address field is edited on Settings, which the Overview links to", () => {
    /*
     * A device's details are edited in one place: the Device Settings card,
     * where the helper puts the MAC on the Address step beside the
     * hostname. The Overview's details card carries no form of its own,
     * only the link there.
     */
    expect(SETTINGS_CODE).toContain(
      'getMacAddressFormField({ stepId: "address" })',
    );
    expect(SETTINGS_CODE).toContain('from "../MacAddressFormField"');
    expect(OVERVIEW_CODE).not.toContain("getMacAddressFormField");
    expect(OVERVIEW_CODE).not.toContain("formFields=");
    expect(OVERVIEW_CODE).toMatch(
      /<EditInSettingsLink[\s\S]*PageMap\.NETWORK_DEVICE_VIEW_SETTINGS/,
    );
  });

  test("the read-only detail shows the MAC Address when there is one", () => {
    expect(OVERVIEW_CODE).toContain("macAddress: true");
    expect(OVERVIEW_CODE).toContain('title: "MAC Address"');
    expect(OVERVIEW_CODE).toMatch(/showIf:[^}]*item\??\.macAddress/);
  });
});

describe("the Connected to card", () => {
  test("links the switch to its device page", () => {
    expect(CARD_CODE).toContain("PageMap.NETWORK_DEVICE_VIEW]");
  });

  test("sends the operator to Settings from the empty state", () => {
    expect(CARD_CODE).toContain("PageMap.NETWORK_DEVICE_VIEW_SETTINGS]");
  });

  test.each([
    "device-attachment-card",
    "device-attachment-switch-link",
    "device-attachment-empty",
  ])("carries the %s test id the render test hangs on", (testId: string) => {
    expect(CARD_CODE).toContain(`data-testid="${testId}"`);
  });

  test("reads through the React-free lookup util rather than calling ModelAPI itself", () => {
    expect(CARD_CODE).toContain('from "./DeviceAttachmentLookupUtil"');
    expect(CARD_CODE).not.toContain("ModelAPI");
  });
});
