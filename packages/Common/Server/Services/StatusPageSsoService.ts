import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/StatusPageSso";
import { fillSamlProviderDefaults } from "../../Types/SSO/SamlProviderDefaults";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import PartialEntity from "../../Types/Database/PartialEntity";
import Dictionary from "../../Types/Dictionary";
import SsoSignInsEnded from "../Utils/SsoSignInsEnded";
import { OnCreate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * A SAML provider created without a signature method, a digest method or
   * a description gets the usual ones (Types/SSO/SamlProviderDefaults),
   * before the required-field check runs: the columns stay required, so the
   * API and Terraform keep their contract, and a caller may leave them out.
   * What the caller sent is kept.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    fillSamlProviderDefaults(createBy.data);

    return { createBy, carryForward: null };
  }

  /*
   * Turning the provider off writes when, in the same write: the sessions it
   * signed in on the status page stop counting, and turning it on again
   * does not bring them back (StatusPagePrivateUserSessionService.
   * addSignInRule). The time is the database's, as the sessions' are
   * (getRowWriteSql). Deleting it ends them too: they name a provider that
   * is gone.
   */
  @CaptureSpan()
  protected override async onUpdatePermitted(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    await super.onUpdatePermitted(updateBy);

    await SsoSignInsEnded.stampWhenTurnedOffByDatabase<Model>({
      service: this,
      updateBy: updateBy,
    });
  }

  // When a turning-off write ended the provider's sessions, by the database's clock.
  protected override getRowWriteSql(
    data: PartialEntity<Model>,
  ): Dictionary<string> {
    return {
      ...super.getRowWriteSql(data),
      ...SsoSignInsEnded.getDatabaseStampSql(data),
    };
  }
}

export default new Service();
