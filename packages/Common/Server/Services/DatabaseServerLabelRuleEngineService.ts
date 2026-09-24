import Label from "../../Models/DatabaseModels/Label";
import DatabaseServer from "../../Models/DatabaseModels/DatabaseServer";
import DatabaseServerLabelRule from "../../Models/DatabaseModels/DatabaseServerLabelRule";
import DatabaseServerLabelRuleService from "./DatabaseServerLabelRuleService";
import DatabaseServerService from "./DatabaseServerService";
import DatabaseServerFeedService from "./DatabaseServerFeedService";
import { DatabaseServerFeedEventType } from "../../Models/DatabaseModels/DatabaseServerFeed";
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

class DatabaseServerLabelRuleEngineServiceClass
  implements RuleRunEngine<DatabaseServer, DatabaseServerLabelRule>
{
  public readonly ruleSelect: Select<DatabaseServerLabelRule> = {
    _id: true,
    name: true,
    criteria: true,
    databaseServerLabels: { _id: true },
    databaseServerNamePattern: true,
    databaseServerDescriptionPattern: true,
    labelsToAdd: { _id: true },
  };

  // Evaluation re-reads the database, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<DatabaseServer> = {
    _id: true,
    projectId: true,
  };

  /**
   * Evaluates DatabaseServerLabelRule rows for the given database and attaches matched
   * labels to it. The union is deduped against labels already on the database
   * before insert to avoid PK conflicts on the join table.
   */
  @CaptureSpan()
  public async applyRulesToDatabaseServer(
    databaseServer: DatabaseServer,
  ): Promise<void> {
    if (!databaseServer.id || !databaseServer.projectId) {
      return;
    }

    try {
      const rules: Array<DatabaseServerLabelRule> =
        await DatabaseServerLabelRuleService.findBy({
          query: {
            projectId: databaseServer.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: this.ruleSelect,
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
        });

      logIfRuleReadWasTruncated({
        ruleKind: "DatabaseServerLabelRule",
        projectId: databaseServer.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({ databaseServer: databaseServer, rules: rules });
    } catch (error) {
      logger.error(`Error applying database label rules: ${error}`, {
        projectId: databaseServer.projectId?.toString(),
        databaseServerId: databaseServer.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for a database that already exists and
   * only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<
      DatabaseServer,
      DatabaseServerLabelRule
    >,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        databaseServer: data.resource,
        rules: data.rules,
      });
    } catch (error) {
      logger.error(`Error running database label rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        databaseServerId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  private async applyRules(data: {
    databaseServer: DatabaseServer;
    rules: Array<DatabaseServerLabelRule>;
  }): Promise<RuleApplicationResult> {
    const { databaseServer, rules } = data;

    if (!databaseServer.id || !databaseServer.projectId || rules.length === 0) {
      return RuleApplicationResultUtil.noMatch();
    }

    const databaseServerWithDetails: DatabaseServer | null =
      await DatabaseServerService.findOneById({
        id: databaseServer.id,
        select: {
          name: true,
          description: true,
          labels: { _id: true },
        },
        props: { isRoot: true },
      });

    if (!databaseServerWithDetails) {
      return RuleApplicationResultUtil.noMatch();
    }

    const labelIdsToAdd: Set<string> = new Set();
    let matchedAnyRule: boolean = false;
    const matchedRuleNames: Array<string> = [];

    for (const rule of rules) {
      const matches: boolean = this.doesDatabaseServerMatchRule(
        databaseServerWithDetails,
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
      (databaseServerWithDetails.labels || [])
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

    await DatabaseServerService.getRepository()
      .createQueryBuilder()
      .relation(DatabaseServer, "labels")
      .of(databaseServer.id.toString())
      .add(newLabelIds);

    /*
     * Sync in-memory databaseServer.labels so a downstream owner-rule engine in
     * the same onCreateSuccess chain can match on rule-added labels.
     */
    const mergedLabelIds: Set<string> = new Set([
      ...existingLabelIds,
      ...newLabelIds,
    ]);
    databaseServer.labels = Array.from(mergedLabelIds).map((id: string) => {
      const label: Label = new Label();
      label.id = new ObjectID(id);
      return label;
    });

    logger.debug(
      `DatabaseServerLabelRuleEngine attached ${newLabelIds.length} labels to database ${databaseServer.id}`,
      { projectId: databaseServer.projectId.toString() } as LogAttributes,
    );
    /*
     * Labels arriving from a rule rather than from a person is exactly the
     * kind of thing the overview page cannot explain, so record which rules
     * did it.
     */
    await DatabaseServerFeedService.createDatabaseServerFeedItem({
      databaseServerId: databaseServer.id,
      projectId: databaseServer.projectId,
      databaseServerFeedEventType:
        DatabaseServerFeedEventType.LabelRuleExecuted,
      displayColor: Purple500,
      feedInfoInMarkdown: `🏷️ ${newLabelIds.length} label(s) were attached to ${await DatabaseServerService.getDatabaseServerMarkdownLink(
        databaseServer.projectId,
        databaseServer.id,
      )} by label ${matchedRuleNames.length === 1 ? "rule" : "rules"}.`,
      moreInformationInMarkdown: `**Label rules that matched**: ${matchedRuleNames
        .map((name: string) => {
          return `\`${name}\``;
        })
        .join(", ")}`,
    });

    return RuleApplicationResultUtil.updated(newLabelIds.length);
  }

  private doesDatabaseServerMatchRule(
    databaseServer: DatabaseServer,
    rule: DatabaseServerLabelRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule,
      legacyFields: [
        "databaseServerLabels",
        "databaseServerNamePattern",
        "databaseServerDescriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: (legacyRule: DatabaseServerLabelRule): boolean => {
        return this.doesDatabaseServerMatchLegacyRule(
          databaseServer,
          legacyRule,
        );
      },
    });
  }

  private doesDatabaseServerMatchLegacyRule(
    databaseServer: DatabaseServer,
    rule: DatabaseServerLabelRule,
  ): boolean {
    if (rule.databaseServerLabels && rule.databaseServerLabels.length > 0) {
      if (!databaseServer.labels || databaseServer.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.databaseServerLabels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      const labelIds: Array<string> = databaseServer.labels.map((l: Label) => {
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
      rule.databaseServerNamePattern &&
      (!databaseServer.name ||
        !this.testRegex(
          rule.databaseServerNamePattern,
          databaseServer.name,
          rule,
        ))
    ) {
      return false;
    }

    if (
      rule.databaseServerDescriptionPattern &&
      (!databaseServer.description ||
        !this.testRegex(
          rule.databaseServerDescriptionPattern,
          databaseServer.description,
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
    rule: DatabaseServerLabelRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in database label rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new DatabaseServerLabelRuleEngineServiceClass();
