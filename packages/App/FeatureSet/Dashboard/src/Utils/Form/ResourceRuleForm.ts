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
import {
  INHERITED_LABEL_COLUMNS,
  INHERITED_OWNER_COLUMNS,
  isAnyColumnSwitchedOn,
} from "Common/UI/Components/RuleRun/RuleAction";
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
 * Every product with labels and owners has a Label Rules and an Owner Rules
 * page under its Settings - Monitors, Incidents (and their episodes),
 * Alerts (and theirs), Scheduled Maintenance, Status Pages, Hosts,
 * Kubernetes, Docker, Docker Swarm, Podman, Proxmox, VMware, Ceph, Cloud,
 * Serverless, Databases, Queues, IoT, Network Devices, RUM, Services,
 * Dashboards, On-Call, Runbooks, SLOs and Workflows. Each page used to
 * write out the same three-step form by hand: "Basic Info" first, asking
 * for a name before anyone had said what the rule was for (and, on an
 * owner rule, whether to notify owners, two steps away from the owners),
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
 *   - Labels, or Owners: what the rule adds - required of a new rule - then
 *     the rule's Name, filled in from what was picked ("Add production,
 *     eu-west", "Add Platform as owners") and following the picks until
 *     somebody types a name of their own (Forms/Utils/FollowPickName, the
 *     rule every such name follows). The Description - and on an owner rule,
 *     Notify Owners, on as the server starts it - fold under More fields,
 *     whose header says what is set. An Edit form adds the rule's Enabled
 *     switch here; a new rule starts on (RuleEnabledField).
 *
 * An incident, alert or scheduled maintenance rule can add more than what
 * it names: the labels or owners of the monitors, hosts, clusters and
 * services the event touches. Its page takes the inheriting form
 * (getInheritingLabelRuleActionFields / getInheritingOwnerRuleActionFields),
 * which folds those six switches under "Inherit Labels" / "Inherit Owners"
 * right after the picker - so a rule may name nothing and only inherit. The
 * fold says what it is for while nothing in it is on, and opens on an Edit
 * form whose rule inherits something.
 *
 * Only a NEW rule must add something. An Edit form asks for nothing it adds
 * (the field reads "(Optional)" there): rules saved before the form asked -
 * through the API, Terraform, an import, or the old form - may add nothing,
 * and such a rule can still be renamed, switched off or deleted without
 * first being given labels or owners. Their tables say "Adds nothing" beside
 * the rule's status (Common/UI/Components/RuleRun/RuleAction).
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
 *   <LabelRuleTable<IncidentLabelRule>
 *     formSteps={getLabelRuleFormSteps<IncidentLabelRule>()}
 *     formFields={[
 *       ...criteria,
 *       ...getInheritingLabelRuleActionFields<IncidentLabelRule>("incident"),
 *     ]}
 *
 * Common/Tests/UI/Components/Forms/ResourceRuleFormsGuard.test.ts holds every
 * label and owner rule model to this: each has one page, on these helpers,
 * and a model that can inherit takes the inheriting form.
 *
 * The name is filled in in the creator's language, as data: a rule named in
 * German follows its picks for a German editor, and keeps its name for an
 * English one, who reads it as a name somebody gave it.
 */

// The step ModelForm draws as one conditions builder (RuleCriteriaModelForm).
export const RULE_MATCH_STEP_ID: string = "match-criteria";
export const LABEL_RULE_ACTION_STEP_ID: string = "labels";
export const OWNER_RULE_ACTION_STEP_ID: string = "owners";

// The folds of the switches an incident, alert or event rule inherits with.
export const INHERIT_LABELS_SECTION_ID: string = "inherit-labels";
export const INHERIT_OWNERS_SECTION_ID: string = "inherit-owners";

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

// The same, on a rule that can inherit its labels instead.
export const LABEL_RULE_INHERITING_LABELS_DESCRIPTION: string = translationKey(
  "When this rule matches, these labels are attached. Labels already attached are not added twice. Leave it empty if the rule only inherits labels.",
);

export const OWNER_RULE_INHERITING_OWNERS_DESCRIPTION: string = translationKey(
  "When this rule matches, these people and teams are added as owners. Owners already assigned are not added twice. Leave it empty if the rule only inherits owners.",
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

/**
 * Whether the form creates a rule, rather than editing a saved one. An Edit
 * form starts from the saved rule, so it holds the rule's _id; a Create form
 * never does.
 */
export const isNewRule: (values: unknown) => boolean = (
  values: unknown,
): boolean => {
  if (!values || typeof values !== "object") {
    return true;
  }

  return !(values as Record<string, unknown>)["_id"];
};

/*
 * THE EVENTS A RULE CAN INHERIT FOR.
 *
 * An incident, alert or scheduled maintenance rule can add the labels or
 * owners of the monitors, hosts, Kubernetes clusters, Docker and Podman
 * hosts and services the event touches - six switches, one column each
 * (Common/UI/Components/RuleRun/RuleAction lists them). Their words are the
 * event's own: an alert has one monitor, an incident several.
 */
export type InheritingRuleRecord =
  | "incident"
  | "alert"
  | "scheduledMaintenance";

export interface RuleInheritanceWording {
  // Under the fold's title, and on its header while nothing is inherited.
  sectionDescription: string;
  // "Inherit Labels From Monitors" - or Monitor, for an alert's one monitor.
  monitorsTitle: string;
  // What each switch does, whole sentences.
  monitors: string;
  hosts: string;
  kubernetesClusters: string;
  dockerHosts: string;
  podmanHosts: string;
  services: string;
}

export const LABEL_INHERITANCE_WORDING: Record<
  InheritingRuleRecord,
  RuleInheritanceWording
> = {
  incident: {
    sectionDescription: translationKey(
      "Optionally copy labels from related entities onto the incident.",
    ),
    monitorsTitle: translationKey("Inherit Labels From Monitors"),
    monitors: translationKey(
      "Copy every label of the incident's monitors onto the incident.",
    ),
    hosts: translationKey(
      "Copy every label of the incident's affected hosts onto the incident.",
    ),
    kubernetesClusters: translationKey(
      "Copy every label of the incident's affected Kubernetes clusters onto the incident.",
    ),
    dockerHosts: translationKey(
      "Copy every label of the incident's affected Docker hosts onto the incident.",
    ),
    podmanHosts: translationKey(
      "Copy every label of the incident's affected Podman hosts onto the incident.",
    ),
    services: translationKey(
      "Copy every label of the incident's affected services onto the incident.",
    ),
  },
  alert: {
    sectionDescription: translationKey(
      "Optionally copy labels from related entities onto the alert.",
    ),
    monitorsTitle: translationKey("Inherit Labels From Monitor"),
    monitors: translationKey(
      "When this rule matches, also copy every label of the alert's monitor onto the alert.",
    ),
    hosts: translationKey(
      "Copy every label of the alert's affected hosts onto the alert.",
    ),
    kubernetesClusters: translationKey(
      "Copy every label of the alert's affected Kubernetes clusters onto the alert.",
    ),
    dockerHosts: translationKey(
      "Copy every label of the alert's affected Docker hosts onto the alert.",
    ),
    podmanHosts: translationKey(
      "Copy every label of the alert's affected Podman hosts onto the alert.",
    ),
    services: translationKey(
      "Copy every label of the alert's affected services onto the alert.",
    ),
  },
  scheduledMaintenance: {
    sectionDescription: translationKey(
      "Optionally copy labels from related entities onto the event.",
    ),
    monitorsTitle: translationKey("Inherit Labels From Monitors"),
    monitors: translationKey(
      "Copy every label of the event's monitors onto the event.",
    ),
    hosts: translationKey(
      "Copy every label of the event's affected hosts onto the event.",
    ),
    kubernetesClusters: translationKey(
      "Copy every label of the event's affected Kubernetes clusters onto the event.",
    ),
    dockerHosts: translationKey(
      "Copy every label of the event's affected Docker hosts onto the event.",
    ),
    podmanHosts: translationKey(
      "Copy every label of the event's affected Podman hosts onto the event.",
    ),
    services: translationKey(
      "Copy every label of the event's affected services onto the event.",
    ),
  },
};

export const OWNER_INHERITANCE_WORDING: Record<
  InheritingRuleRecord,
  RuleInheritanceWording
> = {
  incident: {
    sectionDescription: translationKey(
      "Optionally assign owners from related entities to the incident.",
    ),
    monitorsTitle: translationKey("Inherit Owners From Monitors"),
    monitors: translationKey(
      "Assign every owner of the incident's monitors as an owner of the incident.",
    ),
    hosts: translationKey(
      "Assign every owner of the incident's affected hosts as an owner of the incident.",
    ),
    kubernetesClusters: translationKey(
      "Assign every owner of the incident's affected Kubernetes clusters as an owner of the incident.",
    ),
    dockerHosts: translationKey(
      "Assign every owner of the incident's affected Docker hosts as an owner of the incident.",
    ),
    podmanHosts: translationKey(
      "Assign every owner of the incident's affected Podman hosts as an owner of the incident.",
    ),
    services: translationKey(
      "Assign every owner of the incident's affected services as an owner of the incident.",
    ),
  },
  alert: {
    sectionDescription: translationKey(
      "Optionally assign owners from related entities to the alert.",
    ),
    monitorsTitle: translationKey("Inherit Owners From Monitors"),
    monitors: translationKey(
      "Assign every owner of the alert's monitor as an owner of the alert.",
    ),
    hosts: translationKey(
      "Assign every owner of the alert's affected hosts as an owner of the alert.",
    ),
    kubernetesClusters: translationKey(
      "Assign every owner of the alert's affected Kubernetes clusters as an owner of the alert.",
    ),
    dockerHosts: translationKey(
      "Assign every owner of the alert's affected Docker hosts as an owner of the alert.",
    ),
    podmanHosts: translationKey(
      "Assign every owner of the alert's affected Podman hosts as an owner of the alert.",
    ),
    services: translationKey(
      "Assign every owner of the alert's affected services as an owner of the alert.",
    ),
  },
  scheduledMaintenance: {
    sectionDescription: translationKey(
      "Optionally assign owners from related entities to the event.",
    ),
    monitorsTitle: translationKey("Inherit Owners From Monitors"),
    monitors: translationKey(
      "Assign every owner of the event's monitors as an owner of the event.",
    ),
    hosts: translationKey(
      "Assign every owner of the event's affected hosts as an owner of the event.",
    ),
    kubernetesClusters: translationKey(
      "Assign every owner of the event's affected Kubernetes clusters as an owner of the event.",
    ),
    dockerHosts: translationKey(
      "Assign every owner of the event's affected Docker hosts as an owner of the event.",
    ),
    podmanHosts: translationKey(
      "Assign every owner of the event's affected Podman hosts as an owner of the event.",
    ),
    services: translationKey(
      "Assign every owner of the event's affected services as an owner of the event.",
    ),
  },
};

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
 * Whether a new inheriting rule must still name its labels: it adds nothing
 * else until one of its Inherit Labels switches is on. An Edit form never
 * insists (see isNewRule).
 */
export const isLabelPickRequired: (values: unknown) => boolean = (
  values: unknown,
): boolean => {
  return (
    isNewRule(values) && !isAnyColumnSwitchedOn(values, INHERITED_LABEL_COLUMNS)
  );
};

// The same for owners, and the Inherit Owners switches.
export const isOwnerPickRequired: (values: unknown) => boolean = (
  values: unknown,
): boolean => {
  return (
    isNewRule(values) && !isAnyColumnSwitchedOn(values, INHERITED_OWNER_COLUMNS)
  );
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

/*
 * What every label rule's Labels step ends with, after what the rule adds:
 * its name (filled in from the labels), its Enabled switch on the Edit form
 * only, and its description folded under More fields.
 */
const getLabelRuleNameAndMoreFields: <TEntity>() => Array<Field<TEntity>> = <
  TEntity,
>(): Array<Field<TEntity>> => {
  const moreFields: FormFieldCollapsibleSection<TEntity> =
    getAdvancedFormSection<TEntity>();

  return [
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

/*
 * What every owner rule's Owners step ends with, after what the rule adds:
 * its name (filled in from the owners), its Enabled switch on the Edit form
 * only, and folded under More fields whether the owners it adds are
 * notified - on, as the server starts a rule - and its description.
 */
const getOwnerRuleNameAndMoreFields: <TEntity>() => Array<Field<TEntity>> = <
  TEntity,
>(): Array<Field<TEntity>> => {
  const moreFields: FormFieldCollapsibleSection<TEntity> =
    getAdvancedFormSection<TEntity>();

  return [
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

/**
 * Everything on a label rule's Labels step: the labels it adds (required of
 * a new rule), its name (filled in from them), its Enabled switch on the
 * Edit form only, and its description folded under More fields.
 */
export const getLabelRuleActionFields: <TEntity>() => Array<Field<TEntity>> = <
  TEntity,
>(): Array<Field<TEntity>> => {
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
      required: isNewRule,
      placeholder: "Select labels",
      onChange: followPicksWithRuleName<TEntity>(getLabelRuleName),
    },
    ...getLabelRuleNameAndMoreFields<TEntity>(),
  ];
};

/**
 * Everything on an owner rule's Owners step: the people and teams it adds
 * (required of a new rule, one picker), its name (filled in from them), its
 * Enabled switch on the Edit form only, and folded under More fields
 * whether the owners it adds are notified and its description.
 */
export const getOwnerRuleActionFields: <TEntity>() => Array<Field<TEntity>> = <
  TEntity,
>(): Array<Field<TEntity>> => {
  return [
    getOwnersFormField<TEntity>({
      stepId: "owners",
      required: isNewRule,
      description: OWNER_RULE_OWNERS_DESCRIPTION,
      onChange: followPicksWithRuleName<TEntity>(getOwnerRuleName),
    }),
    ...getOwnerRuleNameAndMoreFields<TEntity>(),
  ];
};

/**
 * The Labels step of an incident, alert or scheduled maintenance label
 * rule: the labels it adds, then - folded under Inherit Labels - which of
 * the event's monitors, hosts, clusters and services to copy labels from,
 * then the rest of every label rule's step. A new rule must add something:
 * a label, or an Inherit Labels switch turned on.
 */
export const getInheritingLabelRuleActionFields: <TEntity>(
  record: InheritingRuleRecord,
) => Array<Field<TEntity>> = <TEntity>(
  record: InheritingRuleRecord,
): Array<Field<TEntity>> => {
  const wording: RuleInheritanceWording = LABEL_INHERITANCE_WORDING[record];

  /*
   * Folded on a new rule, and open on an Edit form whose rule inherits:
   * what a rule adds is never hidden. While nothing in it is on, its header
   * says what it is for.
   */
  const inheritSection: FormFieldCollapsibleSection<TEntity> = {
    id: INHERIT_LABELS_SECTION_ID,
    title: "Inherit Labels",
    description: wording.sectionDescription,
    getSummary: (values: FormValues<TEntity>): Array<string> | undefined => {
      return isAnyColumnSwitchedOn(values, INHERITED_LABEL_COLUMNS)
        ? undefined
        : [wording.sectionDescription];
    },
  };

  return [
    {
      field: { labelsToAdd: true } as unknown as SelectFormFields<TEntity>,
      title: "Labels to Add",
      description: LABEL_RULE_INHERITING_LABELS_DESCRIPTION,
      stepId: "labels",
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      dropdownModal: {
        type: Label,
        labelField: "name",
        valueField: "_id",
      },
      required: isLabelPickRequired,
      placeholder: "Select labels",
      onChange: followPicksWithRuleName<TEntity>(getLabelRuleName),
    },
    {
      field: {
        inheritLabelsFromMonitors: true,
      } as unknown as SelectFormFields<TEntity>,
      title: wording.monitorsTitle,
      description: wording.monitors,
      stepId: "labels",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      collapsibleSection: inheritSection,
    },
    {
      field: {
        inheritLabelsFromHosts: true,
      } as unknown as SelectFormFields<TEntity>,
      title: "Inherit Labels From Hosts",
      description: wording.hosts,
      stepId: "labels",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      collapsibleSection: inheritSection,
    },
    {
      field: {
        inheritLabelsFromKubernetesClusters: true,
      } as unknown as SelectFormFields<TEntity>,
      title: "Inherit Labels From Kubernetes Clusters",
      description: wording.kubernetesClusters,
      stepId: "labels",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      collapsibleSection: inheritSection,
    },
    {
      field: {
        inheritLabelsFromDockerHosts: true,
      } as unknown as SelectFormFields<TEntity>,
      title: "Inherit Labels From Docker Hosts",
      description: wording.dockerHosts,
      stepId: "labels",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      collapsibleSection: inheritSection,
    },
    {
      field: {
        inheritLabelsFromPodmanHosts: true,
      } as unknown as SelectFormFields<TEntity>,
      title: "Inherit Labels From Podman Hosts",
      description: wording.podmanHosts,
      stepId: "labels",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      collapsibleSection: inheritSection,
    },
    {
      field: {
        inheritLabelsFromServices: true,
      } as unknown as SelectFormFields<TEntity>,
      title: "Inherit Labels From Services",
      description: wording.services,
      stepId: "labels",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      collapsibleSection: inheritSection,
    },
    ...getLabelRuleNameAndMoreFields<TEntity>(),
  ];
};

/**
 * The Owners step of an incident, alert or scheduled maintenance owner
 * rule: the people and teams it adds, then - folded under Inherit Owners -
 * whose owners among the event's monitors, hosts, clusters and services to
 * add too, then the rest of every owner rule's step. A new rule must add
 * someone: an owner picked, or an Inherit Owners switch turned on.
 */
export const getInheritingOwnerRuleActionFields: <TEntity>(
  record: InheritingRuleRecord,
) => Array<Field<TEntity>> = <TEntity>(
  record: InheritingRuleRecord,
): Array<Field<TEntity>> => {
  const wording: RuleInheritanceWording = OWNER_INHERITANCE_WORDING[record];

  // As the Inherit Labels fold: folded until something in it is on.
  const inheritSection: FormFieldCollapsibleSection<TEntity> = {
    id: INHERIT_OWNERS_SECTION_ID,
    title: "Inherit Owners",
    description: wording.sectionDescription,
    getSummary: (values: FormValues<TEntity>): Array<string> | undefined => {
      return isAnyColumnSwitchedOn(values, INHERITED_OWNER_COLUMNS)
        ? undefined
        : [wording.sectionDescription];
    },
  };

  return [
    getOwnersFormField<TEntity>({
      stepId: "owners",
      required: isOwnerPickRequired,
      description: OWNER_RULE_INHERITING_OWNERS_DESCRIPTION,
      onChange: followPicksWithRuleName<TEntity>(getOwnerRuleName),
    }),
    {
      field: {
        inheritOwnersFromMonitors: true,
      } as unknown as SelectFormFields<TEntity>,
      title: wording.monitorsTitle,
      description: wording.monitors,
      stepId: "owners",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      collapsibleSection: inheritSection,
    },
    {
      field: {
        inheritOwnersFromHosts: true,
      } as unknown as SelectFormFields<TEntity>,
      title: "Inherit Owners From Hosts",
      description: wording.hosts,
      stepId: "owners",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      collapsibleSection: inheritSection,
    },
    {
      field: {
        inheritOwnersFromKubernetesClusters: true,
      } as unknown as SelectFormFields<TEntity>,
      title: "Inherit Owners From Kubernetes Clusters",
      description: wording.kubernetesClusters,
      stepId: "owners",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      collapsibleSection: inheritSection,
    },
    {
      field: {
        inheritOwnersFromDockerHosts: true,
      } as unknown as SelectFormFields<TEntity>,
      title: "Inherit Owners From Docker Hosts",
      description: wording.dockerHosts,
      stepId: "owners",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      collapsibleSection: inheritSection,
    },
    {
      field: {
        inheritOwnersFromPodmanHosts: true,
      } as unknown as SelectFormFields<TEntity>,
      title: "Inherit Owners From Podman Hosts",
      description: wording.podmanHosts,
      stepId: "owners",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      collapsibleSection: inheritSection,
    },
    {
      field: {
        inheritOwnersFromServices: true,
      } as unknown as SelectFormFields<TEntity>,
      title: "Inherit Owners From Services",
      description: wording.services,
      stepId: "owners",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      collapsibleSection: inheritSection,
    },
    ...getOwnerRuleNameAndMoreFields<TEntity>(),
  ];
};
