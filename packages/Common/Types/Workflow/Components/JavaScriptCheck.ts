import IconProp from "../../Icon/IconProp";
import { JSONObject, JSONValue } from "../../JSON";
import ComponentID from "../ComponentID";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
} from "./../Component";

/*
 * CHECK WITH JAVASCRIPT.
 *
 * Runs a script, then goes on by Yes or No by what it returned. It is the
 * Run Custom JavaScript step and the If / Else after it in one: nearly every
 * template that reads what another tool sent had a script that decided
 * whether to go on - a private incident, an event it does not handle, a
 * comment OneUptime itself posted - and an If / Else after it that read the
 * decision back, two cards where one says it. The script returns true, or an
 * object whose proceed is true, to go on by Yes; anything else goes on by
 * No. The object is the step's Value, so later steps read what the script
 * worked out, and its reason, when it gives one, is what the run's Steps say
 * the step chose and why.
 *
 * The script runs exactly as Run Custom JavaScript runs one: the same
 * sandbox, the same Arguments, the same time limit. Run Custom JavaScript is
 * left as it is.
 */

export const JAVASCRIPT_CHECK_PORT_IDS: {
  readonly yes: string;
  readonly no: string;
  readonly error: string;
} = {
  yes: "yes",
  no: "no",
  error: "error",
};

export interface JavaScriptCheckDecision {
  // Yes when the script returned true, or an object whose proceed is true.
  isYes: boolean;
  // Why, as the run's Steps say it: the script's own reason when it gives one.
  reason: string;
}

// The longest reason the step keeps: a sentence, not a log.
export const MAX_JAVASCRIPT_CHECK_REASON_LENGTH: number = 1000;

export type DecideJavaScriptCheckFunction = (
  returned: JSONValue | undefined,
) => JavaScriptCheckDecision;

/*
 * What a script's return value decides. Strict on purpose: only true, or an
 * object whose proceed is true, goes on by Yes - a script that returns a
 * truthy string or number by mistake does not slip through.
 */
export const decideJavaScriptCheck: DecideJavaScriptCheckFunction = (
  returned: JSONValue | undefined,
): JavaScriptCheckDecision => {
  if (returned === true) {
    return { isYes: true, reason: "The script returned true." };
  }

  if (returned && typeof returned === "object" && !Array.isArray(returned)) {
    const object: JSONObject = returned as JSONObject;
    const given: string =
      typeof object["reason"] === "string"
        ? (object["reason"] as string).trim()
        : "";
    const reason: string =
      given.length > MAX_JAVASCRIPT_CHECK_REASON_LENGTH
        ? given.slice(0, MAX_JAVASCRIPT_CHECK_REASON_LENGTH - 1) + "…"
        : given;

    if (object["proceed"] === true) {
      return {
        isYes: true,
        reason: reason || "The script returned proceed: true.",
      };
    }

    return {
      isYes: false,
      reason: reason || "The script did not return proceed: true.",
    };
  }

  if (returned === false) {
    return { isYes: false, reason: "The script returned false." };
  }

  return {
    isYes: false,
    reason: "The script returned neither true nor proceed: true.",
  };
};

const components: Array<ComponentMetadata> = [
  {
    id: ComponentID.JavaScriptCheck,
    title: "Check With JavaScript",
    category: "Conditions",
    description:
      "Runs your JavaScript, then continues on Yes when it returns true, or on No.",
    iconProp: IconProp.Code,
    componentType: ComponentType.Component,
    arguments: [
      {
        type: ComponentInputType.JavaScript,
        name: "JavaScript Code",
        description:
          "Return true, or an object whose proceed is true, to continue on Yes. Anything else continues on No.",
        required: true,
        id: "code",
      },
      {
        type: ComponentInputType.JSON,
        name: "Arguments",
        description:
          "Values the code reads as args, usually from earlier steps.",
        required: false,
        id: "arguments",
      },
    ],
    returnValues: [
      {
        type: ComponentInputType.AnyValue,
        name: "Value",
        description: "What the code returned, for the steps after it.",
        required: false,
        id: "returnValue",
      },
      {
        type: ComponentInputType.Text,
        name: "Reason",
        description:
          "The reason the code gave, or what it returned, in a sentence.",
        required: false,
        id: "reason",
      },
      {
        type: ComponentInputType.Text,
        name: "Error",
        description: "Why the code failed, when it continues on Error.",
        required: false,
        id: "error",
      },
    ],
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
        description:
          "Runs next when the code returns true, or proceed: true.",
        id: JAVASCRIPT_CHECK_PORT_IDS.yes,
      },
      {
        title: "No",
        description: "Runs next when the code returns anything else.",
        id: JAVASCRIPT_CHECK_PORT_IDS.no,
      },
      {
        title: "Error",
        description: "Runs next when the code throws or runs too long.",
        id: JAVASCRIPT_CHECK_PORT_IDS.error,
      },
    ],
  },
];

export default components;
