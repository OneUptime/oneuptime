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
