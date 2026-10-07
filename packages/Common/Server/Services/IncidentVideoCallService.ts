import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import BadDataException from "../../Types/Exception/BadDataException";
import CountBy from "../Types/Database/CountBy";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import FindBy from "../Types/Database/FindBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnFind, OnUpdate } from "../Types/Database/Hooks";
import ModelPermission from "../Types/Database/Permissions/Index";
import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/IncidentVideoCall";
import { applyIncidentRelatedRecordPrivacyFilter } from "../Utils/Incident/IncidentPrivacyFilter";
import EventVideoCall, {
  VideoCallCarryForward,
  VideoCallEvent,
  VideoCallEventType,
  VideoCallFields,
} from "../Utils/VideoCall/EventVideoCall";
import ProjectReferenceCheck from "../Utils/Database/ProjectReferenceCheck";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import SortOrder from "../../Types/BaseDatabase/SortOrder";

/*
 * Incident video calls. A create fills the call in before it is saved -
 * starting the meeting at the provider when it comes from a connection (see
 * EventVideoCall) - and announces it once it is, wherever the incident's
 * updates go. Reads, updates and deletes see only the calls of incidents
 * the caller may see, as every incident child table does.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeFind(
    findBy: FindBy<Model>,
  ): Promise<OnFind<Model>> {
    findBy.query = applyIncidentRelatedRecordPrivacyFilter(
      findBy.query,
      findBy.props,
    );
    return { findBy, carryForward: null };
  }

  @CaptureSpan()
  public override async countBy(
    countBy: CountBy<Model>,
  ): Promise<PositiveNumber> {
    countBy.query = applyIncidentRelatedRecordPrivacyFilter(
      countBy.query,
      countBy.props,
    );
    return super.countBy(countBy);
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    updateBy.query = applyIncidentRelatedRecordPrivacyFilter(
      updateBy.query,
      updateBy.props,
    );
    return { updateBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    deleteBy.query = applyIncidentRelatedRecordPrivacyFilter(
      deleteBy.query,
      deleteBy.props,
    );
    return { deleteBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    const data: Model = createBy.data;
    const isServerWrite: boolean = ProjectReferenceCheck.isServerWrite(
      createBy.props,
    );

    if (!data.incidentId) {
      throw new BadDataException("Incident ID is required.");
    }

    /*
     * Everything a person may not do is refused before a meeting is started
     * at the provider: what they may write, and which incidents they may
     * see.
     */
    if (!createBy.props.isRoot && !createBy.props.isMasterAdmin) {
      ModelPermission.checkCreatePermissions(
        this.modelType,
        data,
        createBy.props,
      );
    }

    await EventVideoCall.assertCallerCanSeeEvent({
      type: VideoCallEventType.Incident,
      id: data.incidentId,
      props: createBy.props,
    });

    const event: VideoCallEvent = await EventVideoCall.getEvent({
      type: VideoCallEventType.Incident,
      id: data.incidentId,
    });

    const prepared: {
      fields: VideoCallFields;
      carryForward: VideoCallCarryForward;
    } = await EventVideoCall.prepare({
      event,
      isServerWrite,
      fields: {
        provider: data.provider,
        videoCallConnectionId: data.videoCallConnectionId,
        title: data.title,
        joinUrl: data.joinUrl,
        externalMeetingId: data.externalMeetingId,
        workspaceNotificationRuleId: data.workspaceNotificationRuleId,
      },
    });

    EventVideoCall.applyFields(data, prepared.fields);

    /*
     * The relations of the fields above are OneUptime's to set too: a
     * request that named the rule or the meeting by its relation instead
     * of its id is not let through that way.
     */
    delete data.workspaceNotificationRule;

    if (!prepared.fields.videoCallConnectionId) {
      delete data.videoCallConnection;
    }

    return {
      createBy: createBy,
      carryForward: prepared.carryForward,
    };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const carryForward: VideoCallCarryForward =
      (onCreate.carryForward as VideoCallCarryForward | undefined) || {};

    if (createdItem.incidentId && createdItem.provider && createdItem.joinUrl) {
      await EventVideoCall.announce({
        eventType: VideoCallEventType.Incident,
        eventId: createdItem.incidentId,
        provider: createdItem.provider,
        joinUrl: createdItem.joinUrl,
        title: createdItem.title,
        connectionName: carryForward.connectionName,
        workspaceNotificationRuleId: createdItem.workspaceNotificationRuleId,
        userId:
          createdItem.createdByUserId ||
          createdItem.createdByUser?.id ||
          undefined,
      });
    }

    return createdItem;
  }

  // Every call of an incident, oldest first. Read as root.
  @CaptureSpan()
  public async getCallsForIncident(
    incidentId: ObjectID,
  ): Promise<Array<Model>> {
    return await this.findBy({
      query: { incidentId: incidentId },
      select: {
        _id: true,
        provider: true,
        joinUrl: true,
        videoCallConnectionId: true,
        workspaceNotificationRuleId: true,
      },
      sort: { createdAt: SortOrder.Ascending },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: { isRoot: true },
    });
  }
}

export default new Service();
