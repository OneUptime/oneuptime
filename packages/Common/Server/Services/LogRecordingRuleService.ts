import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/LogRecordingRule";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import BadDataException from "../../Types/Exception/BadDataException";
import LogRecordingRuleDefinition, {
  LogRecordingRuleDefinitionUtil,
} from "../../Types/Log/LogRecordingRuleDefinition";
import MetricRecordingRuleServiceInstance, {
  Service as MetricRecordingRuleService,
} from "./MetricRecordingRuleService";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * The definition a create or an update stores. One the editor would refuse
   * is refused here too, in the editor's words (the API, MCP and Terraform
   * reach this without the editor), and an accepted one is stored
   * normalized - text trimmed, empty rows and repeats dropped - so the
   * worker evaluates exactly what the rule list shows.
   */
  public static getDefinitionToStore(raw: unknown): LogRecordingRuleDefinition {
    const error: string | null =
      LogRecordingRuleDefinitionUtil.getValidationError(raw);

    if (error) {
      throw new BadDataException(error);
    }

    return LogRecordingRuleDefinitionUtil.normalize(
      LogRecordingRuleDefinitionUtil.fromJSON(raw)!,
    );
  }

  /*
   * A log recording rule writes a metric too, straight into the metric
   * store, so it is held to the metric and trace recording rules' rules for
   * its output metric name (MetricRecordingRuleService): made from the
   * rule's name when the create leaves it out - kept clear of every
   * recording rule of the project, of all three kinds - never a reserved
   * session replay name, and never emptied by an update.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    createBy.data.definition = Service.getDefinitionToStore(
      createBy.data.definition,
    );

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

    const data: Record<string, unknown> = updateBy.data as unknown as Record<
      string,
      unknown
    >;

    // Only an update that sets the name can make it reserved.
    MetricRecordingRuleService.assertOutputMetricNameAllowed(
      data["outputMetricName"],
    );

    /*
     * Undefined is a column the update leaves alone (a model instance
     * carries every column that way); anything else - null included - is a
     * new definition, and must be a valid one.
     */
    if (data["definition"] !== undefined) {
      data["definition"] = Service.getDefinitionToStore(data["definition"]);
    }

    return { updateBy, carryForward: null };
  }
}

export default new Service();
