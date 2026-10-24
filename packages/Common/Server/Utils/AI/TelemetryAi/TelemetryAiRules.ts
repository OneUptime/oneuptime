import AutoRemediationRuleService from "../../../Services/AutoRemediationRuleService";
import ServiceService from "../../../Services/ServiceService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger from "../../Logger";
import { RuleEvaluation } from "../../PatternWorkScope";
import logIfRuleReadWasTruncated from "../../Rules/RuleEngineRuleRead";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import AIInsight from "../../../../Models/DatabaseModels/AIInsight";
import AutoRemediationRule from "../../../../Models/DatabaseModels/AutoRemediationRule";
import Label from "../../../../Models/DatabaseModels/Label";
import Project from "../../../../Models/DatabaseModels/Project";
import Service from "../../../../Models/DatabaseModels/Service";
import {
  TELEMETRY_AI_LANES,
  TELEMETRY_AI_LANE_LIST,
  TelemetryAiLane,
  TelemetryAiRuleFacts,
  TelemetryAiWork,
  decideTelemetryAiWork,
  getTelemetryAiLaneOfInsightType,
} from "../../../../Types/AI/TelemetryAi";
import ObjectID from "../../../../Types/ObjectID";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../../../Utils/Rules/RuleEngineLimits";
import RuleCriteriaMatcher from "../../../../Utils/Rules/RuleCriteriaMatcher";
import RulePatternMatchUtil from "../../../../Utils/Rules/RulePatternMatchUtil";

/*
 * THE AI RULES OF A TELEMETRY LANE, READ AND MATCHED (Types/AI/TelemetryAi).
 *
 * A lane's rules are AI rules (AutoRemediationRule) whose triggerEntityType
 * is the lane's. A rule matches a problem by the service it was found in:
 * the services it picks, the labels it names, a pattern on the service's
 * name - or the versioned conditions the dashboard writes, read through the
 * one criteria matcher every rule uses (RuleCriteriaMatcher), with the same
 * legacy fields a service's own label and owner rules use.
 *
 * Read as root with the project scoped explicitly: the scanner is a system
 * actor. A failed read is null - the decision then does nothing a rule may
 * have kept out (TelemetryAiSkip.RulesUnreadable).
 */

// What a lane's rule is read with: its conditions and what it decides.
const RULE_SELECT: {
  _id: true;
  name: true;
  criteria: true;
  services: { _id: true };
  serviceLabels: { _id: true };
  serviceNamePattern: true;
  investigates: true;
  fixes: true;
  executionMode: true;
  onlyIfOpenAfterMinutes: true;
  codeRepositories: { _id: true };
  externalMcpServers: { _id: true };
  llmProviderId: true;
} = {
  _id: true,
  name: true,
  criteria: true,
  services: { _id: true },
  serviceLabels: { _id: true },
  serviceNamePattern: true,
  investigates: true,
  fixes: true,
  executionMode: true,
  onlyIfOpenAfterMinutes: true,
  codeRepositories: { _id: true },
  externalMcpServers: { _id: true },
  llmProviderId: true,
};

// A service as a rule reads it.
export interface TelemetryAiRuleService {
  id: string;
  name: string;
  labelIds: Array<string>;
}

function readId(value: unknown): string {
  if (typeof value === "string") {
    return value.trim().toLowerCase();
  }

  if (value instanceof ObjectID) {
    return value.toString().trim().toLowerCase();
  }

  if (value && typeof value === "object") {
    const row: { _id?: unknown; id?: unknown } = value as {
      _id?: unknown;
      id?: unknown;
    };

    return readId(row._id ?? row.id);
  }

  return "";
}

function readIds(value: unknown): Array<string> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item: unknown): string => {
      return readId(item);
    })
    .filter((id: string): boolean => {
      return id.length > 0;
    });
}

// The project columns the lanes read: Enable AI and each lane's switch.
export const TELEMETRY_AI_PROJECT_SELECT: {
  _id: true;
  enableAi: true;
  enableAutomaticProfileRemediation: true;
  enableAutomaticTraceRemediation: true;
  enableAutomaticMetricRemediation: true;
} = {
  _id: true,
  enableAi: true,
  enableAutomaticProfileRemediation: true,
  enableAutomaticTraceRemediation: true,
  enableAutomaticMetricRemediation: true,
};

export default class TelemetryAiRules {
  // Whether the project has the lane's switch on.
  public static isLaneOn(project: Project, lane: TelemetryAiLane): boolean {
    return (
      (project as unknown as Record<string, unknown>)[
        TELEMETRY_AI_LANES[lane].switchColumn
      ] === true
    );
  }

  // The lanes whose switch is on for the project.
  public static getLanesOn(project: Project): Array<TelemetryAiLane> {
    return TELEMETRY_AI_LANE_LIST.filter((lane: TelemetryAiLane): boolean => {
      return TelemetryAiRules.isLaneOn(project, lane);
    });
  }

  // The service a problem was found in: its column, else its evidence's.
  public static getServiceId(problem: AIInsight): string {
    return (
      problem.telemetryServiceId?.toString() ||
      problem.evidence?.profile?.serviceId ||
      problem.evidence?.trace?.serviceId ||
      problem.evidence?.metric?.serviceId ||
      ""
    )
      .trim()
      .toLowerCase();
  }

  /*
   * The work the rules decide for one problem now (the triage runner and
   * the insight's routes read it): null for an insight no lane works on.
   */
  @CaptureSpan()
  public static async decideForInsight(data: {
    insight: AIInsight;
    project: Project;
  }): Promise<TelemetryAiWork | null> {
    const lane: TelemetryAiLane | null = getTelemetryAiLaneOfInsightType(
      data.insight.insightType,
    );
    const projectId: ObjectID | undefined =
      data.insight.projectId || data.project.id || undefined;

    if (!lane || !projectId) {
      return null;
    }

    const serviceId: string = TelemetryAiRules.getServiceId(data.insight);
    const rules: Array<AutoRemediationRule> | null =
      await TelemetryAiRules.readRules({ projectId, lane });
    const services: Map<string, TelemetryAiRuleService> =
      await TelemetryAiRules.readServices({
        projectId,
        serviceIds: [serviceId],
      });

    return (
      TelemetryAiRules.decideForServices({
        isAiEnabled: data.project.enableAi !== false,
        isLaneOn: TelemetryAiRules.isLaneOn(data.project, lane),
        rules,
        serviceIds: [serviceId],
        services,
      }).get(serviceId) || null
    );
  }

  // The lane's enabled rules in the project, by name; null when unreadable.
  @CaptureSpan()
  public static async readRules(data: {
    projectId: ObjectID;
    lane: TelemetryAiLane;
  }): Promise<Array<AutoRemediationRule> | null> {
    try {
      const rules: Array<AutoRemediationRule> =
        await AutoRemediationRuleService.findBy({
          query: {
            projectId: data.projectId,
            isEnabled: true,
            triggerEntityType: TELEMETRY_AI_LANES[data.lane].triggerEntityType,
          },
          select: RULE_SELECT,
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
          props: { isRoot: true },
        });

      logIfRuleReadWasTruncated({
        ruleKind: "AutoRemediationRule",
        projectId: data.projectId,
        rulesRead: rules.length,
      });

      return rules;
    } catch (error) {
      logger.error(
        `AI: could not read the ${data.lane} AI rules of project ${data.projectId.toString()}; OneUptime AI does nothing they may have kept out: ${error}`,
      );
      return null;
    }
  }

  // The services the problems were found in, with what a rule matches on.
  @CaptureSpan()
  public static async readServices(data: {
    projectId: ObjectID;
    serviceIds: Array<string>;
  }): Promise<Map<string, TelemetryAiRuleService>> {
    const services: Map<string, TelemetryAiRuleService> = new Map<
      string,
      TelemetryAiRuleService
    >();
    const ids: Array<string> = Array.from(
      new Set(
        data.serviceIds
          .map((id: string): string => {
            return id.trim().toLowerCase();
          })
          .filter((id: string): boolean => {
            return id.length > 0;
          }),
      ),
    );

    if (ids.length === 0) {
      return services;
    }

    const rows: Array<Service> = await ServiceService.findBy({
      query: {
        projectId: data.projectId,
        _id: QueryHelper.any(ids),
      },
      select: { _id: true, name: true, labels: { _id: true } },
      limit: ids.length,
      skip: 0,
      props: { isRoot: true },
    });

    for (const row of rows) {
      const id: string = readId(row.id || row._id);

      if (!id) {
        continue;
      }

      services.set(id, {
        id,
        name: row.name || "",
        labelIds: (row.labels || [])
          .map((label: Label): string => {
            return readId(label.id || label._id);
          })
          .filter((labelId: string): boolean => {
            return labelId.length > 0;
          }),
      });
    }

    return services;
  }

  /*
   * What OneUptime AI does with each problem, by the service it is in: one
   * evaluation of the lane's rules for a batch of problems (its pattern
   * questions share one allowance). `rules` is what readRules returned -
   * null when they could not be read. A problem whose service is gone (or
   * that names none) matches only a rule with no conditions.
   */
  @RuleEvaluation()
  public static decideForServices(data: {
    isAiEnabled: boolean;
    isLaneOn: boolean;
    rules: Array<AutoRemediationRule> | null;
    serviceIds: Array<string>;
    services: Map<string, TelemetryAiRuleService>;
  }): Map<string, TelemetryAiWork> {
    const work: Map<string, TelemetryAiWork> = new Map<
      string,
      TelemetryAiWork
    >();

    for (const rawId of data.serviceIds) {
      const serviceId: string = rawId.trim().toLowerCase();

      if (work.has(serviceId)) {
        continue;
      }

      const service: TelemetryAiRuleService = data.services.get(serviceId) || {
        id: serviceId,
        name: "",
        labelIds: [],
      };

      work.set(
        serviceId,
        decideTelemetryAiWork({
          isAiEnabled: data.isAiEnabled,
          isLaneOn: data.isLaneOn,
          rules: data.rules
            ? {
                rulesSetUp: data.rules.length > 0,
                matchingRules: data.rules
                  .filter((rule: AutoRemediationRule): boolean => {
                    return TelemetryAiRules.doesServiceMatch(service, rule);
                  })
                  .map(TelemetryAiRules.toFacts),
              }
            : null,
        }),
      );
    }

    return work;
  }

  // What the decision reads off a rule.
  public static toFacts(rule: AutoRemediationRule): TelemetryAiRuleFacts {
    return {
      _id: rule.id?.toString() || rule._id,
      name: rule.name,
      investigates: rule.investigates,
      fixes: rule.fixes,
      executionMode: rule.executionMode,
      onlyIfOpenAfterMinutes: rule.onlyIfOpenAfterMinutes,
      codeRepositories: rule.codeRepositories,
      externalMcpServers: rule.externalMcpServers,
      llmProviderId: rule.llmProviderId,
    };
  }

  // Whether a rule matches the service: its conditions, or its columns.
  private static doesServiceMatch(
    service: TelemetryAiRuleService,
    rule: AutoRemediationRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule: rule,
      legacyFields: ["services", "serviceLabels", "serviceNamePattern"],
      emptyResult: true,
      matchesLegacyRule: (legacyRule: AutoRemediationRule): boolean => {
        return TelemetryAiRules.doesServiceMatchColumns(service, legacyRule);
      },
    });
  }

  /*
   * The legacy columns, each skipped when empty and all of them together:
   * one of the picked services, one of the named labels, the name pattern.
   */
  private static doesServiceMatchColumns(
    service: TelemetryAiRuleService,
    rule: AutoRemediationRule,
  ): boolean {
    const serviceIds: Array<string> = readIds(rule.services);

    if (serviceIds.length > 0 && !serviceIds.includes(service.id)) {
      return false;
    }

    const labelIds: Array<string> = readIds(rule.serviceLabels);

    if (
      labelIds.length > 0 &&
      !labelIds.some((labelId: string): boolean => {
        return service.labelIds.includes(labelId);
      })
    ) {
      return false;
    }

    if (rule.serviceNamePattern) {
      if (!service.name) {
        return false;
      }

      try {
        return RulePatternMatchUtil.testRegex(
          rule.serviceNamePattern,
          service.name,
        );
      } catch {
        logger.warn(
          `Invalid service name pattern in AI rule ${rule.id?.toString()}: ${rule.serviceNamePattern}`,
        );
        return false;
      }
    }

    return true;
  }
}
