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
 *   - no SQL anywhere else inserts or updates the table.
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
