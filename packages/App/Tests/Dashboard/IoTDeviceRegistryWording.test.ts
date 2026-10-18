import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Device Registry's Enabled switch, in plain words: turning it off
 * stops the device connecting with its credentials, and stops its offline
 * alerts. It used to say "pause silent-death detection". A device is
 * registered to connect, so the switch is on its edit form only: the
 * register form asks for the Device ID and a name. Common's
 * IoTDeviceRegistryPage renders the page's form.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);
const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const ENABLED_DESCRIPTION: string =
  "When off, the device cannot connect with these credentials and raises no offline alerts.";
const RETIRED: string =
  "Disabled credentials are rejected at connect and pause silent-death detection for the device.";

const registry: string = fs.readFileSync(
  path.join(DASHBOARD_SRC, "Pages", "IoT", "View", "DeviceRegistry.tsx"),
  "utf8",
);

type Locale = Record<string, unknown>;

const locales: Record<string, Locale> = {};

for (const file of fs.readdirSync(LOCALES_DIR).sort()) {
  if (file.endsWith(".json")) {
    locales[file.replace(/\.json$/, "")] = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
    ) as Locale;
  }
}

describe("the Device Registry's Enabled switch", () => {
  test("says what turning it off does, without jargon", () => {
    expect(registry).toContain(`"${ENABLED_DESCRIPTION}"`);
    expect(registry).not.toContain("silent-death");
  });

  test("is on the edit form only: a device is registered on", () => {
    const at: number = registry.indexOf('title: "Enabled"');
    const fieldEnd: number = registry.indexOf("},", at);

    expect(at).toBeGreaterThan(-1);
    expect(registry.slice(at, fieldEnd)).toContain(
      "doNotShowWhenCreating: true",
    );
  });

  test("the sentence is in English and translated in all sixteen other languages", () => {
    const others: Array<string> = Object.keys(locales).filter(
      (language: string): boolean => {
        return language !== "en";
      },
    );

    expect(others).toHaveLength(16);
    expect(locales["en"]![ENABLED_DESCRIPTION]).toBe(ENABLED_DESCRIPTION);
    for (const language of others) {
      const value: unknown = locales[language]![ENABLED_DESCRIPTION];
      expect({
        language,
        translated: typeof value === "string" && value !== ENABLED_DESCRIPTION,
      }).toEqual({ language, translated: true });
    }
  });

  test("the old sentence is in no language any more", () => {
    for (const language of Object.keys(locales)) {
      expect({ language, present: RETIRED in locales[language]! }).toEqual({
        language,
        present: false,
      });
    }
  });
});
