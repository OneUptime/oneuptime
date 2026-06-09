import Label from "../../Models/DatabaseModels/Label";
import CloudResource from "../../Models/DatabaseModels/CloudResource";
import CloudResourceLabelRule from "../../Models/DatabaseModels/CloudResourceLabelRule";
import CloudResourceLabelRuleService from "./CloudResourceLabelRuleService";
import CloudResourceService from "./CloudResourceService";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class CloudResourceLabelRuleEngineServiceClass {
  /**
   * Evaluates CloudResourceLabelRule rows for the given resource and attaches
   * matched labels. The union is deduped against labels already on the
   * resource before insert to avoid PK conflicts on the join table.
   */
  @CaptureSpan()
  public async applyRulesToCloudResource(
    cloudResource: CloudResource,
  ): Promise<void> {
    if (!cloudResource.id || !cloudResource.projectId) {
      return;
    }

    try {
      const rules: Array<CloudResourceLabelRule> =
        await CloudResourceLabelRuleService.findBy({
          query: {
            projectId: cloudResource.projectId,
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

      const resourceWithDetails: CloudResource | null =
        await CloudResourceService.findOneById({
          id: cloudResource.id,
          select: {
            name: true,
            description: true,
            labels: { _id: true },
          },
          props: { isRoot: true },
        });

      if (!resourceWithDetails) {
        return;
      }

      const labelIdsToAdd: Set<string> = new Set();

      for (const rule of rules) {
        if (!this.doesMatchRule(resourceWithDetails, rule)) {
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
        (resourceWithDetails.labels || [])
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

      await CloudResourceService.getRepository()
        .createQueryBuilder()
        .relation(CloudResource, "labels")
        .of(cloudResource.id.toString())
        .add(newLabelIds);

      const mergedLabelIds: Set<string> = new Set([
        ...existingLabelIds,
        ...newLabelIds,
      ]);
      cloudResource.labels = Array.from(mergedLabelIds).map((id: string) => {
        const label: Label = new Label();
        label.id = new ObjectID(id);
        return label;
      });
    } catch (error) {
      logger.error(`Error applying cloud resource label rules: ${error}`, {
        projectId: cloudResource.projectId?.toString(),
        cloudResourceId: cloudResource.id?.toString(),
      } as LogAttributes);
    }
  }

  private doesMatchRule(
    cloudResource: CloudResource,
    rule: CloudResourceLabelRule,
  ): boolean {
    if (rule.matchLabels && rule.matchLabels.length > 0) {
      if (!cloudResource.labels || cloudResource.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.matchLabels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      const labelIds: Array<string> = cloudResource.labels.map((l: Label) => {
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
      (!cloudResource.name ||
        !this.testRegex(rule.nameRegexPattern, cloudResource.name))
    ) {
      return false;
    }

    if (
      rule.descriptionRegexPattern &&
      (!cloudResource.description ||
        !this.testRegex(rule.descriptionRegexPattern, cloudResource.description))
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
      logger.warn(`Invalid regex in cloud resource label rule: ${pattern}`);
      return false;
    }
  }
}

export default new CloudResourceLabelRuleEngineServiceClass();
