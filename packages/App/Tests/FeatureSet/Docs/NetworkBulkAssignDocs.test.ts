import {
  APPLY_VENDOR_TEMPLATE_ACTION_TITLE,
  CLEAR_DEVICE_ROLE_ACTION_TITLE,
  CLEAR_SITE_ACTION_TITLE,
  IMPORT_VENDOR_TEMPLATES_TOGGLE_TITLE,
  SET_DEVICE_ROLE_ACTION_TITLE,
  SET_SITE_ACTION_TITLE,
} from "../../../FeatureSet/Dashboard/src/Components/NetworkDevice/BulkDeviceActionTitles";
import { MATCH_EACH_DEVICE_LABEL } from "../../../FeatureSet/Dashboard/src/Components/NetworkDevice/VendorTemplateApplication";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The network device guide names the site, role and vendor template bulk
 * actions, and the discovery import's vendor template switch, the way the
 * dashboard does - in English and in Persian, which keeps the dashboard's
 * English labels. Markdown is not compiled, so a renamed action would
 * otherwise leave the guide sending readers to a menu item that is not
 * there. The names are read from the module the hooks and the Discovery
 * page take them from.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);
const DEVICE_GUIDE: string = "monitor/network-device-monitor.md";
const LANGUAGES: Array<string> = ["en", "fa"];
const MENU_ARROW: Record<string, string> = { en: "->", fa: "→" };

function readGuide(language: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, language, DEVICE_GUIDE), "utf8");
}

function bold(label: string): string {
  return `**${label}**`;
}

// The switch's title up to its count: what a reader sees before the number.
function toggleLabel(): string {
  const title: string = IMPORT_VENDOR_TEMPLATES_TOGGLE_TITLE.other;
  return title.slice(0, title.indexOf(" — {{count}}"));
}

const SIDE_MENU: string = fs.readFileSync(
  path.join(
    REPO_ROOT,
    "App/FeatureSet/Dashboard/src/Components/Network/NetworkSideMenu.tsx",
  ),
  "utf8",
);

describe.each(LANGUAGES)("the %s network device guide", (language: string) => {
  const guide: string = readGuide(language);

  test.each([
    SET_SITE_ACTION_TITLE,
    CLEAR_SITE_ACTION_TITLE,
    SET_DEVICE_ROLE_ACTION_TITLE,
    CLEAR_DEVICE_ROLE_ACTION_TITLE,
    APPLY_VENDOR_TEMPLATE_ACTION_TITLE,
  ])("names the %s bulk action as the menu does", (title: string) => {
    expect(guide).toContain(bold(title));
  });

  test("names the vendor template dialog's matching choice", () => {
    expect(guide).toContain(bold(MATCH_EACH_DEVICE_LABEL));
  });

  test("names the discovery import's vendor template switch", () => {
    expect(toggleLabel().length).toBeGreaterThan(20);
    expect(guide).toContain(bold(toggleLabel()));
  });

  test("points at the automatic version of each: site assignment rules and device roles, by their menu paths", () => {
    const arrow: string = MENU_ARROW[language]!;

    expect(guide).toContain(
      `**Network** ${arrow} **Rules** ${arrow} **Site Assignment Rules**`,
    );
    expect(guide).toContain(
      `**Network** ${arrow} **Settings** ${arrow} **Device Roles**`,
    );
  });

  test("the vendor template section sends a reader with many devices to the bulk action", () => {
    const vendorSection: string = guide.slice(
      guide.indexOf(bold("Vendor Health Template")),
    );

    expect(vendorSection).toContain(bold(APPLY_VENDOR_TEMPLATE_ACTION_TITLE));
  });
});

describe("the menu paths the guides name", () => {
  test("Site Assignment Rules and Device Roles are where the guides say", () => {
    const rulesAt: number = SIDE_MENU.indexOf('title: "Rules"');
    const settingsAt: number = SIDE_MENU.indexOf('title: "Settings"');

    expect(rulesAt).toBeGreaterThan(-1);
    expect(settingsAt).toBeGreaterThan(rulesAt);

    const assignmentAt: number = SIDE_MENU.indexOf(
      'title: "Site Assignment Rules"',
    );
    const rolesAt: number = SIDE_MENU.indexOf('title: "Device Roles"');

    expect(assignmentAt).toBeGreaterThan(rulesAt);
    expect(assignmentAt).toBeLessThan(settingsAt);
    expect(rolesAt).toBeGreaterThan(settingsAt);
  });
});

describe("the English guide", () => {
  const guide: string = readGuide("en");

  test("has a section a reader can find from the page's contents", () => {
    expect(guide).toContain("\n## Changing Many Devices at Once\n");
    expect(guide).toContain("(#changing-many-devices-at-once)");
  });

  test("says what an action leaves alone, and that the result lists it", () => {
    const section: string = guide.slice(
      guide.indexOf("## Changing Many Devices at Once"),
      guide.indexOf("## What a Poll Actually Does"),
    );

    expect(section).toContain("monitor-backed");
    expect(section).toContain("OID Collection Template");
    expect(section).toContain("did not change");
  });
});
