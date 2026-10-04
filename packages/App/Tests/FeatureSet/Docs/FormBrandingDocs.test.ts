import FormsCopy from "../../../FeatureSet/Dashboard/src/Components/FormBuilder/FormsCopy";
import Form from "Common/Models/DatabaseModels/Form";
import MimeType from "Common/Types/File/MimeType";
import {
  FORM_BRANDING_IMAGE_MAX_BYTES,
  FORM_BRANDING_IMAGE_TYPES,
  FORM_FAVICON_NOT_FOUND_MESSAGE,
  FORM_FAVICON_TOO_LARGE_MESSAGE,
  FORM_FAVICON_TYPE_MESSAGE,
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
 *     as the dialog does, the image types and the size the server takes,
 *     the OneUptime defaults, and quotes the refusals word for word;
 *   - Forms Overview lists the section on the Build page and the three API
 *     columns, as the Form model names them, with how to upload an image;
 *   - Sharing & Security says the images reach the page only inside the
 *     form, never by a file's id.
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
};

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

  it("names the image types and the size the server takes", () => {
    const types: string = FORM_BRANDING_IMAGE_TYPES.map(
      (type: string): string => {
        return TYPE_NAMES[type] as string;
      },
    ).join(", ");

    expect(types).toBe("PNG, JPEG, GIF, WebP, SVG");
    expect(FORM_BRANDING_IMAGE_MAX_BYTES).toBe(1024 * 1024);
    expect(branding).toContain(
      "A PNG, JPEG, GIF, WebP or SVG image of 1 MB or less.",
    );
    // The dialog says the same.
    expect(FormsCopy.logoDescription).toContain(
      "A PNG, JPEG, GIF, WebP or SVG image of 1 MB or less.",
    );
  });

  it("quotes the logo's refusals word for word, and says the favicon's are the same", () => {
    for (const message of [
      FORM_LOGO_TYPE_MESSAGE,
      FORM_LOGO_TOO_LARGE_MESSAGE,
      FORM_LOGO_NOT_FOUND_MESSAGE,
    ]) {
      expect(branding).toContain(`"${message}"`);
    }

    expect([
      FORM_FAVICON_TYPE_MESSAGE,
      FORM_FAVICON_TOO_LARGE_MESSAGE,
      FORM_FAVICON_NOT_FOUND_MESSAGE,
    ]).toEqual(
      [
        FORM_LOGO_TYPE_MESSAGE,
        FORM_LOGO_TOO_LARGE_MESSAGE,
        FORM_LOGO_NOT_FOUND_MESSAGE,
      ].map((message: string): string => {
        return message.replace(/logo/g, "favicon");
      }),
    );
    expect(branding).toContain(
      "A favicon is refused the same way, in the same words.",
    );
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

    expect(api).toContain("`POST /api/file`");
    expect(api).toContain("`isPublic` set to `false`");
    expect(api).toContain("[Branding](/docs/forms/building#branding)");
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
  });
});
