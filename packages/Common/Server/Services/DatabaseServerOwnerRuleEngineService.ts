import Label from "../../Models/DatabaseModels/Label";
import DatabaseServer from "../../Models/DatabaseModels/DatabaseServer";
import DatabaseServerOwnerRule from "../../Models/DatabaseModels/DatabaseServerOwnerRule";
import DatabaseServerOwnerUser from "../../Models/DatabaseModels/DatabaseServerOwnerUser";
import DatabaseServerOwnerTeam from "../../Models/DatabaseModels/DatabaseServerOwnerTeam";
import DatabaseServerOwnerRuleService from "./DatabaseServerOwnerRuleService";
import DatabaseServerOwnerUserService from "./DatabaseServerOwnerUserService";
import DatabaseServerOwnerTeamService from "./DatabaseServerOwnerTeamService";
import DatabaseServerService from "./DatabaseServerService";
import DatabaseServerFeedService from "./DatabaseServerFeedService";
import { DatabaseServerFeedEventType } from "../../Models/DatabaseModels/DatabaseServerFeed";
import { Purple500 } from "../../Types/BrandColors";
import ObjectID from "../../Types/ObjectID";
import Select from "../Types/Database/Select";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../Utils/Rules/RuleEngineLimits";
import { RuleCriteriaMatcher } from "../../Utils/Rules/RuleCriteriaMatcher";
import logIfRuleReadWasTruncated from "../Utils/Rules/RuleEngineRuleRead";
import OwnerRuleAssignment, {
  OwnersToAssign,
} from "../Utils/Rules/OwnerRuleAssignment";
import {
  ApplyRulesToExistingResourceData,
  RuleApplicationResult,
  RuleApplicationResultUtil,
  RuleRunEngine,
} from "../Utils/Rules/RuleRun/RuleApplication";

class DatabaseServerOwnerRuleEngineServiceClass
  implements RuleRunEngine<DatabaseServer, DatabaseServerOwnerRule>
{
  public readonly ruleSelect: Select<DatabaseServerOwnerRule> = {
    _id: true,
    name: true,
    criteria: true,
    notifyOwners: true,
    databaseServerLabels: { _id: true },
    databaseServerNamePattern: true,
    databaseServerDescriptionPattern: true,
    ownerUsers: { _id: true },
    ownerTeams: { _id: true },
  };

  // Evaluation re-reads the database, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<DatabaseServer> = {
    _id: true,
    projectId: true,
  };

  /**
   * Evaluates DatabaseServerOwnerRule rows for the given database and adds matched
   * owner users / teams via DatabaseServerOwnerUserService / DatabaseServerOwnerTeamService. Rules
   * with notifyOwners set notify the added owners; rules with notifyOwners off
   * add silently.
   */
  @CaptureSpan()
  public async applyRulesToDatabaseServer(
    databaseServer: DatabaseServer,
  ): Promise<void> {
    if (!databaseServer.id || !databaseServer.projectId) {
      return;
    }

    try {
      const rules: Array<DatabaseServerOwnerRule> =
        await DatabaseServerOwnerRuleService.findBy({
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
        ruleKind: "DatabaseServerOwnerRule",
        projectId: databaseServer.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({
        databaseServer: databaseServer,
        rules: rules,
        allowOwnerNotification: true,
      });
    } catch (error) {
      logger.error(`Error applying database owner rules: ${error}`, {
        projectId: databaseServer.projectId?.toString(),
        databaseServerId: databaseServer.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for a database that already exists
   * and only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<
      DatabaseServer,
      DatabaseServerOwnerRule
    >,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        databaseServer: data.resource,
        rules: data.rules,
        allowOwnerNotification: data.allowOwnerNotification,
      });
    } catch (error) {
      logger.error(`Error running database owner rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        databaseServerId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  private async applyRules(data: {
    databaseServer: DatabaseServer;
    rules: Array<DatabaseServerOwnerRule>;
    allowOwnerNotification: boolean;
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

    const usersByNotify: Map<boolean, Set<string>> = new Map([
      [true, new Set()],
      [false, new Set()],
    ]);
    const teamsByNotify: Map<boolean, Set<string>> = new Map([
      [true, new Set()],
      [false, new Set()],
    ]);

    const matchedRules: Array<DatabaseServerOwnerRule> = [];
    const allUserIds: Set<string> = new Set();
    const allTeamIds: Set<string> = new Set();
    let anyRuleMatched: boolean = false;

    for (const rule of rules) {
      const matches: boolean = this.doesDatabaseServerMatchRule(
        databaseServerWithDetails,
        rule,
      );
      if (!matches) {
        continue;
      }
      anyRuleMatched = true;
      let ruleAddedAny: boolean = false;
      const notify: boolean =
        rule.notifyOwners !== false && data.allowOwnerNotification;
      for (const user of rule.ownerUsers || []) {
        if (user.id) {
          usersByNotify.get(notify)!.add(user.id.toString());
          allUserIds.add(user.id.toString());
          ruleAddedAny = true;
        }
      }
      for (const team of rule.ownerTeams || []) {
        if (team.id) {
          teamsByNotify.get(notify)!.add(team.id.toString());
          allTeamIds.add(team.id.toString());
          ruleAddedAny = true;
        }
      }
      if (ruleAddedAny) {
        matchedRules.push(rule);
      }
    }

    if (!anyRuleMatched) {
      return RuleApplicationResultUtil.noMatch();
    }

    // The rules that matched name no owners, so there is nothing to add.
    if (matchedRules.length === 0) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    // Owners already on the database are skipped rather than duplicated.
    const notYetAssigned: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: DatabaseServerOwnerUserService,
        ownerTeamService: DatabaseServerOwnerTeamService,
        resourceIdColumn: "databaseServerId",
        resourceId: databaseServer.id,
        userIds: Array.from(allUserIds),
        teamIds: Array.from(allTeamIds),
      });

    const userIdsToAdd: Set<string> = new Set(
      notYetAssigned.userIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    );
    const teamIdsToAdd: Set<string> = new Set(
      notYetAssigned.teamIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    );

    let ownersAdded: number = 0;

    /*
     * The notifying set goes first, so an owner two matching rules disagree
     * about is added once, and notified.
     */
    for (const notify of [true, false]) {
      const userIds: Array<string> = Array.from(
        usersByNotify.get(notify)!,
      ).filter((id: string): boolean => {
        return userIdsToAdd.delete(id);
      });
      const teamIds: Array<string> = Array.from(
        teamsByNotify.get(notify)!,
      ).filter((id: string): boolean => {
        return teamIdsToAdd.delete(id);
      });

      for (const userId of userIds) {
        const owner: DatabaseServerOwnerUser = new DatabaseServerOwnerUser();
        owner.databaseServerId = databaseServer.id;
        owner.projectId = databaseServer.projectId;
        owner.userId = new ObjectID(userId);
        owner.isOwnerNotified = !notify;
        if (
          await OwnerRuleAssignment.createOwner({
            ownerService: DatabaseServerOwnerUserService,
            owner: owner,
            props: { isRoot: true },
          })
        ) {
          ownersAdded++;
        }
      }

      for (const teamId of teamIds) {
        const owner: DatabaseServerOwnerTeam = new DatabaseServerOwnerTeam();
        owner.databaseServerId = databaseServer.id;
        owner.projectId = databaseServer.projectId;
        owner.teamId = new ObjectID(teamId);
        owner.isOwnerNotified = !notify;
        if (
          await OwnerRuleAssignment.createOwner({
            ownerService: DatabaseServerOwnerTeamService,
            owner: owner,
            props: { isRoot: true },
          })
        ) {
          ownersAdded++;
        }
      }
    }

    if (ownersAdded === 0) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    logger.debug(
      `DatabaseServerOwnerRuleEngine added owners to database ${databaseServer.id}`,
      { projectId: databaseServer.projectId.toString() } as LogAttributes,
    );
    /*
     * The individual OwnerUserAdded / OwnerTeamAdded items say who was added;
     * this one says which rule is responsible, which is what somebody asking
     * "why am I on the hook for this?" actually needs.
     */
    await DatabaseServerFeedService.createDatabaseServerFeedItem({
      databaseServerId: databaseServer.id,
      projectId: databaseServer.projectId,
      databaseServerFeedEventType:
        DatabaseServerFeedEventType.OwnerRuleExecuted,
      displayColor: Purple500,
      feedInfoInMarkdown: `👥 Owners were added to ${await DatabaseServerService.getDatabaseServerMarkdownLink(
        databaseServer.projectId,
        databaseServer.id,
      )} by ${matchedRules.length} owner ${matchedRules.length === 1 ? "rule" : "rules"}.`,
      moreInformationInMarkdown: `**Owner rules that matched**: ${matchedRules
        .map((rule: DatabaseServerOwnerRule) => {
          return `\`${rule.name || rule.id?.toString() || "Unnamed rule"}\``;
        })
        .join(", ")}`,
    });

    return RuleApplicationResultUtil.updated(ownersAdded);
  }

  private doesDatabaseServerMatchRule(
    databaseServer: DatabaseServer,
    rule: DatabaseServerOwnerRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule,
      legacyFields: [
        "databaseServerLabels",
        "databaseServerNamePattern",
        "databaseServerDescriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: (legacyRule: DatabaseServerOwnerRule): boolean => {
        return this.doesDatabaseServerMatchLegacyRule(
          databaseServer,
          legacyRule,
        );
      },
    });
  }

  private doesDatabaseServerMatchLegacyRule(
    databaseServer: DatabaseServer,
    rule: DatabaseServerOwnerRule,
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
    rule: DatabaseServerOwnerRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in database owner rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new DatabaseServerOwnerRuleEngineServiceClass();
