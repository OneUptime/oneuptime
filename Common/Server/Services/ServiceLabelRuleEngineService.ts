import Label from "../../Models/DatabaseModels/Label";
import Service from "../../Models/DatabaseModels/Service";
import ServiceLabelRule from "../../Models/DatabaseModels/ServiceLabelRule";
import ServiceLabelRuleService from "./ServiceLabelRuleService";
import ServiceService from "./ServiceService";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class ServiceLabelRuleEngineServiceClass {
  /**
   * Evaluates ServiceLabelRule rows for the given service and attaches matched
   * labels to it. The union is deduped against labels already on the service
   * before insert to avoid PK conflicts on the join table.
   */
  @CaptureSpan()
  public async applyRulesToService(service: Service): Promise<void> {
    if (!service.id || !service.projectId) {
      return;
    }

    try {
      const rules: Array<ServiceLabelRule> =
        await ServiceLabelRuleService.findBy({
          query: {
            projectId: service.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: {
            _id: true,
            name: true,
            serviceLabels: { _id: true },
            serviceNamePattern: true,
            serviceDescriptionPattern: true,
            labelsToAdd: { _id: true },
          },
          limit: 100,
          skip: 0,
        });

      if (rules.length === 0) {
        return;
      }

      const serviceWithDetails: Service | null =
        await ServiceService.findOneById({
          id: service.id,
          select: {
            name: true,
            description: true,
            labels: { _id: true },
          },
          props: { isRoot: true },
        });

      if (!serviceWithDetails) {
        return;
      }

      const labelIdsToAdd: Set<string> = new Set();

      for (const rule of rules) {
        const matches: boolean = this.doesServiceMatchRule(
          serviceWithDetails,
          rule,
        );
        if (!matches) {
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
        (serviceWithDetails.labels || [])
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

      await ServiceService.getRepository()
        .createQueryBuilder()
        .relation(Service, "labels")
        .of(service.id.toString())
        .add(newLabelIds);

      /*
       * Sync in-memory service.labels so a downstream owner-rule engine in
       * the same onCreateSuccess chain can match on rule-added labels.
       */
      const mergedLabelIds: Set<string> = new Set([
        ...existingLabelIds,
        ...newLabelIds,
      ]);
      service.labels = Array.from(mergedLabelIds).map((id: string) => {
        const label: Label = new Label();
        label.id = new ObjectID(id);
        return label;
      });

      logger.debug(
        `ServiceLabelRuleEngine attached ${newLabelIds.length} labels to service ${service.id}`,
        { projectId: service.projectId.toString() } as LogAttributes,
      );
    } catch (error) {
      logger.error(`Error applying service label rules: ${error}`, {
        projectId: service.projectId?.toString(),
        serviceId: service.id?.toString(),
      } as LogAttributes);
    }
  }

  private doesServiceMatchRule(
    service: Service,
    rule: ServiceLabelRule,
  ): boolean {
    if (rule.serviceLabels && rule.serviceLabels.length > 0) {
      if (!service.labels || service.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.serviceLabels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      const labelIds: Array<string> = service.labels.map((l: Label) => {
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
      rule.serviceNamePattern &&
      (!service.name ||
        !this.testRegex(rule.serviceNamePattern, service.name, rule))
    ) {
      return false;
    }

    if (
      rule.serviceDescriptionPattern &&
      (!service.description ||
        !this.testRegex(
          rule.serviceDescriptionPattern,
          service.description,
          rule,
        ))
    ) {
      return false;
    }

    return true;
  }

  private testRegex(
    pattern: string,
    value: string,
    rule: ServiceLabelRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(`Invalid regex in service label rule ${rule.id}: ${pattern}`);
      return false;
    }
  }
}

export default new ServiceLabelRuleEngineServiceClass();
