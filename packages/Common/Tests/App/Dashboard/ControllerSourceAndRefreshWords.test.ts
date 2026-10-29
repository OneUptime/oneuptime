import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  CONTROLLER_READ_TEMPLATE,
  CONTROLLER_READ_UNNAMED_TEMPLATE,
  JUST_NOW,
  NAMED_CONTROLLER_SOURCE,
  UNNAMED_CONTROLLER_SOURCE,
  getAssetFactDifferenceLine,
  getAssetFactSourceLine,
  getAssetFactSourceText,
  getAssetFactSourceTime,
  getControllerReadLine,
  getSharedAssetFactSource,
  getSharedSourceLine,
  isNativeAssetFactSource,
  isSameAssetFactSource,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/AssetFactSourceText";
import {
  CONTROLLER_LATE,
  PROBE_COULD_NOT_REACH,
  PROBE_LATE,
  PROBE_LATE_UNNAMED,
  READ_AGAIN,
  REFRESHING_TITLE,
  REFRESH_TITLE,
  RefreshStatusWords,
  WAITING_FOR_BOTH,
  WAITING_FOR_CONTROLLER,
  WAITING_FOR_PROBE,
  getRefreshStatusWords,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/NetworkDeviceRefreshWords";
import { CONTROLLER_NETWORK_LINE } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceInventoryCard";
import {
  DESCRIBED_DEVICES_NOTE,
  DEVICE_COUNT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkTraffic/Meraki/MerakiWords";
import NetworkControllerProvider from "../../../Types/NetworkController/NetworkControllerProvider";
import { NetworkDeviceDiscoveryReaderType } from "../../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import {
  AssetFactSource,
  AssetFactSourceKind,
} from "../../../Utils/Inventory/AssetFactSource";
import {
  NetworkDeviceRefreshAnswer,
  NetworkDeviceRefreshProgress,
} from "../../../Utils/NetworkDevice/NetworkDeviceRefresh";
import {
  Translator,
  createTranslator,
} from "../../../UI/Utils/TranslateTemplate";

/*
 * What the cards say about a device's Meraki dashboard as a source of its
 * details, and about Refresh - in English, in every language, with the
 * reader's own time words, and with the connection's and probe's names as
 * they are.
 */

const NOW: Date = new Date("2026-10-28T12:00:00.000Z");
const TWENTY_MINUTES_AGO: string = "2026-10-28T11:40:00.000Z";

const english: Translator = createTranslator(undefined, "en");

const LOCALES_DIR: string = path.join(
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

const LANGUAGES: Array<string> = [
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
];

function readLocale(code: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as Record<string, unknown>;
}

function translatorFor(code: string): Translator {
  const locale: Record<string, unknown> = readLocale(code);
  return createTranslator((text: string): string | undefined => {
    const value: unknown = locale[text];
    return typeof value === "string" ? value : undefined;
  }, code);
}

function placeholdersOf(text: string): Array<string> {
  const names: Array<string> = [];
  let index: number = text.indexOf("{{");

  while (index >= 0) {
    const end: number = text.indexOf("}}", index);

    if (end < 0) {
      break;
    }

    names.push(text.substring(index + 2, end).trim());
    index = text.indexOf("{{", end);
  }

  return names.sort();
}

const MERAKI: AssetFactSource = {
  kind: AssetFactSourceKind.Controller,
  readBy: {
    type: NetworkDeviceDiscoveryReaderType.NetworkController,
    id: "22222222-2222-4222-8222-222222222222",
    name: "Acme Retail",
  },
  readAt: TWENTY_MINUTES_AGO,
  provider: NetworkControllerProvider.Meraki,
};

const MERAKI_UNNAMED: AssetFactSource = {
  ...MERAKI,
  readBy: {
    type: NetworkDeviceDiscoveryReaderType.NetworkController,
    id: "22222222-2222-4222-8222-222222222222",
  },
};

describe("the Meraki dashboard as a source, in words", () => {
  test("under a value: the dashboard, the connection, and when", () => {
    expect(getAssetFactSourceText(MERAKI, english)).toBe(
      "Meraki dashboard (Acme Retail)",
    );
    expect(getAssetFactSourceLine(MERAKI, english, NOW)).toBe(
      "Meraki dashboard (Acme Retail) · 20 minutes ago",
    );
    expect(getAssetFactSourceText(MERAKI_UNNAMED, english)).toBe(
      "The Meraki dashboard",
    );
  });

  test("said once, below the details it gave", () => {
    expect(getControllerReadLine(MERAKI, english, NOW)).toBe(
      "Read from the Meraki dashboard (Acme Retail), 20 minutes ago.",
    );
    expect(getControllerReadLine(MERAKI_UNNAMED, english, NOW)).toBe(
      "Read from the Meraki dashboard, 20 minutes ago.",
    );
    expect(getSharedSourceLine(MERAKI, english, NOW)).toBe(
      "Read from the Meraki dashboard (Acme Retail), 20 minutes ago.",
    );
    // No time, nothing worth saying once.
    expect(
      getControllerReadLine({ ...MERAKI, readAt: undefined }, english, NOW),
    ).toBeUndefined();
  });

  test("beside a value someone saved that it disagrees with", () => {
    expect(
      getAssetFactDifferenceLine(
        { value: "Q2HP-SWCH-0001", source: MERAKI },
        english,
        NOW,
      ),
    ).toBe(
      "Meraki dashboard (Acme Retail) says Q2HP-SWCH-0001 · 20 minutes ago",
    );
  });

  test("said once when it gave two details or more; never a machine's own source", () => {
    expect(getSharedAssetFactSource([MERAKI, { ...MERAKI }])).toEqual(MERAKI);
    expect(getSharedAssetFactSource([MERAKI])).toBeUndefined();
    expect(isNativeAssetFactSource(MERAKI)).toBe(false);

    // A device's own poll wins a tie.
    const poll: AssetFactSource = {
      kind: AssetFactSourceKind.SnmpPoll,
      readAt: TWENTY_MINUTES_AGO,
    };
    expect(getSharedAssetFactSource([MERAKI, MERAKI, poll, poll])).toEqual(
      poll,
    );
  });

  test("two readings are the same only by the same connection at the same time", () => {
    expect(isSameAssetFactSource(MERAKI, { ...MERAKI })).toBe(true);
    expect(
      isSameAssetFactSource(MERAKI, {
        ...MERAKI,
        readAt: "2026-10-28T11:45:00.000Z",
      }),
    ).toBe(false);
    expect(
      isSameAssetFactSource(MERAKI, {
        ...MERAKI,
        readBy: {
          ...MERAKI.readBy!,
          id: "55555555-5555-4555-8555-555555555555",
        },
      }),
    ).toBe(false);
  });

  test("in German and in Persian, with their own time words", () => {
    const german: Translator = translatorFor("de");
    const persian: Translator = translatorFor("fa");

    expect(getControllerReadLine(MERAKI, german, NOW)).toBe(
      "Aus dem Meraki-Dashboard (Acme Retail) gelesen, vor 20 Minuten.",
    );
    expect(getAssetFactSourceText(MERAKI, persian)).toBe(
      "داشبورد Meraki (Acme Retail)",
    );
  });

  /*
   * Refresh makes readings of a few seconds ago common: they say "just
   * now", where the relative time alone says a bare "now" ("Read from the
   * Meraki dashboard (Acme Retail), now.").
   */
  test("a reading of the last few seconds was read just now, in every language", () => {
    const justRead: AssetFactSource = {
      ...MERAKI,
      readAt: "2026-10-28T11:59:50.000Z",
    };

    expect(getAssetFactSourceTime(justRead.readAt, english, NOW)).toBe(
      "just now",
    );
    expect(getControllerReadLine(justRead, english, NOW)).toBe(
      "Read from the Meraki dashboard (Acme Retail), just now.",
    );
    expect(getAssetFactSourceLine(justRead, english, NOW)).toBe(
      "Meraki dashboard (Acme Retail) · just now",
    );
    // Any other reader's too: the scan that just finished.
    expect(
      getAssetFactSourceTime("2026-10-28T11:59:30.000Z", english, NOW),
    ).toBe("just now");
    expect(getControllerReadLine(justRead, translatorFor("de"), NOW)).toBe(
      "Aus dem Meraki-Dashboard (Acme Retail) gelesen, gerade eben.",
    );

    // A minute ago is a minute ago.
    expect(
      getAssetFactSourceTime("2026-10-28T11:59:00.000Z", english, NOW),
    ).toBe("1 minute ago");

    expect(JUST_NOW).toBe("just now");

    for (const code of LANGUAGES) {
      const words: string | undefined = getAssetFactSourceTime(
        justRead.readAt,
        translatorFor(code),
        NOW,
      );

      expect({ code, words: words !== JUST_NOW && Boolean(words) }).toEqual({
        code,
        words: true,
      });
      expect({ code, words }).toEqual({
        code,
        words: readLocale(code)[JUST_NOW],
      });
    }
  });
});

describe("what Refresh says", () => {
  function answer(
    overrides: Partial<NetworkDeviceRefreshAnswer> = {},
  ): NetworkDeviceRefreshAnswer {
    return {
      requestedAt: NOW.toISOString(),
      isProbeReading: true,
      probeName: "Branch probe",
      isControllerReading: false,
      wasAlreadyRequested: false,
      ...overrides,
    };
  }

  function words(
    progress: NetworkDeviceRefreshProgress,
    overrides: Partial<NetworkDeviceRefreshAnswer> = {},
    pending: { probe: boolean; controller: boolean } = {
      probe: false,
      controller: false,
    },
  ): RefreshStatusWords | undefined {
    return getRefreshStatusWords({
      answer: answer(overrides),
      standing: {
        progress,
        isProbePending: pending.probe,
        isControllerPending: pending.controller,
      },
    });
  }

  test("nothing before anyone asks", () => {
    expect(
      getRefreshStatusWords({ answer: undefined, standing: undefined }),
    ).toBeUndefined();
  });

  test("while its readers are at it: who reads it again", () => {
    expect(words(NetworkDeviceRefreshProgress.Waiting)).toEqual({
      tone: "progress",
      template: WAITING_FOR_PROBE,
      values: {},
    });
    expect(
      words(NetworkDeviceRefreshProgress.Waiting, {
        isProbeReading: false,
        isControllerReading: true,
      })?.template,
    ).toBe(WAITING_FOR_CONTROLLER);
    expect(
      words(NetworkDeviceRefreshProgress.Waiting, {
        isControllerReading: true,
      })?.template,
    ).toBe(WAITING_FOR_BOTH);
  });

  test("done: read again, or its probe could not reach it", () => {
    expect(words(NetworkDeviceRefreshProgress.Read)).toEqual({
      tone: "done",
      template: READ_AGAIN,
      values: {},
    });
    expect(words(NetworkDeviceRefreshProgress.Unreachable)).toEqual({
      tone: "warning",
      template: PROBE_COULD_NOT_REACH,
      values: {},
    });
  });

  test("late: the probe to check, by name when it has one; else the Meraki connection", () => {
    expect(
      words(
        NetworkDeviceRefreshProgress.Late,
        {},
        {
          probe: true,
          controller: false,
        },
      ),
    ).toEqual({
      tone: "warning",
      template: PROBE_LATE,
      values: { probe: "Branch probe" },
    });
    expect(
      words(
        NetworkDeviceRefreshProgress.Late,
        { probeName: undefined },
        { probe: true, controller: false },
      )?.template,
    ).toBe(PROBE_LATE_UNNAMED);
    expect(
      words(
        NetworkDeviceRefreshProgress.Late,
        { isControllerReading: true },
        { probe: false, controller: true },
      )?.template,
    ).toBe(CONTROLLER_LATE);
  });
});

describe("every new sentence, in every language", () => {
  const TEMPLATES: Array<string> = [
    ...Object.values(NAMED_CONTROLLER_SOURCE),
    ...Object.values(UNNAMED_CONTROLLER_SOURCE),
    ...Object.values(CONTROLLER_READ_TEMPLATE),
    ...Object.values(CONTROLLER_READ_UNNAMED_TEMPLATE),
    WAITING_FOR_PROBE,
    WAITING_FOR_CONTROLLER,
    WAITING_FOR_BOTH,
    READ_AGAIN,
    PROBE_COULD_NOT_REACH,
    PROBE_LATE,
    PROBE_LATE_UNNAMED,
    CONTROLLER_LATE,
    CONTROLLER_NETWORK_LINE,
    REFRESH_TITLE,
    REFRESHING_TITLE,
    DESCRIBED_DEVICES_NOTE.other,
    DEVICE_COUNT.other,
  ];

  test.each(LANGUAGES)(
    "%s words every one, keeping its placeholders",
    (code: string) => {
      const locale: Record<string, unknown> = readLocale(code);

      for (const template of TEMPLATES) {
        const translated: unknown = locale[template];

        expect({ template, isText: typeof translated === "string" }).toEqual({
          template,
          isText: true,
        });
        expect({
          template,
          placeholders: placeholdersOf(translated as string),
        }).toEqual({ template, placeholders: placeholdersOf(template) });
        // Worded, not left as the English placeholder.
        expect({ template, isEnglish: translated === template }).toEqual({
          template,
          isEnglish: false,
        });
      }

      // The one form of the plural note, worded too.
      const one: unknown = locale[`${DESCRIBED_DEVICES_NOTE.other}_one`];
      expect(typeof one).toBe("string");
      expect(placeholdersOf(one as string)).toEqual(["count"]);
    },
  );
});
