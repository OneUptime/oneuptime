import { JSONObject } from "Common/Types/JSON";
import IconProp from "Common/Types/Icon/IconProp";
import BadDataException from "Common/Types/Exception/BadDataException";
import ComponentMetadata, {
  Argument,
  ComponentInputType,
  ComponentType,
  NodeDataProp,
  NodeType,
} from "Common/Types/Workflow/Component";
import RunWorkflow, {
  StorageMap,
} from "../../../FeatureSet/Workflow/Services/RunWorkflow";
import { describe, expect, test } from "@jest/globals";

/*
 * The JSON settings of a step - Data, Query and Select - as the runner hands
 * them to the step, with the values of earlier steps in them.
 *
 * https://github.com/OneUptime/oneuptime/issues/4469: Update One Incident's
 * Data of {"customFields": {{local.components.example.returnValues...}}} failed
 * with "Invalid JSON provided for argument data", because the object was
 * escaped as if it sat inside a string. Query and Select, parsed as JSON just
 * the same, took every value raw instead, so a quote in one broke the query.
 */

const UPDATED_CUSTOM_FIELDS: JSONObject = {
  Application: "Example Application",
  Duration: "2 hours",
  Impact: "Service unavailable",
  Locations: ["Location A"],
  "Notification Count": "1",
};

function storageMap(returnValue: JSONObject): StorageMap {
  return {
    local: {
      variables: {},
      components: {
        example: {
          returnValues: {
            returnValue: returnValue,
          },
        },
      },
    },
    global: {
      variables: {},
    },
  };
}

function argument(id: string, type: ComponentInputType): Argument {
  return {
    id: id,
    name: id,
    description: `${id} argument`,
    required: true,
    type: type,
  };
}

function node(
  componentArguments: Array<Argument>,
  values: JSONObject,
): NodeDataProp {
  const metadata: ComponentMetadata = {
    id: "incident-update-one",
    title: "Update One Incident",
    category: "Incident",
    description: "Database query to update one Incident",
    iconProp: IconProp.ArrowCircleUp,
    componentType: ComponentType.Component,
    arguments: componentArguments,
    returnValues: [],
    inPorts: [],
    outPorts: [],
  };

  return {
    error: "",
    id: "update-incident",
    internalId: "update-incident-internal",
    nodeType: NodeType.Node,
    metadata: metadata,
    metadataId: metadata.id,
    arguments: values,
    returnValues: {},
    componentType: ComponentType.Component,
  };
}

const REFERENCE: string =
  "{{local.components.example.returnValues.returnValue.updatedCustomFields}}";

describe("Data (JSON Object): a value on its own", () => {
  test("drops in the custom fields object a JavaScript step returned", () => {
    const args: JSONObject = new RunWorkflow().getComponentArguments(
      storageMap({ updatedCustomFields: UPDATED_CUSTOM_FIELDS }),
      node([argument("data", ComponentInputType.JSON)], {
        data: `{\n  "customFields": ${REFERENCE}\n}`,
      }),
    );

    expect(args["data"]).toEqual({ customFields: UPDATED_CUSTOM_FIELDS });
  });

  test("keeps a value inside quotes a string, as before", () => {
    const args: JSONObject = new RunWorkflow().getComponentArguments(
      storageMap({ updatedCustomFields: UPDATED_CUSTOM_FIELDS }),
      node([argument("data", ComponentInputType.JSON)], {
        data: `{"customFields": "${REFERENCE}"}`,
      }),
    );

    expect(args["data"]).toEqual({
      customFields: JSON.stringify(UPDATED_CUSTOM_FIELDS, null, 2),
    });
  });

  test("sets one custom field from an earlier step's value", () => {
    const args: JSONObject = new RunWorkflow().getComponentArguments(
      storageMap({ count: 2, owner: 'ops "core"' }),
      node([argument("data", ComponentInputType.JSON)], {
        data: '{"customFields": {"Notification Count": {{local.components.example.returnValues.returnValue.count}}, "Owner": "{{local.components.example.returnValues.returnValue.owner}}"}}',
      }),
    );

    expect(args["data"]).toEqual({
      customFields: { "Notification Count": 2, Owner: 'ops "core"' },
    });
  });

  test("still refuses a document that is not JSON, naming the setting", () => {
    expect(() => {
      new RunWorkflow().getComponentArguments(
        storageMap({}),
        node([argument("data", ComponentInputType.JSON)], {
          data: '{"customFields": {{local.components.example.returnValues.returnValue.missing}}}',
        }),
      );
    }).toThrow(BadDataException);

    expect(() => {
      new RunWorkflow().getComponentArguments(
        storageMap({}),
        node([argument("data", ComponentInputType.JSON)], {
          data: '{"customFields": {{local.components.example.returnValues.returnValue.missing}}}',
        }),
      );
    }).toThrow(/Invalid JSON provided for argument data/);
  });
});

describe("Query and Select are JSON documents too", () => {
  test("a quote in a value matched inside a string stays in the string", () => {
    const args: JSONObject = new RunWorkflow().getComponentArguments(
      storageMap({ title: 'Checkout "EU" is down' }),
      node([argument("query", ComponentInputType.Query)], {
        query:
          '{"title": "{{local.components.example.returnValues.returnValue.title}}"}',
      }),
    );

    expect(args["query"]).toEqual({ title: 'Checkout "EU" is down' });
  });

  test("a value cannot add conditions to the query", () => {
    const args: JSONObject = new RunWorkflow().getComponentArguments(
      storageMap({ title: 'x", "isPrivate": "false' }),
      node([argument("query", ComponentInputType.Query)], {
        query:
          '{"title": "{{local.components.example.returnValues.returnValue.title}}"}',
      }),
    );

    expect(args["query"]).toEqual({ title: 'x", "isPrivate": "false' });
  });

  test("a backslash in a matched value is kept, not read as an escape", () => {
    const args: JSONObject = new RunWorkflow().getComponentArguments(
      storageMap({ path: "C:\\logs\\new" }),
      node([argument("query", ComponentInputType.Query)], {
        query:
          '{"description": "{{local.components.example.returnValues.returnValue.path}}"}',
      }),
    );

    expect(args["query"]).toEqual({ description: "C:\\logs\\new" });
  });

  test("an ID or an operator on its own still goes in as the value", () => {
    const args: JSONObject = new RunWorkflow().getComponentArguments(
      storageMap({
        id: "5f2c9a3e-1b7d-4c8e-9f0a-2d6b8e4c1a7f",
        number: 42,
        search: { _type: "Search", value: "checkout" },
      }),
      node([argument("query", ComponentInputType.Query)], {
        query:
          '{"_id": {{local.components.example.returnValues.returnValue.id}}, "incidentNumber": {{local.components.example.returnValues.returnValue.number}}, "title": {{local.components.example.returnValues.returnValue.search}}}',
      }),
    );

    expect(args["query"]).toEqual({
      _id: "5f2c9a3e-1b7d-4c8e-9f0a-2d6b8e4c1a7f",
      incidentNumber: 42,
      title: { _type: "Search", value: "checkout" },
    });
  });

  test("Select is substituted the same way", () => {
    const args: JSONObject = new RunWorkflow().getComponentArguments(
      storageMap({ column: 'title"' }),
      node([argument("select", ComponentInputType.Select)], {
        select:
          '{"{{local.components.example.returnValues.returnValue.column}}": true}',
      }),
    );

    expect(args["select"]).toEqual({ 'title"': true });
  });
});

describe("settings that are not JSON are unchanged", () => {
  test("text takes the value as it is", () => {
    const args: JSONObject = new RunWorkflow().getComponentArguments(
      storageMap({ title: 'Checkout "EU" is down' }),
      node([argument("text", ComponentInputType.Text)], {
        text: "Incident: {{local.components.example.returnValues.returnValue.title}}",
      }),
    );

    expect(args["text"]).toBe('Incident: Checkout "EU" is down');
  });
});
