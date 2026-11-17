import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/StatusPageSCIM";
import HashedString from "../../Types/HashedString";
import PresentedKey from "../Utils/PresentedKey/PresentedKey";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    /*
     * A connection made without a token gets one: 256 random bits. It is
     * kept only as its hash (#9012), and the create's answer holds it once,
     * as written (DatabaseService.restorePresentedKeys) - the one time the
     * Dashboard can show it.
     */
    if (!createBy.data.bearerToken || !createBy.data.bearerToken.toString()) {
      createBy.data.bearerToken = new HashedString(PresentedKey.generate());
    }

    return {
      createBy: createBy,
      carryForward: {},
    };
  }
}

export default new Service();
