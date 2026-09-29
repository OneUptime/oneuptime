import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/TraceRecordingRule";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { Service as MetricRecordingRuleService } from "./MetricRecordingRuleService";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * A trace recording rule writes a metric too, and straight into the metric
   * store: it may not claim a reserved session replay name any more than a
   * metric recording rule may (MetricRecordingRuleService).
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    MetricRecordingRuleService.assertOutputMetricNameAllowed(
      createBy.data.outputMetricName,
    );

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    // Only an update that sets the name can make it reserved.
    MetricRecordingRuleService.assertOutputMetricNameAllowed(
      (updateBy.data as unknown as Record<string, unknown>)["outputMetricName"],
    );

    return { updateBy, carryForward: null };
  }
}

export default new Service();
