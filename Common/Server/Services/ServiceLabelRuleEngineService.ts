import Label from "../../Models/DatabaseModels/Label";
import Service from "../../Models/DatabaseModels/Service";
import ServiceLabelRule from "../../Models/DatabaseModels/ServiceLabelRule";
import ServiceLabelRuleService from "./ServiceLabelRuleService";
import ServiceService from "./ServiceService";
import ServiceFeedService from "./ServiceFeedService";
import { ServiceFeedEventType } from "../../Models/DatabaseModels/ServiceFeed";
import { Purple500 } from "../../Types/BrandColors";
import ObjectID from "../../Types/ObjectID";
import Select from "../Types/Database/Select";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../Utils/Rules/RuleEngineLimits";
import { RuleCriteriaMatcher } from "../../Utils/Rules/RuleCriteriaMatcher";
import logIfRuleReadWasTruncated from "../Utils/Rules/RuleEngineRuleRead";
import {
  ApplyRulesToExistingResourceData,
  RuleApplicationResult,
  RuleApplicationResultUtil,
  RuleRunEngine,
} from "../Utils/Rules/RuleRun/RuleApplication";

class ServiceLabelRuleEngineServiceClass
  implements RuleRunEngine<Service, ServiceLabelRule>
{
  public readonly ruleSelect: Select<ServiceLabelRule> = {
    _id: true,
    name: true,
    criteria: true,
    serviceLabels: { _id: true },
    serviceNamePattern: true,
    serviceDescriptionPattern: true,
    labelsToAdd: { _id: true },
  };

  // Evaluation re-reads the service, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<Service> = {
    _id: true,
    projectId: true,
  };

  /**
   * Evaluates ServiceLabelRule rows for the given service and attaches matched
   * labels to it. The union is deduped against labels already on the service
   * before insert to avoid PK conflicts on the join table.
   */
  @CaptureSpan()
  public async applyRulesToService(service: Service): Promise<void> {
    if (!service.id || !service.projectId) {
      return;
    }

    try {
      const rules: Array<ServiceLabelRule> =
        await ServiceLabelRuleService.findBy({
          query: {
            projectId: service.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: this.ruleSelect,
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
        });

      logIfRuleReadWasTruncated({
        ruleKind: "ServiceLabelRule",
        projectId: service.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({ service: service, rules: rules });
    } catch (error) {
      logger.error(`Error applying service label rules: ${error}`, {
        projectId: service.projectId?.toString(),
        serviceId: service.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for a service that already exists and
   * only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<Service, ServiceLabelRule>,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        service: data.resource,
        rules: data.rules,
      });
    } catch (error) {
      logger.error(`Error running service label rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        serviceId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  private async applyRules(data: {
    service: Service;
    rules: Array<ServiceLabelRule>;
  }): Promise<RuleApplicationResult> {
    const { service, rules } = data;

    if (!service.id || !service.projectId || rules.length === 0) {
      return RuleApplicationResultUtil.noMatch();
    }

    const serviceWithDetails: Service | null = await ServiceService.findOneById(
      {
        id: service.id,
        select: {
          name: true,
          description: true,
          labels: { _id: true },
        },
        props: { isRoot: true },
      },
    );

    if (!serviceWithDetails) {
      return RuleApplicationResultUtil.noMatch();
    }

    const labelIdsToAdd: Set<string> = new Set();
    const matchedRuleNames: Array<string> = [];
    let anyRuleMatched: boolean = false;

    for (const rule of rules) {
      const matches: boolean = this.doesServiceMatchRule(
        serviceWithDetails,
        rule,
      );
      if (!matches) {
        continue;
      }
      anyRuleMatched = true;
      if ((rule.labelsToAdd || []).length > 0) {
        matchedRuleNames.push(
          rule.name || rule.id?.toString() || "Unnamed rule",
        );
      }
      for (const label of rule.labelsToAdd || []) {
        if (label.id) {
          labelIdsToAdd.add(label.id.toString());
        }
      }
    }

    if (!anyRuleMatched) {
      return RuleApplicationResultUtil.noMatch();
    }

    if (labelIdsToAdd.size === 0) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    const existingLabelIds: Set<string> = new Set(
      (serviceWithDetails.labels || [])
        .map((l: Label) => {
          return l.id?.toString() || "";
        })
        .filter((id: string) => {
          return id !== "";
        }),
    );

    const newLabelIds: Array<string> = Array.from(labelIdsToAdd).filter(
      (id: string) => {
        return !existingLabelIds.has(id);
      },
    );
    if (newLabelIds.length === 0) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    await ServiceService.getRepository()
      .createQueryBuilder()
      .relation(Service, "labels")
      .of(service.id.toString())
      .add(newLabelIds);

    /*
     * Sync in-memory service.labels so a downstream owner-rule engine in
     * the same onCreateSuccess chain can match on rule-added labels.
     */
    const mergedLabelIds: Set<string> = new Set([
      ...existingLabelIds,
      ...newLabelIds,
    ]);
    service.labels = Array.from(mergedLabelIds).map((id: string) => {
      const label: Label = new Label();
      label.id = new ObjectID(id);
      return label;
    });

    logger.debug(
      `ServiceLabelRuleEngine attached ${newLabelIds.length} labels to service ${service.id}`,
      { projectId: service.projectId.toString() } as LogAttributes,
    );
    /*
     * Labels arriving from a rule rather than from a person is exactly the
     * kind of thing the overview page cannot explain, so record which rules
     * did it.
     */
    await ServiceFeedService.createServiceFeedItem({
      serviceId: service.id,
      projectId: service.projectId,
      serviceFeedEventType: ServiceFeedEventType.LabelRuleExecuted,
      displayColor: Purple500,
      feedInfoInMarkdown: `🏷️ ${newLabelIds.length} label(s) were attached to ${await ServiceService.getServiceMarkdownLink(
        service.projectId,
        service.id,
      )} by label ${matchedRuleNames.length === 1 ? "rule" : "rules"}.`,
      moreInformationInMarkdown: `**Label rules that matched**: ${matchedRuleNames
        .map((name: string) => {
          return `\`${name}\``;
        })
        .join(", ")}`,
    });

    return RuleApplicationResultUtil.updated(newLabelIds.length);
  }

  private doesServiceMatchRule(
    service: Service,
    rule: ServiceLabelRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule: rule,
      legacyFields: [
        "serviceLabels",
        "serviceNamePattern",
        "serviceDescriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: (serviceRule: ServiceLabelRule): boolean => {
        return this.doesServiceMatchRuleLegacy(service, serviceRule);
      },
    });
  }

  private doesServiceMatchRuleLegacy(
    service: Service,
    rule: ServiceLabelRule,
  ): boolean {
    if (rule.serviceLabels && rule.serviceLabels.length > 0) {
      if (!service.labels || service.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.serviceLabels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      const labelIds: Array<string> = service.labels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      if (
        !ruleLabelIds.some((id: string) => {
          return labelIds.includes(id);
        })
      ) {
        return false;
      }
    }

    if (
      rule.serviceNamePattern &&
      (!service.name ||
        !this.testRegex(rule.serviceNamePattern, service.name, rule))
    ) {
      return false;
    }

    if (
      rule.serviceDescriptionPattern &&
      (!service.description ||
        !this.testRegex(
          rule.serviceDescriptionPattern,
          service.description,
          rule,
        ))
    ) {
      return false;
    }

    return true;
  }

  private testRegex(
    pattern: string,
    value: string,
    rule: ServiceLabelRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(`Invalid regex in service label rule ${rule.id}: ${pattern}`);
      return false;
    }
  }
}

export default new ServiceLabelRuleEngineServiceClass();
