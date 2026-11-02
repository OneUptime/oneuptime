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

  /*
   * The settings read as a sentence - If [Value to check] [Comparison]
   * [Compare with] - so the help names them by those names, and the
   * comparisons by the words the list uses.
   */
  return {
    summary:
      "Checks a condition, then carries on down **Yes** when it is met or **No** when it is not.",
    steps: [
      "Pick the **Value to check** with { }, usually a value from an earlier step, or type one.",
      "Choose the **Comparison**, and put what to compare with in **Compare with**. Is empty and is not empty need nothing there.",
      "Read the sentence under the settings: it says when **Yes** runs, so you can see the condition says what you mean.",
      "Connect **Yes** and **No** to what should run in each case.",
    ],
    examples: sample
      ? [
          {
            title: "Carry on only when a value matches",
            fields: [
              { name: "Value to check", value: sample.reference },
              { name: "Comparison", value: "is equal to" },
              { name: "Compare with", value: "the value to match" },
            ],
            description: `**Yes** runs when ${sample.description} is that value.`,
          },
          {
            title: "Carry on only when a value was sent",
            fields: [
              { name: "Value to check", value: sample.reference },
              { name: "Comparison", value: "is not empty" },
            ],
            description: `**Yes** runs when ${sample.description} holds anything. **No** runs when it is missing or blank.`,
          },
        ]
      : [
          {
            title: "Carry on only when a request succeeded",
            fields: [
              {
                name: "Value to check",
                value:
                  "{{local.components.api-get-1.returnValues.response-status}}",
              },
              { name: "Comparison", value: "is less than" },
              { name: "Compare with", value: "400" },
            ],
            description:
              "**Yes** runs when an API step called `api-get-1` was answered with a status below 400. The two are compared as numbers.",
          },
        ],
    notes: [
      {
        type: ComponentDocumentationNoteType.Tip,
        text: "The number comparisons, such as is greater than, compare numbers. To compare text or dates letter by letter instead, choose Text under **Compare as**.",
      },
    ],
    learnMore: [
      {
        title: "How the values are compared",
        paragraphs: [
          "Is equal to and is not equal to compare text unless **Compare as** says otherwise, and capital letters count: `Error` is not `error`. So do contains, starts with and ends with.",
          "Compared as numbers, text that is not a number counts as 0. Compared as true or false, only the value true counts as true; is true and is false compare that way.",
        ],
      },
      {
        title: "What counts as empty",
        paragraphs: [
          "Is empty is met by nothing at all, blank text, an empty list or object, or a value the earlier step did not have, such as a field the webhook did not send. 0 and false are values, so they are not empty.",
        ],
      },
    ],
    links: [docsLink("If / Else guide", WorkflowDocsPaths.conditions)],
  };
};

export const getSwitchDocumentation: UtilityDocumentationFunction = (
  context: ComponentDocumentationContext,
): ComponentDocumentation => {
  const sample: SampleValue | null = getSampleValue(context);

  /*
   * The settings are the value to check and the list of cases, each a
   * comparison and a value; every case is an output on the canvas, named
   * after it, beside Default. The comparisons are If / Else's, in its words.
   */
  return {
    summary:
      "Compares one value with each case in turn, then carries on down the first case that matches, or down **Default**.",
    steps: [
      "Pick the **Value to check** with { }, usually a value from an earlier step.",
      "Under **Cases**, choose a comparison and a value for each way the workflow can go. They are checked from the top, and the first that matches wins.",
      "Each case is an output on the canvas, named after its value. Connect each one, and **Default**, to what should run.",
    ],
    /*
     * Real cases, not "the first value": what a value from an earlier step
     * is sorted by, and that a value matching both takes the first.
     */
    examples: sample
      ? [
          {
            title: "Go a different way for each value",
            fields: [
              { name: "Value to check", value: sample.reference },
              {
                name: "Cases",
                value: "contains “error”, then contains “warning”",
              },
            ],
            description: `When ${sample.description} contains error, the first case runs, even if it says warning too. When it contains only warning, the second runs. Anything else goes down **Default**.`,
          },
        ]
      : [
          {
            title: "Sort a request's answers by status",
            fields: [
              {
                name: "Value to check",
                value:
                  "{{local.components.api-get-1.returnValues.response-status}}",
              },
              {
                name: "Cases",
                value: "is less than 300, then is less than 500",
              },
            ],
            description:
              "When an API step called `api-get-1` was answered below 300 the first case runs, from 300 to 499 the second, and from 500 **Default**. The cases compare numbers.",
          },
        ],
    notes: [
      {
        type: ComponentDocumentationNoteType.Tip,
        text: "Only the first case that matches runs. Put narrow cases first: is greater than 500 above is greater than 100. The other way round, 600 takes the 100 case, and the 500 case never runs.",
      },
      {
        type: ComponentDocumentationNoteType.Tip,
        text: "Removing a case removes the connection from its output too, once you save the step.",
      },
    ],
    learnMore: [
      {
        title: "How the cases are compared",
        paragraphs: [
          "A case matches exactly when an **If / Else** with the same comparison and value would say Yes. Is equal to and is not equal to compare text unless **Compare as** says otherwise, and capital letters count: `Error` is not `error`.",
          "The number comparisons, such as is less than, compare numbers. Is empty is met by nothing at all, blank text, an empty list or object, or a value the earlier step did not have.",
        ],
      },
      {
        title: "When no case matches",
        paragraphs: [
          "**Default** runs. Leave it unconnected to stop there: the run ends without an error. The run's Steps view says which case matched, or that none did.",
        ],
      },
    ],
    links: [docsLink("Switch / Case guide", WorkflowDocsPaths.switchCase)],
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

export const getJavaScriptCheckDocumentation: UtilityDocumentationFunction = (
  context: ComponentDocumentationContext,
): ComponentDocumentation => {
  return {
    summary:
      "Runs your own JavaScript, then carries on down **Yes** when it returns true, or down **No**.",
    steps: [
      "Write the check in **JavaScript Code**: `return true` to carry on down **Yes**, or an object with `proceed: true` and the values later steps need.",
      "Pass values in through **Arguments**, as JSON. The code reads them as `args`.",
      "Connect **Yes**, and **No** if anything should run when the check says no.",
    ],
    examples: [
      {
        title: "Carry on only for a production event",
        code: "if (args.environment !== 'production') {\n  return { proceed: false, reason: 'Not production, so nothing was sent.' };\n}\nreturn { proceed: true, title: args.title.toUpperCase() };",
        description: `A later step reads the title with \`${ownReference(
          context,
          "returnValue",
          ["title"],
        )}\`. The reason is what the run's Steps say when it goes down **No**.`,
      },
    ],
    notes: [
      {
        type: ComponentDocumentationNoteType.Tip,
        text: "Only `true`, or an object whose proceed is `true`, goes down **Yes**. Anything else, a truthy number or text included, goes down **No**.",
      },
      {
        type: ComponentDocumentationNoteType.Warning,
        text: "Code that throws or runs too long goes down **Error**. With nothing connected there, the run fails.",
      },
    ],
    learnMore: [
      {
        title: "What the code can use",
        paragraphs: [
          "The same as **Run Custom JavaScript**: `args` holds the **Arguments**, `axios` makes HTTP requests with the same address rules as the API steps, and `console.log` writes to the run's log. The code has 5 seconds to finish.",
        ],
      },
    ],
    links: [
      docsLink(
        "Check With JavaScript guide",
        WorkflowDocsPaths.javascriptCheck,
      ),
    ],
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
