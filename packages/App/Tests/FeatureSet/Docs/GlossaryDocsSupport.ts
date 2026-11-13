import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import { readPage } from "./DocsContentSupport";
import { slugifyMarkdownHeading } from "Common/Server/Types/MarkdownSlugify";
import { RETIRED_NAMES } from "Common/Types/Docs/RetiredNames";
import fs from "fs";
import path from "path";

/*
 * Reading the Glossary page (introduction/glossary) and the "Which One Do I
 * Use?" page (introduction/which-one) the way their suites check them: the
 * Glossary's terms, each with its group, its definition and its names line,
 * and the pages' tables. The docs serve the Glossary as data from the same
 * Markdown (FeatureSet/Docs/Utils/Glossary.ts); these readers are the
 * suites' own, so a mistake in that reader does not hide one on the page.
 */

export const GLOSSARY: string = "introduction/glossary";
export const WHICH_ONE: string = "introduction/which-one";

export interface GlossaryTermBlock {
  // The heading's text, as written.
  term: string;
  // The heading's anchor (MarkdownSlugify).
  anchor: string;
  // The "## " group it is under, as written.
  group: string;
  // The paragraphs before the names line.
  definition: Array<string>;
  // The last paragraph: the other names and the links. "" when there is none.
  names: string;
  // The line the heading is on, 1-based.
  line: number;
}

const BOLD: RegExp = /\*\*([^*]+)\*\*/g;
const CODE: RegExp = /`([^`]+)`/g;
const LINK: RegExp = /\[([^\]]+)\]\(([^)\s]+)\)/g;

// The Glossary's terms, in order, from its Markdown.
export function glossaryTerms(markdown: string): Array<GlossaryTermBlock> {
  const terms: Array<GlossaryTermBlock> = [];
  let group: string = "";
  let current: { block: GlossaryTermBlock; paragraphs: Array<string> } | null =
    null;
  let paragraph: Array<string> = [];

  const finish: () => void = (): void => {
    if (current && paragraph.length > 0) {
      current.paragraphs.push(paragraph.join(" "));
    }
    paragraph = [];
  };

  const close: () => void = (): void => {
    finish();

    if (!current) {
      return;
    }

    const last: string =
      current.paragraphs[current.paragraphs.length - 1] || "";
    const named: boolean =
      current.paragraphs.length > 1 && last.includes("](/docs/");

    current.block.definition = named
      ? current.paragraphs.slice(0, -1)
      : current.paragraphs;
    current.block.names = named ? last : "";
    terms.push(current.block);
    current = null;
  };

  markdown.split("\n").forEach((line: string, index: number) => {
    if (line.startsWith("## ")) {
      close();
      group = line.slice(3).trim();
      return;
    }

    if (line.startsWith("### ")) {
      close();
      const term: string = line.slice(4).trim();
      current = {
        block: {
          term: term,
          anchor: slugifyMarkdownHeading(term),
          group: group,
          definition: [],
          names: "",
          line: index + 1,
        },
        paragraphs: [],
      };
      return;
    }

    if (line.trim() === "") {
      finish();
      return;
    }

    paragraph.push(line.trim());
  });

  close();

  return terms;
}

// The bold and code names on a names line, in the order they are written.
export function namesOf(namesLine: string): Array<string> {
  return [
    ...Array.from(namesLine.matchAll(BOLD)),
    ...Array.from(namesLine.matchAll(CODE)),
  ]
    .sort((a: RegExpMatchArray, b: RegExpMatchArray): number => {
      return (a.index || 0) - (b.index || 0);
    })
    .map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });
}

// The bold names on a names line.
export function boldNamesOf(namesLine: string): Array<string> {
  return Array.from(namesLine.matchAll(BOLD)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

// The code names on a names line.
export function codeNamesOf(namesLine: string): Array<string> {
  return Array.from(namesLine.matchAll(CODE)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

export interface MarkdownLink {
  text: string;
  target: string;
}

// The links in some Markdown, in order.
export function linksOf(markdown: string): Array<MarkdownLink> {
  return Array.from(markdown.matchAll(LINK)).map(
    (match: RegExpMatchArray): MarkdownLink => {
      return { text: match[1] as string, target: match[2] as string };
    },
  );
}

/*
 * What each card line opens, anchor and all: "#start-here" for a card that
 * opens a section of its own page (cardTargets reads the page alone).
 */
export function cardLinkTargets(cardLines: Array<string>): Array<string> {
  return cardLines.map((line: string): string => {
    return linksOf(line)[0]?.target || "";
  });
}

// A docs link's page, without "/docs/", a language or an anchor.
export function linkedPage(target: string): string {
  return (target.split("#")[0] as string).replace(/^\/docs\//, "");
}

// The English title of the nav link that opens a page.
export function englishNavTitle(page: string): string | null {
  for (const group of DocsNav as Array<NavGroup>) {
    for (const link of group.links as Array<NavLink>) {
      if (link.url === `/docs/${page}`) {
        return link.title;
      }
    }
  }

  return null;
}

// The Glossary's terms in a language.
export function glossaryTermsIn(language: string): Array<GlossaryTermBlock> {
  return glossaryTerms(readPage(language, GLOSSARY));
}

/*
 * The part of a page under a heading line ("## Monitor group, service or
 * label?"), up to the next heading of the same or a higher level.
 */
export function sectionUnder(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.indexOf(heading);

  if (start < 0) {
    throw new Error(`The page has no heading "${heading}"`);
  }

  const level: number = (heading.match(/^#+/) as RegExpMatchArray)[0].length;
  let end: number = lines.length;

  for (let index: number = start + 1; index < lines.length; index++) {
    const match: RegExpMatchArray | null = (lines[index] as string).match(
      /^(#+) /,
    );

    if (match && (match[1] as string).length <= level) {
      end = index;
      break;
    }
  }

  return lines.slice(start, end).join("\n");
}

// The "## " headings of a page, in order, as written.
export function sectionHeadings(markdown: string): Array<string> {
  return markdown.split("\n").filter((line: string): boolean => {
    return line.startsWith("## ");
  });
}

const TABLE_SEPARATOR: RegExp = /^:?-+:?$/;

// The body rows of each table in some Markdown, as trimmed cells.
export function tablesIn(markdown: string): Array<Array<Array<string>>> {
  const tables: Array<Array<Array<string>>> = [];
  let current: Array<Array<string>> | null = null;

  for (const line of markdown.split("\n")) {
    if (!line.startsWith("|")) {
      current = null;
      continue;
    }

    const cells: Array<string> = line
      .slice(1, line.endsWith("|") ? -1 : undefined)
      .split("|")
      .map((cell: string): string => {
        return cell.trim();
      });

    if (!current) {
      current = [];
      tables.push(current);
      continue;
    }

    if (
      cells.every((cell: string): boolean => {
        return TABLE_SEPARATOR.test(cell);
      })
    ) {
      continue;
    }

    current.push(cells);
  }

  return tables;
}

// ---- the product's own words ------------------------------------------------

const PACKAGES: string = path.resolve(__dirname, "../../../..");
const MODELS_DIR: string = path.join(PACKAGES, "Common/Models/DatabaseModels");
const DASHBOARD_LOCALE: string = path.join(
  PACKAGES,
  "App/FeatureSet/Dashboard/src/Locales/en.json",
);

// A model's names, the ones it kept in the API after a rename (#6817) too.
const MODEL_NAME: RegExp =
  /\b(singularName|pluralName|formerSingularName|formerPluralName|apiSingularName|apiPluralName|tableName):\s*"([^"]+)"/g;
const CRUD_ROUTE: RegExp = /@CrudApiEndpoint\(new Route\("([^"]+)"\)\)/g;
const MODEL_CLASS: RegExp = /export default class (\w+)/g;

let productNames: Set<string> | null = null;
let codeNames: Set<string> | null = null;

/*
 * Every name the product shows a person: the Dashboard's English words (its
 * locale's keys and values), each model's names (singular, plural and the
 * names it had before), the docs' own nav titles, and the names #6817
 * retired (Common/Types/Docs/RetiredNames), which people learned there.
 */
export function namesTheProductUses(): Set<string> {
  if (productNames) {
    return productNames;
  }

  const names: Set<string> = new Set<string>();
  const locale: Record<string, unknown> = JSON.parse(
    fs.readFileSync(DASHBOARD_LOCALE, "utf8"),
  ) as Record<string, unknown>;

  const walk: (value: unknown) => void = (value: unknown): void => {
    if (typeof value === "string") {
      names.add(value);
      return;
    }

    if (value && typeof value === "object") {
      for (const [key, inner] of Object.entries(
        value as Record<string, unknown>,
      )) {
        if (typeof inner === "string" && value === locale) {
          names.add(key);
        }
        walk(inner);
      }
    }
  };

  walk(locale);

  for (const file of fs.readdirSync(MODELS_DIR)) {
    if (!file.endsWith(".ts")) {
      continue;
    }

    const source: string = fs.readFileSync(path.join(MODELS_DIR, file), "utf8");

    for (const match of Array.from(source.matchAll(MODEL_NAME))) {
      names.add(match[2] as string);
    }
  }

  for (const group of DocsNav as Array<NavGroup>) {
    names.add(group.title);

    for (const link of group.links as Array<NavLink>) {
      names.add(link.title);
    }
  }

  for (const retired of RETIRED_NAMES) {
    names.add(retired.name);
  }

  productNames = names;

  return names;
}

/*
 * Every name the product's code and API go by: each model's class and
 * table, and each API route the models are served at.
 */
export function namesTheCodeUses(): Set<string> {
  if (codeNames) {
    return codeNames;
  }

  const names: Set<string> = new Set<string>();

  for (const file of fs.readdirSync(MODELS_DIR)) {
    if (!file.endsWith(".ts")) {
      continue;
    }

    const source: string = fs.readFileSync(path.join(MODELS_DIR, file), "utf8");

    for (const pattern of [CRUD_ROUTE, MODEL_CLASS]) {
      for (const match of Array.from(source.matchAll(pattern))) {
        names.add(match[1] as string);
      }
    }
  }

  codeNames = names;

  return names;
}
