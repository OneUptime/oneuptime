import { describe, expect, test } from "@jest/globals";
import { spawnSync, SpawnSyncReturns } from "child_process";
import path from "path";

/*
 * BOTBUILDER LOADS AS PRODUCTION LOADS IT.
 *
 * The App and the workers start by loading the Teams integration: the status
 * page subscribers, the workspace notification rules and the Microsoft Teams
 * API all import it, and it imports botbuilder through
 * Server/Utils/Workspace/MicrosoftTeams/Botbuilder. botbuilder runs on
 * Common's zod 4 and cannot even be loaded without the two zod 3 names
 * BotbuilderOnZod4 adds ("z.object(...).nonstrict is not a function"), so if
 * that ever went wrong in production the App would not start at all.
 *
 * Production runs the TypeScript sources through ts-node, transpile-only,
 * as CommonJS (the images' `node --require ts-node/register Index.ts`, with
 * TS_NODE_TRANSPILE_ONLY). This starts a fresh Node that does the same with
 * Common's own TypeScript - every .ts file transpiled on its own to CommonJS
 * as it is required, no jest, no mocks - requires Botbuilder.ts itself, and
 * drives what it hands on: the authentication settings the Teams adapter is
 * made from, and a CloudAdapter answering a message. The other end-to-end
 * suites load botbuilder through Tests/Helpers/RealBotbuilder instead, which
 * does what Botbuilder.ts does; this runs the module production runs.
 */

const COMMON_DIRECTORY: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
);
const BOTBUILDER_MODULE: string = path.join(
  COMMON_DIRECTORY,
  "Server",
  "Utils",
  "Workspace",
  "MicrosoftTeams",
  "Botbuilder.ts",
);

interface ProductionLoadReport {
  error: string;
  zodHasNonstrict: boolean;
  classes: Record<string, string>;
  singleTenantAccepted: boolean;
  replies: Array<string>;
  statusCode: number | null;
}

function loadAsProductionDoes(): ProductionLoadReport {
  const script: string = `
    const fs = require("fs");
    const path = require("path");
    const ts = require(${JSON.stringify(require.resolve("typescript"))});

    // ts-node, transpile-only: each .ts file on its own, to CommonJS.
    require.extensions[".ts"] = (module, filename) => {
      const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
        fileName: filename,
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2017,
          esModuleInterop: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
        },
      }).outputText;
      module._compile(output, filename);
    };

    (async () => {
      const botbuilder = require(${JSON.stringify(BOTBUILDER_MODULE)});
      const zodBotbuilderLoads = require(require.resolve("zod", {
        paths: [path.dirname(require.resolve("botbuilder/package.json"))],
      }));

      new botbuilder.ConfigurationBotFrameworkAuthentication({
        MicrosoftAppId: "00000000-0000-0000-0000-000000000001",
        MicrosoftAppPassword: "app-password",
        MicrosoftAppType: "SingleTenant",
        MicrosoftAppTenantId: "00000000-0000-0000-0000-000000000002",
      });

      const adapter = new botbuilder.CloudAdapter(
        new botbuilder.ConfigurationBotFrameworkAuthentication({}),
      );
      const response = {
        statusCode: null,
        body: undefined,
        status(code) { this.statusCode = code; return this; },
        send(body) { this.body = body; return this; },
        header() { return this; },
        end() { return this; },
      };

      await adapter.process(
        {
          method: "POST",
          headers: {},
          body: {
            type: "message",
            id: "production-load-message",
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
        async (context) => {
          await context.sendActivity("pong to " + context.activity.text);
        },
      );

      console.log(JSON.stringify({
        error: "",
        zodHasNonstrict:
          typeof zodBotbuilderLoads.z.object({}).nonstrict === "function",
        classes: {
          CloudAdapter: typeof botbuilder.CloudAdapter,
          TeamsActivityHandler: typeof botbuilder.TeamsActivityHandler,
          TurnContext: typeof botbuilder.TurnContext,
          TeamsInfo: typeof botbuilder.TeamsInfo,
        },
        singleTenantAccepted: true,
        replies: ((response.body && response.body.activities) || []).map(
          (activity) => activity.text,
        ),
        statusCode: response.statusCode,
      }));
    })().catch((error) => {
      console.log(JSON.stringify({
        error: String((error && error.stack) || error),
        zodHasNonstrict: false,
        classes: {},
        singleTenantAccepted: false,
        replies: [],
        statusCode: null,
      }));
    });
  `;

  const result: SpawnSyncReturns<string> = spawnSync(
    process.execPath,
    ["-e", script],
    { cwd: COMMON_DIRECTORY, encoding: "utf8", timeout: 120000 },
  );
  const lines: Array<string> = (result.stdout || "")
    .split("\n")
    .filter((line: string): boolean => {
      return line.startsWith("{");
    });

  if (lines.length === 0) {
    throw new Error(
      `The production load printed no report (exit ${String(result.status)}):\n${result.stderr}`,
    );
  }

  return JSON.parse(lines[lines.length - 1] as string) as ProductionLoadReport;
}

describe("Botbuilder.ts, loaded as production loads it", () => {
  const report: ProductionLoadReport = loadAsProductionDoes();

  test("loads, without zod's 'nonstrict is not a function'", () => {
    expect(report.error).toBe("");
  });

  test("the zod botbuilder loads has the names BotbuilderOnZod4 added", () => {
    expect(report.zodHasNonstrict).toBe(true);
  });

  test("hands on botbuilder's classes the Teams integration imports", () => {
    expect(report.classes).toEqual({
      CloudAdapter: "function",
      TeamsActivityHandler: "function",
      TurnContext: "function",
      TeamsInfo: "function",
    });
  });

  test("accepts the single-tenant settings the Teams adapter is made from", () => {
    expect(report.singleTenantAccepted).toBe(true);
  });

  test("a CloudAdapter answers a message with the bot's reply", () => {
    expect(report.statusCode).toBe(200);
    expect(report.replies).toEqual(["pong to ping"]);
  });
});
