import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import BadDataException from "../../Types/Exception/BadDataException";
import Model from "../../Models/DatabaseModels/IncidentRole";
import LIMIT_MAX from "../../Types/Database/LimitMax";

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

    return { updateBy, carryForward: null };
  }

  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const roles: Array<Model> = await this.findBy({
      query: deleteBy.query,
      limit: LIMIT_MAX,
      skip: 0,
      select: {
        name: true,
        isDeleteable: true,
      },
      props: deleteBy.props,
    });

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
