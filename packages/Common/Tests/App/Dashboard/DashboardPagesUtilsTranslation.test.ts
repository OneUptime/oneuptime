import { beforeAll, describe, expect, test } from "@jest/globals";
import i18next from "i18next";
import {
  describeSloMonitorCounts,
  SloMonitorMembership,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/Utils/SloMonitorSource";
import {
  describeSloErrorBudget,
  describeSloWindow,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/SloSettingsFormFields";
import {
  BURN_RATE_RULE_FORM_FIELDS,
  describeBurnRateOutputOptions,
  describeBurnRateOutputs,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/Utils/BurnRateRuleForm";
import {
  buildInvestigationFindings,
  InvestigationEvidence,
  InvestigationFinding,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/InvestigationFindings";
import {
  parseStatusPageGroupCsv,
  STATUS_PAGE_GROUP_CSV_COLUMNS,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/StatusPageGroupCsv";
import { getExceptionLogsViewerScopes } from "../../../../App/FeatureSet/Dashboard/src/Utils/ExceptionLogsScope";
import { EXCEPTION_LOG_WINDOW_MS } from "../../../../App/FeatureSet/Dashboard/src/Utils/ExceptionCorrelation";
import CriteriaFilterUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import { buildDetectionRuleMonitorPrefill } from "../../../../App/FeatureSet/Dashboard/src/Utils/SecurityEventsMonitorPrefill";
import { describeEvidenceTool } from "../../../../App/FeatureSet/Dashboard/src/Utils/InvestigationEvidenceFormat";
import { summarizeCloudFleet } from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/Utils/CloudFleetSummary";
import {
  getVariableNameFormField,
  getWorkflowVariableReference,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Workflow/WorkflowVariableUtil";
import { buildSyncResultSummary } from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorTemplateSyncResultUtil";
import SloWindowType from "../../../Types/ServiceLevelObjective/SloWindowType";
import { DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE } from "../../../Utils/Slo/SloBurnRateTemplate";
import { formatDurationCompact } from "../../../Utils/Slo/SloDuration";
import { translateText } from "../../../UI/Utils/TranslateTemplate";
import { JSONObject } from "../../../Types/JSON";

/*
 * The Dashboard's page helpers and Utils run outside React - a table cell's
 * text, a CSV parser's errors, a form field's description, an investigation's
 * findings - so they translate through the global i18next instance the
 * Dashboard sets up in Utils/i18n.ts. Before it is set up (and in the App
 * suite, which never sets it up) every one of them answers in English, word
 * for word what it said before it was translated.
 *
 * The German below is a test locale: each key is the English source text,
 * exactly as Locales/en.json keys it, and the plural keys follow the
 * Dashboard's convention (the "other" form, plus "_one").
 */

const GERMAN: Record<string, string> = {
  // Pages/Slo/Utils/SloMonitorSource.ts
  "No monitors attached": "Keine Monitore zugeordnet",
  "{{count}} monitors, all attached by hand":
    "{{count}} Monitore, alle von Hand zugeordnet",
  "{{count}} monitors, all attached by hand_one":
    "{{count}} Monitor, von Hand zugeordnet",
  "{{count}} monitors: {{byRules}} attached by monitor rules, {{byHand}} by hand":
    "{{count}} Monitore: {{byRules}} durch Monitorregeln, {{byHand}} von Hand",
  // Pages/Slo/SloSettingsFormFields.ts
  "Calendar month ({{timezone}})": "Kalendermonat ({{timezone}})",
  "Rolling {{count}}-day window": "Gleitendes {{count}}-Tage-Fenster",
  "Rolling {{count}}-day window_one": "Gleitendes 1-Tages-Fenster",
  "{{percentage}}% of each month: {{budget}} of downtime in a 30-day month":
    "{{percentage}} % jedes Monats: {{budget}} Ausfallzeit in einem 30-Tage-Monat",
  "{{budget}} of downtime per {{count}}-day window":
    "{{budget}} Ausfallzeit pro {{count}}-Tage-Fenster",
  // Pages/Slo/Utils/BurnRateRuleForm.ts
  "Title of the alert this rule raises. Leave empty to use the default: {{defaultTitle}}":
    "Titel des Alarms, den diese Regel auslöst. Leer lassen für den Standard: {{defaultTitle}}",
  "Alert + Incident": "Alarm + Vorfall",
  "Alert: resolved by hand, private": "Alarm: von Hand gelöst, privat",
  // Utils/InvestigationFindings.ts
  "{{change}} landed {{count}} minutes before the end of this window — deployments and config changes are the most common cause of behavior shifts.":
    "{{change}} kam {{count}} Minuten vor dem Ende dieses Zeitfensters — Deployments und Konfigurationsänderungen sind die häufigste Ursache für Verhaltensänderungen.",
  "{{change}} landed {{count}} minutes before the end of this window — deployments and config changes are the most common cause of behavior shifts._one":
    "{{change}} kam {{count}} Minute vor dem Ende dieses Zeitfensters — Deployments und Konfigurationsänderungen sind die häufigste Ursache für Verhaltensänderungen.",
  "{{marker}} was declared inside this window — it may share this root cause.":
    "{{marker}} wurde in diesem Zeitfenster gemeldet — es könnte dieselbe Ursache haben.",
  // Utils/StatusPageGroupCsv.ts
  'Unknown column "{{column}}" in header. Expected columns: {{columns}}.':
    "Unbekannte Spalte „{{column}}“ in der Kopfzeile. Erwartete Spalten: {{columns}}.",
  'Missing required column "{{column}}" in header.':
    "Pflichtspalte „{{column}}“ fehlt in der Kopfzeile.",
  // Utils/ExceptionLogsScope.ts
  "Every log written during the latest occurrence's trace, within {{minutes}} minutes either side of it.":
    "Jedes Log aus dem Trace des letzten Auftretens, bis zu {{minutes}} Minuten davor und danach.",
  // Utils/Form/Monitor/CriteriaFilter.ts
  "{{count}} Minutes": "{{count}} Minuten",
  "{{count}} Minutes_one": "{{count}} Minute",
  // Utils/SecurityEventsMonitorPrefill.ts
  'Watches Detection Finding events written by the "{{ruleName}}" detection rule. Fires on the rate of detections, not just their occurrence.':
    "Beobachtet Detection-Finding-Ereignisse der Erkennungsregel „{{ruleName}}“. Löst bei der Rate der Erkennungen aus, nicht schon bei ihrem Auftreten.",
  // Utils/InvestigationEvidenceFormat.ts
  "Ran {{query}}": "Ausgeführt: {{query}}",
  // Pages/Cloud/Utils/CloudFleetSummary.ts
  "{{percent}}% of environments": "{{percent}} % der Umgebungen",
  // Utils/Workflow/WorkflowVariableUtil.ts
  "Workflows refer to this variable by name, as {{reference}}. Renaming it does not update workflows that already refer to the old name.":
    "Workflows verweisen per Namen auf diese Variable, als {{reference}}. Eine Umbenennung ändert keine Workflows, die schon den alten Namen verwenden.",
  // Pages/Monitor/Settings/MonitorTemplateSyncResultUtil.ts
  "Synced {{subject}} onto {{count}} monitors ({{total}} linked to this template).":
    "{{subject}} auf {{count}} Monitore übertragen ({{total}} mit dieser Vorlage verknüpft).",
  labels: "Labels",
};

const NOW: Date = new Date("2026-09-14T12:00:00.000Z");
const OCCURRED_AT: Date = new Date("2026-09-14T11:00:00.000Z");
const TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";
const WINDOW_MINUTES: number = Math.round(EXCEPTION_LOG_WINDOW_MS / 60000);

const WINDOW_START_MS: number = new Date("2026-08-20T10:00:00.000Z").getTime();
const WINDOW_END_MS: number = new Date("2026-08-20T10:30:00.000Z").getTime();

type MembershipFunction = (
  monitorIds: Array<string>,
  ruleAttachedMonitorIds: Array<string>,
) => SloMonitorMembership;

const membership: MembershipFunction = (
  monitorIds: Array<string>,
  ruleAttachedMonitorIds: Array<string>,
): SloMonitorMembership => {
  return {
    monitorIds: monitorIds,
    ruleAttachedMonitorIds: new Set<string>(ruleAttachedMonitorIds),
  };
};

type EvidenceFunction = (
  overrides?: Partial<InvestigationEvidence>,
) => InvestigationEvidence;

const evidence: EvidenceFunction = (
  overrides: Partial<InvestigationEvidence> = {},
): InvestigationEvidence => {
  return {
    windowStartMs: WINDOW_START_MS,
    windowEndMs: WINDOW_END_MS,
    scopeChips: [],
    logVolume: {
      total: 1000,
      errorCount: 20,
      warnCount: 0,
      errorRatePercent: 2,
      severities: [],
      series: [],
    },
    errorPatterns: [],
    logBuckets: [],
    markers: [],
    ...overrides,
  } as InvestigationEvidence;
};

type AlertTitleDescriptionFunction = () => unknown;

const alertTitleDescription: AlertTitleDescriptionFunction = (): unknown => {
  const field: (typeof BURN_RATE_RULE_FORM_FIELDS)[number] | undefined =
    BURN_RATE_RULE_FORM_FIELDS.find(
      (candidate: (typeof BURN_RATE_RULE_FORM_FIELDS)[number]): boolean => {
        return Object.keys(candidate.field || {})[0] === "alertTitleTemplate";
      },
    );

  if (!field) {
    throw new Error("The burn rate form has no alertTitleTemplate field");
  }

  return field.description;
};

type FindingTextsFunction = (data: InvestigationEvidence) => Array<string>;

const findingTexts: FindingTextsFunction = (
  data: InvestigationEvidence,
): Array<string> => {
  return buildInvestigationFindings(data).map(
    (finding: InvestigationFinding): string => {
      return finding.text;
    },
  );
};

describe("before the Dashboard sets up i18next, the helpers answer in English", () => {
  test("SLO monitor counts keep their English singular and plural", () => {
    expect(describeSloMonitorCounts(membership([], []))).toBe(
      "No monitors attached",
    );
    expect(describeSloMonitorCounts(membership(["a"], []))).toBe(
      "1 monitor, all attached by hand",
    );
    expect(describeSloMonitorCounts(membership(["a", "b", "c"], ["a"]))).toBe(
      "3 monitors: 1 attached by monitor rules, 2 by hand",
    );
  });

  test("an SLO's window and error budget read as they did", () => {
    expect(
      describeSloWindow({
        windowType: SloWindowType.CalendarMonth,
        timezone: undefined,
      }),
    ).toBe("Calendar month (UTC)");
    expect(
      describeSloWindow({ windowType: SloWindowType.Rolling, windowDays: 7 }),
    ).toBe("Rolling 7-day window");
  });

  test("the burn rate form's title description names the default title", () => {
    expect(alertTitleDescription()).toBe(
      `Title of the alert this rule raises. Leave empty to use the default: ${DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE}`,
    );
  });

  test("a change marker's lead time is spelled out in English", () => {
    expect(
      findingTexts(
        evidence({
          markers: [
            {
              kind: "change",
              label: "Deploy: v2.31.0",
              timeMs: WINDOW_END_MS - 60000,
            },
          ],
        }),
      )[0],
    ).toBe(
      "Deploy: v2.31.0 landed 1 minute before the end of this window — deployments and config changes are the most common cause of behavior shifts.",
    );
  });

  test("the evaluate-over-time options say Minute and Minutes", () => {
    expect(
      CriteriaFilterUtil.getEvaluateOverTimeMinutesOptions()[0]?.label,
    ).toBe("2 Minutes");
  });

  test("a template sync keeps its raw counts", () => {
    expect(
      buildSyncResultSummary({
        subject: "labels",
        syncedMonitors: 10000,
        totalLinkedMonitors: 10000,
      }).message,
    ).toBe(
      "Synced labels onto 10000 monitors (10000 linked to this template).",
    );
  });
});

describe("in German, the page helpers and Utils translate whole sentences", () => {
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

  test("the SLO monitor counts pick the German plural form, with every count filled in", () => {
    expect(describeSloMonitorCounts(membership([], []))).toBe(
      "Keine Monitore zugeordnet",
    );
    expect(describeSloMonitorCounts(membership(["a"], []))).toBe(
      "1 Monitor, von Hand zugeordnet",
    );
    expect(describeSloMonitorCounts(membership(["a", "b"], []))).toBe(
      "2 Monitore, alle von Hand zugeordnet",
    );
    expect(describeSloMonitorCounts(membership(["a", "b", "c"], ["a"]))).toBe(
      "3 Monitore: 1 durch Monitorregeln, 2 von Hand",
    );
  });

  test("an SLO's window and error budget are German sentences around the numbers", () => {
    expect(
      describeSloWindow({
        windowType: SloWindowType.CalendarMonth,
        timezone: undefined,
      }),
    ).toBe("Kalendermonat (UTC)");
    expect(
      describeSloWindow({ windowType: SloWindowType.Rolling, windowDays: 1 }),
    ).toBe("Gleitendes 1-Tages-Fenster");
    expect(
      describeSloWindow({ windowType: SloWindowType.Rolling, windowDays: 28 }),
    ).toBe("Gleitendes 28-Tage-Fenster");

    // 99.9% over 30 days allows 0.1% of 30 days.
    const budget: string = formatDurationCompact(
      Math.round(0.001 * 30 * 24 * 60 * 60),
    );

    expect(
      describeSloErrorBudget({
        targetPercentage: 99.9,
        windowType: SloWindowType.Rolling,
        windowDays: 30,
      }),
    ).toBe(`${budget} Ausfallzeit pro 30-Tage-Fenster`);
    expect(
      describeSloErrorBudget({
        targetPercentage: 99.9,
        windowType: SloWindowType.CalendarMonth,
      }),
    ).toBe(`0.1 % jedes Monats: ${budget} Ausfallzeit in einem 30-Tage-Monat`);
  });

  test("the burn rate form's description is read in the language of the moment", () => {
    expect(alertTitleDescription()).toBe(
      `Titel des Alarms, den diese Regel auslöst. Leer lassen für den Standard: ${DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE}`,
    );
  });

  test("the burn rate table's labels stay English keys the page translates", () => {
    const declares: string = describeBurnRateOutputs({
      shouldCreateAlert: true,
      shouldCreateIncident: true,
    } as Parameters<typeof describeBurnRateOutputs>[0]);
    const options: Array<string> = describeBurnRateOutputOptions({
      autoResolveAlert: false,
      isAlertPrivate: true,
    });

    expect(declares).toBe("Alert + Incident");
    expect(options).toEqual(["Alert: resolved by hand, private"]);
    expect(translateText(declares)).toBe("Alarm + Vorfall");
    expect(translateText(options[0])).toBe("Alarm: von Hand gelöst, privat");
  });

  test("an investigation's findings are German, the lead time in its plural form", () => {
    const one: Array<string> = findingTexts(
      evidence({
        markers: [
          {
            kind: "change",
            label: "Deploy: v2.31.0",
            timeMs: WINDOW_END_MS - 60000,
          },
        ],
      }),
    );
    const several: Array<string> = findingTexts(
      evidence({
        markers: [
          {
            kind: "change",
            label: "Deploy: v2.31.0",
            timeMs: WINDOW_END_MS - 3 * 60000,
          },
          {
            kind: "incident",
            label: "Incident: API down",
            timeMs: WINDOW_END_MS - 60000,
          },
        ],
      }),
    );

    expect(one[0]).toBe(
      "Deploy: v2.31.0 kam 1 Minute vor dem Ende dieses Zeitfensters — Deployments und Konfigurationsänderungen sind die häufigste Ursache für Verhaltensänderungen.",
    );
    expect(several[0]).toBe(
      "Deploy: v2.31.0 kam 3 Minuten vor dem Ende dieses Zeitfensters — Deployments und Konfigurationsänderungen sind die häufigste Ursache für Verhaltensänderungen.",
    );
    expect(several).toContain(
      "Incident: API down wurde in diesem Zeitfenster gemeldet — es könnte dieselbe Ursache haben.",
    );
  });

  test("a status page groups CSV reports its header problems in German", () => {
    const result: ReturnType<typeof parseStatusPageGroupCsv> =
      parseStatusPageGroupCsv("title,bogus\nCore,1\n");
    const messages: Array<string> = result.errors.map(
      (error: { message: string }): string => {
        return error.message;
      },
    );

    expect(messages).toContain(
      `Unbekannte Spalte „bogus“ in der Kopfzeile. Erwartete Spalten: ${STATUS_PAGE_GROUP_CSV_COLUMNS.join(", ")}.`,
    );
    expect(messages).toContain("Pflichtspalte „name“ fehlt in der Kopfzeile.");
  });

  test("the exception log scopes say their window in German", () => {
    const scopes: ReturnType<typeof getExceptionLogsViewerScopes> =
      getExceptionLogsViewerScopes({
        traceId: TRACE_ID,
        primaryEntityId: "",
        time: OCCURRED_AT,
        now: NOW,
      });

    expect(scopes[0]?.description).toBe(
      `Jedes Log aus dem Trace des letzten Auftretens, bis zu ${WINDOW_MINUTES} Minuten davor und danach.`,
    );
  });

  test("the evaluate-over-time options use the German plural", () => {
    const labels: Array<string> =
      CriteriaFilterUtil.getEvaluateOverTimeMinutesOptions().map(
        (option: { label: string }): string => {
          return option.label;
        },
      );

    expect(labels).toContain("2 Minuten");
    expect(labels).toContain("60 Minuten");
    expect(labels.join(" ")).not.toContain("Minutes");
  });

  test("a detection rule's monitor prefill describes it in German", () => {
    const prefill: JSONObject = buildDetectionRuleMonitorPrefill({
      ruleId: "rule-1",
      ruleName: "Impossible travel",
      operationalStatusId: null,
    });

    expect(prefill["description"]).toBe(
      "Beobachtet Detection-Finding-Ereignisse der Erkennungsregel „Impossible travel“. Löst bei der Rate der Erkennungen aus, nicht schon bei ihrem Auftreten.",
    );
  });

  test("an unknown evidence tool is described in German around its name", () => {
    expect(
      describeEvidenceTool("frobnicate_widgets").description.startsWith(
        "Ausgeführt: ",
      ),
    ).toBe(true);
  });

  test("the cloud fleet's connected tile fills its percentage into German", () => {
    const tiles: ReturnType<typeof summarizeCloudFleet> = summarizeCloudFleet({
      total: 4,
      connected: 3,
      disconnected: 1,
      byProvider: {},
      liveInstances: 0,
    });
    const sublabels: Array<string> = tiles.map(
      (tile: { sublabel?: string | undefined }): string => {
        return tile.sublabel || "";
      },
    );

    expect(sublabels).toContain("75 % der Umgebungen");
  });

  test("a workflow variable's name field explains its reference in German", () => {
    const reference: string = getWorkflowVariableReference({
      name: "THIS_NAME",
      isGlobal: false,
    });

    expect(getVariableNameFormField({ isGlobal: false }).description).toBe(
      `Workflows verweisen per Namen auf diese Variable, als ${reference}. Eine Umbenennung ändert keine Workflows, die schon den alten Namen verwenden.`,
    );
  });

  test("a template sync names its subject and counts in German", () => {
    expect(
      buildSyncResultSummary({
        subject: "labels",
        syncedMonitors: 2,
        totalLinkedMonitors: 2,
      }).message,
    ).toBe(
      "Labels auf 2 Monitore übertragen (2 mit dieser Vorlage verknüpft).",
    );
  });

  test("a sentence with no German yet falls back to English, still filled in", () => {
    expect(describeSloMonitorCounts(membership(["a", "b"], ["a", "b"]))).toBe(
      "2 monitors, all attached by monitor rules",
    );
  });
});
