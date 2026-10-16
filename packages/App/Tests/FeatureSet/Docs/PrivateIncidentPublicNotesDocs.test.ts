import PrivateRecordPublicNotes, {
  PrivateRecordKind,
} from "Common/Types/StatusPage/PrivateRecordPublicNotes";
import { WorkspaceNoteType } from "Common/Types/Workspace/WorkspaceNoteReaction";
import { WorkspaceMessageBlock } from "Common/Types/Workspace/WorkspaceMessagePayload";
import WorkspaceNoteForm from "Common/Server/Utils/Workspace/WorkspaceNoteForm";
import WorkspaceReactionNote, {
  WorkspaceNoteResourceType,
} from "Common/Server/Utils/Workspace/WorkspaceReactionNote";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The docs against the rule that a private incident or episode takes no
 * public notes (Common/Types/StatusPage/PrivateRecordPublicNotes): it is on
 * no status page and tells no subscriber, so a public note on it would reach
 * nobody it was written for.
 *
 * The English pages say what each way of writing a note does on one - the
 * Public Notes page and the feed, a state change, a 📣 and Add Note in Slack
 * and Microsoft Teams, the API - and quote what the product says. Markdown is
 * not compiled, so these tests are what notices when the pages and the
 * product part ways.
 */

const PACKAGES_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(
  PACKAGES_ROOT,
  "App/FeatureSet/Docs/Content/en",
);
const DASHBOARD_LOCALE: Record<string, unknown> = JSON.parse(
  fs.readFileSync(
    path.join(PACKAGES_ROOT, "App/FeatureSet/Dashboard/src/Locales/en.json"),
    "utf8",
  ),
) as Record<string, unknown>;

const SECTION_LINK: string =
  "[Private incidents take private notes only](/docs/incidents/notes-owners-and-feed#private-incidents-take-private-notes-only)";

function readDoc(page: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, page), "utf8");
}

// The text under a heading, up to the next heading of the same or a higher level.
function section(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.findIndex((line: string): boolean => {
    return line === heading;
  });

  expect(start).toBeGreaterThan(-1);

  const level: number = heading.indexOf(" ");
  const rest: Array<string> = lines.slice(start + 1);
  const end: number = rest.findIndex((line: string): boolean => {
    const hashes: string = line.split(" ")[0] || "";
    return (
      hashes.length > 0 &&
      hashes.length <= level &&
      hashes === "#".repeat(hashes.length)
    );
  });

  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

const NOTES: string = readDoc("incidents/notes-owners-and-feed.md");
const PRIVATE_NOTES_ONLY: string = section(
  NOTES,
  "## Private incidents take private notes only",
);

describe("the docs on a private incident's notes", () => {
  test("quote the refusal the Dashboard, the API and workflows give, word for word", () => {
    const refusal: string = PrivateRecordPublicNotes.getRefusalMessage(
      PrivateRecordKind.Incident,
    );

    expect(PRIVATE_NOTES_ONLY).toContain(`says "${refusal}"`);
    // The Dashboard draws it from its own locale, in every language.
    expect(DASHBOARD_LOCALE[refusal]).toBe(refusal);
  });

  test("name the Dashboard's controls as it draws them", () => {
    for (const label of [
      "Add Private Note",
      "Add Public Note",
      "Actions",
      "Add a private note",
      "Change State",
    ]) {
      expect(PRIVATE_NOTES_ONLY).toContain(`**${label}**`);
      expect({ label: label, inDashboard: label in DASHBOARD_LOCALE }).toEqual({
        label: label,
        inDashboard: true,
      });
    }
  });

  test("say every way a public note is made, and that public notes already there stay", () => {
    for (const way of [
      "**Its public notes page**",
      "**Changing its state**",
      "**In Slack and Microsoft Teams**",
      "**Through the API, workflows and OneUptime AI**",
      "An SLA rule's public note reminders wait until it is public again",
      "Public notes posted before the incident was made private stay.",
      "Incident episodes work the same way.",
    ]) {
      expect(PRIVATE_NOTES_ONLY).toContain(way);
    }
  });

  test("point at the section from the private paragraph and the chats' modal", () => {
    expect(
      NOTES.split(
        "[Private incidents take private notes only](#private-incidents-take-private-notes-only)",
      ).length - 1,
    ).toBe(2);
    expect(NOTES).toContain(
      "On a private incident it asks for no **Note Type** and adds a private note",
    );
  });

  test("no longer say a private episode's public notes follow the subscriber default", () => {
    expect(NOTES).not.toContain("making an episode private does not affect it");
    expect(NOTES).toContain(
      "A private incident or episode takes no public notes at all.",
    );
    expect(readDoc("status-pages/subscribers.md")).toContain(
      `Only this setting counts. A private episode takes no public notes at all: see ${SECTION_LINK}.`,
    );
  });
});

describe("the docs on a private incident's state changes", () => {
  const STATES: string = readDoc("incidents/states-and-severities.md");

  test("quote the API's refusal of a state change with a public note, word for word", () => {
    expect(STATES).toContain(
      `**A private incident's state change carries a private note.**`,
    );
    expect(STATES).toContain(
      `is refused whole: "${PrivateRecordPublicNotes.getStateChangeRefusalMessage(
        PrivateRecordKind.Incident,
      )}"`,
    );
  });

  test("say a private incident takes no public notes where it says it is on no status page", () => {
    expect(
      section(STATES, "## Keeping an incident off the status page"),
    ).toContain(`It takes no public notes either: see ${SECTION_LINK}.`);
  });
});

describe("the docs on a private incident in Slack and Microsoft Teams", () => {
  test("say a 📣 there is a private note, and the confirmation says why - as it does", () => {
    for (const page of [
      "workspace-connections/slack.md",
      "workspace-connections/microsoft-teams.md",
    ]) {
      expect(readDoc(page)).toContain(
        "On a private incident, a private note, and the confirmation says why.",
      );
    }

    // A 📣 on a private incident, confirmed: what it became, and why.
    const confirmation: string = WorkspaceReactionNote.getConfirmationMessage({
      noteType: WorkspaceNoteType.Private,
      askedNoteType: WorkspaceNoteType.Public,
      resourceType: WorkspaceNoteResourceType.Incident,
      resourceLabel: "Incident INC-1",
      resourceLink: "https://oneuptime.test/incidents/1",
    }).toString();

    expect(confirmation).toContain("**private note**");
    expect(confirmation).toContain(
      "The incident is private, so public notes cannot be added to it.",
    );
  });

  test("say Add Note asks for no note type there - as the form does", () => {
    expect(readDoc("workspace-connections/slack.md")).toContain(
      "- **Add Note on a private incident or episode.** A private incident or episode takes no public notes, so its form asks for no note type and adds a private note.",
    );
    expect(readDoc("workspace-connections/microsoft-teams.md")).toContain(
      "- **Add Note on a private incident.** A private incident takes no public notes, so its card asks for no note type and adds a private note.",
    );

    for (const kind of [
      PrivateRecordKind.Incident,
      PrivateRecordKind.IncidentEpisode,
    ]) {
      const blocks: Array<WorkspaceMessageBlock> =
        WorkspaceNoteForm.getSlackForm({
          kind: kind,
          isPrivateRecord: true,
        }).blocks;

      expect(
        blocks.some((block: WorkspaceMessageBlock): boolean => {
          return block._type === "WorkspaceDropdownBlock";
        }),
      ).toBe(false);
    }
  });
});
