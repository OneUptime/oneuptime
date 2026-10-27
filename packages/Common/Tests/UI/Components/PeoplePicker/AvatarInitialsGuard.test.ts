import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Initials are read in one place: Common/Utils/NameInitials.
 *
 * The people picker's avatar took the first character of the first and the
 * last bit of a name as written, so a team named "Security Operations Center
 * (EMEA)" was drawn "S(" - and the Users and Teams facets kept a copy of the
 * same rule, and the audit log's actor avatar a third. They read the name's
 * words through getNameInitials now: letters and digits only, what the name
 * says in brackets left out, an address by its local part.
 *
 * This holds the place: every function of the frontends whose name says it
 * makes initials is one of the known ones below, each either reading
 * through getNameInitials or kept for a reason of its own. A new one is a
 * new copy of the rule - read the name with getNameInitials instead.
 */

const PACKAGES: string = path.resolve(__dirname, "../../../../..");
const REPOSITORY: string = path.resolve(PACKAGES, "..");

const ROOTS: ReadonlyArray<string> = [
  path.join(PACKAGES, "Common", "UI"),
  path.join(PACKAGES, "App", "FeatureSet", "Dashboard", "src"),
  path.join(PACKAGES, "App", "FeatureSet", "AdminDashboard", "src"),
  path.join(PACKAGES, "App", "FeatureSet", "StatusPage", "src"),
  path.join(PACKAGES, "App", "FeatureSet", "Accounts", "src"),
  path.join(REPOSITORY, "ee", "Dashboard"),
  path.join(REPOSITORY, "ee", "AdminDashboard"),
];

const SOURCE_FILE: RegExp = /\.tsx?$/;

/*
 * A function whose name says it makes initials - getXInitials, initialsOf:
 * a function declaration, a method, or a const typed as a function. A
 * variable holding initials ("const initials: string") is no copy of the
 * rule.
 */
const INITIALS_DECLARATION: RegExp =
  /(?:function\s+(\w*[Ii]nitials\w*)\s*\(|static\s+(\w*[Ii]nitials\w*)\s*\(|const\s+(\w*[Ii]nitials\w*)\s*:\s*(?:\(|\w+Function\b))/g;

/*
 * The functions that make initials today, by file, and why each may. Those
 * marked "reads getNameInitials" must keep doing so.
 */
const KNOWN: ReadonlyArray<{
  file: string;
  name: string;
  readsNameInitials: boolean;
  reason: string;
}> = [
  {
    file: "Common/UI/Components/PeoplePicker/PeopleAvatar.tsx",
    name: "getPeopleInitials",
    readsNameInitials: true,
    reason: "every owner, picker and chip avatar",
  },
  {
    file: "App/FeatureSet/Dashboard/src/Components/AuditLogs/AuditLogsTableUtils.ts",
    name: "getActorInitials",
    readsNameInitials: true,
    reason: "the audit log's actor avatar",
  },
  {
    file: "App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerUserColors.ts",
    name: "getUserInitials",
    readsNameInitials: false,
    reason:
      "on-call's people: two letters of a one-word name beside the colour each keeps (OnCallPersonColorGuard)",
  },
  {
    file: "App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/FinalScheduleSummary.tsx",
    name: "getInitials",
    readsNameInitials: false,
    reason: "a person's on-call initials by their id, through getUserInitials",
  },
  {
    file: "App/FeatureSet/Dashboard/src/Components/EventNotes/EventNotesUtil.ts",
    name: "getInitials",
    readsNameInitials: false,
    reason: "a note's author: already letters and digits only, two of one word",
  },
  {
    file: "App/FeatureSet/Dashboard/src/Components/EventNotes/NoteAvatar.tsx",
    name: "getInitialsColor",
    readsNameInitials: false,
    reason: "a colour, not initials",
  },
  {
    file: "App/FeatureSet/Dashboard/src/Components/AI/InvestigationConversation/InvestigationConversationData.ts",
    name: "getInitials",
    readsNameInitials: false,
    reason:
      "an AI conversation's responder: already letters and digits only, the first two words",
  },
  {
    file: "App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayUserIdentity.ts",
    name: "initialsOf",
    readsNameInitials: false,
    reason:
      "a session's visitor: an identity the app sent, split on dots and dashes",
  },
  {
    file: "App/FeatureSet/Dashboard/src/Components/AIChat/UserInitials.ts",
    name: "getUserInitials",
    readsNameInitials: false,
    reason: "the signed-in user in the AI chat, U for nobody",
  },
  {
    file: "Common/UI/Utils/ProjectInvitationDisplay.ts",
    name: "getInitials",
    readsNameInitials: false,
    reason: "a project's badge on an invitation, an emoji kept on purpose",
  },
  {
    file: "Common/UI/Components/Workflow/ComponentPicker/ComponentSearch.ts",
    name: "initialsOf",
    readsNameInitials: false,
    reason: "the component search's typed initials, not an avatar",
  },
];

function filesUnder(folder: string): Array<string> {
  if (!fs.existsSync(folder)) {
    return [];
  }

  return fs
    .readdirSync(folder, { withFileTypes: true })
    .flatMap((entry: fs.Dirent): Array<string> => {
      const full: string = path.join(folder, entry.name);

      if (entry.isDirectory()) {
        return entry.name === "node_modules" ? [] : filesUnder(full);
      }

      return SOURCE_FILE.test(entry.name) ? [full] : [];
    });
}

// "packages/"-relative, or "ee/"-prefixed for the Enterprise folders.
function shortPath(file: string): string {
  const fromPackages: string = path.relative(PACKAGES, file);

  return fromPackages.startsWith("..")
    ? path.relative(REPOSITORY, file)
    : fromPackages;
}

interface Found {
  file: string;
  name: string;
}

function initialsDeclarations(): Array<Found> {
  const found: Array<Found> = [];

  for (const root of ROOTS) {
    for (const file of filesUnder(root)) {
      const source: string = fs.readFileSync(file, "utf8");

      for (const match of source.matchAll(INITIALS_DECLARATION)) {
        found.push({
          file: shortPath(file),
          name: (match[1] || match[2] || match[3]) as string,
        });
      }
    }
  }

  return found;
}

function sourceOf(file: string): string {
  return fs.readFileSync(path.join(PACKAGES, file), "utf8");
}

describe("initials are read through Common/Utils/NameInitials", () => {
  test("every function that makes initials is a known one", () => {
    const unknown: Array<Found> = initialsDeclarations().filter(
      (declaration: Found): boolean => {
        return !KNOWN.some((known: { file: string; name: string }): boolean => {
          return (
            known.file === declaration.file && known.name === declaration.name
          );
        });
      },
    );

    // A new one: read the name with getNameInitials instead.
    expect(unknown).toEqual([]);
  });

  test("each known one is still there, so the list only shrinks", () => {
    const found: Array<Found> = initialsDeclarations();

    for (const known of KNOWN) {
      expect({
        known: `${known.file} ${known.name}`,
        isThere: found.some((declaration: Found): boolean => {
          return (
            declaration.file === known.file && declaration.name === known.name
          );
        }),
      }).toEqual({ known: `${known.file} ${known.name}`, isThere: true });
    }
  });

  test.each(
    KNOWN.filter((known: { readsNameInitials: boolean }): boolean => {
      return known.readsNameInitials;
    }).map((known: { file: string; name: string }): [string, string] => {
      return [known.name, known.file];
    }),
  )("%s reads getNameInitials", (_name: string, file: string) => {
    const source: string = sourceOf(file);

    expect(source).toContain('from "');
    expect(source).toMatch(
      /import \{ getNameInitials \} from "[^"]*NameInitials";/,
    );
    expect(source).toContain("return getNameInitials(");
  });

  test("the Users and Teams facets draw a member as the avatar does", () => {
    const facets: string = sourceOf(
      "App/FeatureSet/Dashboard/src/Components/ResourceOwners/ProjectUserFacetOptions.ts",
    );

    expect(facets).toContain("initials: getNameInitials(label),");
    expect(facets).not.toContain("split(/\\s+/)");
  });

  test("the helper reads words, not characters as written", () => {
    const helper: string = fs.readFileSync(
      path.join(PACKAGES, "Common", "Utils", "NameInitials.ts"),
      "utf8",
    );

    expect(helper).toContain("\\p{L}\\p{N}");
    expect(helper).toContain("export const getNameInitials");
  });
});
