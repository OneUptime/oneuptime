import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/MetricRecordingRule";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import BadDataException from "../../Types/Exception/BadDataException";
import SessionReplayBudgetMetricTypeUtil, {
  SESSION_REPLAY_METRIC_NAME_PREFIX,
} from "../../Utils/SessionReplay/SessionReplayBudgetMetricType";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * A recording rule writes its output straight into the metric store, past
   * OTLP ingest, so the reserved session replay names have to be refused
   * here too: those series open budget incidents and are left out of
   * telemetry billing by name, so nothing but the budget sweep may write
   * them (see SessionReplayBudgetMetricTypeUtil.isReservedMetricName).
   */
  public static assertOutputMetricNameAllowed(name: unknown): void {
    if (
      typeof name === "string" &&
      SessionReplayBudgetMetricTypeUtil.isReservedMetricName(name.trim())
    ) {
      throw new BadDataException(
        `Metric names that start with "${SESSION_REPLAY_METRIC_NAME_PREFIX}" are reserved for OneUptime's session replay budget metrics. Choose another output metric name.`,
      );
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    Service.assertOutputMetricNameAllowed(createBy.data.outputMetricName);

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    // Only an update that sets the name can make it reserved.
    Service.assertOutputMetricNameAllowed(
      (updateBy.data as unknown as Record<string, unknown>)["outputMetricName"],
    );

    return { updateBy, carryForward: null };
  }
}

export default new Service();
