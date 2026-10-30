/*
 * Update Zabbix Problem: what it reads, what it chooses to send, and how it
 * reads Zabbix's answer - against a Zabbix that answers in memory, at
 * API.post, the one function the step sends through.
 *
 * What it must do is what the two Zabbix templates' sixteen steps did:
 * read the problem before acknowledging or closing it, leave one Zabbix
 * already resolved or acknowledged as it is, acknowledge with a message one
 * whose trigger cannot be closed by hand, add a message as asked, and tell
 * Zabbix's refusals - which come with HTTP 200 - from its answers.
 */

import ZabbixUpdateProblem from "../../../../../Server/Types/Workflow/Components/Zabbix/UpdateProblem";
import {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import HTTPErrorResponse from "../../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import URL from "../../../../../Types/API/URL";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONObject, JSONValue } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import ComponentMetadata, {
  Argument,
  Port,
} from "../../../../../Types/Workflow/Component";
import Components from "../../../../../Types/Workflow/Components";
import {
  ZABBIX_CANNOT_CLOSE_SENTENCE,
  ZABBIX_MESSAGE_MAX_LENGTH,
  ZabbixProblemUpdate,
  chooseZabbixUpdate,
  getZabbixApiUrl,
  readZabbixAnswer,
  readZabbixProblemUpdate,
} from "../../../../../Types/Workflow/Components/Zabbix";
import API from "../../../../../Utils/API";
import { afterAll, beforeEach, describe, expect, test } from "@jest/globals";
import dns from "dns";

jest.mock("../../../../../Utils/API", () => {
  return {
    __esModule: true,
    default: { post: jest.fn() },
  };
});

const TOKEN: string =
  "0424bd59b807674191e7d77572075f33a3f1c0d2b4e6f8091a2b3c4d5e6f7a8b";

interface SentRequest {
  url: string;
  method: string;
  params: JSONObject;
  headers: JSONObject;
  doNotFollowRedirects: boolean | undefined;
  // The whole JSON-RPC request, as it is sent.
  body: JSONObject;
}

let sent: Array<SentRequest> = [];

interface ProblemSpec {
  resolved?: boolean;
  acknowledged?: boolean;
  canClose?: boolean;
  missing?: boolean;
}

/*
 * A Zabbix with one problem, 40312: event.get answers with it as specified,
 * and event.acknowledge says it updated it, unless told to refuse.
 */
function zabbixWith(
  problem: ProblemSpec,
  refuse?: JSONObject | undefined,
): void {
  (API.post as unknown as jest.Mock).mockImplementation((async (request: {
    url: URL;
    data: JSONObject;
    headers: JSONObject;
    options: { doNotFollowRedirects?: boolean };
  }): Promise<HTTPResponse<JSONObject>> => {
    sent.push({
      url: request.url.toString(),
      method: String(request.data["method"]),
      params: request.data["params"] as JSONObject,
      headers: request.headers,
      doNotFollowRedirects: request.options.doNotFollowRedirects,
      body: request.data,
    });

    if (request.data["method"] === "event.get") {
      return new HTTPResponse<JSONObject>(
        200,
        {
          jsonrpc: "2.0",
          result: problem.missing
            ? []
            : [
                {
                  eventid: "40312",
                  r_eventid: problem.resolved ? "40399" : "0",
                  acknowledged: problem.acknowledged ? "1" : "0",
                  relatedObject: {
                    triggerid: "13491",
                    manual_close: problem.canClose === false ? "0" : "1",
                  },
                },
              ],
          id: 1,
        } as unknown as JSONObject,
        {},
      );
    }

    if (refuse) {
      return new HTTPResponse<JSONObject>(
        200,
        { jsonrpc: "2.0", error: refuse, id: 1 },
        {},
      );
    }

    return new HTTPResponse<JSONObject>(
      200,
      { jsonrpc: "2.0", result: { eventids: ["40312"] }, id: 1 },
      {},
    );
  }) as never);
}

interface Run {
  result: RunReturnType;
  logs: Array<string>;
}

async function run(args: JSONObject): Promise<Run> {
  const logs: Array<string> = [];

  const result: RunReturnType = await new ZabbixUpdateProblem().run(
    {
      "zabbix-url": "https://zabbix.example.com/",
      "api-token": TOKEN,
      "event-id": "40312",
      ...args,
    },
    {
      log: ((item: unknown): void => {
        logs.push(typeof item === "string" ? item : JSON.stringify(item));
      }) as RunOptions["log"],
      workflowLogId: ObjectID.generate(),
      workflowId: ObjectID.generate(),
      projectId: ObjectID.generate(),
      onError: ((exception: Exception): Exception => {
        return exception;
      }) as RunOptions["onError"],
      executeWorkflow: async (): Promise<void> => {},
    },
  );

  return { result, logs };
}

const lookupSpy: jest.SpiedFunction<
  (
    hostname: string,
    options: { all: true },
  ) => Promise<Array<{ address: string; family: number }>>
> = jest.spyOn(dns.promises, "lookup") as never;

beforeEach(() => {
  jest.clearAllMocks();
  sent = [];
  lookupSpy.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe("the step's metadata", () => {
  test("is Update Zabbix Problem, under Zabbix, with its token kept out of the log", () => {
    const metadata: ComponentMetadata | undefined = Components.find(
      (component: ComponentMetadata) => {
        return component.id === ComponentID.ZabbixUpdateProblem;
      },
    );

    expect(metadata?.title).toBe("Update Zabbix Problem");
    expect(metadata?.category).toBe("Zabbix");
    expect(
      metadata?.outPorts.map((port: Port) => {
        return port.id;
      }),
    ).toEqual(["updated", "unchanged", "error"]);
    expect(
      metadata?.arguments.find((argument: Argument) => {
        return argument.id === "api-token";
      })?.isSensitive,
    ).toBe(true);
  });
});

describe("readZabbixProblemUpdate, getZabbixApiUrl and readZabbixAnswer", () => {
  test.each([
    ["acknowledge", ZabbixProblemUpdate.Acknowledge],
    [" Acknowledged ", ZabbixProblemUpdate.Acknowledge],
    ["close", ZabbixProblemUpdate.Close],
    ["resolve", ZabbixProblemUpdate.Close],
    ["message", ZabbixProblemUpdate.Message],
    ["note", ZabbixProblemUpdate.Message],
    ["", null],
    ["delete", null],
    [undefined, null],
  ])("%p is %p", (value: unknown, expected: ZabbixProblemUpdate | null) => {
    expect(readZabbixProblemUpdate(value)).toBe(expected);
  });

  test("the API is Zabbix's one JSON-RPC endpoint, without a doubled slash", () => {
    expect(getZabbixApiUrl("https://zabbix.example.com")).toBe(
      "https://zabbix.example.com/api_jsonrpc.php",
    );
    expect(getZabbixApiUrl("https://example.com/zabbix///")).toBe(
      "https://example.com/zabbix/api_jsonrpc.php",
    );
  });

  test("an answer is its result, a refusal Zabbix's reason, and anything else not Zabbix", () => {
    expect(readZabbixAnswer({ jsonrpc: "2.0", result: [] })).toEqual({
      result: [],
    });
    expect(
      readZabbixAnswer({
        error: { message: "Application error.", data: "No permissions." },
      }),
    ).toEqual({ error: "Zabbix said: Application error. No permissions." });
    expect(readZabbixAnswer("<html>login</html>").error).toContain(
      "did not come from Zabbix's API",
    );
    expect(readZabbixAnswer('{"result": {"eventids": ["1"]}}')).toEqual({
      result: { eventids: ["1"] },
    });
  });

  test("Zabbix's reason is put on one line, and cut when it is long", () => {
    const answer: { error?: string } = readZabbixAnswer({
      error: { message: "line one\nline two", data: "x".repeat(2000) },
    });

    expect(answer.error).not.toContain("\n");
    expect(String(answer.error).length).toBeLessThan(1100);
  });
});

describe("chooseZabbixUpdate", () => {
  const problem: (spec: ProblemSpec) => JSONValue = (
    spec: ProblemSpec,
  ): JSONValue => {
    return [
      {
        eventid: "40312",
        r_eventid: spec.resolved ? "40399" : "0",
        acknowledged: spec.acknowledged ? "1" : "0",
        relatedObject: { manual_close: spec.canClose === false ? "0" : "1" },
      },
    ];
  };

  test("a long message is cut to what Zabbix keeps", () => {
    const choice: { send: boolean; message?: string } = chooseZabbixUpdate({
      wanted: ZabbixProblemUpdate.Close,
      eventId: "40312",
      message: "m".repeat(5000),
      events: problem({}),
    });

    expect(choice.message).toHaveLength(ZABBIX_MESSAGE_MAX_LENGTH);
  });

  test("a problem that cannot be closed is acknowledged, and its message says why", () => {
    expect(
      chooseZabbixUpdate({
        wanted: ZabbixProblemUpdate.Close,
        eventId: "40312",
        message: "Synced from OneUptime: INC-12 was resolved in OneUptime.",
        events: problem({ canClose: false }),
      }),
    ).toEqual({
      send: true,
      action: 6,
      message: `Synced from OneUptime: INC-12 was resolved in OneUptime. ${ZABBIX_CANNOT_CLOSE_SENTENCE}`,
      summary:
        "Acknowledged Zabbix problem 40312: its trigger does not allow closing problems by hand.",
    });
  });
});

describe("Update Zabbix Problem", () => {
  test("close reads the problem, then closes, acknowledges and adds the message", async () => {
    zabbixWith({});

    const { result } = await run({
      "what-to-do": "close",
      message: "Synced from OneUptime: INC-12 was resolved in OneUptime.",
    });

    expect(result.executePort?.id).toBe("updated");
    expect(result.executePortReason).toBe("Closed Zabbix problem 40312.");
    expect(
      sent.map((request: SentRequest) => {
        return request.method;
      }),
    ).toEqual(["event.get", "event.acknowledge"]);
    expect(sent[0]!.params).toEqual({
      eventids: ["40312"],
      output: ["eventid", "r_eventid", "acknowledged"],
      selectRelatedObject: ["triggerid", "manual_close"],
    });
    expect(sent[1]!.params).toEqual({
      eventids: ["40312"],
      action: 7,
      message: "Synced from OneUptime: INC-12 was resolved in OneUptime.",
    });
  });

  test("sends to Zabbix's endpoint, with the token as a bearer, and no redirects", async () => {
    zabbixWith({});

    await run({ "what-to-do": "acknowledge", message: "Ack" });

    for (const request of sent) {
      expect(request.url).toBe("https://zabbix.example.com/api_jsonrpc.php");
      expect(request.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
      expect(request.doNotFollowRedirects).toBe(true);
    }
  });

  test("without Zabbix 6.0, no request carries the token in its body", async () => {
    zabbixWith({});

    await run({ "what-to-do": "close", message: "Done" });

    expect(sent).toHaveLength(2);

    for (const request of sent) {
      expect(Object.keys(request.body)).toEqual([
        "jsonrpc",
        "method",
        "params",
        "id",
      ]);
    }
  });

  test.each([[true], ["true"]])(
    "Zabbix 6.0 (%p) sends the token as auth, right after jsonrpc, and no Authorization header",
    async (zabbix60: boolean | string) => {
      zabbixWith({});

      const { result } = await run({
        "what-to-do": "close",
        message: "Done",
        "zabbix-6-0": zabbix60,
      });

      expect(result.executePort?.id).toBe("updated");
      expect(sent.map((request: SentRequest) => request.method)).toEqual([
        "event.get",
        "event.acknowledge",
      ]);

      for (const request of sent) {
        expect(request.headers).toEqual({});
        expect(Object.keys(request.body)).toEqual([
          "jsonrpc",
          "auth",
          "method",
          "params",
          "id",
        ]);
        expect(request.body["auth"]).toBe(TOKEN);
        expect(request.doNotFollowRedirects).toBe(true);
      }
    },
  );

  test("Zabbix 6.0 is an advanced switch, off unless turned on", () => {
    const metadata: ComponentMetadata | undefined = Components.find(
      (component: ComponentMetadata) => {
        return component.id === ComponentID.ZabbixUpdateProblem;
      },
    );
    const switchSetting: Argument | undefined = metadata?.arguments.find(
      (argument: Argument) => {
        return argument.id === "zabbix-6-0";
      },
    );

    expect(switchSetting?.name).toBe("Zabbix 6.0");
    expect(switchSetting?.isAdvanced).toBe(true);
    expect(switchSetting?.required).toBe(false);
  });

  test("acknowledge acknowledges with the message", async () => {
    zabbixWith({});

    const { result } = await run({
      "what-to-do": "acknowledge",
      message: "Synced from OneUptime: INC-12 was acknowledged in OneUptime.",
    });

    expect(result.executePortReason).toBe("Acknowledged Zabbix problem 40312.");
    expect(sent[1]!.params["action"]).toBe(6);
  });

  test("a problem whose trigger cannot be closed by hand is acknowledged instead", async () => {
    zabbixWith({ canClose: false });

    const { result } = await run({
      "what-to-do": "close",
      message: "Resolved.",
    });

    expect(result.executePort?.id).toBe("updated");
    expect(sent[1]!.params).toEqual({
      eventids: ["40312"],
      action: 6,
      message: `Resolved. ${ZABBIX_CANNOT_CLOSE_SENTENCE}`,
    });
  });

  test.each([
    [
      "already resolved",
      { resolved: true },
      "close",
      "Zabbix problem 40312 is already resolved in Zabbix, so it was left as it is.",
    ],
    [
      "already resolved, asked to acknowledge",
      { resolved: true },
      "acknowledge",
      "Zabbix problem 40312 is already resolved in Zabbix, so it was left as it is.",
    ],
    [
      "already acknowledged",
      { acknowledged: true },
      "acknowledge",
      "Zabbix problem 40312 is already acknowledged in Zabbix, so it was left as it is.",
    ],
    [
      "not found",
      { missing: true },
      "close",
      "Zabbix has no problem with event ID 40312, or the API token's user cannot see it, so Zabbix was not updated.",
    ],
  ])(
    "leaves a problem %s as it is, and sends nothing after reading it",
    async (
      _name: string,
      problem: ProblemSpec,
      whatToDo: string,
      reason: string,
    ) => {
      zabbixWith(problem);

      const { result } = await run({ "what-to-do": whatToDo, message: "x" });

      expect(result.executePort?.id).toBe("unchanged");
      expect(result.executePortReason).toBe(reason);
      expect(
        sent.map((request: SentRequest) => {
          return request.method;
        }),
      ).toEqual(["event.get"]);
    },
  );

  test("an acknowledged problem is still closed when closing is asked", async () => {
    zabbixWith({ acknowledged: true });

    const { result } = await run({ "what-to-do": "close", message: "x" });

    expect(result.executePort?.id).toBe("updated");
    expect(sent[1]!.params["action"]).toBe(7);
  });

  test("message adds the message, without reading the problem first", async () => {
    zabbixWith({});

    const { result } = await run({
      "what-to-do": "message",
      message: "Synced from OneUptime: private note on INC-12 by Ada.\n\nRolled back.",
    });

    expect(result.executePort?.id).toBe("updated");
    expect(result.executePortReason).toBe(
      "Added the message to Zabbix problem 40312.",
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]!.params).toEqual({
      eventids: ["40312"],
      action: 4,
      message: "Synced from OneUptime: private note on INC-12 by Ada.\n\nRolled back.",
    });
  });

  test("a message longer than Zabbix keeps is cut", async () => {
    zabbixWith({});

    await run({ "what-to-do": "message", message: "m".repeat(5000) });

    expect(String(sent[0]!.params["message"])).toHaveLength(
      ZABBIX_MESSAGE_MAX_LENGTH,
    );
  });

  test("an empty What To Do sends nothing", async () => {
    zabbixWith({});

    const { result } = await run({ "what-to-do": "" });

    expect(result.executePort?.id).toBe("unchanged");
    expect(result.executePortReason).toBe(
      "What To Do is empty, so Zabbix was not updated.",
    );
    expect(sent).toHaveLength(0);
  });

  test("What To Do that is no update the step makes sends nothing, and says so", async () => {
    zabbixWith({});

    const { result } = await run({ "what-to-do": "delete" });

    expect(result.executePort?.id).toBe("unchanged");
    expect(sent).toHaveLength(0);
  });

  test("an empty message to add sends nothing", async () => {
    zabbixWith({});

    const { result } = await run({ "what-to-do": "message", message: " " });

    expect(result.executePort?.id).toBe("unchanged");
    expect(sent).toHaveLength(0);
  });

  test("Zabbix refusing the update goes down Error, with Zabbix's reason", async () => {
    zabbixWith({}, { message: "Application error.", data: "No permissions." });

    const { result } = await run({ "what-to-do": "close", message: "x" });

    expect(result.executePort?.id).toBe("error");
    expect(result.executePortReason).toBe(
      "Zabbix did not update problem 40312: Zabbix said: Application error. No permissions.",
    );
  });

  test("an answer that names no updated event goes down Error", async () => {
    (API.post as unknown as jest.Mock).mockImplementation((async (request: {
      data: JSONObject;
    }): Promise<HTTPResponse<JSONObject>> => {
      sent.push({
        url: "",
        method: String(request.data["method"]),
        params: {},
        headers: {},
        doNotFollowRedirects: true,
      });
      return new HTTPResponse<JSONObject>(
        200,
        { jsonrpc: "2.0", result: { eventids: [] }, id: 1 },
        {},
      );
    }) as never);

    const { result } = await run({ "what-to-do": "message", message: "x" });

    expect(result.executePort?.id).toBe("error");
    expect(result.executePortReason).toBe(
      "Zabbix answered, but did not say it updated problem 40312.",
    );
  });

  test("an HTTP error goes down Error", async () => {
    (API.post as unknown as jest.Mock).mockResolvedValue(
      new HTTPErrorResponse(502, { message: "Bad Gateway" }, {}) as never,
    );

    const { result } = await run({ "what-to-do": "close", message: "x" });

    expect(result.executePort?.id).toBe("error");
    expect(result.executePortReason).toContain(
      "Could not read Zabbix problem 40312: Zabbix answered 502",
    );
  });

  test("a request that never got an answer goes down Error", async () => {
    (API.post as unknown as jest.Mock).mockRejectedValue(
      new Error("socket hang up") as never,
    );

    const { result } = await run({ "what-to-do": "message", message: "x" });

    expect(result.executePort?.id).toBe("error");
    expect(result.executePortReason).toBe("Could not reach Zabbix: socket hang up");
  });

  test.each([
    ["an event ID that is not a number", { "event-id": "40312/../x" }],
    ["an empty event ID", { "event-id": "" }],
    ["an empty token", { "api-token": " " }],
    ["an empty URL", { "zabbix-url": "" }],
  ])("%s goes down Error, and sends nothing", async (_name: string, args: JSONObject) => {
    zabbixWith({});

    const { result } = await run({ "what-to-do": "close", ...args });

    expect(result.executePort?.id).toBe("error");
    expect(sent).toHaveLength(0);
  });

  test("an event ID given as a number is one", async () => {
    zabbixWith({});

    const { result } = await run({
      "what-to-do": "message",
      message: "x",
      "event-id": 40312,
    });

    expect(result.executePort?.id).toBe("updated");
  });

  test("a Zabbix on a private address is refused as the API steps refuse one", async () => {
    lookupSpy.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    zabbixWith({});

    const { result } = await run({ "what-to-do": "close", message: "x" });

    expect(result.executePort?.id).toBe("error");
    expect(sent).toHaveLength(0);
  });
});
