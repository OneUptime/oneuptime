import DatabaseService from "./DatabaseService";
import IncomingCallPolicy from "../../Models/DatabaseModels/IncomingCallPolicy";
import IncomingCallPolicyLabelRuleEngineService from "./IncomingCallPolicyLabelRuleEngineService";
import IncomingCallPolicyOwnerRuleEngineService from "./IncomingCallPolicyOwnerRuleEngineService";
import { OnCreate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

export class Service extends DatabaseService<IncomingCallPolicy> {
  public constructor() {
    super(IncomingCallPolicy);
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
