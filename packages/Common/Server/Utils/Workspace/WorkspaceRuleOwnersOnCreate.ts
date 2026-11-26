import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "../../../Types/ObjectID";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import WorkspaceNotificationRuleService from "../../Services/WorkspaceNotificationRuleService";
import CreateBy from "../../Types/Database/CreateBy";
import logger, { LogAttributes } from "../Logger";
import CreatedNotificationHold, {
  OwnersAddedBy,
} from "../Notification/CreatedNotificationHold";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * A NOTIFICATION RULE THAT ASKS WHO OWNS A RECORD, MATCHED AS THE RECORD IS
 * CREATED (#11146).
 *
 * "Alert Owner is any of Platform" is matched on the alert's owner rows
 * (WorkspaceRecordOwners). An incident's or alert's create chain adds the
 * owners handed over with its create and those its owner rules add before
 * it opens the record's channels and posts its Created message, so its
 * rules see them. Two more kinds of owner come from outside the chain,
 * which nothing orders it after (CreatedNotificationHold): its creator,
 * made an owner as the create returns (Create), and the owners the code
 * that made it adds once the create has returned - a monitor's criteria's,
 * the network device's, an SLO rule's (Caller).
 *
 * In a project with a rule that asks who owns such a record, the chain
 * waits for them first: a moment - they are in milliseconds after the
 * create returns - and OWNERS_WAITED_FOR_AT_MOST_MS at most. An owner that
 * comes in later is posted as it is added, and a rule it makes match opens
 * its channel then (createChannelsForRulesThatNowMatch), as for any owner
 * added later. A project without such a rule waits for nobody.
 */

// The owners added outside a record's create chain.
const OWNERS_ADDED_OUTSIDE_THE_CHAIN: ReadonlyArray<OwnersAddedBy> = [
  OwnersAddedBy.Create,
  OwnersAddedBy.Caller,
];

export default class WorkspaceRuleOwnersOnCreate {
  /*
   * How long a create waits, at most, for the owners added outside its
   * chain before its rules are matched. They are in well within it; past
   * it, the rules are matched without them.
   */
  public static readonly OWNERS_WAITED_FOR_AT_MOST_MS: number = 10 * 1000;

  /*
   * Right before a record's channels are opened and its Created message is
   * posted, in its create chain: waits for the owners its creator and the
   * code that made it add - only while one of them still says it is adding
   * owners, and only in a project with a rule for this kind of record that
   * asks who owns it. Never throws: the rules are matched whatever happens
   * here.
   */
  @CaptureSpan()
  public static async waitForOwnersOfCreate<
    TBaseModel extends BaseModel,
  >(data: {
    createBy: CreateBy<TBaseModel>;
    projectId: ObjectID;
    eventType: NotificationRuleEventType;
    recordId: ObjectID;
  }): Promise<void> {
    const create: CreateBy<BaseModel> =
      data.createBy as unknown as CreateBy<BaseModel>;

    const logAttributes: LogAttributes = {
      projectId: data.projectId.toString(),
      recordId: data.recordId.toString(),
    } as LogAttributes;

    try {
      if (
        !CreatedNotificationHold.isAddingOwners(
          create,
          OWNERS_ADDED_OUTSIDE_THE_CHAIN,
        )
      ) {
        return;
      }

      if (
        !(await WorkspaceNotificationRuleService.hasRulesWithOwnerCondition({
          projectId: data.projectId,
          eventType: data.eventType,
        }))
      ) {
        return;
      }

      const areIn: boolean = await CreatedNotificationHold.whenOwnersAreIn(
        create,
        OWNERS_ADDED_OUTSIDE_THE_CHAIN,
        this.OWNERS_WAITED_FOR_AT_MOST_MS,
      );

      if (!areIn) {
        logger.warn(
          `${data.eventType} ${data.recordId.toString()}'s owners were not all in after ${this.OWNERS_WAITED_FOR_AT_MOST_MS} ms: its notification rules are matched without them, and an owner who comes in later is posted as they are added.`,
          logAttributes,
        );
      }
    } catch (err) {
      logger.error(
        `Could not wait for ${data.eventType} ${data.recordId.toString()}'s owners before matching its notification rules: ${err}`,
        logAttributes,
      );
    }
  }
}
