import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorTemplateSyncFieldUtil, {
  MonitorTemplateSyncField,
} from "Common/Types/Monitor/MonitorTemplateSyncField";
import MonitorType from "Common/Types/Monitor/MonitorType";
import Card from "Common/UI/Components/Card/Card";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
} from "react";

export interface ComponentProps {
  monitorType: MonitorType;
  value: MonitorStep;
  isMonitorTemplate?: boolean | undefined;
  onChange?: ((value: MonitorStep) => void) | undefined;
}

export interface SummaryProps {
  monitorType: MonitorType;
  monitorSteps: MonitorSteps | undefined;
}

export const getMonitorTemplateSyncFieldSummary: (
  props: SummaryProps,
) => string = (props: SummaryProps): string => {
  if (props.monitorType === MonitorType.NetworkDevice) {
    return "Network device bindings are always preserved. Other step settings are copied from the template.";
  }

  const fields: Array<MonitorTemplateSyncField> =
    MonitorTemplateSyncFieldUtil.getFields(props.monitorType);
  const steps: Array<MonitorStep> =
    props.monitorSteps?.data?.monitorStepsInstanceArray || [];
  const protectedSteps: Array<string> = [];

  steps.forEach((step: MonitorStep, index: number) => {
    const labels: Array<string> = fields
      .filter((field: MonitorTemplateSyncField) => {
        return step.data?.doNotSyncFields?.includes(field.path);
      })
      .map((field: MonitorTemplateSyncField) => {
        return field.label;
      });

    if (labels.length > 0) {
      protectedSteps.push(
        steps.length > 1
          ? `Step ${index + 1}: ${labels.join(", ")}`
          : labels.join(", "),
      );
    }
  });

  if (protectedSteps.length === 0) {
    return "No fields are protected. Sync copies all step settings, including destinations and request options when applicable.";
  }

  return `These fields keep each monitor's current values during sync: ${protectedSteps.join("; ")}. All other step settings are copied from the template.`;
};

export const MonitorTemplateSyncFieldsSummary: FunctionComponent<
  SummaryProps
> = (props: SummaryProps): ReactElement => {
  return (
    <div className="mb-5 rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-gray-700">
      <h3 className="font-medium text-gray-900">Template sync settings</h3>
      <p className="mt-1">{getMonitorTemplateSyncFieldSummary(props)}</p>
      <p className="mt-1">
        New monitors still start with the template's values for every field.
      </p>
    </div>
  );
};

const MonitorTemplateSyncFields: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const id: string = useId();
  const fields: Array<MonitorTemplateSyncField> =
    MonitorTemplateSyncFieldUtil.getFields(props.monitorType);

  useEffect(() => {
    if (!props.isMonitorTemplate || !props.value.data?.doNotSyncFields) {
      return;
    }

    // The create wizard can remount a step after the monitor type changes.
    // Keep compatible choices and clear fields the new type cannot configure.
    const allowedFields: Set<string> = new Set(
      MonitorTemplateSyncFieldUtil.getFields(props.monitorType).map(
        (field: MonitorTemplateSyncField) => {
          return field.path;
        },
      ),
    );
    const selectedFields: Array<string> = props.value.data.doNotSyncFields;
    const compatibleFields: Array<string> = selectedFields.filter(
      (path: string) => {
        return allowedFields.has(path);
      },
    );

    if (compatibleFields.length !== selectedFields.length) {
      const updatedStep: MonitorStep = MonitorStep.clone(props.value);
      updatedStep.data!.doNotSyncFields = compatibleFields;
      props.onChange?.(updatedStep);
    }
  }, [props.isMonitorTemplate, props.monitorType, props.value, props.onChange]);

  if (!props.isMonitorTemplate || fields.length === 0) {
    return null;
  }

  return (
    <Card title="Template sync settings">
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          Check fields to keep each monitor's current values when syncing this
          template to one or all linked monitors. The template's values remain
          the defaults for new monitors. Lists such as request headers are
          preserved in full.
        </p>
        <div className="divide-y divide-gray-100">
          {fields.map((field: MonitorTemplateSyncField, index: number) => {
            const fieldId: string = `${id}-${index}`;

            return (
              <div
                key={field.path}
                className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
              >
                <div>
                  <p
                    id={`${fieldId}-name`}
                    className="text-sm font-medium text-gray-900"
                  >
                    {field.label}
                  </p>
                  {field.description && (
                    <p
                      id={`${fieldId}-description`}
                      className="mt-1 text-sm text-gray-500"
                    >
                      {field.description}
                    </p>
                  )}
                </div>
                <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-300 text-indigo-600 accent-indigo-600 focus:ring-indigo-600"
                    aria-labelledby={`${fieldId}-name ${fieldId}-label`}
                    aria-describedby={
                      field.description ? `${fieldId}-description` : undefined
                    }
                    checked={
                      props.value.data?.doNotSyncFields?.includes(field.path) ||
                      false
                    }
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                      const updatedStep: MonitorStep = MonitorStep.clone(
                        props.value,
                      );
                      const selectedFields: Array<string> =
                        updatedStep.data?.doNotSyncFields || [];

                      updatedStep.data!.doNotSyncFields = event.target.checked
                        ? Array.from(new Set([...selectedFields, field.path]))
                        : selectedFields.filter((path: string) => {
                            return path !== field.path;
                          });
                      props.onChange?.(updatedStep);
                    }}
                  />
                  <span id={`${fieldId}-label`}>Do not sync this field</span>
                </label>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
};

export default MonitorTemplateSyncFields;
