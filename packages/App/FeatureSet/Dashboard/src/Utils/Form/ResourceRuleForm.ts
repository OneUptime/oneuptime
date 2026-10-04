import Label from "Common/Models/DatabaseModels/Label";
import ColumnLength from "Common/Types/Database/ColumnLength";
import type { DropdownChange } from "Common/UI/Components/Dropdown/DropdownChange";
import type { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import type Field from "Common/UI/Components/Forms/Types/Field";
import type { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import type { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import type FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { getNameAfterPick } from "Common/UI/Components/Forms/Utils/FollowPickName";
import getOwnersFormField, {
  OWNER_RULE_OWNERS_DESCRIPTION,
} from "Common/UI/Components/PeoplePicker/OwnersFormField";
import type SelectFormFields from "Common/UI/Types/SelectEntityField";
import {
  PluralTemplate,
  translatePlural,
  translateTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * CREATE A LABEL RULE OR AN OWNER RULE: WHAT IT MATCHES, THEN WHAT IT ADDS.
 *
 * Every resource product has a Label Rules and an Owner Rules page under its
 * Settings - Hosts, Kubernetes, Docker, Docker Swarm, Podman, Proxmox,
 * VMware, Ceph, Cloud, Serverless, Databases, Queues, IoT, Network Devices,
 * RUM, Services, Dashboards, On-Call, Runbooks, SLOs and Workflows. Each page
 * used to write out the same three-step form by hand: "Basic Info" first,
 * asking for a name before anyone had said what the rule was for (and, on
 * an owner rule, whether to notify owners, two steps away from the owners),
 * then "Match Criteria", and only on the third step what the rule does -
 * with "Labels to Add" and "Owners" optional, so a rule that adds nothing
 * could be saved.
 *
 * Each page now hands over only what is its own - the fields its rule
 * matches on - and takes the rest from here, so all of them ask the same
 * questions in the same order:
 *
 *   - Match (step id "match-criteria"): the page's criteria fields, drawn as
 *     one conditions builder (Common/UI/Components/RuleCriteria). A rule with
 *     no conditions applies to everything, as before.
 *   - Labels, or Owners: what the rule adds - required - then the rule's
 *     Name, filled in from what was picked ("Add production, eu-west",
 *     "Add Platform as owners") and following the picks until somebody types
 *     a name of their own (Forms/Utils/FollowPickName, the rule every such
 *     name follows). The Description - and on an owner rule, Notify Owners,
 *     on as the server starts it - fold under More fields, whose header says
 *     what is set. An Edit form adds the rule's Enabled switch here; a new
 *     rule starts on (RuleEnabledField).
 *
 * How a page uses it (the step ids are written out on the page's own
 * criteria fields, so the form scanner of the guards can place them):
 *
 *   <LabelRuleTable<HostLabelRule>
 *     formSteps={getLabelRuleFormSteps<HostLabelRule>()}
 *     formFields={[
 *       { field: { hostLabels: true }, stepId: "match-criteria", ... },
 *       { field: { hostNamePattern: true }, stepId: "match-criteria", ... },
 *       ...getLabelRuleActionFields<HostLabelRule>(),
 *     ]}
 *
 *   <RuleTable<HostOwnerRule>
 *     formSteps={getOwnerRuleFormSteps<HostOwnerRule>()}
 *     formFields={[...criteria, ...getOwnerRuleActionFields<HostOwnerRule>()]}
 *
 * Common/Tests/UI/Components/Forms/ResourceRuleFormsGuard.test.ts holds every
 * label and owner rule page to this. The incident, alert, scheduled
 * maintenance, monitor and status page rules keep forms of their own for now
 * (the first three ask which resources' labels or owners to inherit as
 * well); the guard lists them, and the same helpers apply when they move.
 *
 * The name is filled in in the creator's language, as data: a rule named in
 * German follows its picks for a German editor, and keeps its name for an
 * English one, who reads it as a name somebody gave it.
 */

// The step ModelForm draws as one conditions builder (RuleCriteriaModelForm).
export const RULE_MATCH_STEP_ID: string = "match-criteria";
export const LABEL_RULE_ACTION_STEP_ID: string = "labels";
export const OWNER_RULE_ACTION_STEP_ID: string = "owners";

/*
 * The longest name a rule can be saved with: every label and owner rule
 * keeps its name in a ShortText column.
 */
export const RULE_NAME_MAX_LENGTH: number = ColumnLength.ShortText;

/*
 * Where the form keeps the name it filled in itself, so it can tell that
 * name from one somebody typed: a name equal to it is still the form's own,
 * and follows the next pick. Not a column of any rule - ModelForm sends only
 * its fields' columns - and gone with the dialog.
 */
export const FILLED_IN_RULE_NAME_KEY: string = "filledInRuleName";

export const LABEL_RULE_LABELS_DESCRIPTION: string = translationKey(
  "When this rule matches, these labels are attached. Labels already attached are not added twice.",
);

export const LABEL_RULE_NAME_DESCRIPTION: string = translationKey(
  "Named after the labels it adds until you type a name of your own.",
);

export const OWNER_RULE_NAME_DESCRIPTION: string = translationKey(
  "Named after the owners it adds until you type a name of your own.",
);

export const RULE_ENABLED_DESCRIPTION: string = translationKey(
  "Enable or disable this rule.",
);

export const OWNER_RULE_NOTIFY_OWNERS_DESCRIPTION: string = translationKey(
  "Notify owners when they are added by this rule. Disable to add silently.",
);

/*
 * How a rule is named after what it adds: one sentence while every pick
 * fits, another that counts the picks left out. Whole sentences, so a
 * language puts the names and the count where its grammar wants them.
 */
export interface RuleNameWording {
  /*
   * The {{slot}} the picks go in, as a list: "labels", "owners". An
   * identifier, not copy.
   */
  picksSlot: string;
  // Every pick named: "Add {{labels}}".
  allPicks: string;
  // Some picks named, and how many more there are.
  somePicks: PluralTemplate;
}

export const LABEL_RULE_NAME_WORDING: RuleNameWording = {
  picksSlot: "labels",
  allPicks: translationKey("Add {{labels}}"),
  somePicks: {
    one: "Add {{labels}} and {{count}} more",
    other: "Add {{labels}} and {{count}} more",
  },
};

export const OWNER_RULE_NAME_WORDING: RuleNameWording = {
  picksSlot: "owners",
  allPicks: translationKey("Add {{owners}} as owners"),
  somePicks: {
    one: "Add {{owners}} and {{count}} more as owners",
    other: "Add {{owners}} and {{count}} more as owners",
  },
};

// Between two picks in a rule's name: a list people can read in any language.
export const RULE_NAME_PICK_SEPARATOR: string = ", ";

const ELLIPSIS: string = "…";

type FillWordingFunction = (
  wording: RuleNameWording,
  list: string,
  leftOut: number,
) => string;

const fillWording: FillWordingFunction = (
  wording: RuleNameWording,
  list: string,
  leftOut: number,
): string => {
  if (leftOut === 0) {
    return translateTemplate(wording.allPicks, {
      [wording.picksSlot]: list,
    });
  }

  return translatePlural(wording.somePicks, leftOut, {
    [wording.picksSlot]: list,
  });
};

/**
 * The name a rule gets after what it adds, in the reader's language, or ""
 * when nothing is picked. As many picks as fit are named, in the order they
 * were picked, and the rest counted ("Add production, eu-west and 3 more");
 * a pick too long to fit on its own is shortened. The name always fits the
 * rule's Name column.
 */
export const getRuleNameFromPicks: (
  wording: RuleNameWording,
  pickedNames: Array<string>,
) => string = (
  wording: RuleNameWording,
  pickedNames: Array<string>,
): string => {
  const names: Array<string> = [];

  for (const pickedName of pickedNames) {
    const name: string = (pickedName || "").trim();

    if (name && !names.includes(name)) {
      names.push(name);
    }
  }

  if (names.length === 0) {
    return "";
  }

  for (let shown: number = names.length; shown >= 1; shown--) {
    const ruleName: string = fillWording(
      wording,
      names.slice(0, shown).join(RULE_NAME_PICK_SEPARATOR),
      names.length - shown,
    );

    if (ruleName.length <= RULE_NAME_MAX_LENGTH) {
      return ruleName;
    }
  }

  // Not even the first pick fits: it is shortened to the room there is.
  const leftOut: number = names.length - 1;
  const room: number =
    RULE_NAME_MAX_LENGTH -
    fillWording(wording, "", leftOut).length -
    ELLIPSIS.length;
  const shortened: string =
    names[0]!.slice(0, Math.max(room, 1)).trimEnd() + ELLIPSIS;

  return fillWording(wording, shortened, leftOut).slice(
    0,
    RULE_NAME_MAX_LENGTH,
  );
};

// "Add production, eu-west": a label rule's name after the labels it adds.
export const getLabelRuleName: (labelNames: Array<string>) => string = (
  labelNames: Array<string>,
): string => {
  return getRuleNameFromPicks(LABEL_RULE_NAME_WORDING, labelNames);
};

// "Add Platform as owners": an owner rule's name after the owners it adds.
export const getOwnerRuleName: (ownerNames: Array<string>) => string = (
  ownerNames: Array<string>,
): string => {
  return getRuleNameFromPicks(OWNER_RULE_NAME_WORDING, ownerNames);
};

/**
 * The name once the picks change: the name made from the new picks, while
 * the name is still the form's own - empty, the name it filled in last, or
 * the name made from the picks before (an Edit form whose rule was never
 * renamed). Emptying the picks empties such a name, so the next pick is
 * followed again. Null when the name stays as it is: somebody typed a name
 * of their own, or it already is the new one.
 */
export const getRuleNameAfterPick: (data: {
  // The name the form holds now.
  name: unknown;
  // The name the form filled in last, if any.
  filledInName: unknown;
  // The names of what is picked now, and of what was picked before.
  pickedNames: Array<string>;
  previousNames: Array<string>;
  makeName: (names: Array<string>) => string;
}) => string | null = (data: {
  name: unknown;
  filledInName: unknown;
  pickedNames: Array<string>;
  previousNames: Array<string>;
  makeName: (names: Array<string>) => string;
}): string | null => {
  const name: string = typeof data.name === "string" ? data.name : "";
  const nextName: string = data.makeName(data.pickedNames);
  const previousName: string = data.makeName(data.previousNames);

  if (nextName === name) {
    return null;
  }

  if (!nextName) {
    const isTheFormsOwn: boolean =
      name.trim().length === 0 ||
      name === previousName ||
      (typeof data.filledInName === "string" && name === data.filledInName);

    return isTheFormsOwn ? "" : null;
  }

  return getNameAfterPick({
    name: name,
    pickedName: nextName,
    filledInNames: [data.filledInName, previousName],
  });
};

type PickedNamesFunction = (
  options: Array<DropdownOption> | undefined,
) => Array<string>;

const pickedNamesOf: PickedNamesFunction = (
  options: Array<DropdownOption> | undefined,
): Array<string> => {
  return (options || []).map((option: DropdownOption): string => {
    return option.label;
  });
};

export type RuleNameFollowFunction<TEntity> = (
  value: unknown,
  currentValues: FormValues<TEntity>,
  setNewFormValues: (values: FormValues<TEntity>) => void,
  change?: DropdownChange | undefined,
) => void;

/**
 * The onChange of what a rule adds - its labels or its owners: the rule's
 * name follows the picks, as the field reports them by name (DropdownChange
 * - the label dropdown and the people picker both say what was picked now
 * and before). A field that could not say leaves the name alone.
 */
export const followPicksWithRuleName: <TEntity>(
  makeName: (names: Array<string>) => string,
) => RuleNameFollowFunction<TEntity> = <TEntity>(
  makeName: (names: Array<string>) => string,
): RuleNameFollowFunction<TEntity> => {
  return (
    _value: unknown,
    currentValues: FormValues<TEntity>,
    setNewFormValues: (values: FormValues<TEntity>) => void,
    change?: DropdownChange | undefined,
  ): void => {
    if (!change) {
      return;
    }

    const values: Record<string, unknown> = (currentValues || {}) as Record<
      string,
      unknown
    >;

    const name: string | null = getRuleNameAfterPick({
      name: values["name"],
      filledInName: values[FILLED_IN_RULE_NAME_KEY],
      pickedNames: pickedNamesOf(change.selectedOptions),
      previousNames: pickedNamesOf(change.previousOptions),
      makeName: makeName,
    });

    if (name === null) {
      return;
    }

    setNewFormValues({
      ...values,
      name: name,
      [FILLED_IN_RULE_NAME_KEY]: name,
    } as unknown as FormValues<TEntity>);
  };
};

/**
 * A label rule's two steps: what it matches, then the labels it adds. The
 * step ids are written out here, so the form scanner of the guards reads
 * them.
 */
export const getLabelRuleFormSteps: <TEntity>() => Array<FormStep<TEntity>> = <
  TEntity,
>(): Array<FormStep<TEntity>> => {
  return [
    { title: "Match", id: "match-criteria" },
    { title: "Labels", id: "labels" },
  ];
};

// An owner rule's two steps: what it matches, then the owners it adds.
export const getOwnerRuleFormSteps: <TEntity>() => Array<FormStep<TEntity>> = <
  TEntity,
>(): Array<FormStep<TEntity>> => {
  return [
    { title: "Match", id: "match-criteria" },
    { title: "Owners", id: "owners" },
  ];
};

/**
 * Everything on a label rule's Labels step: the labels it adds (required),
 * its name (filled in from them), its Enabled switch on the Edit form only,
 * and its description folded under More fields.
 */
export const getLabelRuleActionFields: <TEntity>() => Array<Field<TEntity>> = <
  TEntity,
>(): Array<Field<TEntity>> => {
  const moreFields: FormFieldCollapsibleSection<TEntity> =
    getAdvancedFormSection<TEntity>();

  return [
    {
      field: { labelsToAdd: true } as unknown as SelectFormFields<TEntity>,
      title: "Labels to Add",
      description: LABEL_RULE_LABELS_DESCRIPTION,
      stepId: "labels",
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      dropdownModal: {
        type: Label,
        labelField: "name",
        valueField: "_id",
      },
      required: true,
      placeholder: "Select labels",
      onChange: followPicksWithRuleName<TEntity>(getLabelRuleName),
    },
    {
      field: { name: true } as unknown as SelectFormFields<TEntity>,
      title: "Name",
      description: LABEL_RULE_NAME_DESCRIPTION,
      stepId: "labels",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "e.g. Add production",
      validation: {
        minLength: 2,
        maxLength: RULE_NAME_MAX_LENGTH,
      },
    },
    {
      field: { isEnabled: true } as unknown as SelectFormFields<TEntity>,
      title: "Enabled",
      description: RULE_ENABLED_DESCRIPTION,
      stepId: "labels",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      doNotShowWhenCreating: true,
    },
    {
      field: { description: true } as unknown as SelectFormFields<TEntity>,
      title: "Description",
      stepId: "labels",
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      collapsibleSection: moreFields,
    },
  ];
};

/**
 * Everything on an owner rule's Owners step: the people and teams it adds
 * (required, one picker), its name (filled in from them), its Enabled switch
 * on the Edit form only, and folded under More fields whether the owners it
 * adds are notified - on, as the server starts a rule - and its description.
 */
export const getOwnerRuleActionFields: <TEntity>() => Array<Field<TEntity>> = <
  TEntity,
>(): Array<Field<TEntity>> => {
  const moreFields: FormFieldCollapsibleSection<TEntity> =
    getAdvancedFormSection<TEntity>();

  return [
    getOwnersFormField<TEntity>({
      stepId: "owners",
      required: true,
      description: OWNER_RULE_OWNERS_DESCRIPTION,
      onChange: followPicksWithRuleName<TEntity>(getOwnerRuleName),
    }),
    {
      field: { name: true } as unknown as SelectFormFields<TEntity>,
      title: "Name",
      description: OWNER_RULE_NAME_DESCRIPTION,
      stepId: "owners",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "e.g. Add Platform as owners",
      validation: {
        minLength: 2,
        maxLength: RULE_NAME_MAX_LENGTH,
      },
    },
    {
      field: { isEnabled: true } as unknown as SelectFormFields<TEntity>,
      title: "Enabled",
      description: RULE_ENABLED_DESCRIPTION,
      stepId: "owners",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      doNotShowWhenCreating: true,
    },
    {
      field: { notifyOwners: true } as unknown as SelectFormFields<TEntity>,
      title: "Notify Owners",
      description: OWNER_RULE_NOTIFY_OWNERS_DESCRIPTION,
      stepId: "owners",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      collapsibleSection: moreFields,
    },
    {
      field: { description: true } as unknown as SelectFormFields<TEntity>,
      title: "Description",
      stepId: "owners",
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      collapsibleSection: moreFields,
    },
  ];
};
