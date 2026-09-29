import {
  FEED_OPTIONS_TEXT,
  FEED_SORT_ORDER_OPTIONS,
  FILTERED_FEED_NO_ITEMS_MESSAGE,
  FeedSortOrderOption,
  getFeedEventTypeLabel,
} from "../../../UI/Components/Feed/FeedOptions";
import {
  DEFAULT_DASHBOARD_LANGUAGE,
  SUPPORTED_DASHBOARD_LANGUAGE_CODES,
} from "../../../Types/Dashboard/DashboardLanguage";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The "Filter & Sort" control on every dashboard activity feed looks each of
 * its strings up in the Dashboard locale files by its English text - its own
 * sentences, the two sort choices, the filtered empty state, and the label of
 * every event type in the checklist. A string with no entry silently stays
 * English, and a translation that drops or renames a {{placeholder}} shows a
 * raw brace or a missing number. This pins the English keys to what the code
 * renders and every other language to having a usable translation of each.
 *
 * The event types are discovered from the feed models on disk, not listed
 * here, so a feed model or event type added later needs its label translated
 * before this passes.
 */

const COMMON_ROOT: string = path.resolve(__dirname, "..", "..", "..");

const MODELS_DIRECTORY: string = path.join(
  COMMON_ROOT,
  "Models",
  "DatabaseModels",
);

const DASHBOARD_LOCALES: string = path.join(
  COMMON_ROOT,
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

// The sentence the trigger used as its accessible name before it was retired.
const RETIRED_KEY: string = "Filter and sort feed: {{summary}}";

const FEED_EVENT_TYPE_ENUM_PATTERN: RegExp =
  /export enum (\w+FeedEventType)\b/g;

const PLACEHOLDER_PATTERN: RegExp = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

interface FeedEventTypeEnum {
  model: string;
  enumName: string;
  values: Array<string>;
}

type FindFeedEventTypeEnums = () => Array<FeedEventTypeEnum>;

/*
 * Every *FeedEventType enum under Models/DatabaseModels, with the values the
 * model module actually exports (loaded, not parsed, so a value written in an
 * unusual way cannot be misread).
 */
const findFeedEventTypeEnums: FindFeedEventTypeEnums =
  (): Array<FeedEventTypeEnum> => {
    const found: Array<FeedEventTypeEnum> = [];

    for (const entry of fs.readdirSync(MODELS_DIRECTORY, {
      withFileTypes: true,
    })) {
      if (!entry.isFile() || !entry.name.endsWith(".ts")) {
        continue;
      }

      const source: string = fs.readFileSync(
        path.join(MODELS_DIRECTORY, entry.name),
        "utf8",
      );
      const enumNames: Array<string> = Array.from(
        source.matchAll(FEED_EVENT_TYPE_ENUM_PATTERN),
        (match: RegExpMatchArray): string => {
          return match[1]!;
        },
      );

      if (enumNames.length === 0) {
        continue;
      }

      const model: string = entry.name.replace(/\.ts$/, "");
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const exported: Record<string, unknown> = require(
        path.join(MODELS_DIRECTORY, model),
      );

      for (const enumName of enumNames) {
        const eventTypeEnum: unknown = exported[enumName];

        found.push({
          model,
          enumName,
          values:
            eventTypeEnum && typeof eventTypeEnum === "object"
              ? Object.values(eventTypeEnum as Record<string, string>)
              : [],
        });
      }
    }

    return found;
  };

type ReadLocale = (fileName: string) => Record<string, unknown>;

const readLocale: ReadLocale = (fileName: string): Record<string, unknown> => {
  return JSON.parse(
    fs.readFileSync(path.join(DASHBOARD_LOCALES, fileName), "utf8"),
  ) as Record<string, unknown>;
};

type GetPlaceholders = (text: string) => Array<string>;

// The placeholder names in a string, repeats kept, in a stable order.
const getPlaceholders: GetPlaceholders = (text: string): Array<string> => {
  return Array.from(
    text.matchAll(PLACEHOLDER_PATTERN),
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  ).sort();
};

type Unique = (values: Array<string>) => Array<string>;

const unique: Unique = (values: Array<string>): Array<string> => {
  return Array.from(new Set<string>(values));
};

const FEED_EVENT_TYPE_ENUMS: Array<FeedEventTypeEnum> =
  findFeedEventTypeEnums();

// The control's own words, exactly as it passes them to the translator.
const CONTROL_KEYS: Array<string> = unique([
  ...Object.values(FEED_OPTIONS_TEXT),
  ...FEED_SORT_ORDER_OPTIONS.map((option: FeedSortOrderOption): string => {
    return option.label;
  }),
  FILTERED_FEED_NO_ITEMS_MESSAGE,
]);

// The checklist's labels, which are translated by their English text too.
const EVENT_TYPE_LABEL_KEYS: Array<string> = unique(
  FEED_EVENT_TYPE_ENUMS.flatMap((eventTypeEnum: FeedEventTypeEnum) => {
    return eventTypeEnum.values.map((value: string): string => {
      return getFeedEventTypeLabel(value);
    });
  }),
);

const ALL_KEYS: Array<string> = unique([
  ...CONTROL_KEYS,
  ...EVENT_TYPE_LABEL_KEYS,
]);

const OTHER_LANGUAGES: Array<string> =
  SUPPORTED_DASHBOARD_LANGUAGE_CODES.filter((code: string): boolean => {
    return code !== DEFAULT_DASHBOARD_LANGUAGE;
  });

describe("Filter & Sort translations in the Dashboard locales", () => {
  test("the feed models on disk were found and loaded", () => {
    // An empty or unloaded scan would make every check below vacuous.
    expect(FEED_EVENT_TYPE_ENUMS.length).toBeGreaterThan(0);

    for (const eventTypeEnum of FEED_EVENT_TYPE_ENUMS) {
      expect({
        enumName: eventTypeEnum.enumName,
        loaded: eventTypeEnum.values.length > 0,
      }).toEqual({ enumName: eventTypeEnum.enumName, loaded: true });
    }

    expect(OTHER_LANGUAGES.length).toBeGreaterThan(0);
  });

  test("English maps every string the control shows to itself", () => {
    const english: Record<string, unknown> = readLocale(
      `${DEFAULT_DASHBOARD_LANGUAGE}.json`,
    );

    const missing: Array<string> = ALL_KEYS.filter((key: string): boolean => {
      return english[key] !== key;
    });

    expect(missing).toEqual([]);
  });

  test.each(OTHER_LANGUAGES)(
    "%s translates every string the control shows, keeping its placeholders",
    (language: string) => {
      const locale: Record<string, unknown> = readLocale(`${language}.json`);
      const problems: Array<string> = [];

      for (const key of ALL_KEYS) {
        const value: unknown = locale[key];

        if (typeof value !== "string" || value.trim().length === 0) {
          problems.push(`missing: ${key}`);
          continue;
        }

        const expected: string = getPlaceholders(key).join(",");
        const actual: string = getPlaceholders(value).join(",");

        if (actual !== expected) {
          problems.push(
            `placeholders {${actual}} instead of {${expected}}: ${key}`,
          );
        }
      }

      expect(problems).toEqual([]);
    },
  );

  test("the retired accessible-name sentence is in no locale file", () => {
    const localeFiles: Array<string> = fs
      .readdirSync(DASHBOARD_LOCALES)
      .filter((fileName: string): boolean => {
        return fileName.endsWith(".json");
      });

    expect(localeFiles.length).toBeGreaterThan(1);

    const stillThere: Array<string> = localeFiles.filter(
      (fileName: string): boolean => {
        return Object.prototype.hasOwnProperty.call(
          readLocale(fileName),
          RETIRED_KEY,
        );
      },
    );

    expect(stillThere).toEqual([]);
  });
});
