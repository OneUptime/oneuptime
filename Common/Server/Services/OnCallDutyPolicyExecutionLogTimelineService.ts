import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import { OnCreate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import Model from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import IncidentFeedService from "./IncidentFeedService";
import { IncidentFeedEventType } from "../../Models/DatabaseModels/IncidentFeed";
import OnCallDutyExecutionLogTimelineStatus from "../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import { Blue500, Green500, Red500, Yellow500 } from "../../Types/BrandColors";
import Color from "../../Types/Color";
import ObjectID from "../../Types/ObjectID";

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
    const onCallDutyPolicyExecutionLogTimeline: Model | null =
      await this.findOneById({
        id: data.onCallDutyPolicyExecutionLogTimelineId,
        select: {
          _id: true,
          onCallDutyPolicyId: true,
          triggeredByIncidentId: true,
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

    if (!onCallDutyPolicyExecutionLogTimeline) {
      return;
    }

    if (!onCallDutyPolicyExecutionLogTimeline.triggeredByIncidentId) {
      return;
    }

    const onCallPolicy: OnCallDutyPolicy | null =
      await OnCallDutyPolicyService.findOneById({
        id: onCallDutyPolicyExecutionLogTimeline.onCallDutyPolicyId!,
        select: {
          _id: true,
          projectId: true,
          name: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (onCallPolicy && onCallPolicy.id) {
      const status: OnCallDutyExecutionLogTimelineStatus =
        onCallDutyPolicyExecutionLogTimeline.status!;

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
    The On Call Policy "${onCallPolicy.name}" has been triggered. The escalation rule "${onCallDutyPolicyExecutionLogTimeline.onCallDutyPolicyEscalationRule?.name}" ${onCallDutyPolicyExecutionLogTimeline.onCallDutySchedule?.name ? String(" and schedule " + onCallDutyPolicyExecutionLogTimeline.onCallDutySchedule?.name) : ""} were applied. The user "${onCallDutyPolicyExecutionLogTimeline.alertSentToUser?.name}" (${onCallDutyPolicyExecutionLogTimeline.alertSentToUser?.email}) was alerted. The current status is "${status}" with the message: "${onCallDutyPolicyExecutionLogTimeline.statusMessage}". ${onCallDutyPolicyExecutionLogTimeline.userBelongsToTeam?.name ? "The user belongs to the team " + onCallDutyPolicyExecutionLogTimeline.userBelongsToTeam?.name : ""} ${onCallDutyPolicyExecutionLogTimeline.isAcknowledged ? "The alert was acknowledged at " + onCallDutyPolicyExecutionLogTimeline.acknowledgedAt : ""}
      `;

        await IncidentFeedService.createIncidentFeed({
          incidentId:
            onCallDutyPolicyExecutionLogTimeline.triggeredByIncidentId,
          projectId: onCallPolicy.projectId!,
          incidentFeedEventType: IncidentFeedEventType.OnCallPolicy,
          displayColor: displayColor,
          feedInfoInMarkdown: feedInfoInMarkdown,
        });
      }
    }
  }

  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (createdItem.triggeredByIncidentId) {
      await this.addToIncidentFeed({
        onCallDutyPolicyExecutionLogTimelineId: createdItem.id!,
      });
    }

    return createdItem;
  }
}
export default new Service();
