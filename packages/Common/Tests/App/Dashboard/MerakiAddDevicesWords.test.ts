import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  ADDED_DEVICES_NOTE,
  ADDED_SITES_NOTE,
  ADDING_DEVICES,
  ADDING_DEVICES_PROGRESS,
  ADD_COUNT_BUTTON,
  ADD_DEVICES_ACTION,
  ADD_DEVICES_DESCRIPTION,
  ADD_DEVICES_TITLE,
  ADD_FAILED_NOTE,
  ADD_STOPPED_NOTE,
  ARCHIVED_NOTE,
  COUNTED_AT_NEXT_READ,
  DEVICE_ADD_OUTCOME_SHOWN_FOR_MS,
  DEVICE_KINDS_LABEL,
  DEVICE_KIND_NAMES,
  DEVICE_KIND_PRODUCT_LINES,
  DeviceAddStanding,
  FAILED_DEVICES_NOTE,
  NOTHING_ADDED_NOTE,
  NOTHING_LEFT_TO_ADD,
  NOT_ADDED_DEVICES_NOTE,
  NO_PROBE,
  PROBE_HELP,
  PROBE_LABEL,
  REMAINING_DEVICES_NOTE,
  SITES_CHECKBOX,
  SITES_HELP,
  SITES_LABEL,
  SITES_ON_VALUE,
  TAKEN_NOTE,
  WITHOUT_ADDRESS_NOTE,
  getDeviceAddStanding,
  getDialogDeviceKinds,
  getNotAddedCounts,
  getOfferedDeviceCount,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkTraffic/Meraki/MerakiAddDevicesWords";
import {
  ADDABLE_CONTROLLER_PRODUCT_TYPES,
  NETWORK_CONTROLLER_DEVICE_ADD_STALE_MS,
  NetworkControllerDeviceAddState,
  NetworkControllerDeviceAddStatus,
  NetworkControllerUnaddedDeviceCount,
  buildQueuedNetworkControllerDeviceAddState,
} from "../../../Types/NetworkController/NetworkControllerDeviceAdd";
import {
  PluralTemplate,
  Translator,
  createTranslator,
} from "../../../UI/Utils/TranslateTemplate";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * What a Meraki connection says about adding its devices
 * (MerakiAddDevicesWords): when its row offers them, what an ask's state
 * says, the dialog's choices - and every sentence of it worded in every
 * language the Dashboard ships, its placeholders kept, a value set apart in
 * a right-to-left sentence.
 */

const NOW: Date = new Date("2026-11-03T12:00:00.000Z");
const USER_ID: string = "33333333-3333-4333-8333-333333333333";

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

// Words that read the same in a language, as its locale's progress records them.
const SAME_IN: Record<string, Array<string>> = {
  de: ["Switches"],
  nl: ["Switches"],
  fr: ["Sites"],
  pt: ["Sites"],
};

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

function state(
  overrides: Partial<NetworkControllerDeviceAddState> = {},
): NetworkControllerDeviceAddState {
  return {
    ...buildQueuedNetworkControllerDeviceAddState({
      request: { productTypes: ["switch", "wireless"], groupBySite: true },
      requestedByUserId: USER_ID,
      now: new Date(NOW.getTime() - 60 * 1000),
    }),
    ...overrides,
  };
}

const COUNTS: Array<NetworkControllerUnaddedDeviceCount> = [
  {
    productType: "switch",
    addable: 40,
    withoutAddress: 0,
    taken: 2,
    archived: 0,
  },
  {
    productType: "wireless",
    addable: 70,
    withoutAddress: 0,
    taken: 0,
    archived: 1,
  },
  {
    productType: "appliance",
    addable: 0,
    withoutAddress: 8,
    taken: 0,
    archived: 0,
  },
  {
    productType: "camera",
    addable: 12,
    withoutAddress: 0,
    taken: 3,
    archived: 0,
  },
];

describe("where an ask stands, as the row draws it", () => {
  test("never asked: nothing to say", () => {
    expect(getDeviceAddStanding(undefined, NOW)).toBe(DeviceAddStanding.None);
  });

  test("queued or adding, while its worker writes: under way", () => {
    expect(getDeviceAddStanding(state(), NOW)).toBe(DeviceAddStanding.UnderWay);
    expect(
      getDeviceAddStanding(
        state({
          status: NetworkControllerDeviceAddStatus.Adding,
          updatedAt: NOW.toISOString(),
        }),
        NOW,
      ),
    ).toBe(DeviceAddStanding.UnderWay);
  });

  test("adding, and its worker gone quiet: stopped", () => {
    expect(
      getDeviceAddStanding(
        state({
          status: NetworkControllerDeviceAddStatus.Adding,
          updatedAt: new Date(
            NOW.getTime() - NETWORK_CONTROLLER_DEVICE_ADD_STALE_MS,
          ).toISOString(),
        }),
        NOW,
      ),
    ).toBe(DeviceAddStanding.Stopped);
  });

  test("done or failed: said for a day, then not at all", () => {
    const finishedAt: string = new Date(
      NOW.getTime() - 60 * 1000,
    ).toISOString();

    expect(
      getDeviceAddStanding(
        state({ status: NetworkControllerDeviceAddStatus.Done, finishedAt }),
        NOW,
      ),
    ).toBe(DeviceAddStanding.Done);
    expect(
      getDeviceAddStanding(
        state({ status: NetworkControllerDeviceAddStatus.Failed, finishedAt }),
        NOW,
      ),
    ).toBe(DeviceAddStanding.Failed);
    expect(
      getDeviceAddStanding(
        state({
          status: NetworkControllerDeviceAddStatus.Done,
          finishedAt: new Date(
            NOW.getTime() - DEVICE_ADD_OUTCOME_SHOWN_FOR_MS - 1,
          ).toISOString(),
        }),
        NOW,
      ),
    ).toBe(DeviceAddStanding.None);
  });
});

describe("what the row offers, and what the dialog lists", () => {
  test("the row offers the addable devices of the kinds an ask starts with", () => {
    expect(getOfferedDeviceCount({ counts: COUNTS, last: undefined })).toBe(
      110,
    );
    expect(
      getOfferedDeviceCount({
        counts: COUNTS,
        last: state({
          request: { productTypes: ["camera"], groupBySite: true },
        }),
      }),
    ).toBe(12);
    expect(getOfferedDeviceCount({ counts: undefined, last: undefined })).toBe(
      0,
    );
  });

  test("the dialog lists the kinds with something to add; every kind when nothing was counted", () => {
    expect(getDialogDeviceKinds(COUNTS)).toEqual([
      "switch",
      "wireless",
      "camera",
    ]);
    expect(getDialogDeviceKinds(undefined)).toEqual([
      ...ADDABLE_CONTROLLER_PRODUCT_TYPES,
    ]);
    expect(getDialogDeviceKinds([])).toEqual([]);
  });

  test("what is not added, of the kinds picked - and a kind with nothing to add, whatever is picked", () => {
    expect(
      getNotAddedCounts({
        counts: COUNTS,
        productTypes: ["switch", "wireless"],
      }),
    ).toEqual({ withoutAddress: 8, taken: 2, archived: 1 });
    expect(
      getNotAddedCounts({ counts: COUNTS, productTypes: ["camera"] }),
    ).toEqual({ withoutAddress: 8, taken: 3, archived: 0 });
    expect(
      getNotAddedCounts({ counts: undefined, productTypes: ["switch"] }),
    ).toEqual({ withoutAddress: 0, taken: 0, archived: 0 });
  });

  test("every kind Add devices offers has a name, and only the ones people call by a product line have one", () => {
    for (const kind of ADDABLE_CONTROLLER_PRODUCT_TYPES) {
      expect(DEVICE_KIND_NAMES[kind]).toBeTruthy();
    }

    expect(Object.keys(DEVICE_KIND_PRODUCT_LINES).sort()).toEqual([
      "appliance",
      "camera",
      "cellularGateway",
      "switch",
      "wireless",
    ]);
  });
});

const TEMPLATES: Array<string> = [
  ...Object.values(DEVICE_KIND_NAMES),
  ADD_DEVICES_TITLE,
  ADD_DEVICES_ACTION,
  ADD_DEVICES_DESCRIPTION,
  DEVICE_KINDS_LABEL,
  COUNTED_AT_NEXT_READ,
  NOTHING_LEFT_TO_ADD,
  SITES_LABEL,
  SITES_CHECKBOX,
  SITES_HELP,
  SITES_ON_VALUE,
  PROBE_LABEL,
  NO_PROBE,
  PROBE_HELP,
  ADDING_DEVICES,
  ADDING_DEVICES_PROGRESS,
  NOTHING_ADDED_NOTE,
  ADD_FAILED_NOTE,
  ADD_STOPPED_NOTE,
];

const PLURALS: Array<PluralTemplate> = [
  NOT_ADDED_DEVICES_NOTE,
  WITHOUT_ADDRESS_NOTE,
  TAKEN_NOTE,
  ARCHIVED_NOTE,
  ADD_COUNT_BUTTON,
  ADDED_DEVICES_NOTE,
  ADDED_SITES_NOTE,
  FAILED_DEVICES_NOTE,
  REMAINING_DEVICES_NOTE,
];

describe("every sentence, in every language", () => {
  test.each(LANGUAGES)(
    "%s words every one, keeping its placeholders",
    (code: string) => {
      const locale: Record<string, unknown> = readLocale(code);

      for (const template of [
        ...TEMPLATES,
        ...PLURALS.map((plural: PluralTemplate): string => {
          return plural.other;
        }),
      ]) {
        const translated: unknown = locale[template];

        expect({ template, isText: typeof translated === "string" }).toEqual({
          template,
          isText: true,
        });
        expect({
          template,
          placeholders: placeholdersOf(translated as string),
        }).toEqual({ template, placeholders: placeholdersOf(template) });
        expect({
          template,
          isEnglish:
            translated === template &&
            !(SAME_IN[code] || []).includes(template),
        }).toEqual({ template, isEnglish: false });
      }

      // The one forms, worded too, with the same placeholders.
      for (const plural of PLURALS) {
        const one: unknown = locale[`${plural.other}_one`];

        expect({ plural: plural.one, isText: typeof one === "string" }).toEqual(
          { plural: plural.one, isText: true },
        );
        expect({
          plural: plural.one,
          placeholders: placeholdersOf(one as string),
        }).toEqual({
          plural: plural.one,
          placeholders: placeholdersOf(plural.one),
        });
        expect({ plural: plural.one, isEnglish: one === plural.one }).toEqual({
          plural: plural.one,
          isEnglish: false,
        });
      }
    },
  );

  test("in German, the count and the time where German puts them", () => {
    const german: Translator = translatorFor("de");

    expect(german.translatePlural(ADD_COUNT_BUTTON, 1234)).toBe(
      "1.234 Geräte hinzufügen",
    );
    expect(german.translatePlural(ADD_COUNT_BUTTON, 1)).toBe(
      "1 Gerät hinzufügen",
    );
    expect(
      german.translatePlural(ADDED_DEVICES_NOTE, 12, {
        time: "vor 2 Minuten",
      }),
    ).toBe("12 Netzwerkgeräte aus Meraki hinzugefügt (vor 2 Minuten).");
  });

  test("in Russian, a count of any size reads right", () => {
    const russian: Translator = translatorFor("ru");

    // 22 is a "few" count, 100 a "many" one: neither is "one" (1, 21, 101).
    for (const count of [2, 5, 11, 22, 100]) {
      expect(russian.translatePlural(NOT_ADDED_DEVICES_NOTE, count)).toBe(
        `Устройств Meraki, которых здесь ещё нет среди сетевых устройств: ${count}.`,
      );
    }
  });

  test("in Persian, the organization's name is set apart, so it reads where the sentence puts it", () => {
    const persian: Translator = translatorFor("fa");
    const sentence: string = persian.translateTemplate(
      ADD_DEVICES_DESCRIPTION,
      { organization: "Acme Retail" },
      { setsValuesApart: true },
    );

    expect(sentence).toContain(isolated("Acme Retail"));
    expect(withoutIsolateMarks(sentence)).toBe(
      "دستگاه‌هایی از Acme Retail را که هنوز اینجا نیستند، با نشانی مدیریتشان اضافه می‌کند. مدل، شماره سریال و فریم‌ور آن‌ها را Meraki تکمیل می‌کند.",
    );
  });

  test("in English, the progress and the reason as they are", () => {
    const english: Translator = createTranslator(undefined, "en");

    expect(
      english.translateTemplate(ADDING_DEVICES_PROGRESS, {
        added: english.formatNumber(1200),
        total: english.formatNumber(3400),
      }),
    ).toBe("Adding devices from Meraki: 1,200 of 3,400 so far.");
    expect(
      english.translateTemplate(ADD_FAILED_NOTE, {
        reason: "Meraki did not accept the API key.",
      }),
    ).toBe(
      "Devices could not be added from Meraki: Meraki did not accept the API key.",
    );
  });
});
