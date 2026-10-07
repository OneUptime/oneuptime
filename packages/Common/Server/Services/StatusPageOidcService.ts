import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/StatusPageOidc";
import { fillOidcProviderDefaults } from "../../Types/SSO/OidcProviderDefaults";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import SsoSignInsEnded from "../Utils/SsoSignInsEnded";
import { OnCreate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * A provider created without a discovery URL, scopes, claim names or a
   * description gets the usual ones (Types/SSO/OidcProviderDefaults), before
   * the required-field check runs: the columns stay required, so the API and
   * Terraform keep their contract, and a caller may leave them out. What the
   * caller sent is kept.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    fillOidcProviderDefaults(createBy.data);

    return { createBy, carryForward: null };
  }

  /*
   * Turning the provider off writes when, in the same write: the sessions it
   * signed in on the status page stop counting, and turning it on again
   * does not bring them back (StatusPagePrivateUserSessionService.
   * addSignInRule). Deleting it ends them too: they name a provider that is
   * gone.
   */
  @CaptureSpan()
  protected override async onUpdatePermitted(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    await super.onUpdatePermitted(updateBy);

    await SsoSignInsEnded.stampWhenTurnedOff<Model>({
      service: this,
      updateBy: updateBy,
    });
  }
}

export default new Service();
