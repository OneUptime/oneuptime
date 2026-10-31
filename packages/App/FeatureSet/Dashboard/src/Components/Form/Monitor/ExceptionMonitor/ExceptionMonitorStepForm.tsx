import MonitorStepExceptionMonitor, {
  MonitorStepExceptionMonitorUtil,
} from "Common/Types/Monitor/MonitorStepExceptionMonitor";
import Service from "Common/Models/DatabaseModels/Service";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import BasicForm from "Common/UI/Components/Forms/BasicForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
import { FOLDED_SECTION_LINE } from "Common/UI/Components/FoldedSection/FoldedSectionVariant";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
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
import { findExceptionGroupFingerprints } from "../../../../Utils/ExceptionMerge";

/*
 * Preview-only cap on the fingerprints fetched per status and embedded in
 * the preview query (the list rides in the analytics list request body on
 * every refetch). The worker applies the full exclusion at evaluation time;
 * beyond this cap the preview may show some resolved/archived occurrences
 * that the monitor itself will not count.
 */
const PREVIEW_EXCLUDED_FINGERPRINT_LIMIT: number = 1000;

/*
 * The most fingerprints the preview leaves out in all, those of the
 * exceptions merged into the resolved and archived ones included - as many
 * as the monitor's own count leaves out (EXCLUDED_FINGERPRINT_LIMIT).
 */
export const PREVIEW_EXCLUDED_GROUP_FINGERPRINT_LIMIT: number = 5000;

export interface ComponentProps {
  monitorStepExceptionMonitor: MonitorStepExceptionMonitor;
  onMonitorStepExceptionMonitorChanged: (
    monitorStepExceptionMonitor: MonitorStepExceptionMonitor,
  ) => void;
  telemetryServices: Array<Service>;
  telemetryEntities?: Array<InventoryItem> | undefined;
}

type ExceptionMonitorFormValues = {
  message: string;
  exceptionTypesInput: string;
  environmentsInput: string;
  telemetryServiceIds: Array<string>;
  entityKeys: Array<string>;
  includeResolved: boolean;
  includeArchived: boolean;
  lastXSecondsOfExceptions: number;
};

/*
 * The filters that narrow an exception monitor down further - telemetry
 * service and infrastructure entity - and the switches that count resolved
 * or archived exceptions too fold under the same More fields section as the
 * rarely needed fields of every other form, instead of the Show / Hide
 * Advanced Options link this form had of its own. Folded, the section's
 * header names them and shows each one a monitor uses as a chip ("Include
 * Resolved Exceptions: On"), so editing a monitor never hides a filter it
 * has. Folded fields stay mounted: the preview below and the saved step
 * always get the whole filter set. Built once, so every render hands its
 * fields the same section.
 */
const MORE_EXCEPTION_FILTERS: FormFieldCollapsibleSection<ExceptionMonitorFormValues> =
  getAdvancedFormSection<ExceptionMonitorFormValues>();

// The fold under the filters that lists the exceptions they match.
export const MATCHING_EXCEPTIONS_TITLE: string = translationKey(
  "Matching exceptions",
);

type ParseCommaSeparatedListFunction = (input: string) => Array<string>;

const parseCommaSeparatedList: ParseCommaSeparatedListFunction = (
  input: string,
) => {
  return (input || "")
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
    environmentsInput: MonitorStepExceptionMonitorUtil.normalizeEnvironments(
      monitor.environments,
    ).join(", "),
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
    environments: MonitorStepExceptionMonitorUtil.normalizeEnvironments(
      parseCommaSeparatedList(values.environmentsInput),
    ),
    exceptionTypes: parseCommaSeparatedList(values.exceptionTypesInput),
    message: values.message || "",
    includeResolved: values.includeResolved || false,
    includeArchived: values.includeArchived || false,
    lastXSecondsOfExceptions:
      values.lastXSecondsOfExceptions ||
      MonitorStepExceptionMonitorUtil.getDefault().lastXSecondsOfExceptions,
  };
};

const ExceptionMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [formValues, setFormValues] = useState<ExceptionMonitorFormValues>(
    toFormValues(props.monitorStepExceptionMonitor),
  );

  // Folded, and read only once opened: the rule's preview counts them.
  const [isMatchingCollapsed, setIsMatchingCollapsed] = useState<boolean>(true);

  /*
   * Only the values follow the step handed back: whether More fields is
   * open is the section's own, so typing in a filter above it never folds
   * it again (the old link closed whenever no folded filter was set yet).
   */
  useEffect(() => {
    setFormValues(toFormValues(props.monitorStepExceptionMonitor));
  }, [props.monitorStepExceptionMonitor]);

  type HandleFormChangeFunction = (values: ExceptionMonitorFormValues) => void;

  const handleFormChange: HandleFormChangeFunction = (
    values: ExceptionMonitorFormValues,
  ) => {
    setFormValues(values);
    props.onMonitorStepExceptionMonitorChanged(toMonitorConfig(values));
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
   *
   * Only the folded list of matching exceptions reads them, so they are
   * looked up once it is opened: a step whose list stays folded asks for
   * nothing (the rule's chart counts its own way, on the server).
   */
  const telemetryServiceIdsKey: string =
    debouncedFormValues.telemetryServiceIds.join(",");

  useEffect(() => {
    if (isMatchingCollapsed) {
      return;
    }

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
                      _id: true,
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
          const excludedIds: Array<string> = [];

          for (const result of results) {
            for (const telemetryException of result.data) {
              if (telemetryException.fingerprint) {
                fingerprints.add(telemetryException.fingerprint);
              }

              if (telemetryException.id) {
                excludedIds.push(telemetryException.id.toString());
              }
            }
          }

          /*
           * An exception merged into one of these is part of it: its
           * occurrences keep their own fingerprint, so they are left out
           * too, as the monitor leaves them out of its count
           * (getResolvedOrArchivedFingerprints). The fingerprints merged
           * into each come with it (findExceptionGroupFingerprints). If
           * they cannot be read, the preview leaves out what it did before.
           */
          try {
            for (const group of await findExceptionGroupFingerprints(
              excludedIds,
            )) {
              for (const fingerprint of group.fingerprints) {
                if (
                  fingerprints.size >= PREVIEW_EXCLUDED_GROUP_FINGERPRINT_LIMIT
                ) {
                  break;
                }

                fingerprints.add(fingerprint);
              }
            }
          } catch {
            // Best effort: the exceptions' own fingerprints are left out still.
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
    isMatchingCollapsed,
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
      {/*
       * A part of the criteria step, not a form of its own: its first field
       * (Message contains) took the cursor as the step opened - and on a
       * phone the keyboard - before the question above it was read.
       */}
      <BasicForm
        id="exception-monitor-form"
        hideSubmitButton={true}
        disableAutofocus={true}
        initialValues={formValues}
        onChange={handleFormChange}
        fields={[
          {
            field: {
              message: true,
            },
            fieldType: FormFieldSchemaType.Text,
            title: "Message contains",
            description:
              "Only exceptions whose message contains this text. Empty: every message.",
            hideOptionalLabel: true,
          },
          {
            field: {
              exceptionTypesInput: true,
            },
            fieldType: FormFieldSchemaType.Text,
            title: "Exception Types",
            description:
              "Only exceptions of these types, separated by commas. Empty: every type.",
            placeholder: "TypeError, NullReferenceException",
            hideOptionalLabel: true,
          },
          {
            field: {
              environmentsInput: true,
            },
            fieldType: FormFieldSchemaType.Text,
            title: "Environments",
            description:
              "Only exceptions from these environments (deployment.environment), separated by commas. Empty: every environment.",
            placeholder: "production, staging",
            hideOptionalLabel: true,
          },
          /*
           * The time window is the rule's ("When to alert"), set there
           * beside the number it goes with.
           */
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
            description:
              "Only exceptions from these services. Empty: every service.",
            hideOptionalLabel: true,
            collapsibleSection: MORE_EXCEPTION_FILTERS,
          },
          {
            field: {
              entityKeys: true,
            },
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownOptions: (props.telemetryEntities || []).map(
              (telemetryEntity: InventoryItem) => {
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
            description:
              "Only exceptions from these hosts, clusters or other infrastructure. Empty: all of it.",
            hideOptionalLabel: true,
            collapsibleSection: MORE_EXCEPTION_FILTERS,
          },
          {
            field: {
              includeResolved: true,
            },
            fieldType: FormFieldSchemaType.Checkbox,
            title: "Include Resolved Exceptions",
            description:
              "Count exceptions marked as resolved too. A resolved exception that happens again is always counted.",
            hideOptionalLabel: true,
            collapsibleSection: MORE_EXCEPTION_FILTERS,
          },
          {
            field: {
              includeArchived: true,
            },
            fieldType: FormFieldSchemaType.Checkbox,
            title: "Include Archived Exceptions",
            description:
              "Count archived exceptions too. They are left out otherwise.",
            hideOptionalLabel: true,
            collapsibleSection: MORE_EXCEPTION_FILTERS,
          },
        ]}
      />

      <FoldedSection
        title={MATCHING_EXCEPTIONS_TITLE}
        description="The exceptions these filters match now, to check them before you save."
        variant={FOLDED_SECTION_LINE}
        className="mt-4"
        isCollapsed={isMatchingCollapsed}
        onToggle={(isCollapsed: boolean) => {
          setIsMatchingCollapsed(isCollapsed);
        }}
        dataTestId="exception-monitor-matching-exceptions"
      >
        {isMatchingCollapsed ? (
          <></>
        ) : (
          <div className="mt-2">
            <ExceptionInstanceTable
              title="Matching exceptions"
              description="Exceptions matching the current monitor filters."
              query={previewQuery}
            />
          </div>
        )}
      </FoldedSection>
    </div>
  );
};

export default ExceptionMonitorStepForm;
