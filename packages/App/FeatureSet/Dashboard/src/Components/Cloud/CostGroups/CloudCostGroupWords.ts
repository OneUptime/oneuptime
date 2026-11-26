import {
  CloudCostLineItemKind,
  CloudCostLineItemRecurrence,
  CloudCostSharedSplit,
  CloudCostViewGrouping,
} from "Common/Types/Cloud/CloudCostAllocation";
import {
  CloudCostRuleField,
  CloudCostRuleOperator,
} from "Common/Types/Cloud/CloudCostRules";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * THE WORDS OF COST GROUPS: Cloud > Spend > Cost Groups, a view's page, a
 * group's page, the rule editor and the Costs page's breakdown by group.
 * React-free, so the pages' tests and the docs read the same words. Every
 * sentence is one key with its values as slots (Docs/ux/README.md#in-every-language).
 */

export const COST_GROUPS_TITLE: string = translationKey("Cost Groups");
export const COST_GROUPS_DESCRIPTION: string = translationKey(
  "Sort your cloud spend into teams, products or cost centers. Each cost falls into the first group whose rules match it, so nothing is counted twice.",
);
export const COST_VIEWS_EMPTY: string = translationKey("No cost views yet.");

// The lists' records, as their buttons and dialogs name them.
export const COST_VIEW_SINGULAR: string = translationKey("Cost View");
export const COST_VIEW_PLURAL: string = translationKey("Cost Views");
export const COST_GROUP_SINGULAR: string = translationKey("Cost Group");
export const COST_GROUP_PLURAL: string = translationKey("Cost Groups");
export const LINE_ITEM_SINGULAR: string = translationKey("Custom Line Item");
export const LINE_ITEM_PLURAL: string = translationKey("Custom Line Items");

// The quick starts a project with no view yet is offered.
export const QUICK_START_TITLE: string = translationKey(
  "Start sorting your spend",
);
export const QUICK_START_DESCRIPTION: string = translationKey(
  "Pick how you want to see who spent it. You can change the groups any time, and past months are sorted again.",
);
export const QUICK_START_BY_TEAM_TITLE: string = translationKey(
  "By team, from owners",
);
export const QUICK_START_BY_TEAM_DESCRIPTION: string = translationKey(
  "A group for each team that owns cloud resources, built from the owners you already set.",
);
export const QUICK_START_BY_TAG_TITLE: string = translationKey("By a tag");
export const QUICK_START_BY_TAG_DESCRIPTION: string = translationKey(
  "A group for each value of a tag your costs carry, such as team or cost-center.",
);
export const QUICK_START_BY_RULES_TITLE: string =
  translationKey("Your own groups");
export const QUICK_START_BY_RULES_DESCRIPTION: string = translationKey(
  "Write each group's rules: accounts, services, tags, owners and labels.",
);
export const QUICK_START_BY_TEAM_NAME: string = translationKey("By team");
export const QUICK_START_BY_TAG_NAME: string = translationKey("By {{tag}}");
export const QUICK_START_BY_RULES_NAME: string = translationKey("By product");
export const QUICK_START_CREATE: string = translationKey("Create View");
export const QUICK_START_NO_TAGS: string = translationKey(
  "None of your costs carry tags yet.",
);

export const GROUPING_LABELS: Readonly<Record<CloudCostViewGrouping, string>> =
  {
    [CloudCostViewGrouping.Rules]: translationKey("Groups you write"),
    [CloudCostViewGrouping.TagValue]: translationKey("A group per tag value"),
    [CloudCostViewGrouping.OwnerTeam]: translationKey("A group per owner team"),
  };

// The view's page.
export const SPEND_BY_GROUP_TITLE: string = translationKey("Spend by group");
export const SPEND_BY_GROUP_DESCRIPTION: string = translationKey(
  "What each group was charged, with its share of shared costs, against the period before.",
);
export const GROUPS_TITLE: string = translationKey("Groups");
export const GROUPS_DESCRIPTION: string = translationKey(
  "A cost falls into the first group whose rules match it. Drag the groups to change their order.",
);
export const GROUPS_EMPTY: string = translationKey("No groups yet.");
export const GROUPS_MADE_AUTOMATICALLY: string = translationKey(
  "OneUptime makes this view's groups as new values and owners appear. You can rename a group, link it to a team or share it.",
);
export const MAKE_GROUPS_NOW: string = translationKey("Make Groups Now");
export const GROUPS_MADE: PluralTemplate = {
  one: "Made {{count}} group",
  other: "Made {{count}} groups",
};
export const NO_GROUPS_TO_MAKE: string = translationKey(
  "Every value and owner already has a group.",
);

export const UNALLOCATED_TITLE: string = translationKey(
  "What no rule matches yet",
);
export const UNALLOCATED_DESCRIPTION: string = translationKey(
  "The services, accounts, tags and owners of the spend no group takes. Add one to a group to sort it.",
);
export const UNALLOCATED_NONE: string = translationKey(
  "Every cost of this period is in a group.",
);
export const UNALLOCATED_SERVICES: string = translationKey("Services");
export const UNALLOCATED_ACCOUNTS: string = translationKey("Accounts");
export const UNALLOCATED_TAG_VALUES: string = translationKey("Tags");
export const UNALLOCATED_OWNER_TEAMS: string = translationKey("Owner teams");
export const ADD_TO_GROUP: string = translationKey("Add to Group");
export const ADD_TO_GROUP_TITLE: string = translationKey("Add to a Group");
export const ADD_TO_GROUP_DESCRIPTION: string = translationKey(
  "The group gets a rule for it, and its costs move into the group, past months too.",
);
export const ADD_TO_GROUP_PICK: string = translationKey("Group");
export const ADD_TO_GROUP_NEW: string = translationKey("A new group");
export const ADD_TO_GROUP_NEW_NAME: string = translationKey("New group's name");
export const ADDED_TO_GROUP: string = translationKey(
  "Added to {{group}}. Its costs are in the group now.",
);

// A group's row and page.
export const SHARED: string = translationKey("Shared");
export const MADE_BY_ONEUPTIME: string = translationKey("Made by OneUptime");
export const NEVER_MATCHES: string = translationKey(
  "{{group}} above takes every cost these rules match, so this group gets nothing. Move it up, or narrow the earlier group's rules.",
);
export const TAKEN_EARLIER: string = translationKey(
  "Its rules also match {{amount}} an earlier group takes.",
);
export const SHARED_SPLIT_LABELS: Readonly<
  Record<CloudCostSharedSplit, string>
> = {
  [CloudCostSharedSplit.Even]: translationKey("Split evenly"),
  [CloudCostSharedSplit.Proportional]: translationKey(
    "Split by share of spend",
  ),
  [CloudCostSharedSplit.Fixed]: translationKey("Split by fixed percentages"),
  [CloudCostSharedSplit.Kubernetes]: translationKey(
    "Split by Kubernetes namespaces",
  ),
};
export const SPLIT_ACROSS: string = translationKey(
  "{{amount}} split across the other groups",
);
export const SPLIT_KEPT: string = translationKey(
  "{{amount}} not split: idle capacity, or what no group takes",
);
export const VS_PREVIOUS_UP: string = translationKey(
  "Up {{percent}} on the period before",
);
export const VS_PREVIOUS_DOWN: string = translationKey(
  "Down {{percent}} on the period before",
);
export const VS_PREVIOUS_SAME: string = translationKey(
  "The same as the period before",
);
export const GROUP_SPEND_TITLE: string = translationKey("Spend");
export const GROUP_SPEND_DESCRIPTION: string = translationKey(
  "What this group was charged each day, its shared costs and line items included.",
);
export const GROUP_TOP_SERVICES: string = translationKey("Top services");
export const GROUP_TOP_RESOURCES: string = translationKey("Top resources");
export const GROUP_TOP_ACCOUNTS: string = translationKey("Accounts");
export const GROUP_TOP_EMPTY: string = translationKey(
  "Nothing in this group cost anything in this period.",
);
export const GROUP_RULES_TITLE: string = translationKey("Rules");
export const GROUP_RULES_DESCRIPTION: string = translationKey(
  "Costs these rules match are this group's, unless an earlier group takes them first.",
);
export const GROUP_RULES_NONE: string = translationKey(
  "No rules yet: this group takes nothing.",
);
export const THIS_PERIOD: string = translationKey("This period");
export const PERIOD_BEFORE: string = translationKey("The period before");
export const SHARED_COSTS: string = translationKey("Shared costs");
export const LINE_ITEMS: string = translationKey("Line items");

// The rule editor.
export const RULE_EDITOR_ANY_RULE: string = translationKey(
  "A cost is this group's when any of these rules matches it.",
);
export const RULE_EDITOR_RULE: string = translationKey("Rule {{number}}");
export const RULE_EDITOR_ALL_CONDITIONS: string = translationKey(
  "Every condition must match.",
);
export const RULE_EDITOR_OR: string = translationKey("Or");
export const RULE_EDITOR_AND: string = translationKey("And");
export const RULE_EDITOR_ADD_CONDITION: string =
  translationKey("Add Condition");
export const RULE_EDITOR_ADD_RULE: string = translationKey("Add Rule");
export const RULE_EDITOR_REMOVE_CONDITION: string = translationKey(
  "Remove condition {{number}}",
);
export const RULE_EDITOR_REMOVE_RULE: string = translationKey(
  "Remove rule {{number}}",
);
export const RULE_EDITOR_TAG_KEY: string = translationKey("Tag key");
export const RULE_EDITOR_VALUES: string = translationKey("Values");
export const RULE_EDITOR_TYPE_OR_PICK: string = translationKey(
  "Type or pick values",
);
export const RULE_EDITOR_ADD_VALUE: string = translationKey('Add "{{value}}"');
export const RULE_EDITOR_EMPTY: string = translationKey(
  "No rules yet. Add a rule to say which costs are this group's.",
);
export const RULE_EDITOR_NEEDS_VALUE: string = translationKey(
  "Rule {{rule}}, condition {{condition}}: choose or type a value.",
);
export const RULE_EDITOR_NEEDS_KEY: string = translationKey(
  "Rule {{rule}}, condition {{condition}}: choose the tag's key.",
);
export const RULE_EDITOR_CHECK: string = translationKey(
  "These rules cannot be saved yet. Check each condition.",
);
export const RULE_EDITOR_OWNER_SPLIT: string = translationKey(
  "A resource owned by several teams is split evenly between them.",
);

export const FIELD_LABELS: Readonly<Record<CloudCostRuleField, string>> = {
  [CloudCostRuleField.Account]: translationKey("Account"),
  [CloudCostRuleField.Provider]: translationKey("Cloud"),
  [CloudCostRuleField.Service]: translationKey("Service"),
  [CloudCostRuleField.Region]: translationKey("Region"),
  [CloudCostRuleField.Resource]: translationKey("Resource"),
  [CloudCostRuleField.Tag]: translationKey("Tag"),
  [CloudCostRuleField.OwnerTeam]: translationKey("Owner team"),
  [CloudCostRuleField.Label]: translationKey("Label"),
  [CloudCostRuleField.Environment]: translationKey("App Platforms environment"),
  [CloudCostRuleField.App]: translationKey("App"),
  [CloudCostRuleField.KubernetesCluster]: translationKey("Kubernetes cluster"),
  [CloudCostRuleField.KubernetesNamespace]: translationKey(
    "Kubernetes namespace",
  ),
};

// The order fields are offered in: what most groups are made of first.
export const FIELD_ORDER: ReadonlyArray<CloudCostRuleField> = [
  CloudCostRuleField.Tag,
  CloudCostRuleField.Account,
  CloudCostRuleField.OwnerTeam,
  CloudCostRuleField.Service,
  CloudCostRuleField.Label,
  CloudCostRuleField.Region,
  CloudCostRuleField.Provider,
  CloudCostRuleField.Resource,
  CloudCostRuleField.Environment,
  CloudCostRuleField.App,
  CloudCostRuleField.KubernetesNamespace,
  CloudCostRuleField.KubernetesCluster,
];

export const OPERATOR_LABELS: Readonly<Record<CloudCostRuleOperator, string>> =
  {
    [CloudCostRuleOperator.Is]: translationKey("is any of"),
    [CloudCostRuleOperator.IsNot]: translationKey("is none of"),
    [CloudCostRuleOperator.Contains]: translationKey("contains"),
    [CloudCostRuleOperator.DoesNotContain]: translationKey("does not contain"),
    [CloudCostRuleOperator.StartsWith]: translationKey("starts with"),
    [CloudCostRuleOperator.EndsWith]: translationKey("ends with"),
    [CloudCostRuleOperator.Exists]: translationKey("is set"),
    [CloudCostRuleOperator.DoesNotExist]: translationKey("is not set"),
  };

/*
 * A condition as a sentence: its field, and its values as chips. One key
 * per operator, so each language puts the field and the values where its
 * grammar wants them.
 */
export const CONDITION_SENTENCES: Readonly<
  Record<CloudCostRuleOperator, string>
> = {
  [CloudCostRuleOperator.Is]: translationKey("{{field}} is {{values}}"),
  [CloudCostRuleOperator.IsNot]: translationKey("{{field}} is not {{values}}"),
  [CloudCostRuleOperator.Contains]: translationKey(
    "{{field}} contains {{values}}",
  ),
  [CloudCostRuleOperator.DoesNotContain]: translationKey(
    "{{field}} does not contain {{values}}",
  ),
  [CloudCostRuleOperator.StartsWith]: translationKey(
    "{{field}} starts with {{values}}",
  ),
  [CloudCostRuleOperator.EndsWith]: translationKey(
    "{{field}} ends with {{values}}",
  ),
  [CloudCostRuleOperator.Exists]: translationKey("{{field}} is set"),
  [CloudCostRuleOperator.DoesNotExist]: translationKey("{{field}} is not set"),
};

// A tag condition's field: the tag's key as written.
export const TAG_FIELD: string = translationKey("Tag {{key}}");
// A value that names a record since deleted.
export const VALUE_GONE: string = translationKey("No longer in this project");
export const EMPTY_VALUE: string = translationKey("(empty)");
export const CONDITION_OR: string = translationKey("or");

export const BREAKDOWN_VIEW_PICKER: string = translationKey("Cost view");
export const BREAKDOWN_NO_VIEWS: string = translationKey(
  "Sort your spend by team, product or cost center with cost groups.",
);
export const BREAKDOWN_SET_UP_GROUPS: string =
  translationKey("Set Up Cost Groups");
export const BREAKDOWN_UNALLOCATED: string = translationKey(
  "{{amount}} is in no group.",
);
export const BREAKDOWN_MANAGE: string = translationKey("Manage cost groups");

// Custom line items.
export const LINE_ITEMS_TITLE: string = translationKey("Custom Line Items");
export const LINE_ITEMS_DESCRIPTION: string = translationKey(
  "Charges and credits your clouds' bills do not carry, such as a support contract's share or an internal markup. Shown apart from what the clouds billed.",
);
export const LINE_ITEMS_EMPTY: string = translationKey(
  "No custom line items yet.",
);
export const LINE_ITEM_KIND_LABELS: Readonly<
  Record<CloudCostLineItemKind, string>
> = {
  [CloudCostLineItemKind.Charge]: translationKey("Charge"),
  [CloudCostLineItemKind.Credit]: translationKey("Credit"),
};
export const LINE_ITEM_RECURRENCE_LABELS: Readonly<
  Record<CloudCostLineItemRecurrence, string>
> = {
  [CloudCostLineItemRecurrence.Once]: translationKey("Once"),
  [CloudCostLineItemRecurrence.Monthly]: translationKey("Every month"),
};
export const LINE_ITEM_EACH_MONTH: string =
  translationKey("{{amount}} a month");

// Downloading a view's figures.
export const DOWNLOAD_CSV: string = translationKey("Download CSV");
