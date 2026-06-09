import Label from "../../Models/DatabaseModels/Label";
import ServerlessFunction from "../../Models/DatabaseModels/ServerlessFunction";
import ServerlessFunctionLabelRule from "../../Models/DatabaseModels/ServerlessFunctionLabelRule";
import ServerlessFunctionLabelRuleService from "./ServerlessFunctionLabelRuleService";
import ServerlessFunctionService from "./ServerlessFunctionService";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class ServerlessFunctionLabelRuleEngineServiceClass {
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
          select: {
            _id: true,
            name: true,
            matchLabels: { _id: true },
            nameRegexPattern: true,
            descriptionRegexPattern: true,
            labelsToAdd: { _id: true },
          },
          limit: 100,
          skip: 0,
        });

      if (rules.length === 0) {
        return;
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
        return;
      }

      const labelIdsToAdd: Set<string> = new Set();

      for (const rule of rules) {
        if (!this.doesMatchRule(fnWithDetails, rule)) {
          continue;
        }
        for (const label of rule.labelsToAdd || []) {
          if (label.id) {
            labelIdsToAdd.add(label.id.toString());
          }
        }
      }

      if (labelIdsToAdd.size === 0) {
        return;
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
        return;
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
      serverlessFunction.labels = Array.from(mergedLabelIds).map(
        (id: string) => {
          const label: Label = new Label();
          label.id = new ObjectID(id);
          return label;
        },
      );
    } catch (error) {
      logger.error(`Error applying serverless function label rules: ${error}`, {
        projectId: serverlessFunction.projectId?.toString(),
        serverlessFunctionId: serverlessFunction.id?.toString(),
      } as LogAttributes);
    }
  }

  private doesMatchRule(
    serverlessFunction: ServerlessFunction,
    rule: ServerlessFunctionLabelRule,
  ): boolean {
    if (rule.matchLabels && rule.matchLabels.length > 0) {
      if (!serverlessFunction.labels || serverlessFunction.labels.length === 0) {
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
      logger.warn(`Invalid regex in serverless function label rule: ${pattern}`);
      return false;
    }
  }
}

export default new ServerlessFunctionLabelRuleEngineServiceClass();
