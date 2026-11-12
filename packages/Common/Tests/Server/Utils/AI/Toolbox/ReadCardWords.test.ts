import { describe, expect, test } from "@jest/globals";
import {
  getEmptyRunbookCardWords,
  getEmptyTeamCardWords,
  getMonitorCardWords,
  getMonitorTypeTitle,
  getOnCallPolicyCardWords,
  getOnCallScheduleCardWords,
  getSecurityCaseCardWords,
  getSloCardWords,
  getStatusPageCardWords,
  getUnrunWorkflowCardWords,
  SloCardData,
} from "../../../../../Server/Utils/AI/Toolbox/ReadCardWords";
import WidgetBuilder from "../../../../../Server/Utils/AI/Toolbox/WidgetBuilder";
import {
  AI_ACTION_CARD_KINDS,
  AI_READ_CARD_FACTS,
  AI_READ_CARD_KINDS,
  AI_READ_CARD_LINES,
  AI_READ_CARD_VALUES,
  AIActionCardWords,
  aiActionCardFact,
  aiActionSentence,
  aiActionTerm,
  describeAIActionCardWords,
  getAIReadCardMonitorTypeTerms,
  isKnownAIActionCardWords,
} from "../../../../../Types/AI/AIActionWords";
import { AIChatWidget } from "../../../../../Types/AI/AIChatTypes";
import MonitorType from "../../../../../Types/Monitor/MonitorType";
import { SecurityEntityType } from "../../../../../Types/SecurityCase/SecurityEntity";
import SliType from "../../../../../Types/ServiceLevelObjective/SliType";
import SloStatus from "../../../../../Types/ServiceLevelObjective/SloStatus";
import SloWindowType from "../../../../../Types/ServiceLevelObjective/SloWindowType";
import { Translator } from "../../../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  readDashboardLocale,
} from "../../../../Helpers/DashboardLocales";
import {
  getReadCardKeys,
  getReadCardWordsNotWorded,
} from "../../../../Helpers/ReadCardWords";

/*
 * THE CARD A READ LEAVES, AS WORDS (issue #7175).
 *
 * A read tool's card - a monitor, an SLO, a team, an on-call policy or
 * schedule, a status page, a runbook, a workflow, a security case - said
 * "MONITOR", "Type: Website", "Last status", "Off - not checked" and
 * "Disabled" in English on a German or Persian page. Toolbox/ReadCardWords
 * builds each card's words now: OneUptime's own words as terms and
 * sentences the Dashboard says in the reader's language, figures the
 * reader's way, and the data as written - a monitor's name, a status name
 * the project chose, a URL. Here each card's words are pinned in English
 * - what the exports print, as the card said it before where it can - and
 * in German and Persian, where none of OneUptime's own words is left in
 * English.
 */

const NO_BREAK_SPACE: string = String.fromCharCode(0x00a0);

type English = {
  kind: string;
  line?: string | undefined;
  facts: Array<{ label: string; value: string }>;
};

function english(words: AIActionCardWords): English {
  return describeAIActionCardWords(words);
}

function inLanguage(words: AIActionCardWords, language: string): English {
  return describeAIActionCardWords(words, dashboardTranslator(language));
}

// The word a language gives an English key.
function word(key: string, language: string): string {
  return readDashboardLocale(language)[key] as string;
}

// Every card a read tool leaves, each kind and each branch of it once.
function everyCard(): Array<[string, AIActionCardWords]> {
  return [
    [
      "a monitor, Offline",
      getMonitorCardWords({
        monitorType: MonitorType.Website,
        statusName: "Offline",
        isMonitoringOff: false,
        isArchived: false,
        ownerTeamNames: "SRE",
        ownerUserNames: "Ana",
      }),
    ],
    [
      "a monitor whose monitoring is off, archived",
      getMonitorCardWords({
        monitorType: MonitorType.Docker,
        statusName: "Operational",
        isMonitoringOff: true,
        isArchived: true,
      }),
    ],
    ["an SLO", getSloCardWords(sloData())],
    [
      "an SLO whose rules cannot be read",
      getSloCardWords(
        sloData({
          monitorRules: { isVisible: false, count: 0, enabledCount: 0 },
          burnRateRules: { isVisible: false, count: 0 },
          policyTiers: { isVisible: false, count: 0 },
          windowType: SloWindowType.CalendarMonth,
          sliType: SliType.Metric,
          deploymentsAllowed: false,
          isEnabled: false,
        }),
      ),
    ],
    [
      "an SLO not evaluated yet",
      getSloCardWords(
        sloData({
          currentSliPercentage: null,
          errorBudgetRemainingPercentage: null,
          currentBurnRate: null,
          monitorRules: { isVisible: true, count: 0, enabledCount: 0 },
          policyTiers: { isVisible: true, count: 2 },
          isArchived: true,
        }),
      ),
    ],
    ["a team with no members", getEmptyTeamCardWords({})],
    [
      "an on-call policy",
      getOnCallPolicyCardWords({
        description: "Pages the platform team.",
        isArchived: true,
        rules: [
          {
            order: 1,
            name: "",
            users: ["Ana"],
            teams: ["SRE"],
            schedules: ["Primary"],
            escalateAfterInMinutes: 5,
          },
          {
            order: 2,
            name: "Database team",
            users: [],
            teams: ["DBA"],
            schedules: [],
            escalateAfterInMinutes: 1,
          },
          {
            order: 3,
            name: "",
            users: [],
            teams: [],
            schedules: [],
            escalateAfterInMinutes: 10,
          },
          {
            order: 4,
            name: "",
            users: [],
            teams: [],
            schedules: [],
          },
          { order: 5, users: ["Bo"], teams: [], schedules: [] },
        ],
      }),
    ],
    [
      "an on-call policy with no rules",
      getOnCallPolicyCardWords({ isArchived: false, rules: [] }),
    ],
    [
      "an on-call schedule",
      getOnCallScheduleCardWords({
        onCallNow: "Ana",
        rosterStartAt: new Date("2026-11-12T08:00:00.000Z"),
        rosterHandoffAt: new Date("2026-11-13T08:00:00.000Z"),
        nextUp: "Bo",
        rosterNextStartAt: new Date("2026-11-13T08:00:00.000Z"),
      }),
    ],
    ["an on-call schedule no one is on", getOnCallScheduleCardWords({})],
    ["a status page", getStatusPageCardWords(statusPageData())],
    [
      "a private, archived status page with nothing on it",
      getStatusPageCardWords({
        isPublic: false,
        isArchived: true,
        resourceCount: 0,
        resources: [],
        activeSubscribers: 0,
      }),
    ],
    ["a runbook with no steps", getEmptyRunbookCardWords({ isEnabled: false })],
    [
      "a workflow with no runs",
      getUnrunWorkflowCardWords({
        description: "Posts to Slack.",
        isEnabled: false,
        isArchived: true,
      }),
    ],
    ["a security case", getSecurityCaseCardWords(securityCaseData())],
  ];
}

function sloData(overrides?: Partial<SloCardData>): SloCardData {
  return {
    description: "Checkout stays up.",
    targetPercentage: 99.95,
    windowType: SloWindowType.Rolling,
    windowDays: 30,
    sliType: SliType.MonitorUptime,
    isArchived: false,
    isEnabled: true,
    sloStatus: SloStatus.AtRisk,
    currentSliPercentage: 99.9123,
    errorBudgetRemainingPercentage: 42.5,
    currentBurnRate: 1.2345,
    monitorNames: "Checkout API, Payments",
    monitorRules: { isVisible: true, count: 2, enabledCount: 1 },
    burnRateRules: { isVisible: true, count: 3 },
    policyTiers: { isVisible: true, count: 2, currentName: "Freeze" },
    deploymentsAllowed: true,
    ...overrides,
  };
}

function statusPageData(): Parameters<typeof getStatusPageCardWords>[0] {
  return {
    description: "What our customers see.",
    isPublic: true,
    isArchived: false,
    publicUrl: "https://status.example.com",
    resourceCount: 4,
    resources: [
      {
        name: "Checkout",
        source: { name: "checkout-api", isMonitorGroup: false },
        isNotMonitored: false,
      },
      {
        name: "Payments",
        source: { name: "Payments group", isMonitorGroup: true },
        isNotMonitored: false,
      },
      { name: "Search", isNotMonitored: true },
    ],
    activeSubscribers: 1234,
  };
}

function securityCaseData(): Parameters<typeof getSecurityCaseCardWords>[0] {
  return {
    statusName: "Investigating",
    priorityName: "P1",
    detectionCount: 3,
    entities: [
      { type: SecurityEntityType.IpAddress, value: "10.0.0.7" },
      { type: SecurityEntityType.User, value: "alice" },
      { type: "Planet", value: "Mars" },
      { type: SecurityEntityType.Host, value: "" },
    ],
  };
}

describe("every read's card", () => {
  test.each(everyCard())(
    "%s: words the Dashboard trusts as a read's, every one worded in every language",
    (_name: string, words: AIActionCardWords) => {
      expect(isKnownAIActionCardWords(words, { isRead: true })).toBe(true);
      expect(getReadCardWordsNotWorded(words)).toEqual([]);
      // It names its kind and more of OneUptime's words: there are words to check.
      const keys: { terms: Array<string>; templates: Array<string> } =
        getReadCardKeys(words);
      expect(keys.terms.length).toBeGreaterThanOrEqual(1);
      expect(keys.terms.length + keys.templates.length).toBeGreaterThan(1);
    },
  );

  test.each(everyCard())(
    "%s: survives being saved, as a conversation stores it",
    (_name: string, words: AIActionCardWords) => {
      const saved: unknown = JSON.parse(JSON.stringify(words));

      expect(isKnownAIActionCardWords(saved, { isRead: true })).toBe(true);
      expect(describeAIActionCardWords(saved as AIActionCardWords)).toEqual(
        english(words),
      );
    },
  );

  test("there are languages to check them in", () => {
    expect(DASHBOARD_LANGUAGES.length).toBeGreaterThanOrEqual(17);
    expect(DASHBOARD_LANGUAGES).toEqual(
      expect.arrayContaining(["de", "fa", "ar", "ja", "zh-TW"]),
    );
  });
});

describe("a monitor's card", () => {
  test("its type by the type picker's name, its status as the project named it, its owners", () => {
    const words: AIActionCardWords = getMonitorCardWords({
      monitorType: MonitorType.Docker,
      statusName: "Offline",
      isMonitoringOff: false,
      isArchived: false,
      ownerTeamNames: "SRE, DBA",
      ownerUserNames: "Ana",
    });

    expect(english(words)).toEqual({
      kind: "Monitor",
      line: "Offline",
      facts: [
        { label: "Type", value: "Docker Container" },
        { label: "Status", value: "Offline" },
        { label: "Owner teams", value: "SRE, DBA" },
        { label: "Owner users", value: "Ana" },
      ],
    });
    // The status is data: a name the project chose, in every language.
    expect(words.line).toEqual(["Offline"]);
    expect(words.facts![0]).toEqual(
      aiActionCardFact(
        AI_READ_CARD_FACTS.type,
        aiActionTerm("Docker Container"),
      ),
    );
  });

  test("monitoring off: Disabled under its name, its last status said as the last one, and Off - not checked", () => {
    const words: AIActionCardWords = getMonitorCardWords({
      monitorType: MonitorType.Website,
      statusName: "Operational",
      isMonitoringOff: true,
      isArchived: false,
    });

    expect(english(words)).toEqual({
      kind: "Monitor",
      line: "Disabled",
      facts: [
        { label: "Type", value: "Website" },
        { label: "Last status", value: "Operational" },
        { label: "Monitoring", value: "Off - not checked" },
      ],
    });
    expect(words.line).toEqual([aiActionSentence(AI_READ_CARD_LINES.disabled)]);
  });

  test("archived: Yes - not monitored", () => {
    expect(
      english(
        getMonitorCardWords({
          monitorType: MonitorType.Ping,
          isMonitoringOff: false,
          isArchived: true,
        }),
      ),
    ).toEqual({
      kind: "Monitor",
      facts: [
        { label: "Type", value: "Ping" },
        { label: "Archived", value: "Yes - not monitored" },
      ],
    });
  });

  test("no status, no line; a type this version does not list is said as stored", () => {
    const words: AIActionCardWords = getMonitorCardWords({
      monitorType: "Teleport",
      isMonitoringOff: false,
      isArchived: false,
    });

    expect(words.line).toBeUndefined();
    expect(words.facts).toEqual([
      aiActionCardFact(AI_READ_CARD_FACTS.type, "Teleport"),
    ]);
    expect(getMonitorTypeTitle("Teleport")).toBeNull();
    expect(getMonitorTypeTitle(undefined)).toBeNull();
    expect(
      getMonitorCardWords({ isMonitoringOff: false, isArchived: false }),
    ).toEqual({ kind: aiActionTerm("Monitor"), facts: [] });
  });

  test("every monitor type's name is a word the card may hold", () => {
    for (const type of Object.values(MonitorType)) {
      const title: string | null = getMonitorTypeTitle(type);

      if (title) {
        expect(getAIReadCardMonitorTypeTerms()).toContain(title);
      }
    }

    expect(getAIReadCardMonitorTypeTerms()).toContain("Docker Container");
  });

  test("in German and Persian: none of OneUptime's words in English, the status as the project named it", () => {
    const words: AIActionCardWords = getMonitorCardWords({
      monitorType: MonitorType.Website,
      statusName: "Offline",
      isMonitoringOff: true,
      isArchived: true,
    });

    for (const language of ["de", "fa", "ar"]) {
      const drawn: English = inLanguage(words, language);

      expect(drawn.kind).toBe(word("Monitor", language));
      expect(drawn.line).toBe(word("Disabled", language));
      expect(drawn.facts).toEqual([
        { label: word("Type", language), value: word("Website", language) },
        { label: word("Last status", language), value: "Offline" },
        {
          label: word("Archived", language),
          value: word("Yes - not monitored", language),
        },
        {
          label: word("Monitoring", language),
          value: word("Off - not checked", language),
        },
      ]);

      const text: string = JSON.stringify(drawn);
      for (const englishWord of [
        "Last status",
        "Off - not checked",
        "Yes - not monitored",
        "Disabled",
      ]) {
        expect({ language, text }).toEqual({
          language,
          text: expect.not.stringContaining(englishWord),
        });
      }
    }

    expect(inLanguage(words, "de").facts[3]!.value).toBe(
      "Aus - wird nicht geprüft",
    );
  });
});

describe("an SLO's card", () => {
  test("in English, as the card said it: figures to two decimals, the window, the rules", () => {
    expect(english(getSloCardWords(sloData()))).toEqual({
      kind: "SLO",
      line: "Checkout stays up.",
      facts: [
        { label: "Target", value: "99.95%" },
        { label: "Window", value: "Rolling 30-day window" },
        { label: "SLI type", value: "Monitor uptime" },
        { label: "Status", value: "At Risk" },
        { label: "Current SLI", value: "99.91%" },
        { label: "Error budget left", value: "42.5%" },
        { label: "Burn rate", value: "1.23" },
        { label: "Monitors", value: "Checkout API, Payments" },
        { label: "Monitor rules", value: "1 of 2 enabled" },
        { label: "Burn-rate rules", value: "3" },
        { label: "Error budget policy tier", value: "Freeze" },
        { label: "Deployments", value: "Allowed" },
      ],
    });
  });

  test("its figures are stored rounded to two decimals, as the card always said them", () => {
    const facts: AIActionCardWords["facts"] = getSloCardWords(sloData()).facts!;
    const valueOf: (label: string) => unknown = (label: string): unknown => {
      return facts.find((fact: { label: unknown }): boolean => {
        return (fact.label as { term?: string }).term === label;
      })?.value;
    };

    expect(valueOf(AI_READ_CARD_FACTS.target)).toEqual({
      figure: 99.95,
      isPercent: true,
    });
    expect(valueOf(AI_READ_CARD_FACTS.currentSli)).toEqual({
      figure: 99.91,
      isPercent: true,
    });
    expect(valueOf(AI_READ_CARD_FACTS.burnRate)).toEqual({ figure: 1.23 });
    expect(valueOf(AI_READ_CARD_FACTS.burnRateRules)).toEqual({ figure: 3 });
  });

  test("its status as the SLO list says it: Archived, then Disabled, then the one it holds", () => {
    const statusOf: (data: Partial<SloCardData>) => string | undefined = (
      data: Partial<SloCardData>,
    ): string | undefined => {
      return english(getSloCardWords(sloData(data))).facts.find(
        (fact: { label: string }): boolean => {
          return fact.label === "Status";
        },
      )?.value;
    };

    expect(statusOf({ isArchived: true, isEnabled: false })).toBe("Archived");
    expect(statusOf({ isEnabled: false })).toBe("Disabled");
    expect(statusOf({ sloStatus: SloStatus.BudgetExhausted })).toBe(
      "Budget Exhausted",
    );
    // A status this version does not know is said as stored.
    expect(statusOf({ sloStatus: "Wobbly" })).toBe("Wobbly");
    // Not evaluated yet: no status to say.
    expect(statusOf({ sloStatus: null })).toBeUndefined();
  });

  test("what cannot be read says so, never none or 0; nothing evaluated yet says so", () => {
    const facts: English["facts"] = english(
      getSloCardWords(
        sloData({
          monitorRules: { isVisible: false, count: 0, enabledCount: 0 },
          burnRateRules: { isVisible: false, count: 0 },
          policyTiers: { isVisible: false, count: 0 },
          currentSliPercentage: undefined,
          errorBudgetRemainingPercentage: null,
          currentBurnRate: Number.NaN,
          targetPercentage: null,
          monitorNames: "",
          windowType: SloWindowType.CalendarMonth,
          sliType: SliType.Metric,
          deploymentsAllowed: false,
        }),
      ),
    ).facts;

    expect(facts).toEqual([
      { label: "Target", value: "Not evaluated yet" },
      { label: "Window", value: "Calendar Month" },
      { label: "SLI type", value: "Metric" },
      { label: "Status", value: "At Risk" },
      { label: "Current SLI", value: "Not evaluated yet" },
      { label: "Error budget left", value: "Not evaluated yet" },
      { label: "Burn rate", value: "Not evaluated yet" },
      { label: "Monitors", value: "None" },
      { label: "Monitor rules", value: "Not visible to you" },
      { label: "Burn-rate rules", value: "Not visible to you" },
      { label: "Error budget policy tier", value: "Not visible to you" },
      { label: "Deployments", value: "Frozen by the error budget policy" },
    ]);
  });

  test("no rules: the monitors are picked by hand; no tier: none, or no policy", () => {
    const valueOf: (data: Partial<SloCardData>, label: string) => string = (
      data: Partial<SloCardData>,
      label: string,
    ): string => {
      return english(getSloCardWords(sloData(data))).facts.find(
        (fact: { label: string }): boolean => {
          return fact.label === label;
        },
      )!.value;
    };

    expect(
      valueOf(
        { monitorRules: { isVisible: true, count: 0, enabledCount: 0 } },
        "Monitor rules",
      ),
    ).toBe("None - monitors are picked by hand");
    expect(
      valueOf(
        { monitorRules: { isVisible: true, count: 1, enabledCount: 1 } },
        "Monitor rules",
      ),
    ).toBe("1 of 1 enabled");
    expect(
      valueOf(
        { policyTiers: { isVisible: true, count: 0 } },
        "Error budget policy tier",
      ),
    ).toBe("No error budget policy");
    expect(
      valueOf(
        { policyTiers: { isVisible: true, count: 3 } },
        "Error budget policy tier",
      ),
    ).toBe("None - the budget is above every tier");
    // The tier is SLO data: shown even when the tiers cannot be read.
    expect(
      valueOf(
        { policyTiers: { isVisible: false, count: 0, currentName: "Freeze" } },
        "Error budget policy tier",
      ),
    ).toBe("Freeze");
    expect(valueOf({ windowDays: 7 }, "Window")).toBe("Rolling 7-day window");
    expect(valueOf({ windowDays: 1 }, "Window")).toBe("Rolling 1-day window");
    expect(valueOf({ windowDays: null }, "Window")).toBe(
      "Rolling 30-day window",
    );
    expect(valueOf({ windowDays: 0 }, "Window")).toBe("Rolling 30-day window");
  });

  test("in German its figures are German's, its words German", () => {
    const drawn: English = inLanguage(getSloCardWords(sloData()), "de");

    expect(drawn.kind).toBe("SLO");
    expect(drawn.line).toBe("Checkout stays up.");
    expect(drawn.facts).toEqual(
      expect.arrayContaining([
        // German writes a no-break space before the percent sign.
        { label: "Ziel", value: `99,95${NO_BREAK_SPACE}%` },
        {
          label: "Zeitfenster",
          value: "Rollierendes Zeitfenster von 30 Tagen",
        },
        { label: "SLI-Typ", value: "Monitor-Verfügbarkeit" },
        { label: "Burn-Rate", value: "1,23" },
        { label: "Monitor-Regeln", value: "1 von 2 aktiviert" },
        { label: "Deployments", value: "Erlaubt" },
      ]),
    );
  });

  test("in Persian its figures are written in Persian digits", () => {
    const drawn: English = inLanguage(getSloCardWords(sloData()), "fa");
    const target: string = drawn.facts.find(
      (fact: { label: string }): boolean => {
        return fact.label === word("Target", "fa");
      },
    )!.value;

    expect(target).toMatch(/[۰-۹]/);
    expect(target).not.toMatch(/[0-9]/);
  });

  test("in Arabic its figures stay in Latin digits, as Arabic in OneUptime writes them", () => {
    const drawn: English = inLanguage(getSloCardWords(sloData()), "ar");
    const burnRate: string = drawn.facts.find(
      (fact: { label: string }): boolean => {
        return fact.label === word("Burn rate", "ar");
      },
    )!.value;

    expect(burnRate).toBe("1.23");
  });
});

describe("an on-call policy's card", () => {
  test("each rule by its number and name, whom it pages by kind and name, and when it escalates", () => {
    expect(
      english(
        getOnCallPolicyCardWords({
          description: "Pages the platform team.",
          isArchived: false,
          rules: [
            {
              order: 1,
              users: ["Ana"],
              teams: ["SRE"],
              schedules: ["Primary"],
              escalateAfterInMinutes: 5,
            },
            {
              order: 2,
              name: "Database team",
              users: [],
              teams: ["DBA"],
              schedules: [],
              escalateAfterInMinutes: 1,
            },
            { order: 3, users: [], teams: [], schedules: [] },
            {
              order: null,
              users: [],
              teams: [],
              schedules: [],
              escalateAfterInMinutes: 15,
            },
            {
              order: 4,
              users: ['Ana "the boss"'],
              teams: [],
              schedules: [],
              escalateAfterInMinutes: 0,
            },
          ],
        }),
      ),
    ).toEqual({
      kind: "On-call policy",
      line: "Pages the platform team.",
      facts: [
        {
          label: "Rule 1",
          value:
            'Pages user "Ana", team "SRE", on-call schedule "Primary", then escalates after 5 minutes',
        },
        {
          label: "Rule 2 — Database team",
          value: 'Pages team "DBA", then escalates after 1 minute',
        },
        { label: "Rule 3", value: "Pages no one" },
        {
          label: "Rule ?",
          value: "Pages no one, then escalates after 15 minutes",
        },
        // A name with a quote in it cannot read as two.
        { label: "Rule 4", value: 'Pages user "Ana \\"the boss\\""' },
      ],
    });
  });

  test("archived, and with no rules", () => {
    expect(
      english(getOnCallPolicyCardWords({ isArchived: true, rules: [] })),
    ).toEqual({
      kind: "On-call policy",
      facts: [
        { label: "Archived", value: "Yes - pages no one" },
        { label: "Escalation rules", value: "None configured" },
      ],
    });
  });

  test("in German: the rule's name in German words, the names as written", () => {
    const drawn: English = inLanguage(
      getOnCallPolicyCardWords({
        isArchived: false,
        rules: [
          {
            order: 2,
            name: "Database team",
            users: ["Ana"],
            teams: ["SRE"],
            schedules: [],
            escalateAfterInMinutes: 5,
          },
        ],
      }),
      "de",
    );

    expect(drawn).toEqual({
      kind: "Bereitschaftsrichtlinie",
      facts: [
        {
          label: "Regel 2 — Database team",
          value:
            'Alarmiert Benutzer "Ana", Team "SRE", eskaliert dann nach 5 Minuten',
        },
      ],
    });
  });
});

describe("an on-call schedule's card", () => {
  test("who is on call now by name, and the shift's moments", () => {
    const words: AIActionCardWords = getOnCallScheduleCardWords({
      onCallNow: "Ana",
      rosterStartAt: new Date("2026-11-12T08:00:00.000Z"),
      rosterHandoffAt: new Date("2026-11-13T08:00:00.000Z"),
      nextUp: "Bo",
      rosterNextStartAt: new Date("2026-11-13T08:00:00.000Z"),
    });

    // The exports print each moment as the card always stored it: ISO.
    expect(english(words)).toEqual({
      kind: "On-call schedule",
      line: "On call now: Ana",
      facts: [
        { label: "On call since", value: "2026-11-12T08:00:00.000Z" },
        { label: "Hands off at", value: "2026-11-13T08:00:00.000Z" },
        { label: "Next up", value: "Bo" },
        { label: "Next shift starts", value: "2026-11-13T08:00:00.000Z" },
      ],
    });
    expect(words.facts![0]!.value).toEqual({
      moment: "2026-11-12T08:00:00.000Z",
    });
  });

  test("no one on call", () => {
    expect(english(getOnCallScheduleCardWords({}))).toEqual({
      kind: "On-call schedule",
      line: "No one is on call",
      facts: [],
    });
    expect(inLanguage(getOnCallScheduleCardWords({}), "de").line).toBe(
      "Niemand ist in Bereitschaft",
    );
  });
});

describe("a status page's card", () => {
  test("its visibility, URL, the resources it shows by name, and its subscribers", () => {
    expect(english(getStatusPageCardWords(statusPageData()))).toEqual({
      kind: "Status page",
      line: "What our customers see.",
      facts: [
        { label: "Visibility", value: "Public" },
        { label: "Public URL", value: "https://status.example.com" },
        {
          label: "Resources shown",
          value:
            "4: Checkout (monitor: checkout-api), Payments (monitor group: Payments group), Search - not monitored",
        },
        { label: "Active subscribers", value: "1234" },
      ],
    });
  });

  test("private and archived, with nothing on it", () => {
    expect(
      english(
        getStatusPageCardWords({
          isPublic: false,
          isArchived: true,
          resourceCount: 2,
          resources: [],
          activeSubscribers: 0,
        }),
      ),
    ).toEqual({
      kind: "Status page",
      facts: [
        { label: "Visibility", value: "Private" },
        { label: "Archived", value: "Yes - offline, sends nothing" },
        { label: "Resources shown", value: "0" },
        { label: "Active subscribers", value: "0" },
      ],
    });
  });

  test("in German: the names and the URL as written, the words German", () => {
    const drawn: English = inLanguage(
      getStatusPageCardWords(statusPageData()),
      "de",
    );

    expect(drawn.facts).toEqual([
      { label: "Sichtbarkeit", value: word("Public", "de") },
      { label: "Öffentliche URL", value: "https://status.example.com" },
      {
        label: "Angezeigte Ressourcen",
        value:
          "4: Checkout (Monitor: checkout-api), Payments (Monitor-Gruppe: Payments group), Search - nicht überwacht",
      },
      { label: "Aktive Abonnenten", value: "1.234" },
    ]);
  });
});

describe("the cards of a team, a runbook and a workflow with nothing to list", () => {
  test("a team with no members", () => {
    expect(english(getEmptyTeamCardWords({ description: "DBAs" }))).toEqual({
      kind: "Team",
      line: "No members",
      // The line says it: no "Members: 0" under it.
      facts: [{ label: "Description", value: "DBAs" }],
    });
    expect(english(getEmptyTeamCardWords({})).facts[0]!.value).toBe("—");
  });

  test("a runbook with no steps", () => {
    expect(
      english(getEmptyRunbookCardWords({ isEnabled: true, description: "x" })),
    ).toEqual({
      kind: "Runbook",
      line: "Enabled",
      facts: [
        { label: "Description", value: "x" },
        { label: "Steps", value: "0" },
      ],
    });
    expect(english(getEmptyRunbookCardWords({ isEnabled: false })).line).toBe(
      "Disabled",
    );
  });

  test("a workflow with no runs", () => {
    expect(
      english(
        getUnrunWorkflowCardWords({
          description: "Posts to Slack.",
          isEnabled: true,
          isArchived: false,
        }),
      ),
    ).toEqual({
      kind: "Workflow",
      line: "Posts to Slack.",
      facts: [
        { label: "Enabled", value: "Yes" },
        { label: "Recent runs", value: "0" },
      ],
    });
    expect(
      english(getUnrunWorkflowCardWords({ isEnabled: false, isArchived: true }))
        .facts,
    ).toEqual([
      { label: "Enabled", value: "No" },
      { label: "Archived", value: "Yes - does not run" },
      { label: "Recent runs", value: "0" },
    ]);
  });
});

describe("a security case's card", () => {
  test("its status and priority by the project's names, each entity by its kind", () => {
    expect(english(getSecurityCaseCardWords(securityCaseData()))).toEqual({
      kind: "Security case",
      line: "Investigating · P1",
      facts: [
        { label: "Detections", value: "3" },
        {
          label: "Entities",
          // A kind this version does not know reads as Other; a value-less one is left out.
          value: "IP Address: 10.0.0.7, User: alice, Other: Mars",
        },
      ],
    });
  });

  test("a status or priority it cannot name is left out of the line; no entities, a dash", () => {
    expect(
      english(
        getSecurityCaseCardWords({
          statusName: "",
          priorityName: "P2",
          detectionCount: 0,
          entities: null,
        }),
      ),
    ).toEqual({
      kind: "Security case",
      line: "P2",
      facts: [
        { label: "Detections", value: "0" },
        { label: "Entities", value: "-" },
      ],
    });
    expect(
      getSecurityCaseCardWords({
        statusName: "",
        priorityName: "",
        detectionCount: 0,
        entities: [],
      }).line,
    ).toBeUndefined();
  });

  test("in German, each entity's kind in German", () => {
    expect(
      inLanguage(getSecurityCaseCardWords(securityCaseData()), "de").facts[1],
    ).toEqual({
      label: "Entitäten",
      value: `${word("IP Address", "de")}: 10.0.0.7, ${word("User", "de")}: alice, ${word("Other", "de")}: Mars`,
    });
  });
});

/*
 * The English a card stores is its words in English (WidgetBuilder), each
 * fact once: what the card said before, where a test pinned it.
 */
describe("the card WidgetBuilder stores from them", () => {
  test("a monitor's card stores the same words in English, each fact once", () => {
    const widget: AIChatWidget = WidgetBuilder.resourceCard({
      title: "Monitor Checkout API",
      heading: "Checkout API",
      words: getMonitorCardWords({
        monitorType: MonitorType.Website,
        statusName: "Offline",
        isMonitoringOff: false,
        isArchived: false,
      }),
    });

    expect(widget.data.resourceType).toBe("Monitor");
    expect(widget.data.subheading).toBe("Offline");
    expect(widget.data.fields).toEqual([{ label: "Type", value: "Website" }]);
    expect(widget.data.words!.facts).toEqual([
      aiActionCardFact(AI_READ_CARD_FACTS.type, aiActionTerm("Website")),
    ]);
  });

  /*
   * A write's card may say Monitor now (a setup plan creates one, #6829),
   * but never what a read of one says: its type, its status, that its
   * monitoring is off.
   */
  test("a read's words are not a write's: a write's card cannot say what a monitor's read says", () => {
    const words: AIActionCardWords = getMonitorCardWords({
      monitorType: MonitorType.Website,
      isMonitoringOff: true,
      isArchived: false,
    });

    expect(isKnownAIActionCardWords(words, { isRead: true })).toBe(true);
    expect(isKnownAIActionCardWords(words)).toBe(false);
    expect(isKnownAIActionCardWords(words, { isRead: false })).toBe(false);
  });

  /*
   * A setup plan's writes (#6829) leave a Monitor and a Status page card,
   * so those two kinds are a write's as well as a read's.
   */
  test("a kind only a read's card has is not a write's: SLO, Team, On-call schedule", () => {
    const readOnly: Array<string> = Object.values(AI_READ_CARD_KINDS).filter(
      (kind: string): boolean => {
        return !Object.values(AI_ACTION_CARD_KINDS).includes(kind);
      },
    );

    expect(readOnly).toEqual(["SLO", "Team", "On-call schedule"]);
    expect(Object.values(AI_ACTION_CARD_KINDS)).toEqual(
      expect.arrayContaining(["Monitor", "Status page"]),
    );

    for (const kind of readOnly) {
      // Nothing else on it a write's card could not hold.
      const words: AIActionCardWords = { kind: aiActionTerm(kind) };

      expect({
        kind,
        isRead: isKnownAIActionCardWords(words, { isRead: true }),
      }).toEqual({ kind, isRead: true });
      expect({ kind, isWrite: isKnownAIActionCardWords(words) }).toEqual({
        kind,
        isWrite: false,
      });
    }

    // A write's own kind stays a write's.
    expect(
      isKnownAIActionCardWords({
        kind: aiActionTerm(AI_ACTION_CARD_KINDS.incident),
      }),
    ).toBe(true);
  });

  test("data in the line - a status name the project chose - is a read's only: a write's line is our sentences", () => {
    const words: AIActionCardWords = {
      kind: aiActionTerm(AI_ACTION_CARD_KINDS.securityCase),
      line: ["Investigating", "P1"],
    };

    expect(isKnownAIActionCardWords(words, { isRead: true })).toBe(true);
    expect(isKnownAIActionCardWords(words)).toBe(false);
    expect(
      isKnownAIActionCardWords({
        ...words,
        line: [aiActionSentence(AI_READ_CARD_LINES.disabled)],
      }),
    ).toBe(true);
    // Not a string or a sentence: refused either way.
    expect(
      isKnownAIActionCardWords({ ...words, line: [42] }, { isRead: true }),
    ).toBe(false);
  });

  test("a value no read's card holds is not trusted: the card reads as its English", () => {
    const words: AIActionCardWords = getMonitorCardWords({
      monitorType: MonitorType.Website,
      isMonitoringOff: true,
      isArchived: false,
    });

    for (const value of [
      aiActionTerm("Not a word of ours"),
      { figure: Number.POSITIVE_INFINITY },
      { moment: "yesterday" },
      { moment: "2026-11-12T08:00:00.000Z".repeat(3) },
      { figure: 1, isPercent: "yes" },
      42,
      null,
    ]) {
      expect(
        isKnownAIActionCardWords(
          {
            ...words,
            facts: [{ label: aiActionTerm(AI_READ_CARD_FACTS.type), value }],
          },
          { isRead: true },
        ),
      ).toBe(false);
    }

    expect(
      isKnownAIActionCardWords(
        {
          ...words,
          facts: [
            {
              label: aiActionTerm(AI_READ_CARD_FACTS.monitoring),
              value: aiActionTerm(AI_READ_CARD_VALUES.monitoringOff),
            },
          ],
        },
        { isRead: true },
      ),
    ).toBe(true);
  });
});

// Every word a read's card says in a language, from that language's file.
describe("in every Dashboard language", () => {
  test.each(
    DASHBOARD_LANGUAGES.map((language: string): [string] => {
      return [language];
    }),
  )(
    "%s says each read card's kind and facts in its own words",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);

      for (const [, words] of everyCard()) {
        const drawn: English = describeAIActionCardWords(words, translator);

        expect(drawn.kind).toBe(translator.translateTerm(words.kind.term));
        expect(drawn.facts.length).toBe((words.facts || []).length);
      }
    },
  );
});
