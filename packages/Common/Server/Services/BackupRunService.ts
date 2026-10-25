import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/BackupRun";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";

// Why a write by anyone but OneUptime itself is refused.
export const BACKUP_RUN_WRITE_REFUSED_MESSAGE: string =
  "Backups are started, restored, cancelled and deleted from Settings > Backups in the Admin Dashboard.";

/*
 * Backup runs: what the Backups page lists. Master admins read them (the
 * table's empty access lists leave it to them); only OneUptime writes them.
 * Starting a backup, restoring, cancelling and deleting go through the
 * Enterprise Edition's routes (ee/Server/Backup/API), which do at the
 * destination what the row says - a row deleted through the CRUD API would
 * leave its files behind, and one written there would claim a backup that
 * does not exist.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  private static assertWrittenByOneUptime(
    props: DatabaseCommonInteractionProps,
  ): void {
    if (!props.isRoot) {
      throw new BadDataException(BACKUP_RUN_WRITE_REFUSED_MESSAGE);
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    Service.assertWrittenByOneUptime(createBy.props);

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    Service.assertWrittenByOneUptime(updateBy.props);

    return { updateBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    Service.assertWrittenByOneUptime(deleteBy.props);

    return { deleteBy, carryForward: null };
  }
}

export default new Service();
