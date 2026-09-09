import BadDataException from "../../Types/Exception/BadDataException";
import MonitorStep from "../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../Types/Monitor/MonitorSteps";
import MonitorTemplateSyncFieldUtil from "../../Types/Monitor/MonitorTemplateSyncField";
import MonitorType from "../../Types/Monitor/MonitorType";

export default class MonitorTemplateSyncUtil {
  public static hasExcludedFields(steps: MonitorSteps | undefined): boolean {
    return Boolean(
      steps?.data?.monitorStepsInstanceArray.some(
        (step: MonitorStep): boolean => {
          return (
            (MonitorTemplateSyncFieldUtil.parse(step.data?.doNotSyncFields)
              ?.length || 0) > 0
          );
        },
      ),
    );
  }

  public static buildSyncedMonitorSteps(data: {
    templateMonitorSteps: MonitorSteps | undefined;
    currentMonitorSteps: MonitorSteps | undefined;
    monitorType: MonitorType;
  }): MonitorSteps {
    if (!data.templateMonitorSteps?.data) {
      throw new BadDataException(
        "Monitor template steps are required to sync criteria.",
      );
    }

    const result: MonitorSteps = this.cloneValue(data.templateMonitorSteps);
    const templateSteps: Array<MonitorStep> =
      data.templateMonitorSteps.data.monitorStepsInstanceArray;
    const currentSteps: Array<MonitorStep> =
      data.currentMonitorSteps?.data?.monitorStepsInstanceArray || [];

    for (const [
      index,
      step,
    ] of result.data!.monitorStepsInstanceArray.entries()) {
      const excludedFields: Array<string> =
        MonitorTemplateSyncFieldUtil.parse(
          step.data?.doNotSyncFields,
          data.monitorType,
        ) || [];

      // This is a template policy, not a monitor override.
      if (step.data) {
        delete step.data.doNotSyncFields;
      }
      if (excludedFields.length === 0) {
        continue;
      }

      const templateStep: MonitorStep = templateSteps[index]!;
      const hasUniqueTemplateId: boolean =
        Boolean(templateStep.data?.id?.trim()) &&
        templateSteps.filter((candidate: MonitorStep): boolean => {
          return candidate.data?.id === templateStep.data?.id;
        }).length === 1;
      const matches: Array<MonitorStep> = currentSteps.filter(
        (current: MonitorStep): boolean => {
          return Boolean(
            templateStep.data?.id && current.data?.id === templateStep.data.id,
          );
        },
      );
      const matchingStep: MonitorStep | undefined =
        matches.length === 1
          ? matches[0]
          : matches.length === 0 &&
              templateSteps.length === 1 &&
              currentSteps.length === 1
            ? currentSteps[0]
            : undefined;

      if (
        !hasUniqueTemplateId ||
        !matchingStep?.data?.id?.trim() ||
        !step.data
      ) {
        throw new BadDataException(
          "Cannot preserve fields because a template step cannot be matched to an existing monitor step. Match step IDs, or use a single-step template with a single-step monitor.",
        );
      }

      for (const field of excludedFields) {
        for (const path of MonitorTemplateSyncFieldUtil.getPaths(field)) {
          this.preservePath(
            step.data as unknown as Record<string, unknown>,
            matchingStep.data as unknown as Record<string, unknown>,
            path.split("."),
          );
        }
      }
    }

    return result;
  }

  private static preservePath(
    target: Record<string, unknown>,
    source: Record<string, unknown>,
    path: Array<string>,
  ): void {
    const key: string = path[0]!;
    if (path.length === 1) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        target[key] = this.cloneValue(source[key]);
      } else {
        delete target[key];
      }
      return;
    }

    const sourceChild: unknown = source[key];
    const targetChild: unknown = target[key];
    if (!targetChild || typeof targetChild !== "object") {
      if (!sourceChild || typeof sourceChild !== "object") {
        return;
      }
      target[key] = {};
    }
    this.preservePath(
      target[key] as Record<string, unknown>,
      sourceChild && typeof sourceChild === "object"
        ? (sourceChild as Record<string, unknown>)
        : {},
      path.slice(1),
    );
  }

  /**
   * Clone configuration without a serialization round trip: that normalizes
   * old values and can invent defaults for fields that should remain absent.
   * Keeping prototypes also keeps URL, ObjectID and criteria methods usable.
   */
  private static cloneValue<T>(value: T): T {
    if (value === null || typeof value !== "object") {
      return value;
    }
    if (value instanceof Date) {
      return new Date(value.getTime()) as T;
    }
    if (Array.isArray(value)) {
      return value.map((item: unknown): unknown => {
        return this.cloneValue(item);
      }) as T;
    }
    const result: Record<string, unknown> = Object.create(
      Object.getPrototypeOf(value),
    );
    for (const key of Object.keys(value)) {
      Object.defineProperty(result, key, {
        value: this.cloneValue((value as Record<string, unknown>)[key]),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return result as T;
  }
}
