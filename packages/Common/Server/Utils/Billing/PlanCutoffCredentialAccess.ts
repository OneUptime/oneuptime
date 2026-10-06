import { IsBillingEnabled } from "../../EnvironmentConfig";
import ProjectService, { CurrentPlan } from "../../Services/ProjectService";
import DatabaseRequestType from "../../Types/BaseDatabase/DatabaseRequestType";
import BillingPermissions from "../../Types/Database/Permissions/BillingPermission";
import CaptureSpan from "../Telemetry/CaptureSpan";
import ApiKey from "../../../Models/DatabaseModels/ApiKey";
import { DatabaseBaseModelType } from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ProjectSCIM from "../../../Models/DatabaseModels/ProjectSCIM";
import StatusPageSCIM from "../../../Models/DatabaseModels/StatusPageSCIM";
import {
  getPlanCutoffMessage,
  PlanCutoffCredential,
} from "../../../Types/Billing/PlanCutoffCredentials";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../Types/ObjectID";

/*
 * Whether a project's API keys and SCIM connections work on its plan
 * (Types/Billing/PlanCutoffCredentials), asked where each authenticates:
 * the API-key middleware (ProjectMiddleware.isValidProjectIdAndApiKey-
 * Middleware), which every API-key request goes through whatever route it
 * is for, and the SCIM middleware (ee/Server/Identity/Middleware/
 * SCIMAuthorization), which every SCIM route goes through. Asked only once
 * the credential has checked out, so a caller without a valid key or token
 * learns nothing about a project's plan.
 *
 * The plan a credential needs is the plan its table is sold on - the plan
 * creating one needs (@TableBillingAccessControl): Growth for API keys and
 * Scale for project and status page SCIM, the same plans the Dashboard's
 * upgrade prompts name. The comparison is the one every plan check makes
 * (BillingPermissions.getMissingPlan), on the plan every request is held to
 * (ProjectService.getCurrentPlan): a trial counts as its plan, and so does
 * a subscription that is past due. An unpaid subscription is not a plan
 * change: it is held to the unpaid checks the rest of billing already
 * makes, as before.
 *
 * ProjectService caches a project's plan for 60 seconds on each server and
 * drops the entry when the plan is changed on that server
 * (ProjectService.changePlan), so a downgrade or an upgrade takes effect at
 * once there and within a minute everywhere else.
 */

const MODEL_TYPE_BY_CREDENTIAL: Readonly<
  Record<PlanCutoffCredential, DatabaseBaseModelType>
> = {
  [PlanCutoffCredential.ApiKey]: ApiKey,
  [PlanCutoffCredential.ProjectSCIM]: ProjectSCIM,
  [PlanCutoffCredential.StatusPageSCIM]: StatusPageSCIM,
};

export default class PlanCutoffCredentialAccess {
  // The plan a credential of this kind needs, or null when it needs none.
  public static getRequiredPlan(
    credential: PlanCutoffCredential,
  ): PlanType | null {
    return BillingPermissions.getRequiredPlan(
      new MODEL_TYPE_BY_CREDENTIAL[credential](),
      DatabaseRequestType.Create,
    );
  }

  /*
   * Whether a project on `currentPlan` has the plan this kind of credential
   * needs. No plan (billing off) has nothing to compare and always has it.
   */
  public static isOnPlan(data: {
    credential: PlanCutoffCredential;
    currentPlan: PlanType | null;
  }): boolean {
    if (!data.currentPlan) {
      return true;
    }

    return (
      BillingPermissions.getMissingPlan(
        new MODEL_TYPE_BY_CREDENTIAL[data.credential](),
        DatabaseRequestType.Create,
        data.currentPlan,
      ) === null
    );
  }

  /*
   * The plan the project's credentials of this kind need, when the project
   * is not on it; null when they work - billing is off, or the project's
   * plan reaches it. Throws when the project's plan cannot be read (a
   * project that does not exist, or has no plan yet), as every request of
   * the project does.
   */
  @CaptureSpan()
  public static async getMissingPlan(data: {
    projectId: ObjectID;
    credential: PlanCutoffCredential;
  }): Promise<PlanType | null> {
    if (!IsBillingEnabled) {
      return null;
    }

    const currentPlan: CurrentPlan = await ProjectService.getCurrentPlan(
      data.projectId,
    );

    if (!currentPlan.plan) {
      return null;
    }

    return BillingPermissions.getMissingPlan(
      new MODEL_TYPE_BY_CREDENTIAL[data.credential](),
      DatabaseRequestType.Create,
      currentPlan.plan,
    );
  }

  /*
   * The refusal for a request authenticated by one of the project's
   * credentials of this kind while the project is below the plan they need
   * - a 402 naming the plan, and saying the credentials are kept - or null
   * when the request may go on.
   */
  @CaptureSpan()
  public static async getRefusal(data: {
    projectId: ObjectID;
    credential: PlanCutoffCredential;
  }): Promise<PaymentRequiredException | null> {
    const missingPlan: PlanType | null =
      await PlanCutoffCredentialAccess.getMissingPlan(data);

    if (!missingPlan) {
      return null;
    }

    return new PaymentRequiredException(
      getPlanCutoffMessage(data.credential, missingPlan),
    );
  }
}
