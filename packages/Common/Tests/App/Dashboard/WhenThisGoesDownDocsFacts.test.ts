import {
  OWNER_FIX_WORDS,
  getFixWords,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/WhoIsToldWords";
import {
  WhoIsToldBreakKind,
  WhoIsToldFix,
} from "../../../Types/Monitor/WhoIsTold";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * "WHO IS TOLD WHEN IT GOES DOWN" (#7215): the docs' section on the When
 * this goes down card, held to the card.
 *
 *   - its table of what stops people being told names every break the card
 *     can show (WhoIsToldBreakKind) and nothing else, each with the words
 *     of the link the card draws for its fix (WhoIsToldFix);
 *   - the owners who aren't emailed are said with every page the card
 *     links them to;
 *   - Show the chain's rows are the card's rows;
 *   - the places it says the card is are the places the Dashboard draws it.
 *
 * Drop a break from the docs, or add one to the card, and this fails.
 */

const APP: string = path.resolve(__dirname, "../../../../App/FeatureSet");
const DASHBOARD_SRC: string = path.join(APP, "Dashboard/src");
const CRITERIA_AND_STATUSES: string = path.join(
  APP,
  "Docs/Content/en/monitor/criteria-and-statuses.md",
);

function readDashboard(...segments: Array<string>): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, ...segments), "utf8");
}

const SECTION_START: string = "## Who is told when it goes down";
const BREAKS_HEADING: string = "### What stops people being told";
const RECHECK_HEADING: string = "### Recheck, and what you can see";

// The English section, from its heading to the next section's.
function section(): string {
  const page: string = fs.readFileSync(CRITERIA_AND_STATUSES, "utf8");
  const start: number = page.indexOf(SECTION_START);
  const end: number = page.indexOf("\n## ", start + SECTION_START.length);

  expect(start).toBeGreaterThan(-1);

  return page.slice(start, end === -1 ? undefined : end);
}

// A table's rows under a heading of the section: their cells, header left out.
function tableRows(markdown: string): Array<Array<string>> {
  return markdown
    .split("\n")
    .filter((line: string): boolean => {
      return line.startsWith("| ") && !line.startsWith("| ---");
    })
    .slice(1)
    .map((line: string): Array<string> => {
      return line
        .slice(2, -2)
        .split(" | ")
        .map((cell: string): string => {
          return cell.trim();
        });
    });
}

function between(text: string, from: string, to: string): string {
  const start: number = text.indexOf(from);
  const end: number = text.indexOf(to, start + from.length);

  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  return text.slice(start, end);
}

// The bold words of a text, in order.
function boldWords(text: string): Array<string> {
  return Array.from(text.matchAll(/\*\*([^*]+)\*\*/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

/*
 * Each break the card can show, the row of the docs' table that says it,
 * and the fixes its link can be (getWhoIsToldBreaks).
 */
const DOCUMENTED: Readonly<
  Record<WhoIsToldBreakKind, { row: string; fixes: Array<WhoIsToldFix> }>
> = {
  [WhoIsToldBreakKind.NothingHappens]: {
    row: "No criteria changes the status or opens an incident or alert.",
    fixes: [WhoIsToldFix.MonitorCriteria],
  },
  [WhoIsToldBreakKind.NobodyPaged]: {
    row: "Nobody is paged: no on-call rule matches, or the project has no on-call policy yet.",
    fixes: [
      WhoIsToldFix.IncidentOnCallRules,
      WhoIsToldFix.AlertOnCallRules,
      WhoIsToldFix.OnCallGuidedSetup,
    ],
  },
  [WhoIsToldBreakKind.OnlyIncidentsHaveRules]: {
    row: "The monitor opens alerts, and only incidents have on-call rules.",
    fixes: [WhoIsToldFix.AlertOnCallRules],
  },
  [WhoIsToldBreakKind.PolicyHasNoLevels]: {
    row: "An on-call policy has no escalation rules.",
    fixes: [WhoIsToldFix.OnCallPolicy],
  },
  [WhoIsToldBreakKind.PolicyReachesNobody]: {
    row: "An on-call policy reaches nobody right now.",
    fixes: [WhoIsToldFix.OnCallPolicy],
  },
  [WhoIsToldBreakKind.PersonUnreachable]: {
    row: "Someone a policy pages can't be reached: they opted out, have no verified method, or have no rule for the severity in a project that doesn't fall back.",
    fixes: [WhoIsToldFix.OnCallReadiness],
  },
  [WhoIsToldBreakKind.ChannelOff]: {
    row: "SMS, calls, WhatsApp or Telegram are off in the project.",
    fixes: [WhoIsToldFix.ProjectNotificationSettings],
  },
  [WhoIsToldBreakKind.NoBalance]: {
    row: "The project has no balance left for SMS and calls (OneUptime Cloud).",
    fixes: [WhoIsToldFix.ProjectBilling],
  },
  [WhoIsToldBreakKind.ServerCannotSend]: {
    row: "The server can't send email, SMS or calls yet.",
    fixes: [WhoIsToldFix.ServerSettings],
  },
};

describe("the docs' breaks are the card's", () => {
  const rows: Array<Array<string>> = tableRows(
    between(section(), BREAKS_HEADING, "\n\n" + "An alert that"),
  );

  test("every break the card can show is a row, and no row is anything else", () => {
    expect(Object.keys(DOCUMENTED).sort()).toEqual(
      Object.values(WhoIsToldBreakKind).sort(),
    );
    expect(
      rows.map((row: Array<string>): string => {
        return row[0]!;
      }),
    ).toEqual(
      Object.values(DOCUMENTED).map(
        (entry: { row: string; fixes: Array<WhoIsToldFix> }): string => {
          return entry.row;
        },
      ),
    );
  });

  test("each row names the link the card draws for its fix", () => {
    for (const [kind, entry] of Object.entries(DOCUMENTED)) {
      const row: Array<string> | undefined = rows.find(
        (cells: Array<string>): boolean => {
          return cells[0] === entry.row;
        },
      );

      expect([kind, Boolean(row)]).toEqual([kind, true]);

      for (const fix of entry.fixes) {
        expect([kind, boldWords(row![1]!)]).toEqual([kind, [getFixWords(fix)]]);
      }
    }
  });

  test("every fix the card links is named by some row", () => {
    const named: Set<WhoIsToldFix> = new Set<WhoIsToldFix>(
      Object.values(DOCUMENTED).flatMap(
        (entry: {
          row: string;
          fixes: Array<WhoIsToldFix>;
        }): Array<WhoIsToldFix> => {
          return entry.fixes;
        },
      ),
    );

    expect(Array.from(named).sort()).toEqual(
      Object.values(WhoIsToldFix).sort(),
    );
  });
});

describe("the docs' owners who aren't emailed are the card's", () => {
  test("every page the card links an owner who isn't emailed to is named", () => {
    const paragraph: string = between(
      section(),
      "Owners who aren't emailed",
      RECHECK_HEADING,
    );

    expect(boldWords(paragraph).sort()).toEqual(
      Object.values(OWNER_FIX_WORDS).sort(),
    );
  });
});

describe("Show the chain's rows are the card's", () => {
  test("each row the docs name is one the card draws, and the card draws no other", () => {
    const card: string = readDashboard(
      "Components",
      "Monitor",
      "Overview",
      "MonitorWhoIsToldCard.tsx",
    );
    const drawn: Set<string> = new Set<string>(
      Array.from(
        // A row's label - not an aria-label.
        card.matchAll(
          /(?<![\w-])label=\{\s*translator\.translateText\("([^"]+)"\)/g,
        ),
      ).map((match: RegExpMatchArray): string => {
        return match[1]!;
      }),
    );

    // The policy row's name is a defined term, drawn apart.
    expect(card).toContain('translator.translateText("On-call policy")');
    drawn.add("On-call policy");

    const documented: Array<string> = tableRows(
      between(section(), "| Row | What it says |", BREAKS_HEADING),
    ).map((row: Array<string>): string => {
      return boldWords(row[0]!)[0]!;
    });

    expect(documented.sort()).toEqual(Array.from(drawn).sort());
  });
});

/*
 * AN ALERT OWNER RULE (#9407): the card matches an alert's on-call rules on
 * the owners the alert will have, and says under On-call rules which owner
 * made one match; the docs say both, and that Setup health lists the owners
 * who aren't emailed (#9371).
 */
describe("the docs say what the card says of an alert's owners", () => {
  test("Alert Owner rules are matched on the owners the alert will have, and the row says which owner made one match", () => {
    const text: string = section();
    const card: string = readDashboard(
      "Components",
      "Monitor",
      "Overview",
      "MonitorWhoIsToldCard.tsx",
    );

    expect(text).toContain(
      "An alert's on-call rule that asks who owns it (**Alert Owner**) is matched on the owners the alert will have: the people and teams its criteria names, the owners of the network device the monitor watches, and whom owner rules add.",
    );
    expect(text).toContain(
      "| **On-call rules** | The on-call rules that match it. A rule that matches who owns an alert says which owner made it match. |",
    );
    // The card draws that line under the On-call rules row.
    expect(card).toContain('dataTestId="who-is-told-owner-match"');
    expect(
      card.indexOf('dataTestId="who-is-told-owner-match"'),
    ).toBeGreaterThan(card.indexOf('testId="who-is-told-rules"'));
  });

  test("the owners who aren't emailed are listed by Setup Health too", () => {
    expect(
      between(section(), "Owners who aren't emailed", RECHECK_HEADING),
    ).toContain("Setup Health lists them too, as worth fixing.");
  });
});

describe("the places the docs say the card is", () => {
  test("a monitor's Overview and Criteria page, Create Monitor's criteria and the website guided setup", () => {
    const text: string = section();

    expect(text).toContain("on a monitor's **Overview**");
    expect(text).toContain("on its **Criteria** page");
    expect(text).toContain("on the criteria step of **Create Monitor**");
    expect(text).toContain("in the website guided setup");

    expect(readDashboard("Pages", "Monitor", "View", "Index.tsx")).toContain(
      "<MonitorWhoIsToldCard",
    );
    expect(readDashboard("Pages", "Monitor", "View", "Criteria.tsx")).toContain(
      "<MonitorWhoIsToldCard",
    );
    expect(readDashboard("Pages", "Monitor", "Create.tsx")).toContain(
      "<MonitorDraftWhoIsTold",
    );
    expect(
      readDashboard(
        "Components",
        "GuidedSetup",
        "WebsiteDown",
        "WebsiteDownGuidedSetup.tsx",
      ),
    ).toContain("<MonitorWhoIsToldCard");
  });
});
