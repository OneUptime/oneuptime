import Label from "../../Models/DatabaseModels/Label";
import RumApplication from "../../Models/DatabaseModels/RumApplication";
import RumApplicationLabelRule from "../../Models/DatabaseModels/RumApplicationLabelRule";
import RumApplicationLabelRuleService from "./RumApplicationLabelRuleService";
import RumApplicationService from "./RumApplicationService";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class RumApplicationLabelRuleEngineServiceClass {
  /**
   * Evaluates RumApplicationLabelRule rows for the given application and
   * attaches matched labels. The union is deduped against labels already on
   * the application before insert to avoid PK conflicts on the join table.
   */
  @CaptureSpan()
  public async applyRulesToRumApplication(
    rumApplication: RumApplication,
  ): Promise<void> {
    if (!rumApplication.id || !rumApplication.projectId) {
      return;
    }

    try {
      const rules: Array<RumApplicationLabelRule> =
        await RumApplicationLabelRuleService.findBy({
          query: {
            projectId: rumApplication.projectId,
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

      const appWithDetails: RumApplication | null =
        await RumApplicationService.findOneById({
          id: rumApplication.id,
          select: {
            name: true,
            description: true,
            labels: { _id: true },
          },
          props: { isRoot: true },
        });

      if (!appWithDetails) {
        return;
      }

      const labelIdsToAdd: Set<string> = new Set();

      for (const rule of rules) {
        if (!this.doesMatchRule(appWithDetails, rule)) {
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
        (appWithDetails.labels || [])
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

      await RumApplicationService.getRepository()
        .createQueryBuilder()
        .relation(RumApplication, "labels")
        .of(rumApplication.id.toString())
        .add(newLabelIds);

      const mergedLabelIds: Set<string> = new Set([
        ...existingLabelIds,
        ...newLabelIds,
      ]);
      rumApplication.labels = Array.from(mergedLabelIds).map((id: string) => {
        const label: Label = new Label();
        label.id = new ObjectID(id);
        return label;
      });
    } catch (error) {
      logger.error(`Error applying RUM application label rules: ${error}`, {
        projectId: rumApplication.projectId?.toString(),
        rumApplicationId: rumApplication.id?.toString(),
      } as LogAttributes);
    }
  }

  private doesMatchRule(
    rumApplication: RumApplication,
    rule: RumApplicationLabelRule,
  ): boolean {
    if (rule.matchLabels && rule.matchLabels.length > 0) {
      if (!rumApplication.labels || rumApplication.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.matchLabels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      const labelIds: Array<string> = rumApplication.labels.map((l: Label) => {
        return l.id?.toString() || "";
      });
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
      (!rumApplication.name ||
        !this.testRegex(rule.nameRegexPattern, rumApplication.name))
    ) {
      return false;
    }

    if (
      rule.descriptionRegexPattern &&
      (!rumApplication.description ||
        !this.testRegex(rule.descriptionRegexPattern, rumApplication.description))
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
      logger.warn(`Invalid regex in RUM application label rule: ${pattern}`);
      return false;
    }
  }
}

export default new RumApplicationLabelRuleEngineServiceClass();
