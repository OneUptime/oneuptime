import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * AN ALERT IS NOT A NOTIFICATION (#8686).
 *
 * Korean named the Alerts product, its page, its Products-menu entry and
 * 657 other strings 알림, the word Notifications, Notification, Notify and
 * Notice say too, while Alert and 287 strings said 경고, and the docs said
 * both. A reader met two products under one name and one thing under two.
 *
 * - In every Dashboard language, Alerts and Notifications, Alert and
 *   Notification, and the docs' Alerts and Notifications groups read apart.
 * - Korean says an alert 경고: every translated Dashboard and Admin
 *   Dashboard string whose English names an alert, and no notification,
 *   says 경고 and not 알림, and so does every line of the Korean docs whose
 *   English line does. 알림 stays a notification. iOS's own Critical Alerts
 *   is 중요 알림, as the phone draws it, and a push notification 푸시 알림.
 *   A line that names an alert and a notification is the translator's to
 *   word, a word each.
 */

const FEATURE_SET: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "FeatureSet",
);

type Strings = Record<string, unknown>;

const APPS: Array<string> = ["Dashboard", "AdminDashboard"];

/*
 * A language whose Dashboard still says an alert and a notification with one
 * word, each with the issue that words them apart. Remove a language as its
 * issue is fixed: the ratchet below fails once the words differ.
 */
const STILL_ONE_WORD: Record<string, string> = {
  no: "#8719",
};

// English that names a notification, a reminder, a notice or a push, besides any alert.
const NAMES_A_NOTIFICATION: RegExp =
  /notif|notify|notified|remind|notice|announce|critical alert|push/i;
const NAMES_AN_ALERT: RegExp = /\balert/i;

// The Korean words for an alert and a notification.
const ALERT: string = "경고";
const NOTIFICATION: string = "알림";
// Notifications by their own names, which keep 알림.
const KEPT: Array<string> = ["중요 알림", "푸시 알림"];

function readStrings(app: string, language: string): Strings {
  return JSON.parse(
    fs.readFileSync(
      path.join(FEATURE_SET, app, "src", "Locales", `${language}.json`),
      "utf8",
    ),
  ) as Strings;
}

function dashboardLanguages(): Array<string> {
  return fs
    .readdirSync(path.join(FEATURE_SET, "Dashboard", "src", "Locales"))
    .filter((file: string): boolean => {
      return file.endsWith(".json");
    })
    .map((file: string): string => {
      return file.replace(/\.json$/, "");
    })
    .sort();
}

// Every string of a locale, nested keys flattened to their dotted path.
function flatten(strings: Strings, prefix: string = ""): Map<string, string> {
  const flat: Map<string, string> = new Map<string, string>();

  for (const [key, value] of Object.entries(strings)) {
    if (typeof value === "string") {
      flat.set(prefix + key, value);
    } else if (value && typeof value === "object") {
      for (const [inner, text] of flatten(
        value as Strings,
        `${prefix}${key}.`,
      )) {
        flat.set(inner, text);
      }
    }
  }

  return flat;
}

// Whether Korean text says 알림 other than in a notification's own name.
function saysNotification(korean: string): boolean {
  let text: string = korean;

  for (const kept of KEPT) {
    text = text.split(kept).join("");
  }

  return text.includes(NOTIFICATION);
}

// Whether English names an alert and nothing a notification is.
function namesOnlyAnAlert(english: string): boolean {
  return NAMES_AN_ALERT.test(english) && !NAMES_A_NOTIFICATION.test(english);
}

// The translated strings that name only an alert and say it 알림.
function alertsSaidAsNotifications(
  english: Map<string, string>,
  korean: Map<string, string>,
): Array<string> {
  return Array.from(english.entries())
    .filter(([key, text]: [string, string]): boolean => {
      const value: string | undefined = korean.get(key);

      return (
        namesOnlyAnAlert(text) &&
        typeof value === "string" &&
        value !== text &&
        saysNotification(value)
      );
    })
    .map(([key]: [string, string]): string => {
      return key;
    });
}

function docsPages(language: string): Array<string> {
  const root: string = path.join(FEATURE_SET, "Docs", "Content", language);
  const pages: Array<string> = [];
  const walk: (dir: string) => void = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full: string = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".md")) {
        pages.push(path.relative(root, full));
      }
    }
  };

  walk(root);

  return pages.sort();
}

// Prose, with inline code left out: code quotes what it quotes.
function prose(line: string): string {
  return line.replace(/`[^`]*`/g, "");
}

/*
 * "<page>:<line>" for each Korean line that says 알림 where its English line,
 * in the same place, names only an alert.
 */
function docsLinesSayingNotification(
  englishPage: (page: string) => Array<string> | null,
  koreanPage: (page: string) => Array<string>,
  pages: Array<string>,
): Array<string> {
  const found: Array<string> = [];

  for (const page of pages) {
    const english: Array<string> | null = englishPage(page);

    if (!english) {
      continue;
    }

    koreanPage(page).forEach((line: string, index: number) => {
      if (
        namesOnlyAnAlert(english[index] || "") &&
        saysNotification(prose(line))
      ) {
        found.push(`${page}:${index + 1}`);
      }
    });
  }

  return found;
}

function readDocsLines(language: string, page: string): Array<string> | null {
  const file: string = path.join(
    FEATURE_SET,
    "Docs",
    "Content",
    language,
    page,
  );

  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n") : null;
}

describe("an alert is not a notification", () => {
  test("the Dashboard is read in the languages this rule walks", () => {
    expect(dashboardLanguages()).toEqual(
      expect.arrayContaining(["en", "ko", "no", "ja", "de"]),
    );
  });

  test.each(
    dashboardLanguages().filter((language: string) => {
      return language !== "en" && !STILL_ONE_WORD[language];
    }),
  )(
    "%s: the Dashboard says Alerts and Notifications, and Alert and Notification, with different words",
    (language: string) => {
      const strings: Strings = readStrings("Dashboard", language);
      const menu: Record<string, string> = (
        strings["navbar"] as { items: Record<string, string> }
      ).items;

      expect({
        language,
        alerts: strings["Alerts"],
        apart: strings["Alerts"] !== strings["Notifications"],
      }).toEqual({ language, alerts: strings["Alerts"], apart: true });
      expect({
        language,
        alert: strings["Alert"],
        apart: strings["Alert"] !== strings["Notification"],
      }).toEqual({ language, alert: strings["Alert"], apart: true });
      // The Products menu opens the Alerts page under the page's own title.
      expect(menu["alertsTitle"]).toBe(strings["Alerts"]);
      expect(menu["alertsTitle"]).not.toBe(strings["Notifications"]);
    },
  );

  test.each(Object.keys(STILL_ONE_WORD))(
    "%s still says an alert and a notification with one word, until its issue is fixed (ratchet)",
    (language: string) => {
      const strings: Strings = readStrings("Dashboard", language);

      expect({
        language,
        issue: STILL_ONE_WORD[language],
        same: strings["Alerts"] === strings["Notifications"],
      }).toEqual({ language, issue: STILL_ONE_WORD[language], same: true });
    },
  );

  test.each(
    SUPPORTED_DOCS_LANGUAGE_CODES.filter((language: string) => {
      return language !== "en";
    }),
  )(
    "%s: the docs' Alerts and Notifications groups read apart",
    (language: string) => {
      const groups: Record<string, string> = (
        JSON.parse(
          fs.readFileSync(
            path.join(FEATURE_SET, "Docs", "Locales", `${language}.json`),
            "utf8",
          ),
        ) as { navGroups: Record<string, string> }
      ).navGroups;

      expect(groups["Alerts"]).toBeDefined();
      expect(groups["Alerts"]).not.toBe(groups["Notifications"]);
    },
  );
});

describe("Korean says an alert 경고", () => {
  test("the Alerts product reads 경고 on its page, in the Products menu, in the command palette and in the docs' menu", () => {
    const strings: Strings = readStrings("Dashboard", "ko");
    const groups: Record<string, string> = (
      JSON.parse(
        fs.readFileSync(
          path.join(FEATURE_SET, "Docs", "Locales", "ko.json"),
          "utf8",
        ),
      ) as { navGroups: Record<string, string> }
    ).navGroups;

    expect(strings["Alerts"]).toBe(ALERT);
    expect(strings["Alert"]).toBe(ALERT);
    expect(strings["alerts"]).toBe(ALERT);
    expect(
      (strings["navbar"] as { items: Record<string, string> }).items[
        "alertsTitle"
      ],
    ).toBe(ALERT);
    expect(
      (strings["commandPalette"] as { sections: Record<string, string> })
        .sections["alerts"],
    ).toBe(ALERT);
    expect(groups["Alerts"]).toBe(ALERT);
    // And a notification stays 알림.
    expect(strings["Notifications"]).toBe(NOTIFICATION);
    expect(groups["Notifications"]).toBe(NOTIFICATION);
  });

  test.each(APPS)(
    "every translated %s string that names only an alert says 경고, not 알림",
    (app: string) => {
      expect(
        alertsSaidAsNotifications(
          flatten(readStrings(app, "en")),
          flatten(readStrings(app, "ko")),
        ),
      ).toEqual([]);
    },
  );

  test("the rule reads real strings: hundreds of Korean strings name an alert", () => {
    const english: Map<string, string> = flatten(
      readStrings("Dashboard", "en"),
    );
    const korean: Map<string, string> = flatten(readStrings("Dashboard", "ko"));
    const naming: Array<string> = Array.from(english.entries())
      .filter(([key, text]: [string, string]): boolean => {
        return (
          namesOnlyAnAlert(text) &&
          typeof korean.get(key) === "string" &&
          korean.get(key) !== text
        );
      })
      .map(([key]: [string, string]): string => {
        return key;
      });

    expect(naming.length).toBeGreaterThan(500);
    expect(
      naming.filter((key: string): boolean => {
        return korean.get(key)!.includes(ALERT);
      }).length,
    ).toBeGreaterThan(500);
  });

  test("a string that names an alert and a notification keeps a word each", () => {
    const korean: Strings = readStrings("Dashboard", "ko");

    expect(korean["Alerts & Notifications"]).toBe("경고 및 알림");
    expect(korean["Alert Notification Rules"]).toBe("경고 알림 규칙");
    expect(
      korean[
        "Every member gets a push notification when your most severe alerts page them."
      ],
    ).toBe("가장 심각한 경고가 호출하면 각 구성원이 푸시 알림을 받습니다.");
  });

  test("iOS's Critical Alerts keeps the phone's own name, 중요 알림", () => {
    const korean: Strings = readStrings("Dashboard", "ko");

    expect(korean["Critical Alerts"]).toBe("중요 알림");
    expect(korean["Turn on critical alerts"]).toBe("중요 알림 켜기");
  });

  // Korean's other 경고 is a warning: a string that names both says which is which.
  test("no Korean string says 경고 twice in a row", () => {
    const doubled: Array<string> = [];

    for (const app of APPS) {
      for (const [key, value] of flatten(readStrings(app, "ko"))) {
        if (value.includes(`${ALERT} ${ALERT}`)) {
          doubled.push(`${app} ${key}`);
        }
      }
    }

    expect(doubled).toEqual([]);
    expect(readStrings("Dashboard", "ko")["Turn on warning alerts"]).toBe(
      "Warning 이벤트 경고 켜기",
    );
  });

  test("every Korean docs line whose English names only an alert says 경고, not 알림", () => {
    expect(
      docsLinesSayingNotification(
        (page: string) => {
          return readDocsLines("en", page);
        },
        (page: string) => {
          return readDocsLines("ko", page)!;
        },
        docsPages("ko"),
      ),
    ).toEqual([]);
  });

  test("the docs rule reads real pages: Korean names an alert 경고 on hundreds of lines", () => {
    let lines: number = 0;

    for (const page of docsPages("ko")) {
      const english: Array<string> | null = readDocsLines("en", page);
      const korean: Array<string> = readDocsLines("ko", page)!;

      if (!english) {
        continue;
      }

      lines += korean.filter((line: string, index: number): boolean => {
        return namesOnlyAnAlert(english[index] || "") && line.includes(ALERT);
      }).length;
    }

    expect(lines).toBeGreaterThan(1000);
  });

  // What the checks above would see if a string or a line went back to 알림.
  test("an alert said 알림 is found, and a notification is not (negative control)", () => {
    const english: Map<string, string> = new Map<string, string>([
      ["Active Alerts", "Active Alerts"],
      ["Notifications", "Notifications"],
      ["Alert Notification Rules", "Alert Notification Rules"],
      ["Critical alert", "Critical alert"],
      ["Rings like a standard push", "Rings like a standard push"],
      ["Untranslated alert", "Untranslated alert"],
    ]);
    const korean: Map<string, string> = new Map<string, string>([
      ["Active Alerts", "활성 알림"],
      ["Notifications", "알림"],
      ["Alert Notification Rules", "경고 알림 규칙"],
      ["Critical alert", "중요 알림"],
      ["Rings like a standard push", "일반 푸시 알림처럼 울립니다"],
      // A string still in English is the i18n ratchet's, not this rule's.
      ["Untranslated alert", "Untranslated alert"],
    ]);

    expect(alertsSaidAsNotifications(english, korean)).toEqual([
      "Active Alerts",
    ]);

    expect(
      docsLinesSayingNotification(
        () => {
          return [
            "Open **Alerts** to see them.",
            "Notifications go out by email.",
            "Use `alert` in the query.",
          ];
        },
        () => {
          return [
            "**알림**을 열어 확인하세요.",
            "알림은 이메일로 나갑니다.",
            "쿼리에 `알림`을 사용하세요.",
          ];
        },
        ["planted.md"],
      ),
    ).toEqual(["planted.md:1"]);
  });
});
