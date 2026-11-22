import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * EVERY ON-CALL LINE NAMES ITS PEOPLE IN ONE PLACE (#10616).
 *
 * An on-call policy's feed entries and channel lines can name someone only
 * invited to the project (#10412): on an escalation rule, in a schedule's
 * rotation, in an override, as an owner. The channels can be read by people
 * outside the project, and so can the feed - its entries are posted to the
 * channels, and workflows and the API take them anywhere - so neither may
 * say an invitee's email address. Each line used to build its names itself:
 * UserService.getUserMarkdownString and WorkspaceUtil.getUserStringForWorkspace
 * name someone pending by the address they were invited at when no name was
 * typed (#10175), PendingInviteeProfiles.nameInProject puts that address in
 * their account's place, and two entries printed the person's address after
 * their name. One fix in one line left the others saying it.
 *
 * Now every line names its people through OnCallChatByWorkspace (nameIn,
 * and its getInviteeName and getDisplayName rules), which names someone
 * only invited by the name typed for them, never an address. This reads the
 * source of every file that writes a policy's feed entry or posts its
 * channel line, so that a new line cannot name a person any other way:
 *
 *   - none of them asks getUserMarkdownString, getUserStringForWorkspace or
 *     nameInProject for a name, or puts a person's address in a template;
 *   - getNameInProject names a person only in the refusals listed below,
 *     which go to whoever made the change - one of the project's people -
 *     and never to a feed or a channel.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../../..");

const SERVER_ROOT: string = path.join(REPO_ROOT, "packages/Common/Server");

// What writes an on-call policy's feed entry, or posts its channel line.
const WRITES_A_LINE: RegExp =
  /OnCallDutyPolicyFeedService\.(createOnCallDutyPolicyFeedItem|sendWorkspaceNotification)\(/;

// The ways a line named its people itself.
const NAMES_A_PERSON_ITSELF: Array<{ pattern: RegExp; what: string }> = [
  {
    pattern: /\bgetUserMarkdownString\(/,
    what: "UserService.getUserMarkdownString: someone pending by their invited address",
  },
  {
    pattern: /\bgetUserStringForWorkspace\(/,
    what: "WorkspaceUtil.getUserStringForWorkspace: OneUptime's name, an invited address included",
  },
  {
    pattern: /(?<!get)\bnameInProject\(/,
    what: "PendingInviteeProfiles.nameInProject: an invited address in the account's place",
  },
  {
    pattern: /\$\{[^}]*\.email\b[^}]*\}/,
    what: "a person's address in a template",
  },
];

const NAME_IN_PROJECT: RegExp = /\bgetNameInProject\(/g;

/*
 * Where a person may be named as the project knows them, an invited
 * address included, and why: "file#method". An entry the source no longer
 * needs fails below - delete it.
 */
const MAY_NAME_AS_THE_PROJECT_KNOWS_THEM: Record<string, string> = {
  "packages/Common/Server/Services/OnCallDutyPolicyEscalationRuleUserService.ts#getAlreadyOnRuleRefusal":
    "the refusal of someone the rule names already, read by whoever adds them",
  "packages/Common/Server/Services/OnCallDutyPolicyUserOverrideService.ts#getOverlapRefusal":
    "the refusal of an override that overlaps another, read by whoever adds it",
};

// The files every on-call line is written in: the guard finds them all.
const KNOWN_LINE_WRITERS: Array<string> = [
  "packages/Common/Server/Services/OnCallDutyPolicyEscalationRuleScheduleService.ts",
  "packages/Common/Server/Services/OnCallDutyPolicyEscalationRuleTeamService.ts",
  "packages/Common/Server/Services/OnCallDutyPolicyEscalationRuleUserService.ts",
  "packages/Common/Server/Services/OnCallDutyPolicyOwnerTeamService.ts",
  "packages/Common/Server/Services/OnCallDutyPolicyOwnerUserService.ts",
  "packages/Common/Server/Services/OnCallDutyPolicyService.ts",
  "packages/Common/Server/Services/OnCallDutyPolicyUserOverrideService.ts",
  "packages/Common/Server/Utils/OnCall/OnCallHandoffPosts.ts",
];

function sourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) {
      continue;
    }

    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name)) {
      files.push(full);
    }
  }

  return files;
}

function relative(file: string): string {
  return path.relative(REPO_ROOT, file).split(path.sep).join("/");
}

// The code of a source, without its comments: a comment may name a helper.
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

// The method of a class a place in its source is in: the last one declared before it.
function methodAt(source: string, index: number): string {
  const declaration: RegExp =
    /^ {2}(?:(?:public|private|protected|static|async|override)\s+)*([A-Za-z_][A-Za-z0-9_]*)\s*(?:<[^>]*>)?\(/gm;

  let method: string = "";
  let match: RegExpExecArray | null = declaration.exec(source);

  while (match && match.index < index) {
    method = match[1]!;
    match = declaration.exec(source);
  }

  return method;
}

const LINE_WRITERS: Array<{ file: string; source: string }> = sourceFiles(
  SERVER_ROOT,
)
  .map((file: string): { file: string; source: string } => {
    return {
      file: relative(file),
      source: withoutComments(fs.readFileSync(file, "utf8")),
    };
  })
  .filter((writer: { file: string; source: string }): boolean => {
    return (
      WRITES_A_LINE.test(writer.source) &&
      writer.file !==
        "packages/Common/Server/Services/OnCallDutyPolicyFeedService.ts"
    );
  });

describe("every on-call line names its people through OnCallChatByWorkspace (#10616)", () => {
  test("the guard finds every file that writes a policy's feed entry or channel line", () => {
    const found: Array<string> = LINE_WRITERS.map(
      (writer: { file: string }): string => {
        return writer.file;
      },
    );

    for (const file of KNOWN_LINE_WRITERS) {
      expect(found).toContain(file);
    }
  });

  test.each(KNOWN_LINE_WRITERS)(
    "%s builds no person's name itself",
    (file: string) => {
      const writer: { file: string; source: string } | undefined =
        LINE_WRITERS.find((candidate: { file: string }): boolean => {
          return candidate.file === file;
        });

      expect(writer).toBeDefined();

      const found: Array<string> = [];

      for (const way of NAMES_A_PERSON_ITSELF) {
        const match: RegExpMatchArray | null = writer!.source.match(
          way.pattern,
        );

        if (match) {
          found.push(`${way.what}: ${match[0]}`);
        }
      }

      expect(found).toEqual([]);
    },
  );

  test("every file that writes an on-call line is held to it, a new one too", () => {
    const offenders: Array<string> = [];

    for (const writer of LINE_WRITERS) {
      for (const way of NAMES_A_PERSON_ITSELF) {
        if (way.pattern.test(writer.source)) {
          offenders.push(`${writer.file}: ${way.what}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("a person is named as the project knows them only in the refusals listed, which no feed or channel hears", () => {
    const used: Set<string> = new Set<string>();
    const unlisted: Array<string> = [];

    for (const writer of LINE_WRITERS) {
      for (const match of writer.source.matchAll(NAME_IN_PROJECT)) {
        const place: string = `${writer.file}#${methodAt(writer.source, match.index || 0)}`;

        if (MAY_NAME_AS_THE_PROJECT_KNOWS_THEM[place]) {
          used.add(place);
        } else {
          unlisted.push(place);
        }
      }
    }

    expect(unlisted).toEqual([]);
    // An entry the source no longer needs: delete it.
    expect([...used].sort()).toEqual(
      Object.keys(MAY_NAME_AS_THE_PROJECT_KNOWS_THEM).sort(),
    );
  });

  test("the guard sees what it guards against: each way is caught in a line that used it", () => {
    const before: string = [
      "  private async writeAddedToFeed(): Promise<void> {",
      "    const name = await UserService.getUserMarkdownString({ userId, projectId });",
      "    const chat = await WorkspaceUtil.getUserStringForWorkspace({ userId, projectId, workspaceType });",
      "    await PendingInviteeProfiles.nameInProject({ users: [user], projectId });",
      "    const line = mdText`Removed **${user.name.toString()}** (${user.email?.toString()}) from`;",
      "  }",
    ].join("\n");

    for (const way of NAMES_A_PERSON_ITSELF) {
      expect(way.pattern.test(before)).toBe(true);
    }

    // getNameInProject is not nameInProject.
    expect(
      NAMES_A_PERSON_ITSELF[2]!.pattern.test(
        "PendingInviteeProfiles.getNameInProject({",
      ),
    ).toBe(false);
    expect(methodAt(before, before.indexOf("nameInProject"))).toBe(
      "writeAddedToFeed",
    );
  });
});
