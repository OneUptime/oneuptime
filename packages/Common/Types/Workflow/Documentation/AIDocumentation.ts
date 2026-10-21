/*
 * Help for Generate Text with AI.
 *
 * Its old documentation ran to some 2,700 pixels: provider configuration,
 * request filtering, logging, billing and safety, all at full length above the
 * first word about writing a prompt. What a builder needs first is the three
 * settings that matter and how to use the answer; the rest is still here,
 * under Learn more, and on the docs site in full.
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

export type AIDocumentationFunction = (
  context: ComponentDocumentationContext,
) => ComponentDocumentation;

export const getAIGenerateTextDocumentation: AIDocumentationFunction = (
  context: ComponentDocumentationContext,
): ComponentDocumentation => {
  const sample: SampleValue | null = getSampleValue(context);

  return {
    summary:
      "Asks your project's AI model to write text, such as a summary or a draft update, from data you choose.",
    steps: [
      "Check that the project has an AI provider, under **Project Settings → AI → LLM Providers**.",
      "Write the task in **Prompt**, and put the data it should work from in **Context**, as JSON.",
      "Use the answer in later steps: it is the **Response**.",
      "Connect **Error** to a fallback. It runs when the provider, a limit or the budget stops the request.",
    ],
    examples: [
      sample
        ? {
            title: "Context with a value from another step",
            code: `{"details": "${sample.reference}"}`,
            description: `The reference puts in ${sample.description}.`,
          }
        : {
            title: "Context",
            code: '{"service": "Checkout", "errorRate": "12%"}',
          },
      {
        title: "The answer, in a later step",
        code: ownReference(context, "response"),
      },
    ],
    notes: [
      {
        type: ComponentDocumentationNoteType.Tip,
        text: "Only what you put in **System Instructions**, **Prompt** and **Context** is sent to the provider. Nothing else from the workflow is.",
      },
      {
        type: ComponentDocumentationNoteType.Warning,
        text: "Treat the answer as untrusted text. Review it before customers see it, and never let it alone decide something that cannot be undone.",
      },
    ],
    learnMore: [
      {
        title: "Before you use it",
        paragraphs: [
          "AI must be turned on for the project. On OneUptime Cloud the subscription must be paid and on the Growth plan or above; self-hosted installs without billing have no plan check.",
          "Each call uses the project's default provider, or the installation's global one. A costed global provider uses the project's AI credits, and every call counts toward the project's daily AI token budget.",
        ],
      },
      {
        title: "Limits",
        paragraphs: [
          "System Instructions, Prompt and Context together can be up to 50,000 characters. A request is tried once and stops after at most 60 seconds, and at most three AI steps run at once in a project. Anything over a limit takes **Error**.",
          "**Temperature** (0 to 1, default 0.2) controls how much the wording varies. **Maximum Output Tokens** (1 to 4096, default 1024) caps the length of the answer.",
        ],
      },
      {
        title: "Logs and privacy",
        paragraphs: [
          "The prompt, context and answer are hidden in this step's entries in the run log. A later step that uses the answer logs it by its own rules, so treat reusing it as sharing it.",
          "Each call is listed in **Project Settings → AI → AI Logs**, with its provider, model, tokens and cost, but not the prompt or the answer.",
        ],
      },
    ],
    links: [
      docsLink("Generate Text with AI guide", WorkflowDocsPaths.ai),
      docsLink("AI safety and costs", WorkflowDocsPaths.aiSafety),
    ],
  };
};
