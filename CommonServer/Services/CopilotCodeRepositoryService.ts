import PostgresDatabase from "../Infrastructure/PostgresDatabase";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import ObjectID from "Common/Types/ObjectID";
import Model from "Common/AppModels/Models/CopilotCodeRepository";

export class Service extends DatabaseService<Model> {
  public constructor(postgresDatabase?: PostgresDatabase) {
    super(Model, postgresDatabase);
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    createBy.data.secretToken = ObjectID.generate();

    return {
      carryForward: null,
      createBy: createBy,
    };
  }
}

export default new Service();
