/*
 * What a chip says for a reference: "Webhook › Request Body", not
 * {{local.components.webhook-1.returnValues.request-body}}.
 *
 * And when the reference points at nothing it can be read from - a step
 * that is not there, a value it does not return, a step that runs later, a
 * variable that does not exist - the chip says so, as the issues panel does.
 */

import {
  LABEL_SEPARATOR,
  ReferenceDescription,
  ReferenceKind,
  ReferenceTone,
  describeReference,
  isChipReference,
} from "../../../../../UI/Components/Workflow/ValuePicker/ReferenceDescription";
import Components from "../../../../../Types/Workflow/Components";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import ComponentMetadata, {
  NodeDataProp,
  NodeType,
} from "../../../../../Types/Workflow/Component";
import { describe, expect, test } from "@jest/globals";

type StepFunction = (metadataId: ComponentID, id: string) => NodeDataProp;

const step: StepFunction = (
  metadataId: ComponentID,
  id: string,
): NodeDataProp => {
  const metadata: ComponentMetadata = Components.find(
    (component: ComponentMetadata) => {
      return component.id === metadataId;
    },
  )!;

  return {
    error: "",
    id: id,
    nodeType: NodeType.Node,
    metadata: metadata,
    metadataId: metadata.id,
    internalId: `${id}-internal`,
    arguments: {},
    returnValues: {},
    componentType: metadata.componentType,
  };
};

const webhook: NodeDataProp = step(ComponentID.Webhook, "webhook-1");
const postA: NodeDataProp = step(ComponentID.ApiPost, "api-post-1");
const postB: NodeDataProp = step(ComponentID.ApiPost, "api-post-2");
const slack: NodeDataProp = step(
  ComponentID.SlackSendMessageToChannel,
  "slack-1",
);

const graph: Array<NodeDataProp> = [webhook, postA, postB, slack];

type DescribeFunction = (reference: string) => ReferenceDescription;

const describeInGraph: DescribeFunction = (
  reference: string,
): ReferenceDescription => {
  return describeReference(reference, {
    graphComponents: graph,
    editedComponentId: "api-post-1",
    downstreamIds: ["slack-1"],
  })!;
};

describe("isChipReference", () => {
  test("a well-formed reference is a chip", () => {
    expect(
      isChipReference(
        "{{local.components.webhook-1.returnValues.request-body}}",
      ),
    ).toBe(true);
    expect(isChipReference("{{local.variables.DEPLOY_ENV}}")).toBe(true);
    expect(isChipReference("{{global.variables.API_KEY}}")).toBe(true);
    expect(
      isChipReference(
        "{{local.components.webhook-1.returnValues.request-body.alerts[0].status}}",
      ),
    ).toBe(true);
  });

  test("anything the runtime would not resolve as written stays text", () => {
    // Spaces inside the braces: the runtime does not trim them.
    expect(isChipReference("{{ local.variables.x }}")).toBe(false);
    // Loop syntax, and a relative name inside a loop.
    expect(isChipReference("{{#each local.variables.items}}")).toBe(false);
    expect(isChipReference("{{/each}}")).toBe(false);
    expect(isChipReference("{{@index}}")).toBe(false);
    expect(isChipReference("{{this}}")).toBe(false);
    expect(isChipReference("{{status}}")).toBe(false);
    // A root the runtime does not have, and half-written ones.
    expect(isChipReference("{{local.componets.x.returnValues.y}}")).toBe(false);
    expect(isChipReference("{{local.components.x}}")).toBe(false);
    expect(isChipReference("{{local.variables}}")).toBe(false);
    // Not one reference on its own.
    expect(isChipReference("{{local.variables.a}}{{local.variables.b}}")).toBe(
      false,
    );
    expect(isChipReference("x{{local.variables.a}}")).toBe(false);
    expect(isChipReference("")).toBe(false);
  });
});

describe("describeReference", () => {
  test("a step's value: the step's title, then the value's name", () => {
    const description: ReferenceDescription = describeInGraph(
      "{{local.components.webhook-1.returnValues.request-body}}",
    );

    expect(description.kind).toBe(ReferenceKind.StepValue);
    expect(description.source).toBe("Webhook");
    expect(description.parts).toEqual(["Request Body"]);
    expect(description.label).toBe(`Webhook${LABEL_SEPARATOR}Request Body`);
    expect(description.tone).toBe(ReferenceTone.Normal);
    expect(description.problem).toBeUndefined();
  });

  test("a path into the value comes after it", () => {
    expect(
      describeInGraph(
        "{{local.components.webhook-1.returnValues.request-body.alerts[0].labels.alertname}}",
      ).parts,
    ).toEqual(["Request Body", "alerts[0].labels.alertname"]);

    expect(
      describeInGraph(
        "{{local.components.webhook-1.returnValues.request-body[0].name}}",
      ).parts,
    ).toEqual(["Request Body", "[0].name"]);
  });

  test("two steps with one title are told apart by their ids", () => {
    // A reference to the other HTTP POST, which neither runs after nor is this step.
    const description: ReferenceDescription = describeInGraph(
      "{{local.components.api-post-2.returnValues.response-body}}",
    );

    expect(description.source).toBe(`${postB.metadata.title} (api-post-2)`);
    expect(description.tone).toBe(ReferenceTone.Normal);
  });

  test("a variable, and a global one", () => {
    const variable: ReferenceDescription = describeInGraph(
      "{{local.variables.DEPLOY_ENV}}",
    );
    const global: ReferenceDescription = describeInGraph(
      "{{global.variables.API_KEY}}",
    );

    expect([variable.kind, variable.label]).toEqual([
      ReferenceKind.Variable,
      `Variable${LABEL_SEPARATOR}DEPLOY_ENV`,
    ]);
    expect([global.kind, global.label]).toEqual([
      ReferenceKind.GlobalVariable,
      `Global variable${LABEL_SEPARATOR}API_KEY`,
    ]);
    expect(describeInGraph("{{local.variables.config.region}}").parts).toEqual([
      "config",
      "region",
    ]);
  });

  test("not a chip, no description", () => {
    expect(describeReference("{{ local.variables.x }}", {})).toBeNull();
    expect(describeReference("plain text", {})).toBeNull();
  });

  describe("a reference that cannot be read is a warning, saying why", () => {
    test("no step has that id", () => {
      const description: ReferenceDescription = describeInGraph(
        "{{local.components.webhok-1.returnValues.request-body}}",
      );

      expect(description.tone).toBe(ReferenceTone.Warning);
      expect(description.source).toBe("webhok-1");
      expect(description.problem).toBe(
        'No step in this workflow has the ID "webhok-1".',
      );
    });

    test("the step does not return that", () => {
      const description: ReferenceDescription = describeInGraph(
        "{{local.components.webhook-1.returnValues.body}}",
      );

      expect(description.tone).toBe(ReferenceTone.Warning);
      expect(description.parts).toEqual(["body"]);
      expect(description.problem).toMatch(
        /does not return anything called "body"/,
      );
    });

    test("it is this step's own value", () => {
      const description: ReferenceDescription = describeInGraph(
        "{{local.components.api-post-1.returnValues.response-body}}",
      );

      expect(description.tone).toBe(ReferenceTone.Warning);
      expect(description.problem).toMatch(/own value/);
    });

    test("the step runs after this one", () => {
      const description: ReferenceDescription = describeInGraph(
        "{{local.components.slack-1.returnValues.error}}",
      );

      expect(description.tone).toBe(ReferenceTone.Warning);
      expect(description.problem).toBe(
        `"${slack.metadata.title}" runs after this step, so this value is empty here.`,
      );
    });

    test("no variable has that name, once the variables are known", () => {
      const context: Parameters<typeof describeReference>[1] = {
        graphComponents: graph,
        variableNames: { workflow: ["DEPLOY_ENV"], global: ["API_KEY"] },
      };

      expect(
        describeReference("{{local.variables.DEPLOY_ENV}}", context)!.tone,
      ).toBe(ReferenceTone.Normal);
      expect(
        describeReference("{{local.variables.API_KEY}}", context)!.problem,
      ).toBe('There is no workflow variable called "API_KEY".');
      expect(
        describeReference("{{global.variables.DEPLOY_ENV}}", context)!.problem,
      ).toBe('There is no global variable called "DEPLOY_ENV".');
    });

    test("until the variables are known, a variable is not judged", () => {
      expect(
        describeReference("{{local.variables.ANYTHING}}", {
          graphComponents: graph,
        })!.tone,
      ).toBe(ReferenceTone.Normal);
    });
  });

  test("with no workflow to look in, a step's value is named by its ids", () => {
    const description: ReferenceDescription = describeReference(
      "{{local.components.webhook-1.returnValues.request-body.title}}",
      {},
    )!;

    expect(description.source).toBe("webhook-1");
    expect(description.parts).toEqual(["request-body", "title"]);
    expect(description.tone).toBe(ReferenceTone.Normal);
  });
});
