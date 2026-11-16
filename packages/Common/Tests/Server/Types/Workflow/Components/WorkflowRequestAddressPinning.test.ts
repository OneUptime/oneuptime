/**
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */

import ApiDelete from "../../../../../Server/Types/Workflow/Components/API/Delete";
import ApiGet from "../../../../../Server/Types/Workflow/Components/API/Get";
import ApiGetById from "../../../../../Server/Types/Workflow/Components/API/GetById";
import ApiPatch from "../../../../../Server/Types/Workflow/Components/API/Patch";
import ApiPost from "../../../../../Server/Types/Workflow/Components/API/Post";
import ApiPut from "../../../../../Server/Types/Workflow/Components/API/Put";
import { API_COMPONENT_TARGET_VALIDATION } from "../../../../../Server/Types/Workflow/Components/API/Utils";
import ZabbixUpdateProblem from "../../../../../Server/Types/Workflow/Components/Zabbix/UpdateProblem";
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
import dns from "dns";
import http from "http";
import net, { AddressInfo } from "net";

jest.mock("../../../../../Server/Utils/Logger");

/*
 * A WORKFLOW'S REQUEST GOES TO THE ADDRESS ITS URL CHECK APPROVED (issue
 * #6611).
 *
 * The API steps (Get, Get By ID, Post, Put, Patch, Delete) and Update
 * Zabbix Problem check their URL (ApiComponentUtils.sanitizeArgs, with the
 * private-network rule a project member's URL has) and then send - and the
 * socket used to look the name up again, so a name that resolved publicly
 * for the check could be dialled at an internal address a moment later.
 *
 * These send for real, to a server on this machine, under names the check
 * is told about and this machine's resolver is not: only a request that
 * dials what the check approved reaches the server at all. "localhost" is
 * the exception - the check is told it is at 127.0.0.2 while this
 * machine's resolver says 127.0.0.1 - which is how DNS rebinding looks.
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

interface SeenRequest {
  method: string;
  url: string;
  host: string;
  body: string;
}

let server: http.Server;
let port: number = 0;
// Linux answers every 127/8 address on loopback; not every machine does.
let canUse127002: boolean = false;
let seen: Array<SeenRequest> = [];
// What the server answers: a status, and a body.
let answer: (request: SeenRequest) => {
  status: number;
  body: JSONObject;
} = (): { status: number; body: JSONObject } => {
  return { status: 200, body: { ok: true } };
};

// What the URL check's DNS answers, by name. A name not here does not resolve.
let checkAnswers: Record<string, string> = {};
const savedEnv: Record<string, string | undefined> = {};

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

beforeAll(async () => {
  canUse127002 = await new Promise<boolean>(
    (resolve: (value: boolean) => void) => {
      const probe: http.Server = http.createServer();
      probe.once("error", () => {
        resolve(false);
      });
      probe.listen(0, "127.0.0.2", () => {
        probe.close(() => {
          resolve(true);
        });
      });
    },
  );

  server = http.createServer(
    (request: http.IncomingMessage, response: http.ServerResponse) => {
      let body: string = "";

      request.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });

      request.on("end", () => {
        const request_: SeenRequest = {
          method: request.method || "",
          url: request.url || "",
          host: request.headers["host"] || "",
          body: body,
        };

        seen.push(request_);

        const reply: { status: number; body: JSONObject } = answer(request_);

        if (reply.status >= 300 && reply.status < 400) {
          response.writeHead(reply.status, {
            Location: `http://127.0.0.1:${port}/redirected`,
          });
          response.end();
          return;
        }

        response.writeHead(reply.status, {
          "Content-Type": "application/json",
        });
        response.end(JSON.stringify(reply.body));
      });
    },
  );

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
  seen = [];
  answer = (): { status: number; body: JSONObject } => {
    return { status: 200, body: { ok: true } };
  };
  checkAnswers = {};

  for (const name of [ALLOWLIST_ENV, ALLOW_ENV, ...PROXY_ENVS]) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }

  // Loopback, named exactly: the one way a workflow may reach this machine.
  process.env[ALLOWLIST_ENV] = "localhost,127.0.0.0/8";

  jest.spyOn(dns.promises, "lookup").mockImplementation((async (
    hostname: string,
  ) => {
    const address: string | undefined = checkAnswers[hostname];

    if (!address) {
      const error: NodeJS.ErrnoException = new Error(
        `getaddrinfo ENOTFOUND ${hostname}`,
      );
      error.code = "ENOTFOUND";
      throw error;
    }

    return [{ address: address, family: net.isIP(address) }];
  }) as never);
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

const API_STEPS: Array<
  [string, string, () => ComponentCode, (url: string) => JSONObject]
> = [
  [
    "API Get",
    "GET",
    (): ComponentCode => {
      return new ApiGet();
    },
    (url: string): JSONObject => {
      return { url };
    },
  ],
  [
    "API Get By ID",
    "GET",
    (): ComponentCode => {
      return new ApiGetById();
    },
    (url: string): JSONObject => {
      return { url: `${url}/{id}`, id: "42" };
    },
  ],
  [
    "API Post",
    "POST",
    (): ComponentCode => {
      return new ApiPost();
    },
    (url: string): JSONObject => {
      return { url, "request-body": '{"hello":"world"}' };
    },
  ],
  [
    "API Put",
    "PUT",
    (): ComponentCode => {
      return new ApiPut();
    },
    (url: string): JSONObject => {
      return { url, "request-body": '{"hello":"world"}' };
    },
  ],
  [
    "API Patch",
    "PATCH",
    (): ComponentCode => {
      return new ApiPatch();
    },
    (url: string): JSONObject => {
      return { url, "request-body": '{"hello":"world"}' };
    },
  ],
  [
    "API Delete",
    "DELETE",
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
    method: string,
    createStep: () => ComponentCode,
    argsFor: (url: string) => JSONObject,
  ) => {
    test("dials the address the check approved: a name only the check knows is reached", async () => {
      checkAnswers["hooks.pinned.example"] = "127.0.0.1";

      const result: RunReturnType = await createStep().run(
        argsFor(`http://hooks.pinned.example:${port}/items`),
        makeOptions(),
      );

      expect(result.executePort?.id).toBe("success");
      expect(seen).toHaveLength(1);
      expect(seen[0]!.method).toBe(method);
      // The name the step was given, still: the server's virtual host reads it.
      expect(seen[0]!.host).toBe(`hooks.pinned.example:${port}`);
    });

    test("a name that resolves elsewhere after the check is not dialled there", async () => {
      if (!canUse127002) {
        return;
      }

      // This machine resolves localhost to 127.0.0.1, where the server is.
      checkAnswers["localhost"] = "127.0.0.2";

      const result: RunReturnType = await createStep().run(
        argsFor(`http://localhost:${port}/items`),
        makeOptions(),
      );

      expect(result.executePort?.id).toBe("error");
      expect(String(result.returnValues["error"])).toMatch(
        /ECONNREFUSED 127\.0\.0\.2/,
      );
      expect(seen).toHaveLength(0);
    });

    test("follows no redirect: a 302 takes the error port, and where it points is never asked", async () => {
      answer = (): { status: number; body: JSONObject } => {
        return { status: 302, body: {} };
      };

      const result: RunReturnType = await createStep().run(
        argsFor(`http://127.0.0.1:${port}/items`),
        makeOptions(),
      );

      expect(result.executePort?.id).toBe("error");
      expect(result.returnValues["response-status"]).toBe(302);
      expect(
        seen.map((request: SeenRequest) => {
          return request.url;
        }),
      ).not.toContain("/redirected");
      expect(seen).toHaveLength(1);
    });

    test("holds its URL to a project member's rule, and only that", async () => {
      const resolve: SpyInstance<typeof SafeWebhookRequest.resolveTarget> =
        jest.spyOn(SafeWebhookRequest, "resolveTarget");

      await createStep().run(
        argsFor(`http://127.0.0.1:${port}/items`),
        makeOptions(),
      );

      expect(resolve).toHaveBeenCalledTimes(1);
      expect(resolve.mock.calls[0]![1]).toBe(API_COMPONENT_TARGET_VALIDATION);
      expect(API_COMPONENT_TARGET_VALIDATION).toEqual({
        allowPrivateNetworkTargets: true,
      });
    });

    test("a private address is refused where the instance allows none, and reached where it allows them", async () => {
      process.env[ALLOWLIST_ENV] = "";
      checkAnswers["internal.example"] = "10.20.30.40";

      await expect(
        createStep().run(
          argsFor("http://internal.example/items"),
          makeOptions(),
        ),
      ).rejects.toThrow(
        "Webhook URL resolves to a private network address and is not allowed. Self-hosted instances can allow this by setting ALLOW_PRIVATE_NETWORK_WEBHOOKS or PRIVATE_NETWORK_WEBHOOK_ALLOWLIST.",
      );

      process.env[ALLOW_ENV] = "true";

      const send: SpyInstance<typeof SafeWebhookRequest.send> = jest
        .spyOn(SafeWebhookRequest, "send")
        .mockRejectedValue(
          new Error("not sent in this test") as never,
        ) as unknown as SpyInstance<typeof SafeWebhookRequest.send>;

      await createStep().run(
        argsFor("http://internal.example/items"),
        makeOptions(),
      );

      // Sent, to what the check approved.
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0]![0].addresses).toEqual([
        { address: "10.20.30.40", family: 4 },
      ]);
    });
  },
);

describe("Update Zabbix Problem", () => {
  const TOKEN: string = "0424bd59b807674191e7d77572075f33a3f1c0d2b4e6f8091a2b";

  beforeEach(() => {
    // A Zabbix with problem 40312 open, which it acknowledges.
    answer = (request: SeenRequest): { status: number; body: JSONObject } => {
      const rpc: JSONObject = JSON.parse(request.body) as JSONObject;

      if (rpc["method"] === "event.get") {
        return {
          status: 200,
          body: {
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
          } as unknown as JSONObject,
        };
      }

      return {
        status: 200,
        body: {
          jsonrpc: "2.0",
          id: 1,
          result: { eventids: ["40312"] },
        } as unknown as JSONObject,
      };
    };
  });

  async function run(zabbixUrl: string): Promise<RunReturnType> {
    return await new ZabbixUpdateProblem().run(
      {
        "zabbix-url": zabbixUrl,
        "api-token": TOKEN,
        "event-id": "40312",
        "what-to-do": "acknowledge",
      },
      makeOptions(),
    );
  }

  test("checks the address once, and both of its requests dial what that check approved", async () => {
    checkAnswers["zabbix.pinned.example"] = "127.0.0.1";
    const resolve: SpyInstance<typeof SafeWebhookRequest.resolveTarget> =
      jest.spyOn(SafeWebhookRequest, "resolveTarget");

    const result: RunReturnType = await run(
      `http://zabbix.pinned.example:${port}/`,
    );

    expect(result.executePort?.id).toBe("updated");
    expect(
      seen.map((request: SeenRequest) => {
        return [
          request.url,
          (JSON.parse(request.body) as JSONObject)["method"],
        ];
      }),
    ).toEqual([
      ["/api_jsonrpc.php", "event.get"],
      ["/api_jsonrpc.php", "event.acknowledge"],
    ]);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve.mock.calls[0]![1]).toBe(API_COMPONENT_TARGET_VALIDATION);
    expect(dns.promises.lookup).toHaveBeenCalledTimes(1);
  });

  test("a Zabbix whose name resolves elsewhere after the check is not dialled there", async () => {
    if (!canUse127002) {
      return;
    }

    checkAnswers["localhost"] = "127.0.0.2";

    const result: RunReturnType = await run(`http://localhost:${port}/`);

    expect(result.executePort?.id).toBe("error");
    expect(String(result.returnValues["summary"])).toMatch(
      /ECONNREFUSED 127\.0\.0\.2/,
    );
    expect(seen).toHaveLength(0);
  });

  test("follows no redirect", async () => {
    answer = (): { status: number; body: JSONObject } => {
      return { status: 302, body: {} };
    };

    const result: RunReturnType = await run(`http://127.0.0.1:${port}/`);

    expect(result.executePort?.id).toBe("error");
    expect(String(result.returnValues["summary"])).toContain(
      "Zabbix answered 302",
    );
    expect(seen).toHaveLength(1);
  });

  test("a private address is refused where the instance allows none, with the step's own words", async () => {
    process.env[ALLOWLIST_ENV] = "";
    checkAnswers["zabbix.corp.example"] = "10.20.30.40";

    const result: RunReturnType = await run("https://zabbix.corp.example/");

    expect(result.executePort?.id).toBe("error");
    expect(result.returnValues["summary"]).toBe(
      "Webhook URL resolves to a private network address and is not allowed. Self-hosted instances can allow this by setting ALLOW_PRIVATE_NETWORK_WEBHOOKS or PRIVATE_NETWORK_WEBHOOK_ALLOWLIST.",
    );
    expect(seen).toHaveLength(0);
  });
});
