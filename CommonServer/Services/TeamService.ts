import PostgresDatabase from "../Infrastructure/PostgresDatabase";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnDelete, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import DatabaseService from "./DatabaseService";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import BadDataException from "Common/Types/Exception/BadDataException";
import Model from "Common/AppModels/Models/Team";

export class Service extends DatabaseService<Model> {
  public constructor(postgresDatabase?: PostgresDatabase) {
    super(Model, postgresDatabase);
  }

  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    // get teams by query.

    const teams: Array<Model> = await this.findBy({
      query: updateBy.query,
      limit: LIMIT_MAX,
      skip: 0,
      select: {
        name: true,
        isTeamEditable: true,
      },

      props: updateBy.props,
    });

    for (const team of teams) {
      if (!team.isTeamEditable) {
        throw new BadDataException(
          `${
            team.name || "This"
          } team cannot be updated because its a critical team for this project.`,
        );
      }
    }

    return { updateBy, carryForward: null };
  }

  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const teams: Array<Model> = await this.findBy({
      query: deleteBy.query,
      limit: LIMIT_MAX,
      skip: 0,
      select: {
        name: true,
        isTeamDeleteable: true,
      },

      props: deleteBy.props,
    });

    for (const team of teams) {
      if (!team.isTeamDeleteable) {
        throw new BadDataException(
          `${
            team.name || "This"
          } team cannot be deleted its a critical team for this project.`,
        );
      }
    }

    return { deleteBy, carryForward: null };
  }
}
export default new Service();
