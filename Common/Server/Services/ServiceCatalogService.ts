import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import ArrayUtil from "Common/Types/ArrayUtil";
import { BrightColors } from "Common/Types/BrandColors";
import Model from "Common/Models/DatabaseModels/ServiceCatalog";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    // select a random color.
    createBy.data.serviceColor = ArrayUtil.selectItemByRandom(BrightColors);

    return {
      carryForward: null,
      createBy: createBy,
    };
  }
}

export default new Service();
