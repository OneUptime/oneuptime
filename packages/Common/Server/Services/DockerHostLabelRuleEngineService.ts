import Label from "../../Models/DatabaseModels/Label";
import DockerHost from "../../Models/DatabaseModels/DockerHost";
import DockerHostLabelRule from "../../Models/DatabaseModels/DockerHostLabelRule";
import DockerHostLabelRuleService from "./DockerHostLabelRuleService";
import DockerHostService from "./DockerHostService";
import DockerHostFeedService from "./DockerHostFeedService";
import { DockerHostFeedEventType } from "../../Models/DatabaseModels/DockerHostFeed";
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

class DockerHostLabelRuleEngineServiceClass
  implements RuleRunEngine<DockerHost, DockerHostLabelRule>
{
  public readonly ruleSelect: Select<DockerHostLabelRule> = {
    _id: true,
    name: true,
    criteria: true,
    dockerHostLabels: { _id: true },
    dockerHostNamePattern: true,
    dockerHostDescriptionPattern: true,
    labelsToAdd: { _id: true },
  };

  // Evaluation re-reads the Docker host, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<DockerHost> = {
    _id: true,
    projectId: true,
  };

  /**
   * Evaluates DockerHostLabelRule rows for the given Docker host and attaches matched
   * labels to it. The union is deduped against labels already on the Docker host
   * before insert to avoid PK conflicts on the join table.
   */
  @CaptureSpan()
  public async applyRulesToDockerHost(dockerHost: DockerHost): Promise<void> {
    if (!dockerHost.id || !dockerHost.projectId) {
      return;
    }

    try {
      const rules: Array<DockerHostLabelRule> =
        await DockerHostLabelRuleService.findBy({
          query: {
            projectId: dockerHost.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: this.ruleSelect,
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
        });

      logIfRuleReadWasTruncated({
        ruleKind: "DockerHostLabelRule",
        projectId: dockerHost.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({ dockerHost: dockerHost, rules: rules });
    } catch (error) {
      logger.error(`Error applying Docker host label rules: ${error}`, {
        projectId: dockerHost.projectId?.toString(),
        dockerHostId: dockerHost.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for a Docker host that already exists and
   * only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<DockerHost, DockerHostLabelRule>,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        dockerHost: data.resource,
        rules: data.rules,
      });
    } catch (error) {
      logger.error(`Error running Docker host label rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        dockerHostId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  private async applyRules(data: {
    dockerHost: DockerHost;
    rules: Array<DockerHostLabelRule>;
  }): Promise<RuleApplicationResult> {
    const { dockerHost, rules } = data;

    if (!dockerHost.id || !dockerHost.projectId || rules.length === 0) {
      return RuleApplicationResultUtil.noMatch();
    }

    const dockerHostWithDetails: DockerHost | null =
      await DockerHostService.findOneById({
        id: dockerHost.id,
        select: {
          name: true,
          description: true,
          labels: { _id: true },
        },
        props: { isRoot: true },
      });

    if (!dockerHostWithDetails) {
      return RuleApplicationResultUtil.noMatch();
    }

    const labelIdsToAdd: Set<string> = new Set();
    let matchedAnyRule: boolean = false;
    const matchedRuleNames: Array<string> = [];

    for (const rule of rules) {
      const matches: boolean = this.doesDockerHostMatchRule(
        dockerHostWithDetails,
        rule,
      );
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
      (dockerHostWithDetails.labels || [])
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

    await DockerHostService.getRepository()
      .createQueryBuilder()
      .relation(DockerHost, "labels")
      .of(dockerHost.id.toString())
      .add(newLabelIds);

    /*
     * Sync in-memory dockerHost.labels so a downstream owner-rule engine in
     * the same onCreateSuccess chain can match on rule-added labels.
     */
    const mergedLabelIds: Set<string> = new Set([
      ...existingLabelIds,
      ...newLabelIds,
    ]);
    dockerHost.labels = Array.from(mergedLabelIds).map((id: string) => {
      const label: Label = new Label();
      label.id = new ObjectID(id);
      return label;
    });

    logger.debug(
      `DockerHostLabelRuleEngine attached ${newLabelIds.length} labels to Docker host ${dockerHost.id}`,
      { projectId: dockerHost.projectId.toString() } as LogAttributes,
    );
    /*
     * Labels arriving from a rule rather than from a person is exactly the
     * kind of thing the overview page cannot explain, so record which rules
     * did it.
     */
    await DockerHostFeedService.createDockerHostFeedItem({
      dockerHostId: dockerHost.id,
      projectId: dockerHost.projectId,
      dockerHostFeedEventType: DockerHostFeedEventType.LabelRuleExecuted,
      displayColor: Purple500,
      feedInfoInMarkdown: `🏷️ ${newLabelIds.length} label(s) were attached to ${await DockerHostService.getDockerHostMarkdownLink(
        dockerHost.projectId,
        dockerHost.id,
      )} by label ${matchedRuleNames.length === 1 ? "rule" : "rules"}.`,
      moreInformationInMarkdown: `**Label rules that matched**: ${matchedRuleNames
        .map((name: string) => {
          return `\`${name}\``;
        })
        .join(", ")}`,
    });

    return RuleApplicationResultUtil.updated(newLabelIds.length);
  }

  private doesDockerHostMatchRule(
    dockerHost: DockerHost,
    rule: DockerHostLabelRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule,
      legacyFields: [
        "dockerHostLabels",
        "dockerHostNamePattern",
        "dockerHostDescriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: (legacyRule: DockerHostLabelRule): boolean => {
        return this.doesDockerHostMatchLegacyRule(dockerHost, legacyRule);
      },
    });
  }

  private doesDockerHostMatchLegacyRule(
    dockerHost: DockerHost,
    rule: DockerHostLabelRule,
  ): boolean {
    if (rule.dockerHostLabels && rule.dockerHostLabels.length > 0) {
      if (!dockerHost.labels || dockerHost.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.dockerHostLabels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      const labelIds: Array<string> = dockerHost.labels.map((l: Label) => {
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
      rule.dockerHostNamePattern &&
      (!dockerHost.name ||
        !this.testRegex(rule.dockerHostNamePattern, dockerHost.name, rule))
    ) {
      return false;
    }

    if (
      rule.dockerHostDescriptionPattern &&
      (!dockerHost.description ||
        !this.testRegex(
          rule.dockerHostDescriptionPattern,
          dockerHost.description,
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
    rule: DockerHostLabelRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in Docker host label rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new DockerHostLabelRuleEngineServiceClass();
