import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/ProjectSso";
import { fillSamlProviderDefaults } from "../../Types/SSO/SamlProviderDefaults";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import SsoProviderTeamGrant, {
  SsoProviderKind,
} from "../Utils/SsoProviderTeamGrant";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * A SAML provider created without a signature method, a digest method or
   * a description gets the usual ones (Types/SSO/SamlProviderDefaults),
   * before the required-field check runs: the columns stay required, so the
   * API and Terraform keep their contract, and a caller may leave them out.
   * What the caller sent is kept.
   *
   * Its teams must be teams the person creating it could invite someone to
   * (Utils/SsoProviderTeamGrant): people who sign in with it join them.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    fillSamlProviderDefaults(createBy.data);

    await SsoProviderTeamGrant.assertCanCreate({
      kind: SsoProviderKind.Saml,
      modelType: Model,
      provider: createBy.data,
      props: createBy.props,
    });

    return { createBy, carryForward: null };
  }

  // Every save, by the same rule as a create (Utils/SsoProviderTeamGrant).
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    return {
      updateBy: await SsoProviderTeamGrant.checkUpdate<Model>({
        kind: SsoProviderKind.Saml,
        service: this,
        updateBy: updateBy,
      }),
      carryForward: null,
    };
  }
}

export default new Service();
