import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import WorkspaceProjectChoiceStore, {
  WorkspaceProjectChoicePress,
  WorkspaceProjectChoiceRefusal,
  WorkspaceProjectChoiceTaken,
} from "../../../../Server/Utils/Workspace/WorkspaceProjectChoiceStore";
import { WorkspaceProjectChoice } from "../../../../Server/Utils/Workspace/WorkspaceProjectResolution";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

/*
 * THE REQUEST BEHIND "WHICH PROJECT IS THIS FOR?", AS SLACK AND MICROSOFT
 * TEAMS KEEP IT.
 *
 * A request nothing ties to one of a shared workspace's projects is kept
 * behind a random token while its person chooses: only the token's hash is
 * a key, for thirty minutes, and a press spends it once - only the person
 * who made it, in their workspace, for a project offered. Anything else
 * spends nothing and says why. The same store remembers a project chosen
 * under a key of the chat's own (a conversation with OneUptime AI, a Slack
 * Home).
 */

jest.mock("../../../../Server/Utils/Logger");

jest.mock("../../../../Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: (
      jest.requireActual("../../API/WorkspaceOAuthTestHelpers") as Record<
        string,
        () => unknown
      >
    )["createInMemoryGlobalCache"]!(),
  };
});

const NAMESPACE: string = "test-project-choice";
const TENANT: string = "4220aaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const DEANE: string = "00000000-0000-4000-8000-00000000dea1";
const NITIN: string = "00000000-0000-4000-8000-0000000000a2";

const PLATFORM: ObjectID = new ObjectID("f1000000-0000-4000-8000-000000000001");
const NONPRD: ObjectID = new ObjectID("f1000000-0000-4000-8000-000000000002");
const OTHER: ObjectID = new ObjectID("f1000000-0000-4000-8000-000000000003");

// 32 random bytes, as base64url writes them.
const TOKEN_PATTERN: RegExp = /^[A-Za-z0-9_-]{43}$/;

const CHOICES: Array<WorkspaceProjectChoice> = [
  { projectId: PLATFORM, name: "IRM Platform" },
  { projectId: NONPRD, name: "IRM Non-Prod" },
];

// What a chat keeps: here, a command and where it was typed.
interface TestRequest {
  command: string;
  channel: string;
}

const REQUEST: TestRequest = { command: "oncall", channel: "general" };

function readRequest(request: JSONObject): TestRequest | null {
  return typeof request["command"] === "string" &&
    typeof request["channel"] === "string"
    ? {
        command: request["command"] as string,
        channel: request["channel"] as string,
      }
    : null;
}

interface InMemoryCache {
  store: Map<string, { value: string; expiresAt: number }>;
}

function cache(): InMemoryCache {
  return GlobalCache as unknown as InMemoryCache;
}

// Keeps Deane's request, and gives back what each button carries.
async function keepDeanes(): Promise<Array<WorkspaceProjectChoicePress>> {
  const token: string = await WorkspaceProjectChoiceStore.keep({
    namespace: NAMESPACE,
    workspaceId: TENANT,
    workspaceUserId: DEANE,
    choices: CHOICES,
    request: { command: REQUEST.command, channel: REQUEST.channel },
  });

  return CHOICES.map(
    (choice: WorkspaceProjectChoice): WorkspaceProjectChoicePress => {
      return WorkspaceProjectChoiceStore.readChoice(
        WorkspaceProjectChoiceStore.getChoiceValue({
          projectId: choice.projectId,
          token: token,
        }),
      )!;
    },
  );
}

async function take(data: {
  press: WorkspaceProjectChoicePress;
  workspaceId?: string | undefined;
  workspaceUserId?: string | undefined;
}): Promise<WorkspaceProjectChoiceTaken<TestRequest>> {
  return await WorkspaceProjectChoiceStore.take({
    namespace: NAMESPACE,
    press: data.press,
    workspaceId: "workspaceId" in data ? data.workspaceId : TENANT,
    workspaceUserId: "workspaceUserId" in data ? data.workspaceUserId : DEANE,
    readRequest: readRequest,
  });
}

function refusalOf(taken: WorkspaceProjectChoiceTaken<TestRequest>): string {
  return taken.isTaken ? "taken" : taken.refusal;
}

beforeEach(() => {
  cache().store.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what a button carries", () => {
  test("its project and the token, read back as they were", async () => {
    const presses: Array<WorkspaceProjectChoicePress> = await keepDeanes();

    expect(
      presses.map((press: WorkspaceProjectChoicePress): string => {
        return press.projectId.toString();
      }),
    ).toEqual([PLATFORM.toString(), NONPRD.toString()]);
    expect(presses[0]!.token).toMatch(TOKEN_PATTERN);
    expect(presses[0]!.token).toBe(presses[1]!.token);
    expect(
      WorkspaceProjectChoiceStore.getChoiceValue(presses[0]!),
    ).toBe(`${PLATFORM.toString()}:${presses[0]!.token}`);
  });

  test("anything that is not one names nothing", () => {
    const token: string = "A".repeat(43);

    for (const value of [
      undefined,
      null,
      42,
      {},
      "",
      "no-separator",
      `${PLATFORM.toString()}`,
      `not-a-project:${token}`,
      `${PLATFORM.toString()}:short`,
      `${PLATFORM.toString()}:${"A".repeat(44)}`,
      `${PLATFORM.toString()}:${"A".repeat(42)}!`,
      `${PLATFORM.toString()}:${token}:${token}`,
    ]) {
      expect(WorkspaceProjectChoiceStore.readChoice(value)).toBeNull();
    }

    expect(
      WorkspaceProjectChoiceStore.readChoice(`${PLATFORM.toString()}:${token}`),
    ).toEqual({ projectId: PLATFORM, token: token });
  });
});

describe("keeping a request", () => {
  test("only the token's SHA-256 is a key, for thirty minutes, and neither key nor value holds the token", async () => {
    const presses: Array<WorkspaceProjectChoicePress> = await keepDeanes();

    expect(cache().store.size).toBe(1);

    const [key, entry] = Array.from(cache().store.entries())[0]!;

    expect(key).toBe(
      `${NAMESPACE}-${WorkspaceProjectChoiceStore.hash(presses[0]!.token)}`,
    );
    expect(WorkspaceProjectChoiceStore.hash(presses[0]!.token)).toHaveLength(
      64,
    );
    expect(key).not.toContain(presses[0]!.token);
    expect(entry.value).not.toContain(presses[0]!.token);
    expect(entry.expiresAt - Date.now()).toBeGreaterThan(29 * 60 * 1000);
    expect(entry.expiresAt - Date.now()).toBeLessThanOrEqual(30 * 60 * 1000);
    expect(WorkspaceProjectChoiceStore.EXPIRES_IN_SECONDS).toBe(30 * 60);
  });

  test("with who made it, where, the projects offered in their order, and the chat's request", async () => {
    await keepDeanes();

    expect(
      JSON.parse(Array.from(cache().store.values())[0]!.value),
    ).toEqual({
      workspaceId: TENANT,
      workspaceUserId: DEANE,
      choices: [
        { projectId: PLATFORM.toString(), name: "IRM Platform" },
        { projectId: NONPRD.toString(), name: "IRM Non-Prod" },
      ],
      request: { command: "oncall", channel: "general" },
    });
  });

  test("each request has its own token", async () => {
    const first: Array<WorkspaceProjectChoicePress> = await keepDeanes();
    const second: Array<WorkspaceProjectChoicePress> = await keepDeanes();

    expect(first[0]!.token).not.toBe(second[0]!.token);
    expect(cache().store.size).toBe(2);
  });

  test("a cache that cannot keep it throws: the chat answers as it did before it could ask", async () => {
    jest
      .spyOn(GlobalCache, "setString")
      .mockRejectedValueOnce(new Error("connection refused"));

    await expect(keepDeanes()).rejects.toThrow("connection refused");
    expect(cache().store.size).toBe(0);
  });
});

describe("spending it", () => {
  test("the person who made it, choosing a project offered: the request comes back whole, and is gone", async () => {
    const presses: Array<WorkspaceProjectChoicePress> = await keepDeanes();

    const taken: WorkspaceProjectChoiceTaken<TestRequest> = await take({
      press: presses[1]!,
    });

    expect(taken).toEqual({
      isTaken: true,
      record: {
        workspaceId: TENANT,
        workspaceUserId: DEANE,
        choices: CHOICES,
        request: REQUEST,
      },
      choice: CHOICES[1],
    });
    expect(cache().store.size).toBe(0);
  });

  test("once: the other button, or the same again, is told it is gone", async () => {
    const presses: Array<WorkspaceProjectChoicePress> = await keepDeanes();

    expect(refusalOf(await take({ press: presses[0]! }))).toBe("taken");

    for (const press of presses) {
      expect(refusalOf(await take({ press: press }))).toBe(
        WorkspaceProjectChoiceRefusal.Gone,
      );
    }
  });

  test("two presses at once: one spends it, the other is told it is gone", async () => {
    const presses: Array<WorkspaceProjectChoicePress> = await keepDeanes();

    const outcomes: Array<string> = (
      await Promise.all([
        take({ press: presses[0]! }),
        take({ press: presses[1]! }),
      ])
    ).map(refusalOf);

    expect(outcomes.sort()).toEqual([
      WorkspaceProjectChoiceRefusal.Gone,
      "taken",
    ]);
  });

  test("somebody else's press, or one from another workspace, spends nothing: the person who asked can still choose", async () => {
    const presses: Array<WorkspaceProjectChoicePress> = await keepDeanes();

    for (const who of [
      { workspaceUserId: NITIN },
      { workspaceId: "another-tenant" },
      { workspaceUserId: undefined },
      { workspaceId: undefined },
      { workspaceUserId: "" },
    ]) {
      expect(refusalOf(await take({ press: presses[1]!, ...who }))).toBe(
        WorkspaceProjectChoiceRefusal.NotTheirs,
      );
    }

    expect(cache().store.size).toBe(1);
    expect(refusalOf(await take({ press: presses[1]! }))).toBe("taken");
  });

  test("a project that was not offered - an edited press - spends nothing", async () => {
    const presses: Array<WorkspaceProjectChoicePress> = await keepDeanes();

    expect(
      refusalOf(
        await take({ press: { projectId: OTHER, token: presses[0]!.token } }),
      ),
    ).toBe(WorkspaceProjectChoiceRefusal.NotOffered);
    expect(cache().store.size).toBe(1);
    expect(refusalOf(await take({ press: presses[0]! }))).toBe("taken");
  });

  test("a project offered, written in capitals, is the one offered", async () => {
    const presses: Array<WorkspaceProjectChoicePress> = await keepDeanes();

    const taken: WorkspaceProjectChoiceTaken<TestRequest> = await take({
      press: {
        projectId: new ObjectID(NONPRD.toString().toUpperCase()),
        token: presses[0]!.token,
      },
    });

    expect(taken.isTaken && taken.choice).toEqual(CHOICES[1]);
  });

  test("a token never handed out is gone", async () => {
    await keepDeanes();

    expect(
      refusalOf(
        await take({ press: { projectId: NONPRD, token: "x".repeat(43) } }),
      ),
    ).toBe(WorkspaceProjectChoiceRefusal.Gone);
    expect(cache().store.size).toBe(1);
  });

  test("after thirty minutes it is gone", async () => {
    const presses: Array<WorkspaceProjectChoicePress> = await keepDeanes();

    for (const entry of cache().store.values()) {
      entry.expiresAt = Date.now() - 1;
    }

    expect(refusalOf(await take({ press: presses[0]! }))).toBe(
      WorkspaceProjectChoiceRefusal.Gone,
    );
  });

  test("what is kept that keep did not write is gone - and never handed to the chat", async () => {
    const presses: Array<WorkspaceProjectChoicePress> = await keepDeanes();
    const key: string = Array.from(cache().store.keys())[0]!;
    const request: JSONObject = { command: "oncall", channel: "general" };
    const choice: JSONObject = {
      projectId: PLATFORM.toString(),
      name: "IRM Platform",
    };

    for (const value of [
      "not json",
      "[]",
      "{}",
      "null",
      JSON.stringify({ workspaceUserId: DEANE, choices: [choice], request }),
      JSON.stringify({ workspaceId: TENANT, choices: [choice], request }),
      JSON.stringify({
        workspaceId: "",
        workspaceUserId: DEANE,
        choices: [choice],
        request,
      }),
      JSON.stringify({
        workspaceId: TENANT,
        workspaceUserId: DEANE,
        choices: [],
        request,
      }),
      JSON.stringify({
        workspaceId: TENANT,
        workspaceUserId: DEANE,
        choices: "IRM Platform",
        request,
      }),
      JSON.stringify({
        workspaceId: TENANT,
        workspaceUserId: DEANE,
        choices: [{ ...choice, projectId: "not-a-project" }],
        request,
      }),
      JSON.stringify({
        workspaceId: TENANT,
        workspaceUserId: DEANE,
        choices: [{ ...choice, name: "" }],
        request,
      }),
      JSON.stringify({
        workspaceId: TENANT,
        workspaceUserId: DEANE,
        choices: [choice, "IRM Non-Prod"],
        request,
      }),
      JSON.stringify({
        workspaceId: TENANT,
        workspaceUserId: DEANE,
        choices: [choice],
      }),
      JSON.stringify({
        workspaceId: TENANT,
        workspaceUserId: DEANE,
        choices: [choice],
        request: { command: 42 },
      }),
      // Slack's records before the store was shared: read as gone.
      JSON.stringify({
        teamId: TENANT,
        slackUserId: DEANE,
        choices: [choice],
        request,
      }),
    ]) {
      cache().store.set(key, { value: value, expiresAt: Date.now() + 60000 });

      expect({ value, outcome: refusalOf(await take({ press: presses[0]! })) }).toEqual({
        value,
        outcome: WorkspaceProjectChoiceRefusal.Gone,
      });
    }
  });

  test("a cache that cannot be read is gone, and nothing throws", async () => {
    const presses: Array<WorkspaceProjectChoicePress> = await keepDeanes();

    jest
      .spyOn(GlobalCache, "getString")
      .mockRejectedValueOnce(new Error("connection refused"));

    expect(refusalOf(await take({ press: presses[0]! }))).toBe(
      WorkspaceProjectChoiceRefusal.Gone,
    );
    expect(cache().store.size).toBe(1);
  });

  test("spent by another press between reading it and spending it: gone", async () => {
    const presses: Array<WorkspaceProjectChoicePress> = await keepDeanes();

    jest
      .spyOn(GlobalCache, "getAndDeleteString")
      .mockResolvedValueOnce(null as never);

    expect(refusalOf(await take({ press: presses[0]! }))).toBe(
      WorkspaceProjectChoiceRefusal.Gone,
    );
  });
});

describe("what the buttons and their text say", () => {
  test("a name is a button's text; a longer one is cut to what a button holds, with an ellipsis", () => {
    const max: number = WorkspaceProjectChoiceStore.BUTTON_TITLE_MAX_LENGTH;

    expect(max).toBe(75);
    expect(WorkspaceProjectChoiceStore.getButtonTitle("IRM Platform")).toBe(
      "IRM Platform",
    );
    expect(WorkspaceProjectChoiceStore.getButtonTitle("x".repeat(max))).toBe(
      "x".repeat(max),
    );

    const cut: string = WorkspaceProjectChoiceStore.getButtonTitle(
      "y".repeat(max + 1),
    );

    expect(cut).toHaveLength(max);
    expect(cut).toBe(`${"y".repeat(max - 1)}…`);
  });

  test("projects listed in a sentence: 'A', 'A or B', 'A, B or C'", () => {
    const named: (names: Array<string>) => Array<WorkspaceProjectChoice> = (
      names: Array<string>,
    ): Array<WorkspaceProjectChoice> => {
      return names.map((name: string): WorkspaceProjectChoice => {
        return { projectId: ObjectID.generate(), name: name };
      });
    };

    expect(WorkspaceProjectChoiceStore.getNameList([])).toBe("");
    expect(WorkspaceProjectChoiceStore.getNameList(named(["A"]))).toBe("A");
    expect(WorkspaceProjectChoiceStore.getNameList(named(["A", "B"]))).toBe(
      "A or B",
    );
    expect(
      WorkspaceProjectChoiceStore.getNameList(named(["A", "B", "C"])),
    ).toBe("A, B or C");
  });

  test("as many projects as a row of Slack's buttons holds", () => {
    expect(WorkspaceProjectChoiceStore.MAX_CHOICES).toBe(25);
  });
});

describe("a project remembered under the chat's own key", () => {
  const PARTS: Array<string> = [TENANT, "a:4220-personal-chat", DEANE];

  test("kept under a hash of its parts, which names none of them, for as long as asked", async () => {
    await WorkspaceProjectChoiceStore.rememberProject({
      namespace: NAMESPACE,
      keyParts: PARTS,
      projectId: NONPRD,
      expiresInSeconds: 3600,
    });

    const [key, entry] = Array.from(cache().store.entries())[0]!;

    expect(key).toBe(
      `${NAMESPACE}-${WorkspaceProjectChoiceStore.hash(JSON.stringify(PARTS))}`,
    );

    for (const part of PARTS) {
      expect(key).not.toContain(part);
    }

    expect(entry.value).toBe(NONPRD.toString());
    expect(entry.expiresAt - Date.now()).toBeGreaterThan(3600 * 1000 - 60000);
    expect(entry.expiresAt - Date.now()).toBeLessThanOrEqual(3600 * 1000);
    expect(
      (
        await WorkspaceProjectChoiceStore.getRememberedProject({
          namespace: NAMESPACE,
          keyParts: PARTS,
        })
      )?.toString(),
    ).toBe(NONPRD.toString());
  });

  test("other parts, or another namespace, remember nothing", async () => {
    await WorkspaceProjectChoiceStore.rememberProject({
      namespace: NAMESPACE,
      keyParts: PARTS,
      projectId: NONPRD,
      expiresInSeconds: 3600,
    });

    for (const keyParts of [
      [TENANT, "a:4220-personal-chat", NITIN],
      [TENANT, "a:another-chat", DEANE],
      ["another-tenant", "a:4220-personal-chat", DEANE],
      [TENANT, "a:4220-personal-chat"],
    ]) {
      expect(
        await WorkspaceProjectChoiceStore.getRememberedProject({
          namespace: NAMESPACE,
          keyParts: keyParts,
        }),
      ).toBeNull();
    }

    expect(
      await WorkspaceProjectChoiceStore.getRememberedProject({
        namespace: "another-namespace",
        keyParts: PARTS,
      }),
    ).toBeNull();
  });

  test("remembering again replaces it and starts its time again", async () => {
    await WorkspaceProjectChoiceStore.rememberProject({
      namespace: NAMESPACE,
      keyParts: PARTS,
      projectId: NONPRD,
      expiresInSeconds: 60,
    });
    await WorkspaceProjectChoiceStore.rememberProject({
      namespace: NAMESPACE,
      keyParts: PARTS,
      projectId: PLATFORM,
      expiresInSeconds: 3600,
    });

    expect(cache().store.size).toBe(1);
    expect(
      (
        await WorkspaceProjectChoiceStore.getRememberedProject({
          namespace: NAMESPACE,
          keyParts: PARTS,
        })
      )?.toString(),
    ).toBe(PLATFORM.toString());
    expect(
      Array.from(cache().store.values())[0]!.expiresAt - Date.now(),
    ).toBeGreaterThan(3000 * 1000);
  });

  test("gone once its time has passed", async () => {
    await WorkspaceProjectChoiceStore.rememberProject({
      namespace: NAMESPACE,
      keyParts: PARTS,
      projectId: NONPRD,
      expiresInSeconds: 3600,
    });

    for (const entry of cache().store.values()) {
      entry.expiresAt = Date.now() - 1;
    }

    expect(
      await WorkspaceProjectChoiceStore.getRememberedProject({
        namespace: NAMESPACE,
        keyParts: PARTS,
      }),
    ).toBeNull();
  });

  test("what is kept that is not a project is none", async () => {
    await WorkspaceProjectChoiceStore.rememberProject({
      namespace: NAMESPACE,
      keyParts: PARTS,
      projectId: NONPRD,
      expiresInSeconds: 3600,
    });

    for (const entry of cache().store.values()) {
      entry.value = "not-a-project";
    }

    expect(
      await WorkspaceProjectChoiceStore.getRememberedProject({
        namespace: NAMESPACE,
        keyParts: PARTS,
      }),
    ).toBeNull();
  });

  test("a cache that cannot be written or read remembers nothing, and nothing throws", async () => {
    jest
      .spyOn(GlobalCache, "setString")
      .mockRejectedValueOnce(new Error("connection refused"));

    await expect(
      WorkspaceProjectChoiceStore.rememberProject({
        namespace: NAMESPACE,
        keyParts: PARTS,
        projectId: NONPRD,
        expiresInSeconds: 3600,
      }),
    ).resolves.toBeUndefined();
    expect(cache().store.size).toBe(0);

    await WorkspaceProjectChoiceStore.rememberProject({
      namespace: NAMESPACE,
      keyParts: PARTS,
      projectId: NONPRD,
      expiresInSeconds: 3600,
    });

    jest
      .spyOn(GlobalCache, "getString")
      .mockRejectedValueOnce(new Error("connection refused"));

    expect(
      await WorkspaceProjectChoiceStore.getRememberedProject({
        namespace: NAMESPACE,
        keyParts: PARTS,
      }),
    ).toBeNull();
  });
});

describe("reading what a chat sent", () => {
  test("only the fields named that hold text or a yes or no", () => {
    expect(
      WorkspaceProjectChoiceStore.pickText(
        {
          text: "oncall",
          isGroup: true,
          count: 3,
          nested: { a: "b" },
          list: ["x"],
          empty: "",
          absent: null,
        },
        ["text", "isGroup", "count", "nested", "list", "empty", "absent", "missing"],
      ),
    ).toEqual({ text: "oncall", isGroup: true, empty: "" });
  });

  test("an object is an object; an array or a value is not", () => {
    expect(WorkspaceProjectChoiceStore.asObject({ a: 1 })).toEqual({ a: 1 });

    for (const value of [undefined, null, "x", 1, true, [], [{ a: 1 }]]) {
      expect(WorkspaceProjectChoiceStore.asObject(value)).toBeUndefined();
    }
  });

  test("text is text that is not empty", () => {
    expect(WorkspaceProjectChoiceStore.isText("x")).toBe(true);
    expect(WorkspaceProjectChoiceStore.textOrUndefined("x")).toBe("x");

    for (const value of [undefined, null, "", 1, {}, []]) {
      expect(WorkspaceProjectChoiceStore.isText(value)).toBe(false);
      expect(WorkspaceProjectChoiceStore.textOrUndefined(value)).toBeUndefined();
    }
  });
});
