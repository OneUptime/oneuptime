import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import Model from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import IncidentFeedService from "./IncidentFeedService";
import { IncidentFeedEventType } from "../../Models/DatabaseModels/IncidentFeed";
import OnCallDutyExecutionLogTimelineStatus from "../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import { Blue500, Green500, Red500, Yellow500 } from "../../Types/BrandColors";
import Color from "../../Types/Color";
import ObjectID from "../../Types/ObjectID";
import logger from "../Utils/Logger";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  public getColorBasedOnStatus(
    status: OnCallDutyExecutionLogTimelineStatus,
  ): Color {
    switch (status) {
      case OnCallDutyExecutionLogTimelineStatus.Started:
        return Blue500;
      case OnCallDutyExecutionLogTimelineStatus.Executing:
        return Yellow500;
      case OnCallDutyExecutionLogTimelineStatus.Error:
        return Red500;
      case OnCallDutyExecutionLogTimelineStatus.NotificationSent:
        return Green500;
      case OnCallDutyExecutionLogTimelineStatus.Skipped:
        return Red500;
      case OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged:
        return Green500;
      default:
        return Blue500;
    }
  }

  public async addToIncidentFeed(data: {
    onCallDutyPolicyExecutionLogTimelineId: ObjectID;
  }): Promise<void> {

    logger.debug("OnCallDutyPolicyExecutionLogTimelineService.addToIncidentFeed");

    const onCallDutyPolicyExecutionLogTimeline: Model | null =
      await this.findOneById({
        id: data.onCallDutyPolicyExecutionLogTimelineId,
        select: {
          _id: true,
          onCallDutyPolicyId: true,
          triggeredByIncidentId: true,
          projectId: true,
          status: true,
          statusMessage: true,
          alertSentToUserId: true,
          onCallDutyPolicy: {
            name: true,
            _id: true,
          },
          alertSentToUser: {
            name: true,
            email: true,
          },
          onCallDutyPolicyEscalationRule: {
            name: true,
            _id: true,
          },
          onCallDutySchedule: {
            name: true,
            _id: true,
          },
          isAcknowledged: true,
          acknowledgedAt: true,
          userBelongsToTeam: {
            name: true,
            _id: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

    logger.debug("OnCallDutyPolicyExecutionLogTimeline: ");
    logger.debug(onCallDutyPolicyExecutionLogTimeline);

    if (!onCallDutyPolicyExecutionLogTimeline) {
      return;
    }

    if (!onCallDutyPolicyExecutionLogTimeline.triggeredByIncidentId) {
      return;
    }

    if (onCallDutyPolicyExecutionLogTimeline.onCallDutyPolicy && onCallDutyPolicyExecutionLogTimeline.onCallDutyPolicy.id) {
      const status: OnCallDutyExecutionLogTimelineStatus =
        onCallDutyPolicyExecutionLogTimeline.status!;

      logger.debug("Status: " + status);

      if (
        status &&
        (status === OnCallDutyExecutionLogTimelineStatus.Skipped ||
          status === OnCallDutyExecutionLogTimelineStatus.Error ||
          status ===
          OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged ||
          status === OnCallDutyExecutionLogTimelineStatus.NotificationSent)
      ) {
        const displayColor: Color = status
          ? this.getColorBasedOnStatus(status)
          : Blue500;

        const feedInfoInMarkdown: string = `
    The On Call Policy "${onCallDutyPolicyExecutionLogTimeline.onCallDutyPolicy.name}" has been triggered. The escalation rule "${onCallDutyPolicyExecutionLogTimeline.onCallDutyPolicyEscalationRule?.name}" ${onCallDutyPolicyExecutionLogTimeline.onCallDutySchedule?.name ? String(" and schedule " + onCallDutyPolicyExecutionLogTimeline.onCallDutySchedule?.name) : ""} were applied. The user "${onCallDutyPolicyExecutionLogTimeline.alertSentToUser?.name}" (${onCallDutyPolicyExecutionLogTimeline.alertSentToUser?.email}) was alerted. The current status is "${status}" with the message: "${onCallDutyPolicyExecutionLogTimeline.statusMessage}". ${onCallDutyPolicyExecutionLogTimeline.userBelongsToTeam?.name ? "The user belongs to the team " + onCallDutyPolicyExecutionLogTimeline.userBelongsToTeam?.name : ""} ${onCallDutyPolicyExecutionLogTimeline.isAcknowledged ? "The alert was acknowledged at " + onCallDutyPolicyExecutionLogTimeline.acknowledgedAt : ""}
      `;

        logger.debug("Feed Info in Markdown: " + feedInfoInMarkdown);


        await IncidentFeedService.createIncidentFeed({
          incidentId:
            onCallDutyPolicyExecutionLogTimeline.triggeredByIncidentId,
          projectId: onCallDutyPolicyExecutionLogTimeline.projectId!,
          incidentFeedEventType: IncidentFeedEventType.OnCallPolicy,
          displayColor: displayColor,
          feedInfoInMarkdown: feedInfoInMarkdown,
        });

        logger.debug("Incident Feed created");
      }
    }
  }

  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {

    logger.debug("OnCallDutyPolicyExecutionLogTimelineService.onCreateSuccess");
    logger.debug(createdItem);



    await this.addToIncidentFeed({
      onCallDutyPolicyExecutionLogTimelineId: createdItem.id!,
    });


    return createdItem;
  }


  protected override async onUpdateSuccess(onUpdate: OnUpdate<Model>, _updatedItemIds: Array<ObjectID>): Promise<OnUpdate<Model>> {

    if(onUpdate.updateBy.query.id){
      await this.addToIncidentFeed({
        onCallDutyPolicyExecutionLogTimelineId: onUpdate.updateBy.query.id as ObjectID,
      });
    }

    return onUpdate; 
  }
}
export default new Service();
