import MonitorStepExceptionMonitor, {
  MonitorStepExceptionMonitorUtil,
} from "Common/Types/Monitor/MonitorStepExceptionMonitor";
import Service from "Common/Models/DatabaseModels/Service";
import TelemetryEntity from "Common/Models/DatabaseModels/TelemetryEntity";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import BasicForm from "Common/UI/Components/Forms/BasicForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import HorizontalRule from "Common/UI/Components/HorizontalRule/HorizontalRule";
import ObjectID from "Common/Types/ObjectID";
import JSONFunctions from "Common/Types/JSONFunctions";
import Query from "Common/Types/BaseDatabase/Query";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import ExceptionInstanceTable from "../../../Exceptions/ExceptionInstanceTable";
import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import Includes from "Common/Types/BaseDatabase/Includes";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import GreaterThanOrEqual from "Common/Types/BaseDatabase/GreaterThanOrEqual";
import OneUptimeDate from "Common/Types/Date";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";

/*
 * Preview-only cap on the fingerprints fetched per status and embedded in
 * the preview query (the list rides in the analytics list request body on
 * every refetch). The worker applies the full exclusion at evaluation time;
 * beyond this cap the preview may show some resolved/archived occurrences
 * that the monitor itself will not count.
 */
const PREVIEW_EXCLUDED_FINGERPRINT_LIMIT: number = 1000;

export interface ComponentProps {
  monitorStepExceptionMonitor: MonitorStepExceptionMonitor;
  onMonitorStepExceptionMonitorChanged: (
    monitorStepExceptionMonitor: MonitorStepExceptionMonitor,
  ) => void;
  telemetryServices: Array<Service>;
  telemetryEntities?: Array<TelemetryEntity> | undefined;
}

type ExceptionMonitorFormValues = {
  message: string;
  exceptionTypesInput: string;
  telemetryServiceIds: Array<string>;
  entityKeys: Array<string>;
  includeResolved: boolean;
  includeArchived: boolean;
  lastXSecondsOfExceptions: number;
};

const DURATION_OPTIONS: Array<{ label: string; value: number }> = [
  { label: "Last 5 seconds", value: 5 },
  { label: "Last 10 seconds", value: 10 },
  { label: "Last 30 seconds", value: 30 },
  { label: "Last 1 minute", value: 60 },
  { label: "Last 5 minutes", value: 300 },
  { label: "Last 15 minutes", value: 900 },
  { label: "Last 30 minutes", value: 1800 },
  { label: "Last 1 hour", value: 3600 },
  { label: "Last 6 hours", value: 21600 },
  { label: "Last 12 hours", value: 43200 },
  { label: "Last 24 hours", value: 86400 },
];

type ParseExceptionTypesFunction = (input: string) => Array<string>;

const parseExceptionTypes: ParseExceptionTypesFunction = (input: string) => {
  return input
    .split(",")
    .map((item: string): string => {
      return item.trim();
    })
    .filter((item: string): boolean => {
      return item.length > 0;
    });
};

type ToFormValuesFunction = (
  monitor: MonitorStepExceptionMonitor,
) => ExceptionMonitorFormValues;

const toFormValues: ToFormValuesFunction = (
  monitor: MonitorStepExceptionMonitor,
) => {
  return {
    message: monitor.message || "",
    exceptionTypesInput: monitor.exceptionTypes.join(", "),
    telemetryServiceIds: monitor.telemetryServiceIds.map(
      (id: ObjectID): string => {
        return id.toString();
      },
    ),
    entityKeys: monitor.entityKeys || [],
    includeResolved: monitor.includeResolved || false,
    includeArchived: monitor.includeArchived || false,
    lastXSecondsOfExceptions:
      monitor.lastXSecondsOfExceptions ||
      MonitorStepExceptionMonitorUtil.getDefault().lastXSecondsOfExceptions,
  };
};

type ToMonitorConfigFunction = (
  values: ExceptionMonitorFormValues,
) => MonitorStepExceptionMonitor;

const toMonitorConfig: ToMonitorConfigFunction = (
  values: ExceptionMonitorFormValues,
) => {
  return {
    telemetryServiceIds: values.telemetryServiceIds
      .filter((id: string): boolean => {
        return Boolean(id);
      })
      .map((id: string): ObjectID => {
        return new ObjectID(id);
      }),
    entityKeys: (values.entityKeys || []).filter((key: string): boolean => {
      return Boolean(key);
    }),
    exceptionTypes: parseExceptionTypes(values.exceptionTypesInput),
    message: values.message || "",
    includeResolved: values.includeResolved || false,
    includeArchived: values.includeArchived || false,
    lastXSecondsOfExceptions:
      values.lastXSecondsOfExceptions ||
      MonitorStepExceptionMonitorUtil.getDefault().lastXSecondsOfExceptions,
  };
};

type HasAdvancedConfigurationFunction = (
  monitor: MonitorStepExceptionMonitor,
) => boolean;

const hasAdvancedConfiguration: HasAdvancedConfigurationFunction = (
  monitor: MonitorStepExceptionMonitor,
) => {
  return Boolean(
    monitor.includeResolved ||
      monitor.includeArchived ||
      (monitor.telemetryServiceIds && monitor.telemetryServiceIds.length > 0) ||
      (monitor.entityKeys && monitor.entityKeys.length > 0),
  );
};

const ExceptionMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [formValues, setFormValues] = useState<ExceptionMonitorFormValues>(
    toFormValues(props.monitorStepExceptionMonitor),
  );

  const [showAdvancedOptions, setShowAdvancedOptions] = useState<boolean>(
    hasAdvancedConfiguration(props.monitorStepExceptionMonitor),
  );

  useEffect(() => {
    setFormValues(toFormValues(props.monitorStepExceptionMonitor));
    setShowAdvancedOptions(
      hasAdvancedConfiguration(props.monitorStepExceptionMonitor),
    );
  }, [props.monitorStepExceptionMonitor]);

  type HandleFormChangeFunction = (values: ExceptionMonitorFormValues) => void;

  const handleFormChange: HandleFormChangeFunction = (
    values: ExceptionMonitorFormValues,
  ) => {
    setFormValues(values);
    props.onMonitorStepExceptionMonitorChanged(toMonitorConfig(values));
  };

  const handleAdvancedToggle: () => void = (): void => {
    setShowAdvancedOptions((current: boolean): boolean => {
      return !current;
    });
  };

  /*
   * The preview (fingerprint lookup + instance table) is driven by a
   * debounced copy of the form values so keystrokes in the message /
   * exception-type fields don't fire a table refetch per character —
   * each recompute stamps a fresh time window into the query, which
   * defeats the table's own change detection.
   */
  const [debouncedFormValues, setDebouncedFormValues] =
    useState<ExceptionMonitorFormValues>(formValues);

  useEffect(() => {
    const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
      setDebouncedFormValues(formValues);
    }, 500);

    return (): void => {
      clearTimeout(timer);
    };
  }, [formValues]);

  const [excludedFingerprints, setExcludedFingerprints] = useState<
    Array<string>
  >([]);

  /*
   * Bail out when the fetched fingerprints match current state — a new
   * array reference would recompute previewQuery (fresh time window) and
   * force a redundant preview-table refetch.
   */
  const applyExcludedFingerprints: (next: Array<string>) => void = (
    next: Array<string>,
  ): void => {
    setExcludedFingerprints((current: Array<string>): Array<string> => {
      const sortedNext: Array<string> = [...next].sort();
      const sortedCurrent: Array<string> = [...current].sort();

      if (
        sortedCurrent.length === sortedNext.length &&
        sortedCurrent.every((fingerprint: string, i: number): boolean => {
          return fingerprint === sortedNext[i];
        })
      ) {
        return current;
      }

      return next;
    });
  };

  /*
   * Mirror the worker's evaluation: unless the monitor opts in, occurrences
   * of resolved/archived exception groups don't count, so the preview must
   * exclude them too. Group state lives on TelemetryException (Postgres);
   * the fingerprint is the join key to the ExceptionInstance rows shown in
   * the preview table. Fail-soft and best-effort: if this lookup fails the
   * preview simply shows unfiltered instances, and the list is capped at
   * PREVIEW_EXCLUDED_FINGERPRINT_LIMIT per status — the worker applies the
   * full exclusion at evaluation time regardless.
   */
  const telemetryServiceIdsKey: string =
    debouncedFormValues.telemetryServiceIds.join(",");

  useEffect(() => {
    let isCancelled: boolean = false;

    const fetchExcludedFingerprints: () => Promise<void> =
      async (): Promise<void> => {
        const excludeResolved: boolean = !debouncedFormValues.includeResolved;
        const excludeArchived: boolean = !debouncedFormValues.includeArchived;

        if (!excludeResolved && !excludeArchived) {
          if (!isCancelled) {
            applyExcludedFingerprints([]);
          }
          return;
        }

        try {
          /*
           * Fixed lookback of the largest selectable window plus slack —
           * independent of the selected duration so changing the dropdown
           * doesn't refetch. Over-fetching is harmless: excluding a
           * fingerprint with no occurrences in the window is a no-op.
           */
          const lastSeenAfter: Date = OneUptimeDate.addRemoveSeconds(
            OneUptimeDate.getCurrentDate(),
            (86400 + 3600) * -1,
          );

          const statusFilters: Array<Query<TelemetryException>> = [];

          if (excludeResolved) {
            statusFilters.push({ isResolved: true });
          }

          if (excludeArchived) {
            statusFilters.push({ isArchived: true });
          }

          const serviceIds: Array<ObjectID> =
            debouncedFormValues.telemetryServiceIds
              .filter((id: string): boolean => {
                return Boolean(id);
              })
              .map((id: string): ObjectID => {
                return new ObjectID(id);
              });

          const results: Array<ListResult<TelemetryException>> =
            await Promise.all(
              statusFilters.map(
                (
                  statusFilter: Query<TelemetryException>,
                ): Promise<ListResult<TelemetryException>> => {
                  const query: Query<TelemetryException> = {
                    projectId: ProjectUtil.getCurrentProjectId()!,
                    ...statusFilter,
                    lastSeenAt: new GreaterThanOrEqual<Date>(lastSeenAfter),
                  };

                  if (serviceIds.length > 0) {
                    query.primaryEntityId = new Includes(serviceIds);
                  }

                  return ModelAPI.getList<TelemetryException>({
                    modelType: TelemetryException,
                    query: query,
                    limit: PREVIEW_EXCLUDED_FINGERPRINT_LIMIT,
                    skip: 0,
                    select: {
                      fingerprint: true,
                    },
                    sort: {
                      lastSeenAt: SortOrder.Descending,
                    },
                  });
                },
              ),
            );

          const fingerprints: Set<string> = new Set<string>();

          for (const result of results) {
            for (const telemetryException of result.data) {
              if (telemetryException.fingerprint) {
                fingerprints.add(telemetryException.fingerprint);
              }
            }
          }

          if (!isCancelled) {
            applyExcludedFingerprints(Array.from(fingerprints));
          }
        } catch {
          if (!isCancelled) {
            applyExcludedFingerprints([]);
          }
        }
      };

    fetchExcludedFingerprints().catch((): void => {
      // fail-soft — handled above.
    });

    return (): void => {
      isCancelled = true;
    };
  }, [
    debouncedFormValues.includeResolved,
    debouncedFormValues.includeArchived,
    telemetryServiceIdsKey,
  ]);

  const previewQuery: Query<ExceptionInstance> = useMemo(() => {
    const monitorConfig: MonitorStepExceptionMonitor =
      toMonitorConfig(debouncedFormValues);

    const query: Query<ExceptionInstance> =
      MonitorStepExceptionMonitorUtil.toAnalyticsQuery(monitorConfig);

    if (excludedFingerprints.length > 0) {
      query.fingerprint = new IncludesNone(excludedFingerprints);
    }

    return JSONFunctions.anyObjectToJSONObject(
      query,
    ) as Query<ExceptionInstance>;
  }, [debouncedFormValues, excludedFingerprints]);

  return (
    <div>
      <BasicForm
        id="exception-monitor-form"
        hideSubmitButton={true}
        initialValues={formValues}
        onChange={handleFormChange}
        fields={[
          {
            field: {
              message: true,
            },
            fieldType: FormFieldSchemaType.Text,
            title: "Filter Exception Message",
            description:
              "Filter exceptions that include this text in the message.",
            hideOptionalLabel: true,
          },
          {
            field: {
              exceptionTypesInput: true,
            },
            fieldType: FormFieldSchemaType.Text,
            title: "Exception Types",
            description:
              "Provide a comma-separated list of exception types to monitor.",
            placeholder: "TypeError, NullReferenceException",
            hideOptionalLabel: true,
          },
          {
            field: {
              lastXSecondsOfExceptions: true,
            },
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: DURATION_OPTIONS,
            title: "Monitor exceptions for (time)",
            description:
              "We will evaluate exceptions generated within this time window.",
            defaultValue:
              MonitorStepExceptionMonitorUtil.getDefault()
                .lastXSecondsOfExceptions,
            hideOptionalLabel: true,
          },
          {
            field: {
              telemetryServiceIds: true,
            },
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownOptions: props.telemetryServices.map(
              (service: Service): { label: string; value: string } => {
                return {
                  label: service.name || "Untitled Service",
                  value: service.id?.toString() || "",
                };
              },
            ),
            title: "Filter by Telemetry Service",
            description: "Select telemetry services to scope this monitor.",
            hideOptionalLabel: true,
            showIf: (): boolean => {
              return showAdvancedOptions;
            },
          },
          {
            field: {
              entityKeys: true,
            },
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownOptions: (props.telemetryEntities || []).map(
              (telemetryEntity: TelemetryEntity) => {
                return {
                  label: `${
                    telemetryEntity.displayName ||
                    telemetryEntity.entityKey ||
                    ""
                  } (${telemetryEntity.entityType || ""})`,
                  value: telemetryEntity.entityKey || "",
                };
              },
            ),
            title: "Filter by Infrastructure Entity",
            description: "Scope to specific infrastructure entities (optional)",
            hideOptionalLabel: true,
            showIf: (): boolean => {
              return showAdvancedOptions;
            },
          },
          {
            field: {
              includeResolved: true,
            },
            fieldType: FormFieldSchemaType.Checkbox,
            title: "Include Resolved Exceptions",
            description:
              "By default, exceptions marked as resolved are not counted (an exception that occurs again is automatically un-resolved and counted). Enable this to count resolved exceptions too.",
            hideOptionalLabel: true,
            showIf: (): boolean => {
              return showAdvancedOptions;
            },
          },
          {
            field: {
              includeArchived: true,
            },
            fieldType: FormFieldSchemaType.Checkbox,
            title: "Include Archived Exceptions",
            description:
              "By default, exceptions that are archived are not counted. Enable this to count archived exceptions too.",
            hideOptionalLabel: true,
            showIf: (): boolean => {
              return showAdvancedOptions;
            },
          },
        ]}
      />

      <div className="-ml-3">
        <Button
          buttonStyle={ButtonStyleType.SECONDARY_LINK}
          title={
            showAdvancedOptions
              ? "Hide Advanced Options"
              : "Show Advanced Options"
          }
          onClick={handleAdvancedToggle}
        />
      </div>

      <div>
        <HorizontalRule />
        <FieldLabelElement
          title="Exceptions Preview"
          description={
            "Here is the preview of the exceptions that will be monitored based on the filters you have set above."
          }
          hideOptionalLabel={true}
          isHeading={true}
        />
        <div className="mt-5 mb-5">
          <ExceptionInstanceTable
            title="Exceptions Preview"
            description="Exceptions matching the current monitor filters."
            query={previewQuery}
          />
        </div>
      </div>
    </div>
  );
};

export default ExceptionMonitorStepForm;
