import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/DetectionRule";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import BadDataException from "../../Types/Exception/BadDataException";
import {
  DETECTION_MATCH_COUNT_THRESHOLD_MAX,
  DETECTION_MATCH_COUNT_THRESHOLD_MIN,
} from "../../Types/SecurityEvent/DetectionFindingConstants";
import SigmaRuleParser from "../../Utils/SecurityEvent/Sigma/SigmaRuleParser";
import SigmaClickhouseCompiler from "../Utils/SecurityEvent/Sigma/SigmaClickhouseCompiler";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Parse AND compile at save time, so a rule that stores is a rule the
   * engine can evaluate — a YAML typo surfaces to the person editing it,
   * not as a cron-side lastError hours later.
   */
  private validateSigmaRule(ruleYaml: string | undefined): void {
    if (!ruleYaml || !ruleYaml.trim()) {
      throw new BadDataException("Sigma rule YAML is required.");
    }

    SigmaClickhouseCompiler.compileYaml(ruleYaml);
  }

  // undefined always passes: an omitted field means "keep the default".
  private validateIntegerInRange(data: {
    value: number | undefined;
    min: number;
    max: number;
    message: string;
  }): void {
    if (data.value === undefined) {
      return;
    }

    if (
      !Number.isInteger(data.value) ||
      data.value < data.min ||
      data.value > data.max
    ) {
      throw new BadDataException(data.message);
    }
  }

  private validateEvaluationInterval(interval: number | undefined): void {
    this.validateIntegerInRange({
      value: interval,
      min: 1,
      max: 1440,
      message:
        "Evaluation interval must be a whole number of minutes between 1 and 1440.",
    });
  }

  private validateMatchCountThreshold(threshold: number | undefined): void {
    this.validateIntegerInRange({
      value: threshold,
      min: DETECTION_MATCH_COUNT_THRESHOLD_MIN,
      max: DETECTION_MATCH_COUNT_THRESHOLD_MAX,
      message: `Match count threshold must be a whole number between ${DETECTION_MATCH_COUNT_THRESHOLD_MIN} and ${DETECTION_MATCH_COUNT_THRESHOLD_MAX}.`,
    });
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    this.validateSigmaRule(createBy.data.sigmaRuleYaml);
    this.validateEvaluationInterval(createBy.data.evaluationIntervalInMinutes);
    this.validateMatchCountThreshold(createBy.data.matchCountThreshold);

    /*
     * groupByField / distinctCountField are looked up verbatim: an
     * unknown name silently becomes an attributes[] lookup that yields
     * '' on every row, and for a distinct-count rule that means it never
     * fires again with no error anywhere. Trimming here kills the whole
     * whitespace-from-a-paste class of that outage; '' is preserved as
     * the documented "feature off" value so clearing the field still
     * works.
     */
    if (createBy.data.groupByField !== undefined) {
      createBy.data.groupByField = createBy.data.groupByField.trim();
    }

    if (createBy.data.distinctCountField !== undefined) {
      createBy.data.distinctCountField =
        createBy.data.distinctCountField.trim();
    }

    /*
     * Default the rule name from the Sigma title so pasting a rule is a
     * one-field operation.
     */
    if (!createBy.data.name && createBy.data.sigmaRuleYaml) {
      createBy.data.name = SigmaRuleParser.parse(
        createBy.data.sigmaRuleYaml,
      ).title;
    }

    return { createBy, carryForward: null };
  }

  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    if (updateBy.data.sigmaRuleYaml !== undefined) {
      this.validateSigmaRule(updateBy.data.sigmaRuleYaml as string);
    }

    this.validateEvaluationInterval(
      updateBy.data.evaluationIntervalInMinutes as number | undefined,
    );

    this.validateMatchCountThreshold(
      updateBy.data.matchCountThreshold as number | undefined,
    );

    // Same trim as onBeforeCreate — see the rationale there.
    if (updateBy.data.groupByField !== undefined) {
      updateBy.data.groupByField = (
        updateBy.data.groupByField as string
      ).trim();
    }

    if (updateBy.data.distinctCountField !== undefined) {
      updateBy.data.distinctCountField = (
        updateBy.data.distinctCountField as string
      ).trim();
    }

    return { updateBy, carryForward: null };
  }
}

export default new Service();
