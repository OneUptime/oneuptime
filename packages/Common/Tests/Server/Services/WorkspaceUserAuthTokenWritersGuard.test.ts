import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";

/*
 * ONLY A SIGN-IN CONNECTS A SLACK OR MICROSOFT TEAMS ACCOUNT TO A MEMBER.
 *
 * A WorkspaceUserAuthToken row says which chat account is which member of a
 * project, and the chat acts on it: a button, a command or a reaction made
 * with the account runs as that member, with their permissions, and their
 * direct messages, channel invitations and chat notification method go to
 * the account. So a row may only say what a sign-in proved: the member
 * signed in to Slack or Microsoft Teams, in their own browser, behind a
 * single-use state issued to their own session (WorkspaceOAuthState), and
 * the chat said which account signed in.
 *
 * This holds the whole server to that:
 *
 *   - the model lets nobody create or change a row through the API (a member
 *     reads and disconnects their own);
 *   - the only code that writes one is WorkspaceUserAuthTokenService's own
 *     refreshAuthToken, and the only callers of that are the sign-in
 *     callbacks - the Slack install and sign-in callbacks and the Microsoft
 *     Teams sign-in callback - each writing for the member and project of the
 *     state it spent (record.userId, record.projectId), never for ids the
 *     request carries;
 *   - no SQL anywhere else inserts or updates the table;
 *   - a chat account is looked for among its own chat's links only;
 *   - the scans see every use: the service and the model are imported
 *     under their own names, and no workflow step or MCP tool is offered
 *     for the table.
 *
 * A new way to connect an account has to be added below, so whoever adds it
 * decides how it proves the account.
 */

// packages/Common/Tests/Server/Services -> the repository.
const REPOSITORY_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
);

const SCAN_ROOTS: Array<string> = [
  "packages/Common/Server",
  "packages/App/FeatureSet",
  "ee",
];

const SERVICE_FILE: string =
  "packages/Common/Server/Services/WorkspaceUserAuthTokenService.ts";

// The sign-in callbacks, and how many links each writes.
const SIGN_IN_CALLBACKS: Record<string, number> = {
  // The install callback, and the sign-in callback.
  "packages/Common/Server/API/SlackAPI.ts": 2,
  // The sign-in callback.
  "packages/Common/Server/API/MicrosoftTeamsAPI.ts": 1,
};

const REFRESH_CALL: RegExp =
  /\bWorkspaceUserAuthTokenService\s*\.\s*refreshAuthToken\s*\(/g;

// Every write a DatabaseService offers, called on the link table's service.
const OTHER_WRITE_CALL: RegExp =
  /\bWorkspaceUserAuthTokenService\s*\.\s*(create|createFromTemplate|updateOneBy|updateBy|updateOneById|updateOneByIdAndFetch|updateColumnsByIdWithoutHooks|updateColumnsByIdIfUnlockedWithoutHooks|getRepository)\s*\(/g;

// A row built to be saved, outside the service.
const NEW_ROW: RegExp = /\bnew\s+WorkspaceUserAuthToken\s*\(/g;

// SQL that inserts into or updates the table.
const SQL_WRITE: RegExp =
  /\b(INSERT\s+INTO|UPDATE)\s+"?WorkspaceUserAuthToken"?[\s(]/gi;

// Whitespace, taken out of a call's arguments before they are read.
const WHITESPACE: RegExp = /\s+/g;

// Every read a DatabaseService offers, called on the link table's service.
const LINK_READ_CALL: RegExp =
  /\bWorkspaceUserAuthTokenService\s*\.\s*(findOneBy|findBy|countBy|findOneById|findAllBy)\s*\(/g;

// The service's own reads of its table.
const OWN_READ_CALL: RegExp = /\bthis\s*\.\s*(findOneBy|findBy|countBy)\s*\(/g;

// An import of the service or the model: the name it binds, and its path.
const LINK_IMPORT: RegExp =
  /\bimport\s+(\w+)(?:\s*,\s*\{[^}]*\})?\s+from\s+"([^"]*\/WorkspaceUserAuthToken(?:Service)?)"/g;

// The service or the model loaded by require() instead.
const LINK_REQUIRE: RegExp =
  /\brequire\(\s*"[^"]*\/WorkspaceUserAuthToken(?:Service)?"\s*\)/;

const QUERY_IN_PLACE: string = "query:{";

/*
 * Where the chat's account is turned into the member a press, a command, a
 * question or a card acts as.
 */
const WHO_ACTS_FILES: Array<string> = [
  "packages/Common/Server/Utils/Workspace/Slack/Actions/Auth.ts",
  "packages/Common/Server/Utils/Workspace/MicrosoftTeams/Actions/Auth.ts",
];

// A person looked up by their email address, in the chat or in OneUptime.
const EMAIL_LOOKUP: RegExp = /lookupByEmail|findPersonByEmail|\bemail\b/i;

interface Occurrence {
  file: string;
  line: number;
  // The call's arguments, whitespace removed, when it is a call.
  argumentsText: string;
}

function listSourceFiles(directory: string): Array<string> {
  const found: Array<string> = [];

  if (!fs.existsSync(directory)) {
    return found;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name === "build" ||
      entry.name === "dist" ||
      entry.name === "Tests" ||
      entry.name === "SchemaMigrations"
    ) {
      continue;
    }

    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...listSourceFiles(fullPath));
    } else if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".d.ts") &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".test.tsx")
    ) {
      found.push(fullPath);
    }
  }

  return found;
}

// The text of a call from its opening parenthesis to the matching one.
function argumentsOf(source: string, openParen: number): string {
  let depth: number = 0;

  for (let index: number = openParen; index < source.length; index++) {
    const character: string = source[index]!;

    if (character === "(") {
      depth++;
    } else if (character === ")") {
      depth--;

      if (depth === 0) {
        return source.slice(openParen, index + 1);
      }
    }
  }

  return source.slice(openParen);
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

/*
 * The object a read's `query:` names, from a call's arguments with the
 * whitespace taken out - or null, when it names none in place.
 */
function queryOf(argumentsText: string): string | null {
  const start: number = argumentsText.indexOf(QUERY_IN_PLACE);

  if (start === -1) {
    return null;
  }

  let depth: number = 0;

  for (
    let index: number = start + QUERY_IN_PLACE.length - 1;
    index < argumentsText.length;
    index++
  ) {
    const character: string = argumentsText[index]!;

    if (character === "{") {
      depth++;
    } else if (character === "}") {
      depth--;

      if (depth === 0) {
        return argumentsText.slice(start, index + 1);
      }
    }
  }

  return null;
}

let sourceFiles: Array<string> | null = null;

function getSourceFiles(): Array<string> {
  if (!sourceFiles) {
    sourceFiles = SCAN_ROOTS.flatMap((root: string): Array<string> => {
      return listSourceFiles(path.join(REPOSITORY_DIR, root));
    });
  }

  return sourceFiles;
}

function findAll(pattern: RegExp): Array<Occurrence> {
  const occurrences: Array<Occurrence> = [];

  for (const file of getSourceFiles()) {
    const source: string = fs.readFileSync(file, "utf8");

    for (const match of source.matchAll(pattern)) {
      const index: number = match.index || 0;
      const openParen: number = index + match[0].length - 1;

      occurrences.push({
        file: path.relative(REPOSITORY_DIR, file).split(path.sep).join("/"),
        line: lineOf(source, index),
        argumentsText:
          source[openParen] === "("
            ? argumentsOf(source, openParen).replace(WHITESPACE, "")
            : "",
      });
    }
  }

  return occurrences;
}

function placesOf(occurrences: Array<Occurrence>): Array<string> {
  return occurrences.map((occurrence: Occurrence): string => {
    return `${occurrence.file}:${occurrence.line}`;
  });
}

describe("only a sign-in connects a chat account to a member", () => {
  test("the scan reads the server: the sign-in callbacks and the service are among its files", () => {
    const files: Array<string> = getSourceFiles().map(
      (file: string): string => {
        return path.relative(REPOSITORY_DIR, file).split(path.sep).join("/");
      },
    );

    for (const file of [...Object.keys(SIGN_IN_CALLBACKS), SERVICE_FILE]) {
      expect(files).toContain(file);
    }
  });

  test("nobody creates or changes a link through the API", () => {
    const model: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();

    expect(model.getCreatePermissions()).toEqual([]);
    expect(model.getUpdatePermissions()).toEqual([]);
  });

  test("no column of a link is written through the API", () => {
    const model: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
    const writable: Array<string> = [];

    for (const column of model.getTableColumns().columns) {
      const access: ColumnAccessControl | null =
        model.getColumnAccessControlFor(column);

      if (
        access &&
        ((access.create || []).length > 0 || (access.update || []).length > 0)
      ) {
        writable.push(column);
      }
    }

    expect(writable).toEqual([]);
  });

  test("only the sign-in callbacks write a link, each for the member and project of the state it spent", () => {
    const calls: Array<Occurrence> = findAll(REFRESH_CALL).filter(
      (call: Occurrence): boolean => {
        // The service's own definition is not a call.
        return call.file !== SERVICE_FILE;
      },
    );

    const callsByFile: Record<string, number> = {};

    for (const call of calls) {
      callsByFile[call.file] = (callsByFile[call.file] || 0) + 1;

      // The member and the project come from the spent state, never the request.
      expect(`${call.file}:${call.line} ${call.argumentsText}`).toContain(
        "userId:record.userId,",
      );
      expect(`${call.file}:${call.line} ${call.argumentsText}`).toContain(
        "projectId:record.projectId,",
      );
    }

    expect(callsByFile).toEqual(SIGN_IN_CALLBACKS);
  });

  test("nothing else writes a link: no other write on the service, outside the service", () => {
    const writes: Array<Occurrence> = findAll(OTHER_WRITE_CALL).filter(
      (write: Occurrence): boolean => {
        return write.file !== SERVICE_FILE;
      },
    );

    expect(placesOf(writes)).toEqual([]);
  });

  test("no link is built to be saved outside the service", () => {
    const built: Array<Occurrence> = findAll(NEW_ROW).filter(
      (row: Occurrence): boolean => {
        return row.file !== SERVICE_FILE;
      },
    );

    expect(placesOf(built)).toEqual([]);
  });

  test("no SQL inserts into or updates the link table", () => {
    expect(placesOf(findAll(SQL_WRITE))).toEqual([]);
  });

  test("who a press acts as is read from the links alone, never found by an email address", () => {
    /*
     * A record's channel card, a page from chat and an on-call user group
     * find a person who has not connected their account by the email
     * address the chat has for them - whom to invite, page or add. Who acts
     * is a sign-in's link only.
     */
    for (const file of WHO_ACTS_FILES) {
      const source: string = fs.readFileSync(
        path.join(REPOSITORY_DIR, file),
        "utf8",
      );

      expect(source).toContain("WorkspaceUserAuthTokenService.findOneBy({");
      expect(`${file}: ${source.match(EMAIL_LOOKUP)?.[0] || ""}`).toBe(
        `${file}: `,
      );
    }
  });

  test("a chat account is looked for among its own chat's links only, everywhere", () => {
    /*
     * Each read that finds a member by their chat account id names the chat
     * too: a Slack account id is looked for among Slack links, a Microsoft
     * Teams object id among Microsoft Teams links - never a link of the
     * other chat that happens to carry the same id.
     */
    const reads: Array<Occurrence> = [
      ...findAll(LINK_READ_CALL),
      ...findAll(OWN_READ_CALL).filter((read: Occurrence): boolean => {
        return read.file === SERVICE_FILE;
      }),
    ];

    const byChatAccount: Array<string> = [];
    const withoutChat: Array<string> = [];

    for (const read of reads) {
      const query: string | null = queryOf(read.argumentsText);

      if (query === null || !query.includes("workspaceUserId")) {
        continue;
      }

      byChatAccount.push(`${read.file}:${read.line}`);

      if (!query.includes("workspaceType")) {
        withoutChat.push(`${read.file}:${read.line}`);
      }
    }

    // The scan finds the reads: who a press acts as, in both chats.
    expect(byChatAccount.length).toBeGreaterThanOrEqual(8);
    expect(withoutChat).toEqual([]);
  });

  test("every read of the links names its query in place, so the scans above see it", () => {
    const reads: Array<Occurrence> = findAll(LINK_READ_CALL);

    expect(reads.length).toBeGreaterThan(0);

    const hidden: Array<string> = reads
      .filter((read: Occurrence): boolean => {
        return (
          read.argumentsText.includes("query:") &&
          queryOf(read.argumentsText) === null
        );
      })
      .map((read: Occurrence): string => {
        return `${read.file}:${read.line}`;
      });

    expect(hidden).toEqual([]);
  });

  test("the service and the model are imported under their own names everywhere, so the scans above see every use", () => {
    const renamed: Array<string> = [];

    for (const file of getSourceFiles()) {
      const relativePath: string = path
        .relative(REPOSITORY_DIR, file)
        .split(path.sep)
        .join("/");
      const source: string = fs.readFileSync(file, "utf8");

      for (const match of source.matchAll(LINK_IMPORT)) {
        const binding: string = match[1]!;
        const from: string = match[2]!;
        const expected: string = from.endsWith("WorkspaceUserAuthTokenService")
          ? "WorkspaceUserAuthTokenService"
          : // The service itself names its model Model, as every service does.
            relativePath === SERVICE_FILE
            ? "Model"
            : "WorkspaceUserAuthToken";

        if (binding !== expected) {
          renamed.push(`${relativePath}: ${binding} from ${from}`);
        }
      }

      if (LINK_REQUIRE.test(source)) {
        renamed.push(`${relativePath}: require()`);
      }
    }

    expect(renamed).toEqual([]);
  });

  test("the links are offered to no workflow step and no MCP tool, which would write as somebody else", () => {
    const model: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();

    expect(model.enableWorkflowOn).toBeUndefined();
    expect(Boolean(model.enableMCP)).toBe(false);
  });

  test("each sign-in callback spends a single-use state before it writes", () => {
    for (const file of Object.keys(SIGN_IN_CALLBACKS)) {
      const source: string = fs.readFileSync(
        path.join(REPOSITORY_DIR, file),
        "utf8",
      );

      // Every callback route goes through ConnectCallback.route, which spends the state.
      expect(source).toContain("ConnectCallback.route({");
      expect(source).toContain("WorkspaceOAuthState.consume({");
    }
  });
});
