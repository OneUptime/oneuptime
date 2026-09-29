import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Source invariants for the "Connected to" card on the device Overview.
 *
 * The card is a .tsx App's compile cannot reach, and its behaviour is
 * rendered under Common/Tests/App/Dashboard/DeviceAttachmentCard.test.tsx.
 * What THIS pins is the wiring that a render test of the card alone cannot
 * see: that the Overview actually mounts it, that the Overview's edit form
 * and read-only detail both carry the MAC field the card depends on, and
 * that the card links the switch to the device page every other endpoint
 * surface links it to. Each of those is a one-line deletion that leaves
 * every other suite green.
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

  test("the edit form carries the shared MAC Address field", () => {
    /*
     * The helper, not a hand-rolled field: the Overview's form has no
     * steps, so the bare call.
     */
    expect(OVERVIEW_CODE).toContain("getMacAddressFormField()");
    expect(OVERVIEW_CODE).toContain('from "../MacAddressFormField"');
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
