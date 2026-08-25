import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/DetectionRule";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import BadDataException from "../../Types/Exception/BadDataException";
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

  private validateEvaluationInterval(interval: number | undefined): void {
    if (interval === undefined) {
      return;
    }

    if (!Number.isInteger(interval) || interval < 1 || interval > 1440) {
      throw new BadDataException(
        "Evaluation interval must be a whole number of minutes between 1 and 1440.",
      );
    }
  }

  private validateMatchCountThreshold(threshold: number | undefined): void {
    if (threshold === undefined) {
      return;
    }

    if (!Number.isInteger(threshold) || threshold < 1 || threshold > 1000000) {
      throw new BadDataException(
        "Match count threshold must be a whole number between 1 and 1000000.",
      );
    }
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    this.validateSigmaRule(createBy.data.sigmaRuleYaml);
    this.validateEvaluationInterval(createBy.data.evaluationIntervalInMinutes);
    this.validateMatchCountThreshold(createBy.data.matchCountThreshold);

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

    return { updateBy, carryForward: null };
  }
}

export default new Service();
