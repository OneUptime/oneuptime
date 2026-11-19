import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A SLACK, MICROSOFT TEAMS OR MATTERMOST ID IS NEVER CUT TO FIT (issue #9284).
 *
 * OneUptime keeps the ids the workspaces give - a channel's, a chat's, a
 * team's, a message's, a thread's - to reach those places again: to edit a
 * message it keeps up to date, to find what a message in a channel is
 * about. Every writer of WorkspaceLiveMessage and WorkspaceNotificationLog
 * cut those ids to 100 characters "to fit the column", and a Microsoft
 * Teams personal chat's id - 130 characters and more - became the id of no
 * chat: a page asked for in a personal chat never got its updates there
 * ("This chat is not connected to OneUptime"). The columns are 500
 * characters now, and an id that might not fit goes through
 * WorkspaceStoredValue, which keeps it whole or not at all.
 *
 * This holds the code that reads and writes those tables to it: no file of
 * the workspace layer, and no Workspace*Service, cuts an id with
 * substring, slice or substr from its start. A name may still be cut - it
 * is only shown (WorkspaceStoredValue.channelName).
 */

const COMMON_ROOT: string = path.resolve(__dirname, "../../../..");

// Comments say what the code did; only the code is read.
const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /^\s*\/\/.*$/gm;

/*
 * An id - by the names the workspace layer gives them, or a channel's,
 * chat's, thread's, team's, message's, conversation's or activity's .id -
 * cut from its start, on the same line or across a line break inside the
 * call: "thread.channel.id.substring(0, 100)", "(thread.threadId ||
 * "").substring(0, 100)", "data.result.channelId?.substring(\n 0, ...".
 */
const ID_CUT: RegExp =
  /\b(?:channelId|chatId|threadId|teamId|messageId|conversationId|activityId|replyToId|workspaceUserId|workspaceGroupId|workspaceTeamId|workspaceProjectId|(?:channel|chat|thread|team|message|conversation|activity)\.id)\b[^;\n]{0,24}?\.(?:substring|slice|substr)\(\s*0\s*,/g;

/*
 * Cuts that keep no id to reach a place by, each with why. One that is no
 * longer in its file is taken off this list (a test below says so).
 */
const NOT_A_KEPT_ID: Array<{ file: string; cut: string; why: string }> = [
  {
    file: "Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsAiAnswer.ts",
    cut: "messageId.substring( 0,",
    why: "Bounds the replyToId an incoming feedback activity names - input from outside - before it is hashed into the answer's key and named in a log line. Both ends of the key cut it alike, it is never kept to reach the message, and a Teams activity id is far shorter than the bound.",
  },
  {
    file: "Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsCutChatIds.ts",
    cut: "chatId.substring(0,",
    why: "Works out the id the code before #9284 kept in place of a chat's whole id - its first 100 characters - only to find the rows that still hold it and give them the chat's whole id back (#9330). The cut id is looked for, never written.",
  },
];

function readCode(relativePath: string): string {
  return fs
    .readFileSync(path.join(COMMON_ROOT, relativePath), "utf8")
    .replace(BLOCK_COMMENT, "")
    .replace(LINE_COMMENT, "");
}

// Every .ts file under a folder of Common, as a path from Common's root.
function sourcesUnder(relativeDirectory: string): Array<string> {
  const files: Array<string> = [];
  const directory: string = path.join(COMMON_ROOT, relativeDirectory);

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative: string = path.posix.join(relativeDirectory, entry.name);

    if (entry.isDirectory()) {
      files.push(...sourcesUnder(relative));
    } else if (entry.name.endsWith(".ts")) {
      files.push(relative);
    }
  }

  return files;
}

// The workspace layer, and the services of the workspace tables.
function scannedFiles(): Array<string> {
  const services: Array<string> = fs
    .readdirSync(path.join(COMMON_ROOT, "Server/Services"))
    .filter((name: string): boolean => {
      return name.startsWith("Workspace") && name.endsWith("Service.ts");
    })
    .map((name: string): string => {
      return `Server/Services/${name}`;
    });

  return [...sourcesUnder("Server/Utils/Workspace"), ...services].sort();
}

function idCutsIn(code: string): Array<string> {
  return Array.from(code.matchAll(ID_CUT)).map(
    (match: RegExpMatchArray): string => {
      return match[0].replace(/\s+/g, " ");
    },
  );
}

describe("a workspace's ids are kept whole", () => {
  test("the scan reads the files that write the kept messages and the logs", () => {
    const files: Array<string> = scannedFiles();

    expect(files).toEqual(
      expect.arrayContaining([
        "Server/Utils/Workspace/LiveMessages/WorkspaceLiveMessages.ts",
        "Server/Utils/Workspace/WorkspacePage.ts",
        "Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams.ts",
        "Server/Services/WorkspaceNotificationLogService.ts",
        "Server/Services/WorkspaceNotificationRuleService.ts",
        "Server/Services/WorkspaceNotificationSummaryService.ts",
        "Server/Services/WorkspaceLiveMessageService.ts",
      ]),
    );
    expect(files.length).toBeGreaterThan(100);
  });

  test("REGRESSION #9284: no id is cut from its start anywhere in them", () => {
    const cuts: Array<string> = [];

    for (const file of scannedFiles()) {
      for (const cut of idCutsIn(readCode(file))) {
        const isNotAKeptId: boolean = NOT_A_KEPT_ID.some(
          (allowed: { file: string; cut: string }): boolean => {
            return allowed.file === file && allowed.cut === cut;
          },
        );

        if (!isNotAKeptId) {
          cuts.push(`${file}: ${cut}`);
        }
      }
    }

    expect(cuts).toEqual([]);
  });

  test.each(NOT_A_KEPT_ID)(
    "the cut let through in $file is still there, and says why",
    (allowed: { file: string; cut: string; why: string }) => {
      expect(idCutsIn(readCode(allowed.file))).toContain(allowed.cut);
      expect(allowed.why.length).toBeGreaterThan(40);
    },
  );

  test.each([
    // The lines that cut a personal chat's id, as they were.
    "keptMessage.channelId = thread.channel.id.substring(0, 100);",
    'keptMessage.messageId = (thread.threadId || "").substring(0, 100);',
    "keptMessage.teamId = teamId.substring(0, 100);",
    "place.channelId = data.place.channelId.substring(0, 100);",
    'log.channelId = (thread.channel.id || "").substring(0, 100);',
    'log.channelId = (sendError.channel.id || "").substring(0, 100);',
    'log.channelId = (error.channel.id || "").substring(0, 100);',
    "channelId: data.result.channelId?.substring(\n            0,\n            ColumnLength.ShortText,\n          ),",
    "threadId: data.result.threadId?.substring(0, ColumnLength.ShortText),",
    // And the other ways of writing it.
    "const id: string = chatId.slice(0, 100);",
    "row.conversationId = activity.conversation.id.substr(0, 100);",
  ])("would have caught: %s", (line: string) => {
    expect(idCutsIn(line)).toHaveLength(1);
  });

  test.each([
    // A name is only shown: it may be cut.
    'keptMessage.channelName = (thread.channel.name || "").substring(0, 100);',
    "return `${truncateToLength(name, MICROSOFT_TEAMS_CHAT_NAME_MAX_LENGTH - 1)}…`;",
    // Lists of ids are not ids.
    "memberIds: memberIds.slice(0, data.max),",
    "channelIds: references.channelIds.slice(0, MAX_CHANNEL_LOOKUPS),",
    // Kept whole or not at all.
    'keptMessage.messageId = WorkspaceStoredValue.id(thread.threadId) || "";',
    // A comment that tells what the code did.
    "/* keptMessage.channelId = thread.channel.id.substring(0, 100); */",
  ])("lets through: %s", (line: string) => {
    expect(
      idCutsIn(line.replace(BLOCK_COMMENT, "").replace(LINE_COMMENT, "")),
    ).toEqual([]);
  });
});
