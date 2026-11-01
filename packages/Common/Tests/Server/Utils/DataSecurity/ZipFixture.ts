import zlib from "zlib";

/*
 * ZIP ARCHIVES WRITTEN FOR THE TESTS, AS SMALL AS THE FORMAT ALLOWS.
 *
 * Local headers, the central directory and its end record - stored or
 * deflated entries, sizes in the local header or in a data descriptor - and
 * the ways an archive can lie: a declared size smaller than the data, a
 * central directory that points two entries at one local header, more
 * entries than are there. DOCX, XLSX and PPTX documents are built from
 * these, with the parts each format needs.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

export interface ZipFixtureEntry {
  name: string;
  data: Buffer | string;
  method?: "store" | "deflate" | undefined;
  // Write the sizes in a data descriptor after the data, not the header.
  dataDescriptor?: boolean | undefined;
  // What the headers say the entry inflates to, when it should lie.
  declaredUncompressedSize?: number | undefined;
  flags?: number | undefined;
  methodNumber?: number | undefined;
}

export interface ZipFixtureOptions {
  // Leave the central directory and its end out: an archive cut short.
  omitCentralDirectory?: boolean | undefined;
  // Point every central directory entry at the first local header.
  shareFirstLocalHeader?: boolean | undefined;
  // What the end record says the entry count is.
  declaredEntryCount?: number | undefined;
}

function crc32(data: Buffer): number {
  const withCrc: { crc32?: (data: Buffer) => number } = zlib as unknown as {
    crc32?: (data: Buffer) => number;
  };

  return withCrc.crc32 ? withCrc.crc32(data) >>> 0 : 0;
}

export function buildZip(
  entries: Array<ZipFixtureEntry>,
  options: ZipFixtureOptions = {},
): Buffer {
  const locals: Array<Buffer> = [];
  const centrals: Array<Buffer> = [];
  let offset: number = 0;
  const offsets: Array<number> = [];

  for (const entry of entries) {
    const raw: Buffer = Buffer.isBuffer(entry.data)
      ? entry.data
      : Buffer.from(entry.data, "utf8");
    const isDeflated: boolean = (entry.method || "deflate") === "deflate";
    const compressed: Buffer = isDeflated ? zlib.deflateRawSync(raw) : raw;
    const method: number = entry.methodNumber ?? (isDeflated ? 8 : 0);
    const name: Buffer = Buffer.from(entry.name, "utf8");
    const flags: number =
      (entry.flags || 0) | (entry.dataDescriptor ? 0x8 : 0) | 0x800;
    const crc: number = crc32(raw);
    const uncompressedSize: number =
      entry.declaredUncompressedSize ?? raw.length;

    const local: Buffer = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(entry.dataDescriptor ? 0 : crc, 14);
    local.writeUInt32LE(entry.dataDescriptor ? 0 : compressed.length, 18);
    local.writeUInt32LE(entry.dataDescriptor ? 0 : uncompressedSize, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const parts: Array<Buffer> = [local, name, compressed];

    if (entry.dataDescriptor) {
      const descriptor: Buffer = Buffer.alloc(16);
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(crc, 4);
      descriptor.writeUInt32LE(compressed.length, 8);
      descriptor.writeUInt32LE(uncompressedSize, 12);
      parts.push(descriptor);
    }

    const localRecord: Buffer = Buffer.concat(parts);

    offsets.push(offset);
    locals.push(localRecord);

    const central: Buffer = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(uncompressedSize, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(options.shareFirstLocalHeader ? 0 : offset, 42);
    centrals.push(Buffer.concat([central, name]));

    offset += localRecord.length;
  }

  if (options.omitCentralDirectory) {
    return Buffer.concat(locals);
  }

  const directory: Buffer = Buffer.concat(centrals);
  const end: Buffer = Buffer.alloc(22);
  const count: number = options.declaredEntryCount ?? entries.length;

  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Math.min(count, 0xfffe), 8);
  end.writeUInt16LE(Math.min(count, 0xfffe), 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, directory, end]);
}

function escapeXml(text: string): string {
  return text
    .split("&")
    .join("&amp;")
    .split("<")
    .join("&lt;")
    .split(">")
    .join("&gt;");
}

const CONTENT_TYPES: string =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>';

/*
 * A Word document of the given paragraphs, each paragraph's text split
 * into runs of a few characters, the way Word writes them.
 */
export function buildDocx(
  paragraphs: Array<string>,
  options: ZipFixtureOptions = {},
): Buffer {
  const body: string = paragraphs
    .map((paragraph: string) => {
      const runs: Array<string> = [];

      for (let index: number = 0; index < paragraph.length; index += 5) {
        runs.push(
          `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${escapeXml(
            paragraph.slice(index, index + 5),
          )}</w:t></w:r>`,
        );
      }

      return `<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>${runs.join("")}</w:p>`;
    })
    .join("");

  return buildZip(
    [
      { name: "[Content_Types].xml", data: CONTENT_TYPES },
      {
        name: "word/document.xml",
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
      },
    ],
    options,
  );
}

/*
 * A workbook of one sheet named `sheetName`: its first row the headers,
 * strings kept in the shared strings, numbers inline.
 */
export function buildXlsx(
  sheetName: string,
  rows: Array<Array<string | number>>,
): Buffer {
  const shared: Array<string> = [];
  const sharedIndex: Map<string, number> = new Map();

  const indexOf: (text: string) => number = (text: string): number => {
    let index: number | undefined = sharedIndex.get(text);

    if (index === undefined) {
      index = shared.length;
      shared.push(text);
      sharedIndex.set(text, index);
    }

    return index;
  };

  const sheetRows: string = rows
    .map((row: Array<string | number>, rowIndex: number) => {
      const cells: string = row
        .map((cell: string | number, columnIndex: number) => {
          const reference: string = `${String.fromCharCode(65 + columnIndex)}${rowIndex + 1}`;

          return typeof cell === "number"
            ? `<c r="${reference}"><v>${cell}</v></c>`
            : `<c r="${reference}" t="s"><v>${indexOf(cell)}</v></c>`;
        })
        .join("");

      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");

  const lastColumn: string = String.fromCharCode(
    64 +
      Math.max(
        1,
        ...rows.map((row: Array<string | number>) => {
          return row.length;
        }),
      ),
  );

  return buildZip([
    { name: "[Content_Types].xml", data: CONTENT_TYPES },
    {
      name: "xl/workbook.xml",
      data: `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    },
    {
      name: "xl/sharedStrings.xml",
      data: `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared
        .map((text: string) => {
          return `<si><t>${escapeXml(text)}</t></si>`;
        })
        .join("")}</sst>`,
    },
    {
      name: "xl/worksheets/sheet1.xml",
      data: `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastColumn}${rows.length}"/><sheetData>${sheetRows}</sheetData></worksheet>`,
    },
  ]);
}

// A presentation of one slide per text.
export function buildPptx(slides: Array<string>): Buffer {
  return buildZip([
    { name: "[Content_Types].xml", data: CONTENT_TYPES },
    { name: "ppt/presentation.xml", data: "<p:presentation/>" },
    ...slides.map((text: string, index: number) => {
      return {
        name: `ppt/slides/slide${index + 1}.xml`,
        data: `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${escapeXml(text)}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
      };
    }),
  ]);
}
