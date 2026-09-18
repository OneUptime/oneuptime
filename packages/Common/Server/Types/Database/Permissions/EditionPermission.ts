import { IsBillingEnabled } from "../../../../Server/EnvironmentConfig";
import EnterpriseEdition from "../../../Enterprise/EnterpriseEdition";
import EnterpriseFeature, {
  ALL_ENTERPRISE_FEATURES,
} from "../../../Enterprise/EnterpriseFeature";
import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export default class EditionPermissions {
  /*
   * Gates the enterprise CONFIGURATION models, the ones marked with
   * @TableEditionAccessControl({ requiresEnterprise: true }): project, global
   * and status page SSO/OIDC providers, SCIM configurations and team
   * compliance settings.
   *
   * Only creating and updating them needs the license. Reading and deleting
   * are always allowed, so an install that dropped to the Community Edition,
   * or whose license lapsed, can still see what it has configured and remove
   * it. What already exists keeps working either way: SSO, SCIM and audit
   * logging are governed by whether the Enterprise Edition is loaded, never by
   * the license (see EnterpriseEdition).
   *
   * Master admins are subject to this check - Create/UpdatePermission call it
   * before their master-admin early return - because the global SSO/OIDC
   * models are only ever written by master admins and would otherwise never
   * be gated. Internal root writes (props.isRoot) are never checked.
   *
   * On the cloud / billing-enabled deployment enforcement is left to
   * BillingPermission: it already gates these models by the plan tier in
   * their @TableBillingAccessControl, so a second check would be redundant.
   *
   * Deliberately synchronous. TablePermission and CreatePermission are
   * synchronous and their callers do not await them, so an async check with a
   * missed await would turn the refusal into an unhandled rejection and let
   * the write through. The license is read from the enterprise module's
   * cached snapshot, and an unknown snapshot refuses the write (fail closed).
   */
  @CaptureSpan()
  public static checkEditionPermissions(
    modelType: DatabaseBaseModelType,
    props: DatabaseCommonInteractionProps,
    operation: DatabaseRequestType,
  ): void {
    if (IsBillingEnabled) {
      return;
    }

    if (props.isRoot) {
      return;
    }

    if (
      operation !== DatabaseRequestType.Create &&
      operation !== DatabaseRequestType.Update
    ) {
      return;
    }

    const model: BaseModel = new modelType();

    if (!model.requiresEnterprise) {
      return;
    }

    const feature: EnterpriseFeature | null =
      EnterpriseEdition.getModelFeature(modelType);

    if (feature) {
      EnterpriseEdition.assertFeatureAvailableSync(feature);
      return;
    }

    /*
     * An enterprise model the facade has no feature for (its guard test
     * should make this impossible). Fail closed: only a license entitled to
     * every enterprise feature may configure it.
     */
    for (const enterpriseFeature of ALL_ENTERPRISE_FEATURES) {
      EnterpriseEdition.assertFeatureAvailableSync(enterpriseFeature);
    }
  }
}
