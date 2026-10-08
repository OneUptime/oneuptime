/*
 * Which control every workflow component argument is edited with.
 *
 * The maintainer's report: the Log step's Value - a whole sentence - sat in a
 * one-line text box. The audit behind this suite found the same problem in
 * other forms: Text to JSON's JSON document in a one-line box, an email body
 * that dropped to a one-line box once it held a {{...}} reference, and Slack's
 * message and the AI prompt in the visual Markdown editor, which rewrites what
 * is typed (it turns {{local.variables.my_var}} ... {{local.variables.your_var}}
 * into asterisks).
 *
 * These read the real component definitions and the real mapping
 * (componentInputTypeToFormFieldType, which both a step's settings and the Run
 * Workflow form use), so a definition changed back, or a new message-like
 * argument added as one-line text, fails here.
 */

/*
 * Utils.ts imports the whole database-model registry for
 * loadComponentsAndCategories, which nothing here calls.
 */
jest.mock("../../../../Models/DatabaseModels/Index", () => {
  return {
    __esModule: true,
    default: [],
  };
});

import {
  ArgumentFormFieldType,
  componentInputTypeToFormFieldType,
  MULTI_LINE_TEXT_INPUT_TYPES,
} from "../../../../UI/Components/Workflow/Utils";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import Components from "../../../../Types/Workflow/Components";
import BaseModelComponent from "../../../../Types/Workflow/Components/BaseModel";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import ComponentMetadata, {
  Argument,
  ComponentInputType,
} from "../../../../Types/Workflow/Component";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import { describe, expect, test } from "@jest/globals";

const REFERENCE: string =
  "{{local.components.webhook-1.returnValues.request-body}}";

/*
 * What an argument can hold once someone has used it: nothing yet, one line,
 * several lines, a whole-field reference, and references with underscores in
 * them (the case the visual Markdown editor broke).
 */
const SAMPLE_VALUES: Array<string> = [
  "",
  "ℹ️ Non-production webhook received. Logged without alerting.",
  "First line\nSecond line\n\nAfter a blank line",
  REFERENCE,
  "Hi {{local.variables.my_var}} and {{global.variables.your_var}}",
];

/*
 * The controls that show more than one line. Everything else in
 * FormFieldSchemaType is a single value on a single line (or a toggle, a
 * dropdown, a picker).
 */
const MULTI_LINE_FIELD_TYPES: Array<FormFieldSchemaType> = [
  FormFieldSchemaType.LongText,
  FormFieldSchemaType.JSON,
  FormFieldSchemaType.HTML,
  FormFieldSchemaType.JavaScript,
  FormFieldSchemaType.CSS,
  FormFieldSchemaType.YAML,
];

/*
 * Every component a builder can add: the hand-written ones, plus the eleven
 * generated per database model. The generator gives every model the same
 * arguments, so one model stands for all of them.
 */
const ALL_COMPONENTS: Array<ComponentMetadata> = [
  ...Components,
  ...BaseModelComponent.getComponents(new Monitor()),
];

interface ArgumentInForm {
  component: ComponentMetadata;
  argument: Argument;
  // Which form it is edited in.
  form: "settings" | "run";
}

/*
 * A step's settings edit `arguments`; the Run Workflow form edits a trigger's
 * `runWorkflowManuallyArguments`. Both go through the same mapping.
 */
const ALL_ARGUMENTS: Array<ArgumentInForm> = ALL_COMPONENTS.flatMap(
  (component: ComponentMetadata): Array<ArgumentInForm> => {
    return [
      ...component.arguments.map((argument: Argument): ArgumentInForm => {
        return { component, argument, form: "settings" };
      }),
      ...(component.runWorkflowManuallyArguments || []).map(
        (argument: Argument): ArgumentInForm => {
          return { component, argument, form: "run" };
        },
      ),
    ];
  },
);

type FindArgumentFunction = (
  componentId: ComponentID,
  argumentId: string,
) => Argument;

const findArgument: FindArgumentFunction = (
  componentId: ComponentID,
  argumentId: string,
): Argument => {
  const component: ComponentMetadata | undefined = Components.find(
    (item: ComponentMetadata) => {
      return item.id === componentId;
    },
  );

  const argument: Argument | undefined = component?.arguments.find(
    (item: Argument) => {
      return item.id === argumentId;
    },
  );

  if (!argument) {
    throw new Error(`No argument "${argumentId}" on component ${componentId}`);
  }

  return argument;
};

type LabelFunction = (item: ArgumentInForm) => string;

const label: LabelFunction = (item: ArgumentInForm): string => {
  return `${item.component.title} → ${item.argument.name} (${item.form})`;
};

/*
 * The arguments that carry free text - a message, a prompt, a value to log -
 * and get the plain multi-line box that grows as it fills.
 */
const MULTI_LINE_TEXT_ARGUMENTS: Array<[string, ComponentID, string]> = [
  ["Log → Value", ComponentID.Log, "value"],
  [
    "Send Message to Slack → Message Text",
    ComponentID.SlackSendMessageToChannel,
    "text",
  ],
  [
    "Send Message to Teams → Message Text",
    ComponentID.MicrosoftTeamsSendMessageToChannel,
    "text",
  ],
  [
    "Send Message to Discord → Message Text",
    ComponentID.DiscordSendMessageToChannel,
    "text",
  ],
  [
    "Send Message to Telegram → Message Text",
    ComponentID.TelegramSendMessageToChat,
    "text",
  ],
  [
    "Send Message to IRC → Message Text",
    ComponentID.IRCSendMessageToChannel,
    "text",
  ],
  [
    "Generate Text with AI → System Instructions",
    ComponentID.AIGenerateText,
    "system-prompt",
  ],
  ["Generate Text with AI → Prompt", ComponentID.AIGenerateText, "prompt"],
  ["Text to JSON → Text", ComponentID.TextToJson, "text"],
];

// Arguments that are code or a JSON document, and get an editor for it.
const CODE_ARGUMENTS: Array<
  [string, ComponentID, string, FormFieldSchemaType]
> = [
  [
    "Send Email → Email Body",
    ComponentID.SendEmail,
    "email-body",
    FormFieldSchemaType.HTML,
  ],
  [
    "Run Custom JavaScript → JavaScript Code",
    ComponentID.JavaScriptCode,
    "code",
    FormFieldSchemaType.JavaScript,
  ],
  [
    "Run Custom JavaScript → Arguments",
    ComponentID.JavaScriptCode,
    "arguments",
    FormFieldSchemaType.JSON,
  ],
  [
    "API Post → Request Body",
    ComponentID.ApiPost,
    "request-body",
    FormFieldSchemaType.JSON,
  ],
  [
    "Generate Text with AI → Context",
    ComponentID.AIGenerateText,
    "context",
    FormFieldSchemaType.JSON,
  ],
  [
    "Execute Workflow → Arguments",
    ComponentID.WorkflowRun,
    "arguments",
    FormFieldSchemaType.JSON,
  ],
  [
    "JSON to Text → JSON",
    ComponentID.JsonToText,
    "json",
    FormFieldSchemaType.JSON,
  ],
  [
    "Merge JSON → JSON 1",
    ComponentID.MergeJson,
    "json1",
    FormFieldSchemaType.JSON,
  ],
  [
    "Merge JSON → JSON 2",
    ComponentID.MergeJson,
    "json2",
    FormFieldSchemaType.JSON,
  ],
];

/*
 * Short values that stay on one line: addresses, identifiers, a subject line,
 * the two sides of a comparison. A tall box for these would only be clutter.
 */
const SINGLE_LINE_ARGUMENTS: Array<
  [string, ComponentID, string, FormFieldSchemaType]
> = [
  [
    "Send Email → From Email",
    ComponentID.SendEmail,
    "from",
    FormFieldSchemaType.Text,
  ],
  [
    "Send Email → To Email",
    ComponentID.SendEmail,
    "to",
    FormFieldSchemaType.Text,
  ],
  [
    "Send Email → Subject",
    ComponentID.SendEmail,
    "subject",
    FormFieldSchemaType.Text,
  ],
  [
    "Send Email → SMTP Host",
    ComponentID.SendEmail,
    "smtp-host",
    FormFieldSchemaType.Text,
  ],
  [
    "Send Email → SMTP Password",
    ComponentID.SendEmail,
    "smtp-password",
    FormFieldSchemaType.Password,
  ],
  [
    "Send Email → SMTP Port",
    ComponentID.SendEmail,
    "smtp-port",
    FormFieldSchemaType.Number,
  ],
  [
    "Send Message to Telegram → Chat ID",
    ComponentID.TelegramSendMessageToChat,
    "chat-id",
    FormFieldSchemaType.Text,
  ],
  [
    "Send Message to Telegram → Bot Token",
    ComponentID.TelegramSendMessageToChat,
    "bot-token",
    FormFieldSchemaType.Text,
  ],
  [
    "Send Message to Slack → Webhook URL",
    ComponentID.SlackSendMessageToChannel,
    "webhook-url",
    FormFieldSchemaType.URL,
  ],
  [
    "Send Message to IRC → IRC Server",
    ComponentID.IRCSendMessageToChannel,
    "server",
    FormFieldSchemaType.Text,
  ],
  [
    "Send Message to IRC → Channel",
    ComponentID.IRCSendMessageToChannel,
    "channel",
    FormFieldSchemaType.Text,
  ],
  [
    "Send Message to IRC → Nickname",
    ComponentID.IRCSendMessageToChannel,
    "nickname",
    FormFieldSchemaType.Text,
  ],
  [
    "Send Message to IRC → Port",
    ComponentID.IRCSendMessageToChannel,
    "port",
    FormFieldSchemaType.Number,
  ],
  [
    "Send Message to IRC → Disable TLS",
    ComponentID.IRCSendMessageToChannel,
    "disable-tls",
    FormFieldSchemaType.Toggle,
  ],
  [
    "Send Message to IRC → Channel Key",
    ComponentID.IRCSendMessageToChannel,
    "channel-key",
    FormFieldSchemaType.Password,
  ],
  [
    "Send Message to IRC → Server Password",
    ComponentID.IRCSendMessageToChannel,
    "server-password",
    FormFieldSchemaType.Password,
  ],
  [
    "Send Message to IRC → SASL Password",
    ComponentID.IRCSendMessageToChannel,
    "sasl-password",
    FormFieldSchemaType.Password,
  ],
  ["API Get → URL", ComponentID.ApiGet, "url", FormFieldSchemaType.URL],
  [
    "If / Else → Value to check",
    ComponentID.IfElse,
    "input-1",
    FormFieldSchemaType.Text,
  ],
  [
    "If / Else → Compare with",
    ComponentID.IfElse,
    "input-2",
    FormFieldSchemaType.Text,
  ],
  ["Sleep → Days", ComponentID.Sleep, "days", FormFieldSchemaType.Number],
];

describe("Workflow arguments that carry free text get the multi-line box", () => {
  test.each(MULTI_LINE_TEXT_ARGUMENTS)(
    "%s",
    (_name: string, componentId: ComponentID, argumentId: string) => {
      const argument: Argument = findArgument(componentId, argumentId);

      for (const value of SAMPLE_VALUES) {
        expect(componentInputTypeToFormFieldType(argument.type, value)).toEqual(
          {
            fieldType: FormFieldSchemaType.LongText,
            autoGrow: true,
          },
        );
      }
    },
  );

  test("the Log value is the box the maintainer asked for, not a one-line text box", () => {
    const argument: Argument = findArgument(ComponentID.Log, "value");

    const control: ArgumentFormFieldType = componentInputTypeToFormFieldType(
      argument.type,
      "ℹ️ Non-production webhook received. Logged without alerting.",
    );

    expect(control.fieldType).not.toBe(FormFieldSchemaType.Text);
    expect(control.fieldType).toBe(FormFieldSchemaType.LongText);
    expect(control.autoGrow).toBe(true);
  });
});

describe("Workflow arguments that are code or JSON get an editor for it", () => {
  test.each(CODE_ARGUMENTS)(
    "%s",
    (
      _name: string,
      componentId: ComponentID,
      argumentId: string,
      expected: FormFieldSchemaType,
    ) => {
      const argument: Argument = findArgument(componentId, argumentId);

      // An empty value and a value holding a reference get the same editor.
      expect(
        componentInputTypeToFormFieldType(argument.type, "").fieldType,
      ).toBe(expected);
      expect(
        componentInputTypeToFormFieldType(argument.type, REFERENCE).fieldType,
      ).toBe(expected);
    },
  );

  test("an email body with a reference in it keeps the HTML editor", () => {
    const argument: Argument = findArgument(
      ComponentID.SendEmail,
      "email-body",
    );

    expect(
      componentInputTypeToFormFieldType(
        argument.type,
        "<p>Incident {{local.components.on-create-incident-1.returnValues.model.title}} was created.</p>",
      ).fieldType,
    ).toBe(FormFieldSchemaType.HTML);
  });
});

describe("Short workflow arguments stay on one line", () => {
  test.each(SINGLE_LINE_ARGUMENTS)(
    "%s",
    (
      _name: string,
      componentId: ComponentID,
      argumentId: string,
      expected: FormFieldSchemaType,
    ) => {
      const argument: Argument = findArgument(componentId, argumentId);
      const control: ArgumentFormFieldType = componentInputTypeToFormFieldType(
        argument.type,
        "",
      );

      expect(control.fieldType).toBe(expected);
      expect(control.autoGrow).toBeFalsy();
      expect(MULTI_LINE_FIELD_TYPES).not.toContain(control.fieldType);

      /*
       * A reference in a one-value control shows as the one line of text it
       * is, never as a multi-line box.
       */
      expect(
        componentInputTypeToFormFieldType(argument.type, REFERENCE).fieldType,
      ).toBe(FormFieldSchemaType.Text);
    },
  );
});

describe("Rules that hold for every workflow argument", () => {
  test("covers every component and every argument, settings and Run Workflow alike", () => {
    // A sanity check that the rules below have something to check.
    expect(ALL_COMPONENTS.length).toBeGreaterThan(20);
    expect(
      ALL_ARGUMENTS.filter((item: ArgumentInForm) => {
        return item.form === "run";
      }).length,
    ).toBeGreaterThan(0);
    expect(ALL_ARGUMENTS.length).toBeGreaterThan(40);
  });

  /*
   * A new argument whose name says it carries prose - a message, a body, a
   * prompt - must not arrive as a one-line text box, which is exactly how the
   * Log value and Text to JSON's text ended up there.
   */
  const PROSE_WORDS: RegExp =
    /\b(message|body|text|content|prompt|instructions?|description|notes?|comment|summary)\b/i;

  test("an argument named like prose is never a one-line box", () => {
    const offenders: Array<string> = [];

    for (const item of ALL_ARGUMENTS) {
      const words: string = `${item.argument.name} ${item.argument.id.replace(
        /[-_]/g,
        " ",
      )}`;

      if (!PROSE_WORDS.test(words)) {
        continue;
      }

      for (const value of SAMPLE_VALUES) {
        const control: ArgumentFormFieldType =
          componentInputTypeToFormFieldType(item.argument.type, value);

        if (!MULTI_LINE_FIELD_TYPES.includes(control.fieldType)) {
          offenders.push(
            `${label(item)} is ${control.fieldType} for ${JSON.stringify(value)}`,
          );
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("every free-text type is the auto-growing box, whatever it holds", () => {
    const offenders: Array<string> = [];

    for (const item of ALL_ARGUMENTS) {
      if (!MULTI_LINE_TEXT_INPUT_TYPES.includes(item.argument.type)) {
        continue;
      }

      for (const value of SAMPLE_VALUES) {
        const control: ArgumentFormFieldType =
          componentInputTypeToFormFieldType(item.argument.type, value);

        if (
          control.fieldType !== FormFieldSchemaType.LongText ||
          control.autoGrow !== true
        ) {
          offenders.push(`${label(item)} for ${JSON.stringify(value)}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  /*
   * The visual Markdown editor rebuilds the value from what it displays on
   * every keystroke and rewrites what looks like formatting to it, so an
   * argument edited there is not stored as typed - and a step hands its
   * arguments on verbatim.
   */
  test("no argument is edited in the visual Markdown editor", () => {
    const offenders: Array<string> = [];

    for (const item of ALL_ARGUMENTS) {
      for (const value of SAMPLE_VALUES) {
        if (
          componentInputTypeToFormFieldType(item.argument.type, value)
            .fieldType === FormFieldSchemaType.Markdown
        ) {
          offenders.push(label(item));
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  /*
   * Adding a reference must not swap a multi-line editor for a one-line box
   * (the email body did exactly that). The key/value editor is the one
   * deliberate exception: a whole-field reference is not key/value pairs, so
   * it moves to the JSON editor, which is still multi-line.
   */
  test("a multi-line editor stays multi-line once a reference is added", () => {
    const offenders: Array<string> = [];

    for (const item of ALL_ARGUMENTS) {
      const empty: FormFieldSchemaType = componentInputTypeToFormFieldType(
        item.argument.type,
        "",
      ).fieldType;

      if (!MULTI_LINE_FIELD_TYPES.includes(empty)) {
        continue;
      }

      const withReference: FormFieldSchemaType =
        componentInputTypeToFormFieldType(
          item.argument.type,
          REFERENCE,
        ).fieldType;

      if (withReference !== empty) {
        offenders.push(`${label(item)}: ${empty} → ${withReference}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  test("a message argument is plain text on every chat component", () => {
    for (const componentId of [
      ComponentID.SlackSendMessageToChannel,
      ComponentID.MicrosoftTeamsSendMessageToChannel,
      ComponentID.DiscordSendMessageToChannel,
      ComponentID.TelegramSendMessageToChat,
      ComponentID.IRCSendMessageToChannel,
    ]) {
      expect(findArgument(componentId, "text").type).toBe(
        ComponentInputType.LongText,
      );
    }
  });
});

describe("componentInputTypeToFormFieldType — the control for each type", () => {
  /*
   * [type, control for an empty value, control for a value holding a
   * reference]. The free-text, code and JSON types keep their control; a
   * one-value control (toggle, dropdown, number, date, address) shows a
   * reference as one line of text.
   */
  const CONTROLS: Array<
    [ComponentInputType, FormFieldSchemaType, FormFieldSchemaType]
  > = [
    [
      ComponentInputType.LongText,
      FormFieldSchemaType.LongText,
      FormFieldSchemaType.LongText,
    ],
    [
      ComponentInputType.Markdown,
      FormFieldSchemaType.LongText,
      FormFieldSchemaType.LongText,
    ],
    [
      ComponentInputType.AnyValue,
      FormFieldSchemaType.LongText,
      FormFieldSchemaType.LongText,
    ],
    [
      ComponentInputType.HTML,
      FormFieldSchemaType.HTML,
      FormFieldSchemaType.HTML,
    ],
    [
      ComponentInputType.JavaScript,
      FormFieldSchemaType.JavaScript,
      FormFieldSchemaType.JavaScript,
    ],
    [
      ComponentInputType.JSON,
      FormFieldSchemaType.JSON,
      FormFieldSchemaType.JSON,
    ],
    [
      ComponentInputType.JSONArray,
      FormFieldSchemaType.JSON,
      FormFieldSchemaType.JSON,
    ],
    [
      ComponentInputType.Query,
      FormFieldSchemaType.JSON,
      FormFieldSchemaType.JSON,
    ],
    [
      ComponentInputType.Select,
      FormFieldSchemaType.JSON,
      FormFieldSchemaType.JSON,
    ],
    [
      ComponentInputType.BaseModel,
      FormFieldSchemaType.JSON,
      FormFieldSchemaType.JSON,
    ],
    [
      ComponentInputType.BaseModelArray,
      FormFieldSchemaType.JSON,
      FormFieldSchemaType.JSON,
    ],
    [
      ComponentInputType.StringDictionary,
      FormFieldSchemaType.Dictionary,
      FormFieldSchemaType.JSON,
    ],
    [
      ComponentInputType.Text,
      FormFieldSchemaType.Text,
      FormFieldSchemaType.Text,
    ],
    [
      ComponentInputType.Password,
      FormFieldSchemaType.Password,
      FormFieldSchemaType.Text,
    ],
    [
      ComponentInputType.Email,
      FormFieldSchemaType.Email,
      FormFieldSchemaType.Text,
    ],
    [ComponentInputType.URL, FormFieldSchemaType.URL, FormFieldSchemaType.Text],
    [
      ComponentInputType.Number,
      FormFieldSchemaType.Number,
      FormFieldSchemaType.Text,
    ],
    [
      ComponentInputType.Decimal,
      FormFieldSchemaType.Number,
      FormFieldSchemaType.Text,
    ],
    [
      ComponentInputType.Date,
      FormFieldSchemaType.Date,
      FormFieldSchemaType.Text,
    ],
    [
      ComponentInputType.DateTime,
      FormFieldSchemaType.DateTime,
      FormFieldSchemaType.Text,
    ],
    [
      ComponentInputType.Boolean,
      FormFieldSchemaType.Toggle,
      FormFieldSchemaType.Text,
    ],
    [
      ComponentInputType.CronTab,
      FormFieldSchemaType.Dropdown,
      FormFieldSchemaType.Text,
    ],
    [
      ComponentInputType.Operator,
      FormFieldSchemaType.Dropdown,
      FormFieldSchemaType.Text,
    ],
    [
      ComponentInputType.ValueType,
      FormFieldSchemaType.Dropdown,
      FormFieldSchemaType.Text,
    ],
    [
      ComponentInputType.WorkflowSelect,
      FormFieldSchemaType.Dropdown,
      FormFieldSchemaType.Text,
    ],
    [
      ComponentInputType.IncidentTemplateSelect,
      FormFieldSchemaType.Dropdown,
      FormFieldSchemaType.Text,
    ],
  ];

  test.each(CONTROLS)(
    "%s",
    (
      type: ComponentInputType,
      empty: FormFieldSchemaType,
      withReference: FormFieldSchemaType,
    ) => {
      expect(componentInputTypeToFormFieldType(type, "").fieldType).toBe(empty);
      expect(componentInputTypeToFormFieldType(type, REFERENCE).fieldType).toBe(
        withReference,
      );
    },
  );

  test("only the free-text types auto-grow", () => {
    for (const [type] of CONTROLS) {
      expect(
        Boolean(componentInputTypeToFormFieldType(type, "").autoGrow),
      ).toBe(MULTI_LINE_TEXT_INPUT_TYPES.includes(type));
    }
  });
});
