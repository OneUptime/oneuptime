import Label from "../../Models/DatabaseModels/Label";
import ServerlessFunction from "../../Models/DatabaseModels/ServerlessFunction";
import ServerlessFunctionLabelRule from "../../Models/DatabaseModels/ServerlessFunctionLabelRule";
import ServerlessFunctionLabelRuleService from "./ServerlessFunctionLabelRuleService";
import ServerlessFunctionService from "./ServerlessFunctionService";
import ObjectID from "../../Types/ObjectID";
import Select from "../Types/Database/Select";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../Utils/Rules/RuleEngineLimits";
import { RuleCriteriaMatcher } from "../../Utils/Rules/RuleCriteriaMatcher";
import logIfRuleReadWasTruncated from "../Utils/Rules/RuleEngineRuleRead";
import {
  ApplyRulesToExistingResourceData,
  RuleApplicationResult,
  RuleApplicationResultUtil,
  RuleRunEngine,
} from "../Utils/Rules/RuleRun/RuleApplication";

class ServerlessFunctionLabelRuleEngineServiceClass
  implements RuleRunEngine<ServerlessFunction, ServerlessFunctionLabelRule>
{
  public readonly ruleSelect: Select<ServerlessFunctionLabelRule> = {
    _id: true,
    name: true,
    criteria: true,
    matchLabels: { _id: true },
    nameRegexPattern: true,
    descriptionRegexPattern: true,
    labelsToAdd: { _id: true },
  };

  // Evaluation re-reads the function, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<ServerlessFunction> = {
    _id: true,
    projectId: true,
  };

  /**
   * Evaluates ServerlessFunctionLabelRule rows for the given function and
   * attaches matched labels. The union is deduped against labels already on
   * the function before insert to avoid PK conflicts on the join table.
   */
  @CaptureSpan()
  public async applyRulesToServerlessFunction(
    serverlessFunction: ServerlessFunction,
  ): Promise<void> {
    if (!serverlessFunction.id || !serverlessFunction.projectId) {
      return;
    }

    try {
      const rules: Array<ServerlessFunctionLabelRule> =
        await ServerlessFunctionLabelRuleService.findBy({
          query: {
            projectId: serverlessFunction.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: this.ruleSelect,
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
        });

      logIfRuleReadWasTruncated({
        ruleKind: "ServerlessFunctionLabelRule",
        projectId: serverlessFunction.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({
        serverlessFunction: serverlessFunction,
        rules: rules,
      });
    } catch (error) {
      logger.error(`Error applying serverless function label rules: ${error}`, {
        projectId: serverlessFunction.projectId?.toString(),
        serverlessFunctionId: serverlessFunction.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for a function that already exists and
   * only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<
      ServerlessFunction,
      ServerlessFunctionLabelRule
    >,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        serverlessFunction: data.resource,
        rules: data.rules,
      });
    } catch (error) {
      logger.error(`Error running serverless function label rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        serverlessFunctionId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  private async applyRules(data: {
    serverlessFunction: ServerlessFunction;
    rules: Array<ServerlessFunctionLabelRule>;
  }): Promise<RuleApplicationResult> {
    const { serverlessFunction, rules } = data;

    if (
      !serverlessFunction.id ||
      !serverlessFunction.projectId ||
      rules.length === 0
    ) {
      return RuleApplicationResultUtil.noMatch();
    }

    const fnWithDetails: ServerlessFunction | null =
      await ServerlessFunctionService.findOneById({
        id: serverlessFunction.id,
        select: {
          name: true,
          description: true,
          labels: { _id: true },
        },
        props: { isRoot: true },
      });

    if (!fnWithDetails) {
      return RuleApplicationResultUtil.noMatch();
    }

    const labelIdsToAdd: Set<string> = new Set();
    let anyRuleMatched: boolean = false;

    for (const rule of rules) {
      if (!this.doesMatchRule(fnWithDetails, rule)) {
        continue;
      }
      anyRuleMatched = true;
      for (const label of rule.labelsToAdd || []) {
        if (label.id) {
          labelIdsToAdd.add(label.id.toString());
        }
      }
    }

    if (!anyRuleMatched) {
      return RuleApplicationResultUtil.noMatch();
    }

    if (labelIdsToAdd.size === 0) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    const existingLabelIds: Set<string> = new Set(
      (fnWithDetails.labels || [])
        .map((l: Label) => {
          return l.id?.toString() || "";
        })
        .filter((id: string) => {
          return id !== "";
        }),
    );

    const newLabelIds: Array<string> = Array.from(labelIdsToAdd).filter(
      (id: string) => {
        return !existingLabelIds.has(id);
      },
    );
    if (newLabelIds.length === 0) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    await ServerlessFunctionService.getRepository()
      .createQueryBuilder()
      .relation(ServerlessFunction, "labels")
      .of(serverlessFunction.id.toString())
      .add(newLabelIds);

    const mergedLabelIds: Set<string> = new Set([
      ...existingLabelIds,
      ...newLabelIds,
    ]);
    serverlessFunction.labels = Array.from(mergedLabelIds).map((id: string) => {
      const label: Label = new Label();
      label.id = new ObjectID(id);
      return label;
    });

    return RuleApplicationResultUtil.updated(newLabelIds.length);
  }

  private doesMatchRule(
    serverlessFunction: ServerlessFunction,
    rule: ServerlessFunctionLabelRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule: rule,
      legacyFields: [
        "matchLabels",
        "nameRegexPattern",
        "descriptionRegexPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: (
        serverlessFunctionRule: ServerlessFunctionLabelRule,
      ): boolean => {
        return this.doesMatchRuleLegacy(
          serverlessFunction,
          serverlessFunctionRule,
        );
      },
    });
  }

  private doesMatchRuleLegacy(
    serverlessFunction: ServerlessFunction,
    rule: ServerlessFunctionLabelRule,
  ): boolean {
    if (rule.matchLabels && rule.matchLabels.length > 0) {
      if (
        !serverlessFunction.labels ||
        serverlessFunction.labels.length === 0
      ) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.matchLabels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      const labelIds: Array<string> = serverlessFunction.labels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      if (
        !ruleLabelIds.some((id: string) => {
          return labelIds.includes(id);
        })
      ) {
        return false;
      }
    }

    if (
      rule.nameRegexPattern &&
      (!serverlessFunction.name ||
        !this.testRegex(rule.nameRegexPattern, serverlessFunction.name))
    ) {
      return false;
    }

    if (
      rule.descriptionRegexPattern &&
      (!serverlessFunction.description ||
        !this.testRegex(
          rule.descriptionRegexPattern,
          serverlessFunction.description,
        ))
    ) {
      return false;
    }

    return true;
  }

  private testRegex(pattern: string, value: string): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in serverless function label rule: ${pattern}`,
      );
      return false;
    }
  }
}

export default new ServerlessFunctionLabelRuleEngineServiceClass();
