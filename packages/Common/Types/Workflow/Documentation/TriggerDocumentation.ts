/*
 * Help for the triggers that are not about a database record: Webhook,
 * Incoming Email, Schedule and Manual. The database triggers are in
 * DatabaseDocumentation.ts.
 *
 * Webhook, Incoming Email and Manual open on a panel of their own
 * (ComponentPrimaryPanel), so their help does not repeat what that panel
 * already says - the URL or address, how a run is started - and is about what
 * comes next.
 */

import ComponentDocumentation, {
  ComponentDocumentationNoteType,
} from "./ComponentDocumentation";
import {
  ComponentDocumentationContext,
  ownReference,
} from "./DocumentationContext";
import { WorkflowDocsPaths, docsLink } from "./DocumentationLinks";
import { IncomingEmailTriggerValue } from "../IncomingEmailTrigger";

export type TriggerDocumentationFunction = (
  context: ComponentDocumentationContext,
) => ComponentDocumentation;

export const getWebhookDocumentation: TriggerDocumentationFunction = (
  context: ComponentDocumentationContext,
): ComponentDocumentation => {
  return {
    summary:
      "Starts this workflow each time another app or service calls its URL.",
    steps: [
      "Copy the URL at the top of this dialog into the app that should start the workflow.",
      "Connect **Out** to the steps that should run on each call.",
      "Turn the workflow on. While it is off, calls to the URL are refused.",
    ],
    examples: [
      {
        title: "Read one field of a JSON body in a later step",
        code: ownReference(context, "request-body", ["message"]),
        description: "Change `message` to the name of the field you need.",
      },
    ],
    notes: [
      {
        type: ComponentDocumentationNoteType.Tip,
        text: 'The caller is answered at once with `{"status": "Scheduled"}`, and the workflow runs after that, so the caller never sees what it does.',
      },
    ],
    learnMore: [
      {
        title: "Testing it without the other app",
        paragraphs: [
          "Click **Run Workflow** in the builder's toolbar to start a run with headers, query parameters and a body you type in.",
          "Or copy the request under **Try it** at the top of this dialog and run it in a terminal.",
        ],
      },
      {
        title: "Reading headers and query parameters",
        paragraphs: [
          "They work like the body: add the name to the end of the reference. Header names arrive in lower case.",
        ],
        example: {
          title: "The Content-Type header",
          code: ownReference(context, "request-headers", ["content-type"]),
        },
      },
    ],
    links: [
      docsLink("Webhook trigger guide", WorkflowDocsPaths.webhookTrigger),
    ],
  };
};

export const getIncomingEmailDocumentation: TriggerDocumentationFunction = (
  context: ComponentDocumentationContext,
): ComponentDocumentation => {
  return {
    summary:
      "Starts this workflow each time an email arrives at its own address.",
    steps: [
      "Copy the address at the top of this dialog, and have the email that should start the workflow sent or forwarded to it.",
      "Connect **Out** to the steps that should run for each email.",
      "Turn the workflow on. While it is off, email to the address is ignored.",
    ],
    examples: [
      {
        title: "The subject of the email in a later step",
        code: ownReference(context, IncomingEmailTriggerValue.Subject),
      },
      {
        title: "One header, such as the email's Message-ID",
        code: ownReference(context, IncomingEmailTriggerValue.Headers, [
          "message-id",
        ]),
        description:
          "Header names are in lower case. Change `message-id` to the one you need.",
      },
    ],
    notes: [
      {
        type: ComponentDocumentationNoteType.Tip,
        text: "Every email starts its own run. **Attachments** lists each file's name, type and size; the files themselves are not kept.",
      },
      {
        type: ComponentDocumentationNoteType.Warning,
        text: "Anyone can send email to any address, so check **From** before a step does anything that matters.",
      },
    ],
    learnMore: [
      {
        title: "Testing it without sending an email",
        paragraphs: [
          "Click **Run Workflow** in the builder's toolbar and fill in a sender, a subject and a body. The values you leave out arrive empty.",
          "Or send a real email to the address and open the workflow's runs to see what it brought.",
        ],
      },
      {
        title: "Which emails reach it",
        paragraphs: [
          "An email starts a run whether the address is in **To** or **CC**, was a blind copy, or was reached through a forwarding rule. An email that names the address twice still starts one run.",
          "**Body** is the email's plain text and **HTML Body** its HTML. Each is cut at 1 MB.",
        ],
      },
    ],
    links: [
      docsLink(
        "Incoming Email trigger guide",
        WorkflowDocsPaths.incomingEmailTrigger,
      ),
      docsLink("Setting up inbound email", WorkflowDocsPaths.inboundEmailSetup),
    ],
  };
};

export const getScheduleDocumentation: TriggerDocumentationFunction = (
  _context: ComponentDocumentationContext,
): ComponentDocumentation => {
  return {
    summary:
      "Starts this workflow on a repeating schedule, such as every hour or every Monday morning.",
    steps: [
      "Choose how often in **Schedule at**, or write your own cron expression.",
      "Connect **Execute** to the steps to run each time.",
      "Turn the workflow on. Nothing is scheduled while it is off.",
    ],
    examples: [
      {
        title: "Every weekday at 9:00 UTC",
        code: "0 9 * * 1-5",
        description:
          "The five parts are the minute, the hour, the day of the month, the month and the day of the week.",
      },
    ],
    notes: [
      {
        type: ComponentDocumentationNoteType.Tip,
        text: "Times are in UTC, so convert from your own time zone when you pick the hour.",
      },
    ],
    learnMore: [
      {
        title: "More cron expressions",
        paragraphs: [
          "`*/15 * * * *` runs every 15 minutes, `0 * * * *` every hour on the hour, `0 0 * * *` every day at midnight and `0 9 * * 1` every Monday at 9:00.",
        ],
      },
      {
        title: "Testing it",
        paragraphs: [
          "Click **Run Workflow** in the builder's toolbar to start a run straight away, without waiting for the schedule.",
        ],
      },
    ],
    links: [
      docsLink("Schedule trigger guide", WorkflowDocsPaths.scheduleTrigger),
    ],
  };
};

export const getManualDocumentation: TriggerDocumentationFunction = (
  context: ComponentDocumentationContext,
): ComponentDocumentation => {
  return {
    summary:
      "Starts this workflow when you run it from the builder, or when another workflow starts it.",
    steps: [
      "Connect **Execute** to the first step to run.",
      "Start a run as shown at the top of this dialog, with any JSON the run needs.",
      "Use that JSON in later steps with the reference under **Returns**.",
    ],
    examples: [
      {
        title: "The JSON this run started with",
        code: ownReference(context, "value"),
      },
    ],
    notes: [
      {
        type: ComponentDocumentationNoteType.Tip,
        text: `When an **Execute Workflow** step starts this workflow, each key it passes is a value of its own: \`${ownReference(
          context,
          "<key>",
        )}\`.`,
      },
    ],
    learnMore: [
      {
        title: "Reading one field of the JSON",
        paragraphs: [
          "JSON typed into **Run Workflow** arrives as one piece of text. To read a single field, pass it through a **Text to JSON** step, then read the field from that step's **JSON**.",
        ],
      },
    ],
    links: [docsLink("Manual trigger guide", WorkflowDocsPaths.manualTrigger)],
  };
};
