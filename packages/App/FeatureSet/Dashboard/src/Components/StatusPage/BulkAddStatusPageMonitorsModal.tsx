import addStatusPageMonitorsWithLabelSync, {
  AddStatusPageMonitorsWithLabelSyncResult,
} from "./AddStatusPageMonitorsWithLabelSync";
import bulkAddStatusPageMonitors, {
  BulkAddStatusPageMonitorFailure,
  BulkAddStatusPageMonitorsResult,
} from "./BulkAddStatusPageMonitors";
import { getStatusPageResourceAdvancedFields } from "./StatusPageResourceFormFields";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import StatusPageMonitorRule from "Common/Models/DatabaseModels/StatusPageMonitorRule";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import UptimePrecision from "Common/Types/StatusPage/UptimePrecision";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ButtonType from "Common/UI/Components/Button/ButtonTypes";
import BasicForm from "Common/UI/Components/Forms/BasicForm";
import Field from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { BulkAddedLabel } from "Common/UI/Components/EntityDropdown/EntityDropdown";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useRef,
  useState,
} from "react";

export interface GridPlacementOptions {
  rowLabel: string;
  rowValues: Array<string>;
  columnLabel: string;
  columnValues: Array<string>;
}

export interface ComponentProps {
  projectId: ObjectID;
  statusPageId: ObjectID;
  statusPageGroupId?: ObjectID | undefined;
  gridPlacement?: GridPlacementOptions | undefined;
  onClose: () => void;
  onComplete: (result: BulkAddStatusPageMonitorsResult) => void;
}

/**
 * Mirrors the single resource form, except the monitor picker is multi-select
 * and display name / description are not asked for - they are copied from each
 * monitor. Every other option applies to all of the resources created here.
 */
export interface BulkAddStatusPageMonitorsFormValues {
  monitors?: Array<ObjectID | string> | undefined;
  keepInSyncWithLabels?: boolean | undefined;
  rowAxisValue?: string | undefined;
  columnAxisValue?: string | undefined;
  displayTooltip?: string | undefined;
  showCurrentStatus?: boolean | undefined;
  showUptimePercent?: boolean | undefined;
  uptimePercentPrecision?: UptimePrecision | undefined;
  showStatusHistoryChart?: boolean | undefined;
}

const FORM_STEPS: Array<FormStep<BulkAddStatusPageMonitorsFormValues>> = [
  {
    title: "Monitor Details",
    id: "monitor-details",
  },
  {
    title: "Advanced",
    id: "advanced",
  },
];

type CreateMonitorRuleFunction = (rule: StatusPageMonitorRule) => Promise<void>;

/*
 * The write that makes a label-populated group stay populated. Lives here
 * rather than in the runner so the runner stays free of ModelAPI and every one
 * of its branches is testable without a browser.
 */
const createMonitorRule: CreateMonitorRuleFunction = async (
  rule: StatusPageMonitorRule,
): Promise<void> => {
  await ModelAPI.create<StatusPageMonitorRule>({
    model: rule,
    modelType: StatusPageMonitorRule,
  });
};

type ToObjectIdsFunction = (value: unknown) => Array<ObjectID>;

/*
 * The multi-select dropdown hands back either raw values or dropdown options
 * depending on whether the user picked from the list or the form normalized
 * them on submit - accept both.
 */
const toObjectIds: ToObjectIdsFunction = (value: unknown): Array<ObjectID> => {
  if (!value || !Array.isArray(value)) {
    return [];
  }

  const ids: Array<ObjectID> = [];

  for (const item of value) {
    const rawValue: unknown =
      item && typeof item === "object" && "value" in item
        ? (item as { value: unknown }).value
        : item;

    if (rawValue instanceof ObjectID) {
      ids.push(rawValue);
    } else if (typeof rawValue === "string" && rawValue) {
      ids.push(new ObjectID(rawValue));
    }
  }

  return ids;
};

const BulkAddStatusPageMonitorsModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [result, setResult] =
    useState<AddStatusPageMonitorsWithLabelSyncResult | null>(null);
  /*
   * Which labels the picker expanded to fill the monitor list. The picker
   * drops the label the moment it hands back the monitors, so this is the only
   * record that the selection came from a label at all - and it is what turns
   * a one-time bulk add into a rule that keeps the group populated (#3418).
   */
  const [syncLabels, setSyncLabels] = useState<Array<BulkAddedLabel>>([]);
  /*
   * The same list in a ref. State is what makes the toggle appear; the ref is
   * what submit reads, because the submit handler reaches this component
   * through the form and can be a closure older than the current render.
   */
  const syncLabelsRef: MutableRefObject<Array<BulkAddedLabel>> = useRef<
    Array<BulkAddedLabel>
  >([]);
  const [submitButtonText, setSubmitButtonText] =
    useState<string>("Add Monitors");

  const formRef: MutableRefObject<any> = useRef<any>(null);

  const getFields: () => Array<
    Field<BulkAddStatusPageMonitorsFormValues>
  > = (): Array<Field<BulkAddStatusPageMonitorsFormValues>> => {
    const fields: Array<Field<BulkAddStatusPageMonitorsFormValues>> = [
      {
        field: {
          monitors: true,
        },
        title: "Monitors",
        description:
          "Select monitors that will be shown on the status page. The display name and description of each resource is copied from its monitor. Monitors already on this status page are skipped, so selecting a label again only adds the monitors that are new to it.",
        fieldType: FormFieldSchemaType.MultiSelectDropdown,
        dropdownModal: {
          type: Monitor,
          labelField: "name",
          valueField: "_id",
        },
        required: true,
        placeholder: "Select Monitors",
        stepId: "monitor-details",
        onLabelsBulkAdded: (labels: Array<BulkAddedLabel>): void => {
          const merged: Map<string, BulkAddedLabel> = new Map<
            string,
            BulkAddedLabel
          >();

          for (const label of [...syncLabelsRef.current, ...labels]) {
            if (label?.id) {
              merged.set(label.id, label);
            }
          }

          syncLabelsRef.current = Array.from(merged.values());
          setSyncLabels(syncLabelsRef.current);
        },
      },
      /*
       * Declared unconditionally so the form seeds it with its default the one
       * time it builds initial values; showIf keeps it out of sight until the
       * user has actually bulk-added by label and the question means something.
       *
       * Never offered for a grid group: a rule cannot record the row and
       * column the user is being asked for two fields below, and a resource in
       * a grid group with neither is dropped by the public page. Promising
       * live sync there would promise monitors nobody can see.
       */
      {
        field: {
          keepInSyncWithLabels: true,
        },
        title: "Keep This Group In Sync With These Labels",
        fieldType: FormFieldSchemaType.Toggle,
        required: false,
        defaultValue: true,
        description:
          "Monitors carrying these labels are added to this group now and whenever a new monitor is given one of them. Turn this off to add only the monitors selected above, once.",
        showIf: (): boolean => {
          return syncLabels.length > 0 && !props.gridPlacement;
        },
        stepId: "monitor-details",
      },
    ];

    if (props.gridPlacement) {
      fields.push(
        {
          field: {
            rowAxisValue: true,
          },
          title: `${props.gridPlacement.rowLabel} (Row)`,
          description: "Row these resources belong to in the grid.",
          fieldType: FormFieldSchemaType.Dropdown,
          dropdownOptions: props.gridPlacement.rowValues.map(
            (value: string) => {
              return { label: value, value: value };
            },
          ),
          required: true,
          placeholder: `Select ${props.gridPlacement.rowLabel.toLowerCase()}`,
          stepId: "monitor-details",
        },
        {
          field: {
            columnAxisValue: true,
          },
          title: `${props.gridPlacement.columnLabel} (Column)`,
          description: "Column these resources belong to in the grid.",
          fieldType: FormFieldSchemaType.Dropdown,
          dropdownOptions: props.gridPlacement.columnValues.map(
            (value: string) => {
              return { label: value, value: value };
            },
          ),
          required: true,
          placeholder: `Select ${props.gridPlacement.columnLabel.toLowerCase()}`,
          stepId: "monitor-details",
        },
      );
    }

    /*
     * The advanced fields are declared against StatusPageResource because the
     * single resource form uses them too. Their field keys are the same ones
     * this form collects, so they render and validate identically here.
     */
    return [
      ...fields,
      ...(getStatusPageResourceAdvancedFields() as unknown as Array<
        Field<BulkAddStatusPageMonitorsFormValues>
      >),
    ];
  };

  type FetchMonitorsFunction = (
    monitorIds: Array<ObjectID>,
  ) => Promise<Array<Monitor>>;

  /*
   * The form only carries monitor IDs, but each resource copies its display
   * name and description from the monitor - so fetch those here.
   */
  const fetchMonitors: FetchMonitorsFunction = async (
    monitorIds: Array<ObjectID>,
  ): Promise<Array<Monitor>> => {
    const listResult: ListResult<Monitor> = await ModelAPI.getList<Monitor>({
      modelType: Monitor,
      query: {
        _id: new Includes(monitorIds),
        projectId: props.projectId,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: {
        _id: true,
        name: true,
        description: true,
      },
      sort: {
        name: SortOrder.Ascending,
      },
      requestOptions: {},
    });

    // Create resources in the order the monitors were picked.
    const monitorsById: Map<string, Monitor> = new Map<string, Monitor>();

    for (const monitor of listResult.data) {
      if (monitor._id) {
        monitorsById.set(monitor._id.toString(), monitor);
      }
    }

    return monitorIds
      .map((monitorId: ObjectID) => {
        return monitorsById.get(monitorId.toString());
      })
      .filter((monitor: Monitor | undefined): monitor is Monitor => {
        return Boolean(monitor);
      });
  };

  type FetchExistingMonitorIdsFunction = () => Promise<Array<string>>;

  /*
   * Which monitors this status page already lists. Selecting by label hands
   * back every monitor carrying the label - the ones already added included -
   * so the add has to know what is already there or it writes a second
   * resource for each of them (issue #3420).
   *
   * Read across the whole status page rather than the group being added to: a
   * monitor listed in two groups is still a monitor a visitor sees twice, and
   * the server refuses that create for the same reason.
   */
  const fetchExistingMonitorIds: FetchExistingMonitorIdsFunction =
    async (): Promise<Array<string>> => {
      const listResult: ListResult<StatusPageResource> =
        await ModelAPI.getList<StatusPageResource>({
          modelType: StatusPageResource,
          query: {
            statusPageId: props.statusPageId,
            projectId: props.projectId,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            monitorId: true,
          },
          sort: {},
          requestOptions: {},
        });

      return listResult.data
        .map((resource: StatusPageResource) => {
          return resource.monitorId?.toString() || "";
        })
        .filter((monitorId: string) => {
          return monitorId !== "";
        });
    };

  type OnSubmitFunction = (
    values: FormValues<BulkAddStatusPageMonitorsFormValues>,
  ) => Promise<void>;

  const onSubmit: OnSubmitFunction = async (
    values: FormValues<BulkAddStatusPageMonitorsFormValues>,
  ): Promise<void> => {
    const monitorIds: Array<ObjectID> = toObjectIds(values.monitors);

    if (monitorIds.length === 0) {
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const [monitors, existingMonitorIds]: [Array<Monitor>, Array<string>] =
        await Promise.all([
          fetchMonitors(monitorIds),
          fetchExistingMonitorIds(),
        ]);

      const bulkResult: AddStatusPageMonitorsWithLabelSyncResult =
        await addStatusPageMonitorsWithLabelSync({
          monitors: monitors,
          projectId: props.projectId,
          statusPageId: props.statusPageId,
          statusPageGroupId: props.statusPageGroupId,
          existingMonitorIds: existingMonitorIds,
          rowAxisValue: (values.rowAxisValue as string) || undefined,
          columnAxisValue: (values.columnAxisValue as string) || undefined,
          resourceOptions: {
            displayTooltip: (values.displayTooltip as string) || undefined,
            showCurrentStatus: Boolean(values.showCurrentStatus),
            showUptimePercent: Boolean(values.showUptimePercent),
            uptimePercentPrecision: values.showUptimePercent
              ? (values.uptimePercentPrecision as UptimePrecision)
              : undefined,
            showStatusHistoryChart: Boolean(values.showStatusHistoryChart),
          },
          syncLabels: syncLabelsRef.current,
          keepInSyncWithLabels: Boolean(values.keepInSyncWithLabels),
          bulkAdd: bulkAddStatusPageMonitors,
          createMonitorRule: createMonitorRule,
        });

      setResult(bulkResult);
      props.onComplete(bulkResult);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  const getFailureMessage: (
    failure: BulkAddStatusPageMonitorFailure,
  ) => string = (failure: BulkAddStatusPageMonitorFailure): string => {
    return API.getFriendlyMessage(failure.error);
  };

  if (result) {
    const totalCount: number =
      result.succeeded.length + result.failed.length + result.skipped.length;

    /*
     * Monitors that were already on the page are not a failure, so the summary
     * says so in its own sentence instead of counting them against the add.
     */
    let skippedDescription: string = "";

    if (result.skipped.length === 1) {
      skippedDescription =
        " 1 monitor was already on this status page and was skipped.";
    } else if (result.skipped.length > 1) {
      skippedDescription = ` ${result.skipped.length} monitors were already on this status page and were skipped.`;
    }

    return (
      <Modal
        title={
          result.failed.length > 0 ? "Monitor Add Results" : "Monitors Added"
        }
        description={`Added ${result.succeeded.length} of ${totalCount} selected monitors.${skippedDescription}`}
        closeButtonText="Done"
        closeButtonStyleType={ButtonStyleType.PRIMARY}
        onClose={props.onClose}
      >
        <div className="space-y-4">
          {result.monitorRule && !result.monitorRuleError ? (
            <div className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
              This group now stays in sync with the labels you used. Monitors
              given one of those labels later are added here automatically.
            </div>
          ) : null}

          {result.monitorRuleError ? (
            <div className="rounded-md bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
              <span className="font-medium">
                The monitors were added, but this group could not be kept in
                sync with the labels you used:
              </span>{" "}
              {API.getFriendlyMessage(result.monitorRuleError)}
            </div>
          ) : null}

          {result.succeeded.length > 0 ? (
            <div>
              <h4 className="text-sm font-semibold text-green-800">
                Added ({result.succeeded.length})
              </h4>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700">
                {result.succeeded.map((monitor: Monitor) => {
                  return (
                    <li key={monitor._id || monitor.name}>{monitor.name}</li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {result.skipped.length > 0 ? (
            <div>
              <h4 className="text-sm font-semibold text-gray-800">
                Already Added ({result.skipped.length})
              </h4>
              <p className="mt-1 text-sm text-gray-500">
                These monitors are already on this status page, so they were
                left as they are.
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700">
                {result.skipped.map((monitor: Monitor) => {
                  return (
                    <li key={monitor._id || monitor.name}>{monitor.name}</li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {result.failed.length > 0 ? (
            <div>
              <h4 className="text-sm font-semibold text-red-800">
                Failed ({result.failed.length})
              </h4>
              <ul className="mt-2 space-y-2 text-sm text-gray-700">
                {result.failed.map(
                  (failure: BulkAddStatusPageMonitorFailure, index: number) => {
                    return (
                      <li
                        key={`${failure.monitor._id || failure.monitor.name}-${index}`}
                        className="rounded-md bg-red-50 px-3 py-2"
                      >
                        <span className="font-medium">
                          {failure.monitor.name || "Unknown monitor"}:
                        </span>{" "}
                        {getFailureMessage(failure)}
                      </li>
                    );
                  },
                )}
              </ul>
            </div>
          ) : null}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Add Multiple Monitors"
      description="Add monitors to this status page. Each resource gets its display name and description from its monitor."
      modalWidth={ModalWidth.Medium}
      submitButtonText={submitButtonText}
      submitButtonType={ButtonType.Submit}
      onClose={props.onClose}
      onSubmit={() => {
        formRef.current?.submitForm();
      }}
      isLoading={isLoading}
      disableSubmitButton={isLoading}
      error={error}
    >
      <BasicForm
        ref={formRef}
        id="bulk-add-status-page-monitors"
        name="Status Page > Add Multiple Monitors"
        hideSubmitButton={true}
        fields={getFields()}
        steps={FORM_STEPS}
        onIsLastFormStep={(isLastFormStep: boolean) => {
          setSubmitButtonText(isLastFormStep ? "Add Monitors" : "Next");
        }}
        onSubmit={(values: FormValues<BulkAddStatusPageMonitorsFormValues>) => {
          onSubmit(values).catch((err: Error) => {
            setError(API.getFriendlyMessage(err));
            setIsLoading(false);
          });
        }}
      />
    </Modal>
  );
};

export default BulkAddStatusPageMonitorsModal;
