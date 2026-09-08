import BadDataException from "../../Types/Exception/BadDataException";
import MonitorStep from "../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../Types/Monitor/MonitorSteps";
import MonitorTemplateTargetPolicy, {
  MonitorTemplateTargetField,
} from "../../Types/Monitor/MonitorTemplateTargetPolicy";
import MonitorType from "../../Types/Monitor/MonitorType";

export interface BuildSyncedMonitorStepsData {
  templateMonitorSteps: MonitorSteps | undefined;
  currentMonitorSteps: MonitorSteps | undefined;
  monitorType: MonitorType;
}

export default class MonitorTemplateDestinationUtil {
  public static supportsMonitorType(type: MonitorType | undefined): boolean {
    return MonitorTemplateTargetPolicy.supportsMonitorType(type);
  }

  /**
   * Apply shared template settings, preserving only target fields the template
   * leaves blank. Step IDs keep bindings through reordering. A recreated or
   * added step may reuse current values only when those omitted values agree
   * across all current steps; position must never silently choose a target.
   */
  public static buildSyncedMonitorSteps(
    data: BuildSyncedMonitorStepsData,
  ): MonitorSteps {
    if (!this.supportsMonitorType(data.monitorType)) {
      throw new BadDataException(
        "This monitor type does not support optional template targets.",
      );
    }

    const templateSteps: MonitorSteps = this.validateAndCloneMonitorSteps(
      data.templateMonitorSteps,
      "Monitor template",
    );
    const sourceSteps: MonitorSteps = MonitorSteps.fromJSON(
      data.templateMonitorSteps,
    );
    const fields: ReadonlyArray<MonitorTemplateTargetField> =
      MonitorTemplateTargetPolicy.getTargetFields(data.monitorType);
    let currentSteps: MonitorSteps | undefined;

    for (
      let index: number = 0;
      index < templateSteps.data!.monitorStepsInstanceArray.length;
      index++
    ) {
      const step: MonitorStep =
        templateSteps.data!.monitorStepsInstanceArray[index]!;
      const sourceStep: MonitorStep =
        sourceSteps.data!.monitorStepsInstanceArray[index]!;
      const omittedFields: ReadonlyArray<MonitorTemplateTargetField> =
        fields.filter((field: MonitorTemplateTargetField): boolean => {
          return MonitorTemplateTargetPolicy.isBlankTargetValue(
            MonitorTemplateTargetPolicy.getValue(sourceStep.data, field.path),
          );
        });

      if (omittedFields.length === 0) {
        continue;
      }

      /*
       * A criteria-only template can omit the entire type-specific block.
       * Retain that complete block, including the settings needed to run the
       * monitor (for example infrastructure metric queries and rolling time).
       */
      const omittedConfigs: Array<string> = Array.from(
        new Set(
          fields
            .filter((field: MonitorTemplateTargetField): boolean => {
              return (
                field.path.length > 1 &&
                MonitorTemplateTargetPolicy.isBlankTargetValue(
                  MonitorTemplateTargetPolicy.getValue(sourceStep.data, [
                    field.path[0]!,
                  ]),
                )
              );
            })
            .map((field: MonitorTemplateTargetField): string => {
              return field.path[0]!;
            }),
        ),
      );

      if (
        !data.currentMonitorSteps &&
        omittedFields.every((field: MonitorTemplateTargetField): boolean => {
          return !field.requiredOnMonitor;
        })
      ) {
        continue;
      }

      currentSteps =
        currentSteps ||
        this.validateAndCloneMonitorSteps(
          data.currentMonitorSteps,
          "Linked monitor",
        );
      const matchingStep: MonitorStep | undefined =
        currentSteps.data!.monitorStepsInstanceArray.find(
          (currentStep: MonitorStep): boolean => {
            return currentStep.data!.id === step.data!.id;
          },
        );
      const candidatesByBinding: Map<string, MonitorStep> = new Map();

      if (!matchingStep) {
        for (const currentStep of currentSteps.data!
          .monitorStepsInstanceArray) {
          const key: string = JSON.stringify([
            ...omittedConfigs.map((config: string): unknown => {
              return MonitorTemplateTargetPolicy.getValue(currentStep.data, [
                config,
              ]);
            }),
            ...omittedFields.map(
              (field: MonitorTemplateTargetField): unknown => {
                const value: unknown = MonitorTemplateTargetPolicy.getValue(
                  currentStep.data,
                  field.path,
                );
                return MonitorTemplateTargetPolicy.isBlankTargetValue(value)
                  ? null
                  : value;
              },
            ),
          ]);
          candidatesByBinding.set(key, currentStep);
        }
      }

      const currentStep: MonitorStep | undefined =
        matchingStep ||
        (candidatesByBinding.size === 1
          ? Array.from(candidatesByBinding.values())[0]
          : undefined);

      if (!currentStep) {
        throw new BadDataException(
          "Cannot preserve targets for an added or recreated template step because the linked monitor has multiple destinations or target configurations. Supply the target in the template or keep the existing step IDs.",
        );
      }

      const preservedStep: MonitorStep = MonitorStep.fromJSON(
        JSON.parse(JSON.stringify(currentStep.toJSON())),
      );

      for (const config of omittedConfigs) {
        this.setValue(
          step.data,
          [config],
          MonitorTemplateTargetPolicy.getValue(preservedStep.data, [config]),
        );
      }

      for (const field of omittedFields) {
        const value: unknown = MonitorTemplateTargetPolicy.getValue(
          preservedStep.data,
          field.path,
        );
        if (
          field.requiredOnMonitor &&
          MonitorTemplateTargetPolicy.isBlankTargetValue(value)
        ) {
          throw new BadDataException(
            `Linked monitor contains a step without a ${field.label.toLowerCase()} to preserve. Supply it on the monitor or in the template before syncing.`,
          );
        }
        this.setValue(step.data, field.path, value);
      }
    }

    return templateSteps;
  }

  private static setValue(
    data: unknown,
    path: ReadonlyArray<string>,
    value: unknown,
  ): void {
    let current: Record<string, unknown> = data as Record<string, unknown>;
    for (const key of path.slice(0, -1)) {
      if (!current[key] || typeof current[key] !== "object") {
        if (value === undefined) {
          return;
        }
        current[key] = {};
      }
      current = current[key] as Record<string, unknown>;
    }
    current[path[path.length - 1]!] = value;
  }

  private static validateAndCloneMonitorSteps(
    monitorSteps: MonitorSteps | undefined,
    subject: string,
  ): MonitorSteps {
    if (!monitorSteps) {
      throw new BadDataException(`${subject} monitor steps are required.`);
    }

    let normalizedSteps: MonitorSteps;

    try {
      normalizedSteps = MonitorSteps.fromJSON(monitorSteps);
    } catch {
      throw new BadDataException(`${subject} monitor steps are invalid.`);
    }

    if (
      !Array.isArray(normalizedSteps.data?.monitorStepsInstanceArray) ||
      normalizedSteps.data.monitorStepsInstanceArray.length === 0
    ) {
      throw new BadDataException(`${subject} monitor steps are required.`);
    }

    const stepIds: Set<string> = new Set();

    for (const step of normalizedSteps.data.monitorStepsInstanceArray) {
      if (
        !(step instanceof MonitorStep) ||
        !step.data ||
        typeof step.data.id !== "string" ||
        !step.data.id.trim() ||
        stepIds.has(step.data.id)
      ) {
        throw new BadDataException(
          `${subject} must contain valid steps with unique step IDs.`,
        );
      }

      stepIds.add(step.data.id);
    }

    try {
      /*
       * MonitorStep.toJSON retains some nested configuration references. A JSON
       * round trip is needed so neither the source nor another result can be
       * mutated through the returned monitor's nested settings.
       */
      return MonitorSteps.fromJSON(
        JSON.parse(JSON.stringify(normalizedSteps.toJSON())),
      );
    } catch {
      throw new BadDataException(`${subject} monitor steps are invalid.`);
    }
  }
}
