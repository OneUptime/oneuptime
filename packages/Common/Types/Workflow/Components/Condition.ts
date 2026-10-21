import IconProp from "../../Icon/IconProp";
import ComponentID from "../ComponentID";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
} from "./../Component";

/*
 * How a value is compared. Stored per value ("input-1-type", "input-2-type"),
 * though the settings set both at once, under Compare as. Null and Undefined
 * are no longer offered: compared that way a value is always null, whatever
 * it holds, so they could never check whether something is empty. Workflows
 * that use them still run as they always did. "is empty" is the comparison
 * that checks for a missing value.
 */
export enum ConditionValueType {
  Text = "text",
  Boolean = "boolean",
  Number = "number",
  Null = "null",
  Undefined = "undefined",
}

export enum ConditionOperator {
  EqualTo = "==",
  NotEqualTo = "!=",
  GreaterThan = ">",
  GreaterThanOrEqualTo = ">=",
  LessThan = "<",
  LessThanOrEqualTo = "<=",
  Contains = "contains",
  DoesNotContain = "does not contain",
  StartsWith = "starts with",
  EndsWith = "ends with",
  // These two look at the value to check only: Compare with is not used.
  IsEmpty = "is empty",
  IsNotEmpty = "is not empty",
}

/*
 * The stored ids of the If / Else settings. They are what every saved
 * workflow, template and docs page uses, so they never change; only the names
 * shown for them do.
 */
export const CONDITION_ARGUMENT_IDS: {
  readonly valueToCheck: string;
  readonly comparison: string;
  readonly compareWith: string;
  readonly valueToCheckType: string;
  readonly compareWithType: string;
} = {
  valueToCheck: "input-1",
  comparison: "operator",
  compareWith: "input-2",
  valueToCheckType: "input-1-type",
  compareWithType: "input-2-type",
};

// The comparisons that need no Compare with.
export const ONE_VALUE_CONDITION_OPERATORS: Array<ConditionOperator> = [
  ConditionOperator.IsEmpty,
  ConditionOperator.IsNotEmpty,
];

/*
 * The setting names, for the places that name a setting in words: the step
 * trace of a run, the graph checks ("Value to check is required but empty")
 * and the step's help. The settings themselves read as a sentence, If [value
 * to check] [comparison] [compare with], drawn by Workflow/Condition.
 *
 * They are declared in the order the sentence reads, so a run's trace lists
 * them that way too, with the two types last.
 */
const components: Array<ComponentMetadata> = [
  {
    id: ComponentID.IfElse,
    title: "If / Else",
    category: "Conditions",
    description: "Checks a condition, then continues on Yes or No.",
    iconProp: IconProp.Condition,
    componentType: ComponentType.Component,
    arguments: [
      {
        type: ComponentInputType.Text,
        name: "Value to check",
        description:
          "What the condition looks at, usually a value from an earlier step.",
        placeholder: "Pick a value with { } or type one",
        required: true,
        id: CONDITION_ARGUMENT_IDS.valueToCheck,
      },
      {
        type: ComponentInputType.Operator,
        name: "Comparison",
        description:
          "How to compare it: is equal to, contains, is greater than, is empty and so on.",
        placeholder: "is equal to",
        required: true,
        id: CONDITION_ARGUMENT_IDS.comparison,
      },
      {
        type: ComponentInputType.Text,
        name: "Compare with",
        description:
          "What to compare the value with. Not needed for is empty and is not empty.",
        placeholder: "e.g. production",
        required: true,
        notRequiredWhen: {
          argumentId: CONDITION_ARGUMENT_IDS.comparison,
          values: [...ONE_VALUE_CONDITION_OPERATORS],
        },
        id: CONDITION_ARGUMENT_IDS.compareWith,
      },
      {
        type: ComponentInputType.ValueType,
        name: "Value to check type",
        description:
          "Compare as text, as a number, or as true or false. Text unless set.",
        placeholder: "Text",
        required: false,
        id: CONDITION_ARGUMENT_IDS.valueToCheckType,
      },
      {
        type: ComponentInputType.ValueType,
        name: "Compare with type",
        description:
          "Set together with Value to check type, under Compare as. Text unless set.",
        placeholder: "Text",
        required: false,
        id: CONDITION_ARGUMENT_IDS.compareWithType,
      },
    ],
    returnValues: [],
    inPorts: [
      {
        title: "In",
        description: "Connect the step that runs before this check.",
        id: "in",
      },
    ],
    outPorts: [
      {
        title: "Yes",
        description: "Runs next when the condition is met.",
        id: "yes",
      },
      {
        title: "No",
        description: "Runs next when the condition is not met.",
        id: "no",
      },
    ],
  },
];

export default components;
