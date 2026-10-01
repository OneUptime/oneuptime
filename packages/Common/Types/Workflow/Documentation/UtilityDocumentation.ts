/*
 * Help for the steps that shape a run rather than talk to anything outside
 * it: If / Else, Log, Sleep, Execute Workflow, custom JavaScript and the three
 * JSON steps.
 */

import ComponentDocumentation, {
  ComponentDocumentationNoteType,
} from "./ComponentDocumentation";
import {
  ComponentDocumentationContext,
  SampleValue,
  getSampleValue,
  ownReference,
} from "./DocumentationContext";
import { WorkflowDocsPaths, docsLink } from "./DocumentationLinks";

export type UtilityDocumentationFunction = (
  context: ComponentDocumentationContext,
) => ComponentDocumentation;

export const getIfElseDocumentation: UtilityDocumentationFunction = (
  context: ComponentDocumentationContext,
): ComponentDocumentation => {
  const sample: SampleValue | null = getSampleValue(context);

  return {
    summary:
      "Compares two values, then carries on down **Yes** or **No** depending on the answer.",
    steps: [
      "Put the value to check in **Input 1**. It is usually a value from an earlier step.",
      "Pick the **Operator**, and put what to compare it with in **Input 2**.",
      "Comparing numbers? Set **Input 1 Type** and **Input 2 Type** to Number. Both are Text unless you change them.",
      "Connect **Yes** and **No** to what should run in each case.",
    ],
    examples: [
      sample
        ? {
            title: "Carry on only when a value matches",
            fields: [
              { name: "Input 1", value: sample.reference },
              { name: "Operator", value: "Equal To" },
              { name: "Input 2", value: "the value to match" },
            ],
            description: `**Yes** runs when ${sample.description} is that value.`,
          }
        : {
            title: "Carry on only when a request succeeded",
            fields: [
              {
                name: "Input 1",
                value:
                  "{{local.components.api-get-1.returnValues.response-status}}",
              },
              { name: "Input 1 Type", value: "Number" },
              { name: "Operator", value: "Equal To" },
              { name: "Input 2", value: "200" },
              { name: "Input 2 Type", value: "Number" },
            ],
            description:
              "**Yes** runs when an API step called `api-get-1` was answered with status 200.",
          },
    ],
    notes: [
      {
        type: ComponentDocumentationNoteType.Warning,
        text: 'As Text, numbers are compared letter by letter, so `"10"` comes before `"9"`. Set both types to Number to compare them as numbers.',
      },
    ],
    learnMore: [
      {
        title: "Contains, Starts With and Ends With",
        paragraphs: [
          "These compare text, and capital letters count: `Error` does not contain `error`.",
        ],
      },
    ],
    links: [docsLink("If / Else guide", WorkflowDocsPaths.conditions)],
  };
};

export const getLogDocumentation: UtilityDocumentationFunction = (
  context: ComponentDocumentationContext,
): ComponentDocumentation => {
  const sample: SampleValue | null = getSampleValue(context);

  return {
    summary:
      "Writes a value to this run's log, so you can see what a step received.",
    steps: [
      "Put what to record in **Value**: text, a value from an earlier step, or both.",
      "Connect **Out** to whatever should run next.",
      "Run the workflow, then open the run's log to read it.",
    ],
    examples: [
      sample
        ? {
            title: "Record a value from another step",
            code: `Received: ${sample.reference}`,
            description: `The reference puts in ${sample.description}.`,
          }
        : {
            title: "Record a note",
            code: "Reached the cleanup branch.",
          },
    ],
    notes: [
      {
        type: ComponentDocumentationNoteType.Tip,
        text: "Nothing is sent anywhere. Remove Log steps you no longer need, to keep the run log easy to read.",
      },
    ],
    learnMore: [],
    links: [docsLink("Runs and logs guide", WorkflowDocsPaths.runsAndLogs)],
  };
};

export const getSleepDocumentation: UtilityDocumentationFunction = (
  _context: ComponentDocumentationContext,
): ComponentDocumentation => {
  return {
    summary: "Waits for a while, then carries on with the next steps.",
    steps: [
      "Set how long to wait in **Days**, **Hours**, **Minutes** and **Seconds**. They add up.",
      "Connect **Out** to the steps that should run after the wait.",
    ],
    examples: [
      {
        title: "Wait an hour and a half",
        fields: [
          { name: "Hours", value: "1" },
          { name: "Minutes", value: "30" },
        ],
      },
    ],
    notes: [
      {
        type: ComponentDocumentationNoteType.Tip,
        text: "The longest wait is 30 days. A longer one is cut to 30 days.",
      },
    ],
    learnMore: [
      {
        title: "What happens while it waits",
        paragraphs: [
          "The run is put aside and picked up again when the time is up, so a long wait does not hold anything up. The run's log shows when it went to sleep.",
        ],
      },
    ],
    links: [docsLink("Sleep guide", WorkflowDocsPaths.sleep)],
  };
};

export const getExecuteWorkflowDocumentation: UtilityDocumentationFunction = (
  _context: ComponentDocumentationContext,
): ComponentDocumentation => {
  return {
    summary:
      "Starts another workflow in this project, and carries on without waiting for it.",
    steps: [
      "Pick the workflow in **Workflow**. It must be turned on and start with a **Manual** trigger.",
      "Put what it needs in **Arguments**, as JSON.",
      "Connect **Out** to carry on, and **Error** for when the workflow cannot be started.",
    ],
    examples: [
      {
        title: "Arguments",
        code: '{"customerId": "42"}',
        description:
          "In the other workflow, `{{local.components.manual-1.returnValues.customerId}}` reads it, where `manual-1` is that workflow's Manual trigger.",
      },
    ],
    notes: [
      {
        type: ComponentDocumentationNoteType.Tip,
        text: "Nothing comes back from the other workflow. This step only starts it.",
      },
      {
        type: ComponentDocumentationNoteType.Warning,
        text: "A workflow cannot start itself, and there is a limit on how many workflows can start one another in a chain.",
      },
    ],
    learnMore: [],
    links: [
      docsLink("Execute Workflow guide", WorkflowDocsPaths.executeWorkflow),
    ],
  };
};

export const getJavaScriptDocumentation: UtilityDocumentationFunction = (
  context: ComponentDocumentationContext,
): ComponentDocumentation => {
  return {
    summary:
      "Runs your own JavaScript, and passes what it returns to the next steps.",
    steps: [
      "Write the code in **JavaScript Code**, and `return` what later steps need.",
      "Pass values in through **Arguments**, as JSON. The code reads them as `args`.",
      "Connect **Success**, and **Error** for when the code throws or runs too long.",
    ],
    examples: [
      {
        title: "Build a value from two arguments",
        code: 'return { fullName: args.firstName + " " + args.lastName };',
        description: `With **Arguments** set to \`{"firstName": "Ada", "lastName": "Lovelace"}\`, a later step reads the name with \`${ownReference(
          context,
          "returnValue",
          ["fullName"],
        )}\`.`,
      },
    ],
    notes: [
      {
        type: ComponentDocumentationNoteType.Warning,
        text: "The code has 5 seconds to finish. For longer work, run it on your own server and call it with an API step.",
      },
      {
        type: ComponentDocumentationNoteType.Tip,
        text: "Values from other steps are not available in the code directly. Put their references in **Arguments**.",
      },
    ],
    learnMore: [
      {
        title: "What the code can use",
        paragraphs: [
          "`args` holds the **Arguments**. `axios` makes HTTP requests, with the same address rules as the API steps. `console.log` writes to the run's log.",
          "The code runs in a sandbox: there is no file system, and no other modules can be loaded.",
        ],
      },
    ],
    links: [docsLink("Custom code guide", WorkflowDocsPaths.customCode)],
  };
};

export const getJsonToTextDocumentation: UtilityDocumentationFunction = (
  context: ComponentDocumentationContext,
): ComponentDocumentation => {
  return {
    summary: "Turns a JSON object into text, for steps that need a string.",
    steps: [
      "Put the object in **JSON**. It is usually a value from an earlier step.",
      "Connect **Success** to the step that needs the text.",
      "Use the result as **Text** in later steps.",
    ],
    examples: [
      {
        title: "The object, as text",
        code: ownReference(context, "text"),
      },
    ],
    notes: [
      {
        type: ComponentDocumentationNoteType.Warning,
        text: "If **JSON** is not an object, the run stops here with an error.",
      },
    ],
    learnMore: [],
    links: [docsLink("JSON steps guide", WorkflowDocsPaths.json)],
  };
};

export const getTextToJsonDocumentation: UtilityDocumentationFunction = (
  context: ComponentDocumentationContext,
): ComponentDocumentation => {
  return {
    summary: "Reads JSON written as text, so later steps can use its fields.",
    steps: [
      "Put the text in **Text**, such as a response body or the JSON a run started with.",
      "Connect **Success**, and **Error** for when the text is not valid JSON.",
      "Read fields of the result from **JSON** in later steps.",
    ],
    examples: [
      {
        title: "Read one field of the result",
        code: ownReference(context, "json", ["status"]),
        description: "Change `status` to the name of the field you need.",
      },
    ],
    notes: [],
    learnMore: [],
    links: [docsLink("JSON steps guide", WorkflowDocsPaths.json)],
  };
};

export const getMergeJsonDocumentation: UtilityDocumentationFunction = (
  context: ComponentDocumentationContext,
): ComponentDocumentation => {
  return {
    summary: "Combines two JSON objects into one.",
    steps: [
      "Put the two objects in **JSON 1** and **JSON 2**.",
      "Connect **Success** to the step that needs the result.",
      "Use the combined object as **JSON** in later steps.",
    ],
    examples: [
      {
        title: "Two objects",
        fields: [
          { name: "JSON 1", value: '{"name": "Checkout", "status": "up"}' },
          { name: "JSON 2", value: '{"status": "down"}' },
        ],
        description: `\`${ownReference(context, "json")}\` is then \`{"name": "Checkout", "status": "down"}\`.`,
      },
    ],
    notes: [
      {
        type: ComponentDocumentationNoteType.Tip,
        text: "When both objects have the same key, the value in **JSON 2** wins. Objects inside them are replaced, not merged.",
      },
      {
        type: ComponentDocumentationNoteType.Warning,
        text: "If either value is not an object, the run stops here with an error.",
      },
    ],
    learnMore: [],
    links: [docsLink("JSON steps guide", WorkflowDocsPaths.json)],
  };
};
