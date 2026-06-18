import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/GlobalOidc";
import ProjectService from "./ProjectService";
import ObjectID from "../../Types/ObjectID";
import { OnDelete, OnUpdate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    _updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    /*
     * "Force SSO for Login" (and whether the provider is enabled) changes the
     * effective SSO enforcement of every attached project, which ProjectService
     * resolves dynamically. Drop its enforcement cache so the change is honored
     * immediately rather than after the 60s TTL.
     */
    const data: { requireSsoForLogin?: unknown; isEnabled?: unknown } =
      onUpdate.updateBy.data;

    if (data.requireSsoForLogin !== undefined || data.isEnabled !== undefined) {
      ProjectService.clearSsoEnforcementCache();
    }

    return onUpdate;
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _deletedItemIds: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    // A deleted provider may have been forcing SSO on some projects.
    ProjectService.clearSsoEnforcementCache();
    return onDelete;
  }
}

export default new Service();
