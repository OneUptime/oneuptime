import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { I18nextProvider } from "react-i18next";
import React, { ReactElement } from "react";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { CheckOn } from "../../../Types/Monitor/CriteriaFilter";
import MonitorEvaluationSummary from "../../../Types/Monitor/MonitorEvaluationSummary";
import { JSONObject } from "../../../Types/JSON";
import {
  OnCallShift,
  ScheduleCoverageState,
  ScheduleCoverageStatus,
} from "../../../Types/OnCallDutyPolicy/ScheduleShiftUtil";
import PositiveNumber from "../../../Types/PositiveNumber";
import ProbeAttempt from "../../../Types/Probe/ProbeAttempt";
import {
  formatRelativeStart,
  formatWindowSpan,
  summarizeRotation,
  summarizeStartsAt,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerSummary";
import {
  OVERRIDE_TITLE_MARKER,
  OverrideSummaryRow,
  describeOverrideScope,
  describeSubstituteCoverage,
  formatOverrideEventTitle,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/OverridePresentation";
import ActiveOverridesCard from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/ActiveOverridesCard";
import FinalScheduleSummary from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/FinalScheduleSummary";
import {
  ReadinessSummaryWire,
  UserReadinessWire,
  getStatusConsequence,
  getStatusShortLabel,
  parseReadinessSummary,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/Readiness/ReadinessTypes";
import {
  EMPTY_RULE_READINESS_REPORT,
  RuleReadinessDetails,
  RuleReadinessLabel,
  RuleReadinessReport,
  describeResponderVia,
  getRuleWarningLabel,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/EscalationRule/EscalationRuleReadiness";
import { describeEscalationRuleDeletion } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/EscalationRule/EscalationRules";
import EvaluationLogList from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/EvaluationLogList";
import ProbeAttemptsView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/ProbeAttemptsView";
import { describeOnCallExposure } from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/NotificationMethod";
import { getStaleTooltip } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceStatusUtil";

/*
 * Dashboard components from M to R (src/Components/M* to R*) in a German test
 * locale. Each sentence is looked up whole by its English text, its values
 * (names, counts, durations) are filled into the German wording, a count picks
 * the German singular or plural, and the elements inside a sentence - a bold
 * name, a highlighted duration - land wherever the German sentence puts them.
 *
 * Both routes are covered: components read the locale through their
 * translator hook, and the plain helpers they call (summaries, consequence
 * sentences, delete confirmations) through the global i18next instance. This
 * file initialises that instance itself; jest gives every test file its own
 * module registry, so the German never reaches another suite.
 *
 * Every key is the English source text, exactly as Locales/en.json keys it;
 * a count-dependent key carries its singular under the "_one" suffix.
 */

const GERMAN: Record<string, string> = {
  // OnCallPolicy/OnCallScheduleLayer/LayerSummary.ts
  "Rotates daily": "Rotiert täglich",
  "Rotates every {{count}} weeks": "Rotiert alle {{count}} Wochen",
  "Rotates every {{count}} weeks_one": "Rotiert jede Woche",
  "{{count}} weeks": "{{count}} Wochen",
  "{{count}} weeks_one": "{{count}} Woche",
  "{{count}} months": "{{count}} Monate",
  "{{count}} months_one": "{{count}} Monat",
  "in {{count}} hours": "in {{count}} Stunden",
  "in {{count}} hours_one": "in {{count}} Stunde",
  "Starts {{date}}": "Beginnt am {{date}}",
  // OnCallPolicy/OnCallScheduleLayer/OverridePresentation.ts
  "Only for {{policy}}": "Nur für {{policy}}",
  "This override is scoped to the {{policy}} policy, so it only re-routes alerts escalating through {{policy}}.":
    "Diese Vertretung gilt nur für die Richtlinie {{policy}} und leitet nur Alarme um, die über {{policy}} eskalieren.",
  "Global override": "Globale Vertretung",
  "Covering {{name}} and {{count}} others":
    "Vertritt {{name}} und {{count}} weitere",
  "Covering {{name}} and {{count}} others_one":
    "Vertritt {{name}} und eine weitere Person",
  "{{substitute}} (covering {{original}})":
    "{{substitute}} (vertritt {{original}})",
  // OnCallPolicy/OnCallScheduleLayer/ActiveOverridesCard.tsx
  "{{count}} user overrides on this schedule":
    "{{count}} Benutzervertretungen in diesem Dienstplan",
  "{{count}} user overrides on this schedule_one":
    "{{count}} Benutzervertretung in diesem Dienstplan",
  "+ {{count}} more overrides scheduled later in this window.":
    "+ {{count}} weitere Vertretungen später in diesem Zeitraum.",
  "+ {{count}} more overrides scheduled later in this window._one":
    "+ {{count}} weitere Vertretung später in diesem Zeitraum.",
  Overridden: "Vertreten",
  "Alerts go here": "Alarme gehen hierhin",
  // OnCallPolicy/OnCallScheduleLayer/FinalScheduleSummary.tsx
  "Fully covered for the next {{window}}":
    "Für die nächsten {{window}} vollständig abgedeckt",
  "{{percent}}% covered over the next {{window}}":
    "{{percent}} % der nächsten {{window}} abgedeckt",
  "{{duration}} uncovered across {{count}} gaps":
    "{{duration}} ohne Bereitschaft in {{count}} Lücken",
  "{{duration}} uncovered across {{count}} gaps_one":
    "{{duration}} ohne Bereitschaft in {{count}} Lücke",
  "{{label}} no one is on call from {{start}} to {{end}} {{duration}}.":
    "{{label}} Von {{start}} bis {{end}} {{duration}} hat niemand Bereitschaft.",
  "Coverage gap:": "Abdeckungslücke:",
  "On call right now": "Jetzt in Bereitschaft",
  "Until {{time}}": "Bis {{time}}",
  "({{duration}} left)": "(noch {{duration}})",
  // OnCallPolicy/Readiness/ReadinessTypes.ts
  "{{name}} has {{count}} rule gaps, and this project has on-call notification fallback switched off. Those pages are dropped — nothing catches them.":
    "{{name}} hat {{count}} Regellücken, und die Ersatzbenachrichtigung ist in diesem Projekt ausgeschaltet. Diese Alarme gehen verloren.",
  "{{name}} has {{count}} rule gaps, and this project has on-call notification fallback switched off. Those pages are dropped — nothing catches them._one":
    "{{name}} hat eine Regellücke, und die Ersatzbenachrichtigung ist in diesem Projekt ausgeschaltet. Dieser Alarm geht verloren.",
  "{{name}} can only be reached on {{methods}}, and this project has those channels switched off, so every page routed to them is dropped.":
    "{{name}} ist nur über {{methods}} erreichbar, und diese Kanäle sind in diesem Projekt ausgeschaltet, daher geht jeder Alarm verloren.",
  Email: "E-Mail",
  "{{count}} gaps": "{{count}} Lücken",
  "{{count}} gaps_one": "{{count}} Lücke",
  // OnCallPolicy/EscalationRule/EscalationRuleReadiness.tsx
  "{{count}} people can't be paged":
    "{{count}} Personen können nicht alarmiert werden",
  "{{count}} people can't be paged_one":
    "{{count}} Person kann nicht alarmiert werden",
  "{{warning}} on {{rule}}. See who, and send a setup reminder.":
    "{{warning}} in {{rule}}. Sehen Sie nach, wer, und senden Sie eine Erinnerung.",
  "Reached {{routes}}.": "Erreicht {{routes}}.",
  directly: "direkt",
  "through the {{name}} team": "über das Team {{name}}",
  "through the {{name}} schedule": "über den Dienstplan {{name}}",
  "{{items}} and {{last}}": "{{items}} und {{last}}",
  "Whether the {{count}} people this level notifies can actually be paged.":
    "Ob die {{count}} Personen dieser Stufe tatsächlich alarmiert werden können.",
  "Whether the {{count}} people this level notifies can actually be paged._one":
    "Ob die eine Person dieser Stufe tatsächlich alarmiert werden kann.",
  "Remind all {{count}}": "Alle {{count}} erinnern",
  "{{count}} of {{total}}": "{{count}} von {{total}}",
  "Setup reminder sent to {{name}}.": "Erinnerung an {{name}} gesendet.",
  "Cannot be paged": "Nicht alarmierbar",
  // OnCallPolicy/EscalationRule/EscalationRules.tsx
  '"{{name}}" notifies {{responders}}.':
    "„{{name}}“ benachrichtigt {{responders}}.",
  "{{count}} users": "{{count}} Benutzer",
  "{{count}} users_one": "{{count}} Benutzer",
  "{{count}} teams": "{{count}} Teams",
  "{{count}} teams_one": "{{count}} Team",
  "{{names}} are not named on any other level of this policy.":
    "{{names}} stehen auf keiner anderen Stufe dieser Richtlinie.",
  "{{names}} are not named on any other level of this policy._one":
    "{{names}} steht auf keiner anderen Stufe dieser Richtlinie.",
  "This action cannot be undone.":
    "Diese Aktion kann nicht rückgängig gemacht werden.",
  // Monitor/SummaryView/EvaluationLogList.tsx
  "Evaluation Logs": "Auswertungsprotokolle",
  "Criteria {{number}}": "Kriterium {{number}}",
  "Condition: {{condition}}": "Bedingung: {{condition}}",
  All: "Alle",
  Any: "Beliebig",
  "{{name}}: Met": "{{name}}: Erfüllt",
  Met: "Erfüllt",
  "Not evaluated": "Nicht ausgewertet",
  "Not evaluated because {{criteria}} matched first.":
    "Nicht ausgewertet, weil zuerst {{criteria}} zutraf.",
  "Checks: {{checks}}": "Prüfungen: {{checks}}",
  "Checks: {{checks}}_one": "Prüfung: {{checks}}",
  "{{count}} matching checks": "{{count}} passende Prüfungen",
  "{{count}} matching checks_one": "{{count}} passende Prüfung",
  "{{text}} (Incident {{number}})": "{{text}} (Vorfall {{number}})",
  "Created at {{time}}": "Erstellt am {{time}}",
  "Evaluated at {{time}}": "Ausgewertet am {{time}}",
  // Monitor/SummaryView/ProbeAttemptsView.tsx
  "Retry Attempts": "Wiederholungsversuche",
  "Attempt {{number}}/{{total}}": "Versuch {{number}}/{{total}}",
  "Started {{started}} → Responded {{responded}}":
    "Gestartet {{started}} → Antwort {{responded}}",
  Failed: "Fehlgeschlagen",
  Succeeded: "Erfolgreich",
  // NotificationMethods/NotificationMethod.tsx with ReadinessTypes' sources
  "You are an on-call responder in this project, reached through {{sources}}.":
    "Sie sind in diesem Projekt in Bereitschaft, erreicht über {{sources}}.",
  "a team": "ein Team",
  "an on-call schedule": "einen Bereitschaftsplan",
  // NetworkDevice/DeviceStatusUtil.ts
  "No poll has been attempted in the last {{minutes}} minutes, so this verdict may be out of date — check that this device's probe is online and keeping up with its fleet.":
    "In den letzten {{minutes}} Minuten wurde keine Abfrage versucht; der Status kann veraltet sein.",
};

beforeAll(async () => {
  await i18next.init({
    lng: "de",
    fallbackLng: false,
    resources: { de: { translation: GERMAN } },
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
  });
});

afterEach(() => {
  cleanup();
});

type RenderInGermanFunction = (element: ReactElement) => HTMLElement;

const renderInGerman: RenderInGermanFunction = (
  element: ReactElement,
): HTMLElement => {
  return render(<I18nextProvider i18n={i18next}>{element}</I18nextProvider>)
    .container;
};

type NormalizedTextFunction = (element: Element | null) => string;

const normalizedText: NormalizedTextFunction = (
  element: Element | null,
): string => {
  return (element?.textContent || "").replace(/\s+/g, " ").trim();
};

const rotation: (intervalType: EventInterval, count: number) => Recurring = (
  intervalType: EventInterval,
  count: number,
): Recurring => {
  const value: Recurring = new Recurring();
  value.intervalType = intervalType;
  value.intervalCount = new PositiveNumber(count);
  return value;
};

const HOUR_MS: number = 60 * 60 * 1000;
const DAY_MS: number = 24 * HOUR_MS;
const NOW: Date = new Date("2026-09-14T09:00:00.000Z");

const USER_ALEX: string = "aaaaaaaa-1111-4111-8111-111111111111";
const USER_SAM: string = "bbbbbbbb-2222-4222-8222-222222222222";

const readinessSummary: (params: {
  users: Array<JSONObject>;
  isFallbackEnabled: boolean;
}) => ReadinessSummaryWire = (params: {
  users: Array<JSONObject>;
  isFallbackEnabled: boolean;
}): ReadinessSummaryWire => {
  return parseReadinessSummary({
    projectId: "dddddddd-4444-4444-8444-444444444444",
    onCallDutyPolicyId: "77777777-9999-4999-8999-999999999999",
    isFallbackEnabled: params.isFallbackEnabled,
    isTruncated: false,
    users: params.users.map((user: JSONObject): JSONObject => {
      return {
        userEmail: "someone@example.com",
        methods: [],
        coverage: [],
        reasons: [],
        reachedVia: [],
        ...user,
      };
    }),
  } as JSONObject);
};

const gapCell: (severityName: string) => JSONObject = (
  severityName: string,
): JSONObject => {
  return {
    ruleType: "When incident on-call policy is executed",
    severityId: `${severityName}-id`,
    severityName: severityName,
    hasRule: false,
    isOptOut: false,
  };
};

describe("on-call layer summaries in German", () => {
  test("a rotation reads as one German sentence, singular or plural by its count", () => {
    expect(summarizeRotation(rotation(EventInterval.Day, 1))).toBe(
      "Rotiert täglich",
    );
    expect(summarizeRotation(rotation(EventInterval.Week, 3))).toBe(
      "Rotiert alle 3 Wochen",
    );
  });

  test("window lengths and relative starts take the German form for their count", () => {
    expect(formatWindowSpan(NOW, new Date(NOW.getTime() + 14 * DAY_MS))).toBe(
      "2 Wochen",
    );
    expect(formatWindowSpan(NOW, new Date(NOW.getTime() + 91 * DAY_MS))).toBe(
      "3 Monate",
    );
    expect(formatRelativeStart(new Date(NOW.getTime() + HOUR_MS), NOW)).toBe(
      "in 1 Stunde",
    );
    expect(
      formatRelativeStart(new Date(NOW.getTime() + 5 * HOUR_MS), NOW),
    ).toBe("in 5 Stunden");
  });

  test("the start date is filled into the German sentence", () => {
    expect(summarizeStartsAt(NOW)).toMatch(/^Beginnt am /);
  });
});

describe("user overrides in German", () => {
  test("a policy-scoped override names its policy inside the German sentence", () => {
    const scope: { label: string; detail: string } = describeOverrideScope({
      onCallDutyPolicyId: "policy-1",
      policyName: "Database On-Call",
    });

    expect(scope.label).toBe("Nur für Database On-Call");
    expect(scope.detail).toBe(
      "Diese Vertretung gilt nur für die Richtlinie Database On-Call und leitet nur Alarme um, die über Database On-Call eskalieren.",
    );
    expect(describeOverrideScope({}).label).toBe("Globale Vertretung");
  });

  test("the block label keeps the override marker in front of the German words", () => {
    expect(
      formatOverrideEventTitle({
        substituteName: "Sam Doe",
        originalName: "Alex Chen",
      }),
    ).toBe(`${OVERRIDE_TITLE_MARKER} Sam Doe (vertritt Alex Chen)`);
  });

  test("covering several people takes the German plural", () => {
    const record: (overrideUserId: string) => {
      overrideUserId: string;
      routeAlertsToUserId: string;
      startsAt: Date;
      endsAt: Date;
    } = (overrideUserId: string) => {
      return {
        overrideUserId: overrideUserId,
        routeAlertsToUserId: "substitute",
        startsAt: NOW,
        endsAt: new Date(NOW.getTime() + DAY_MS),
      };
    };

    expect(
      describeSubstituteCoverage({
        substituteUserId: "substitute",
        records: [record("u1"), record("u2"), record("u3"), record("u4")],
        userInfoById: {
          u1: { name: "Alex Chen", email: "" },
          u2: { name: "Jo Park", email: "" },
          u3: { name: "Kim Lee", email: "" },
          u4: { name: "Lu Wu", email: "" },
        },
      }),
    ).toBe("Vertritt Alex Chen und 3 weitere");
  });

  test("the overrides card counts its overrides in German", () => {
    const rows: Array<OverrideSummaryRow> = [0, 1, 2, 3, 4].map(
      (index: number): OverrideSummaryRow => {
        return {
          key: `row-${index}`,
          originalUserId: USER_ALEX,
          originalName: "Alex Chen",
          substituteUserId: USER_SAM,
          substituteName: "Sam Doe",
          startsAt: new Date(NOW.getTime() + index * DAY_MS),
          endsAt: new Date(NOW.getTime() + (index + 1) * DAY_MS),
          scope: describeOverrideScope({}),
          isActiveNow: false,
        };
      },
    );

    const container: HTMLElement = renderInGerman(
      <ActiveOverridesCard rows={rows} userById={{}} timezone="UTC" />,
    );

    expect(normalizedText(container)).toContain(
      "5 Benutzervertretungen in diesem Dienstplan",
    );
    // Four rows are listed; the fifth is counted in the singular.
    expect(normalizedText(container)).toContain(
      "+ 1 weitere Vertretung später in diesem Zeitraum.",
    );
    expect(screen.getAllByText("Vertreten")).toHaveLength(4);
    expect(screen.getAllByText("Globale Vertretung")).toHaveLength(4);
    expect(normalizedText(container)).not.toContain("user override");
  });
});

describe("the final schedule summary in German", () => {
  const currentShift: OnCallShift = {
    userId: USER_ALEX,
    start: new Date(NOW.getTime() - HOUR_MS),
    end: new Date(NOW.getTime() + 8 * HOUR_MS),
    coverageSeconds: 9 * 60 * 60,
  };

  const coverage: (gaps: number) => ScheduleCoverageState = (
    gaps: number,
  ): ScheduleCoverageState => {
    return {
      status: ScheduleCoverageStatus.Covered,
      current: currentShift,
      next: null,
      gaps: Array.from({ length: gaps }, (_: unknown, index: number) => {
        const start: Date = new Date(NOW.getTime() + (index + 1) * DAY_MS);
        return { start: start, end: new Date(start.getTime() + 2 * HOUR_MS) };
      }),
      uncoveredSeconds: gaps * 2 * 60 * 60,
      coverageRatio: gaps === 0 ? 1 : 0.9,
    };
  };

  test("a fully covered window says so with the German window length", () => {
    const container: HTMLElement = renderInGerman(
      <FinalScheduleSummary
        shifts={[currentShift]}
        now={NOW}
        windowEnd={new Date(NOW.getTime() + 14 * DAY_MS)}
        timezone="UTC"
        userById={{ [USER_ALEX]: { name: "Alex Chen", email: "" } }}
        coverage={coverage(0)}
      />,
    );

    expect(
      screen.getByText("Für die nächsten 2 Wochen vollständig abgedeckt"),
    ).toBeInTheDocument();
    expect(screen.getByText("Jetzt in Bereitschaft")).toBeInTheDocument();
    expect(normalizedText(container)).toMatch(/Bis .+\(noch /);
  });

  test("a gap is one German sentence with the bold label and the duration inside it", () => {
    const container: HTMLElement = renderInGerman(
      <FinalScheduleSummary
        shifts={[currentShift]}
        now={NOW}
        windowEnd={new Date(NOW.getTime() + 14 * DAY_MS)}
        timezone="UTC"
        userById={{ [USER_ALEX]: { name: "Alex Chen", email: "" } }}
        coverage={coverage(1)}
      />,
    );

    const label: HTMLElement = screen.getByText("Abdeckungslücke:");
    expect(label.className).toContain("font-semibold");

    const sentence: string = normalizedText(label.parentElement);
    expect(sentence).toMatch(
      /^Abdeckungslücke: Von .+ bis .+ \(.+\) hat niemand Bereitschaft\.$/,
    );
    // One gap: the singular.
    expect(normalizedText(container)).toContain(
      "ohne Bereitschaft in 1 Lücke",
    );
    expect(normalizedText(container)).toContain(
      "90 % der nächsten 2 Wochen abgedeckt",
    );
  });
});

describe("responder readiness in German", () => {
  test("the consequence names the responder, counts the gaps and names the channel in German", () => {
    const summary: ReadinessSummaryWire = readinessSummary({
      isFallbackEnabled: false,
      users: [
        {
          userId: USER_ALEX,
          userName: "Alex Chen",
          status: "PartiallyReady",
          methods: [
            {
              methodType: "Email",
              maskedIdentifier: "a•••@example.com",
              isVerified: true,
            },
          ],
          coverage: [gapCell("Sev1"), gapCell("Sev2")],
        },
        {
          userId: USER_SAM,
          userName: "Sam Doe",
          status: "NotReachable",
          methods: [
            {
              methodType: "Email",
              maskedIdentifier: "s•••@example.com",
              isVerified: true,
            },
          ],
        },
      ],
    });

    const alex: UserReadinessWire = summary.users[0]!;
    const sam: UserReadinessWire = summary.users[1]!;

    expect(getStatusConsequence(alex, { isFallbackEnabled: false })).toBe(
      "Alex Chen hat 2 Regellücken, und die Ersatzbenachrichtigung ist in diesem Projekt ausgeschaltet. Diese Alarme gehen verloren.",
    );
    expect(getStatusShortLabel(alex)).toBe("2 Lücken");
    expect(getStatusConsequence(sam, { isFallbackEnabled: true })).toBe(
      "Sam Doe ist nur über E-Mail erreichbar, und diese Kanäle sind in diesem Projekt ausgeschaltet, daher geht jeder Alarm verloren.",
    );
  });

  test("a single gap takes the German singular", () => {
    const summary: ReadinessSummaryWire = readinessSummary({
      isFallbackEnabled: false,
      users: [
        {
          userId: USER_ALEX,
          userName: "Alex Chen",
          status: "PartiallyReady",
          coverage: [gapCell("Sev1")],
        },
      ],
    });

    expect(
      getStatusConsequence(summary.users[0]!, { isFallbackEnabled: false }),
    ).toBe(
      "Alex Chen hat eine Regellücke, und die Ersatzbenachrichtigung ist in diesem Projekt ausgeschaltet. Dieser Alarm geht verloren.",
    );
    expect(getStatusShortLabel(summary.users[0]!)).toBe("1 Lücke");
  });

  test("where a responder came from is one German sentence, joined the German way", () => {
    expect(
      describeResponderVia([
        { kind: "direct", label: "" },
        { kind: "team", label: "Payments" },
        { kind: "schedule", label: "Weekends" },
      ]),
    ).toBe(
      "Erreicht direkt, über das Team Payments und über den Dienstplan Weekends.",
    );
  });
});

describe("an escalation level's readiness in German", () => {
  const unreachableReport: () => RuleReadinessReport =
    (): RuleReadinessReport => {
      const summary: ReadinessSummaryWire = readinessSummary({
        isFallbackEnabled: true,
        users: [
          { userId: USER_ALEX, userName: "Alex Chen", status: "NotReachable" },
          { userId: USER_SAM, userName: "Sam Doe", status: "NotReachable" },
        ],
      });

      return {
        ...EMPTY_RULE_READINESS_REPORT,
        unreachable: summary.users.map((user: UserReadinessWire) => {
          return {
            userId: user.userId,
            name: user.userName,
            kind: "unreachable" as const,
            readiness: user,
            via: [],
          };
        }),
        responderCount: 2,
        checkedCount: 2,
      };
    };

  test("the label counts in German and its accessible name is one German sentence", () => {
    const report: RuleReadinessReport = unreachableReport();

    expect(getRuleWarningLabel(report, { isFallbackEnabled: true })).toBe(
      "2 Personen können nicht alarmiert werden",
    );
    expect(
      getRuleWarningLabel(
        { ...report, unreachable: report.unreachable.slice(0, 1) },
        { isFallbackEnabled: true },
      ),
    ).toBe("1 Person kann nicht alarmiert werden");

    renderInGerman(
      <RuleReadinessLabel
        report={report}
        delivery={{ isFallbackEnabled: true }}
        ruleName="First Responders"
        onClick={() => {}}
      />,
    );

    const label: HTMLElement = screen.getByTestId("rule-readiness-label");
    expect(label).toHaveTextContent("2 Personen können nicht alarmiert werden");
    expect(label.getAttribute("aria-label")).toBe(
      "2 Personen können nicht alarmiert werden in First Responders. Sehen Sie nach, wer, und senden Sie eine Erinnerung.",
    );
  });

  test("the details modal counts, offers the batch reminder and reports a sent one in German", () => {
    renderInGerman(
      <RuleReadinessDetails
        ruleName="First Responders"
        report={unreachableReport()}
        delivery={{ isFallbackEnabled: true }}
        reminders={{
          [USER_SAM]: { state: "sent", message: "" },
        }}
        onSendReminder={() => {}}
        isSendingReminders={false}
        onClose={() => {}}
      />,
    );

    expect(
      screen.getByText(
        "Ob die 2 Personen dieser Stufe tatsächlich alarmiert werden können.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Nicht alarmierbar")).toBeInTheDocument();
    expect(screen.getByText("2 von 2")).toBeInTheDocument();
    expect(screen.getByTestId("setup-reminder-sent")).toHaveTextContent(
      "Erinnerung an Sam Doe gesendet.",
    );
  });
});

describe("deleting an escalation level, in German", () => {
  test("the confirmation counts what is removed and who loses their only level", () => {
    expect(
      describeEscalationRuleDeletion("Weekend Cover", {
        userCount: 2,
        teamCount: 1,
        scheduleCount: 0,
        usersNamedNowhereElse: ["Alex Chen"],
        isLastRule: false,
      }),
    ).toBe(
      "„Weekend Cover“ benachrichtigt 2 Benutzer und 1 Team. Alex Chen steht auf keiner anderen Stufe dieser Richtlinie. Diese Aktion kann nicht rückgängig gemacht werden.",
    );
  });
});

describe("a monitor's evaluation log in German", () => {
  const summary: MonitorEvaluationSummary = {
    evaluatedAt: NOW,
    criteriaResults: [
      {
        filterCondition: FilterCondition.All,
        met: true,
        message: "",
        filters: [
          { checkOn: CheckOn.IsOnline, message: "Monitor is online", met: true },
          { checkOn: CheckOn.IsOnline, message: "Monitor is online", met: true },
        ],
      },
      {
        criteriaName: "Degraded",
        filterCondition: FilterCondition.Any,
        met: false,
        message: "",
        filters: [],
        skipped: true,
        skipCause: "earlier-criterion-matched",
      },
    ],
    events: [
      {
        type: "incident-created",
        title: "Incident created",
        relatedIncidentId: "eeeeeeee-1111-4111-8111-111111111111",
        relatedIncidentNumber: 12,
        at: NOW,
      },
    ],
  };

  test("criteria, conditions and counts read in German", () => {
    const container: HTMLElement = renderInGerman(
      <EvaluationLogList evaluationSummary={summary} />,
    );

    expect(screen.getByText("Auswertungsprotokolle")).toBeInTheDocument();
    // A criteria with no name is numbered in German.
    expect(
      screen.getByRole("group", { name: "Kriterium 1: Erfüllt" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Bedingung: Alle")).toBeInTheDocument();
    // Two identical checks collapse into one row, counted in the plural.
    expect(normalizedText(container)).toContain(
      "Prüfung: Is Online • 2 passende Prüfungen",
    );
    expect(normalizedText(container)).toMatch(/Ausgewertet am /);
  });

  test("a skipped criteria names the one that matched first inside the German sentence", () => {
    renderInGerman(<EvaluationLogList evaluationSummary={summary} />);

    const skipped: HTMLElement = screen.getByRole("group", {
      name: "Degraded: Nicht ausgewertet",
    });
    const name: HTMLElement = screen.getByText("“Kriterium 1”");

    expect(name.className).toContain("font-medium");
    expect(normalizedText(name.parentElement)).toBe(
      "Nicht ausgewertet, weil zuerst “Kriterium 1” zutraf.",
    );
    expect(skipped).toHaveTextContent("Bedingung: Beliebig");
  });

  test("an action names its incident and time in German", () => {
    const container: HTMLElement = renderInGerman(
      <EvaluationLogList evaluationSummary={summary} />,
    );

    expect(
      screen.getByText("Incident created (Vorfall #12)"),
    ).toBeInTheDocument();
    expect(normalizedText(container)).toMatch(/Erstellt am /);
  });
});

describe("a probe's retry attempts in German", () => {
  test("each attempt is numbered and timed in German", () => {
    const attempts: Array<ProbeAttempt> = [1, 2].map(
      (attemptNumber: number): ProbeAttempt => {
        return {
          attemptNumber: attemptNumber,
          attemptedAt: new Date(NOW.getTime() + attemptNumber * 1000),
          responseReceivedAt: new Date(NOW.getTime() + attemptNumber * 1500),
          isOnline: attemptNumber === 2,
        };
      },
    );

    const container: HTMLElement = renderInGerman(
      <ProbeAttemptsView attempts={attempts} />,
    );

    expect(screen.getByText("Wiederholungsversuche")).toBeInTheDocument();
    expect(screen.getByText("Versuch 1/2")).toBeInTheDocument();
    expect(screen.getByText("Versuch 2/2")).toBeInTheDocument();
    expect(screen.getByText("Fehlgeschlagen")).toBeInTheDocument();
    expect(screen.getByText("Erfolgreich")).toBeInTheDocument();
    expect(normalizedText(container)).toMatch(/Gestartet .+ → Antwort .+/);
    expect(normalizedText(container)).not.toContain("Attempt");
  });
});

describe("plain helpers in German", () => {
  test("on-call exposure lists where the reader is reached, in German", () => {
    expect(
      describeOnCallExposure({
        isKnown: true,
        isOnCallResponder: true,
        sources: ["Team", "Schedule"],
      }),
    ).toBe(
      "Sie sind in diesem Projekt in Bereitschaft, erreicht über ein Team und einen Bereitschaftsplan.",
    );
  });

  test("the stale-device tooltip fills its window into the German sentence", () => {
    expect(getStaleTooltip(15)).toBe(
      "In den letzten 15 Minuten wurde keine Abfrage versucht; der Status kann veraltet sein.",
    );
  });
});
