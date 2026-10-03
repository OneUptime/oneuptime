import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/StatusPageOidc";
import { fillOidcProviderDefaults } from "../../Types/SSO/OidcProviderDefaults";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<Model> {
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
    fillOidcProviderDefaults(createBy.data);

    return { createBy, carryForward: null };
  }
}

export default new Service();
