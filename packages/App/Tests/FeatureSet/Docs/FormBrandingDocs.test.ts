import FormsCopy from "../../../FeatureSet/Dashboard/src/Components/FormBuilder/FormsCopy";
import Form from "Common/Models/DatabaseModels/Form";
import MimeType from "Common/Types/File/MimeType";
import {
  FORM_FAVICON_IMAGE_TYPES,
  FORM_FAVICON_MAX_BYTES,
  FORM_FAVICON_NOT_FOUND_MESSAGE,
  FORM_FAVICON_TOO_LARGE_MESSAGE,
  FORM_FAVICON_TYPE_MESSAGE,
  FORM_LOGO_IMAGE_TYPES,
  FORM_LOGO_MAX_BYTES,
  FORM_LOGO_NOT_FOUND_MESSAGE,
  FORM_LOGO_TOO_LARGE_MESSAGE,
  FORM_LOGO_TYPE_MESSAGE,
} from "Common/Types/Form/FormBranding";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Forms docs on a form's branding - the logo and favicon set in the
 * Build page's folded Branding section - against the product:
 *
 *   - Building a Form has a Branding section that names the dialog's fields
 *     as the dialog does, the image types and the size the server takes for
 *     each image, that a file must be of the form's own project, the
 *     OneUptime defaults, and quotes the refusals word for word;
 *   - Forms Overview lists the section on the Build page and the three API
 *     columns, as the Form model names them, with how to upload an image -
 *     in the form's project;
 *   - Sharing & Security says the images reach the page only inside the
 *     form, never by a file's id, and only of the form's own project.
 *
 * The Dashboard's Branding section is a React component, which App tests
 * never import: its field titles are read from its source.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Docs/Content/en/forms",
);
const SECTION_FILE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Components/FormBuilder/Branding/FormBrandingSection.tsx",
);

function readPage(name: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, `${name}.md`), "utf8");
}

// A section's text: from its heading to the next heading of its level or above.
function sectionOf(markdown: string, level: number, title: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.indexOf(`${"#".repeat(level)} ${title}`);

  expect({ title, found: start >= 0 }).toEqual({ title, found: true });

  const end: number = lines.findIndex((line: string, index: number) => {
    if (index <= start) {
      return false;
    }

    const match: RegExpMatchArray | null = line.match(/^(#{1,6}) /);

    return Boolean(match && (match[1] as string).length <= level);
  });

  return lines.slice(start, end < 0 ? undefined : end).join("\n");
}

// The first column of a section's table, in order.
function tableNames(section: string): Array<string> {
  return section
    .split("\n")
    .filter((line: string): boolean => {
      return line.startsWith("| **");
    })
    .map((line: string): string => {
      return (line.split("|")[1] as string).trim();
    });
}

const TYPE_NAMES: Record<string, string> = {
  [MimeType.png]: "PNG",
  [MimeType.jpeg]: "JPEG",
  [MimeType.gif]: "GIF",
  [MimeType.webp]: "WebP",
  [MimeType.svg]: "SVG",
  [MimeType.ico]: "ICO",
};

// "PNG, JPEG, GIF, WebP or SVG": the types as a sentence names them.
function typeList(types: ReadonlyArray<string>): string {
  const names: Array<string> = types.map((type: string): string => {
    return TYPE_NAMES[type] as string;
  });

  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

describe("Building a Form - Branding", () => {
  const building: string = readPage("building");
  const branding: string = sectionOf(building, 2, "Branding");

  it("is linked from the page's opening, which says it is folded above the questions", () => {
    expect(building.split("\n## ")[0]).toContain("[Branding](#branding)");
    expect(branding).toContain("**Branding**, folded above the questions");
  });

  it("says the OneUptime logo and favicon are shown until the form has its own", () => {
    expect(branding).toContain(
      "Until you upload your own, the form shows the OneUptime logo and favicon.",
    );
  });

  it("names the dialog's button and fields as the dialog does", () => {
    const source: string = fs.readFileSync(SECTION_FILE, "utf8");
    const titles: Array<string> = Array.from(
      source.matchAll(/^\s+title: "([^"]+)",$/gm),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(titles).toEqual(["Logo", "Logo Alt Text", "Favicon"]);
    expect(source).toContain("title={FormsCopy.editBranding}");
    expect(branding).toContain(`**${FormsCopy.editBranding}**`);
    expect(tableNames(branding)).toEqual(
      titles.map((title: string): string => {
        return `**${title}**`;
      }),
    );
  });

  it("names each image's types and size as the server takes them", () => {
    expect(typeList(FORM_LOGO_IMAGE_TYPES)).toBe("PNG, JPEG, GIF, WebP or SVG");
    expect(typeList(FORM_FAVICON_IMAGE_TYPES)).toBe(
      "PNG, JPEG, GIF, WebP, SVG or ICO",
    );
    expect(FORM_LOGO_MAX_BYTES).toBe(512 * 1024);
    expect(FORM_FAVICON_MAX_BYTES).toBe(128 * 1024);

    const logo: string = `A ${typeList(FORM_LOGO_IMAGE_TYPES)} image of ${
      FORM_LOGO_MAX_BYTES / 1024
    } KB or less.`;
    const favicon: string = `A ${typeList(FORM_FAVICON_IMAGE_TYPES)} image of ${
      FORM_FAVICON_MAX_BYTES / 1024
    } KB or less;`;

    expect(branding).toContain(logo);
    expect(branding).toContain(favicon);
    // The dialog says the same.
    expect(FormsCopy.logoDescription).toContain(logo);
    expect(FormsCopy.faviconDescription).toContain(
      `of ${FORM_FAVICON_MAX_BYTES / 1024} KB or less`,
    );
    expect(FormsCopy.faviconDescription).toContain("ICO");
    // Never the old limit.
    expect(branding).not.toContain("1 MB");
  });

  it("says a file must be of the form's own project", () => {
    expect(branding).toContain(
      "it must have been uploaded in the form's own project",
    );
    expect(branding).toContain("or that was uploaded in another project");
  });

  it("quotes every refusal word for word, the logo's and the favicon's", () => {
    for (const message of [
      FORM_LOGO_TYPE_MESSAGE,
      FORM_LOGO_TOO_LARGE_MESSAGE,
      FORM_LOGO_NOT_FOUND_MESSAGE,
      FORM_FAVICON_TYPE_MESSAGE,
      FORM_FAVICON_TOO_LARGE_MESSAGE,
      FORM_FAVICON_NOT_FOUND_MESSAGE,
    ]) {
      expect(branding).toContain(`"${message}"`);
    }
  });

  it("says Preview shows the logo, and the public page shows it first", () => {
    expect(sectionOf(building, 2, "Preview")).toContain(
      "the same logo, questions, inputs, options and checks",
    );
    expect(sectionOf(building, 2, "What the submitter sees")).toContain(
      "The public page shows the form's logo — the OneUptime logo until you upload yours",
    );
  });
});

describe("Forms Overview - branding", () => {
  const overview: string = readPage("index");

  it("lists Branding on the Build page, and among what Edit Form allows", () => {
    expect(sectionOf(overview, 2, "A form's pages")).toContain(
      "its **Branding** — logo and favicon, folded —",
    );
    expect(sectionOf(overview, 2, "Permissions")).toContain(
      "Changing a form: its questions, its branding,",
    );
  });

  it("names the API's columns as the Form model does, and how to upload an image", () => {
    const api: string = sectionOf(overview, 2, "Forms through the API");
    const form: Form = new Form();

    for (const column of ["logoFileId", "logoAltText", "faviconFileId"]) {
      expect(form.hasColumn(column)).toBe(true);
      expect(api).toContain(`\`${column}\``);
    }

    expect(api).toContain("`POST /api/file`, in the form's project");
    expect(api).toContain("`isPublic` set to `false`");
    expect(api).toContain(
      "it must have been uploaded in the form's project, and a logo must be a PNG, JPEG, GIF, WebP or SVG image of 512 KB or less, a favicon one of those or an ICO of 128 KB or less",
    );
    expect(api).toContain("[Branding](/docs/forms/building#branding)");
    expect(api).not.toContain("1 MB");
  });

  it("says the public read carries the branding", () => {
    expect(sectionOf(overview, 3, "The public page's own endpoints")).toContain(
      "and its logo, the logo's alt text and its favicon, the images base64, when it has them",
    );
  });
});

describe("Sharing & Security - branding", () => {
  it("says the images reach the page only inside the form, never by a file's id", () => {
    const protects: string = sectionOf(
      readPage("sharing-and-security"),
      2,
      "What protects a form",
    );

    expect(protects).toContain(
      "they are sent inside the answer that opens it, base64, only once it has passed the first four checks, and never from an address of their own",
    );
    expect(protects).toContain(
      "no file can be fetched by its id through a form; the files themselves stay private",
    );
    expect(protects).toContain(
      "A form shows only images uploaded in its own project",
    );
  });
});
