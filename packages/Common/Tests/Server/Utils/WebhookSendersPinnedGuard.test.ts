import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * EVERY WEBHOOK SENDER DIALS ONLY THE ADDRESS ITS URL CHECK APPROVED (issue
 * #6611).
 *
 * Checking a URL with SSRFProtection.validateWebhookTargetIsSafe and then
 * handing it to API.post is not enough: the HTTP client looks the name up
 * again, and a name that resolved publicly for the check can resolve to an
 * internal address a moment later. A sender checks and sends through
 * SafeWebhookRequest instead, whose socket dials only what the check
 * approved. This reads every server source file and holds it to that:
 *
 *   - validateWebhookTargetIsSafe is called only where a URL is saved,
 *     never where one is sent to - and none of those files sends through
 *     API itself;
 *   - every webhook sender goes through SafeWebhookRequest, and none of them
 *     calls API directly;
 *   - the few that pin on their own (a raw axios caller, the sandbox's
 *     bridge) are the only other callers of validateAndResolveWebhookTarget.
 *
 * A new sender fails the first rule if it copies the old pattern, and a new
 * save-time check is added to SAVE_TIME_CHECKS with a word on why it sends
 * nothing.
 */

const PACKAGES_ROOT: string = path.join(__dirname, "..", "..", "..", "..");
const REPOSITORY_ROOT: string = path.join(PACKAGES_ROOT, "..");

/*
 * The Enterprise Edition's code is here only in a checkout that has ee/:
 * Common Test runs core without it, by construction, so ee's sender is held
 * wherever it is checked out, as the other repo-wide guards hold ee's files.
 */
const EE_PRESENT: boolean = fs.existsSync(path.join(REPOSITORY_ROOT, "ee"));

const SEARCHED: Array<string> = [
  path.join(PACKAGES_ROOT, "Common", "Server"),
  path.join(PACKAGES_ROOT, "Common", "Utils"),
  path.join(PACKAGES_ROOT, "App", "FeatureSet"),
  path.join(REPOSITORY_ROOT, "ee", "Server"),
];

const SKIPPED_FOLDERS: Array<string> = [
  "node_modules",
  "build",
  "dist",
  "Tests",
];

// Browser code: it sends nothing from the server to a URL a person typed.
const SKIPPED_PATHS: Array<string> = [
  "Dashboard",
  "AdminDashboard",
  "StatusPage",
  "Accounts",
  "PublicDashboard",
].map((name: string): string => {
  return path.join(PACKAGES_ROOT, "App", "FeatureSet", name);
});

// Where a URL is checked as it is saved: each sends nothing.
const SAVE_TIME_CHECKS: Record<string, string> = {
  "packages/Common/Server/Utils/StatusPageSubscriberWebhook.ts":
    "assertWebhookUrlAllowed, run when a subscriber is saved; its sender uses SafeWebhookRequest",
  "packages/Common/Server/Services/UserWebhookService.ts":
    "a person's webhook, created or changed",
  "packages/Common/Server/Services/CustomNotificationChannelService.ts":
    "a custom channel, created or changed",
  "packages/Common/Server/Services/GlobalConfigService.ts":
    "the SMS and call gateway's URL, saved",
  "packages/Common/Server/Services/OpenStackProjectNoticeService.ts":
    "an OpenStack project notice, created or changed",
  "packages/Common/Server/API/OpenStackProjectNoticeAPI.ts":
    "an OpenStack project notice, turned on after its preview",
};

// Every webhook sender, and what it sends.
const SENDERS: Record<string, string> = {
  "packages/Common/Server/Utils/StatusPageSubscriberWebhook.ts":
    "a status page subscriber's webhook",
  "packages/App/FeatureSet/Notification/Services/WebhookService.ts":
    "a project's webhook and a person's on-call webhook",
  "packages/App/FeatureSet/Notification/Utils/SignedWebhookPost.ts":
    "the SMS and call gateway's and a custom channel's requests",
  "packages/App/FeatureSet/Notification/Services/CallAndSmsGatewayService.ts":
    "the SMS and call gateway",
  "packages/Common/Server/Types/Workflow/Components/API/Utils.ts":
    "the workflow API steps",
  "packages/Common/Server/Types/Workflow/Components/API/Get.ts": "API Get",
  "packages/Common/Server/Types/Workflow/Components/API/GetById.ts":
    "API Get By ID",
  "packages/Common/Server/Types/Workflow/Components/API/Post.ts": "API Post",
  "packages/Common/Server/Types/Workflow/Components/API/Put.ts": "API Put",
  "packages/Common/Server/Types/Workflow/Components/API/Patch.ts": "API Patch",
  "packages/Common/Server/Types/Workflow/Components/API/Delete.ts":
    "API Delete",
  "packages/Common/Server/Types/Workflow/Components/Zabbix/UpdateProblem.ts":
    "Update Zabbix Problem",
  "packages/Common/Server/Utils/OpenStack/OpenStackProjectNoticeSender.ts":
    "an OpenStack project notice's webhook",
  "packages/Common/Server/Utils/Workspace/Mattermost/Mattermost.ts":
    "every call to a Mattermost server, and its incoming webhooks",
};

// The Enterprise Edition's, held where ee/ is checked out (EE_PRESENT).
const ENTERPRISE_SENDERS: Record<string, string> = {
  "ee/Server/CustomNotificationChannels/CustomChannelSender.ts":
    "a custom channel",
};

const ALL_SENDERS: Record<string, string> = {
  ...SENDERS,
  ...(EE_PRESENT ? ENTERPRISE_SENDERS : {}),
};

// The ones that pin on their own, with the same check and pinned agents.
const OWN_PINNING: Record<string, string> = {
  "packages/Common/Server/Utils/SafeWebhookRequest.ts": "the helper itself",
  "packages/Common/Server/Utils/Mattermost/MattermostWebhook.ts":
    "the Mattermost workflow step, which reads every answer as text",
  "packages/Common/Server/Utils/VM/VMHttpBridge.ts":
    "the JavaScript sandbox's axios bridge (VMRunner's, and a global Runner's for its steps)",
};

function sourceFiles(folder: string): Array<string> {
  const files: Array<string> = [];

  if (!fs.existsSync(folder)) {
    return files;
  }

  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const child: string = path.join(folder, entry.name);

      if (
        !SKIPPED_FOLDERS.includes(entry.name) &&
        !SKIPPED_PATHS.includes(child)
      ) {
        files.push(...sourceFiles(child));
      }
      continue;
    }

    if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".d.ts")
    ) {
      files.push(path.join(folder, entry.name));
    }
  }

  return files;
}

/*
 * The code with its comments taken out - a comment naming a function calls
 * nothing - while string and template literals are kept whole.
 *
 * The code between two comments is kept as one slice of the source, joined
 * once at the end, never built up a character at a time: every `+=` of one
 * character leaves V8 a rope node of its own, about 24 bytes for each byte of
 * source, and this reads every server file - 94 MB on 17.3.0 - before any
 * test flattens them. That held 2.2 GB of one Jest worker's 4 GB heap, and on
 * 17.3.0 it took Common Test's shard 9 past the ceiling: the worker died of
 * "JavaScript heap out of memory", Jest 28 waits forever on a worker killed
 * by a signal, and the shard was cancelled at its 30-minute cap.
 */
function withoutComments(source: string): string {
  const pieces: Array<string> = [];
  let pieceStart: number = 0;
  let quote: string | null = null;

  for (let index: number = 0; index < source.length; index++) {
    const character: string = source[index]!;

    if (quote) {
      if (character === "\\") {
        // The escaped character is kept with it, whatever it is.
        index++;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === "/" && source[index + 1] === "/") {
      pieces.push(source.slice(pieceStart, index));
      const lineEnd: number = source.indexOf("\n", index);
      // The line's end is kept: the code after the comment starts with it.
      index = lineEnd === -1 ? source.length : lineEnd - 1;
      pieceStart = index + 1;
      continue;
    }

    if (character === "/" && source[index + 1] === "*") {
      pieces.push(source.slice(pieceStart, index));
      const commentEnd: number = source.indexOf("*/", index + 2);
      index = commentEnd === -1 ? source.length : commentEnd + 1;
      pieceStart = index + 1;
      continue;
    }

    if (character === '"' || character === "'" || character === "`") {
      quote = character;
    }
  }

  pieces.push(source.slice(pieceStart));

  return pieces.join("");
}

interface SourceFile {
  // From the repository's root, with forward slashes.
  name: string;
  code: string;
}

function readSources(): Array<SourceFile> {
  return SEARCHED.flatMap((folder: string): Array<SourceFile> => {
    return sourceFiles(folder).map((file: string): SourceFile => {
      return {
        name: path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/"),
        code: withoutComments(fs.readFileSync(file, "utf8")),
      };
    });
  });
}

const CALLS_THE_OLD_CHECK: RegExp = /\bvalidateWebhookTargetIsSafe\s*\(/;
const CALLS_THE_PINNING_CHECK: RegExp =
  /\bvalidateAndResolveWebhookTarget\s*\(/;
const CALLS_API: RegExp =
  /\bAPI\s*\.\s*(get|post|put|patch|delete|head|fetch)\s*[<(]/;
const IMPORTS_API: RegExp =
  /import\s+API\b[^;]*from\s+["'][^"']*Utils\/API["']/;
const USES_THE_HELPER: RegExp = /\bSafeWebhookRequest\s*\./;
const USES_THE_API_STEPS_SEND: RegExp = /\bApiComponentUtils\s*\.\s*send\s*\(/;

describe("webhook senders", () => {
  const sources: Array<SourceFile> = readSources();
  const named: (pattern: RegExp) => Array<string> = (
    pattern: RegExp,
  ): Array<string> => {
    return sources
      .filter((source: SourceFile): boolean => {
        return (
          pattern.test(source.code) &&
          source.name !== "packages/Common/Server/Utils/SSRFProtection.ts"
        );
      })
      .map((source: SourceFile): string => {
        return source.name;
      })
      .sort();
  };

  test("are all found where this looks", () => {
    for (const file of [
      ...Object.keys(SAVE_TIME_CHECKS),
      ...Object.keys(ALL_SENDERS),
      ...Object.keys(OWN_PINNING),
    ]) {
      expect({
        file,
        found: sources.some((source: SourceFile): boolean => {
          return source.name === file;
        }),
      }).toEqual({ file, found: true });
    }
  });

  test("validateWebhookTargetIsSafe is called only where a URL is saved, never where one is sent to", () => {
    expect(named(CALLS_THE_OLD_CHECK)).toEqual(
      Object.keys(SAVE_TIME_CHECKS).sort(),
    );
  });

  test("a file that checks a URL as it is saved sends nothing through API itself", () => {
    for (const file of Object.keys(SAVE_TIME_CHECKS)) {
      const source: SourceFile = sources.find(
        (candidate: SourceFile): boolean => {
          return candidate.name === file;
        },
      )!;

      expect({ file, callsApi: CALLS_API.test(source.code) }).toEqual({
        file,
        callsApi: false,
      });
    }
  });

  test("every sender goes through SafeWebhookRequest, and none calls API itself", () => {
    for (const file of Object.keys(ALL_SENDERS)) {
      const source: SourceFile = sources.find(
        (candidate: SourceFile): boolean => {
          return candidate.name === file;
        },
      )!;

      expect({
        file,
        // The workflow steps reach it through ApiComponentUtils.send.
        sendsSafely:
          USES_THE_HELPER.test(source.code) ||
          USES_THE_API_STEPS_SEND.test(source.code),
        callsApi: CALLS_API.test(source.code),
        importsApi: IMPORTS_API.test(source.code),
      }).toEqual({
        file,
        sendsSafely: true,
        callsApi: false,
        importsApi: false,
      });
    }
  });

  test("only the helper, and the two that pin on their own, ask the check for the addresses it approved", () => {
    expect(
      named(CALLS_THE_PINNING_CHECK).filter((file: string): boolean => {
        // The probe's collectors run on a probe, not on this server.
        return !file.startsWith("packages/Probe/");
      }),
    ).toEqual(Object.keys(OWN_PINNING).sort());
  });

  test("the Mattermost step pins on its own: the approved addresses, no proxy and no redirect", () => {
    const step: string = sources.find((source: SourceFile): boolean => {
      return (
        source.name ===
        "packages/Common/Server/Utils/Mattermost/MattermostWebhook.ts"
      );
    })!.code;

    expect(step).toMatch(/DataSourceEgressGuard\.createPinnedAgents\(/);
    expect(step).toMatch(/proxy:\s*false/);
    expect(step).toMatch(/maxRedirects:\s*0/);
    expect(step).toMatch(/adapter:\s*"http"/);
  });
});
