import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import SsoProviderTeamGrant, {
  SsoProviderKind,
} from "../Utils/SsoProviderTeamGrant";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/ProjectSCIM";
import HashedString from "../../Types/HashedString";
import PresentedKey from "../Utils/PresentedKey/PresentedKey";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Through its Groups endpoints a SCIM connection can change the members of
   * any team in the project, so saving one - creating it, editing it, or
   * replacing its bearer token - takes access that could invite someone to
   * every team, and its default teams must be the project's own
   * (Utils/SsoProviderTeamGrant).
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await SsoProviderTeamGrant.assertCanCreate({
      kind: SsoProviderKind.Scim,
      modelType: Model,
      provider: createBy.data,
      props: createBy.props,
    });

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

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    return {
      updateBy: await SsoProviderTeamGrant.checkUpdate<Model>({
        kind: SsoProviderKind.Scim,
        service: this,
        updateBy: updateBy,
      }),
      carryForward: null,
    };
  }
}

export default new Service();
