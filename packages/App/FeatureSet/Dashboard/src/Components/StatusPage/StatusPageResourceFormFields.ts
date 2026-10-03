import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorGroup from "Common/Models/DatabaseModels/MonitorGroup";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import UptimePrecision from "Common/Types/StatusPage/UptimePrecision";
import {
  DropdownChange,
  getPickedLabel,
} from "Common/UI/Components/Dropdown/DropdownChange";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import MarkdownUtil from "Common/UI/Utils/Markdown";
import type { ReactElement } from "react";

/*
 * The form that puts a monitor on a status page: Status Page > Resources >
 * Add Monitor, and the same form to edit one.
 *
 * It asks only for the monitor. The name visitors read is filled in from
 * the monitor's own name as it is picked (getDisplayNameAfterPick), and
 * everything else - a description, a tooltip, and what is shown beside the
 * monitor - has a default and is folded under Advanced, which an Edit form
 * shows folded too, saying "Configured" when something in it is set.
 *
 * The bulk add (BulkAddStatusPageMonitorsModal) folds the same display
 * options from here, so the two never drift apart.
 */

/*
 * Where a form keeps the display name it filled in itself, so it can tell
 * that name from one somebody typed: a display name equal to it is still the
 * form's own, and follows the next pick. Not a column of the resource -
 * ModelForm sends only its fields' columns - and gone with the dialog.
 */
export const FILLED_IN_DISPLAY_NAME_KEY: string = "filledInDisplayName";

export type GetDisplayNameAfterPickFunction = (data: {
  // The display name the form holds now.
  displayName: unknown;
  // The display name the form filled in last, if any.
  filledInDisplayName: unknown;
  // What the pick changed, as the monitor (or monitor group) list showed it.
  change: DropdownChange | undefined;
}) => string | null;

/**
 * The display name once a monitor (or monitor group) is picked: the name of
 * what was picked, while the display name is still the form's own - empty,
 * the name the form filled in, or the name of what was picked before (an
 * Edit form whose display name was never changed from its monitor's). Null
 * when it stays as it is: somebody typed a name of their own, the pick was
 * cleared, or the list could not say what was picked.
 */
export const getDisplayNameAfterPick: GetDisplayNameAfterPickFunction =
  (data: {
    displayName: unknown;
    filledInDisplayName: unknown;
    change: DropdownChange | undefined;
  }): string | null => {
    const pickedName: string | null = getPickedLabel(
      data.change?.selectedOptions,
    );

    if (pickedName === null) {
      return null;
    }

    const displayName: string =
      typeof data.displayName === "string" ? data.displayName : "";

    const filledInDisplayName: string | null =
      typeof data.filledInDisplayName === "string"
        ? data.filledInDisplayName
        : null;

    const previousName: string | null = getPickedLabel(
      data.change?.previousOptions,
    );

    const isTheFormsOwn: boolean =
      displayName.trim().length === 0 ||
      displayName === filledInDisplayName ||
      displayName === previousName;

    if (!isTheFormsOwn) {
      return null;
    }

    return pickedName;
  };

type FollowPickFunction = (
  value: unknown,
  currentValues: FormValues<StatusPageResource>,
  setNewFormValues: (values: FormValues<StatusPageResource>) => void,
  change?: DropdownChange | undefined,
) => void;

/*
 * The monitor (or monitor group) picker's onChange: the display name
 * follows the pick until somebody types a name of their own - the rule a
 * monitor's criteria names follow (CriteriaNameUtil).
 */
export const followPickWithDisplayName: FollowPickFunction = (
  _value: unknown,
  currentValues: FormValues<StatusPageResource>,
  setNewFormValues: (values: FormValues<StatusPageResource>) => void,
  change?: DropdownChange | undefined,
): void => {
  const values: Record<string, unknown> = (currentValues || {}) as Record<
    string,
    unknown
  >;

  const displayName: string | null = getDisplayNameAfterPick({
    displayName: values["displayName"],
    filledInDisplayName: values[FILLED_IN_DISPLAY_NAME_KEY],
    change: change,
  });

  if (displayName === null) {
    return;
  }

  setNewFormValues({
    ...values,
    displayName: displayName,
    [FILLED_IN_DISPLAY_NAME_KEY]: displayName,
  } as FormValues<StatusPageResource>);
};

/**
 * What is shown beside a resource on the status page, and its tooltip:
 * options that apply however the resource was added - one at a time from
 * the resource form, or in bulk from the "Add Multiple Monitors" dialog.
 * Both fold them into the Advanced section they are handed, so a resource
 * is added with nothing more than its monitor, and the defaults are the
 * resource's own column defaults.
 */
export const getStatusPageResourceAdvancedFields: (
  advancedSection: FormFieldCollapsibleSection<StatusPageResource>,
) => Array<ModelField<StatusPageResource>> = (
  advancedSection: FormFieldCollapsibleSection<StatusPageResource>,
): Array<ModelField<StatusPageResource>> => {
  return [
    {
      field: {
        displayTooltip: true,
      },
      title: "Tooltip",
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      description:
        "This will show up as tooltip beside the resource on your status page.",
      placeholder: "Tooltip",
      collapsibleSection: advancedSection,
    },
    {
      field: {
        showCurrentStatus: true,
      },
      title: "Show Current Resource Status",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      defaultValue: true,
      description:
        "Current Resource Status will be shown beside this resource on your status page.",
      collapsibleSection: advancedSection,
    },
    {
      field: {
        showUptimePercent: true,
      },
      title: "Show Uptime %",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      defaultValue: false,
      description:
        "Show uptime percentage beside this resource on your status page. The number of days is configured in Status Page Settings.",
      collapsibleSection: advancedSection,
    },
    {
      field: {
        uptimePercentPrecision: true,
      },
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(UptimePrecision),
      showIf: (item: FormValues<StatusPageResource>): boolean => {
        return Boolean(item.showUptimePercent);
      },
      title: "Select Uptime Precision",
      defaultValue: UptimePrecision.ONE_DECIMAL,
      required: true,
      collapsibleSection: advancedSection,
    },
    {
      field: {
        showStatusHistoryChart: true,
      },
      title: "Show Status History Chart",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      description:
        "Show resource status history chart. The number of days is configured in Status Page Settings.",
      defaultValue: true,
      collapsibleSection: advancedSection,
    },
  ];
};

export interface StatusPageResourceFormFieldsOptions {
  // Put a monitor group on the page rather than a monitor.
  addMonitorGroup: boolean;
  /*
   * Drawn under the picker: on projects with monitor groups, the link that
   * swaps the monitor picker for the monitor group one.
   */
  targetFooterElement?: ReactElement | undefined;
}

/**
 * The resource form: the monitor (or monitor group), its display name -
 * filled in from the pick - and an Advanced section holding the rest.
 * A grid group adds the cell the resource goes in
 * (insertBeforeFoldedFields).
 */
export const getStatusPageResourceFormFields: (
  options: StatusPageResourceFormFieldsOptions,
) => Array<ModelField<StatusPageResource>> = (
  options: StatusPageResourceFormFieldsOptions,
): Array<ModelField<StatusPageResource>> => {
  const advancedSection: FormFieldCollapsibleSection<StatusPageResource> =
    getAdvancedFormSection<StatusPageResource>();

  const targetField: ModelField<StatusPageResource> = options.addMonitorGroup
    ? {
        field: {
          monitorGroup: true,
        },
        title: "Monitor Group",
        description:
          "Select monitor group that will be shown on the status page.",
        fieldType: FormFieldSchemaType.Dropdown,
        dropdownModal: {
          type: MonitorGroup,
          labelField: "name",
          valueField: "_id",
        },
        required: true,
        placeholder: "Select Monitor Group",
        footerElement: options.targetFooterElement,
        onChange: followPickWithDisplayName,
      }
    : {
        field: {
          monitor: true,
        },
        title: "Monitor",
        description: "Select monitor that will be shown on the status page.",
        fieldType: FormFieldSchemaType.Dropdown,
        dropdownModal: {
          type: Monitor,
          labelField: "name",
          valueField: "_id",
        },
        required: true,
        placeholder: "Select Monitor",
        footerElement: options.targetFooterElement,
        onChange: followPickWithDisplayName,
      };

  return [
    targetField,
    {
      field: {
        displayName: true,
      },
      title: "Display Name",
      description:
        "The name visitors see on the status page. It follows what you pick above until you type a name of your own.",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "Display Name",
    },
    {
      field: {
        displayDescription: true,
      },
      title: "Description",
      fieldType: FormFieldSchemaType.Markdown,
      required: false,
      placeholder: "",
      description: MarkdownUtil.getMarkdownCheatsheet(
        "Describe this resource here",
      ),
      collapsibleSection: advancedSection,
    },
    ...getStatusPageResourceAdvancedFields(advancedSection),
  ];
};

export type InsertBeforeFoldedFieldsFunction = <
  TField extends { collapsibleSection?: unknown },
>(
  fields: Array<TField>,
  extraFields: Array<TField>,
) => Array<TField>;

/**
 * Fields a form has to show, put in before its folded section: a grid
 * group's row and column, which every resource in the group needs and which
 * must not end up behind the Advanced header (a folded section is the last
 * thing on a form).
 */
export const insertBeforeFoldedFields: InsertBeforeFoldedFieldsFunction = <
  TField extends { collapsibleSection?: unknown },
>(
  fields: Array<TField>,
  extraFields: Array<TField>,
): Array<TField> => {
  const firstFoldedIndex: number = fields.findIndex(
    (field: TField): boolean => {
      return Boolean(field.collapsibleSection);
    },
  );

  if (firstFoldedIndex === -1) {
    return [...fields, ...extraFields];
  }

  return [
    ...fields.slice(0, firstFoldedIndex),
    ...extraFields,
    ...fields.slice(firstFoldedIndex),
  ];
};

export default getStatusPageResourceFormFields;
