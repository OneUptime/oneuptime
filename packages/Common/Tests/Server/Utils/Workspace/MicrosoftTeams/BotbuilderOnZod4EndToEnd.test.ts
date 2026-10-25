import { describe, expect, test } from "@jest/globals";
import { spawnSync, SpawnSyncReturns } from "child_process";
import fs from "fs";
import path from "path";
import { isVersionAtLeast, PackageJson } from "../../../../Helpers/PackageLock";
import {
  getNativeRequire,
  loadRealBotbuilder,
} from "../../../../Helpers/RealBotbuilder";

/*
 * The REAL botbuilder on Common's zod 4.
 *
 * Every zod 3 is affected by GHSA-mrhx-c7xc-m3w5, and botbuilder 4.23.3 - the
 * Bot Framework SDK the Microsoft Teams integration is built on - asks for
 * zod ^3.23.8. It is the last botbuilder there will be (Microsoft archived
 * microsoft/botbuilder-js in January 2026), so Common's package.json
 * overrides botbuilder's zod with Common's own zod 4 ("botbuilder": { "zod":
 * "$zod" }), and Server/Utils/Workspace/MicrosoftTeams/BotbuilderOnZod4 puts
 * back the two zod 3 names botbuilder calls.
 *
 * These load botbuilder the way production does - Node's own require, on
 * the zod 4 the override installs, with those two names added first
 * (Tests/Helpers/RealBotbuilder) - and drive the parts of it whose zod
 * schemas OneUptime reaches: loading at all, the authentication settings
 * MicrosoftTeamsUtil builds the adapter from, CloudAdapter answering an
 * activity, and a Teams event TeamsActivityHandler parses. The eight
 * *EndToEnd suites under Tests/Server (MicrosoftTeamsCreateCommandsEndToEnd
 * and the rest) run the whole Teams integration on the same stack.
 */

const COMMON_DIRECTORY: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
);

const nativeRequire: NodeJS.Require = getNativeRequire(__filename);

// The parts of botbuilder these tests use, as plainly as they use them.
interface TurnContextLike {
  activity: Record<string, unknown>;
  sendActivity: (text: string) => Promise<unknown>;
}

interface ActivityHandlerLike {
  run: (context: TurnContextLike) => Promise<void>;
  onMessage: (
    handler: (context: TurnContextLike, next: () => Promise<void>) => unknown,
  ) => void;
  onTeamsMeetingStartEvent: (
    handler: (
      meeting: Record<string, unknown>,
      context: TurnContextLike,
      next: () => Promise<void>,
    ) => unknown,
  ) => void;
}

interface BotbuilderLike {
  CloudAdapter: new (authentication: unknown) => {
    process: (
      request: unknown,
      response: unknown,
      logic: (context: TurnContextLike) => Promise<void>,
    ) => Promise<void>;
  };
  ConfigurationBotFrameworkAuthentication: new (
    settings: Record<string, unknown>,
  ) => Record<string, unknown>;
  TeamsActivityHandler: new () => ActivityHandlerLike;
  TestAdapter: new (logic: (context: TurnContextLike) => Promise<void>) => {
    processActivity: (activity: Record<string, unknown>) => Promise<void>;
  };
}

const botbuilder: BotbuilderLike = loadRealBotbuilder(
  __filename,
) as BotbuilderLike;

// A response object CloudAdapter.process accepts (Express-like).
interface RecordedResponse {
  statusCode: number | undefined;
  body: unknown;
  ended: boolean;
  status: (code: number) => RecordedResponse;
  send: (body: unknown) => RecordedResponse;
  header: () => RecordedResponse;
  end: () => RecordedResponse;
}

function recordedResponse(): RecordedResponse {
  const response: RecordedResponse = {
    statusCode: undefined,
    body: undefined,
    ended: false,
    status: (code: number): RecordedResponse => {
      response.statusCode = code;
      return response;
    },
    send: (body: unknown): RecordedResponse => {
      response.body = body;
      return response;
    },
    header: (): RecordedResponse => {
      return response;
    },
    end: (): RecordedResponse => {
      response.ended = true;
      return response;
    },
  };

  return response;
}

describe("botbuilder loads on Common's zod 4", () => {
  test("the zod botbuilder loads is Common's one zod, a version GHSA-mrhx-c7xc-m3w5 does not cover", () => {
    const botbuilderDirectory: string = path.dirname(
      nativeRequire.resolve("botbuilder/package.json"),
    );
    const zodBotbuilderLoads: string = nativeRequire.resolve("zod", {
      paths: [botbuilderDirectory],
    });

    // One file: the zod Common itself imports, so one copy to patch.
    expect(zodBotbuilderLoads).toBe(nativeRequire.resolve("zod"));

    const version: string = String(
      (nativeRequire("zod/package.json") as PackageJson).version,
    );

    expect(isVersionAtLeast(version, "4.6.6")).toBe(true);
  });

  test.each([
    "botbuilder",
    "botbuilder-core",
    "botframework-connector",
    "botframework-schema",
  ])(
    "%s resolves zod to that same copy, with no zod of its own",
    (packageName: string) => {
      const packageDirectory: string = path.join(
        COMMON_DIRECTORY,
        "node_modules",
        packageName,
      );

      expect(fs.existsSync(packageDirectory)).toBe(true);
      expect(
        fs.existsSync(path.join(packageDirectory, "node_modules", "zod")),
      ).toBe(false);
      expect(nativeRequire.resolve("zod", { paths: [packageDirectory] })).toBe(
        nativeRequire.resolve("zod"),
      );
    },
  );

  test("without the two zod 3 names, botbuilder cannot even be loaded - which is why they are added", () => {
    /*
     * A fresh Node, no BotbuilderOnZod4: TeamsActivityHandler calls
     * nonstrict() while botbuilder loads. If this ever loads, zod or
     * botbuilder changed, and BotbuilderOnZod4 may no longer be needed.
     */
    const result: SpawnSyncReturns<string> = spawnSync(
      process.execPath,
      ["-e", 'require("botbuilder")'],
      { cwd: COMMON_DIRECTORY, encoding: "utf8", timeout: 120000 },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("nonstrict is not a function");
  });

  test("with them it loads, with the classes OneUptime uses", () => {
    expect(typeof botbuilder.CloudAdapter).toBe("function");
    expect(typeof botbuilder.ConfigurationBotFrameworkAuthentication).toBe(
      "function",
    );
    expect(typeof botbuilder.TeamsActivityHandler).toBe("function");
  });
});

describe("the authentication settings MicrosoftTeamsUtil builds the adapter from", () => {
  test("a single-tenant app's settings are accepted, as MicrosoftTeamsUtil.getBotAdapter gives them", () => {
    // ConfigurationBotFrameworkAuthentication parses them with .nonstrict().
    expect(() => {
      return new botbuilder.ConfigurationBotFrameworkAuthentication({
        MicrosoftAppId: "00000000-0000-0000-0000-000000000001",
        MicrosoftAppPassword: "app-password",
        MicrosoftAppType: "SingleTenant",
        MicrosoftAppTenantId: "00000000-0000-0000-0000-000000000002",
      });
    }).not.toThrow();
  });

  test("a setting it does not list is not refused (its schema is nonstrict, as on zod 3)", () => {
    expect(() => {
      return new botbuilder.ConfigurationBotFrameworkAuthentication({
        MicrosoftAppId: "00000000-0000-0000-0000-000000000001",
        MicrosoftAppPassword: "app-password",
        MicrosoftAppType: "MultiTenant",
        SomeOtherSetting: "anything",
      });
    }).not.toThrow();
  });

  test("no settings at all is the anonymous adapter the end-to-end suites use", () => {
    expect(() => {
      return new botbuilder.ConfigurationBotFrameworkAuthentication({});
    }).not.toThrow();
  });

  test("a setting of the wrong type is refused with zod's issues in the message (ZodError's errors, as on zod 3)", () => {
    let thrown: unknown = undefined;

    try {
      new botbuilder.ConfigurationBotFrameworkAuthentication({
        MicrosoftAppId: 42,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeDefined();

    const message: string = (thrown as { message: string }).message;

    expect(message).not.toBe("");
    expect(JSON.parse(message)).toEqual([
      expect.objectContaining({
        code: "invalid_type",
        path: ["MicrosoftAppId"],
      }),
    ]);
  });
});

describe("CloudAdapter answers an activity", () => {
  test("a message delivered with expectReplies gets the bot's reply in the HTTP answer", async () => {
    // The anonymous adapter: no app id, so no Authorization header needed.
    const adapter: InstanceType<BotbuilderLike["CloudAdapter"]> =
      new botbuilder.CloudAdapter(
        new botbuilder.ConfigurationBotFrameworkAuthentication({}),
      );
    const response: RecordedResponse = recordedResponse();
    const seen: Array<string> = [];

    await adapter.process(
      {
        method: "POST",
        headers: {},
        body: {
          type: "message",
          id: "botbuilder-on-zod-4-message",
          text: "ping",
          channelId: "msteams",
          serviceUrl: "https://smba.trafficmanager.net/emea/",
          deliveryMode: "expectReplies",
          from: { id: "user-1", name: "A user" },
          recipient: { id: "bot-1", name: "OneUptime" },
          conversation: { id: "conversation-1" },
        },
      },
      response,
      async (context: TurnContextLike): Promise<void> => {
        seen.push(String(context.activity["text"]));
        await context.sendActivity("pong");
      },
    );

    expect(seen).toEqual(["ping"]);
    expect(response.statusCode).toBe(200);
    expect(response.ended).toBe(true);
    expect(
      (
        response.body as { activities: Array<{ text?: string }> }
      ).activities.map((activity: { text?: string }) => {
        return activity.text;
      }),
    ).toEqual(["pong"]);
  });

  test("a body that is not an object is a 400, as on zod 3", async () => {
    const adapter: InstanceType<BotbuilderLike["CloudAdapter"]> =
      new botbuilder.CloudAdapter(
        new botbuilder.ConfigurationBotFrameworkAuthentication({}),
      );
    const response: RecordedResponse = recordedResponse();
    let ran: boolean = false;

    await adapter.process(
      { method: "POST", headers: {}, body: ["not", "an", "activity"] },
      response,
      async (): Promise<void> => {
        ran = true;
      },
    );

    expect(response.statusCode).toBe(400);
    expect(ran).toBe(false);
  });
});

describe("TeamsActivityHandler on zod 4", () => {
  test("a message reaches onMessage", async () => {
    const handler: ActivityHandlerLike = new botbuilder.TeamsActivityHandler();
    const texts: Array<string> = [];

    handler.onMessage(
      async (
        context: TurnContextLike,
        next: () => Promise<void>,
      ): Promise<void> => {
        texts.push(String(context.activity["text"]));
        await next();
      },
    );

    const adapter: InstanceType<BotbuilderLike["TestAdapter"]> =
      new botbuilder.TestAdapter(
        async (context: TurnContextLike): Promise<void> => {
          await handler.run(context);
        },
      );

    await adapter.processActivity({
      type: "message",
      text: "hello",
      channelId: "msteams",
    });

    expect(texts).toEqual(["hello"]);
  });

  test("a Teams meeting start is parsed with its zod schema (made with nonstrict) and handed on", async () => {
    const handler: ActivityHandlerLike = new botbuilder.TeamsActivityHandler();
    const meetings: Array<Record<string, unknown>> = [];

    handler.onTeamsMeetingStartEvent(
      async (
        meeting: Record<string, unknown>,
        _context: TurnContextLike,
        next: () => Promise<void>,
      ): Promise<void> => {
        meetings.push(meeting);
        await next();
      },
    );

    const adapter: InstanceType<BotbuilderLike["TestAdapter"]> =
      new botbuilder.TestAdapter(
        async (context: TurnContextLike): Promise<void> => {
          await handler.run(context);
        },
      );

    await adapter.processActivity({
      type: "event",
      name: "application/vnd.microsoft.meetingStart",
      channelId: "msteams",
      value: {
        Id: "meeting-1",
        JoinUrl: "https://teams.microsoft.com/l/meetup-join/meeting-1",
        MeetingType: "Scheduled",
        Title: "Incident bridge",
        StartTime: "2026-10-25T10:00:00.000Z",
        // Teams sends more than the schema lists.
        TenantId: "tenant-1",
      },
    });

    expect(meetings).toHaveLength(1);
    expect(meetings[0]).toMatchObject({
      id: "meeting-1",
      joinUrl: "https://teams.microsoft.com/l/meetup-join/meeting-1",
      meetingType: "Scheduled",
      title: "Incident bridge",
    });
    expect((meetings[0]!["startTime"] as Date).toISOString()).toBe(
      "2026-10-25T10:00:00.000Z",
    );
  });
});
