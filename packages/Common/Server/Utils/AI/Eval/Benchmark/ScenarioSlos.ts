import { JSONObject } from "../../../../../Types/JSON";
import SloWindowType from "../../../../../Types/ServiceLevelObjective/SloWindowType";
import { DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE } from "../../../../../Utils/Slo/SloHealth";
import {
  getSloRecommendedBurnRateRules,
  SloRecommendedAlertSeverity,
  SloRecommendedBurnRateRule,
} from "../../../../../Utils/Slo/SloRecommendedBurnRateRules";
import SloUtil from "../../../../../Utils/Slo/SloUtil";
import {
  COMPLIANCE_NOTE,
  DEPLOYMENT_GATE_NOTE,
} from "../../Toolbox/SloTools";
import { BenchmarkToolResponse } from "./BenchmarkScenario";

/*
 * A benchmark scenario's SLOs, answered as query_slos answers (#7766): the
 * list, with the deploy-gate and compliance notes the tool writes before
 * its rows, and each SLO in full when its sloId is asked for - the SLO's
 * row, then its burn-rate rules - with the same notes. The rules are the
 * three OneUptime gives every SLO, scaled to its window
 * (getSloRecommendedBurnRateRules), so the tool writes no note of rules
 * the SLO lacks.
 *
 * One definition per SLO feeds both answers, so the list and the full read
 * of an SLO never disagree on its figures.
 */

export interface ScenarioSlo {
  id: string;
  name: string;
  description?: string | undefined;
  // The monitors it counts, by name.
  monitors: Array<string>;
  targetPercentage: number;
  // A rolling window of this many days.
  windowDays: number;
  sloStatus: string;
  currentSliPercentage: number;
  errorBudgetRemainingPercentage: number;
  currentBurnRate: number;
  lastEvaluatedAt: string;
}

// The project's most and least severe alert severities, as its rules name them.
export const SCENARIO_MOST_SEVERE_ALERT_SEVERITY: string = "Critical";
export const SCENARIO_LEAST_SEVERE_ALERT_SEVERITY: string = "Low";

// The monitor statuses an uptime SLO counts as down.
export const SCENARIO_DOWNTIME_MONITOR_STATUSES: string = "Offline";

const SECONDS_IN_A_DAY: number = 24 * 60 * 60;

// What query_slos writes before the rows of an SLO it lists or reads.
export const SCENARIO_SLO_NOTES: Array<string> = [
  DEPLOYMENT_GATE_NOTE,
  COMPLIANCE_NOTE,
];

export default class ScenarioSlos {
  // The SLO as query_slos lists it.
  public static getListRow(slo: ScenarioSlo): JSONObject {
    return {
      id: slo.id,
      name: slo.name,
      isEnabled: true,
      sliType: "Monitor Uptime",
      targetPercentage: slo.targetPercentage,
      window: this.describeWindow(slo),
      monitors: slo.monitors.join(", "),
      sloStatus: slo.sloStatus,
      currentSliPercentage: slo.currentSliPercentage,
      errorBudgetRemainingPercentage: slo.errorBudgetRemainingPercentage,
      currentBurnRate: slo.currentBurnRate,
      deploymentsAllowed: true,
      lastEvaluatedAt: slo.lastEvaluatedAt,
    };
  }

  // The SLO's own row when it is read by its sloId: its full definition.
  public static getFullRow(slo: ScenarioSlo): JSONObject {
    const budget: { budgetRemainingSeconds: number; budgetTotalSeconds: number } =
      SloUtil.getErrorBudget({
        sliPercentage: slo.currentSliPercentage,
        totalSeconds: slo.windowDays * SECONDS_IN_A_DAY,
        targetPercentage: slo.targetPercentage,
      });

    return {
      record: "slo",
      id: slo.id,
      name: slo.name,
      description: slo.description,
      isEnabled: true,
      isArchived: false,
      sliType: "Monitor Uptime",
      targetPercentage: slo.targetPercentage,
      window: this.describeWindow(slo),
      atRiskThresholdPercentage: DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE,
      sloStatus: slo.sloStatus,
      currentSliPercentage: slo.currentSliPercentage,
      errorBudgetRemainingPercentage: slo.errorBudgetRemainingPercentage,
      errorBudgetRemainingSeconds: Math.round(budget.budgetRemainingSeconds),
      errorBudgetTotalSeconds: Math.round(budget.budgetTotalSeconds),
      currentBurnRate: slo.currentBurnRate,
      deploymentsAllowed: true,
      lastEvaluatedAt: slo.lastEvaluatedAt,
      monitors: slo.monitors.join(", "),
      downtimeMonitorStatuses: SCENARIO_DOWNTIME_MONITOR_STATUSES,
    };
  }

  /*
   * Its burn-rate rules, as query_slos writes them: OneUptime's three,
   * scaled to its window, each raising an alert and declaring no incident.
   */
  public static getBurnRateRuleRows(slo: ScenarioSlo): Array<JSONObject> {
    return getSloRecommendedBurnRateRules({
      windowType: SloWindowType.Rolling,
      windowDays: slo.windowDays,
    }).map((rule: SloRecommendedBurnRateRule, index: number): JSONObject => {
      return {
        record: "burnRateRule",
        id: `${slo.id.substring(0, slo.id.length - 2)}b${index + 1}`,
        name: rule.name,
        isEnabled: true,
        burnRateThreshold: rule.burnRateThreshold,
        longWindowInMinutes: rule.longWindowInMinutes,
        shortWindowInMinutes: rule.shortWindowInMinutes,
        ...(rule.refireSuppressionMinutes !== null
          ? { refireSuppressionMinutes: rule.refireSuppressionMinutes }
          : {}),
        createsAlert: true,
        alertSeverity:
          rule.alertSeverity === SloRecommendedAlertSeverity.LeastSevere
            ? SCENARIO_LEAST_SEVERE_ALERT_SEVERITY
            : SCENARIO_MOST_SEVERE_ALERT_SEVERITY,
        createsIncident: false,
        hasAlertTitleTemplate: false,
        hasAlertDescriptionTemplate: false,
        alertLabelCount: 0,
        alertOwnerTeamCount: 0,
        alertOwnerUserCount: 0,
        isAlertPrivate: false,
        autoResolveAlert: true,
        addSloOwnersAsOwners: false,
      };
    });
  }

  // What query_slos answers when it lists the SLOs.
  public static getListResponse(
    slos: Array<ScenarioSlo>,
  ): BenchmarkToolResponse {
    return {
      toolName: "query_slos",
      citationLabel: `SLOs (${slos.length} found)`,
      notes: SCENARIO_SLO_NOTES,
      rows: slos.map((slo: ScenarioSlo): JSONObject => {
        return this.getListRow(slo);
      }),
    };
  }

  // What query_slos answers for one SLO's sloId: the SLO in full.
  public static getSloResponse(slo: ScenarioSlo): BenchmarkToolResponse {
    return {
      toolName: "query_slos",
      whenArguments: { sloId: slo.id },
      citationLabel: `SLO ${slo.name}`,
      notes: SCENARIO_SLO_NOTES,
      rows: [this.getFullRow(slo), ...this.getBurnRateRuleRows(slo)],
    };
  }

  /*
   * Both: each SLO's own answer first, so its sloId reaches it, then the
   * list, which answers every other call of the tool.
   */
  public static getResponses(
    slos: Array<ScenarioSlo>,
  ): Array<BenchmarkToolResponse> {
    return [
      ...slos.map((slo: ScenarioSlo): BenchmarkToolResponse => {
        return this.getSloResponse(slo);
      }),
      this.getListResponse(slos),
    ];
  }

  private static describeWindow(slo: ScenarioSlo): string {
    return `${SloWindowType.Rolling} ${slo.windowDays}d`;
  }
}
