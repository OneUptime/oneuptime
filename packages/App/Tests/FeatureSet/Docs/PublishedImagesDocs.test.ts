import {
  PUBLISHED_MARKDOWN,
  PublishedMarkdown,
} from "Common/Server/Utils/File/PublishedImages";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The docs on who sees an image people put in what they write, against the
 * product: an image is public only while something the status pages show
 * has it in it (PublishedImages), private again once nothing does, and a
 * read of a record hands back only the files the reader may open
 * (RelatedFileAccess).
 *
 * English only, as earlier changes to these pages were.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const CONTENT_DIR: string = path.join(
  REPO_ROOT,
  "packages",
  "App",
  "FeatureSet",
  "Docs",
  "Content",
  "en",
);

function readPage(relativePath: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, relativePath), "utf8");
}

/*
 * How the notes page names each kind of record whose images are shown to
 * everyone. A kind added to PUBLISHED_MARKDOWN later fails here until the
 * page names it too.
 */
const NAMED_AS: Record<string, string> = {
  "Incident.description":
    "the incident's description while the incident is **Visible on Status Page**",
  "Incident.postmortemNote": "its postmortem once that is published there too",
  "IncidentPublicNote.note": "a public note",
  "IncidentEpisodePublicNote.note": "a public note",
  "ScheduledMaintenancePublicNote.note": "a public note",
  "IncidentEpisode.description":
    "an episode's or a scheduled maintenance event's description while it is shown on status pages",
  "ScheduledMaintenance.description":
    "an episode's or a scheduled maintenance event's description while it is shown on status pages",
  "StatusPageAnnouncement.description": "an announcement",
  "StatusPage.overviewPageDescription":
    "the status page's own overview, group and resource descriptions",
  "StatusPageGroup.description":
    "the status page's own overview, group and resource descriptions",
  "StatusPageResource.displayDescription":
    "the status page's own overview, group and resource descriptions",
};

describe("Incident notes docs: an image is public only while the status pages show it", () => {
  const page: string = readPage("incidents/notes-owners-and-feed.md");

  it("names every kind of record whose images everyone sees", () => {
    for (const source of PUBLISHED_MARKDOWN) {
      for (const column of source.markdownColumns) {
        const name: string = `${(source as PublishedMarkdown).tableName}.${column}`;

        expect({ name, named: NAMED_AS[name] }).toEqual({
          name,
          named: expect.any(String),
        });
        expect(page).toContain(NAMED_AS[name]!);
      }
    }
  });

  it("says an image is viewable by everyone only while the status pages show it", () => {
    expect(page).toContain(
      "An image is viewable by everyone only while something your status pages show has it in it",
    );
  });

  it("says the image is private again once nothing shows it", () => {
    expect(page).toContain(
      "When that stops — the incident is hidden, the image is edited out, the note is deleted — the image is private again, unless something else your status pages show still has it in it.",
    );
  });

  it("says a read lists only the attachments the reader may open", () => {
    expect(page).toContain(
      "Reading a note through the API, Terraform or a workflow lists only the attachments the reader may open: files of the note's project, and public files.",
    );
  });
});

describe("Declaring docs: an image in the description follows the incident's visibility", () => {
  it("says who sees an image in the description", () => {
    expect(readPage("incidents/declaring-incidents.md")).toContain(
      "An image you put in it is shown to everyone while the incident is visible on status pages, and only to your project's members while it is hidden.",
    );
  });
});

describe("Status page docs: the page's own text shows its images to every visitor", () => {
  it("says so for the overview description", () => {
    expect(readPage("status-pages/branding-and-domains.md")).toContain(
      "Use it for a sentence of context: what this page covers, and where to go for support. An image you put in it is shown to every visitor of the page.",
    );
  });

  it("says so for group and resource descriptions", () => {
    const page: string = readPage("status-pages/resources-and-groups.md");

    expect(page).toContain(
      "good for a sentence explaining what the service actually does; an image in it is shown to every visitor",
    );
    expect(page).toContain(
      "**Group Description** (`description`) — optional markdown, shown under the heading. An image in it is shown to every visitor.",
    );
  });

  it("says the dashboard and the API read the page's images as the page shows them", () => {
    expect(readPage("status-pages/branding-and-domains.md")).toContain(
      "The dashboard, the API and Terraform read the page's images the same way: an image of another project comes back as no image at all.",
    );
  });
});
