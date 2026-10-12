import IconProp from "../../Icon/IconProp";
import ComponentID from "../ComponentID";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
  Port,
} from "./../Component";

/*
 * Switch / Case: compares one value with a list of cases and carries on down
 * the first case that matches, or down Default when none does. One output is
 * taken, never more: a case that matches stops the checking (no fallthrough).
 *
 * Each case is a comparison and a value, with If / Else's comparisons and its
 * rules for comparing (SwitchCases), so a case matches exactly when an If /
 * Else with that comparison and value would say Yes.
 *
 * Unlike any other step, most of its outputs are not listed here: every case
 * is an output of its own, named after the case, so they come from the step's
 * settings (ComponentOutPorts). Default is the one output it always has.
 */

/*
 * The stored ids of the settings. Every saved workflow and template uses
 * them, so they never change; only the names shown for them do.
 */
export const SWITCH_ARGUMENT_IDS: {
  readonly valueToCheck: string;
  readonly cases: string;
} = {
  valueToCheck: "value",
  cases: "cases",
};

// The output taken when no case matches.
export const SWITCH_DEFAULT_PORT_ID: string = "default";

export const SWITCH_IN_PORT_ID: string = "in";

/*
 * How many cases one step can hold. Each is an output on the canvas, side by
 * side, so a longer list stops being readable there; a value with that many
 * outcomes is better looked up than switched on. The settings stop offering
 * Add case here. 25 is also where Power Automate stops a Switch.
 */
export const MAX_SWITCH_CASES: number = 25;

export const SWITCH_DEFAULT_PORT: Port = {
  title: "Default",
  description: "Runs next when no case matches.",
  id: SWITCH_DEFAULT_PORT_ID,
};

const components: Array<ComponentMetadata> = [
  {
    id: ComponentID.Switch,
    title: "Switch / Case",
    category: "Conditions",
    description:
      "Compares one value with each case in turn, then continues down the first case that matches, or Default.",
    iconProp: IconProp.Switch,
    componentType: ComponentType.Component,
    arguments: [
      {
        type: ComponentInputType.Text,
        name: "Value to check",
        description:
          "What every case is compared with, usually a value from an earlier step.",
        placeholder: "Pick a value with { } or type one",
        required: true,
        id: SWITCH_ARGUMENT_IDS.valueToCheck,
      },
      {
        type: ComponentInputType.SwitchCases,
        name: "Cases",
        description:
          "A comparison and a value for each way the workflow can go. They are checked from the top, and the first that matches is taken.",
        required: true,
        id: SWITCH_ARGUMENT_IDS.cases,
      },
    ],
    returnValues: [],
    inPorts: [
      {
        title: "In",
        description: "Connect the step that runs before this check.",
        id: SWITCH_IN_PORT_ID,
      },
    ],
    outPorts: [SWITCH_DEFAULT_PORT],
  },
];

export default components;
