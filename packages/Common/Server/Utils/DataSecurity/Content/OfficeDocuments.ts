import FieldCollector from "../../../../Utils/DataSecurity/FieldCollector";
import { MAX_FIELD_VALUE_LENGTH } from "../../../../Utils/DataSecurity/FieldClassifier";
import { MAX_SCANNED_TEXT_LENGTH } from "../../../../Utils/DataSecurity/TextScanner";
import { decodeXmlEntities, looksLikeHeaderRow } from "./TextReaders";
import ZipReader, { ZipEntry, ZipError } from "./ZipReader";

/*
 * WORD, EXCEL AND POWERPOINT FILES, READ AS WHAT THEY SAY.
 *
 * A DOCX is its paragraphs (word/document.xml, with its headers, footers,
 * notes and comments), a PPTX its slides and speaker notes, both read as
 * free text. An XLSX is a table: its shared strings and each sheet's cells,
 * kept by column - the first row names the columns when it reads as names,
 * the column letters do otherwise - so a sheet is classified the way a CSV
 * export of it would be.
 *
 * The XML is machine-written and read with a small walk (walkXml) that
 * finds each tag with indexOf and steps over quoted attribute values, in
 * one pass. Entries come from ZipReader, inside its limits; one that
 * cannot be read becomes a warning, and the rest are still read.
 */

export enum OfficeKind {
  Word = "DOCX",
  Excel = "XLSX",
  PowerPoint = "PPTX",
}

const WORD_EXTENSIONS: ReadonlySet<string> = new Set(["docx", "docm", "dotx"]);
const EXCEL_EXTENSIONS: ReadonlySet<string> = new Set(["xlsx", "xlsm", "xltx"]);
const POWERPOINT_EXTENSIONS: ReadonlySet<string> = new Set([
  "pptx",
  "pptm",
  "potx",
]);

// The parts of a Word document that hold text.
const WORD_TEXT_PART: RegExp =
  /^word\/(?:document|footnotes|endnotes|comments|header[0-9]{1,4}|footer[0-9]{1,4})\.xml$/;
const SLIDE_PART: RegExp = /^ppt\/slides\/slide([0-9]{1,5})\.xml$/;
const NOTES_PART: RegExp = /^ppt\/notesSlides\/notesSlide([0-9]{1,5})\.xml$/;
const SHEET_PART: RegExp = /^xl\/worksheets\/sheet([0-9]{1,5})\.xml$/;
const CELL_COLUMN: RegExp = /^[A-Z]{1,3}/;
const DIMENSION_LAST_ROW: RegExp = /:[A-Z]{1,3}([0-9]{1,7})$/;

// The most sheets of a workbook read, and rows of one sheet collected.
const MAX_SHEETS: number = 20;
const MAX_SHEET_ROWS_COLLECTED: number = 1_000;

// The most shared strings a workbook's cells are looked up in.
const MAX_SHARED_STRINGS: number = 200_000;

export interface OfficeText {
  text: string;
  warnings: Array<string>;
  isPartial: boolean;
}

export interface OfficeTable {
  collector: FieldCollector;
  // Data rows across every sheet read.
  records: number;
  warnings: Array<string>;
  isPartial: boolean;
}

export function getOfficeKind(
  zip: ZipReader,
  extension: string,
): OfficeKind | null {
  if (WORD_EXTENSIONS.has(extension)) {
    return OfficeKind.Word;
  }

  if (EXCEL_EXTENSIONS.has(extension)) {
    return OfficeKind.Excel;
  }

  if (POWERPOINT_EXTENSIONS.has(extension)) {
    return OfficeKind.PowerPoint;
  }

  // A document saved under another name: known by what it holds.
  for (const entry of zip.entries) {
    if (entry.name === "word/document.xml") {
      return OfficeKind.Word;
    }

    if (entry.name === "xl/workbook.xml") {
      return OfficeKind.Excel;
    }

    if (entry.name === "ppt/presentation.xml") {
      return OfficeKind.PowerPoint;
    }
  }

  return null;
}

/*
 * XML, ONE TAG AT A TIME.
 *
 * Calls `open` for every start tag (with the tag as written, for its
 * attributes), `close` for every end tag and after a self-closing one, and
 * `text` for what is between tags, decoded. Comments and processing
 * instructions are skipped; CDATA is text. A tag that never ends stops the
 * walk: what follows it cannot be read.
 */
export interface XmlVisitor {
  open: (name: string, tag: string) => void;
  close: (name: string) => void;
  text: (text: string) => void;
}

function findTagEnd(xml: string, from: number): number {
  let quote: number = -1;

  for (let index: number = from; index < xml.length; index++) {
    const code: number = xml.charCodeAt(index);

    if (quote >= 0) {
      if (code === quote) {
        quote = -1;
      }

      continue;
    }

    if (code === 34 || code === 39) {
      quote = code;
    } else if (code === 62) {
      return index;
    }
  }

  return -1;
}

function nameOf(tag: string, from: number): string {
  let end: number = from;

  while (end < tag.length) {
    const code: number = tag.charCodeAt(end);

    if (
      code === 32 ||
      code === 9 ||
      code === 10 ||
      code === 13 ||
      code === 47 ||
      code === 62
    ) {
      break;
    }

    end++;
  }

  return tag.slice(from, end);
}

export function walkXml(xml: string, visitor: XmlVisitor): void {
  let index: number = 0;

  while (index < xml.length) {
    const open: number = xml.indexOf("<", index);

    if (open < 0) {
      visitor.text(decodeXmlEntities(xml.slice(index)));
      return;
    }

    if (open > index) {
      visitor.text(decodeXmlEntities(xml.slice(index, open)));
    }

    if (xml.startsWith("<!--", open)) {
      const end: number = xml.indexOf("-->", open + 4);

      if (end < 0) {
        return;
      }

      index = end + 3;
      continue;
    }

    if (xml.startsWith("<![CDATA[", open)) {
      const end: number = xml.indexOf("]]>", open + 9);

      if (end < 0) {
        return;
      }

      visitor.text(xml.slice(open + 9, end));
      index = end + 3;
      continue;
    }

    if (xml.startsWith("<?", open) || xml.startsWith("<!", open)) {
      const end: number = xml.indexOf(">", open + 2);

      if (end < 0) {
        return;
      }

      index = end + 1;
      continue;
    }

    const end: number = findTagEnd(xml, open + 1);

    if (end < 0) {
      return;
    }

    const tag: string = xml.slice(open, end + 1);

    if (tag.charCodeAt(1) === 47) {
      visitor.close(nameOf(tag, 2));
    } else {
      const name: string = nameOf(tag, 1);

      visitor.open(name, tag);

      if (tag.charCodeAt(tag.length - 2) === 47) {
        visitor.close(name);
      }
    }

    index = end + 1;
  }
}

// One attribute of a tag as written, decoded, or undefined.
export function getXmlAttribute(tag: string, name: string): string | undefined {
  let from: number = 0;

  for (;;) {
    const at: number = tag.indexOf(name, from);

    if (at < 0) {
      return undefined;
    }

    const before: number = tag.charCodeAt(at - 1);
    let after: number = at + name.length;

    while (tag.charCodeAt(after) === 32) {
      after++;
    }

    const isAttribute: boolean =
      (before === 32 || before === 9 || before === 10 || before === 13) &&
      tag.charCodeAt(after) === 61;

    if (isAttribute) {
      let valueStart: number = after + 1;

      while (tag.charCodeAt(valueStart) === 32) {
        valueStart++;
      }

      const quote: string = tag[valueStart] || "";

      if (quote === '"' || quote === "'") {
        const valueEnd: number = tag.indexOf(quote, valueStart + 1);

        if (valueEnd > valueStart) {
          return decodeXmlEntities(tag.slice(valueStart + 1, valueEnd));
        }
      }

      return undefined;
    }

    from = at + name.length;
  }
}

/*
 * The text of WordprocessingML or DrawingML: paragraphs end lines, tabs
 * and breaks keep their places, and the runs of a paragraph join up again
 * (Word splits a word into runs for no reason a reader can see).
 */
function officeXmlToText(
  xml: string,
  names: { paragraph: string; tab: string; breaks: ReadonlyArray<string> },
): string {
  const pieces: Array<string> = [];
  let length: number = 0;

  const add: (piece: string) => void = (piece: string): void => {
    if (length < MAX_SCANNED_TEXT_LENGTH) {
      pieces.push(piece);
      length += piece.length;
    }
  };

  walkXml(xml, {
    open: (name: string): void => {
      if (name === names.tab) {
        add("\t");
      } else if (names.breaks.includes(name)) {
        add("\n");
      }
    },
    close: (name: string): void => {
      if (name === names.paragraph) {
        add("\n");
      }
    },
    text: (text: string): void => {
      // Indentation between elements is not the document's text.
      if (text.trim().length > 0) {
        add(text);
      }
    },
  });

  return pieces.join("");
}

function readParts(data: {
  zip: ZipReader;
  parts: Array<ZipEntry>;
  toText: (xml: string) => string;
}): OfficeText {
  const texts: Array<string> = [];
  const warnings: Array<string> = [];
  let isPartial: boolean = data.zip.isTruncated;
  let length: number = 0;

  for (const part of data.parts) {
    if (length >= MAX_SCANNED_TEXT_LENGTH) {
      isPartial = true;
      break;
    }

    try {
      const read: { text: string; isPartial: boolean } | null =
        data.zip.readText(part.name);

      if (!read) {
        continue;
      }

      const text: string = data.toText(read.text);

      texts.push(text);
      length += text.length;
      isPartial = isPartial || read.isPartial;
    } catch (error) {
      if (error instanceof ZipError && error.isZipBomb) {
        throw error;
      }

      warnings.push(
        `${part.name} could not be read: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return { text: texts.join("\n"), warnings, isPartial };
}

function byNumber(pattern: RegExp): (a: ZipEntry, b: ZipEntry) => number {
  return (a: ZipEntry, b: ZipEntry): number => {
    const first: number = Number(pattern.exec(a.name)?.[1] || 0);
    const second: number = Number(pattern.exec(b.name)?.[1] || 0);

    return first - second;
  };
}

export function readWordDocument(zip: ZipReader): OfficeText {
  const parts: Array<ZipEntry> = zip.entries.filter((entry: ZipEntry) => {
    return WORD_TEXT_PART.test(entry.name);
  });

  // The body first, then what surrounds it.
  parts.sort((a: ZipEntry, b: ZipEntry) => {
    return (
      Number(b.name === "word/document.xml") -
      Number(a.name === "word/document.xml")
    );
  });

  return readParts({
    zip,
    parts,
    toText: (xml: string): string => {
      return officeXmlToText(xml, {
        paragraph: "w:p",
        tab: "w:tab",
        breaks: ["w:br", "w:cr"],
      });
    },
  });
}

export function readPresentation(zip: ZipReader): OfficeText {
  const slides: Array<ZipEntry> = zip.entries
    .filter((entry: ZipEntry) => {
      return SLIDE_PART.test(entry.name);
    })
    .sort(byNumber(SLIDE_PART));
  const notes: Array<ZipEntry> = zip.entries
    .filter((entry: ZipEntry) => {
      return NOTES_PART.test(entry.name);
    })
    .sort(byNumber(NOTES_PART));

  return readParts({
    zip,
    parts: [...slides, ...notes],
    toText: (xml: string): string => {
      return officeXmlToText(xml, {
        paragraph: "a:p",
        tab: "a:tab",
        breaks: ["a:br"],
      });
    },
  });
}

/*
 * A workbook's shared strings: each <si>, its runs joined, phonetic
 * guides (<rPh>) left out.
 */
export function parseSharedStrings(xml: string): Array<string> {
  const strings: Array<string> = [];
  let current: Array<string> | null = null;
  let inText: boolean = false;
  let phoneticDepth: number = 0;

  walkXml(xml, {
    open: (name: string): void => {
      if (name === "si") {
        current = [];
      } else if (name === "rPh") {
        phoneticDepth++;
      } else if (name === "t") {
        inText = true;
      }
    },
    close: (name: string): void => {
      if (name === "si" && current) {
        if (strings.length < MAX_SHARED_STRINGS) {
          strings.push(current.join("").slice(0, MAX_FIELD_VALUE_LENGTH));
        }

        current = null;
      } else if (name === "rPh") {
        phoneticDepth = Math.max(0, phoneticDepth - 1);
      } else if (name === "t") {
        inText = false;
      }
    },
    text: (text: string): void => {
      if (current && inText && phoneticDepth === 0) {
        (current as Array<string>).push(text);
      }
    },
  });

  return strings;
}

export interface SheetRows {
  // Each row's cells by column letter, for the rows collected.
  rows: Array<Map<string, string>>;
  // Every row the sheet holds, collected or not.
  totalRows: number;
}

function columnNumber(letters: string): number {
  let number: number = 0;

  for (let index: number = 0; index < letters.length; index++) {
    number = number * 26 + (letters.charCodeAt(index) - 64);
  }

  return number;
}

function columnLetters(number: number): string {
  let letters: string = "";
  let rest: number = number;

  while (rest > 0) {
    const remainder: number = (rest - 1) % 26;

    letters = String.fromCharCode(65 + remainder) + letters;
    rest = Math.floor((rest - 1) / 26);
  }

  return letters;
}

/*
 * A sheet's rows: each cell's text by its column, shared strings looked
 * up, inline strings read, formulas' cached values kept and the formulas
 * themselves left out.
 */
export function parseSheet(
  xml: string,
  sharedStrings: ReadonlyArray<string>,
): SheetRows {
  const rows: Array<Map<string, string>> = [];
  let totalRows: number = 0;
  let declaredLastRow: number = 0;
  let row: Map<string, string> | null = null;
  let column: string = "";
  let previousColumn: number = 0;
  let type: string = "";
  let value: Array<string> = [];
  let capture: boolean = false;
  let inInlineString: boolean = false;

  walkXml(xml, {
    open: (name: string, tag: string): void => {
      switch (name) {
        case "dimension": {
          const range: string = getXmlAttribute(tag, "ref") || "";
          const lastRow: RegExpExecArray | null =
            DIMENSION_LAST_ROW.exec(range);

          declaredLastRow = lastRow ? Number(lastRow[1]) : 0;
          break;
        }
        case "row":
          totalRows++;
          row = rows.length < MAX_SHEET_ROWS_COLLECTED ? new Map() : null;
          previousColumn = 0;
          break;
        case "c": {
          const reference: string = getXmlAttribute(tag, "r") || "";
          const letters: string = CELL_COLUMN.exec(reference)?.[0] || "";

          previousColumn = letters ? columnNumber(letters) : previousColumn + 1;
          column = letters || columnLetters(previousColumn);
          type = getXmlAttribute(tag, "t") || "";
          value = [];
          break;
        }
        case "v":
          capture = !inInlineString;
          break;
        case "is":
          inInlineString = true;
          break;
        case "t":
          capture = inInlineString;
          break;
        default:
          break;
      }
    },
    close: (name: string): void => {
      switch (name) {
        case "v":
        case "t":
          capture = false;
          break;
        case "is":
          inInlineString = false;
          break;
        case "c": {
          if (row) {
            const raw: string = value.join("");
            let text: string = raw;

            if (type === "s") {
              text = sharedStrings[Number(raw)] ?? "";
            } else if (type === "b") {
              text = raw === "1" ? "TRUE" : "FALSE";
            }

            if (text.length > 0) {
              (row as Map<string, string>).set(
                column,
                text.slice(0, MAX_FIELD_VALUE_LENGTH),
              );
            }
          }

          break;
        }
        case "row":
          if (row) {
            rows.push(row);
          }

          row = null;
          break;
        default:
          break;
      }
    },
    text: (text: string): void => {
      if (capture) {
        value.push(text);
      }
    },
  });

  return { rows, totalRows: Math.max(totalRows, declaredLastRow) };
}

/*
 * The workbook's sheets in order, by name: workbook.xml names them and its
 * relationships say which part holds each; the parts themselves, in
 * number order, when either is missing.
 */
function listSheets(zip: ZipReader): Array<{ name: string; part: string }> {
  const sheets: Array<{ name: string; part: string }> = [];

  try {
    const workbook: { text: string } | null = zip.readText("xl/workbook.xml");
    const relationships: { text: string } | null = zip.readText(
      "xl/_rels/workbook.xml.rels",
    );

    if (workbook && relationships) {
      const targets: Map<string, string> = new Map();

      walkXml(relationships.text, {
        open: (name: string, tag: string): void => {
          if (name === "Relationship") {
            const id: string | undefined = getXmlAttribute(tag, "Id");
            const target: string | undefined = getXmlAttribute(tag, "Target");

            if (id && target) {
              targets.set(
                id,
                target.startsWith("/")
                  ? target.slice(1)
                  : `xl/${target.replace(LEADING_DOT_SLASH, "")}`,
              );
            }
          }
        },
        close: (): void => {},
        text: (): void => {},
      });

      walkXml(workbook.text, {
        open: (name: string, tag: string): void => {
          if (name === "sheet") {
            const sheetName: string = getXmlAttribute(tag, "name") || "";
            const id: string | undefined = getXmlAttribute(tag, "r:id");
            const part: string | undefined = id ? targets.get(id) : undefined;

            if (sheetName && part) {
              sheets.push({ name: sheetName, part });
            }
          }
        },
        close: (): void => {},
        text: (): void => {},
      });
    }
  } catch {
    // Read the parts by number instead.
  }

  if (sheets.length > 0) {
    return sheets;
  }

  return zip.entries
    .filter((entry: ZipEntry) => {
      return SHEET_PART.test(entry.name);
    })
    .sort(byNumber(SHEET_PART))
    .map((entry: ZipEntry) => {
      return {
        name: `Sheet${SHEET_PART.exec(entry.name)?.[1] || ""}`,
        part: entry.name,
      };
    });
}

const LEADING_DOT_SLASH: RegExp = /^\.\//;

export function readWorkbook(
  zip: ZipReader,
  isSensitive: (text: string) => boolean,
): OfficeTable {
  const collector: FieldCollector = new FieldCollector({
    maxValueLength: MAX_FIELD_VALUE_LENGTH,
  });
  const warnings: Array<string> = [];
  let isPartial: boolean = zip.isTruncated;
  let records: number = 0;
  let sharedStrings: Array<string> = [];

  try {
    const shared: { text: string; isPartial: boolean } | null = zip.readText(
      "xl/sharedStrings.xml",
    );

    if (shared) {
      sharedStrings = parseSharedStrings(shared.text);
      isPartial = isPartial || shared.isPartial;
    }
  } catch (error) {
    if (error instanceof ZipError && error.isZipBomb) {
      throw error;
    }

    warnings.push("The workbook's shared strings could not be read.");
  }

  const sheets: Array<{ name: string; part: string }> = listSheets(zip);

  if (sheets.length > MAX_SHEETS) {
    warnings.push(
      `Only the first ${MAX_SHEETS} of the workbook's ${sheets.length} sheets were read.`,
    );
    isPartial = true;
  }

  for (const sheet of sheets.slice(0, MAX_SHEETS)) {
    let xml: { text: string; isPartial: boolean } | null;

    try {
      xml = zip.readText(sheet.part);
    } catch (error) {
      if (error instanceof ZipError && error.isZipBomb) {
        throw error;
      }

      warnings.push(`The sheet ${sheet.name} could not be read.`);
      continue;
    }

    if (!xml) {
      continue;
    }

    isPartial = isPartial || xml.isPartial;

    const parsed: SheetRows = parseSheet(xml.text, sharedStrings);

    if (parsed.rows.length === 0) {
      continue;
    }

    const first: Map<string, string> = parsed.rows[0]!;
    const firstColumns: Array<string> = [...first.keys()];
    const hasHeader: boolean =
      parsed.rows.length > 1 &&
      looksLikeHeaderRow(
        firstColumns.map((letters: string) => {
          return first.get(letters) || "";
        }),
        isSensitive,
      );
    const headers: Map<string, string> = hasHeader ? first : new Map();

    for (
      let index: number = hasHeader ? 1 : 0;
      index < parsed.rows.length;
      index++
    ) {
      for (const [letters, text] of parsed.rows[index]!) {
        const header: string = (headers.get(letters) || letters)
          .trim()
          .slice(0, 256);

        collector.addValue(`${sheet.name}.${header}`, text);
      }
    }

    records += Math.max(0, parsed.totalRows - (hasHeader ? 1 : 0));
  }

  return { collector, records, warnings, isPartial };
}
