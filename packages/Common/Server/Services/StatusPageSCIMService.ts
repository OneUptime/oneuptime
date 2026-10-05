import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/StatusPageSCIM";
import ObjectID from "../../Types/ObjectID";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    if (!createBy.data.bearerToken) {
      // Generate a secure bearer token if not provided
      createBy.data.bearerToken = ObjectID.generate().toString();
    }

    return {
      createBy: createBy,
      carryForward: {},
    };
  }
}

export default new Service();
