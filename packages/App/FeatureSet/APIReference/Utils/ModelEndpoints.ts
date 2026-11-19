import CodeExampleGenerator, { CodeExamples } from "./CodeExampleGenerator";
import AllModelTypes from "Common/Models/DatabaseModels/Index";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import MoveInListUtil, {
  MOVE_IN_LIST_ROUTE,
} from "Common/Types/Database/MoveInList";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import {
  SCHEDULE_LAYERS_READ_ROUTE,
  SCHEDULE_LAYERS_SAVE_ROUTE,
} from "Common/Types/OnCallDutyPolicy/ScheduleLayersSave";
import { USER_OVERRIDE_END_NOW_ROUTE } from "Common/Types/OnCallDutyPolicy/UserOverrideEdit";
import { getStateListOfTable } from "Common/Utils/StateOrder";

/*
 * THE ENDPOINTS A RESOURCE HAS BESIDE LIST, GET, COUNT, CREATE, UPDATE AND
 * DELETE.
 *
 * Some resources answer routes of their own, under the resource's path, that
 * the model page drew nothing of: a reader of the API Reference could not
 * find them. Each is described here once - its method and route, what it
 * does, the fields it takes and an answer - and the model page draws one
 * section for each, after the resource's own operations, with request
 * examples in every language the page offers (issue #9038).
 *
 * Words are keys of their own strings (pages.modelEndpoints.<key>: the
 * page writes the prefix, so a check of the page's templates reads which
 * strings each draw may ask for), translated in every language the
 * reference is offered in. Field names, routes and the JSON stay as the API
 * writes them.
 */

export interface ModelEndpointField {
  name: string;
  // As the page writes a field's type: text, JSON, array.
  type: string;
  // The key, under pages.modelEndpoints, of what it holds.
  descriptionKey: string;
}

export interface ModelEndpoint {
  // The section's anchor on the page.
  id: string;
  method: "GET" | "POST";
  // Under the resource's API path, ":id" for the record.
  route: string;
  headingKey: string;
  introKey: string;
  requestTitleKey: string;
  // The record the route is for.
  idDescriptionKey: string;
  // What the request body holds, when it has one.
  bodyFields: Array<ModelEndpointField>;
  // An example request body.
  requestBody?: JSONObject | undefined;
  // An example answer.
  response: JSONObject;
  // What it refuses, as keys under pages.modelEndpoints.
  refusalKeys: Array<string>;
}

// An endpoint as the page draws it: its whole path, and request examples.
export interface DrawnModelEndpoint extends ModelEndpoint {
  path: string;
  codeExamples: CodeExamples;
}

const EXAMPLE_LAYER_ID: string = "a1f0c3d2-5b4e-4c6a-9d8e-7f6a5b4c3d21";
const EXAMPLE_SECOND_LAYER_ID: string = "b2e1d4c3-6c5f-4d7b-8e9f-0a1b2c3d4e32";
const EXAMPLE_LAYER_USER_IDS: Array<string> = [
  "c3d2e5f4-7d6a-4e8c-9fa0-1b2c3d4e5f43",
  "d4e3f6a5-8e7b-4f9d-a0b1-2c3d4e5f6a54",
];
const EXAMPLE_USER_IDS: Array<string> = [
  "e5f4a7b6-9f8c-4a0e-b1c2-3d4e5f6a7b65",
  "f6a5b8c7-a09d-4b1f-c2d3-4e5f6a7b8c76",
  "0a1b2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c87",
];
const EXAMPLE_VERSION: string = "1-2-2-1x2c9qkd8f3-k3s8d01mv2a";

// What GET .../layers answers: the layers as a save that changes nothing.
const SAVED_LAYERS: JSONObject = {
  basedOnVersion: EXAMPLE_VERSION,
  layers: [
    {
      layerId: EXAMPLE_LAYER_ID,
      users: [
        {
          layerUserId: EXAMPLE_LAYER_USER_IDS[0]!,
          userId: EXAMPLE_USER_IDS[0]!,
        },
        {
          layerUserId: EXAMPLE_LAYER_USER_IDS[1]!,
          userId: EXAMPLE_USER_IDS[1]!,
        },
      ],
    },
    {
      layerId: EXAMPLE_SECOND_LAYER_ID,
      users: [],
    },
  ],
  deletedLayerIds: [],
};

/*
 * The same layers, changed: the two people of the first layer swap turns,
 * someone is added after them, and the second layer is deleted.
 */
const CHANGED_LAYERS: JSONObject = {
  basedOnVersion: EXAMPLE_VERSION,
  layers: [
    {
      layerId: EXAMPLE_LAYER_ID,
      users: [
        {
          layerUserId: EXAMPLE_LAYER_USER_IDS[1]!,
          userId: EXAMPLE_USER_IDS[1]!,
        },
        {
          layerUserId: EXAMPLE_LAYER_USER_IDS[0]!,
          userId: EXAMPLE_USER_IDS[0]!,
        },
        { userId: EXAMPLE_USER_IDS[2]! },
      ],
    },
  ],
  deletedLayerIds: [EXAMPLE_SECOND_LAYER_ID],
};

/*
 * THE MOVE OF AN ORDERED LIST'S RECORD (issues #9573, #9609, #9613): every
 * resource whose records make up lists put in order - the five numbered by
 * `order` (status page groups and resources, escalation rules, schedule
 * layers and their people) and every list dragged into order
 * (@ListOrderColumn: severities, states, monitor statuses, custom fields,
 * rules, pipelines, filters, status page links...) - answers
 * POST <path>/:id/move. A create or an update of the list's number places
 * the record alone, which is what Terraform needs; moving it past others is
 * this request. The example answer names each record's number under the
 * list's own column, as the API does.
 */

// The record named in the example's placeOfId: the one at the top.
const EXAMPLE_PLACE_OF_ID: string = "7c6b5a49-3827-4e16-9f05-e4d3c2b1a098";

/*
 * Stands in, in an example answer, for the record the page's examples name
 * (getModelEndpoints puts the page's own example ID in its place).
 */
const EXAMPLE_RECORD_ID: string = "{{exampleObjectID}}";

function getMoveEndpoint(model: BaseModel): ModelEndpoint | null {
  const column: string | null = MoveInListUtil.getListColumn(model);

  if (!column) {
    return null;
  }

  // The record moved to the top of a list of two, numbered from the top.
  const countsDown: boolean =
    model.getListOrder()?.sortOrder === SortOrder.Descending;

  return {
    id: "move",
    method: "POST",
    route: MOVE_IN_LIST_ROUTE,
    headingKey: "moveInListHeading",
    introKey: "moveInListIntro",
    requestTitleKey: "moveInListRequestTitle",
    idDescriptionKey: "moveInListIdDescription",
    bodyFields: [
      {
        name: "placeOfId",
        type: "text",
        descriptionKey: "placeOfIdDescription",
      },
    ],
    requestBody: { placeOfId: EXAMPLE_PLACE_OF_ID },
    response: {
      changedRows: [
        { _id: EXAMPLE_RECORD_ID, [column]: countsDown ? 2 : 1 },
        { _id: EXAMPLE_PLACE_OF_ID, [column]: countsDown ? 1 : 2 },
      ],
    },
    refusalKeys: [
      "moveInListPlaceRefused",
      "moveInListRecordNotFound",
      "moveInListNotAllowed",
      // A path's built-in states keep their order (StateOrderGuard).
      ...(getStateListOfTable(model.tableName)?.keepsBuiltInOrder
        ? ["moveInListBuiltInOrder"]
        : []),
    ],
  };
}

// The move of every resource that has one, by its path.
function getMoveEndpoints(): Record<string, Array<ModelEndpoint>> {
  const endpoints: Record<string, Array<ModelEndpoint>> = {};

  for (const modelType of AllModelTypes as unknown as Array<{
    new (): BaseModel;
  }>) {
    const model: BaseModel = new modelType();
    const path: string | undefined = model.crudApiPath?.toString();
    const move: ModelEndpoint | null = getMoveEndpoint(model);

    if (path && move) {
      endpoints[path] = [move];
    }
  }

  return endpoints;
}

// A JSON value with the example record's ID in place of its stand-in.
function withExampleRecordId(value: JSONValue, exampleObjectID: string): JSONValue {
  if (value === EXAMPLE_RECORD_ID) {
    return exampleObjectID;
  }

  if (Array.isArray(value)) {
    return value.map((item: JSONValue): JSONValue => {
      return withExampleRecordId(item, exampleObjectID);
    });
  }

  if (value && typeof value === "object") {
    const copy: JSONObject = {};

    for (const [key, item] of Object.entries(value as JSONObject)) {
      copy[key] = withExampleRecordId(item as JSONValue, exampleObjectID);
    }

    return copy;
  }

  return value;
}

const MODEL_ENDPOINTS: Readonly<Record<string, ReadonlyArray<ModelEndpoint>>> =
  {
    ...getMoveEndpoints(),
    "/on-call-duty-policy-schedule": [
      {
        id: "read-layers",
        method: "GET",
        route: SCHEDULE_LAYERS_READ_ROUTE,
        headingKey: "scheduleLayersReadHeading",
        introKey: "scheduleLayersReadIntro",
        requestTitleKey: "scheduleLayersReadRequestTitle",
        idDescriptionKey: "scheduleIdDescription",
        bodyFields: [],
        response: SAVED_LAYERS,
        refusalKeys: [],
      },
      {
        id: "save-layers",
        method: "POST",
        route: SCHEDULE_LAYERS_SAVE_ROUTE,
        headingKey: "scheduleLayersSaveHeading",
        introKey: "scheduleLayersSaveIntro",
        requestTitleKey: "scheduleLayersSaveRequestTitle",
        idDescriptionKey: "scheduleIdDescription",
        bodyFields: [
          {
            name: "basedOnVersion",
            type: "text",
            descriptionKey: "basedOnVersionDescription",
          },
          {
            name: "layers",
            type: "array",
            descriptionKey: "layersDescription",
          },
          {
            name: "deletedLayerIds",
            type: "array",
            descriptionKey: "deletedLayerIdsDescription",
          },
        ],
        requestBody: CHANGED_LAYERS,
        response: {
          version: "1-1-3-0m4k2c8x1qz-9a1d7e3k5p",
          deletedLayers: 1,
          movedLayers: 0,
          addedLayerUsers: 1,
          removedLayerUsers: 0,
          movedLayerUsers: 2,
        },
        refusalKeys: ["scheduleLayersConflict", "scheduleLayersBadRequest"],
      },
    ],
    "/on-call-duty-policy-user-override": [
      {
        id: "end-now",
        method: "POST",
        route: USER_OVERRIDE_END_NOW_ROUTE,
        headingKey: "userOverrideEndNowHeading",
        introKey: "userOverrideEndNowIntro",
        requestTitleKey: "userOverrideEndNowRequestTitle",
        idDescriptionKey: "userOverrideIdDescription",
        bodyFields: [],
        response: {
          _id: "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d98",
          endsAt: "2026-12-22T12:00:00.000Z",
        },
        refusalKeys: ["userOverrideEndNowRefused"],
      },
    ],
  };

// Every endpoint described here, by the resource path it is under.
export function getDescribedModelEndpoints(): Readonly<
  Record<string, ReadonlyArray<ModelEndpoint>>
> {
  return MODEL_ENDPOINTS;
}

/*
 * The endpoints of a resource beyond its own operations, as its page draws
 * them: none for most. `crudApiPath` is the model's (/on-call-duty-policy-
 * schedule), `apiPath` the whole path the page writes (/api/...), and
 * `exampleObjectID` the record the examples name.
 */
export function getModelEndpoints(data: {
  crudApiPath: string;
  apiPath: string;
  exampleObjectID: string;
}): Array<DrawnModelEndpoint> {
  return (MODEL_ENDPOINTS[data.crudApiPath] || []).map(
    (endpoint: ModelEndpoint): DrawnModelEndpoint => {
      return {
        ...endpoint,
        response: withExampleRecordId(
          endpoint.response,
          data.exampleObjectID,
        ) as JSONObject,
        path: `${data.apiPath}${endpoint.route}`,
        codeExamples: CodeExampleGenerator.generate({
          method: endpoint.method,
          endpoint: `${data.apiPath}${endpoint.route.replace(":id", data.exampleObjectID)}`,
          // A read sends no body.
          ...(endpoint.requestBody ? { body: endpoint.requestBody } : {}),
        }),
      };
    },
  );
}
