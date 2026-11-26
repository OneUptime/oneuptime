import { readPage } from "./DocsContentSupport";
import CodeRepository from "Common/Models/DatabaseModels/CodeRepository";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import Runner from "Common/Models/DatabaseModels/Runner";
import {
  CODE_REPOSITORY_COMMAND_COLUMNS,
  CODE_REPOSITORY_RUNNER_COLUMNS,
} from "Common/Types/CodeRepository/CodeRepositoryRunnerAuthoring";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "Common/Types/Permission";
import { REDACTED_SECRET_TEXT } from "Common/Types/Runbook/SecretOutputRedaction";
import { describe, expect, it } from "@jest/globals";

/*
 * What the docs say about who decides what a project's Runner runs, held to
 * the code that decides it:
 *
 *   - the Code page names, where it says who sets a repository's commands
 *     and who picks its Runner, the columns' own update list - Runbook.steps'
 *     - its roles by the titles the permission picker shows, and its
 *     granular permission in bold;
 *   - the Runbook Agents page says only those who may read a Runner's key
 *     choose one, which is the key's update list;
 *   - the Authoring page says a Bash and a kubectl step run without the
 *     Runner's own ONEUPTIME_RUNNER_ settings, and how a key a script prints
 *     is stored;
 *   - the notes on 17 say all of it, with the permissions as the API names
 *     them.
 */

const CODE: string = readPage("en", "ai/ai-agent");
const AGENTS: string = readPage("en", "runbooks/agents");
const AUTHORING: string = readPage("en", "runbooks/authoring");
const UPGRADING: string = readPage("en", "installation/upgrading");

function propsOf(permission: Permission): PermissionProps {
  const props: PermissionProps | undefined =
    PermissionHelper.getAllPermissionProps().find(
      (item: PermissionProps): boolean => {
        return item.permission === permission;
      },
    );

  expect({ permission, known: Boolean(props) }).toEqual({
    permission,
    known: true,
  });

  return props as PermissionProps;
}

// "A, B or C" - the docs' way of naming who may.
function orList(items: Array<string>): string {
  if (items.length <= 1) {
    return items.join("");
  }

  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

// A section of a page: its heading line to the next heading of its level or above.
function section(page: string, heading: string): string {
  const lines: Array<string> = page.split("\n");
  const start: number = lines.indexOf(heading);

  expect({ heading, found: start >= 0 }).toEqual({ heading, found: true });

  const level: number = heading.split(" ")[0]!.length;
  let end: number = lines.length;

  for (let index: number = start + 1; index < lines.length; index++) {
    const match: RegExpMatchArray | null = (lines[index] as string).match(
      /^(#+) /,
    );

    if (match && (match[1] as string).length <= level) {
      end = index;
      break;
    }
  }

  return lines.slice(start, end).join("\n");
}

// Runbook.steps' update list: who writes what a Runner runs.
const STEP_WRITERS: Array<Permission> =
  new Runbook().getColumnAccessControlFor("steps")?.update || [];

/*
 * How the docs name that list: its roles by their titles, then its
 * granular permission in bold - "Project Owner, Project Admin or Runbook
 * Admin, or **Edit Runbook**".
 */
function namedWriters(): string {
  const roles: Array<string> = STEP_WRITERS.filter(
    (permission: Permission): boolean => {
      return Boolean(propsOf(permission).isRolePermission);
    },
  ).map((permission: Permission): string => {
    return propsOf(permission).title;
  });

  const granular: Array<string> = STEP_WRITERS.filter(
    (permission: Permission): boolean => {
      return !propsOf(permission).isRolePermission;
    },
  ).map((permission: Permission): string => {
    return `**${propsOf(permission).title}**`;
  });

  return `${orList(roles)}, or ${orList(granular)}`;
}

describe("who decides what a Runner runs for a code repository, as the Code page says it", () => {
  it("is Runbook.steps' update list, on every column that decides it", () => {
    for (const column of [
      ...CODE_REPOSITORY_COMMAND_COLUMNS,
      ...CODE_REPOSITORY_RUNNER_COLUMNS,
    ]) {
      expect({
        column,
        update: new CodeRepository().getColumnAccessControlFor(column)?.update,
      }).toEqual({ column, update: STEP_WRITERS });
    }

    expect(namedWriters()).toBe(
      "Project Owner, Project Admin or Runbook Admin, or **Edit Runbook**",
    );
  });

  it("names it where the page says who sets a repository's commands, and what they run without", () => {
    const commands: string = section(CODE, "### Commands set on a repository");

    expect(commands).toContain(
      `setting, changing or removing them takes what writing a runbook's steps that run takes: ${namedWriters()}.`,
    );
    expect(commands).toContain(
      "No workflow that runs with the default permissions changes them",
    );
    expect(commands).toContain(
      "they run without the Runner's own `ONEUPTIME_RUNNER_` settings, its key among them",
    );
  });

  it("names it where the page says who picks a repository's Runner", () => {
    const pick: string = section(CODE, "### Pick the repository's Runner");

    expect(pick).toContain(
      `Picking it takes the same roles as setting the repository's commands - ${namedWriters()} -`,
    );
  });
});

describe("who chooses a Runner's key, as the Runbook Agents page says it", () => {
  it("is who may read one: the key's update list is its read list", () => {
    const key: ReturnType<Runner["getColumnAccessControlFor"]> =
      new Runner().getColumnAccessControlFor("key");

    expect(key?.update).toEqual(key?.read);
    expect(
      orList(
        (key?.read || []).map((permission: Permission): string => {
          return propsOf(permission).title;
        }),
      ),
    ).toBe("Project Owner, Project Admin or Runbook Admin");

    expect(AGENTS).toContain(
      "Only a Project Owner, Project Admin or Runbook Admin can see a Runner's key, which the setup command contains. Only they can choose a Runner's key, too: a Runner anyone else creates gets a key OneUptime generates, and creating it does not show them the key.",
    );
  });
});

describe("what a Bash and a kubectl step run without, as the Authoring page says it", () => {
  function row(page: string, startsWith: string): string {
    const found: string | undefined = page
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith(startsWith);
      });

    expect({ startsWith, found: Boolean(found) }).toEqual({
      startsWith,
      found: true,
    });

    return found as string;
  }

  it("the Bash script row: the Runner's own settings, and a key a script prints stored as the Runner and the server store it", () => {
    const bash: string = row(
      section(AUTHORING, "### Bash"),
      "| **Bash script** |",
    );

    expect(bash).toContain(
      "without the Runner's own `ONEUPTIME_RUNNER_` settings, its key among them",
    );
    expect(bash).toContain(
      `a key a script prints anyway is stored as \`${REDACTED_SECRET_TEXT}\`.`,
    );
  });

  it("the kubectl Script row says the same", () => {
    expect(row(section(AUTHORING, "### kubectl"), "| **Script** |")).toContain(
      "Like a Bash step's script, it runs without the Runner's own `ONEUPTIME_RUNNER_` settings.",
    );
  });
});

describe("the notes on 17", () => {
  it("say who sets a repository's commands and Runner and who chooses a Runner's key, with the permissions as the API names them", () => {
    const notes: string = section(
      UPGRADING,
      "## Upgrading from OneUptime 16 → 17",
    ).replace(/\n {2}/g, " ");

    expect(notes).toContain(
      "- **Only those who may write a runbook's steps that run set a code repository's commands or pick its Runner, and only those who may read a Runner's key choose one.**",
    );
    const named: string =
      "`ProjectOwner`, `ProjectAdmin`, `RunbookAdmin` or `EditRunbook`";

    expect(notes).toContain(
      `picking the repository's Runner, now takes ${named} beside the repository's own permissions`,
    );
    // The four it names are Runbook.steps' update list, by their API names.
    expect(
      Array.from(named.matchAll(/`([A-Za-z]+)`/g))
        .map((match: RegExpMatchArray): string => {
          return match[1] as string;
        })
        .sort(),
    ).toEqual([...STEP_WRITERS].map(String).sort());
    expect(notes).toContain(
      "Creating a Runner with a key of your choosing, or changing a Runner's key, takes `ProjectOwner`, `ProjectAdmin` or `RunbookAdmin`",
    );
    expect(notes).toContain(
      "no longer see the Runner's own `ONEUPTIME_RUNNER_` settings",
    );
  });
});
