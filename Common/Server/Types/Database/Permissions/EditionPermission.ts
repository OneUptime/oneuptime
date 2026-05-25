import {
  IsBillingEnabled,
  IsEnterpriseEdition,
} from "../../../../Server/EnvironmentConfig";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export default class EditionPermissions {
  /*
   * Gates models marked with @TableEditionAccessControl({ requiresEnterprise: true }).
   *
   * On self-hosted builds (billing disabled) the model is only accessible when
   * the binary was built as the Enterprise Edition (IS_ENTERPRISE_EDITION=true).
   *
   * On the cloud / billing-enabled deployment we leave enforcement to
   * BillingPermission — it already gates these models via the model's
   * @TableBillingAccessControl plan tier, so a second check would be redundant.
   */
  @CaptureSpan()
  public static checkEditionPermissions(
    modelType: DatabaseBaseModelType,
    _props: DatabaseCommonInteractionProps,
  ): void {
    if (IsBillingEnabled) {
      return;
    }

    const model: BaseModel = new modelType();

    if (!model.requiresEnterprise) {
      return;
    }

    if (!IsEnterpriseEdition) {
      throw new PaymentRequiredException(
        `${model.singularName || "This feature"} is only available on the OneUptime Enterprise Edition. ` +
          `Please switch to the Enterprise Edition build to enable this feature. ` +
          `See https://oneuptime.com/enterprise/overview for details.`,
      );
    }
  }
}
