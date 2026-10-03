import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/TraceRecordingRule";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import MetricRecordingRuleServiceInstance, {
  Service as MetricRecordingRuleService,
} from "./MetricRecordingRuleService";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * A trace recording rule writes a metric too, and straight into the metric
   * store: it may not claim a reserved session replay name any more than a
   * metric recording rule may (MetricRecordingRuleService). Its output
   * metric name is made from its name when the create leaves it out, kept
   * clear of every metric and trace recording rule of the project.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    createBy.data.outputMetricName =
      await MetricRecordingRuleServiceInstance.getOutputMetricNameForCreate({
        outputMetricName: createBy.data.outputMetricName,
        ruleName: createBy.data.name,
        projectId: createBy.data.projectId || createBy.props.tenantId,
      });

    MetricRecordingRuleService.assertOutputMetricNameAllowed(
      createBy.data.outputMetricName,
    );

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    MetricRecordingRuleService.assertOutputMetricNameNotCleared(updateBy.data);

    // Only an update that sets the name can make it reserved.
    MetricRecordingRuleService.assertOutputMetricNameAllowed(
      (updateBy.data as unknown as Record<string, unknown>)["outputMetricName"],
    );

    return { updateBy, carryForward: null };
  }
}

export default new Service();
