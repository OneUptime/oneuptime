/*
 * "Run - Why do I have to enable a workflow in order to test run it? Can you
 * please fix it?" - the maintainer. Run Workflow now runs a workflow that is
 * off, as a test run, while its trigger stays paused until it is turned on
 * (Types/Workflow/WorkflowEnabled).
 *
 * A trigger's "How to use" help is where people read how to test it, under
 * "Testing it". It used to offer Run Workflow and the real thing - calling the
 * URL, sending an email - side by side, which was fair while both were
 * refused for a workflow that was off. Now they differ, so the help says
 * which is which: Run Workflow works while the workflow is still off, the
 * trigger itself only once it is on. This holds every trigger with such a
 * topic to that - the built-in ones and the database triggers of every model
 * a workflow can use - and the steps above it to the rule that is unchanged:
 * the trigger starts nothing until the workflow is turned on.
 */

import Entities from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import ComponentMetadata, {
  ComponentType,
  NodeDataProp,
  NodeType,
} from "../../../Types/Workflow/Component";
import ComponentID from "../../../Types/Workflow/ComponentID";
import Components from "../../../Types/Workflow/Components";
import BaseModelComponent from "../../../Types/Workflow/Components/BaseModel";
import ComponentDocumentation, {
  ComponentDocumentationTopic,
} from "../../../Types/Workflow/Documentation/ComponentDocumentation";
import { getComponentDocumentation } from "../../../Types/Workflow/Documentation/Index";
import {
  WORKFLOW_TEST_WHILE_OFF_HELP,
  WORKFLOW_TURNED_OFF_MESSAGE,
} from "../../../Types/Workflow/WorkflowEnabled";
import { WorkflowEnabledCopy } from "../../../UI/Components/Workflow/WorkflowEnabledCopy";
import { describe, expect, test } from "@jest/globals";

const RUN_WORKFLOW: string = "**Run Workflow**";

const TESTING_TOPIC: RegExp = /^Testing it\b/;

const ONCE_ON: string = "once the workflow is on";

const makeNode: (metadata: ComponentMetadata) => NodeDataProp = (
  metadata: ComponentMetadata,
): NodeDataProp => {
  return {
    error: "",
    id: "my-trigger-1",
    nodeType: NodeType.Node,
    metadata: metadata,
    metadataId: metadata.id,
    internalId: "internal-my-trigger-1",
    arguments: {},
    returnValues: {},
    componentType: metadata.componentType,
  };
};

const docsOf: (metadata: ComponentMetadata) => ComponentDocumentation = (
  metadata: ComponentMetadata,
): ComponentDocumentation => {
  const documentation: ComponentDocumentation | null =
    getComponentDocumentation({
      metadata: metadata,
      stepId: "my-trigger-1",
      graphComponents: [makeNode(metadata)],
    });

  if (!documentation) {
    throw new Error(`No help for ${metadata.id}`);
  }

  return documentation;
};

const testingTopicOf: (
  documentation: ComponentDocumentation,
) => ComponentDocumentationTopic | undefined = (
  documentation: ComponentDocumentation,
): ComponentDocumentationTopic | undefined => {
  return documentation.learnMore.find(
    (topic: ComponentDocumentationTopic): boolean => {
      return TESTING_TOPIC.test(topic.title);
    },
  );
};

const builtIn: (id: ComponentID) => ComponentMetadata = (
  id: ComponentID,
): ComponentMetadata => {
  const metadata: ComponentMetadata | undefined = Components.find(
    (component: ComponentMetadata): boolean => {
      return component.id === id;
    },
  );

  if (!metadata) {
    throw new Error(`No built-in step ${id}`);
  }

  return metadata;
};

const BUILT_IN_TRIGGERS: Array<ComponentMetadata> = Components.filter(
  (component: ComponentMetadata): boolean => {
    return component.componentType === ComponentType.Trigger;
  },
);

// On Create, On Update and On Delete of every model a workflow can use.
const DATABASE_TRIGGERS: Array<ComponentMetadata> = Entities.flatMap(
  (modelType: { new (): BaseModel }): Array<ComponentMetadata> => {
    return BaseModelComponent.getComponents(new modelType()).filter(
      (component: ComponentMetadata): boolean => {
        return component.componentType === ComponentType.Trigger;
      },
    );
  },
);

const ALL_TRIGGERS: Array<ComponentMetadata> = [
  ...BUILT_IN_TRIGGERS,
  ...DATABASE_TRIGGERS,
];

// Every trigger whose help has a "Testing it" topic, with that topic.
const TRIGGERS_WITH_A_TESTING_TOPIC: Array<{
  metadata: ComponentMetadata;
  topic: ComponentDocumentationTopic;
}> = ALL_TRIGGERS.flatMap(
  (
    metadata: ComponentMetadata,
  ): Array<{
    metadata: ComponentMetadata;
    topic: ComponentDocumentationTopic;
  }> => {
    const topic: ComponentDocumentationTopic | undefined = testingTopicOf(
      docsOf(metadata),
    );

    return topic ? [{ metadata: metadata, topic: topic }] : [];
  },
);

describe("the sentence itself", () => {
  test("says the workflow does not have to be on, and that the run is a test run", () => {
    expect(WORKFLOW_TEST_WHILE_OFF_HELP).toBe(
      "This works while the workflow is still off, as a test run.",
    );
  });

  test("calls the run what the run lists and the run itself call it", () => {
    expect(WORKFLOW_TEST_WHILE_OFF_HELP.toLowerCase()).toContain(
      WorkflowEnabledCopy.testRun.toLowerCase(),
    );
  });

  test("is one sentence, so it reads as part of the paragraph it ends", () => {
    expect(WORKFLOW_TEST_WHILE_OFF_HELP.trim()).toBe(
      WORKFLOW_TEST_WHILE_OFF_HELP,
    );
    expect(WORKFLOW_TEST_WHILE_OFF_HELP.endsWith(".")).toBe(true);
    expect(WORKFLOW_TEST_WHILE_OFF_HELP.slice(0, -1)).not.toContain(".");
  });
});

describe("every trigger's Testing it says Run Workflow works while the workflow is off", () => {
  test("the scan finds the triggers that have one, built-in and database alike, so the rules below are not vacuous", () => {
    const ids: Array<string> = TRIGGERS_WITH_A_TESTING_TOPIC.map(
      (entry: { metadata: ComponentMetadata }): string => {
        return entry.metadata.id;
      },
    );

    expect(ids).toEqual(
      expect.arrayContaining([
        ComponentID.Webhook,
        ComponentID.IncomingEmail,
        ComponentID.Schedule,
      ]),
    );

    const incidentTriggers: Array<string> = BaseModelComponent.getComponents(
      new Incident(),
    )
      .filter((component: ComponentMetadata): boolean => {
        return component.componentType === ComponentType.Trigger;
      })
      .map((component: ComponentMetadata): string => {
        return component.id;
      });

    // On Create, On Update and On Delete.
    expect(incidentTriggers).toHaveLength(3);
    expect(ids).toEqual(expect.arrayContaining(incidentTriggers));
    expect(DATABASE_TRIGGERS.length).toBeGreaterThan(30);
  });

  test("a trigger that offers Run Workflow as a test says, in that paragraph, that the workflow may still be off", () => {
    const missing: Array<string> = [];

    for (const entry of TRIGGERS_WITH_A_TESTING_TOPIC) {
      const runWorkflowParagraphs: Array<string> =
        entry.topic.paragraphs.filter((paragraph: string): boolean => {
          return paragraph.includes(RUN_WORKFLOW);
        });

      if (
        runWorkflowParagraphs.length === 0 ||
        !runWorkflowParagraphs.every((paragraph: string): boolean => {
          return paragraph.endsWith(` ${WORKFLOW_TEST_WHILE_OFF_HELP}`);
        })
      ) {
        missing.push(entry.metadata.id);
      }
    }

    expect(missing).toEqual([]);
  });

  test("it is said once, after how to start the run, never on its own", () => {
    for (const entry of TRIGGERS_WITH_A_TESTING_TOPIC) {
      const text: string = entry.topic.paragraphs.join("\n");

      expect(text.split(WORKFLOW_TEST_WHILE_OFF_HELP)).toHaveLength(2);
      expect(entry.topic.paragraphs).not.toContain(
        WORKFLOW_TEST_WHILE_OFF_HELP,
      );
      expect(text.indexOf(RUN_WORKFLOW)).toBeLessThan(
        text.indexOf(WORKFLOW_TEST_WHILE_OFF_HELP),
      );
    }
  });

  test("no Testing it tells anyone to turn the workflow on before Run Workflow", () => {
    for (const entry of TRIGGERS_WITH_A_TESTING_TOPIC) {
      for (const paragraph of entry.topic.paragraphs) {
        if (!paragraph.includes(RUN_WORKFLOW)) {
          continue;
        }

        expect(paragraph).not.toContain("Turn the workflow on");
        expect(paragraph).not.toContain(ONCE_ON);
      }
    }
  });
});

describe("the real trigger, offered as a way to test, still needs the workflow on", () => {
  test("Webhook: the request under Try it is run once the workflow is on", () => {
    const topic: ComponentDocumentationTopic = testingTopicOf(
      docsOf(builtIn(ComponentID.Webhook)),
    )!;

    expect(topic.paragraphs).toEqual([
      `Click **Run Workflow** in the builder's toolbar to start a run with headers, query parameters and a body you type in. ${WORKFLOW_TEST_WHILE_OFF_HELP}`,
      "Or, once the workflow is on, copy the request under **Try it** at the top of this dialog and run it in a terminal.",
    ]);
  });

  test("Incoming Email: a real email is sent once the workflow is on", () => {
    const topic: ComponentDocumentationTopic = testingTopicOf(
      docsOf(builtIn(ComponentID.IncomingEmail)),
    )!;

    expect(topic.paragraphs).toEqual([
      `Click **Run Workflow** in the builder's toolbar and fill in a sender, a subject and a body. The values you leave out arrive empty. ${WORKFLOW_TEST_WHILE_OFF_HELP}`,
      "Or, once the workflow is on, send a real email to the address and open the workflow's runs to see what it brought.",
    ]);
  });

  test("Schedule: Run Workflow starts a run at once, on or off", () => {
    const topic: ComponentDocumentationTopic = testingTopicOf(
      docsOf(builtIn(ComponentID.Schedule)),
    )!;

    expect(topic.paragraphs).toEqual([
      `Click **Run Workflow** in the builder's toolbar to start a run straight away, without waiting for the schedule. ${WORKFLOW_TEST_WHILE_OFF_HELP}`,
    ]);
  });

  test("every other paragraph of a Testing it that starts the trigger for real says it needs the workflow on", () => {
    for (const entry of TRIGGERS_WITH_A_TESTING_TOPIC) {
      for (const paragraph of entry.topic.paragraphs) {
        if (paragraph.includes(RUN_WORKFLOW)) {
          continue;
        }

        expect(paragraph).toContain(ONCE_ON);
      }
    }
  });

  test("the steps above still say the trigger starts nothing until the workflow is turned on", () => {
    const steps: (id: ComponentID) => string = (id: ComponentID): string => {
      return docsOf(builtIn(id)).steps.join("\n");
    };

    expect(steps(ComponentID.Webhook)).toContain(
      "Turn the workflow on. While it is off, calls to the URL are refused.",
    );
    expect(steps(ComponentID.IncomingEmail)).toContain(
      "Turn the workflow on. While it is off, email to the address is ignored.",
    );
    expect(steps(ComponentID.Schedule)).toContain(
      "Turn the workflow on. Nothing is scheduled while it is off.",
    );

    for (const metadata of DATABASE_TRIGGERS) {
      expect(docsOf(metadata).steps.join("\n")).toContain(
        "Turn the workflow on.",
      );
    }
  });

  test("and the server's refusal of a call to the URL says the trigger is what is paused", () => {
    expect(WORKFLOW_TURNED_OFF_MESSAGE).toContain(
      "so its trigger can't start it",
    );
  });
});
