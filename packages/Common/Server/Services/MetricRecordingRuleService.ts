import DatabaseService from "./DatabaseService";
import TraceRecordingRuleService from "./TraceRecordingRuleService";
import Model from "../../Models/DatabaseModels/MetricRecordingRule";
import TraceRecordingRule from "../../Models/DatabaseModels/TraceRecordingRule";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import BadDataException from "../../Types/Exception/BadDataException";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import { generateOutputMetricName } from "../../Types/Metrics/RecordingRuleOutputMetricName";
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

  /*
   * A rule always writes somewhere: an update may rename the output metric
   * but not empty it, or the rule would stop computing anything with
   * nothing saying why.
   */
  public static assertOutputMetricNameNotCleared(data: unknown): void {
    if (!data || typeof data !== "object") {
      return;
    }

    /*
     * Undefined is a column the update leaves alone - a model instance
     * carries every column that way.
     */
    const name: unknown = (data as Record<string, unknown>)["outputMetricName"];

    if (name === undefined) {
      return;
    }

    if (name === null || (typeof name === "string" && !name.trim())) {
      throw new BadDataException(
        "A recording rule needs an output metric name. Enter the name of the metric it writes.",
      );
    }
  }

  /*
   * The output metric name a new rule - of either kind - is created with.
   * One that was sent is kept as sent. Left out, it is made from the rule's
   * name ("HTTP 5xx error rate" -> http_5xx_error_rate), with _2, _3 and so
   * on added when a metric or trace recording rule of the project already
   * writes it: two rules writing one series would mix their data.
   */
  @CaptureSpan()
  public async getOutputMetricNameForCreate(data: {
    outputMetricName: string | undefined | null;
    ruleName: string | undefined | null;
    projectId: ObjectID | undefined;
  }): Promise<string> {
    if (
      typeof data.outputMetricName === "string" &&
      data.outputMetricName.trim().length > 0
    ) {
      return data.outputMetricName;
    }

    return generateOutputMetricName({
      ruleName: typeof data.ruleName === "string" ? data.ruleName : "",
      existingNames: await this.getOutputMetricNamesInProject(data.projectId),
    });
  }

  /*
   * Every output metric name the project's metric and trace recording rules
   * write. Read as root: a made name must not clash with a rule the creator
   * is not allowed to see.
   */
  @CaptureSpan()
  public async getOutputMetricNamesInProject(
    projectId: ObjectID | undefined,
  ): Promise<Array<string>> {
    if (!projectId) {
      return [];
    }

    const [metricRules, traceRules]: [Array<Model>, Array<TraceRecordingRule>] =
      await Promise.all([
        this.findBy({
          query: { projectId: projectId },
          select: { outputMetricName: true },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: { isRoot: true },
        }),
        TraceRecordingRuleService.findBy({
          query: { projectId: projectId },
          select: { outputMetricName: true },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: { isRoot: true },
        }),
      ]);

    return [...metricRules, ...traceRules]
      .map((rule: Model | TraceRecordingRule) => {
        return rule.outputMetricName;
      })
      .filter((name: string | undefined) => {
        return Boolean(name);
      }) as Array<string>;
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    createBy.data.outputMetricName = await this.getOutputMetricNameForCreate({
      outputMetricName: createBy.data.outputMetricName,
      ruleName: createBy.data.name,
      projectId: createBy.data.projectId || createBy.props.tenantId,
    });

    Service.assertOutputMetricNameAllowed(createBy.data.outputMetricName);

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    Service.assertOutputMetricNameNotCleared(updateBy.data);

    // Only an update that sets the name can make it reserved.
    Service.assertOutputMetricNameAllowed(
      (updateBy.data as unknown as Record<string, unknown>)["outputMetricName"],
    );

    return { updateBy, carryForward: null };
  }
}

export default new Service();
