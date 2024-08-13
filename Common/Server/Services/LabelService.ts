import PostgresDatabase from "../Infrastructure/PostgresDatabase";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import DatabaseService from "./DatabaseService";
import BadDataException from "Common/Types/Exception/BadDataException";
import Model from "Common/Models/DatabaseModels/Label";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    let existingProjectWithSameNameCount: number = 0;

    existingProjectWithSameNameCount = (
      await this.countBy({
        query: {
          name: QueryHelper.findWithSameText(createBy.data.name!),
          projectId: createBy.props.tenantId!,
        },
        props: {
          isRoot: true,
        },
      })
    ).toNumber();

    if (existingProjectWithSameNameCount > 0) {
      throw new BadDataException(
        "Label with the same name already exists in this project.",
      );
    }

    return Promise.resolve({ createBy, carryForward: null });
  }
}

export default new Service();
