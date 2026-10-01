/*
 * The Incoming Email trigger's "How to use" help, and what other steps' help
 * makes of it. ComponentDocumentation.test.ts holds every step to the shared
 * rules (budget, real names, valid examples, links that land); this pins what
 * the help says about this trigger in particular.
 */

import ComponentMetadata, {
  NodeDataProp,
  NodeType,
} from "../../../Types/Workflow/Component";
import ComponentID from "../../../Types/Workflow/ComponentID";
import Components from "../../../Types/Workflow/Components";
import ComponentDocumentation, {
  ComponentDocumentationExample,
  ComponentDocumentationLink,
  ComponentDocumentationNote,
  ComponentDocumentationNoteType,
  ComponentDocumentationTopic,
} from "../../../Types/Workflow/Documentation/ComponentDocumentation";
import { WorkflowDocsPaths } from "../../../Types/Workflow/Documentation/DocumentationLinks";
import { getComponentDocumentation } from "../../../Types/Workflow/Documentation/Index";
import { describe, expect, test } from "@jest/globals";

const find: (id: string) => ComponentMetadata = (
  id: string,
): ComponentMetadata => {
  return Components.find((component: ComponentMetadata) => {
    return component.id === id;
  })!;
};

const INCOMING_EMAIL: ComponentMetadata = find(ComponentID.IncomingEmail);

const makeNode: (metadata: ComponentMetadata, id: string) => NodeDataProp = (
  metadata: ComponentMetadata,
  id: string,
): NodeDataProp => {
  return {
    error: "",
    id: id,
    nodeType: NodeType.Node,
    metadata: metadata,
    metadataId: metadata.id,
    internalId: `internal-${id}`,
    arguments: {},
    returnValues: {},
    componentType: metadata.componentType,
  };
};

const docsOf: (
  metadata: ComponentMetadata,
  stepId: string,
  graph?: Array<NodeDataProp>,
) => ComponentDocumentation = (
  metadata: ComponentMetadata,
  stepId: string,
  graph?: Array<NodeDataProp>,
): ComponentDocumentation => {
  return getComponentDocumentation({
    metadata: metadata,
    stepId: stepId,
    graphComponents: graph || [],
  })!;
};

const everything: (documentation: ComponentDocumentation) => string = (
  documentation: ComponentDocumentation,
): string => {
  return [
    documentation.summary,
    ...documentation.steps,
    ...documentation.examples.flatMap(
      (example: ComponentDocumentationExample) => {
        return [example.title, example.code || "", example.description || ""];
      },
    ),
    ...documentation.notes.map((note: ComponentDocumentationNote) => {
      return note.text;
    }),
    ...documentation.learnMore.flatMap((topic: ComponentDocumentationTopic) => {
      return [topic.title, ...topic.paragraphs];
    }),
  ].join("\n");
};

describe("the Incoming Email trigger's help", () => {
  const documentation: ComponentDocumentation = docsOf(
    INCOMING_EMAIL,
    "vendor-alerts",
  );
  const text: string = everything(documentation);

  test("sends the reader to the address at the top of the dialog, without repeating it", () => {
    expect(text).toContain("at the top of this dialog");
    expect(text).not.toContain("workflow-");
    expect(text).not.toContain("@");
  });

  test("shows how to read the subject and a header, by the step's own identifier", () => {
    expect(
      documentation.examples.map((example: ComponentDocumentationExample) => {
        return example.code;
      }),
    ).toEqual([
      "{{local.components.vendor-alerts.returnValues.subject}}",
      "{{local.components.vendor-alerts.returnValues.headers.message-id}}",
    ]);
  });

  test("says email is ignored while the workflow is off", () => {
    expect(text).toContain("While it is off, email to the address is ignored.");
  });

  test("warns that the sender can be anyone, as a warning", () => {
    const warning: ComponentDocumentationNote | undefined =
      documentation.notes.find((note: ComponentDocumentationNote) => {
        return note.type === ComponentDocumentationNoteType.Warning;
      });

    expect(warning?.text).toContain("**From**");
  });

  test("says attachments are listed, not kept", () => {
    expect(text).toContain("the files themselves are not kept");
  });

  test("says what the trigger reaches, and how it is tested without sending an email", () => {
    expect(text).toContain("blind copy");
    expect(text).toContain("forwarding rule");
    expect(text).toContain("**Run Workflow**");
  });

  test("links to the trigger's guide and to setting up inbound email", () => {
    expect(
      documentation.links.map((link: ComponentDocumentationLink) => {
        return link.path;
      }),
    ).toEqual([
      WorkflowDocsPaths.incomingEmailTrigger,
      WorkflowDocsPaths.inboundEmailSetup,
    ]);
    expect(WorkflowDocsPaths.incomingEmailTrigger).toBe(
      "/workflows/triggers#incoming-email",
    );
  });
});

describe("other steps' help, after an Incoming Email trigger", () => {
  test("a message step's example puts in the email's subject", () => {
    const trigger: NodeDataProp = makeNode(INCOMING_EMAIL, "incoming-email-1");

    for (const id of [
      ComponentID.SlackSendMessageToChannel,
      ComponentID.Log,
      ComponentID.SendEmail,
    ]) {
      const example: ComponentDocumentationExample | undefined = docsOf(
        find(id),
        "my-step",
        [trigger],
      ).examples[0];

      expect({ id, code: example?.code }).toEqual({
        id,
        code: expect.stringContaining(
          "{{local.components.incoming-email-1.returnValues.subject}}",
        ),
      });
      expect(example?.description).toContain("Subject from `incoming-email-1`");
    }
  });
});
