import {
  DEVICE_NAME_SOURCE_FIELD_DESCRIPTION,
  DEVICE_NAME_SOURCE_FIELD_TITLE,
  getDeviceNameSourceLabel,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceNameSourceDisplay";
import { DeviceNameSource } from "../../../Types/NetworkDevice/DeviceNameSource";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the device Overview's Name Source row says (OneUptime issue #4518),
 * and when it says nothing at all.
 */

const LOCALES_DIRECTORY: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

function readLocale(code: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIRECTORY, `${code}.json`), "utf8"),
  );
}

describe("getDeviceNameSourceLabel", () => {
  test.each([
    [DeviceNameSource.SystemName, "SNMP system name"],
    [DeviceNameSource.NetbiosName, "NetBIOS (Windows) name"],
    [DeviceNameSource.DnsName, "Reverse-DNS name"],
    [DeviceNameSource.Address, "IP address"],
  ])(
    "names %s in the words the Discovery page uses",
    (source: DeviceNameSource, label: string) => {
      expect(
        getDeviceNameSourceLabel({
          name: "WB0024KDS04",
          discoveredName: "WB0024KDS04",
          discoveredNameSource: source,
        }),
      ).toBe(label);
    },
  );

  test("says nothing for a device a person renamed", () => {
    expect(
      getDeviceNameSourceLabel({
        name: "Kitchen display 4",
        discoveredName: "WB0024KDS04",
        discoveredNameSource: DeviceNameSource.NetbiosName,
      }),
    ).toBeUndefined();
  });

  test("says nothing for a device made by hand or imported before #4518", () => {
    expect(getDeviceNameSourceLabel({ name: "Register 4" })).toBeUndefined();
  });

  test("says nothing for a source it cannot read", () => {
    expect(
      getDeviceNameSourceLabel({
        name: "Register 4",
        discoveredName: "Register 4",
        discoveredNameSource: "typed",
      }),
    ).toBeUndefined();
  });
});

describe("the row's words are recorded for translation, and translated", () => {
  const english: Record<string, unknown> = readLocale("en");
  const words: Array<string> = [
    DEVICE_NAME_SOURCE_FIELD_TITLE,
    DEVICE_NAME_SOURCE_FIELD_DESCRIPTION,
    ...Object.values(DeviceNameSource).map((source: DeviceNameSource) => {
      return getDeviceNameSourceLabel({
        name: "x",
        discoveredName: "x",
        discoveredNameSource: source,
      })!;
    }),
  ];

  test.each(words)("%p is an English key", (word: string) => {
    expect(english[word]).toBe(word);
  });

  test.each([
    "de",
    "fr",
    "es",
    "it",
    "pt",
    "nl",
    "da",
    "no",
    "sv",
    "ru",
    "ja",
    "ko",
    "zh-CN",
    "zh-TW",
    "hi",
    "fa",
  ])("%s translates every one of them", (code: string) => {
    const locale: Record<string, unknown> = readLocale(code);

    for (const word of words) {
      expect({ word: word, value: locale[word] }).not.toEqual({
        word: word,
        value: word,
      });
      expect(typeof locale[word]).toBe("string");
    }
  });
});
