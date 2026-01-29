import DeleteBy from "../Types/Database/DeleteBy";
import { OnDelete } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import BadDataException from "../../Types/Exception/BadDataException";
import Model from "../../Models/DatabaseModels/IncidentRole";
import LIMIT_MAX from "../../Types/Database/LimitMax";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
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
