import DatabaseService from "./DatabaseService";
import RunnerService from "./RunnerService";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import RunbookSecret from "../../Models/DatabaseModels/RunbookSecret";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<RunbookSecret> {
  public constructor() {
    super(RunbookSecret);
  }

  /*
   * A secret assigned to a Runner is substituted into the runbook scripts
   * that Runner claims, so assigning one to a kubernetes-agent Runner — an
   * identity the project's telemetry ingestion key can mint — would hand it
   * to whoever holds that key. Refused on create and on every write of the
   * Runner list (see RunnerService.assertNoKubernetesAgentRunners).
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<RunbookSecret>,
  ): Promise<OnCreate<RunbookSecret>> {
    await RunnerService.assertNoKubernetesAgentRunners({
      runners: createBy.data.runners,
      assignedWhat: "secret",
    });

    return { createBy, carryForward: [] };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<RunbookSecret>,
  ): Promise<OnUpdate<RunbookSecret>> {
    await RunnerService.assertNoKubernetesAgentRunners({
      runners: updateBy.data.runners,
      assignedWhat: "secret",
    });

    return { updateBy, carryForward: null };
  }
}

export default new Service();
