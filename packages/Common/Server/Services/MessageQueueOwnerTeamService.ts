import ObjectID from "../../Types/ObjectID";
import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/MessageQueueOwnerTeam";
import { OnCreate } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import ModelPermission from "../Types/Database/Permissions/Index";
import MessageQueueService from "./MessageQueueService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * A caller adding an owner: the create permission first (so the lookup
   * below is no way to probe for queues), then the queue must be in the
   * caller's project - by its FK column and its relation object alike.
   * Root writes (owner rules) choose their own queue, which the generic
   * reference check below still holds to the project.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.props.isRoot) {
      ModelPermission.checkCreatePermissions(
        Model,
        createBy.data,
        createBy.props,
      );

      await MessageQueueService.assertMessageQueueReferenceInProject(createBy);
    }

    /*
     * Then the team or user, and the queue once more for a root write: every
     * reference must be the project's (see ProjectReferencesService).
     */
    await super.onBeforeCreate(createBy);

    return { createBy: createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const messageQueueId: ObjectID | undefined = createdItem.messageQueueId;
    const teamId: ObjectID | undefined = createdItem.teamId;

    /*
     * Added by a person (not an owner rule): whoever added this owner first,
     * it now counts as somebody investing in the queue.
     */
    if (messageQueueId && teamId && !onCreate.createBy.props.isRoot) {
      await MessageQueueService.forgetAutomaticAssignments({
        messageQueueId: messageQueueId,
        kind: "ownerTeamIds",
        ids: [teamId],
      });
    }

    return createdItem;
  }
}

export default new Service();
