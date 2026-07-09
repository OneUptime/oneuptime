import DatabaseService from "./DatabaseService";
import IncomingCallPolicy from "../../Models/DatabaseModels/IncomingCallPolicy";
import IncomingCallPolicyLabelRuleEngineService from "./IncomingCallPolicyLabelRuleEngineService";
import IncomingCallPolicyOwnerRuleEngineService from "./IncomingCallPolicyOwnerRuleEngineService";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import DeleteBy from "../Types/Database/DeleteBy";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import releaseIncomingCallPhoneNumber from "../Utils/IncomingCallPhoneNumber";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

export class Service extends DatabaseService<IncomingCallPolicy> {
  public constructor() {
    super(IncomingCallPolicy);
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<IncomingCallPolicy>,
  ): Promise<OnDelete<IncomingCallPolicy>> {
    /*
     * Release any provisioned numbers before the policy rows are removed so we
     * don't leave paid, orphaned numbers on the provider that can never be
     * released again (the policy — and its SID — would be gone).
     */
    const policies: Array<IncomingCallPolicy> = await this.findBy({
      query: deleteBy.query,
      select: {
        _id: true,
        callProviderPhoneNumberId: true,
        projectCallSMSConfigId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const policy of policies) {
      if (policy.callProviderPhoneNumberId && policy.projectCallSMSConfigId) {
        await releaseIncomingCallPhoneNumber({
          projectCallSMSConfigId: policy.projectCallSMSConfigId,
          callProviderPhoneNumberId: policy.callProviderPhoneNumberId,
        });
      }
    }

    return {
      deleteBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<IncomingCallPolicy>,
    createdItem: IncomingCallPolicy,
  ): Promise<IncomingCallPolicy> {
    if (createdItem.projectId && createdItem.id) {
      Promise.resolve()
        .then(async () => {
          await IncomingCallPolicyLabelRuleEngineService.applyRulesToIncomingCallPolicy(
            createdItem,
          );
        })
        .then(async () => {
          await IncomingCallPolicyOwnerRuleEngineService.applyRulesToIncomingCallPolicy(
            createdItem,
          );
        })
        .catch((error: Error) => {
          logger.error(
            `Error applying incoming call policy rules in IncomingCallPolicyService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              incomingCallPolicyId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        });
    }
    return createdItem;
  }
}

export default new Service();
