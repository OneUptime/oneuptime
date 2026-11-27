import Redis from "../../../../Server/Infrastructure/Redis";
import WorkspaceNotificationRuleService from "../../../../Server/Services/WorkspaceNotificationRuleService";
import logger from "../../../../Server/Utils/Logger";
import WorkspaceCreatedMessageFirst from "../../../../Server/Utils/Workspace/WorkspaceCreatedMessageFirst";
import type WorkspaceCreatedMessageLineType from "../../../../Server/Utils/Workspace/WorkspaceCreatedMessageLine";
import WorkspaceRuleOwnersOnCreate from "../../../../Server/Utils/Workspace/WorkspaceRuleOwnersOnCreate";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../../Types/JSON";
import NotificationRuleEventType from "../../../../Types/Workspace/NotificationRules/EventType";
import API from "../../../../Utils/API";
import CreatedRecordWorld, {
  EXISTING_CHANNEL,
  PLATFORM_TEAM,
} from "../../Services/WorkspaceRules/CreatedRecordWorld";
import {
  COMMANDER,
  INCIDENT_ID,
  makeRule,
} from "../../Services/WorkspaceRules/WorkspaceRuleWorld";
import { jest } from "@jest/globals";

/*
 * ONE APP SERVER OF SEVERAL, AS A PROCESS OF ITS OWN (#11198).
 *
 * Started by WorkspaceCreatedMessageFirstReplicas.test.ts through
 * ReplicaProcess.js, as many times as it needs servers. Each is a project
 * with Slack connected and one rule - every incident posted to the existing
 * channel #platform-alerts - driven through the real services
 * (CreatedRecordWorld: the real IncidentService create chain, the real
 * Incident Commander role, rule matching and posting), with the database in
 * this process's memory, as each App server has its own connections. The
 * hold every server shares is the real one, in the Valkey the test names
 * (VALKEY_HOST, VALKEY_PORT), as App servers share it. And each one posts
 * the messages of a server that was killed before posting them, from what
 * that server stored in Valkey, as App/Index.ts starts every App server to
 * (#11235).
 *
 * Every message posted to Slack is told to the test as it is posted, and
 * answered once the test has it, so the test hears the posts of all its
 * servers in the order Slack would (ReplicaSlackPost).
 *
 * Asked over the IPC channel (ReplicaCommand), it answers each command once
 * it is done (ReplicaAnswer).
 */

export interface ReplicaCommand {
  id: number;
  command:
    | "setUp"
    | "createIncident"
    | "resume"
    | "assignCommander"
    | "postAboutIncident"
    | "drained"
    | "shutDown";
  args?: JSONObject | undefined;
}

export interface ReplicaAnswer {
  id: number;
  ok: boolean;
  result?: JSONObject | undefined;
  error?: string | undefined;
}

export interface ReplicaSlackPost {
  event: "slack";
  replica: string;
  seq: number;
  channel: string;
  text: string;
}

export interface ReplicaPaused {
  event: "paused";
  replica: string;
}

export interface ReplicaReady {
  event: "ready";
  replica: string;
}

export interface ReplicaAck {
  ack: number;
}

const NAME: string = process.env["REPLICA_NAME"] || "replica";

/*
 * The line every server shares (#11198), when the code has it. These
 * servers run the code from before it too - to show what it fixed - where
 * the hold is each server's own and there is nothing to tune or wait for.
 */
function sharedLine(): typeof WorkspaceCreatedMessageLineType | null {
  try {
    /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    return require("../../../../Server/Utils/Workspace/WorkspaceCreatedMessageLine")
      .default;
    /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
  } catch {
    return null;
  }
}

// What the code before the shared line had of the hold: no shutdown of its own.
interface HoldOnShutdown {
  postEverythingHeldHere?: (() => Promise<void>) | undefined;
}

/*
 * What the code before #11235 had of the hold: no server posted another's
 * messages. These servers run that code too, to show what it fixed.
 */
interface HoldTakingOver {
  takeOverForStoppedServers?:
    | ((post: (stored: JSONObject) => Promise<void>) => void)
    | undefined;
}

// What a stored message is posted with on this server, when the code has it.
interface StoredMessagePoster {
  postStoredWorkspaceMarkdownNotification?:
    | ((stored: JSONObject) => Promise<void>)
    | undefined;
}

let world: CreatedRecordWorld | null = null;

// The create chain paused at its first state, and what lets it go on.
let resumeChain: (() => void) | null = null;

let slackPosts: number = 0;
const waitingForTheTest: Map<number, () => void> = new Map<
  number,
  () => void
>();

function send(
  message: ReplicaAnswer | ReplicaSlackPost | ReplicaPaused | ReplicaReady,
): void {
  process.send?.(message);
}

type SlackPost = (data: {
  url: { toString: () => string };
  data: JSONObject;
}) => Promise<HTTPResponse<JSONObject> | HTTPErrorResponse>;

// Each Slack post, told to the test before Slack answers it.
function tellTheTestOfEachPost(): void {
  const answer: SlackPost = (
    API.post as unknown as { getMockImplementation: () => SlackPost }
  ).getMockImplementation();

  jest.spyOn(API, "post").mockImplementation((async (data: {
    url: { toString: () => string };
    data: JSONObject;
  }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
    const method: string = data.url.toString().split("/api/")[1] || "";

    if (method === "chat.postMessage") {
      slackPosts += 1;
      const seq: number = slackPosts;

      await new Promise<void>((resolve: () => void) => {
        waitingForTheTest.set(seq, resolve);
        send({
          event: "slack",
          replica: NAME,
          seq: seq,
          channel: String(data.data["channel"] || ""),
          text: JSON.stringify(data.data["blocks"] || data.data["text"] || ""),
        });
      });
    }

    return await answer(data);
  }) as never);
}

// A time of the hold, set for the test (a static of its class).
function tune(target: unknown, name: string, value: unknown): void {
  if (value !== undefined && value !== null) {
    (target as Record<string, unknown>)[name] = value;
  }
}

// What this server logs goes to the test, which shows it should a test fail.
function logToTheTest(): void {
  for (const level of ["error", "warn"] as const) {
    jest.spyOn(logger, level).mockImplementation(((
      ...args: Array<unknown>
    ): void => {
      process.stderr.write(
        `[${NAME}] ${level}: ${args.map(String).join(" ")}\n`,
      );
    }) as never);
  }

  for (const level of ["info", "debug"] as const) {
    jest.spyOn(logger, level).mockImplementation((() => {
      // quiet
    }) as never);
  }
}

async function setUp(args: JSONObject): Promise<JSONObject> {
  jest.restoreAllMocks();
  logToTheTest();

  world = new CreatedRecordWorld();
  world.install();
  world.addSlackChannel(EXISTING_CHANNEL);
  world.rules = [
    makeRule({
      name: "Every incident",
      eventType: NotificationRuleEventType.Incident,
      createsChannel: false,
      existingChannels: EXISTING_CHANNEL.name,
    }),
  ];

  tellTheTestOfEachPost();

  tune(
    WorkspaceCreatedMessageFirst,
    "HELD_FOR_AT_MOST_MS",
    args["heldForAtMostMs"],
  );
  tune(WorkspaceCreatedMessageFirst, "SHUTDOWN_WAITS_AT_MOST_MS", 200);
  const line: typeof WorkspaceCreatedMessageLineType | null = sharedLine();

  if (line) {
    tune(line, "RELEASED_FOR_AT_MOST_MS", args["releasedForAtMostMs"]);
    tune(line, "STALLED_AFTER_MS", args["stalledAfterMs"]);
    tune(line, "ASKED_EVERY_MS", 20);
    tune(line, "KEPT_EVERY_MS", 300);
    tune(line, "LOOKED_AFTER_EVERY_MS", 200);
    tune(line, "KEY_PREFIX", args["keyPrefix"]);
  }

  if (!Redis.isConnected()) {
    await Redis.connect();
  }

  /*
   * As App/Index.ts starts every App server: posting the messages of a
   * server that was killed before posting them (#11235), when the code has
   * it.
   */
  const takingOver: HoldTakingOver =
    WorkspaceCreatedMessageFirst as unknown as HoldTakingOver;
  const poster: StoredMessagePoster =
    WorkspaceNotificationRuleService as unknown as StoredMessagePoster;

  if (
    takingOver.takeOverForStoppedServers &&
    poster.postStoredWorkspaceMarkdownNotification
  ) {
    takingOver.takeOverForStoppedServers(
      (stored: JSONObject): Promise<void> => {
        return poster.postStoredWorkspaceMarkdownNotification!.call(
          WorkspaceNotificationRuleService,
          stored,
        );
      },
    );
  }

  return {
    replica: NAME,
    takesOver: Boolean(takingOver.takeOverForStoppedServers),
  };
}

async function createIncident(args: JSONObject): Promise<JSONObject> {
  const current: CreatedRecordWorld = world!;

  current.onFirstState = args["pauseAtFirstState"]
    ? async (): Promise<void> => {
        await new Promise<void>((resolve: () => void) => {
          resumeChain = resolve;
          send({ event: "paused", replica: NAME });
        });
      }
    : null;

  if (args["pauseBeforeCreated"]) {
    /*
     * The chain has added the owners picked on create - "Added team
     * Platform to the Incident as the owner" waits in the line - and waits
     * for the owners added outside it: it pauses there, before "Incident
     * Created", until it is told to go on.
     */
    jest
      .spyOn(WorkspaceRuleOwnersOnCreate, "waitForOwnersOfCreate")
      .mockImplementation((async (): Promise<void> => {
        await new Promise<void>((resolve: () => void) => {
          resumeChain = resolve;
          send({ event: "paused", replica: NAME });
        });
      }) as never);
  }

  if (args["failBeforeCreated"]) {
    // The chain stops short of "Incident Created": its .catch lets the held messages go.
    jest
      .spyOn(WorkspaceRuleOwnersOnCreate, "waitForOwnersOfCreate")
      .mockRejectedValue(new Error("the database went away") as never);

    const created: Promise<void> = current.createIncident({
      ownersPicked: { teams: [PLATFORM_TEAM] },
    });

    // Its chain ends in its .catch: nothing tells createIncident it did.
    void created;

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 500);
    });

    return {
      held: WorkspaceCreatedMessageFirst.isHeld({ incidentId: INCIDENT_ID }),
    };
  }

  await current.createIncident({ ownersPicked: { teams: [PLATFORM_TEAM] } });

  return {
    held: WorkspaceCreatedMessageFirst.isHeld({ incidentId: INCIDENT_ID }),
  };
}

async function run(command: ReplicaCommand): Promise<JSONObject> {
  const args: JSONObject = command.args || {};

  switch (command.command) {
    case "setUp":
      return await setUp(args);
    case "createIncident":
      return await createIncident(args);
    case "resume": {
      const resume: (() => void) | null = resumeChain;
      resumeChain = null;
      resume?.();
      return { resumed: Boolean(resume) };
    }
    case "assignCommander":
      // The Dashboard gives the declarer the Incident Commander role as the page opens.
      await world!.assignCommander(COMMANDER);
      return {};
    case "postAboutIncident":
      await world!.postAboutIncident(String(args["markdown"] || ""));
      return {};
    case "drained":
      await sharedLine()?.drained(
        `incidentId:${INCIDENT_ID.toString().toLowerCase()}`,
      );
      return {};
    case "shutDown":
      // What a deploy's SIGTERM does (GracefulShutdown): what waits here goes out.
      await (
        WorkspaceCreatedMessageFirst as unknown as HoldOnShutdown
      ).postEverythingHeldHere?.();
      await Redis.disconnect();
      setTimeout(() => {
        process.exit(0);
      }, 50);
      return {};
  }
}

process.on("message", (message: ReplicaCommand | ReplicaAck): void => {
  if ("ack" in message) {
    const resolve: (() => void) | undefined = waitingForTheTest.get(
      message.ack,
    );
    waitingForTheTest.delete(message.ack);
    resolve?.();
    return;
  }

  run(message)
    .then((result: JSONObject) => {
      send({ id: message.id, ok: true, result: result });
    })
    .catch((error: unknown) => {
      send({
        id: message.id,
        ok: false,
        error:
          error instanceof Error ? error.stack || error.message : String(error),
      });
    });
});

logToTheTest();

send({ event: "ready", replica: NAME });
