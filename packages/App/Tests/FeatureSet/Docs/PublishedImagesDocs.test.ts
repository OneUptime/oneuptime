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
  "IncidentPublicNote.note":
    "a public note while its incident, episode or scheduled maintenance event is shown on status pages",
  "IncidentEpisodePublicNote.note":
    "a public note while its incident, episode or scheduled maintenance event is shown on status pages",
  "ScheduledMaintenancePublicNote.note":
    "a public note while its incident, episode or scheduled maintenance event is shown on status pages",
  "IncidentEpisode.description":
    "an episode's or a scheduled maintenance event's description while it is shown on status pages",
  "ScheduledMaintenance.description":
    "an episode's or a scheduled maintenance event's description while it is shown on status pages",
  "StatusPageAnnouncement.description":
    "an announcement from the time it starts showing",
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
      if (source.shownOn !== "statusPage") {
        // A form's page has its own page of docs, below.
        continue;
      }

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
      "When that stops — the incident is hidden or made private, the image is edited out, the note or the incident is deleted — the image is private again, unless something else your status pages show still has it in it.",
    );
  });

  it("says a public note's images are shown only while its incident is", () => {
    expect(page).toContain(
      "A public note is shown with its incident, never without it: while the incident is hidden from status pages or private, its notes' images are shown only to the members of the project too.",
    );

    // As the rule has it: every public note is shown under its record.
    for (const source of PUBLISHED_MARKDOWN) {
      if (source.tableName.endsWith("PublicNote")) {
        expect(source.shownUnder).toBeDefined();
      }
    }
  });

  it("says a read lists only the attachments the reader may open", () => {
    expect(page).toContain(
      "Reading a note through the API, Terraform or a workflow lists only the attachments the reader may open: files of the note's project, and public files.",
    );
  });
});

describe("Announcement docs: an announcement's images open for everyone from its start on", () => {
  const page: string = readPage("status-pages/subscribers.md");

  it("says its images are private while it is scheduled for later", () => {
    expect(page).toContain(
      "An image in an announcement's description opens for everyone from **Start Showing Announcement At** on, not before. While an announcement is scheduled for later, its images open only for your project's members, just as the announcement itself shows only in the dashboard.",
    );
  });

  it("says they stay open after it ends, as the page still lists it", () => {
    expect(page).toContain(
      "They stay that way after it ends, because its status pages still list it under **Past Announcements** and its link keeps working.",
    );
  });

  it("says moving it to a later time makes them private again", () => {
    expect(page).toContain(
      "Move an announcement to a later time and its images are private again until then.",
    );
  });

  it("is said of the one kind of record shown from a time", () => {
    expect(
      PUBLISHED_MARKDOWN.filter((source: PublishedMarkdown): boolean => {
        return Boolean(source.shownFrom);
      }).map((source: PublishedMarkdown): string => {
        return `${source.tableName} from ${source.shownFrom}`;
      }),
    ).toEqual(["StatusPageAnnouncement from showAnnouncementAt"]);
  });
});

describe("Forms docs: a form's texts show their images while it accepts submissions", () => {
  it("names every kind of form text whose images everyone sees", () => {
    expect(
      PUBLISHED_MARKDOWN.filter((source: PublishedMarkdown): boolean => {
        return source.shownOn === "formPage";
      }).map((source: PublishedMarkdown): string => {
        return `${source.tableName}.${source.markdownColumns.join("+")} when ${source.shownWhen.join(" and ")}`;
      }),
    ).toEqual(["Form.description+successMessage when isEnabled"]);
  });

  it("says who sees an image in a form's description or thank-you message", () => {
    expect(readPage("forms/sharing-and-security.md")).toContain(
      "An image in the form's description or thank-you message is shown to everyone who opens the link while the form is **Accepting Submissions**. Turn the form off, or take the image out, and the image is private again, unless something else everyone sees still has it in it.",
    );
    expect(readPage("incidents/notes-owners-and-feed.md")).toContain(
      "A form's description and thank-you message show their images to everyone the same way, while the form is accepting submissions.",
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

  it("says how a page that asks for a sign-in shows its images", () => {
    expect(readPage("status-pages/index.md")).toContain(
      "**Images.** An image in what the page shows — a public note, an announcement, a description — is opened by its own long, unguessable address, which works without signing in, so that the emails your subscribers get can show it too.",
    );
  });

  it("says the dashboard and the API read the page's images as the page shows them", () => {
    expect(readPage("status-pages/branding-and-domains.md")).toContain(
      "The dashboard, the API and Terraform read the page's images the same way: an image of another project comes back as no image at all.",
    );
  });
});
