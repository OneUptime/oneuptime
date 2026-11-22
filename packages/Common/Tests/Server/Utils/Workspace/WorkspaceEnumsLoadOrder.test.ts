import fs from "fs";
import path from "path";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * WHICHEVER WORKSPACE FILE LOADS FIRST, THE CHATS' TABLES OF PRESSES LOAD.
 *
 * WorkspaceEventType, the records a Slack or Microsoft Teams button acts
 * on, was declared in WorkspaceMemberActions, and WorkspacePendingActionKind,
 * what a press does that OneUptime finishes once the account is connected,
 * in WorkspaceConnectRequest. Each of those files imports, before its enum,
 * the services or the database configuration, and through them the chats'
 * cards, whose modules read the two enums when they load: the chats' record
 * titles, Microsoft Teams' and Slack's tables of the presses OneUptime
 * finishes, the held public note's approvals, Mattermost's actions. Loaded
 * while the declaring file was still loading them, they read the enum as
 * undefined and threw, so which of them loaded at all depended on which
 * file a caller imported first. Since the Data Security owner proposals'
 * imports (#10609), the list order tests (BuiltInRowsByPlace) reached
 * WorkspaceMentions through the services and did not load: "Cannot read
 * properties of undefined (reading 'Acknowledge')".
 *
 * Each enum is now in a file of its own that imports nothing, which the
 * declaring file imports, and exports again, before anything else.
 *
 * Each test loads its first file into a module registry of its own
 * (jest.isolateModules), as a process that loads nothing else first would.
 * Before the fix, WorkspaceMemberActions loaded first threw in the record
 * titles (WorkspaceActionAnswers: "reading 'Incident'"), and
 * WorkspaceConnectRequest loaded first threw in Microsoft Teams' table of
 * presses ("reading 'Acknowledge'").
 */

const WORKSPACE: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "Server",
  "Utils",
  "Workspace",
);

// A fresh registry loads the services' whole import graph, a few thousand files.
const LOAD_TIMEOUT_IN_MS: number = 180000;

// An id OneUptime writes on its own card.
const INCIDENT_ID: string = "6f1c2b8e-1d2a-4c3b-9e4f-5a6b7c8d9e0f";

interface PressDescription {
  purpose: string;
  pendingAction?:
    | {
        kind: string;
        eventType: string;
      }
    | undefined;
}

interface TeamsConnectPrompt {
  describe: (data: {
    actionType: string;
    actionValue?: string | undefined;
  }) => PressDescription;
}

interface HeldPublicNote {
  getApprovalEventType: (type: string) => string | null;
}

interface FirstFile {
  file: string;
  why: string;
}

const FIRST_FILES: ReadonlyArray<FirstFile> = [
  {
    file: "WorkspaceMemberActions",
    why: "declared the records' kinds, and its services load the held public note",
  },
  {
    file: "WorkspaceConnectRequest",
    why: "declared what a press finishes, and its database configuration loads the chats' cards",
  },
  {
    file: "WorkspaceActionAnswers",
    why: "imports the connect request, which imported the member actions",
  },
  {
    file: path.join("MicrosoftTeams", "MicrosoftTeamsConnectPrompt"),
    why: "reads both enums in its table of the presses OneUptime finishes",
  },
  {
    file: "WorkspaceMentions",
    why: "is where the list order tests' imports reached the cycle (BuiltInRowsByPlace)",
  },
];

const readWorkspaceFile: (file: string) => string = (file: string): string => {
  return fs.readFileSync(path.join(WORKSPACE, `${file}.ts`), "utf8");
};

describe("the chats' tables of presses load whichever Workspace file loads first", () => {
  for (const first of FIRST_FILES) {
    test(
      `${first.file} first (it ${first.why})`,
      () => {
        jest.isolateModules(() => {
          // A Workspace file, loaded into this test's own registry.
          const load: (file: string) => Record<string, unknown> = (
            file: string,
          ): Record<string, unknown> => {
            return jest.requireActual(path.join(WORKSPACE, file)) as Record<
              string,
              unknown
            >;
          };

          expect(() => {
            load(first.file);
          }).not.toThrow();

          const prompt: TeamsConnectPrompt = load(
            path.join("MicrosoftTeams", "MicrosoftTeamsConnectPrompt"),
          )["default"] as TeamsConnectPrompt;

          // Acknowledge on an incident's card is finished once they connect.
          expect(
            prompt.describe({
              actionType: "AcknowledgeIncident",
              actionValue: INCIDENT_ID,
            }).pendingAction,
          ).toMatchObject({ kind: "Acknowledge", eventType: "Incident" });

          // An episode's notes wait for the incident workflow's approval.
          const held: HeldPublicNote = load("WorkspaceHeldPublicNote")[
            "default"
          ] as HeldPublicNote;

          expect(held.getApprovalEventType("IncidentEpisode")).toBe("Incident");

          // The files that declared them export the very same enums.
          expect(load("WorkspaceMemberActions")["WorkspaceEventType"]).toBe(
            load("WorkspaceEventType")["WorkspaceEventType"],
          );
          expect(
            load("WorkspaceConnectRequest")["WorkspacePendingActionKind"],
          ).toBe(
            load("WorkspacePendingActionKind")["WorkspacePendingActionKind"],
          );
        });
      },
      LOAD_TIMEOUT_IN_MS,
    );
  }
});

describe("the two enums stay where every load order finds them whole", () => {
  const LEAVES: ReadonlyArray<{ leaf: string; declaredIn: string }> = [
    { leaf: "WorkspaceEventType", declaredIn: "WorkspaceMemberActions" },
    {
      leaf: "WorkspacePendingActionKind",
      declaredIn: "WorkspaceConnectRequest",
    },
  ];

  for (const { leaf, declaredIn } of LEAVES) {
    test(`${leaf} imports nothing, so it has loaded whole before anything reads it`, () => {
      const text: string = readWorkspaceFile(leaf);

      expect(text).toContain(`export enum ${leaf} {`);
      expect(text).not.toMatch(/^\s*import\b/m);
      expect(text).not.toMatch(/\brequire\(/);
    });

    test(`${declaredIn} imports ${leaf} before anything else it imports, and exports it`, () => {
      const text: string = readWorkspaceFile(declaredIn);
      const firstImport: RegExpMatchArray | null = text.match(
        /^import\b[^;]*?\sfrom\s+"([^"]+)";/m,
      );

      expect(firstImport?.[1]).toBe(`./${leaf}`);
      expect(text).toContain(`export { ${leaf} };`);
      expect(text).not.toContain(`export enum ${leaf} `);
    });
  }
});
