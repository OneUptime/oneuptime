/*
 * Request headers on the API components reach sanitizeArgs in three shapes: a
 * JSON string (every workflow written before the key/value editor), an object
 * (what the key/value editor produces), and whatever a {{...}} substitution
 * left behind. Every consumer downstream casts the result to
 * Dictionary<string> and spreads it into the outgoing request, so the shape
 * has to be settled here.
 */

jest.mock("../../../../../Utils/API", () => {
  return {
    __esModule: true,
    default: {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
    },
  };
});

import ApiGet from "../../../../../Server/Types/Workflow/Components/API/Get";
import { ApiComponentUtils } from "../../../../../Server/Types/Workflow/Components/API/Utils";
import ComponentCode, {
  RunOptions,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import IconProp from "../../../../../Types/Icon/IconProp";
import ComponentMetadata, {
  Argument,
  ComponentInputType,
  ComponentType,
} from "../../../../../Types/Workflow/Component";
import APIComponents from "../../../../../Types/Workflow/Components/API";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import dns from "dns";

type MakeOptionsFunction = () => RunOptions;

const makeOptions: MakeOptionsFunction = (): RunOptions => {
  return {
    log: jest.fn() as RunOptions["log"],
    workflowLogId: ObjectID.generate(),
    workflowId: ObjectID.generate(),
    projectId: ObjectID.generate(),
    onError: ((exception: Exception): Exception => {
      return exception;
    }) as RunOptions["onError"],
    executeWorkflow: async (): Promise<void> => {},
  };
};

type SanitizeFunction = (headers: unknown) => Promise<JSONObject>;

const sanitizeHeaders: SanitizeFunction = async (
  headers: unknown,
): Promise<JSONObject> => {
  const component: ComponentCode = new ApiGet();

  const result: { args: JSONObject } = await ApiComponentUtils.sanitizeArgs(
    component.getMetadata(),
    {
      url: "https://api.example.com/thing",
      "request-headers": headers as JSONObject,
    },
    makeOptions(),
  );

  return result.args["request-headers"] as JSONObject;
};

beforeEach(() => {
  jest.clearAllMocks();
  jest
    .spyOn(dns.promises, "lookup")
    .mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ApiComponentUtils.sanitizeArgs — header shapes", () => {
  test("parses the legacy JSON-string shape", async () => {
    await expect(
      sanitizeHeaders('{"Authorization": "Bearer abc"}'),
    ).resolves.toEqual({
      Authorization: "Bearer abc",
    });
  });

  test("parses a JSON5 string, which has always been accepted here", async () => {
    await expect(sanitizeHeaders("{Authorization: 'Bearer abc'}")).resolves.toEqual(
      {
        Authorization: "Bearer abc",
      },
    );
  });

  test("passes the object shape through", async () => {
    await expect(
      sanitizeHeaders({ Authorization: "Bearer abc" }),
    ).resolves.toEqual({ Authorization: "Bearer abc" });
  });

  test("flattens numbers and booleans the key/value editor can emit", async () => {
    await expect(
      sanitizeHeaders({ "X-Retries": 3, "X-Debug": true }),
    ).resolves.toEqual({
      "X-Retries": "3",
      "X-Debug": "true",
    });
  });

  test("drops null and undefined values instead of sending 'null'", async () => {
    await expect(
      sanitizeHeaders({ "X-A": "keep", "X-B": null }),
    ).resolves.toEqual({ "X-A": "keep" });
  });

  test("serializes a nested value rather than sending [object Object]", async () => {
    await expect(sanitizeHeaders({ "X-Meta": { a: 1 } })).resolves.toEqual({
      "X-Meta": '{"a":1}',
    });
  });

  test("rejects an array, which would spread into per-index junk headers", async () => {
    await expect(sanitizeHeaders("[1, 2]")).rejects.toThrow(
      /Request headers must be a JSON object/,
    );
  });

  test("rejects a bare scalar", async () => {
    await expect(sanitizeHeaders("42")).rejects.toThrow(
      /Request headers must be a JSON object/,
    );
  });

  test("leaves the request alone when no headers were given", async () => {
    const component: ComponentCode = new ApiGet();

    const result: { args: JSONObject } = await ApiComponentUtils.sanitizeArgs(
      component.getMetadata(),
      { url: "https://api.example.com/thing" },
      makeOptions(),
    );

    expect(result.args["request-headers"]).toBeUndefined();
  });
});

describe("API component metadata — headers are treated as secret", () => {
  /*
   * The key/value grid makes pasting a bearer token into a header the obvious
   * thing to do. Without isSensitive the resolved value is written verbatim
   * into the WorkflowLog for anyone who can read the project.
   */
  test("every API component marks request-headers sensitive", () => {
    const componentsWithHeaders: Array<ComponentMetadata> =
      APIComponents.filter((component: ComponentMetadata) => {
        return component.arguments.some((arg: Argument) => {
          return arg.id === "request-headers";
        });
      });

    expect(componentsWithHeaders.length).toBe(5);

    for (const component of componentsWithHeaders) {
      const headerArgument: Argument = component.arguments.find(
        (arg: Argument) => {
          return arg.id === "request-headers";
        },
      ) as Argument;

      expect(headerArgument.isSensitive).toBe(true);
      expect(headerArgument.type).toBe(ComponentInputType.StringDictionary);
    }
  });

  test("the components are the five request verbs", () => {
    expect(
      APIComponents.filter((component: ComponentMetadata) => {
        return component.componentType === ComponentType.Component;
      }).length,
    ).toBeGreaterThanOrEqual(5);

    expect(APIComponents[0]?.iconProp).toBe(IconProp.Globe);
  });
});
