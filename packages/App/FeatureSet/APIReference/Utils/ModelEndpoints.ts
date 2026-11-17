import CodeExampleGenerator, { CodeExamples } from "./CodeExampleGenerator";
import { JSONObject } from "Common/Types/JSON";
import {
  SCHEDULE_LAYERS_READ_ROUTE,
  SCHEDULE_LAYERS_SAVE_ROUTE,
} from "Common/Types/OnCallDutyPolicy/ScheduleLayersSave";
import { USER_OVERRIDE_END_NOW_ROUTE } from "Common/Types/OnCallDutyPolicy/UserOverrideEdit";

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

const MODEL_ENDPOINTS: Readonly<Record<string, ReadonlyArray<ModelEndpoint>>> =
  {
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
