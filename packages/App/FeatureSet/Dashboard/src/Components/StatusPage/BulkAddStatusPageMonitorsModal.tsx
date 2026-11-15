import addStatusPageMonitorsWithLabelSync, {
  AddStatusPageMonitorsWithLabelSyncResult,
} from "./AddStatusPageMonitorsWithLabelSync";
import bulkAddStatusPageMonitorGroups, {
  BulkAddStatusPageMonitorGroupFailure,
  BulkAddStatusPageMonitorGroupsResult,
} from "./BulkAddStatusPageMonitorGroups";
import bulkAddStatusPageMonitors, {
  BulkAddStatusPageMonitorFailure,
} from "./BulkAddStatusPageMonitors";
import { BulkAddStatusPageResourceOptions } from "./BulkAddStatusPageResources";
import {
  getStatusPageResourceAdvancedFields,
  StatusPageResourceTargetType,
} from "./StatusPageResourceFormFields";
import StatusPageResourceTargetSwitch from "./StatusPageResourceTargetSwitch";
import { gridAxisNameInSentence } from "./StatusPageResourcePanelText";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorGroup from "Common/Models/DatabaseModels/MonitorGroup";
import StatusPageMonitorRule from "Common/Models/DatabaseModels/StatusPageMonitorRule";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import UptimePrecision from "Common/Types/StatusPage/UptimePrecision";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  PluralTemplate,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import ButtonType from "Common/UI/Components/Button/ButtonTypes";
import BasicForm from "Common/UI/Components/Forms/BasicForm";
import Field, {
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
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

/*
 * What a bulk add reports when it is done: monitors (with the rule that keeps
 * a group in sync with labels, when one was asked for), or monitor groups.
 */
export type BulkAddStatusPageResult =
  | AddStatusPageMonitorsWithLabelSyncResult
  | BulkAddStatusPageMonitorGroupsResult;

export interface ComponentProps {
  projectId: ObjectID;
  statusPageId: ObjectID;
  statusPageGroupId?: ObjectID | undefined;
  gridPlacement?: GridPlacementOptions | undefined;
  /*
   * The picker the dialog opens on: monitors (Add Multiple Monitors, the
   * default) or monitor groups (Add Multiple Monitor Groups, issue #6544).
   */
  targetType?: StatusPageResourceTargetType | undefined;
  /*
   * On projects with monitor groups: a link under the picker swaps it for
   * the other one, as the link under Add Monitor's does.
   */
  canSwitchTarget?: boolean | undefined;
  onClose: () => void;
  onComplete: (result: BulkAddStatusPageResult) => void;
}

/**
 * Mirrors the single resource form, except the picker is multi-select and
 * display name / description are not asked for - they are copied from each
 * monitor (or monitor group). Every other option applies to all of the
 * resources created here, and is folded under Advanced at its default, as on
 * the single form.
 */
export interface BulkAddStatusPageMonitorsFormValues {
  monitors?: Array<ObjectID | string> | undefined;
  monitorGroups?: Array<ObjectID | string> | undefined;
  keepInSyncWithLabels?: boolean | undefined;
  rowAxisValue?: string | undefined;
  columnAxisValue?: string | undefined;
  displayTooltip?: string | undefined;
  showCurrentStatus?: boolean | undefined;
  showUptimePercent?: boolean | undefined;
  uptimePercentPrecision?: UptimePrecision | undefined;
  showStatusHistoryChart?: boolean | undefined;
}

/*
 * The display options, folded: they are the resource's own defaults, so the
 * monitors (or monitor groups) are all this dialog asks for. Built once, for
 * the field list's every render to hand the same section to its fields.
 */
const ADVANCED_SECTION: FormFieldCollapsibleSection<StatusPageResource> =
  getAdvancedFormSection<StatusPageResource>();

/*
 * The words of the dialog and of its summary, for monitors and for monitor
 * groups. Every one is a whole sentence or label, looked up as it is - never
 * a noun dropped into a shared sentence, which a language that inflects the
 * noun, or puts it elsewhere, could not word.
 */
interface BulkAddCopy {
  resultTitle: string;
  resultWithFailuresTitle: string;
  addedOfSelected: PluralTemplate;
  skippedSentence: PluralTemplate;
  skippedExplanation: string;
  unknownName: string;
}

const MONITOR_COPY: BulkAddCopy = {
  resultTitle: translationKey("Monitors Added"),
  resultWithFailuresTitle: translationKey("Monitor Add Results"),
  addedOfSelected: {
    one: "Added {{added}} of {{count}} selected monitor.",
    other: "Added {{added}} of {{count}} selected monitors.",
  },
  skippedSentence: {
    one: "{{count}} monitor was already on this status page and was skipped.",
    other:
      "{{count}} monitors were already on this status page and were skipped.",
  },
  skippedExplanation: translationKey(
    "These monitors are already on this status page, so they were left as they are.",
  ),
  unknownName: translationKey("Unknown monitor"),
};

const MONITOR_GROUP_COPY: BulkAddCopy = {
  resultTitle: translationKey("Monitor Groups Added"),
  resultWithFailuresTitle: translationKey("Monitor Group Add Results"),
  addedOfSelected: {
    one: "Added {{added}} of {{count}} selected monitor group.",
    other: "Added {{added}} of {{count}} selected monitor groups.",
  },
  skippedSentence: {
    one: "{{count}} monitor group was already on this status page and was skipped.",
    other:
      "{{count}} monitor groups were already on this status page and were skipped.",
  },
  skippedExplanation: translationKey(
    "These monitor groups are already on this status page, so they were left as they are.",
  ),
  unknownName: translationKey("Unknown monitor group"),
};

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

type InPickedOrderFunction = <TTarget extends { _id?: string | undefined }>(
  ids: Array<ObjectID>,
  targets: Array<TTarget>,
) => Array<TTarget>;

// Create resources in the order the monitors (or monitor groups) were picked.
const inPickedOrder: InPickedOrderFunction = <
  TTarget extends { _id?: string | undefined },
>(
  ids: Array<ObjectID>,
  targets: Array<TTarget>,
): Array<TTarget> => {
  const targetsById: Map<string, TTarget> = new Map<string, TTarget>();

  for (const target of targets) {
    if (target._id) {
      targetsById.set(target._id.toString(), target);
    }
  }

  return ids
    .map((id: ObjectID) => {
      return targetsById.get(id.toString());
    })
    .filter((target: TTarget | undefined): target is TTarget => {
      return Boolean(target);
    });
};

// One row of the summary: something added, skipped, or that failed.
interface SummaryEntry {
  key: string;
  name: string | undefined;
  error?: unknown;
}

interface BulkAddSummary {
  succeeded: Array<SummaryEntry>;
  skipped: Array<SummaryEntry>;
  failed: Array<SummaryEntry>;
  // Monitors only: the rule that keeps the group in sync with labels.
  monitorRule: StatusPageMonitorRule | null;
  monitorRuleError: unknown | null;
}

type ToEntryFunction = (
  target: { _id?: string | undefined; name?: string | undefined },
  index: number,
  error?: unknown,
) => SummaryEntry;

const toEntry: ToEntryFunction = (
  target: { _id?: string | undefined; name?: string | undefined },
  index: number,
  error?: unknown,
): SummaryEntry => {
  return {
    key: `${target._id || target.name || "unknown"}-${index}`,
    name: target.name,
    error: error,
  };
};

type ToSummaryFunction = (result: BulkAddStatusPageResult) => BulkAddSummary;

const toSummary: ToSummaryFunction = (
  result: BulkAddStatusPageResult,
): BulkAddSummary => {
  const isMonitorResult: boolean = "monitorRule" in result;

  return {
    succeeded: result.succeeded.map(
      (target: Monitor | MonitorGroup, index: number) => {
        return toEntry(target, index);
      },
    ),
    skipped: result.skipped.map(
      (target: Monitor | MonitorGroup, index: number) => {
        return toEntry(target, index);
      },
    ),
    failed: isMonitorResult
      ? (result as AddStatusPageMonitorsWithLabelSyncResult).failed.map(
          (failure: BulkAddStatusPageMonitorFailure, index: number) => {
            return toEntry(failure.monitor, index, failure.error);
          },
        )
      : (result as BulkAddStatusPageMonitorGroupsResult).failed.map(
          (failure: BulkAddStatusPageMonitorGroupFailure, index: number) => {
            return toEntry(failure.monitorGroup, index, failure.error);
          },
        ),
    monitorRule: isMonitorResult
      ? (result as AddStatusPageMonitorsWithLabelSyncResult).monitorRule
      : null,
    monitorRuleError: isMonitorResult
      ? (result as AddStatusPageMonitorsWithLabelSyncResult).monitorRuleError
      : null,
  };
};

/**
 * Status Page > Resources: Add Multiple Monitors, and Add Multiple Monitor
 * Groups (issue #6544) - one dialog, whose picker is the monitor one or the
 * monitor group one, as Add Monitor's is. Each resource it creates is named
 * and described as its monitor (or monitor group) is; one already on the page
 * is skipped. Adding by label keeps a group in sync with those labels for
 * monitors only: a monitor rule matches monitors, not monitor groups.
 */
const BulkAddStatusPageMonitorsModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [result, setResult] = useState<{
    targetType: StatusPageResourceTargetType;
    summary: BulkAddSummary;
  } | null>(null);

  /*
   * The picker on screen. It starts on the one the dialog was opened for and
   * the link under it swaps it; the other picker's selection is kept, and
   * read again only if the link swaps back. The ref is what submit reads (see
   * syncLabelsRef).
   */
  const [targetType, setTargetType] = useState<StatusPageResourceTargetType>(
    props.targetType || StatusPageResourceTargetType.Monitor,
  );
  const targetTypeRef: MutableRefObject<StatusPageResourceTargetType> =
    useRef<StatusPageResourceTargetType>(targetType);

  const isMonitorGroupPicker: boolean =
    targetType === StatusPageResourceTargetType.MonitorGroup;

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

  const formRef: MutableRefObject<any> = useRef<any>(null);

  const switchTarget: () => void = (): void => {
    const nextTargetType: StatusPageResourceTargetType =
      targetTypeRef.current === StatusPageResourceTargetType.MonitorGroup
        ? StatusPageResourceTargetType.Monitor
        : StatusPageResourceTargetType.MonitorGroup;

    targetTypeRef.current = nextTargetType;
    setTargetType(nextTargetType);
    setError("");
  };

  const getTargetField: () => Field<BulkAddStatusPageMonitorsFormValues> =
    (): Field<BulkAddStatusPageMonitorsFormValues> => {
      const footerElement: ReactElement | undefined = props.canSwitchTarget ? (
        <StatusPageResourceTargetSwitch
          targetType={targetType}
          isEditForm={false}
          isBulkAdd={true}
          onSwitch={switchTarget}
        />
      ) : undefined;

      /*
       * A monitor group's own picker. Its Labels tab still picks every
       * monitor group carrying a label, but only once: nothing keeps a group
       * in sync with them, so onLabelsBulkAdded is not handed in.
       */
      if (isMonitorGroupPicker) {
        return {
          field: {
            monitorGroups: true,
          },
          title: "Monitor Groups",
          description:
            "The monitor groups to show on the status page, with their names and descriptions. Ones already on the page are skipped.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: MonitorGroup,
            labelField: "name",
            valueField: "_id",
          },
          required: true,
          placeholder: "Select Monitor Groups",
          footerElement: footerElement,
        };
      }

      return {
        field: {
          monitors: true,
        },
        title: "Monitors",
        description:
          "The monitors to show on the status page, with their names and descriptions. Ones already on the page are skipped.",
        fieldType: FormFieldSchemaType.MultiSelectDropdown,
        dropdownModal: {
          type: Monitor,
          labelField: "name",
          valueField: "_id",
        },
        required: true,
        placeholder: "Select Monitors",
        footerElement: footerElement,
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
      };
    };

  const getFields: () => Array<
    Field<BulkAddStatusPageMonitorsFormValues>
  > = (): Array<Field<BulkAddStatusPageMonitorsFormValues>> => {
    const fields: Array<Field<BulkAddStatusPageMonitorsFormValues>> = [
      getTargetField(),
      /*
       * Declared unconditionally so the form seeds it with its default the one
       * time it builds initial values; showIf keeps it out of sight until the
       * user has actually bulk-added by label and the question means something.
       *
       * Never offered for a grid group: a rule cannot record the row and
       * column the user is being asked for two fields below, and a resource in
       * a grid group with neither is dropped by the public page. Promising
       * live sync there would promise monitors nobody can see. Nor on the
       * monitor group picker: a monitor rule adds monitors, not groups.
       */
      {
        field: {
          keepInSyncWithLabels: true,
        },
        title: "Keep This Group In Sync With These Labels",
        fieldType: FormFieldSchemaType.Toggle,
        required: false,
        defaultValue: true,
        description: "Also add monitors that get one of these labels later.",
        showIf: (): boolean => {
          return (
            syncLabels.length > 0 &&
            !props.gridPlacement &&
            !isMonitorGroupPicker
          );
        },
      },
    ];

    if (props.gridPlacement) {
      fields.push(
        {
          field: {
            rowAxisValue: true,
          },
          title: translator.translateTemplate("{{axis}} (Row)", {
            axis: props.gridPlacement.rowLabel,
          }),
          description: "Row these resources belong to in the grid.",
          fieldType: FormFieldSchemaType.Dropdown,
          dropdownOptions: props.gridPlacement.rowValues.map(
            (value: string) => {
              return { label: value, value: value };
            },
          ),
          required: true,
          placeholder: translator.translateTemplate("Select {{axis}}", {
            axis: gridAxisNameInSentence(props.gridPlacement.rowLabel),
          }),
          // Around the axis's own name, so worded here (#7682).
          isPlaceholderTranslated: true,
        },
        {
          field: {
            columnAxisValue: true,
          },
          title: translator.translateTemplate("{{axis}} (Column)", {
            axis: props.gridPlacement.columnLabel,
          }),
          description: "Column these resources belong to in the grid.",
          fieldType: FormFieldSchemaType.Dropdown,
          dropdownOptions: props.gridPlacement.columnValues.map(
            (value: string) => {
              return { label: value, value: value };
            },
          ),
          required: true,
          placeholder: translator.translateTemplate("Select {{axis}}", {
            axis: gridAxisNameInSentence(props.gridPlacement.columnLabel),
          }),
          // Around the axis's own name, so worded here (#7682).
          isPlaceholderTranslated: true,
        },
      );
    }

    /*
     * The advanced fields are declared against StatusPageResource because the
     * single resource form uses them too. Their field keys are the same ones
     * this form collects, so they render and validate identically here -
     * last, after the cell a grid group asks for, in one folded section.
     */
    return [
      ...fields,
      ...(getStatusPageResourceAdvancedFields(
        ADVANCED_SECTION,
      ) as unknown as Array<Field<BulkAddStatusPageMonitorsFormValues>>),
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

    return inPickedOrder<Monitor>(monitorIds, listResult.data);
  };

  type FetchMonitorGroupsFunction = (
    monitorGroupIds: Array<ObjectID>,
  ) => Promise<Array<MonitorGroup>>;

  // The same for monitor groups: each resource is named as its group is.
  const fetchMonitorGroups: FetchMonitorGroupsFunction = async (
    monitorGroupIds: Array<ObjectID>,
  ): Promise<Array<MonitorGroup>> => {
    const listResult: ListResult<MonitorGroup> =
      await ModelAPI.getList<MonitorGroup>({
        modelType: MonitorGroup,
        query: {
          _id: new Includes(monitorGroupIds),
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

    return inPickedOrder<MonitorGroup>(monitorGroupIds, listResult.data);
  };

  type FetchExistingTargetIdsFunction = (
    targetType: StatusPageResourceTargetType,
  ) => Promise<Array<string>>;

  /*
   * Which monitors (or monitor groups) this status page already lists.
   * Selecting by label hands back everything carrying the label - what is
   * already added included - so the add has to know what is already there or
   * it writes a second resource for each of them (issue #3420).
   *
   * Read across the whole status page rather than the group being added to: a
   * monitor listed in two groups is still a monitor a visitor sees twice, and
   * the server refuses that create for the same reason.
   */
  const fetchExistingTargetIds: FetchExistingTargetIdsFunction = async (
    forTargetType: StatusPageResourceTargetType,
  ): Promise<Array<string>> => {
    const isMonitorGroup: boolean =
      forTargetType === StatusPageResourceTargetType.MonitorGroup;

    const listResult: ListResult<StatusPageResource> =
      await ModelAPI.getList<StatusPageResource>({
        modelType: StatusPageResource,
        query: {
          statusPageId: props.statusPageId,
          projectId: props.projectId,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: isMonitorGroup
          ? {
              _id: true,
              monitorGroupId: true,
            }
          : {
              _id: true,
              monitorId: true,
            },
        sort: {},
        requestOptions: {},
      });

    return listResult.data
      .map((resource: StatusPageResource) => {
        const targetId: ObjectID | undefined = isMonitorGroup
          ? resource.monitorGroupId
          : resource.monitorId;

        return targetId?.toString() || "";
      })
      .filter((targetId: string) => {
        return targetId !== "";
      });
  };

  type GetResourceOptionsFunction = (
    values: FormValues<BulkAddStatusPageMonitorsFormValues>,
  ) => BulkAddStatusPageResourceOptions;

  const getResourceOptions: GetResourceOptionsFunction = (
    values: FormValues<BulkAddStatusPageMonitorsFormValues>,
  ): BulkAddStatusPageResourceOptions => {
    return {
      displayTooltip: (values.displayTooltip as string) || undefined,
      showCurrentStatus: Boolean(values.showCurrentStatus),
      showUptimePercent: Boolean(values.showUptimePercent),
      uptimePercentPrecision: values.showUptimePercent
        ? (values.uptimePercentPrecision as UptimePrecision)
        : undefined,
      showStatusHistoryChart: Boolean(values.showStatusHistoryChart),
    };
  };

  type AddFunction = (
    targetIds: Array<ObjectID>,
    values: FormValues<BulkAddStatusPageMonitorsFormValues>,
  ) => Promise<BulkAddStatusPageResult>;

  const addMonitors: AddFunction = async (
    monitorIds: Array<ObjectID>,
    values: FormValues<BulkAddStatusPageMonitorsFormValues>,
  ): Promise<BulkAddStatusPageResult> => {
    const [monitors, existingMonitorIds]: [Array<Monitor>, Array<string>] =
      await Promise.all([
        fetchMonitors(monitorIds),
        fetchExistingTargetIds(StatusPageResourceTargetType.Monitor),
      ]);

    return addStatusPageMonitorsWithLabelSync({
      monitors: monitors,
      projectId: props.projectId,
      statusPageId: props.statusPageId,
      statusPageGroupId: props.statusPageGroupId,
      existingMonitorIds: existingMonitorIds,
      rowAxisValue: (values.rowAxisValue as string) || undefined,
      columnAxisValue: (values.columnAxisValue as string) || undefined,
      resourceOptions: getResourceOptions(values),
      syncLabels: syncLabelsRef.current,
      keepInSyncWithLabels: Boolean(values.keepInSyncWithLabels),
      bulkAdd: bulkAddStatusPageMonitors,
      createMonitorRule: createMonitorRule,
    });
  };

  const addMonitorGroups: AddFunction = async (
    monitorGroupIds: Array<ObjectID>,
    values: FormValues<BulkAddStatusPageMonitorsFormValues>,
  ): Promise<BulkAddStatusPageResult> => {
    const [monitorGroups, existingMonitorGroupIds]: [
      Array<MonitorGroup>,
      Array<string>,
    ] = await Promise.all([
      fetchMonitorGroups(monitorGroupIds),
      fetchExistingTargetIds(StatusPageResourceTargetType.MonitorGroup),
    ]);

    return bulkAddStatusPageMonitorGroups({
      monitorGroups: monitorGroups,
      projectId: props.projectId,
      statusPageId: props.statusPageId,
      statusPageGroupId: props.statusPageGroupId,
      existingMonitorGroupIds: existingMonitorGroupIds,
      rowAxisValue: (values.rowAxisValue as string) || undefined,
      columnAxisValue: (values.columnAxisValue as string) || undefined,
      resourceOptions: getResourceOptions(values),
    });
  };

  type OnSubmitFunction = (
    values: FormValues<BulkAddStatusPageMonitorsFormValues>,
  ) => Promise<void>;

  const onSubmit: OnSubmitFunction = async (
    values: FormValues<BulkAddStatusPageMonitorsFormValues>,
  ): Promise<void> => {
    const submittedTargetType: StatusPageResourceTargetType =
      targetTypeRef.current;
    const isMonitorGroup: boolean =
      submittedTargetType === StatusPageResourceTargetType.MonitorGroup;

    // Only the picker on screen: the other one's selection stays behind.
    const targetIds: Array<ObjectID> = toObjectIds(
      isMonitorGroup ? values.monitorGroups : values.monitors,
    );

    if (targetIds.length === 0) {
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const bulkResult: BulkAddStatusPageResult = isMonitorGroup
        ? await addMonitorGroups(targetIds, values)
        : await addMonitors(targetIds, values);

      setResult({
        targetType: submittedTargetType,
        summary: toSummary(bulkResult),
      });
      props.onComplete(bulkResult);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  if (result) {
    const summary: BulkAddSummary = result.summary;
    const copy: BulkAddCopy =
      result.targetType === StatusPageResourceTargetType.MonitorGroup
        ? MONITOR_GROUP_COPY
        : MONITOR_COPY;

    const totalCount: number =
      summary.succeeded.length + summary.failed.length + summary.skipped.length;

    /*
     * What was already on the page is not a failure, so the summary says so
     * in its own sentence instead of counting it against the add.
     */
    const descriptionSentences: Array<string> = [
      translator.translatePlural(copy.addedOfSelected, totalCount, {
        added: translator.formatNumber(summary.succeeded.length),
      }),
    ];

    if (summary.skipped.length > 0) {
      descriptionSentences.push(
        translator.translatePlural(
          copy.skippedSentence,
          summary.skipped.length,
        ),
      );
    }

    return (
      <Modal
        title={
          summary.failed.length > 0
            ? copy.resultWithFailuresTitle
            : copy.resultTitle
        }
        description={descriptionSentences.join(" ")}
        closeButtonText="Done"
        onClose={props.onClose}
      >
        <div className="space-y-4">
          {summary.monitorRule && !summary.monitorRuleError ? (
            <div className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
              {translator.translateText(
                "This group now stays in sync with the labels you used. Monitors given one of those labels later are added here automatically.",
              )}
            </div>
          ) : null}

          {summary.monitorRuleError ? (
            <div className="rounded-md bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
              <span className="font-medium">
                {translator.translateText(
                  "The monitors were added, but this group could not be kept in sync with the labels you used:",
                )}
              </span>{" "}
              {API.getFriendlyMessage(summary.monitorRuleError)}
            </div>
          ) : null}

          {summary.succeeded.length > 0 ? (
            <div data-testid="bulk-add-result-added">
              <h4 className="text-sm font-semibold text-green-800">
                {translator.translateText("Added")} (
                {translator.formatNumber(summary.succeeded.length)})
              </h4>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700">
                {summary.succeeded.map((entry: SummaryEntry) => {
                  return <li key={entry.key}>{entry.name}</li>;
                })}
              </ul>
            </div>
          ) : null}

          {summary.skipped.length > 0 ? (
            <div data-testid="bulk-add-result-skipped">
              <h4 className="text-sm font-semibold text-gray-800">
                {translator.translateText("Already Added")} (
                {translator.formatNumber(summary.skipped.length)})
              </h4>
              <p className="mt-1 text-sm text-gray-500">
                {translator.translateText(copy.skippedExplanation)}
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700">
                {summary.skipped.map((entry: SummaryEntry) => {
                  return <li key={entry.key}>{entry.name}</li>;
                })}
              </ul>
            </div>
          ) : null}

          {summary.failed.length > 0 ? (
            <div data-testid="bulk-add-result-failed">
              <h4 className="text-sm font-semibold text-red-800">
                {translator.translateText("Failed")} (
                {translator.formatNumber(summary.failed.length)})
              </h4>
              <ul className="mt-2 space-y-2 text-sm text-gray-700">
                {summary.failed.map((entry: SummaryEntry) => {
                  return (
                    <li
                      key={entry.key}
                      className="rounded-md bg-red-50 px-3 py-2"
                    >
                      <span className="font-medium">
                        {entry.name ||
                          translator.translateText(copy.unknownName)}
                        :
                      </span>{" "}
                      {API.getFriendlyMessage(entry.error)}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={
        isMonitorGroupPicker
          ? "Add Multiple Monitor Groups"
          : "Add Multiple Monitors"
      }
      description={
        isMonitorGroupPicker
          ? "Add monitor groups to this status page. Each resource gets its display name and description from its monitor group."
          : "Add monitors to this status page. Each resource gets its display name and description from its monitor."
      }
      modalWidth={ModalWidth.Medium}
      submitButtonText={
        isMonitorGroupPicker ? "Add Monitor Groups" : "Add Monitors"
      }
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
