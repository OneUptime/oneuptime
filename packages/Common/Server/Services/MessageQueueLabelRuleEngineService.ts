import Label from "../../Models/DatabaseModels/Label";
import MessageQueue from "../../Models/DatabaseModels/MessageQueue";
import MessageQueueLabelRule from "../../Models/DatabaseModels/MessageQueueLabelRule";
import MessageQueueLabelRuleService from "./MessageQueueLabelRuleService";
import MessageQueueService, {
  getMessagingSystemRuleMatchValues,
} from "./MessageQueueService";
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

class MessageQueueLabelRuleEngineServiceClass
  implements RuleRunEngine<MessageQueue, MessageQueueLabelRule>
{
  public readonly ruleSelect: Select<MessageQueueLabelRule> = {
    _id: true,
    name: true,
    criteria: true,
    messageQueueLabels: { _id: true },
    messageQueueNamePattern: true,
    messageQueueDescriptionPattern: true,
    messageQueueSystemPattern: true,
    labelsToAdd: { _id: true },
  };

  // Evaluation re-reads the queue, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<MessageQueue> = {
    _id: true,
    projectId: true,
  };

  /**
   * Evaluates MessageQueueLabelRule rows for the given queue and attaches
   * matched labels to it. The union is deduped against labels already on the
   * queue before insert to avoid PK conflicts on the join table.
   */
  @CaptureSpan()
  public async applyRulesToMessageQueue(
    messageQueue: MessageQueue,
  ): Promise<void> {
    if (!messageQueue.id || !messageQueue.projectId) {
      return;
    }

    try {
      const rules: Array<MessageQueueLabelRule> =
        await MessageQueueLabelRuleService.findBy({
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
        ruleKind: "MessageQueueLabelRule",
        projectId: messageQueue.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({ messageQueue: messageQueue, rules: rules });
    } catch (error) {
      logger.error(`Error applying queue label rules: ${error}`, {
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
    data: ApplyRulesToExistingResourceData<MessageQueue, MessageQueueLabelRule>,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        messageQueue: data.resource,
        rules: data.rules,
      });
    } catch (error) {
      logger.error(`Error running queue label rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        messageQueueId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  private async applyRules(data: {
    messageQueue: MessageQueue;
    rules: Array<MessageQueueLabelRule>;
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

    const labelIdsToAdd: Set<string> = new Set();
    let matchedAnyRule: boolean = false;

    for (const rule of rules) {
      const matches: boolean = this.doesMessageQueueMatchRule(
        messageQueueWithDetails,
        rule,
      );
      if (!matches) {
        continue;
      }
      matchedAnyRule = true;
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
      (messageQueueWithDetails.labels || [])
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

    await MessageQueueService.getRepository()
      .createQueryBuilder()
      .relation(MessageQueue, "labels")
      .of(messageQueue.id.toString())
      .add(newLabelIds);

    /*
     * A rule attached these, not a person: they must not count as somebody
     * investing in the queue (see autoArchiveStaleMessageQueues), or a
     * catch-all rule would keep every discovered queue alive forever.
     */
    await MessageQueueService.recordAutomaticAssignments({
      messageQueueId: messageQueue.id,
      kind: "labelIds",
      ids: newLabelIds,
    });

    /*
     * Sync in-memory messageQueue.labels so a downstream owner-rule engine in
     * the same create chain can match on rule-added labels.
     */
    const mergedLabelIds: Set<string> = new Set([
      ...existingLabelIds,
      ...newLabelIds,
    ]);
    messageQueue.labels = Array.from(mergedLabelIds).map((id: string) => {
      const label: Label = new Label();
      label.id = new ObjectID(id);
      return label;
    });

    logger.debug(
      `MessageQueueLabelRuleEngine attached ${newLabelIds.length} labels to queue ${messageQueue.id}`,
      { projectId: messageQueue.projectId.toString() } as LogAttributes,
    );

    return RuleApplicationResultUtil.updated(newLabelIds.length);
  }

  private doesMessageQueueMatchRule(
    messageQueue: MessageQueue,
    rule: MessageQueueLabelRule,
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
      matchesLegacyRule: (legacyRule: MessageQueueLabelRule): boolean => {
        return this.doesMessageQueueMatchLegacyRule(messageQueue, legacyRule);
      },
    });
  }

  private doesMessageQueueMatchLegacyRule(
    messageQueue: MessageQueue,
    rule: MessageQueueLabelRule,
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
    rule: MessageQueueLabelRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(`Invalid regex in queue label rule ${rule.id}: ${pattern}`);
      return false;
    }
  }
}

export default new MessageQueueLabelRuleEngineServiceClass();
