import { readPage } from "./DocsContentSupport";
import { describe, expect, it } from "@jest/globals";
import UserNotificationEmailRollupItem from "Common/Models/DatabaseModels/UserNotificationEmailRollupItem";
import {
  BURST_THRESHOLD,
  BURST_WINDOW_MINUTES,
  CLAIM_EPOCH_MINUTES,
  FLUSH_AFTER_MINUTES,
  MAX_ITEMS_PER_ROLLUP,
  MAX_ROWS_IN_ROLLUP,
  ROLLUP_SUBJECT_MAX_CATEGORIES,
} from "Common/Server/Utils/EmailRollup/EmailRollupConstants";
import {
  RollupEmail,
  buildRollupEmail,
} from "Common/Server/Utils/EmailRollup/EmailRollupRenderer";
import {
  ROLLUP_CATEGORY_LABEL,
  ROLLUP_CATEGORY_ORDER,
  RollupCategory,
} from "Common/Types/NotificationSetting/NotificationEmailRollupCategory";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import { ROUTINE_EMAIL_EVENT_TYPES } from "Common/Types/NotificationSetting/RoutineEmailEvents";
import fs from "fs";
import path from "path";

/*
 * What the English Notification Rollup page says about the product, held to
 * the code that makes it true: when an email is held back and when the
 * rollup goes out, the limits, the subject line it shows as an example, the
 * order and the clock of the email's contents, the preference cards' words,
 * and which emails "Reduce routine emails" turns off. The translations are
 * held to this page by OtelDatabaseCephRollupDocsTranslations.
 */

const PAGE: string = "emails/notification-rollup";
const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relativePath), "utf8");
}

function englishPage(): string {
  return readPage("en", PAGE);
}

const NUMBER_WORDS: Record<number, string> = {
  4: "four",
  5: "five",
  6: "six",
  30: "thirty",
};

const ORDINAL_WORDS: Record<number, string> = {
  5: "fifth",
};

// The rows of the Markdown table whose header row is `header`.
function tableAfter(page: string, header: string): Array<Array<string>> {
  const lines: Array<string> = page.split("\n");
  const start: number = lines.indexOf(header);

  expect({ header, found: start >= 0 }).toEqual({ header, found: true });

  const rows: Array<Array<string>> = [];

  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) {
      break;
    }

    rows.push(
      line
        .slice(1, -1)
        .split("|")
        .map((cell: string): string => {
          return cell.trim();
        }),
    );
  }

  return rows;
}

function item(data: {
  category: RollupCategory;
  index: number;
  createdAt: Date;
}): UserNotificationEmailRollupItem {
  const rollupItem: UserNotificationEmailRollupItem =
    new UserNotificationEmailRollupItem();

  rollupItem.rollupCategory = data.category;
  rollupItem.subject = `${ROLLUP_CATEGORY_LABEL[data.category]} ${data.index}`;
  rollupItem.viewLink = `https://oneuptime.com/${data.category}/${data.index}`;
  rollupItem.createdAt = data.createdAt;

  return rollupItem;
}

describe("the Notification Rollup page's timing", () => {
  it("holds back the email after the first few in a category's window", () => {
    const page: string = englishPage();

    expect(page).toContain(
      `The **first ${NUMBER_WORDS[BURST_THRESHOLD]}** emails in a category within any ${NUMBER_WORDS[BURST_WINDOW_MINUTES]}-minute window are sent immediately`,
    );
    expect(page).toContain(
      `The **${ORDINAL_WORDS[BURST_THRESHOLD + 1]} and every later** email in that window is held back.`,
    );
    expect(page).toContain(
      `Fifth or later in this<br/>category in ${BURST_WINDOW_MINUTES} minutes?`,
    );
    expect(BURST_THRESHOLD + 1).toBe(5);
  });

  it("sends what was held back after the flush delay", () => {
    const page: string = englishPage();

    expect(page).toContain(`"About ${FLUSH_AFTER_MINUTES} minutes later"`);
    expect(page).toContain(
      `About ${NUMBER_WORDS[FLUSH_AFTER_MINUTES]} minutes later, everything held back for you in that project`,
    );
  });

  it("states the limits the flush enforces", () => {
    const limits: Array<Array<string>> = tableAfter(
      englishPage(),
      "| Limit | Value |",
    );

    expect(limits[0]?.[1]).toMatch(
      new RegExp(`^At most \\*\\*${MAX_ITEMS_PER_ROLLUP}\\*\\*\\.`),
    );
    expect(limits[0]?.[1]).toContain(
      `at most ${NUMBER_WORDS[FLUSH_AFTER_MINUTES]} minutes later`,
    );
    expect(limits[1]?.[1]).toMatch(
      new RegExp(`^At most \\*\\*${MAX_ROWS_IN_ROLLUP}\\*\\*\\.`),
    );
    expect(limits[1]?.[1]).toContain(
      `${MAX_ROWS_IN_ROLLUP} distinct resources`,
    );

    // One flush per claim epoch per recipient and project.
    expect(limits[2]?.[1]).toBe(
      `At most **${60 / CLAIM_EPOCH_MINUTES}** an hour.`,
    );
  });

  it("puts the worst added delay at the flush delay plus one sweep", () => {
    // The sweep runs every minute, so a held item waits at most one more.
    expect(
      readSource("App/FeatureSet/Workers/Jobs/EmailRollup/FlushDueRollups.ts"),
    ).toContain("schedule: EVERY_MINUTE");

    const limits: Array<Array<string>> = tableAfter(
      englishPage(),
      "| Limit | Value |",
    );

    expect(limits[3]?.[1]).toBe(
      `About ${NUMBER_WORDS[FLUSH_AFTER_MINUTES + 1]} minutes, at worst.`,
    );
  });
});

describe("the Notification Rollup page's email", () => {
  it("shows a subject line the renderer would build", () => {
    const at: Date = new Date("2026-09-22T12:00:00.000Z");
    const counts: Array<[RollupCategory, number]> = [
      [RollupCategory.Monitors, 63],
      [RollupCategory.Incidents, 41],
      [RollupCategory.Alerts, 6],
      [RollupCategory.Probes, 1],
      [RollupCategory.StatusPages, 1],
    ];

    const items: Array<UserNotificationEmailRollupItem> = counts.flatMap(
      (
        entry: [RollupCategory, number],
      ): Array<UserNotificationEmailRollupItem> => {
        return Array.from(
          { length: entry[1] },
          (_value: unknown, index: number): UserNotificationEmailRollupItem => {
            return item({ category: entry[0], index: index, createdAt: at });
          },
        );
      },
    );

    const email: RollupEmail = buildRollupEmail({
      projectName: "Acme Production",
      projectHomeLink: "https://oneuptime.com/dashboard",
      preferencesLink: "https://oneuptime.com/dashboard/preferences",
      items: items,
    });

    // Three categories are named; the other two are counted.
    expect(ROLLUP_SUBJECT_MAX_CATEGORIES).toBe(3);
    expect(englishPage()).toContain(`\`\`\`text\n${email.subject}\n\`\`\``);
  });

  it("orders the sections incidents, alerts, monitors, probes", () => {
    const positions: Array<number> = [
      RollupCategory.Incidents,
      RollupCategory.Alerts,
      RollupCategory.Monitors,
      RollupCategory.Probes,
    ].map((category: RollupCategory): number => {
      return ROLLUP_CATEGORY_ORDER.indexOf(category);
    });

    expect(
      [...positions].sort((a: number, b: number) => {
        return a - b;
      }),
    ).toEqual(positions);
    expect(englishPage()).toContain(
      "most urgent first — incidents, then alerts, then the monitors and probes that noticed them",
    );
  });

  it("names categories the rollup counts by", () => {
    const labels: Array<string> = Object.values(ROLLUP_CATEGORY_LABEL).map(
      (label: string): string => {
        return label.toLowerCase();
      },
    );

    for (const category of [
      "incidents",
      "alerts",
      "monitors",
      "scheduled maintenance",
      "status pages",
      "probes",
      "slos",
    ]) {
      expect({ category, counted: labels.includes(category) }).toEqual({
        category,
        counted: true,
      });
    }

    expect(englishPage()).toContain(
      "incidents, alerts, monitors, scheduled maintenance, status pages, probes, SLOs, and so on",
    );
  });

  it("shows times in UTC, with the date once a rollup spans two days", () => {
    const window: (dates: Array<string>) => string = (
      dates: Array<string>,
    ): string => {
      return String(
        buildRollupEmail({
          projectName: "Acme",
          projectHomeLink: "https://oneuptime.com/dashboard",
          preferencesLink: "https://oneuptime.com/dashboard/preferences",
          items: dates.map(
            (date: string, index: number): UserNotificationEmailRollupItem => {
              return item({
                category: RollupCategory.Incidents,
                index: index,
                createdAt: new Date(date),
              });
            },
          ),
        }).vars["summaryWindow"],
      );
    };

    expect(
      window(["2026-09-22T12:00:00.000Z", "2026-09-22T12:05:00.000Z"]),
    ).toBe("12:00 UTC to 12:05 UTC");
    expect(
      window(["2026-09-22T23:58:00.000Z", "2026-09-23T00:03:00.000Z"]),
    ).toBe("Sep 22, 23:58 UTC to Sep 23, 00:03 UTC");
    expect(englishPage()).toContain(
      "Times are shown in UTC, with the date as well whenever a rollup spans more than one day.",
    );
  });
});

describe("the Notification Rollup page's preferences", () => {
  const DASHBOARD: string = "App/FeatureSet/Dashboard/src";

  it("quotes the Email Rollup card as it reads when switched off", () => {
    const card: string = readSource(
      `${DASHBOARD}/Components/EmailPreferences/EmailRollupCard.tsx`,
    );
    const off: string =
      "Off: every notification arrives as its own email, immediately.";

    expect(card).toContain('title="Email Rollup"');
    expect(card).toContain(`"${off}"`);
    expect(englishPage()).toContain(`In the **Email Rollup** card`);
    expect(englishPage()).toContain(`the card then reads "${off}"`);
  });

  it("names the Fewer routine emails card, its button and what it says once saved", () => {
    const card: string = readSource(
      `${DASHBOARD}/Components/EmailPreferences/EmailNoiseCard.tsx`,
    );

    expect(card).toContain('title="Fewer routine emails"');
    expect(card).toContain('"Reduce routine emails"');
    expect(card).toContain('"Routine emails turned off."');
    expect(englishPage()).toContain(
      "In the **Fewer routine emails** card, select **Reduce routine emails**. When the change is saved, the card says **Routine emails turned off.**",
    );
  });

  it("describes every email Reduce routine emails turns off", () => {
    /*
     * The page lists five kinds. Every routine event belongs to one of them,
     * so a routine event of a sixth kind fails here until the page says so.
     */
    const KINDS: Array<{ pattern: RegExp; onPage: string }> = [
      {
        pattern: /_NOTE_POSTED_/,
        onPage:
          "- Notes posted on incidents, alerts, episodes, and scheduled maintenance.",
      },
      {
        pattern: /_OWNER_ADDED_/,
        onPage: "- Notices that you were added as a resource owner.",
      },
      {
        pattern: /^SEND_(MONITOR|STATUS_PAGE)_CREATED_/,
        onPage: "- New monitors and status pages.",
      },
      {
        pattern: /_ADDED_TO_EPISODE_/,
        onPage: "- Incidents or alerts added to existing episodes.",
      },
      {
        pattern: /_(ADDED_TO|REMOVED_FROM)_ON_CALL_POLICY$/,
        onPage: "- Being added to or removed from an on-call policy.",
      },
    ];

    const memberOf: (value: NotificationSettingEventType) => string = (
      value: NotificationSettingEventType,
    ): string => {
      const member: string | undefined = Object.keys(
        NotificationSettingEventType,
      ).find((key: string): boolean => {
        return (
          (NotificationSettingEventType as unknown as Record<string, string>)[
            key
          ] === value
        );
      });

      return member || "";
    };

    expect(ROUTINE_EMAIL_EVENT_TYPES.length).toBeGreaterThan(0);

    for (const eventType of ROUTINE_EMAIL_EVENT_TYPES) {
      const member: string = memberOf(eventType);

      expect({
        member,
        described: KINDS.some((kind: { pattern: RegExp }): boolean => {
          return kind.pattern.test(member);
        }),
      }).toEqual({ member, described: true });
    }

    for (const kind of KINDS) {
      expect(englishPage()).toContain(kind.onPage);
      expect({
        kind: kind.onPage,
        routine: ROUTINE_EMAIL_EVENT_TYPES.some(
          (eventType: NotificationSettingEventType): boolean => {
            return kind.pattern.test(memberOf(eventType));
          },
        ),
      }).toEqual({ kind: kind.onPage, routine: true });
    }
  });
});
