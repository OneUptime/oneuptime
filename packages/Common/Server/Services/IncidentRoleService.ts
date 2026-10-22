import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import ArchivableValueGuard from "../Utils/Database/ArchivableValueGuard";
import {
  ARCHIVABLE_VALUES,
  ArchivableValueType,
} from "../../Utils/ArchivableValues";
import BadDataException from "../../Types/Exception/BadDataException";
import Model from "../../Models/DatabaseModels/IncidentRole";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    // Primary roles cannot allow multiple users
    if (createBy.data.isPrimaryRole && createBy.data.canAssignMultipleUsers) {
      throw new BadDataException(
        "Primary roles cannot allow multiple users to be assigned.",
      );
    }

    // The primary role is never created archived. See ArchivableValueGuard.
    await ArchivableValueGuard.beforeCreate({
      service: this,
      definition: ARCHIVABLE_VALUES[ArchivableValueType.IncidentRole],
      createBy: createBy,
    });

    return { createBy, carryForward: null };
  }

  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    /*
     * A primary role cannot allow multiple users: every role the update
     * writes is read, and the update held to them.
     */
    if (updateBy.data.canAssignMultipleUsers === true) {
      const roles: Array<Model> = await this.findRowsAndHoldUpdateToThem(
        updateBy,
        {
          isPrimaryRole: true,
        },
      );

      if (
        roles.some((role: Model): boolean => {
          return Boolean(role.isPrimaryRole);
        })
      ) {
        throw new BadDataException(
          "Primary roles cannot allow multiple users to be assigned.",
        );
      }
    }

    // The primary role is never archived. See ArchivableValueGuard.
    await ArchivableValueGuard.beforeUpdate({
      service: this,
      definition: ARCHIVABLE_VALUES[ArchivableValueType.IncidentRole],
      updateBy: updateBy,
    });

    return { updateBy, carryForward: null };
  }

  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    // Every role the delete removes, and the delete held to them.
    const roles: Array<Model> = await this.findRowsAndHoldDeleteToThem(
      deleteBy,
      {
        name: true,
        isDeleteable: true,
      },
    );

    for (const role of roles) {
      if (role.isDeleteable === false) {
        throw new BadDataException(
          `${
            role.name || "This"
          } role cannot be deleted because it is a required role for incident management.`,
        );
      }
    }

    return { deleteBy, carryForward: null };
  }
}
export default new Service();
