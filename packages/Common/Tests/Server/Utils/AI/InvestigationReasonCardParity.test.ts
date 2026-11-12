import InvestigationEligibility, {
  InvestigationSubject,
} from "../../../../Server/Utils/AI/SRE/InvestigationEligibility";
import AIInvestigationEngine from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import { INVESTIGATION_NOT_STARTED_MESSAGES } from "../../../../Server/Utils/AI/SRE/InvestigationTryAgain";
import { INSIGHT_TRIAGE_NOT_ENQUEUED_MESSAGES } from "../../../../Server/Utils/AI/SRE/Insights/Triage";
import { AutonomousBudgetStatus } from "../../../../Server/Services/AIService";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentService from "../../../../Server/Services/IncidentService";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import InvestigationNotStartedReason, {
  InvestigationGateDetails,
  InvestigationNotStartedCode,
} from "../../../../Types/AI/InvestigationNotStartedReason";
import ObjectID from "../../../../Types/ObjectID";
import { createTranslator, Translator } from "../../../../Types/Translator";
import {
  getInvestigationNotStartedWords,
  InvestigationNotStartedWords,
  WORDED_NOT_STARTED_CODES,
} from "../../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationNotStartedWords";
import {
  getInvestigationReasonPagePath,
  getInvestigationReasonPagesNamed,
  getInvestigationReasonPlace,
  INVESTIGATION_REASON_PAGE_PATHS,
  InvestigationReasonKind,
  InvestigationReasonPlace,
} from "../../../Helpers/InvestigationReasonPlaces";
import PageMap from "../../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import { withoutIsolateMarks } from "../../../Helpers/IsolateMarks";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * THE SERVER'S ENGLISH SENDS ITS READER WHERE THE AI CARD DOES (#6738).
 *
 * When OneUptime AI does not investigate an incident or alert, the server
 * records why, with a code and an English title, description and next step.
 * Since #6656 the Dashboard's AI card words each code itself, in the
 * reader's language, and links to the settings page; the server's English
 * is what API readers and older Dashboards read. The two named the same
 * setting differently: the card said "Set up an LLM provider" and linked
 * to LLM Providers, while the server said "Configure an AI provider in
 * project settings" - a setting no page is called.
 *
 * These hold, for every code, kind (incident, alert) and source (decided
 * then, the settings now, and the "unknown" the server falls back to):
 *
 *   - no sentence of a reason says "AI provider";
 *   - the server's next step names what the card's English next step
 *     names, by the same name (InvestigationReasonPlaces);
 *   - the server's next step writes out the path of the page the card's
 *     link opens, and of no other page (the card's own suite holds the
 *     link to the same table);
 *   - the other messages a person reads when OneUptime AI cannot start for
 *     want of a provider - Try again, Investigate now, an insight's triage -
 *     name the LLM Providers setting too.
 *
 * The card is given the very reason the server sends, facts and all, so
 * it words what an API reader reads.
 */

const ENGLISH: Translator = createTranslator(undefined, "en");
const PROJECT_ID: ObjectID = ObjectID.generate();
const INCIDENT_ID: ObjectID = ObjectID.generate();
const ALERT_ID: ObjectID = ObjectID.generate();
const KINDS: ReadonlyArray<InvestigationReasonKind> = ["incident", "alert"];

// "AI provider", "AI providers", "AI-provider", in any case.
const AI_PROVIDER: RegExp = /\bAI[ -]providers?\b/i;

// The facts a reason is worded from, as the gates hand them over.
const DETAILS: InvestigationGateDetails = {
  severityName: "SEV-2",
  minimumSeverityName: "SEV-1",
  cooldownWindowMinutes: 45,
  rulesChecked: 2,
};
// A daily token limit used up, and one of 0, which pauses the work.
const USED_UP: AutonomousBudgetStatus = {
  exhausted: true,
  limitInTokens: 1000,
  usedTokensToday: 1200,
};
const PAUSED: AutonomousBudgetStatus = {
  exhausted: true,
  limitInTokens: 0,
  usedTokensToday: 0,
};

type Source = InvestigationNotStartedReason["source"];

interface ReasonCase {
  name: string;
  code: InvestigationNotStartedCode;
  kind: InvestigationReasonKind;
  source: Source;
  // Decided when an AI rule's wait ended, rather than at creation.
  afterWait: boolean;
  budget?: AutonomousBudgetStatus | undefined;
}

function subjectOf(kind: InvestigationReasonKind): InvestigationSubject {
  return kind === "alert"
    ? { projectId: PROJECT_ID, alertId: ALERT_ID }
    : { projectId: PROJECT_ID, incidentId: INCIDENT_ID };
}

/*
 * The reason as the server sends it. "current_configuration" is what
 * getNotStartedReason words from today's settings for a record created
 * before decisions were recorded; "unknown" is its fallback when nothing
 * was recorded and today's checks pass (no_run_recorded) or could not be
 * read (eligibility_check_failed).
 */
function serverReason(reasonCase: ReasonCase): InvestigationNotStartedReason {
  const subject: InvestigationSubject = subjectOf(reasonCase.kind);
  const details: InvestigationGateDetails = reasonCase.afterWait
    ? { ...DETAILS, waitMinutes: 10 }
    : DETAILS;

  if (reasonCase.source === "current_configuration") {
    return InvestigationEligibility["buildReason"](
      "current_configuration",
      reasonCase.code,
      subject,
      reasonCase.budget,
      details,
    );
  }

  const recorded: InvestigationNotStartedReason =
    InvestigationEligibility.reason(
      reasonCase.code,
      subject,
      reasonCase.budget,
      details,
    );

  return reasonCase.source === "unknown"
    ? { ...recorded, source: "unknown" }
    : recorded;
}

// The card's three lines for that reason, as an English reader reads them.
function cardWords(
  reasonCase: ReasonCase,
  reason: InvestigationNotStartedReason,
): InvestigationNotStartedWords {
  const words: InvestigationNotStartedWords | null =
    getInvestigationNotStartedWords({
      /*
       * A rule's wait is the only time resolved_before_investigation is
       * decided, and its sentence needs the wait: the server sends it then.
       */
      reason:
        reason.code === "resolved_before_investigation" &&
        reason.decidedAfterWaitMinutes === undefined
          ? { ...reason, decidedAfterWaitMinutes: 10 }
          : reason,
      subjectType: reasonCase.kind,
      translator: ENGLISH,
    });

  if (!words) {
    throw new Error(`The card does not word ${reasonCase.name}.`);
  }

  return {
    title: withoutIsolateMarks(words.title),
    description: withoutIsolateMarks(words.description),
    nextStep: withoutIsolateMarks(words.nextStep),
  };
}

// Every code, kind and source, with the budgets and the wait that change words.
function allCases(): Array<ReasonCase> {
  const cases: Array<ReasonCase> = [];

  for (const code of WORDED_NOT_STARTED_CODES) {
    for (const kind of KINDS) {
      const budgets: Array<AutonomousBudgetStatus | undefined> =
        code === "daily_budget_exhausted"
          ? [USED_UP, PAUSED, undefined]
          : [undefined];

      for (const budget of budgets) {
        const budgetName: string =
          budget === undefined
            ? ""
            : budget.limitInTokens === 0
              ? ", a limit of 0"
              : ", a limit used up";

        for (const [source, afterWait] of [
          ["recorded", false],
          ["recorded", true],
          ["current_configuration", false],
        ] as Array<[Source, boolean]>) {
          cases.push({
            name: `${code} (${kind}, ${source}${afterWait ? " after a wait" : ""}${budgetName})`,
            code,
            kind,
            source,
            afterWait,
            budget,
          });
        }
      }

      if (code === "no_run_recorded" || code === "eligibility_check_failed") {
        cases.push({
          name: `${code} (${kind}, unknown)`,
          code,
          kind,
          source: "unknown",
          afterWait: false,
        });
      }
    }
  }

  return cases;
}

const CASES: Array<ReasonCase> = allCases();

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the cases cover every code, kind and source", () => {
  test("every code the card words, for incidents and alerts, decided then and now", () => {
    const covered: Set<string> = new Set<string>(
      CASES.map((reasonCase: ReasonCase): string => {
        return `${reasonCase.code}/${reasonCase.kind}/${reasonCase.source}`;
      }),
    );

    expect(WORDED_NOT_STARTED_CODES.length).toBe(15);

    for (const code of WORDED_NOT_STARTED_CODES) {
      for (const kind of KINDS) {
        for (const source of ["recorded", "current_configuration"]) {
          expect(covered.has(`${code}/${kind}/${source}`)).toBe(true);
        }
      }
    }

    expect(covered.has("no_run_recorded/alert/unknown")).toBe(true);
    expect(covered.has("eligibility_check_failed/incident/unknown")).toBe(true);
  });

  test("a limit of 0 is worded as a pause on both sides, and a limit used up is not", () => {
    for (const kind of KINDS) {
      const paused: InvestigationNotStartedReason = serverReason({
        name: "paused",
        code: "daily_budget_exhausted",
        kind,
        source: "recorded",
        afterWait: false,
        budget: PAUSED,
      });
      const usedUp: InvestigationNotStartedReason = serverReason({
        name: "used up",
        code: "daily_budget_exhausted",
        kind,
        source: "recorded",
        afterWait: false,
        budget: USED_UP,
      });

      expect(paused.title).toBe(
        "Automatic investigation was paused by its token limit",
      );
      expect(paused.facts?.dailyTokenLimit).toBe(0);
      expect(usedUp.title).toBe("The daily AI token limit had been reached");
      expect(usedUp.facts?.dailyTokenLimit).toBe(1000);
    }
  });
});

describe("no reason the server sends says AI provider", () => {
  test.each(CASES)("$name", (reasonCase: ReasonCase) => {
    const reason: InvestigationNotStartedReason = serverReason(reasonCase);

    for (const line of [reason.title, reason.description, reason.nextStep]) {
      expect(line).not.toMatch(AI_PROVIDER);
    }
  });

  test.each(
    CASES.filter((reasonCase: ReasonCase): boolean => {
      return reasonCase.code === "provider_missing";
    }),
  )(
    "$name: every line says LLM provider, and the step names the LLM Providers page",
    (reasonCase: ReasonCase) => {
      const reason: InvestigationNotStartedReason = serverReason(reasonCase);

      expect(reason.title).toContain("No LLM provider");
      expect(reason.description).toContain("no LLM provider");
      expect(reason.nextStep).toContain("LLM provider");
      expect(reason.nextStep).toContain(
        "Project Settings → AI → LLM Providers",
      );
    },
  );

  test.each(KINDS)(
    "provider_missing reads in full, for an %s decided at creation and now",
    (kind: InvestigationReasonKind) => {
      const recorded: InvestigationNotStartedReason =
        InvestigationEligibility.reason("provider_missing", subjectOf(kind));
      const current: InvestigationNotStartedReason = InvestigationEligibility[
        "buildReason"
      ]("current_configuration", "provider_missing", subjectOf(kind));

      expect({
        title: recorded.title,
        description: recorded.description,
        nextStep: recorded.nextStep,
      }).toEqual({
        title: "No LLM provider was available at creation",
        description: `Automatic investigation was enabled when this ${kind} was created, but the project had no LLM provider OneUptime AI could use to run it.`,
        nextStep:
          "Review the project's LLM providers under Project Settings → AI → LLM Providers for new investigations. Setting one up later does not automatically retry existing records.",
      });
      expect({
        title: current.title,
        nextStep: current.nextStep,
      }).toEqual({
        title: "No LLM provider is currently available",
        nextStep:
          "Set up an LLM provider for the project under Project Settings → AI → LLM Providers. New eligible records can then be investigated; existing records are not automatically retried.",
      });
      expect(current.description).toBe(
        "Automatic investigation is currently enabled, but this project has no LLM provider OneUptime AI can use to run new investigations. These are the current conditions; the original decision was not recorded, so they do not confirm why this record was skipped at creation.",
      );
    },
  );

  /*
   * Through the API's own path: a record created before decisions were
   * recorded, in a project with no LLM provider today.
   */
  test.each(KINDS)(
    "the API words an %s with no provider today by the LLM Providers setting",
    async (kind: InvestigationReasonKind) => {
      jest
        .spyOn(AlertService, "findOneBy")
        .mockResolvedValue(new Alert(ALERT_ID));
      jest
        .spyOn(IncidentService, "findOneBy")
        .mockResolvedValue(new Incident(INCIDENT_ID));
      jest
        .spyOn(AIInvestigationEngine, "getDisabledReasonForSubject")
        .mockResolvedValue("provider_missing");

      const reason: InvestigationNotStartedReason =
        await InvestigationEligibility.getNotStartedReason(subjectOf(kind));

      expect(reason.code).toBe("provider_missing");
      expect(reason.source).toBe("current_configuration");
      expect(reason.title).toBe("No LLM provider is currently available");
      expect(reason.nextStep).toContain(
        "Project Settings → AI → LLM Providers",
      );
      expect(JSON.stringify(reason)).not.toMatch(AI_PROVIDER);
    },
  );
});

describe("the server's next step names what the card's next step names", () => {
  test.each(CASES)("$name", (reasonCase: ReasonCase) => {
    const reason: InvestigationNotStartedReason = serverReason(reasonCase);
    const card: InvestigationNotStartedWords = cardWords(reasonCase, reason);
    const place: InvestigationReasonPlace = getInvestigationReasonPlace(
      reasonCase.code,
      reasonCase.kind,
      { paused: reasonCase.budget?.limitInTokens === 0 },
    );

    expect(place.names.length).toBeGreaterThan(0);

    for (const name of place.names) {
      expect({ name, inCardStep: card.nextStep.includes(name) }).toEqual({
        name,
        inCardStep: true,
      });
      expect({ name, inServerStep: reason.nextStep.includes(name) }).toEqual({
        name,
        inServerStep: true,
      });
    }
  });
});

describe("the server's next step writes out the page the card's link opens, and no other", () => {
  test.each(CASES)("$name", (reasonCase: ReasonCase) => {
    const reason: InvestigationNotStartedReason = serverReason(reasonCase);
    const place: InvestigationReasonPlace = getInvestigationReasonPlace(
      reasonCase.code,
      reasonCase.kind,
      { paused: reasonCase.budget?.limitInTokens === 0 },
    );
    const named: Array<string> = Array.from(
      INVESTIGATION_REASON_PAGE_PATHS.values(),
    )
      .filter((pagePath: string): boolean => {
        return reason.nextStep.includes(pagePath);
      })
      .sort();

    expect(named).toEqual(
      getInvestigationReasonPagesNamed(place)
        .map((page: PageMap): string => {
          return getInvestigationReasonPagePath(page);
        })
        .sort(),
    );
  });

  /*
   * Nothing was recorded: the card's link opens the record's AI settings,
   * and its step sends the reader to the AI Logs - the English names both.
   */
  test.each(KINDS)(
    "nothing recorded for an %s: the step names its AI settings and its AI Logs",
    (kind: InvestigationReasonKind) => {
      const own: string = kind === "alert" ? "Alerts" : "Incidents";

      for (const reason of [
        InvestigationEligibility.reason("no_run_recorded", subjectOf(kind)),
        InvestigationEligibility["buildReason"](
          "current_configuration",
          "no_run_recorded",
          subjectOf(kind),
        ),
      ]) {
        expect(reason.nextStep).toBe(
          `Automatic investigations are triggered when a record is created, so enabling investigation later under ${own} → AI → Settings does not backfill existing records. Check the AI Logs under ${own} → AI → Logs and service health if new eligible records are also missing investigations.`,
        );
      }
    },
  );

  /*
   * A record's own settings are its kind's: an alert's reason never sends
   * its reader to the incidents' page, nor the other way round.
   */
  test.each(KINDS)(
    "a reason about an %s names only its own AI settings",
    (kind: InvestigationReasonKind) => {
      // The other kind's AI section: its Settings, its Logs, any page of it.
      const otherSection: string =
        kind === "alert" ? "Incidents → AI →" : "Alerts → AI →";

      for (const reasonCase of CASES.filter((candidate: ReasonCase) => {
        return candidate.kind === kind;
      })) {
        const reason: InvestigationNotStartedReason = serverReason(reasonCase);

        expect({
          name: reasonCase.name,
          namesTheOtherKind: [
            reason.title,
            reason.description,
            reason.nextStep,
          ].some((line: string): boolean => {
            return line.includes(otherSection);
          }),
        }).toEqual({ name: reasonCase.name, namesTheOtherKind: false });
      }
    },
  );
});

/*
 * The settings a reason names in its title and description, by the names
 * the card and the settings pages give them - never the old ones.
 */
describe("titles and descriptions name each setting as the card does", () => {
  const OLD_NAMES: ReadonlyArray<[string, RegExp]> = [
    ["investigation threshold", /investigation threshold/i],
    [
      "minimum ... investigation severity",
      /minimum \S+ investigation severity/i,
    ],
    ["investigation cooldown window", /cooldown window/i],
    ["monitor cooldown", /monitor cooldown/i],
    ["token budget", /token budget/i],
    ["token allowance", /allowance/i],
    ["AI budget", /AI budget/i],
    ["spending limit", /spending limit/i],
  ];

  test.each(CASES)("$name", (reasonCase: ReasonCase) => {
    const reason: InvestigationNotStartedReason = serverReason(reasonCase);

    for (const [name, pattern] of OLD_NAMES) {
      for (const line of [reason.title, reason.description, reason.nextStep]) {
        expect({ name, line, saysIt: pattern.test(line) }).toEqual({
          name,
          line,
          saysIt: false,
        });
      }
    }
  });

  test.each(KINDS)(
    "an %s's severity, cooldown and token limit, by their settings' names",
    (kind: InvestigationReasonKind) => {
      const severity: InvestigationNotStartedReason =
        InvestigationEligibility.reason(
          "severity_below_threshold",
          subjectOf(kind),
          undefined,
          DETAILS,
        );
      const cooldown: InvestigationNotStartedReason =
        InvestigationEligibility.reason(
          "monitor_cooldown",
          subjectOf(kind),
          undefined,
          DETAILS,
        );
      const tokenLimit: InvestigationNotStartedReason =
        InvestigationEligibility.reason(
          "daily_budget_exhausted",
          subjectOf(kind),
          USED_UP,
        );
      const paused: InvestigationNotStartedReason =
        InvestigationEligibility.reason(
          "daily_budget_exhausted",
          subjectOf(kind),
          PAUSED,
        );
      const ownSettings: string =
        kind === "alert"
          ? "Alerts → AI → Settings"
          : "Incidents → AI → Settings";
      const limitName: string =
        kind === "alert"
          ? "Daily Alert AI Token Limit"
          : "Daily Incident AI Token Limit";

      expect(severity.title).toBe(
        "Severity was below the minimum for AI investigation at creation",
      );
      expect(severity.description).toBe(
        `When this ${kind} was created, its SEV-2 severity did not meet the minimum severity for AI investigation (SEV-1).`,
      );
      expect(severity.nextStep).toBe(
        `Review the minimum severity for AI investigation under ${ownSettings} → More settings. Changes apply to new records and do not retry this record.`,
      );
      expect(cooldown.title).toBe(
        "Skipped during the re-investigation cooldown",
      );
      expect(cooldown.description).toContain(
        "within the 45-minute re-investigation cooldown",
      );
      expect(cooldown.nextStep).toContain(
        `shorten or clear the re-investigation cooldown under ${ownSettings} → More settings`,
      );
      expect(tokenLimit.description).toBe(
        `AI work for ${kind}s had used 1,200 tokens of its ${limitName} of 1,000 when checked at creation. No investigation was queued.`,
      );
      expect(tokenLimit.nextStep).toBe(
        `Review the ${limitName} under ${ownSettings} → More settings. Usage resets at midnight UTC; skipped records are not automatically retried after the reset.`,
      );
      // Waiting for midnight does not lift a limit of 0.
      expect(paused.description).toBe(
        `The ${limitName} was set to 0 when checked at creation, which pauses automatic AI work for ${kind}s. No investigation was queued.`,
      );
      expect(paused.nextStep).toBe(
        `Raise the ${limitName} above 0 under ${ownSettings} → More settings, or clear it. Records skipped meanwhile are not automatically retried.`,
      );
      expect(paused.nextStep).not.toContain("midnight");
    },
  );

  // A limit below 0 pauses the work as 0 does, and is worded so.
  test("a limit below 0 is a pause too", () => {
    const reason: InvestigationNotStartedReason =
      InvestigationEligibility.reason(
        "daily_budget_exhausted",
        subjectOf("incident"),
        { exhausted: true, limitInTokens: -5, usedTokensToday: 0 },
      );

    expect(reason.title).toBe(
      "Automatic investigation was paused by its token limit",
    );
    expect(reason.nextStep).toContain("above 0");
    expect(reason.facts?.dailyTokenLimit).toBe(0);
  });

  test("the switches are named as their pages title them", () => {
    for (const kind of KINDS) {
      const recorded: InvestigationNotStartedReason =
        InvestigationEligibility.reason(
          "automatic_investigation_disabled",
          subjectOf(kind),
        );
      const current: InvestigationNotStartedReason = InvestigationEligibility[
        "buildReason"
      ](
        "current_configuration",
        "automatic_investigation_disabled",
        subjectOf(kind),
      );
      const ownSettings: string =
        kind === "alert"
          ? "Alerts → AI → Settings"
          : "Incidents → AI → Settings";

      expect(recorded.nextStep).toBe(
        `Review the Investigate new ${kind}s switch under ${ownSettings} for new ${kind}s. Turning it on later does not automatically retry this ${kind}.`,
      );
      expect(current.nextStep).toBe(
        `Turn on Investigate new ${kind}s under ${ownSettings} for new ${kind}s. Existing records are not automatically retried.`,
      );
    }

    const aiOff: InvestigationNotStartedReason = InvestigationEligibility[
      "buildReason"
    ]("current_configuration", "ai_disabled", subjectOf("incident"));

    expect(aiOff.nextStep).toBe(
      "Turn on Enable AI under Project Settings → AI → AI Features to investigate new records. Existing records are not automatically retried.",
    );
  });
});

describe("the other messages about a missing provider name the LLM Providers setting", () => {
  test("Try again on an investigation", () => {
    expect(INVESTIGATION_NOT_STARTED_MESSAGES.provider_missing).toBe(
      "This project has no LLM provider to investigate with. Add one in Project Settings > AI > LLM Providers, then try again.",
    );

    for (const message of Object.values(INVESTIGATION_NOT_STARTED_MESSAGES)) {
      expect(message).not.toMatch(AI_PROVIDER);
    }
  });

  test("Try again on an insight's triage", () => {
    for (const message of Object.values(INSIGHT_TRIAGE_NOT_ENQUEUED_MESSAGES)) {
      expect(message).not.toMatch(AI_PROVIDER);
    }
  });
});
