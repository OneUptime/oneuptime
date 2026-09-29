import Label from "../../Models/DatabaseModels/Label";
import ServiceLevelObjective from "../../Models/DatabaseModels/ServiceLevelObjective";
import { ServiceLevelObjectiveFeedEventType } from "../../Models/DatabaseModels/ServiceLevelObjectiveFeed";
import ServiceLevelObjectiveOwnerRule from "../../Models/DatabaseModels/ServiceLevelObjectiveOwnerRule";
import ServiceLevelObjectiveOwnerTeam from "../../Models/DatabaseModels/ServiceLevelObjectiveOwnerTeam";
import ServiceLevelObjectiveOwnerUser from "../../Models/DatabaseModels/ServiceLevelObjectiveOwnerUser";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { Purple500 } from "../../Types/BrandColors";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import { escapeMarkdownInline } from "../../Utils/Markdown/MarkdownEscape";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../Utils/Rules/RuleEngineLimits";
import { RuleCriteriaMatcher } from "../../Utils/Rules/RuleCriteriaMatcher";
import RulePatternMatchUtil from "../../Utils/Rules/RulePatternMatchUtil";
import Select from "../Types/Database/Select";
import logger, { LogAttributes } from "../Utils/Logger";
import OwnerRuleAssignment, {
  OwnersToAssign,
} from "../Utils/Rules/OwnerRuleAssignment";
import logIfRuleReadWasTruncated from "../Utils/Rules/RuleEngineRuleRead";
import {
  ApplyRulesToExistingResourceData,
  RuleApplicationResult,
  RuleApplicationResultUtil,
  RuleRunEngine,
} from "../Utils/Rules/RuleRun/RuleApplication";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import DatabaseService from "./DatabaseService";
import ServiceLevelObjectiveFeedService from "./ServiceLevelObjectiveFeedService";
import ServiceLevelObjectiveOwnerRuleService from "./ServiceLevelObjectiveOwnerRuleService";
import ServiceLevelObjectiveOwnerTeamService from "./ServiceLevelObjectiveOwnerTeamService";
import ServiceLevelObjectiveOwnerUserService from "./ServiceLevelObjectiveOwnerUserService";
import ServiceLevelObjectiveService from "./ServiceLevelObjectiveService";

// What adding one owner row did.
enum OwnerWriteOutcome {
  Added = "Added",
  AlreadyOwner = "AlreadyOwner",
  Rejected = "Rejected",
}

class ServiceLevelObjectiveOwnerRuleEngineServiceClass
  implements
    RuleRunEngine<ServiceLevelObjective, ServiceLevelObjectiveOwnerRule>
{
  public readonly ruleSelect: Select<ServiceLevelObjectiveOwnerRule> = {
    _id: true,
    name: true,
    criteria: true,
    notifyOwners: true,
    serviceLevelObjectiveLabels: { _id: true },
    serviceLevelObjectiveNamePattern: true,
    serviceLevelObjectiveDescriptionPattern: true,
    ownerUsers: { _id: true },
    ownerTeams: { _id: true },
  };

  // Evaluation re-reads the SLO, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<ServiceLevelObjective> = {
    _id: true,
    projectId: true,
  };

  /**
   * Evaluates ServiceLevelObjectiveOwnerRule rows for the given SLO and adds
   * matched owner users / teams through the SLO owner services, so each one
   * gets the usual owner-added feed item and notification. Rules with
   * notifyOwners set notify the added owners; rules with notifyOwners off add
   * silently.
   */
  @CaptureSpan()
  public async applyRulesToServiceLevelObjective(
    serviceLevelObjective: ServiceLevelObjective,
  ): Promise<void> {
    if (!serviceLevelObjective.id || !serviceLevelObjective.projectId) {
      return;
    }

    try {
      const rules: Array<ServiceLevelObjectiveOwnerRule> =
        await ServiceLevelObjectiveOwnerRuleService.findBy({
          query: {
            projectId: serviceLevelObjective.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: this.ruleSelect,
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
        });

      logIfRuleReadWasTruncated({
        ruleKind: "ServiceLevelObjectiveOwnerRule",
        projectId: serviceLevelObjective.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({
        serviceLevelObjective: serviceLevelObjective,
        rules: rules,
        allowOwnerNotification: true,
      });
    } catch (error) {
      logger.error(`Error applying SLO owner rules: ${error}`, {
        projectId: serviceLevelObjective.projectId?.toString(),
        serviceLevelObjectiveId: serviceLevelObjective.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for an SLO that already exists and only
   * the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<
      ServiceLevelObjective,
      ServiceLevelObjectiveOwnerRule
    >,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        serviceLevelObjective: data.resource,
        rules: data.rules,
        allowOwnerNotification: data.allowOwnerNotification,
      });
    } catch (error) {
      logger.error(`Error running SLO owner rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        serviceLevelObjectiveId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  private async applyRules(data: {
    serviceLevelObjective: ServiceLevelObjective;
    rules: Array<ServiceLevelObjectiveOwnerRule>;
    allowOwnerNotification: boolean;
  }): Promise<RuleApplicationResult> {
    const { serviceLevelObjective, rules } = data;

    if (
      !serviceLevelObjective.id ||
      !serviceLevelObjective.projectId ||
      rules.length === 0
    ) {
      return RuleApplicationResultUtil.noMatch();
    }

    const sloWithDetails: ServiceLevelObjective | null =
      await ServiceLevelObjectiveService.findOneById({
        id: serviceLevelObjective.id,
        select: {
          name: true,
          description: true,
          labels: { _id: true },
        },
        props: { isRoot: true },
      });

    if (!sloWithDetails) {
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

    const matchedRules: Array<ServiceLevelObjectiveOwnerRule> = [];
    const allUserIds: Set<string> = new Set();
    const allTeamIds: Set<string> = new Set();
    let anyRuleMatched: boolean = false;

    for (const rule of rules) {
      if (!this.doesServiceLevelObjectiveMatchRule(sloWithDetails, rule)) {
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

    // Owners already on the SLO are skipped rather than duplicated.
    const notYetAssigned: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: ServiceLevelObjectiveOwnerUserService,
        ownerTeamService: ServiceLevelObjectiveOwnerTeamService,
        resourceIdColumn: "serviceLevelObjectiveId",
        resourceId: serviceLevelObjective.id,
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
    let ownersRejected: number = 0;

    const count: (outcome: OwnerWriteOutcome) => void = (
      outcome: OwnerWriteOutcome,
    ): void => {
      if (outcome === OwnerWriteOutcome.Added) {
        ownersAdded++;
      } else if (outcome === OwnerWriteOutcome.Rejected) {
        ownersRejected++;
      }
    };

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
        const owner: ServiceLevelObjectiveOwnerUser =
          new ServiceLevelObjectiveOwnerUser();
        owner.serviceLevelObjectiveId = serviceLevelObjective.id;
        owner.projectId = serviceLevelObjective.projectId;
        owner.userId = new ObjectID(userId);
        owner.isOwnerNotified = !notify;
        count(
          await this.addOwner({
            ownerService: ServiceLevelObjectiveOwnerUserService,
            owner: owner,
            serviceLevelObjective: serviceLevelObjective,
          }),
        );
      }

      for (const teamId of teamIds) {
        const owner: ServiceLevelObjectiveOwnerTeam =
          new ServiceLevelObjectiveOwnerTeam();
        owner.serviceLevelObjectiveId = serviceLevelObjective.id;
        owner.projectId = serviceLevelObjective.projectId;
        owner.teamId = new ObjectID(teamId);
        owner.isOwnerNotified = !notify;
        count(
          await this.addOwner({
            ownerService: ServiceLevelObjectiveOwnerTeamService,
            owner: owner,
            serviceLevelObjective: serviceLevelObjective,
          }),
        );
      }
    }

    if (ownersAdded === 0) {
      /*
       * Every owner the rules name was refused - a user who has since left the
       * project, say. Nothing was added, and "already applied" would claim the
       * SLO has owners it does not, so report the SLO as one the run could not
       * update.
       */
      return ownersRejected > 0
        ? RuleApplicationResultUtil.failed()
        : RuleApplicationResultUtil.alreadyApplied();
    }

    logger.debug(
      `ServiceLevelObjectiveOwnerRuleEngine added owners to SLO ${serviceLevelObjective.id}`,
      {
        projectId: serviceLevelObjective.projectId.toString(),
      } as LogAttributes,
    );

    await this.postOwnerRuleFeedItem({
      serviceLevelObjectiveId: serviceLevelObjective.id,
      projectId: serviceLevelObjective.projectId,
      sloName: sloWithDetails.name,
      matchedRules: matchedRules,
    });

    return RuleApplicationResultUtil.updated(ownersAdded);
  }

  /*
   * SLO owner services refuse a user who is not a member of the project, or a
   * team from another one (see SloOwnerReferenceValidator) - which a rule can
   * still name after the user left, or when it was written through the API.
   * That owner is skipped so the rule's other owners are still added; any
   * other failure is thrown as before.
   */
  private async addOwner<TOwner extends BaseModel>(data: {
    ownerService: DatabaseService<TOwner>;
    owner: TOwner;
    serviceLevelObjective: ServiceLevelObjective;
  }): Promise<OwnerWriteOutcome> {
    try {
      const added: boolean = await OwnerRuleAssignment.createOwner({
        ownerService: data.ownerService,
        owner: data.owner,
        props: { isRoot: true },
      });

      return added ? OwnerWriteOutcome.Added : OwnerWriteOutcome.AlreadyOwner;
    } catch (error) {
      if (!(error instanceof BadDataException)) {
        throw error;
      }

      logger.warn(
        `SLO owner rule could not add an owner to SLO ${data.serviceLevelObjective.id?.toString()}: ${error.message}`,
        {
          projectId: data.serviceLevelObjective.projectId?.toString(),
        } as LogAttributes,
      );

      return OwnerWriteOutcome.Rejected;
    }
  }

  /*
   * The individual OwnerUserAdded / OwnerTeamAdded items say who was added;
   * this one says which rule is responsible, which is what somebody asking
   * "why am I on the hook for this SLO?" actually needs. The owners are
   * already added by now, so a feed failure is logged, never thrown.
   */
  private async postOwnerRuleFeedItem(data: {
    serviceLevelObjectiveId: ObjectID;
    projectId: ObjectID;
    sloName: string | undefined;
    matchedRules: Array<ServiceLevelObjectiveOwnerRule>;
  }): Promise<void> {
    try {
      const sloLink: string =
        await ServiceLevelObjectiveService.getSloMarkdownLink({
          projectId: data.projectId,
          sloId: data.serviceLevelObjectiveId,
          sloName: data.sloName,
        });

      await ServiceLevelObjectiveFeedService.createServiceLevelObjectiveFeedItem(
        {
          serviceLevelObjectiveId: data.serviceLevelObjectiveId,
          projectId: data.projectId,
          serviceLevelObjectiveFeedEventType:
            ServiceLevelObjectiveFeedEventType.OwnerRuleExecuted,
          displayColor: Purple500,
          feedInfoInMarkdown: `👥 Owners were added to ${sloLink} by ${data.matchedRules.length} owner ${data.matchedRules.length === 1 ? "rule" : "rules"}.`,
          moreInformationInMarkdown: `**Owner rules that matched**: ${data.matchedRules
            .map((rule: ServiceLevelObjectiveOwnerRule): string => {
              // Rule names are user-controlled and the feed renders markdown.
              return `**${escapeMarkdownInline(
                rule.name || rule.id?.toString() || "Unnamed rule",
              )}**`;
            })
            .join(", ")}`,
        },
      );
    } catch (error) {
      logger.error(
        `Error writing the owner rule feed item for SLO ${data.serviceLevelObjectiveId.toString()}: ${error}`,
        { projectId: data.projectId.toString() } as LogAttributes,
      );
    }
  }

  private doesServiceLevelObjectiveMatchRule(
    serviceLevelObjective: ServiceLevelObjective,
    rule: ServiceLevelObjectiveOwnerRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule,
      legacyFields: [
        "serviceLevelObjectiveLabels",
        "serviceLevelObjectiveNamePattern",
        "serviceLevelObjectiveDescriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: (
        legacyRule: ServiceLevelObjectiveOwnerRule,
      ): boolean => {
        return this.doesServiceLevelObjectiveMatchLegacyRule(
          serviceLevelObjective,
          legacyRule,
        );
      },
    });
  }

  private doesServiceLevelObjectiveMatchLegacyRule(
    serviceLevelObjective: ServiceLevelObjective,
    rule: ServiceLevelObjectiveOwnerRule,
  ): boolean {
    if (
      rule.serviceLevelObjectiveLabels &&
      rule.serviceLevelObjectiveLabels.length > 0
    ) {
      if (
        !serviceLevelObjective.labels ||
        serviceLevelObjective.labels.length === 0
      ) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.serviceLevelObjectiveLabels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      const labelIds: Array<string> = serviceLevelObjective.labels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      if (
        !ruleLabelIds.some((id: string) => {
          return labelIds.includes(id);
        })
      ) {
        return false;
      }
    }

    if (
      rule.serviceLevelObjectiveNamePattern &&
      (!serviceLevelObjective.name ||
        !this.testPattern(
          rule.serviceLevelObjectiveNamePattern,
          serviceLevelObjective.name,
          rule,
        ))
    ) {
      return false;
    }

    if (
      rule.serviceLevelObjectiveDescriptionPattern &&
      (!serviceLevelObjective.description ||
        !this.testPattern(
          rule.serviceLevelObjectiveDescriptionPattern,
          serviceLevelObjective.description,
          rule,
        ))
    ) {
      return false;
    }

    return true;
  }

  /*
   * Patterns are regexes, with a '*' wildcard fallback - the same two syntaxes
   * the SLO monitor rules take. SloRulePatternValidator rejects anything else
   * on save, so this only warns about a rule written before that check.
   */
  private testPattern(
    pattern: string,
    value: string,
    rule: ServiceLevelObjectiveOwnerRule,
  ): boolean {
    if (!RulePatternMatchUtil.isSupportedPattern(pattern)) {
      logger.warn(
        `Invalid pattern in SLO owner rule ${rule.id}: ${pattern}. It is neither a valid regular expression nor a wildcard pattern, so it will never match.`,
      );
      return false;
    }

    return RulePatternMatchUtil.matches(value, pattern);
  }
}

export default new ServiceLevelObjectiveOwnerRuleEngineServiceClass();
