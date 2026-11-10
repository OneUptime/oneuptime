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
import { getNameAfterPick } from "Common/UI/Components/Forms/Utils/FollowPickName";
import DropdownUtil from "Common/UI/Utils/Dropdown";
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
 * What a resource shows: one monitor, or one monitor group - never both
 * (StatusPageResourceService refuses a write that names both, and pointing
 * a resource at one clears the other).
 */
export enum StatusPageResourceTargetType {
  Monitor = "Monitor",
  MonitorGroup = "MonitorGroup",
}

export type GetStatusPageResourceTargetTypeFunction = (
  statusPageResource: StatusPageResource,
) => StatusPageResourceTargetType;

/**
 * The picker an Edit form opens on: the one for what the resource shows, so
 * a resource that shows a monitor group opens with that group picked (issue
 * #6540: every Edit opened the monitor picker, which a monitor group's row
 * left empty). A resource that names a monitor shows the monitor - as its
 * row in the list and the status page do, should one still name a group
 * too - and one that names neither opens on the monitor picker, the one
 * most resources use.
 */
export const getStatusPageResourceTargetType: GetStatusPageResourceTargetTypeFunction =
  (statusPageResource: StatusPageResource): StatusPageResourceTargetType => {
    if (statusPageResource.monitorId || statusPageResource.monitor?._id) {
      return StatusPageResourceTargetType.Monitor;
    }

    if (
      statusPageResource.monitorGroupId ||
      statusPageResource.monitorGroup?._id
    ) {
      return StatusPageResourceTargetType.MonitorGroup;
    }

    return StatusPageResourceTargetType.Monitor;
  };

export type GetStatusPageResourceTargetNameFunction = (
  statusPageResource: StatusPageResource,
) => string | undefined;

/**
 * The name of what the resource shows - its monitor's, or its monitor
 * group's - as its row in the list read it. Undefined when the row did not
 * carry the name.
 */
export const getStatusPageResourceTargetName: GetStatusPageResourceTargetNameFunction =
  (statusPageResource: StatusPageResource): string | undefined => {
    const name: string | undefined =
      getStatusPageResourceTargetType(statusPageResource) ===
      StatusPageResourceTargetType.MonitorGroup
        ? statusPageResource.monitorGroup?.name
        : statusPageResource.monitor?.name;

    return name || undefined;
  };

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
  /*
   * An Edit form's: the name of what the resource showed when the form
   * opened. A display name still equal to it was never changed from it,
   * and follows a pick - from the other picker too, which held nothing
   * before.
   */
  savedTargetName?: string | undefined;
}) => string | null;

/**
 * The display name once a monitor (or monitor group) is picked: the name of
 * what was picked, while the display name is still the form's own - empty,
 * the name the form filled in, or the name of what was picked before (an
 * Edit form whose display name was never changed from its monitor's or
 * monitor group's). Null when it stays as it is: somebody typed a name of
 * their own, the pick was cleared, or the list could not say what was
 * picked. The rule is shared with every name a form fills in from a pick
 * (Forms/Utils/FollowPickName).
 */
export const getDisplayNameAfterPick: GetDisplayNameAfterPickFunction = (data: {
  displayName: unknown;
  filledInDisplayName: unknown;
  change: DropdownChange | undefined;
  savedTargetName?: string | undefined;
}): string | null => {
  return getNameAfterPick({
    name: data.displayName,
    pickedName: getPickedLabel(data.change?.selectedOptions),
    filledInNames: [
      data.filledInDisplayName,
      getPickedLabel(data.change?.previousOptions),
      data.savedTargetName,
    ],
  });
};

type FollowPickFunction = (
  value: unknown,
  currentValues: FormValues<StatusPageResource>,
  setNewFormValues: (values: FormValues<StatusPageResource>) => void,
  change?: DropdownChange | undefined,
) => void;

export type GetFollowPickWithDisplayNameFunction = (
  savedTargetName?: string | undefined,
) => FollowPickFunction;

/*
 * The monitor (or monitor group) picker's onChange: the display name
 * follows the pick until somebody types a name of their own - the rule a
 * monitor's criteria names follow (CriteriaNameUtil). An Edit form hands
 * in the name of what the resource showed (getDisplayNameAfterPick).
 */
export const getFollowPickWithDisplayName: GetFollowPickWithDisplayNameFunction =
  (savedTargetName?: string | undefined): FollowPickFunction => {
    return (
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
        savedTargetName: savedTargetName,
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
  };

// The Add form's: there is no resource yet, so no name it showed.
export const followPickWithDisplayName: FollowPickFunction =
  getFollowPickWithDisplayName(undefined);

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
      description: "Shown in a tooltip beside the resource on the status page.",
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
      description: "Shows its current status, such as Operational, beside it.",
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
      /*
       * The days are set under Uptime History on Advanced Settings: there
       * is no page called Status Page Settings, which is what it said.
       */
      description:
        "Shows its uptime beside it, over the days set under Uptime History on Advanced Settings.",
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
        "A bar for each day, over the days set under Uptime History on Advanced Settings.",
      defaultValue: true,
      collapsibleSection: advancedSection,
    },
  ];
};

export interface StatusPageResourceFormFieldsOptions {
  /*
   * The picker the form shows: the monitor one, or the monitor group one.
   * An Add form's is the page's choice; an Edit form's starts on what the
   * resource shows (getStatusPageResourceTargetType).
   */
  targetType: StatusPageResourceTargetType;
  /*
   * Drawn under the picker: on projects with monitor groups, the link that
   * swaps the monitor picker for the monitor group one.
   */
  targetFooterElement?: ReactElement | undefined;
  /*
   * An Edit form's: the name of what the resource showed when it opened
   * (getStatusPageResourceTargetName), so a display name never changed
   * from it follows the next pick, from either picker.
   */
  savedTargetName?: string | undefined;
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

  const followPick: FollowPickFunction = options.savedTargetName
    ? getFollowPickWithDisplayName(options.savedTargetName)
    : followPickWithDisplayName;

  const targetField: ModelField<StatusPageResource> =
    options.targetType === StatusPageResourceTargetType.MonitorGroup
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
          onChange: followPick,
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
          onChange: followPick,
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
      description: "Describe this resource here.",
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
