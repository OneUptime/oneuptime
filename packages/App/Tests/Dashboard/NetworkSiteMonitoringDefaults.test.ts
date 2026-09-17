import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHY THIS FILE EXISTS
 *
 * A site is where a device's monitoring defaults live. Under ping-first
 * polling a device can be registered by name and address alone; what makes
 * that possible is that the site it is created into carries a default probe
 * (which pings and walks it) and, optionally, a default SNMP credential
 * profile (which lets the walk start on the first poll). Both are inherited
 * at write time by NetworkDeviceService — so both forms that create or edit
 * a site have to ask for them, on a step of their own, with dropdowns bound
 * to the right models.
 *
 * The two forms are configuration handed to ModelTable / CardModelDetail as
 * props; the App suite has no React renderer, so this reads the sources
 * (comments stripped, whitespace squashed) the way NetworkSitePageInvariants
 * does. The Settings page's detail rows are checked too: a default that can
 * be set but never seen is a default nobody trusts.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function readCode(...relativeParts: Array<string>): string {
  return stripComments(
    fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8"),
  ).replace(/\s+/g, " ");
}

const SITE_FORMS: Array<{ name: string; parts: Array<string> }> = [
  {
    name: "the site create form",
    parts: ["Pages", "NetworkSite", "Sites.tsx"],
  },
  {
    name: "the site Settings form",
    parts: ["Pages", "NetworkSite", "View", "Settings.tsx"],
  },
];

/**
 * One field's definition: from `field: { <key>: true, }` to the next field of
 * either spelling. Asserts its markers were found so a slice can never cover
 * the whole file and pass by accident.
 */
function fieldSlice(code: string, key: string): string {
  const marker: string = `field: { ${key}: true, }`;
  const start: number = code.indexOf(marker);

  expect({ key: key, found: start > -1 }).toEqual({ key: key, found: true });

  const nextStarts: Array<number> = ["field: {", "overrideField: {"]
    .map((needle: string): number => {
      return code.indexOf(needle, start + marker.length);
    })
    .filter((index: number): boolean => {
      return index > -1;
    });
  const end: number =
    nextStarts.length > 0 ? Math.min(...nextStarts) : code.length;

  return code.slice(start, end);
}

describe("both site forms ask for the site's monitoring defaults", () => {
  test.each(SITE_FORMS)(
    "$name declares a Monitoring Defaults step",
    ({ parts }: { parts: Array<string> }) => {
      const code: string = readCode(...parts);

      expect(code).toContain('id: "monitoring-defaults"');
      expect(code).toContain('title: "Monitoring Defaults"');
    },
  );

  test.each(SITE_FORMS)(
    "$name puts the default probe on that step, bound to the Probe model, optional",
    ({ parts }: { parts: Array<string> }) => {
      const probe: string = fieldSlice(readCode(...parts), "probe");

      expect(probe).toContain('stepId: "monitoring-defaults"');
      expect(probe).toContain("type: Probe,");
      expect(probe).toContain("required: false");
      // The reason a device can be added by name and address alone.
      expect(probe).toContain("inherits it");
    },
  );

  test.each(SITE_FORMS)(
    "$name puts the default credential profile on that step, bound to the profile model, optional",
    ({ parts }: { parts: Array<string> }) => {
      const profile: string = fieldSlice(
        readCode(...parts),
        "snmpCredentialProfile",
      );

      expect(profile).toContain('stepId: "monitoring-defaults"');
      expect(profile).toContain("type: NetworkSnmpCredentialProfile,");
      expect(profile).toContain("required: false");
      // The honest statement of what "no profile anywhere" means.
      expect(profile).toContain("pinged only");
    },
  );

  /*
   * A site's probe has to reach the site's network, and a global probe on
   * the public internet cannot. The copy has to say so, because the
   * dropdown cannot enforce it.
   */
  test.each(SITE_FORMS)(
    "$name warns that a public probe cannot reach a private address",
    ({ parts }: { parts: Array<string> }) => {
      const probe: string = fieldSlice(readCode(...parts), "probe");

      expect(probe).toContain("public internet");
    },
  );
});

describe("the site Settings page shows the defaults it lets you set", () => {
  const settings: string = readCode(
    "Pages",
    "NetworkSite",
    "View",
    "Settings.tsx",
  );

  test("renders the default probe, with an honest empty state", () => {
    expect(settings).toContain('title: "Default Probe"');
    expect(settings).toContain("devices name their own probe");
  });

  test("renders the default credential profile, with an honest empty state", () => {
    expect(settings).toContain('title: "Default SNMP Credential Profile"');
    expect(settings).toContain("devices without credentials are pinged only");
  });
});
