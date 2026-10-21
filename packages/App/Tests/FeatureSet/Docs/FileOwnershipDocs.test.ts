import FileOwnership, {
  FileReferenceColumn,
} from "Common/Server/Utils/File/FileOwnership";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The docs on a status page's and a public dashboard's images against the
 * product: each image must be a file uploaded in the record's own project,
 * that is checked on every save, and a file of another project is refused
 * with the words a missing file gets - quoted here word for word from the
 * server (FileOwnership, which builds each refusal from the model).
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

function refusalsOf(model: BaseModel): Array<string> {
  return FileOwnership.getFileReferenceColumns(model).map(
    (column: FileReferenceColumn): string => {
      return column.notFoundMessage;
    },
  );
}

describe("Status page branding docs: the images are the project's own files", () => {
  const page: string = readPage("status-pages/branding-and-domains.md");

  it("says each image is a file of the status page's own project, checked on every save", () => {
    expect(page).toContain(
      "The logo, the cover image and the favicon are files uploaded in the status page's own project",
    );
    expect(page).toContain(
      "from the dashboard, the API, Terraform or a workflow",
    );
  });

  it("quotes every refusal the server gives, word for word", () => {
    const refusals: Array<string> = refusalsOf(new StatusPage());

    expect(refusals).toHaveLength(3);

    for (const refusal of refusals) {
      expect(page).toContain(`"${refusal}"`);
    }
  });

  it("says the page shows only images of its own project", () => {
    expect(page).toContain(
      "Your status page shows only images of its own project",
    );
  });
});

describe("Public dashboard branding docs: the images are the project's own files", () => {
  const page: string = readPage("dashboards/sharing.md");

  it("says the logo and favicon are files of the dashboard's own project, checked on every save", () => {
    expect(page).toContain(
      "The logo and the favicon are files uploaded in the dashboard's own project",
    );
  });

  it("quotes every refusal the server gives, word for word", () => {
    const refusals: Array<string> = refusalsOf(new Dashboard());

    expect(refusals).toHaveLength(2);

    for (const refusal of refusals) {
      expect(page).toContain(`"${refusal}"`);
    }
  });
});

describe("Status page branding docs: emails show only a logo the page can show", () => {
  it("says the page's emails leave out a logo the page cannot show", () => {
    expect(readPage("status-pages/branding-and-domains.md")).toContain(
      "The emails the page sends — to subscribers, and to private users about their sign-in — show its logo the same way: a logo the page cannot show is left out of them too, rather than shown as a broken image.",
    );
  });
});

describe("Incident notes docs: who sees an image in a note", () => {
  const page: string = readPage("incidents/notes-owners-and-feed.md");

  // A section, from its heading to the next one.
  function section(heading: string): string {
    const start: number = page.indexOf(`## ${heading}\n`);

    expect(start).toBeGreaterThan(-1);

    const next: number = page.indexOf("\n## ", start + 1);

    return page.slice(start, next === -1 ? undefined : next);
  }

  /*
   * Inside the attachments' section, as the same public/private decision:
   * a heading of its own would have to be added to every translation, whose
   * headings mirror the English ones (IncidentLinkedAlertsDocs).
   */
  it("is told with the attachments, as the same decision", () => {
    expect(section("Attachments on notes")).toContain(
      "Images follow the same decision.",
    );
  });

  it("says a private note's image is shown only to the project's members", () => {
    expect(section("Attachments on notes")).toContain(
      "an image is shown only to the members of the project, signed in the way the project requires",
    );
  });

  it("says a public note's image is shown to everyone who can see the note", () => {
    expect(section("Attachments on notes")).toContain(
      "**In a public note** an image is shown to everyone who can see the note: on the status page, and in the emails its subscribers get.",
    );
  });

  it("says every upload starts private, from the dashboard and the API alike", () => {
    expect(section("Attachments on notes")).toContain(
      "Every upload starts private, from the dashboard and from the API alike.",
    );
  });
});
