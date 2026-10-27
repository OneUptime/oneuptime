import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import TableColumnType from "Common/Types/Database/TableColumnType";
import Permission from "Common/Types/Permission";
import {
  PRIVATE_USER_SESSION_LENGTH_CHOICES_IN_HOURS,
  PRIVATE_USER_SESSION_LENGTH_COLUMN,
} from "Common/Types/StatusPage/PrivateUserSessionLength";
import StatusPageSessionLengthCopy, {
  fromSessionLengthChoiceValue,
  getSessionLengthChoices,
  getSessionLengthLabel,
  isOtherSessionLength,
  NO_SESSION_LENGTH_VALUE,
  SessionLengthChoice,
  toSessionLengthChoiceValue,
} from "../../FeatureSet/Dashboard/src/Components/StatusPage/StatusPageSessionLengthCopy";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * "Sign readers out after", on a status page's Security -> Access page
 * (StatusPageSessionLengthCard): its copy, its choices, the column it
 * writes and the page it lives on. Every string it shows is translated in
 * all seventeen Dashboard locales.
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

const OTHER_LOCALES: Array<string> = [
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

const readLocale: (code: string) => Record<string, unknown> = (
  code: string,
): Record<string, unknown> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as Record<string, unknown>;
};

// Without its comments, collapsed to one line.
function readSource(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\s+/g, " ");
}

// Every English string the card can show.
const shownStrings: () => Array<string> = (): Array<string> => {
  return Array.from(
    new Set([
      StatusPageSessionLengthCopy.cardTitle,
      StatusPageSessionLengthCopy.cardDescription,
      StatusPageSessionLengthCopy.label,
      StatusPageSessionLengthCopy.noLimit,
      StatusPageSessionLengthCopy.noLimitDescription,
      StatusPageSessionLengthCopy.limitDescription,
      ...getSessionLengthChoices(36).map(
        (choice: SessionLengthChoice): string => {
          return choice.label;
        },
      ),
    ]),
  );
};

describe("the column it writes", () => {
  const page: StatusPage = new StatusPage();

  test("is a number of hours the model declares, nullable, with no default", () => {
    const metadata: { type: TableColumnType; defaultValue?: unknown } =
      page.getTableColumnMetadata(PRIVATE_USER_SESSION_LENGTH_COLUMN);

    expect(metadata.type).toBe(TableColumnType.Number);
    expect(metadata.defaultValue).toBeUndefined();
  });

  test("is set on the Scale plan, read on every plan", () => {
    expect(
      page.getColumnBillingAccessControl(PRIVATE_USER_SESSION_LENGTH_COLUMN),
    ).toEqual({
      read: PlanType.Free,
      update: PlanType.Scale,
      create: PlanType.Scale,
    });
  });

  test("is the team's to read and change, and never the public's", () => {
    const access: {
      read: Array<Permission>;
      update: Array<Permission>;
      create: Array<Permission>;
    } = page.getColumnAccessControlFor(PRIVATE_USER_SESSION_LENGTH_COLUMN)!;

    expect(access.read).not.toContain(Permission.Public);
    expect(access.update).toEqual(
      expect.arrayContaining([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.StatusPageAdmin,
        Permission.EditProjectStatusPage,
      ]),
    );
    expect(access.update).not.toContain(Permission.Public);
    expect(access.create).not.toContain(Permission.Public);
  });
});

describe("the choices", () => {
  test("No limit is first and stores nothing", () => {
    const choices: Array<SessionLengthChoice> = getSessionLengthChoices(null);

    expect(choices[0]!.value).toBe(NO_SESSION_LENGTH_VALUE);
    expect(choices[0]!.label).toBe(StatusPageSessionLengthCopy.noLimit);
    expect(fromSessionLengthChoiceValue(NO_SESSION_LENGTH_VALUE)).toBeNull();
    expect(toSessionLengthChoiceValue(null)).toBe(NO_SESSION_LENGTH_VALUE);
  });

  test("every length the server allows to be offered has a name of its own", () => {
    for (const hours of PRIVATE_USER_SESSION_LENGTH_CHOICES_IN_HOURS) {
      expect(isOtherSessionLength(hours)).toBe(false);
      expect(toSessionLengthChoiceValue(hours)).toBe(hours);
      expect(fromSessionLengthChoiceValue(hours)).toBe(hours);
    }
  });

  test("a stored length the list does not have is offered in its place, by length", () => {
    const values: Array<number> = getSessionLengthChoices(36).map(
      (choice: SessionLengthChoice): number => {
        return choice.value;
      },
    );

    expect(values).toEqual([0, 1, 4, 8, 12, 24, 36, 72, 168, 336, 720]);
    expect(isOtherSessionLength(36)).toBe(true);
  });

  test("a stored length the list has is not offered twice", () => {
    const values: Array<number> = getSessionLengthChoices(24).map(
      (choice: SessionLengthChoice): number => {
        return choice.value;
      },
    );

    expect(
      values.filter((value: number): boolean => {
        return value === 24;
      }),
    ).toHaveLength(1);
  });
});

describe("its strings", () => {
  const en: Record<string, unknown> = readLocale("en");

  test("are each a key of en.json that reads as itself", () => {
    for (const text of shownStrings()) {
      expect([text, en[text]]).toEqual([text, text]);
    }
  });

  test.each(OTHER_LOCALES)(
    "are translated in %s, keeping their placeholders",
    (code: string) => {
      const locale: Record<string, unknown> = readLocale(code);

      for (const text of shownStrings()) {
        const translated: unknown = locale[text];

        expect([code, text, typeof translated]).toEqual([code, text, "string"]);

        expect([code, text, translated === text]).toEqual([code, text, false]);

        const placeholders: Array<string> = text.match(/\{\{\w+\}\}/g) || [];

        for (const placeholder of placeholders) {
          expect([
            code,
            text,
            (translated as string).includes(placeholder),
          ]).toEqual([code, text, true]);
        }
      }
    },
  );
});

describe("how a length reads", () => {
  test("in the Dashboard's own words for an hour, a day and a number of either", () => {
    expect(getSessionLengthLabel(1)).toEqual({ label: "1 hour" });
    expect(getSessionLengthLabel(24)).toEqual({ label: "1 day" });
    expect(getSessionLengthLabel(12)).toEqual({
      label: "{{count}} hours",
      labelValues: { count: "12" },
    });
    expect(getSessionLengthLabel(720)).toEqual({
      label: "{{count}} days",
      labelValues: { count: "30" },
    });
  });

  test("in whole days when it is days, in hours when it is not", () => {
    expect(getSessionLengthLabel(48)).toEqual({
      label: "{{count}} days",
      labelValues: { count: "2" },
    });
    expect(getSessionLengthLabel(36)).toEqual({
      label: "{{count}} hours",
      labelValues: { count: "36" },
    });
  });

  test("the card brings no length of its own into the Dashboard's words", () => {
    /*
     * "30 days" and the like are prose in the docs (the SLO and workflow
     * docs say them as words, not as Dashboard labels): a key of en.json
     * named so would make them labels. The card says lengths with the
     * Dashboard's own templates instead.
     */
    const en: Record<string, unknown> = readLocale("en");

    for (const text of [
      "4 hours",
      "8 hours",
      "12 hours",
      "3 days",
      "7 days",
      "14 days",
      "30 days",
    ]) {
      expect([text, text in en]).toEqual([text, false]);
    }
  });

  test("its title is its own, so translating it renames nothing else", () => {
    expect(StatusPageSessionLengthCopy.cardTitle).toBe("Reader Sessions");
  });
});

describe("where it lives", () => {
  const accessPage: string = readSource(
    path.join(
      DASHBOARD_SRC,
      "Pages",
      "StatusPages",
      "View",
      "AuthenticationSettings.tsx",
    ),
  );

  /*
   * A reader session limit is an Enterprise access control few pages use
   * (and means nothing on a page open to anyone), so it waits first in the
   * Access page's More settings, before the IP allowlist.
   */
  test("on the Access page, after who can see the page, first in the folded More settings", () => {
    const access: number = accessPage.indexOf("<StatusPageAccessCard");
    const advanced: number = accessPage.indexOf("<AdvancedPageSection");
    const sessions: number = accessPage.indexOf(
      "<StatusPageSessionLengthSettings",
    );
    const allowlist: number = accessPage.indexOf("<IpAllowlistSettings");

    expect(access).toBeGreaterThan(-1);
    expect(advanced).toBeGreaterThan(access);
    expect(sessions).toBeGreaterThan(advanced);
    expect(allowlist).toBeGreaterThan(sessions);
    expect(accessPage.indexOf("</AdvancedPageSection>")).toBeGreaterThan(
      allowlist,
    );
  });

  test("in one place only", () => {
    const viewDir: string = path.join(DASHBOARD_SRC, "Pages", "StatusPages");
    const files: Array<string> = [];

    const walk: (dir: string) => void = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full: string = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
          files.push(full);
        }
      }
    };

    walk(viewDir);

    const homes: Array<string> = files.filter((file: string): boolean => {
      return readSource(file).includes("<StatusPageSessionLengthSettings");
    });

    expect(
      homes.map((file: string): string => {
        return path.basename(file);
      }),
    ).toEqual(["AuthenticationSettings.tsx"]);
  });
});
