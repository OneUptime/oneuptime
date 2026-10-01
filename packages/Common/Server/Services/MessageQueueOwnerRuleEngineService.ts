import Label from "../../Models/DatabaseModels/Label";
import MessageQueue from "../../Models/DatabaseModels/MessageQueue";
import MessageQueueOwnerRule from "../../Models/DatabaseModels/MessageQueueOwnerRule";
import MessageQueueOwnerUser from "../../Models/DatabaseModels/MessageQueueOwnerUser";
import MessageQueueOwnerTeam from "../../Models/DatabaseModels/MessageQueueOwnerTeam";
import MessageQueueOwnerRuleService from "./MessageQueueOwnerRuleService";
import MessageQueueOwnerUserService from "./MessageQueueOwnerUserService";
import MessageQueueOwnerTeamService from "./MessageQueueOwnerTeamService";
import MessageQueueService, {
  getMessagingSystemRuleMatchValues,
} from "./MessageQueueService";
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

class MessageQueueOwnerRuleEngineServiceClass
  implements RuleRunEngine<MessageQueue, MessageQueueOwnerRule>
{
  public readonly ruleSelect: Select<MessageQueueOwnerRule> = {
    _id: true,
    name: true,
    criteria: true,
    notifyOwners: true,
    messageQueueLabels: { _id: true },
    messageQueueNamePattern: true,
    messageQueueDescriptionPattern: true,
    messageQueueSystemPattern: true,
    ownerUsers: { _id: true },
    ownerTeams: { _id: true },
  };

  // Evaluation re-reads the queue, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<MessageQueue> = {
    _id: true,
    projectId: true,
  };

  /**
   * Evaluates MessageQueueOwnerRule rows for the given queue and adds matched
   * owner users / teams via MessageQueueOwnerUserService /
   * MessageQueueOwnerTeamService. Rules with notifyOwners set notify the
   * added owners; rules with notifyOwners off add silently.
   */
  @CaptureSpan()
  public async applyRulesToMessageQueue(
    messageQueue: MessageQueue,
  ): Promise<void> {
    if (!messageQueue.id || !messageQueue.projectId) {
      return;
    }

    try {
      const rules: Array<MessageQueueOwnerRule> =
        await MessageQueueOwnerRuleService.findBy({
          query: {
            projectId: messageQueue.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: this.ruleSelect,
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
        });

      logIfRuleReadWasTruncated({
        ruleKind: "MessageQueueOwnerRule",
        projectId: messageQueue.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({
        messageQueue: messageQueue,
        rules: rules,
        allowOwnerNotification: true,
      });
    } catch (error) {
      logger.error(`Error applying queue owner rules: ${error}`, {
        projectId: messageQueue.projectId?.toString(),
        messageQueueId: messageQueue.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for a queue that already exists and
   * only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<MessageQueue, MessageQueueOwnerRule>,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        messageQueue: data.resource,
        rules: data.rules,
        allowOwnerNotification: data.allowOwnerNotification,
      });
    } catch (error) {
      logger.error(`Error running queue owner rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        messageQueueId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  private async applyRules(data: {
    messageQueue: MessageQueue;
    rules: Array<MessageQueueOwnerRule>;
    allowOwnerNotification: boolean;
  }): Promise<RuleApplicationResult> {
    const { messageQueue, rules } = data;

    if (!messageQueue.id || !messageQueue.projectId || rules.length === 0) {
      return RuleApplicationResultUtil.noMatch();
    }

    const messageQueueWithDetails: MessageQueue | null =
      await MessageQueueService.findOneById({
        id: messageQueue.id,
        select: {
          name: true,
          description: true,
          messagingSystem: true,
          labels: { _id: true },
        },
        props: { isRoot: true },
      });

    if (!messageQueueWithDetails) {
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

    let matchedRuleCount: number = 0;
    const allUserIds: Set<string> = new Set();
    const allTeamIds: Set<string> = new Set();
    let anyRuleMatched: boolean = false;

    for (const rule of rules) {
      const matches: boolean = this.doesMessageQueueMatchRule(
        messageQueueWithDetails,
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
        matchedRuleCount++;
      }
    }

    if (!anyRuleMatched) {
      return RuleApplicationResultUtil.noMatch();
    }

    // The rules that matched name no owners, so there is nothing to add.
    if (matchedRuleCount === 0) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    // Owners already on the queue are skipped rather than duplicated.
    const notYetAssigned: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: MessageQueueOwnerUserService,
        ownerTeamService: MessageQueueOwnerTeamService,
        resourceIdColumn: "messageQueueId",
        resourceId: messageQueue.id,
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
    const addedUserIds: Array<string> = [];
    const addedTeamIds: Array<string> = [];

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
        const owner: MessageQueueOwnerUser = new MessageQueueOwnerUser();
        owner.messageQueueId = messageQueue.id;
        owner.projectId = messageQueue.projectId;
        owner.userId = new ObjectID(userId);
        owner.isOwnerNotified = !notify;
        if (
          await OwnerRuleAssignment.createOwner({
            ownerService: MessageQueueOwnerUserService,
            owner: owner,
            props: { isRoot: true },
          })
        ) {
          ownersAdded++;
          addedUserIds.push(userId);
        }
      }

      for (const teamId of teamIds) {
        const owner: MessageQueueOwnerTeam = new MessageQueueOwnerTeam();
        owner.messageQueueId = messageQueue.id;
        owner.projectId = messageQueue.projectId;
        owner.teamId = new ObjectID(teamId);
        owner.isOwnerNotified = !notify;
        if (
          await OwnerRuleAssignment.createOwner({
            ownerService: MessageQueueOwnerTeamService,
            owner: owner,
            props: { isRoot: true },
          })
        ) {
          ownersAdded++;
          addedTeamIds.push(teamId);
        }
      }
    }

    if (ownersAdded === 0) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    /*
     * A rule added these owners, not a person: they must not count as
     * somebody investing in the queue (see autoArchiveStaleMessageQueues).
     */
    await MessageQueueService.recordAutomaticAssignments({
      messageQueueId: messageQueue.id,
      kind: "ownerUserIds",
      ids: addedUserIds,
    });
    await MessageQueueService.recordAutomaticAssignments({
      messageQueueId: messageQueue.id,
      kind: "ownerTeamIds",
      ids: addedTeamIds,
    });

    logger.debug(
      `MessageQueueOwnerRuleEngine added ${ownersAdded} owner(s) to queue ${messageQueue.id} from ${matchedRuleCount} rule(s)`,
      { projectId: messageQueue.projectId.toString() } as LogAttributes,
    );

    return RuleApplicationResultUtil.updated(ownersAdded);
  }

  private doesMessageQueueMatchRule(
    messageQueue: MessageQueue,
    rule: MessageQueueOwnerRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule,
      legacyFields: [
        "messageQueueLabels",
        "messageQueueNamePattern",
        "messageQueueDescriptionPattern",
        "messageQueueSystemPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: (legacyRule: MessageQueueOwnerRule): boolean => {
        return this.doesMessageQueueMatchLegacyRule(messageQueue, legacyRule);
      },
    });
  }

  private doesMessageQueueMatchLegacyRule(
    messageQueue: MessageQueue,
    rule: MessageQueueOwnerRule,
  ): boolean {
    if (rule.messageQueueLabels && rule.messageQueueLabels.length > 0) {
      if (!messageQueue.labels || messageQueue.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.messageQueueLabels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      const labelIds: Array<string> = messageQueue.labels.map((l: Label) => {
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
      rule.messageQueueNamePattern &&
      (!messageQueue.name ||
        !this.testRegex(rule.messageQueueNamePattern, messageQueue.name, rule))
    ) {
      return false;
    }

    if (
      rule.messageQueueDescriptionPattern &&
      (!messageQueue.description ||
        !this.testRegex(
          rule.messageQueueDescriptionPattern,
          messageQueue.description,
          rule,
        ))
    ) {
      return false;
    }

    /*
     * A queue's name carries no broker, so the system is matched on its own:
     * against the canonical value and the display name alike.
     */
    if (rule.messageQueueSystemPattern) {
      const systemPattern: string = rule.messageQueueSystemPattern;

      if (
        !getMessagingSystemRuleMatchValues(messageQueue.messagingSystem).some(
          (value: string): boolean => {
            return this.testRegex(systemPattern, value, rule);
          },
        )
      ) {
        return false;
      }
    }

    return true;
  }

  private testRegex(
    pattern: string,
    value: string,
    rule: MessageQueueOwnerRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(`Invalid regex in queue owner rule ${rule.id}: ${pattern}`);
      return false;
    }
  }
}

export default new MessageQueueOwnerRuleEngineServiceClass();
