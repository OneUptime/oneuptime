/**
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */

import ApiDelete from "../../../../../Server/Types/Workflow/Components/API/Delete";
import ApiGet from "../../../../../Server/Types/Workflow/Components/API/Get";
import ApiGetById from "../../../../../Server/Types/Workflow/Components/API/GetById";
import ApiPatch from "../../../../../Server/Types/Workflow/Components/API/Patch";
import ApiPost from "../../../../../Server/Types/Workflow/Components/API/Post";
import ApiPut from "../../../../../Server/Types/Workflow/Components/API/Put";
import { API_COMPONENT_MAX_RESPONSE_BYTES } from "../../../../../Server/Types/Workflow/Components/API/Utils";
import ZabbixUpdateProblem, {
  ZABBIX_MAX_RESPONSE_BYTES,
} from "../../../../../Server/Types/Workflow/Components/Zabbix/UpdateProblem";
import ComponentCode, {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import SafeWebhookRequest from "../../../../../Server/Utils/SafeWebhookRequest";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import http from "http";
import net, { AddressInfo } from "net";

jest.mock("../../../../../Server/Utils/Logger");

/*
 * A WORKFLOW STEP READS AT MOST SO MUCH OF AN ANSWER (issue #8875).
 *
 * The API steps (Get, Get By ID, Post, Put, Patch, Delete) and Update Zabbix
 * Problem used to read an answer of any size: a workflow pointed at an
 * endpoint that streams forever filled the workflow worker's memory, which
 * every project on OneUptime Cloud shares. An API step now reads 10 MB - its
 * answer is the workflow's Response Body, so the limit is generous, the
 * Custom JavaScript step's - and Update Zabbix Problem 1 MB, far more than
 * one event's answer. Past it the step takes its error port, and says why
 * in a sentence rather than in axios's words.
 *
 * These send for real, to a server on this machine that answers with a
 * body of exactly the size a test asks for.
 */

const ALLOWLIST_ENV: string = "PRIVATE_NETWORK_WEBHOOK_ALLOWLIST";
const ALLOW_ENV: string = "ALLOW_PRIVATE_NETWORK_WEBHOOKS";
const PROXY_ENVS: Array<string> = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "http_proxy",
  "https_proxy",
  "ALL_PROXY",
  "all_proxy",
  "NO_PROXY",
  "no_proxy",
];

const MEBIBYTE: number = 1024 * 1024;

let server: http.Server;
let port: number = 0;
let requests: number = 0;
const openSockets: Set<net.Socket> = new Set<net.Socket>();
// What the server answers, by the JSON-RPC method or the path asked.
let answer: (body: string) => string = (): string => {
  return JSON.stringify({ ok: true });
};
const savedEnv: Record<string, string | undefined> = {};

// A JSON object of exactly `bytes` bytes: its other fields, then padding.
function jsonOfSize(bytes: number, fields: JSONObject = {}): string {
  const without: string = JSON.stringify({ ...fields, padding: "" });
  const padding: number = bytes - Buffer.byteLength(without);

  if (padding < 0) {
    throw new Error(`${bytes} bytes cannot hold ${without}.`);
  }

  const body: string = JSON.stringify({
    ...fields,
    padding: "x".repeat(padding),
  });

  expect(Buffer.byteLength(body)).toBe(bytes);

  return body;
}

function makeOptions(): RunOptions {
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
}

async function eventually(check: () => boolean): Promise<void> {
  const deadline: number = Date.now() + 5000;

  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting.");
    }

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 10);
    });
  }
}

beforeAll(async () => {
  server = http.createServer(
    (request: http.IncomingMessage, response: http.ServerResponse) => {
      let body: string = "";

      request.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });

      request.on("end", () => {
        requests++;
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(answer(body));
      });
    },
  );

  server.on("connection", (socket: net.Socket) => {
    openSockets.add(socket);

    socket.on("close", () => {
      openSockets.delete(socket);
    });
  });

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();

  await new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  requests = 0;
  answer = (): string => {
    return JSON.stringify({ ok: true });
  };

  for (const name of [ALLOWLIST_ENV, ALLOW_ENV, ...PROXY_ENVS]) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }

  // Loopback, named exactly: the one way a workflow may reach this machine.
  process.env[ALLOWLIST_ENV] = "127.0.0.0/8";
});

afterEach(() => {
  jest.restoreAllMocks();

  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

test("an API step reads 10 MB of an answer, as the Custom JavaScript step's requests do", () => {
  expect(API_COMPONENT_MAX_RESPONSE_BYTES).toBe(10 * MEBIBYTE);
});

test("Update Zabbix Problem reads 1 MB of an answer", () => {
  expect(ZABBIX_MAX_RESPONSE_BYTES).toBe(MEBIBYTE);
});

const API_STEPS: Array<
  [string, () => ComponentCode, (url: string) => JSONObject]
> = [
  [
    "API Get",
    (): ComponentCode => {
      return new ApiGet();
    },
    (url: string): JSONObject => {
      return { url };
    },
  ],
  [
    "API Get By ID",
    (): ComponentCode => {
      return new ApiGetById();
    },
    (url: string): JSONObject => {
      return { url: `${url}/{id}`, id: "42" };
    },
  ],
  [
    "API Post",
    (): ComponentCode => {
      return new ApiPost();
    },
    (url: string): JSONObject => {
      return { url, "request-body": '{"hello":"world"}' };
    },
  ],
  [
    "API Put",
    (): ComponentCode => {
      return new ApiPut();
    },
    (url: string): JSONObject => {
      return { url, "request-body": '{"hello":"world"}' };
    },
  ],
  [
    "API Patch",
    (): ComponentCode => {
      return new ApiPatch();
    },
    (url: string): JSONObject => {
      return { url, "request-body": '{"hello":"world"}' };
    },
  ],
  [
    "API Delete",
    (): ComponentCode => {
      return new ApiDelete();
    },
    (url: string): JSONObject => {
      return { url };
    },
  ],
];

describe.each(API_STEPS)(
  "%s",
  (
    _name: string,
    createStep: () => ComponentCode,
    argsFor: (url: string) => JSONObject,
  ) => {
    test("an answer larger than 10 MB takes the error port, unread, and Error says so", async () => {
      answer = (): string => {
        return jsonOfSize(API_COMPONENT_MAX_RESPONSE_BYTES + 1);
      };

      const result: RunReturnType = await createStep().run(
        argsFor(`http://127.0.0.1:${port}/items`),
        makeOptions(),
      );

      expect(result.executePort?.id).toBe("error");
      expect(result.returnValues["error"]).toBe(
        "The answer was larger than 10 MB, so it was not read.",
      );
      // Not axios's words, and nothing of the URL.
      expect(String(result.returnValues["error"])).not.toMatch(
        /maxContentLength|127\.0\.0\.1/,
      );
      expect(requests).toBe(1);

      // The connection it was read on is closed, not left streaming.
      await eventually(() => {
        return openSockets.size === 0;
      });
    });

    test("an answer of exactly 10 MB is read whole, and handed on as Response Body", async () => {
      answer = (): string => {
        return jsonOfSize(API_COMPONENT_MAX_RESPONSE_BYTES, { id: 7 });
      };

      const result: RunReturnType = await createStep().run(
        argsFor(`http://127.0.0.1:${port}/items`),
        makeOptions(),
      );

      expect(result.executePort?.id).toBe("success");
      expect(result.returnValues["response-status"]).toBe(200);

      const body: JSONObject = result.returnValues[
        "response-body"
      ] as JSONObject;

      expect(body["id"]).toBe(7);
      expect(String(body["padding"]).length).toBeGreaterThan(
        API_COMPONENT_MAX_RESPONSE_BYTES - 64,
      );
    });

    test("names its limit to the request it sends", async () => {
      const send: SpyInstance<typeof SafeWebhookRequest.send> = jest.spyOn(
        SafeWebhookRequest,
        "send",
      );

      await createStep().run(
        argsFor(`http://127.0.0.1:${port}/items`),
        makeOptions(),
      );

      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0]![1]?.maxContentLength).toBe(
        API_COMPONENT_MAX_RESPONSE_BYTES,
      );
    });
  },
);

describe("Update Zabbix Problem", () => {
  const TOKEN: string = "0424bd59b807674191e7d77572075f33a3f1c0d2b4e6f8091a2b";

  // Zabbix's answer to event.get for problem 40312, open and acknowledgeable.
  const EVENT: JSONObject = {
    jsonrpc: "2.0",
    id: 1,
    result: [
      {
        eventid: "40312",
        r_eventid: "0",
        acknowledged: "0",
        relatedObject: { triggerid: "13491", manual_close: "1" },
      },
    ],
  } as unknown as JSONObject;

  const ACKNOWLEDGED: string = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: { eventids: ["40312"] },
  });

  async function run(): Promise<RunReturnType> {
    return await new ZabbixUpdateProblem().run(
      {
        "zabbix-url": `http://127.0.0.1:${port}/`,
        "api-token": TOKEN,
        "event-id": "40312",
        "what-to-do": "acknowledge",
      },
      makeOptions(),
    );
  }

  test("an answer larger than 1 MB is not read: the step takes Error, saying Zabbix answered too much", async () => {
    answer = (): string => {
      return jsonOfSize(ZABBIX_MAX_RESPONSE_BYTES + 1, EVENT);
    };

    const result: RunReturnType = await run();

    expect(result.executePort?.id).toBe("error");
    expect(result.returnValues["summary"]).toBe(
      "Could not read Zabbix problem 40312: Zabbix's answer was larger than 1 MB, so it was not read.",
    );
    // Zabbix was reached: the step does not say it could not be.
    expect(String(result.returnValues["summary"])).not.toContain(
      "Could not reach",
    );
    // The update is never sent on an answer the step could not read.
    expect(requests).toBe(1);
  });

  test("the update's own answer is held to the same limit", async () => {
    answer = (body: string): string => {
      const method: unknown = (JSON.parse(body) as JSONObject)["method"];

      return method === "event.get"
        ? JSON.stringify(EVENT)
        : jsonOfSize(ZABBIX_MAX_RESPONSE_BYTES + 1, { jsonrpc: "2.0", id: 1 });
    };

    const result: RunReturnType = await run();

    expect(result.executePort?.id).toBe("error");
    expect(result.returnValues["summary"]).toBe(
      "Zabbix did not update problem 40312: Zabbix's answer was larger than 1 MB, so it was not read.",
    );
    expect(requests).toBe(2);
  });

  test("answers of exactly 1 MB are read, and the problem is updated", async () => {
    answer = (body: string): string => {
      const method: unknown = (JSON.parse(body) as JSONObject)["method"];

      return method === "event.get"
        ? jsonOfSize(ZABBIX_MAX_RESPONSE_BYTES, EVENT)
        : jsonOfSize(
            ZABBIX_MAX_RESPONSE_BYTES,
            JSON.parse(ACKNOWLEDGED) as JSONObject,
          );
    };

    const result: RunReturnType = await run();

    expect(result.executePort?.id).toBe("updated");
    expect(requests).toBe(2);
  });

  test("names its limit to both requests it sends", async () => {
    answer = (body: string): string => {
      const method: unknown = (JSON.parse(body) as JSONObject)["method"];

      return method === "event.get" ? JSON.stringify(EVENT) : ACKNOWLEDGED;
    };
    const send: SpyInstance<typeof SafeWebhookRequest.send> = jest.spyOn(
      SafeWebhookRequest,
      "send",
    );

    const result: RunReturnType = await run();

    expect(result.executePort?.id).toBe("updated");
    expect(send).toHaveBeenCalledTimes(2);

    for (const call of send.mock.calls) {
      expect(call[1]?.maxContentLength).toBe(ZABBIX_MAX_RESPONSE_BYTES);
    }
  });
});
