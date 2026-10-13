/*
 * What Run Workflow sends for the trigger (UI/Components/Workflow/RunValues).
 *
 * The panel's JSON boxes hold text while they are edited. The panel meant to
 * send that text as JSON, but parsed the step's return values instead of the
 * values typed into the panel, so a Webhook test received its body as one
 * string where a real request delivers an object, and `request-body.title`
 * came back empty in a test only. These hold that every value is sent the way
 * its trigger receives it for real.
 */

import { getRunValues } from "../../../../UI/Components/Workflow/RunValues";
import Incident from "../../../../Models/DatabaseModels/Incident";
import BuiltInComponents from "../../../../Types/Workflow/Components";
import BaseModelComponent from "../../../../Types/Workflow/Components/BaseModel";
import ComponentMetadata, {
  NodeDataProp,
  NodeType,
} from "../../../../Types/Workflow/Component";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import { JSONObject } from "../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

type NodeOfFunction = (
  metadata: ComponentMetadata,
  values: JSONObject,
) => NodeDataProp;

const nodeOf: NodeOfFunction = (
  metadata: ComponentMetadata,
  values: JSONObject,
): NodeDataProp => {
  return {
    id: `${metadata.id}-1`,
    internalId: "internal",
    nodeType: NodeType.Node,
    componentType: metadata.componentType,
    metadataId: metadata.id,
    metadata: metadata,
    error: "",
    arguments: values,
    returnValues: {},
  };
};

type BuiltInFunction = (id: string) => ComponentMetadata;

const builtIn: BuiltInFunction = (id: string): ComponentMetadata => {
  return BuiltInComponents.find((component: ComponentMetadata): boolean => {
    return component.id === id;
  })!;
};

describe("the values Run Workflow sends", () => {
  test("a Webhook's body typed as JSON arrives as an object, as a real request's does", () => {
    const values: JSONObject = getRunValues(
      nodeOf(builtIn(ComponentID.Webhook), {
        "request-body": '{"incident": {"title": "Database is down"}}',
        "request-headers": { "content-type": "application/json" },
      }),
    );

    expect(values).toEqual({
      "request-body": { incident: { title: "Database is down" } },
      "request-headers": { "content-type": "application/json" },
    });
  });

  test("the Manual trigger's JSON arrives as JSON, so value.name can be read", () => {
    expect(
      getRunValues(nodeOf(builtIn(ComponentID.Manual), { value: '{ "name": "Ada" }' })),
    ).toEqual({ value: { name: "Ada" } });
  });

  test("JSON5, as the steps read it, is read too", () => {
    expect(
      getRunValues(
        nodeOf(builtIn(ComponentID.Manual), { value: "{name: 'Ada', }" }),
      ),
    ).toEqual({ value: { name: "Ada" } });
  });

  test("text that is not JSON is sent as typed, for the run to say what is wrong", () => {
    expect(
      getRunValues(nodeOf(builtIn(ComponentID.Manual), { value: "{ name: " })),
    ).toEqual({ value: "{ name: " });
  });

  test("an empty box is sent empty, as it always was", () => {
    expect(
      getRunValues(nodeOf(builtIn(ComponentID.Manual), { value: "  " })),
    ).toEqual({ value: "  " });
    expect(getRunValues(nodeOf(builtIn(ComponentID.Manual), {}))).toEqual({});
  });

  test("text boxes stay text, and the step's own settings are untouched", () => {
    const onCreate: ComponentMetadata = BaseModelComponent.getComponents(
      new Incident(),
    ).find((component: ComponentMetadata): boolean => {
      return component.id === "incident-on-create";
    })!;

    expect(
      getRunValues(
        nodeOf(onCreate, {
          _id: "  INC-8 ",
          select: '{"title": true}',
        }),
      ),
    ).toEqual({ _id: "INC-8", select: '{"title": true}' });
  });

  test("an Incoming Email's text values stay text", () => {
    const metadata: ComponentMetadata = builtIn(ComponentID.IncomingEmail);
    const values: JSONObject = {};

    for (const argument of metadata.runWorkflowManuallyArguments || []) {
      values[argument.id] = '{"looks": "like json"}';
    }

    const sent: JSONObject = getRunValues(nodeOf(metadata, values));

    for (const argument of metadata.runWorkflowManuallyArguments || []) {
      if (argument.type === "Text" || argument.type === "Long Text") {
        expect(sent[argument.id]).toBe('{"looks": "like json"}');
      }
    }
  });

  test("the panel's own copy of the values is left as it was", () => {
    const node: NodeDataProp = nodeOf(builtIn(ComponentID.Manual), {
      value: '{"name": "Ada"}',
    });

    getRunValues(node);

    expect(node.arguments).toEqual({ value: '{"name": "Ada"}' });
  });
});
