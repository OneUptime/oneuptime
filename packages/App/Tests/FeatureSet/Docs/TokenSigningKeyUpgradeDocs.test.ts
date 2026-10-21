import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { inlineCode } from "./DocsTranslationChecks";
import { flattened, otherChangesItems } from "./UpgradingDocsNotes";
import { slugifyMarkdownHeading } from "Common/Server/Types/MarkdownSlugify";
import { InsecureEncryptionSecretValues } from "Common/Server/EnvironmentConfig";
import InstanceTokenSigningKey from "Common/Models/DatabaseModels/InstanceTokenSigningKey";
import { readExampleEnvEncryptionSecret } from "Common/Tests/Server/TestingUtils/ShippedEncryptionSecrets";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The upgrade note on sign-in tokens and a placeholder ENCRYPTION_SECRET
 * (installation/upgrading, "Other changes in 14"), held to the code it
 * describes:
 *
 *   - the values it calls placeholders are exactly the ones the server treats
 *     as shipped (EnvironmentConfig.InsecureEncryptionSecretValues) and the
 *     one config.example.env ships;
 *   - the key it says the installation keeps in its database is the
 *     InstanceTokenSigningKey table;
 *   - it points at the Docker Compose guide's "Generate random secrets" step,
 *     in every language at that language's own heading;
 *   - every translation carries it in the English note's place, with the same
 *     code and a lead of its own.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const NOTE_LEAD: string =
  "**A placeholder `ENCRYPTION_SECRET` no longer signs sign-in tokens.**";
const PREVIOUS_LEAD: string =
  "**A database statement the app stops waiting for is cancelled.**";
// The note after it: the workflow builder's field lists (WorkflowFieldListsUpgradeDocs).
const NEXT_LEAD: string =
  "**A workflow's field lists have plain names, and a watched related record is heard.**";
const SECRETS_HEADING: string = "### Generate random secrets";
const DOCKER_COMPOSE_PAGE: string = "installation/docker-compose";
const LINK_TARGET: RegExp = /\]\(([^)\s]+)\)/g;
const HEADING_LINE: RegExp = /^#{1,6}\s/;
const FENCE_LINE: RegExp = /^\s*```/;
const HEADING_MARKER: RegExp = /^#+\s+/;

const TRANSLATIONS: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

function page(language: string, name: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, `${name}.md`),
    "utf8",
  );
}

// The headings of a page, in order, outside code blocks.
function headings(markdown: string): Array<string> {
  const found: Array<string> = [];
  let inFence: boolean = false;

  for (const line of markdown.split("\n")) {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      continue;
    }

    if (!inFence && HEADING_LINE.test(line)) {
      found.push(line.trim());
    }
  }

  return found;
}

// The anchor of a language's "Generate random secrets" step.
function secretsAnchor(language: string): string {
  const index: number = headings(page("en", DOCKER_COMPOSE_PAGE)).indexOf(
    SECRETS_HEADING,
  );

  expect(index).toBeGreaterThan(-1);

  const heading: string | undefined = headings(
    page(language, DOCKER_COMPOSE_PAGE),
  )[index];

  expect({ language, heading: Boolean(heading) }).toEqual({
    language,
    heading: true,
  });

  return slugifyMarkdownHeading(
    (heading as string).replace(HEADING_MARKER, ""),
  );
}

function linkTargets(text: string): Array<string> {
  return Array.from(text.matchAll(LINK_TARGET)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

const ENGLISH_ITEMS: Array<string> = otherChangesItems("en");
const NOTE_INDEX: number = ENGLISH_ITEMS.findIndex((item: string): boolean => {
  return item.startsWith(`- ${NOTE_LEAD}`);
});

describe("the English upgrade note on sign-in tokens", () => {
  const note: string = flattened(ENGLISH_ITEMS[NOTE_INDEX] || "");

  it("is a note of the 13 → 14 changes, once, after the note on cancelled statements and before the note on workflow field lists", () => {
    expect(NOTE_INDEX).toBeGreaterThan(0);
    expect(
      ENGLISH_ITEMS.filter((item: string): boolean => {
        return item.includes(NOTE_LEAD);
      }),
    ).toHaveLength(1);
    expect(
      ENGLISH_ITEMS[NOTE_INDEX - 1]!.startsWith(`- ${PREVIOUS_LEAD}`),
    ).toBe(true);
    expect(
      flattened(ENGLISH_ITEMS[NOTE_INDEX + 1]!).startsWith(`- ${NEXT_LEAD}`),
    ).toBe(true);
  });

  it("names as placeholders exactly the values the server treats as shipped", () => {
    const code: Array<string> = inlineCode(note);

    for (const shipped of [
      ...InsecureEncryptionSecretValues,
      readExampleEnvEncryptionSecret(),
    ]) {
      expect({ shipped, named: code.includes(shipped) }).toEqual({
        shipped,
        named: true,
      });
    }

    expect(code).toContain("config.example.env");
    expect(note).toContain("is unset");
  });

  it("says the key is random and kept in the database, as InstanceTokenSigningKey keeps it", () => {
    expect(new InstanceTokenSigningKey().tableName).toBe(
      "InstanceTokenSigningKey",
    );
    expect(note).toContain(
      "random key it generates on its first start and keeps in its database",
    );
  });

  it("says which sign-ins are asked for again, and that an installation with its own secret sees no change", () => {
    expect(note).toContain(
      "it asks once more for the sign-ins it cannot renew by itself: SSO, and the password of a status page or a dashboard",
    );
    expect(note).toContain(
      "An installation that set its own `ENCRYPTION_SECRET`",
    );
    expect(note).toContain("sees no change");
  });

  it("points at the Docker Compose guide's step that generates the secrets", () => {
    expect(linkTargets(note)).toEqual([
      `/docs/${DOCKER_COMPOSE_PAGE}#${secretsAnchor("en")}`,
    ]);
  });
});

describe.each(TRANSLATIONS)(
  "the %s upgrade note on sign-in tokens",
  (language: string) => {
    const note: string = flattened(
      otherChangesItems(language)[NOTE_INDEX] || "",
    );

    it("is in the English note's place, under a lead of its own", () => {
      expect(note.startsWith("- **")).toBe(true);
      expect(note).not.toContain(NOTE_LEAD);
      expect(
        otherChangesItems(language).filter((item: string): boolean => {
          return item.includes("please-change-this-to-random-value");
        }),
      ).toHaveLength(1);
    });

    it("carries the English note's code", () => {
      expect(inlineCode(note)).toEqual(
        inlineCode(flattened(ENGLISH_ITEMS[NOTE_INDEX] || "")),
      );
    });

    it("points at its own language's step that generates the secrets", () => {
      expect(linkTargets(note)).toEqual([
        `/docs/${DOCKER_COMPOSE_PAGE}#${secretsAnchor(language)}`,
      ]);
    });
  },
);
