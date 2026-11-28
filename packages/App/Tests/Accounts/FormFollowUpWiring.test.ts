import FormFollowUpMessage from "../../FeatureSet/Accounts/src/Utils/FormFollowUpMessage";
import {
  FORM_FOLLOW_UP_ALREADY_FOLLOWING_MESSAGE,
  FORM_FOLLOW_UP_EMAIL_MESSAGE,
  FORM_FOLLOW_UP_MESSAGE_REQUIRED_MESSAGE,
  FORM_FOLLOW_UP_NAME_TOO_LONG_MESSAGE,
  FORM_FOLLOW_UP_NOT_AVAILABLE_MESSAGE,
  FORM_FOLLOW_UP_RECORD_GONE_MESSAGE,
  FORM_FOLLOW_UP_TOO_MANY_PEOPLE_MESSAGE,
} from "Common/Types/Form/FormFollowUp";
import {
  DEFAULT_ALERT_STATE_NAMES,
  DEFAULT_INCIDENT_STATE_NAMES,
  DEFAULT_SCHEDULED_MAINTENANCE_STATE_NAMES,
} from "Common/Types/StatusPage/DefaultStatusNames";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";

/*
 * A FORM'S FOLLOW-UPS ON ITS OWN PAGE, AS THE PAGE IS WIRED
 * (Accounts Components/FormFollowUp, Utils/FormFollowUp; Types/Form/FormFollowUp).
 *
 *   - the view's copy is the formFollowUp block of every Accounts locale,
 *     right after formSignIn, in English's order, translated, placeholders
 *     kept - and the view and the form's page use exactly its keys;
 *   - the follow-up routes' refusals are flat keys, word for word the
 *     server's, translated in every locale;
 *   - the page talks to the server through the form page's own client
 *     (FormAPI), which never refreshes, signs out or navigates;
 *   - a link's credential is taken out of the address before anything is
 *     drawn, as a private user's reset token is.
 */

const APP_DIR: string = nodePath.join(__dirname, "..", "..");
const ACCOUNTS_SRC: string = nodePath.join(
  APP_DIR,
  "FeatureSet",
  "Accounts",
  "src",
);
const LOCALES_DIR: string = nodePath.join(ACCOUNTS_SRC, "Locales");

const read: (relative: string) => string = (relative: string): string => {
  return fs.readFileSync(nodePath.join(ACCOUNTS_SRC, relative), "utf8");
};

const viewSource: string = read("Components/FormFollowUp/FormFollowUpView.tsx");
const pageSource: string = read("Pages/Form.tsx");
const utilsSource: string = read("Utils/FormFollowUp.ts");

const BLOCK: string = "formFollowUp";

// Words a language genuinely shares with English, and nothing else.
const SAME_AS_ENGLISH: Record<string, Array<string>> = {
  de: ["personName"],
  da: ["send"],
  no: ["send"],
};

const PLACEHOLDER: RegExp = /\{\{[^}]+\}\}/g;

const localeCodes: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((fileName: string): boolean => {
    return fileName.endsWith(".json");
  })
  .map((fileName: string): string => {
    return fileName.replace(/\.json$/, "");
  })
  .sort();

const translatedLocaleCodes: Array<string> = localeCodes.filter(
  (code: string): boolean => {
    return code !== "en";
  },
);

const readLocale: (code: string) => Record<string, unknown> = (
  code: string,
): Record<string, unknown> => {
  return JSON.parse(
    fs.readFileSync(nodePath.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as Record<string, unknown>;
};

const readBlock: (code: string) => Record<string, string> = (
  code: string,
): Record<string, string> => {
  const block: unknown = readLocale(code)[BLOCK];

  expect(typeof block).toBe("object");

  return block as Record<string, string>;
};

const placeholders: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  return (text.match(PLACEHOLDER) || []).sort();
};

const ENGLISH: Record<string, string> = readBlock("en");

describe("the view's copy", () => {
  test("all eighteen locales are checked", () => {
    expect(localeCodes).toHaveLength(18);
  });

  test("the view and the form's page use every key the block ships, and only those", () => {
    const used: Set<string> = new Set<string>();

    for (const source of [viewSource, pageSource]) {
      for (const match of source.matchAll(
        /\bt\(\s*"formFollowUp\.([A-Za-z]+)"/g,
      )) {
        used.add(match[1]!);
      }
    }

    expect(Array.from(used).sort()).toEqual(Object.keys(ENGLISH).sort());
  });

  test.each(localeCodes)(
    "%s: the block sits right after formSignIn, keys in English's order",
    (code: string) => {
      const keys: Array<string> = Object.keys(readLocale(code));

      expect(keys[keys.indexOf("formSignIn") + 1]).toBe(BLOCK);
      expect(Object.keys(readBlock(code))).toEqual(Object.keys(ENGLISH));
    },
  );

  test.each(translatedLocaleCodes)(
    "%s: every line is translated, placeholders kept",
    (code: string) => {
      const block: Record<string, string> = readBlock(code);
      const sameAsEnglish: Array<string> = SAME_AS_ENGLISH[code] || [];

      for (const key of Object.keys(ENGLISH)) {
        const value: string = block[key]!;

        expect({
          key,
          isText: typeof value === "string" && value.trim() !== "",
        }).toEqual({ key, isText: true });
        expect({ key, placeholders: placeholders(value) }).toEqual({
          key,
          placeholders: placeholders(ENGLISH[key]!),
        });

        if (!sameAsEnglish.includes(key)) {
          expect({ key, value }).not.toEqual({ key, value: ENGLISH[key] });
        }
      }
    },
  );

  test("the same-as-English lists name only keys the block has", () => {
    for (const keys of Object.values(SAME_AS_ENGLISH)) {
      for (const key of keys) {
        expect(Object.keys(ENGLISH)).toContain(key);
      }
    }
  });
});

/*
 * A request's state, named by its list (Utils/FormFollowUp,
 * getFormRequestStateName): OneUptime's own names for an incident's, an
 * alert's and a maintenance event's states, in the formFollowUpStates
 * block - the very words the status page shows for them.
 */
describe("a request's state names", () => {
  const STATES_BLOCK: string = "formFollowUpStates";
  const STATUS_PAGE_LOCALES_DIR: string = nodePath.join(
    APP_DIR,
    "FeatureSet",
    "StatusPage",
    "src",
    "Locales",
  );

  const statesOf: (code: string) => Record<string, string> = (
    code: string,
  ): Record<string, string> => {
    return readLocale(code)[STATES_BLOCK] as Record<string, string>;
  };

  test("are every one of OneUptime's own names for the three lists, in English as they are", () => {
    const names: Array<string> = Array.from(
      new Set<string>([
        ...DEFAULT_INCIDENT_STATE_NAMES,
        ...DEFAULT_ALERT_STATE_NAMES,
        ...DEFAULT_SCHEDULED_MAINTENANCE_STATE_NAMES,
      ]),
    );

    expect(Object.values(statesOf("en")).sort()).toEqual(names.sort());

    for (const name of names) {
      const key: string = name.charAt(0).toLowerCase() + name.slice(1);

      expect({ name, english: statesOf("en")[key] }).toEqual({
        name,
        english: name,
      });
    }
  });

  test.each(localeCodes)(
    "%s: sits right after the view's copy, its keys in English's order",
    (code: string) => {
      const keys: Array<string> = Object.keys(readLocale(code));

      expect(keys[keys.indexOf(BLOCK) + 1]).toBe(STATES_BLOCK);
      expect(Object.keys(statesOf(code))).toEqual(Object.keys(statesOf("en")));
    },
  );

  test.each(localeCodes)(
    "%s: words each state as the status page does",
    (code: string) => {
      const statusNames: Record<string, string> = (
        JSON.parse(
          fs.readFileSync(
            nodePath.join(STATUS_PAGE_LOCALES_DIR, `${code}.json`),
            "utf8",
          ),
        ) as Record<string, Record<string, string>>
      )["statusNames"]!;

      for (const [key, value] of Object.entries(statesOf(code))) {
        expect({ key, value }).toEqual({ key, value: statusNames[key] });
      }
    },
  );
});

describe("the follow-up routes' refusals", () => {
  test("are the server's own words, byte for byte", () => {
    expect(FormFollowUpMessage.NotAvailable).toBe(
      FORM_FOLLOW_UP_NOT_AVAILABLE_MESSAGE,
    );
    expect(FormFollowUpMessage.Email).toBe(FORM_FOLLOW_UP_EMAIL_MESSAGE);
    expect(FormFollowUpMessage.NameTooLong).toBe(
      FORM_FOLLOW_UP_NAME_TOO_LONG_MESSAGE,
    );
    expect(FormFollowUpMessage.TooManyPeople).toBe(
      FORM_FOLLOW_UP_TOO_MANY_PEOPLE_MESSAGE,
    );
    expect(FormFollowUpMessage.AlreadyFollowing).toBe(
      FORM_FOLLOW_UP_ALREADY_FOLLOWING_MESSAGE,
    );
    expect(FormFollowUpMessage.MessageRequired).toBe(
      FORM_FOLLOW_UP_MESSAGE_REQUIRED_MESSAGE,
    );
    expect(FormFollowUpMessage.RecordGone).toBe(
      FORM_FOLLOW_UP_RECORD_GONE_MESSAGE,
    );
  });

  test.each(localeCodes)(
    "%s: has each, as a flat key, translated",
    (code: string) => {
      const locale: Record<string, unknown> = readLocale(code);

      for (const sentence of Object.values(
        FormFollowUpMessage,
      ) as Array<string>) {
        const value: unknown = locale[sentence];

        expect({ sentence, isText: typeof value === "string" }).toEqual({
          sentence,
          isText: true,
        });

        if (code === "en") {
          expect(value).toBe(sentence);
        } else {
          expect({ sentence, value }).not.toEqual({
            sentence,
            value: sentence,
          });
        }
      }
    },
  );

  test("none still speaks of reports or incident forms", () => {
    for (const sentence of Object.values(
      FormFollowUpMessage,
    ) as Array<string>) {
      expect(sentence).not.toMatch(/incident form/i);
      expect(sentence).not.toMatch(/\breport\b/i);
      expect(sentence).not.toContain("{{");
    }
  });
});

describe("the page talks to the server through the form page's own client", () => {
  test("the view imports no client at all", () => {
    expect(viewSource).not.toContain('"Common/UI/Utils/API/API"');
    expect(viewSource).not.toContain("ModelAPI");
    expect(viewSource).not.toContain("FormAPI");
    expect(viewSource).not.toContain("Navigation.navigate");
  });

  test("the follow-up helpers make every request with FormAPI", () => {
    expect(utilsSource).toContain('import FormAPI from "./FormAPI";');
    expect(utilsSource).toContain("FormAPI.post<JSONObject>(");
    expect(utilsSource).toContain("FormAPI.get<JSONObject>(");
    expect(utilsSource).not.toContain('"Common/UI/Utils/API/API"');
    expect(utilsSource).not.toContain("ModelAPI");
  });

  test("a link's credential is taken out of the address with replaceState, before the page draws", () => {
    expect(utilsSource).toContain("window.history.replaceState(");
    expect(utilsSource).toContain("FORM_FOLLOW_UP_PARAMETER");
    // Read once, as the page's state starts.
    expect(pageSource).toContain("takeFormFollowUpView(followUpKey)");
  });
});
