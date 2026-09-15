import Label from "../../Models/DatabaseModels/Label";
import Host from "../../Models/DatabaseModels/Host";
import HostLabelRule from "../../Models/DatabaseModels/HostLabelRule";
import HostLabelRuleService from "./HostLabelRuleService";
import HostService from "./HostService";
import HostFeedService from "./HostFeedService";
import { HostFeedEventType } from "../../Models/DatabaseModels/HostFeed";
import { Purple500 } from "../../Types/BrandColors";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../Utils/Rules/RuleEngineLimits";
import { RuleCriteriaMatcher } from "../../Utils/Rules/RuleCriteriaMatcher";
import logIfRuleReadWasTruncated from "../Utils/Rules/RuleEngineRuleRead";
import Select from "../Types/Database/Select";
import {
  ApplyRulesToExistingResourceData,
  RuleApplicationResult,
  RuleApplicationResultUtil,
  RuleRunEngine,
} from "../Utils/Rules/RuleRun/RuleApplication";

class HostLabelRuleEngineServiceClass
  implements RuleRunEngine<Host, HostLabelRule>
{
  public readonly ruleSelect: Select<HostLabelRule> = {
    _id: true,
    name: true,
    criteria: true,
    hostLabels: { _id: true },
    hostNamePattern: true,
    hostDescriptionPattern: true,
    labelsToAdd: { _id: true },
  };

  // Evaluation re-reads the host, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<Host> = {
    _id: true,
    projectId: true,
  };

  /**
   * Evaluates HostLabelRule rows for the given host and attaches matched
   * labels to it. The union is deduped against labels already on the host
   * before insert to avoid PK conflicts on the join table.
   */
  @CaptureSpan()
  public async applyRulesToHost(host: Host): Promise<void> {
    if (!host.id || !host.projectId) {
      return;
    }

    try {
      const rules: Array<HostLabelRule> = await HostLabelRuleService.findBy({
        query: {
          projectId: host.projectId,
          isEnabled: true,
        },
        props: { isRoot: true },
        select: this.ruleSelect,
        limit: MAX_RULES_EVALUATED_PER_PROJECT,
        skip: 0,
      });

      logIfRuleReadWasTruncated({
        ruleKind: "HostLabelRule",
        projectId: host.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({ host: host, rules: rules });
    } catch (error) {
      logger.error(`Error applying host label rules: ${error}`, {
        projectId: host.projectId?.toString(),
        hostId: host.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for a host that already exists and only the
   * rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<Host, HostLabelRule>,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        host: data.resource,
        rules: data.rules,
      });
    } catch (error) {
      logger.error(`Error running host label rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        hostId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  private async applyRules(data: {
    host: Host;
    rules: Array<HostLabelRule>;
  }): Promise<RuleApplicationResult> {
    const { host, rules } = data;

    if (!host.id || !host.projectId || rules.length === 0) {
      return RuleApplicationResultUtil.noMatch();
    }

    const hostWithDetails: Host | null = await HostService.findOneById({
      id: host.id,
      select: {
        name: true,
        description: true,
        labels: { _id: true },
      },
      props: { isRoot: true },
    });

    if (!hostWithDetails) {
      return RuleApplicationResultUtil.noMatch();
    }

    const labelIdsToAdd: Set<string> = new Set();
    let matchedAnyRule: boolean = false;
    const matchedRuleNames: Array<string> = [];

    for (const rule of rules) {
      const matches: boolean = this.doesHostMatchRule(hostWithDetails, rule);
      if (!matches) {
        continue;
      }
      matchedAnyRule = true;
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

    if (!matchedAnyRule) {
      return RuleApplicationResultUtil.noMatch();
    }

    if (labelIdsToAdd.size === 0) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    const existingLabelIds: Set<string> = new Set(
      (hostWithDetails.labels || [])
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

    await HostService.getRepository()
      .createQueryBuilder()
      .relation(Host, "labels")
      .of(host.id.toString())
      .add(newLabelIds);

    /*
     * Sync in-memory host.labels so a downstream owner-rule engine in
     * the same onCreateSuccess chain can match on rule-added labels.
     */
    const mergedLabelIds: Set<string> = new Set([
      ...existingLabelIds,
      ...newLabelIds,
    ]);
    host.labels = Array.from(mergedLabelIds).map((id: string) => {
      const label: Label = new Label();
      label.id = new ObjectID(id);
      return label;
    });

    logger.debug(
      `HostLabelRuleEngine attached ${newLabelIds.length} labels to host ${host.id}`,
      { projectId: host.projectId.toString() } as LogAttributes,
    );
    /*
     * Labels arriving from a rule rather than from a person is exactly the
     * kind of thing the overview page cannot explain, so record which rules
     * did it.
     */
    await HostFeedService.createHostFeedItem({
      hostId: host.id,
      projectId: host.projectId,
      hostFeedEventType: HostFeedEventType.LabelRuleExecuted,
      displayColor: Purple500,
      feedInfoInMarkdown: `🏷️ ${newLabelIds.length} label(s) were attached to ${await HostService.getHostMarkdownLink(
        host.projectId,
        host.id,
      )} by label ${matchedRuleNames.length === 1 ? "rule" : "rules"}.`,
      moreInformationInMarkdown: `**Label rules that matched**: ${matchedRuleNames
        .map((name: string) => {
          return `\`${name}\``;
        })
        .join(", ")}`,
    });

    return RuleApplicationResultUtil.updated(newLabelIds.length);
  }

  private doesHostMatchRule(host: Host, rule: HostLabelRule): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule,
      legacyFields: ["hostLabels", "hostNamePattern", "hostDescriptionPattern"],
      emptyResult: true,
      matchesLegacyRule: (legacyRule: HostLabelRule): boolean => {
        return this.doesHostMatchLegacyRule(host, legacyRule);
      },
    });
  }

  private doesHostMatchLegacyRule(host: Host, rule: HostLabelRule): boolean {
    if (rule.hostLabels && rule.hostLabels.length > 0) {
      if (!host.labels || host.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.hostLabels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      const labelIds: Array<string> = host.labels.map((l: Label) => {
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
      rule.hostNamePattern &&
      (!host.name || !this.testRegex(rule.hostNamePattern, host.name, rule))
    ) {
      return false;
    }

    if (
      rule.hostDescriptionPattern &&
      (!host.description ||
        !this.testRegex(rule.hostDescriptionPattern, host.description, rule))
    ) {
      return false;
    }

    return true;
  }

  private testRegex(
    pattern: string,
    value: string,
    rule: HostLabelRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(`Invalid regex in host label rule ${rule.id}: ${pattern}`);
      return false;
    }
  }
}

export default new HostLabelRuleEngineServiceClass();
