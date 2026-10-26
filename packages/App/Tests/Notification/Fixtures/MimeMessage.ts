/*
 * A MIME message read the way a mail client reads it: each entity's headers,
 * its type, its parts when it is multipart, and its body decoded from
 * base64 or quoted-printable. Just enough of RFC 2045/2046 to read what
 * nodemailer writes, so a test can follow an image from the HTML's "cid:" to
 * the part whose Content-ID it names, and compare the part's bytes with the
 * image's.
 *
 * Every step reads the text with indexOf, split and a character loop, in time
 * linear in its length.
 */

export interface MimeEntity {
  // Each header by its lowercase name, unfolded; the first of each name.
  headers: Map<string, string>;
  // The Content-Type's type/subtype, lowercase ("text/plain" when absent).
  type: string;
  // The Content-Type's parameters, by lowercase name, unquoted.
  parameters: Map<string, string>;
  // The parts of a multipart entity, in order; none for any other.
  parts: Array<MimeEntity>;
  // The body of an entity that is not multipart, decoded.
  body: Buffer;
}

const isFoldedLine: (line: string) => boolean = (line: string): boolean => {
  return line.startsWith(" ") || line.startsWith("\t");
};

// "type/subtype; name=value; name="quoted; value"" as its type and parameters.
const readHeaderValue: (value: string) => {
  type: string;
  parameters: Map<string, string>;
} = (value: string): { type: string; parameters: Map<string, string> } => {
  const pieces: Array<string> = [];
  let piece: string = "";
  let isQuoted: boolean = false;

  for (const character of value) {
    if (character === '"') {
      isQuoted = !isQuoted;
      piece += character;
    } else if (character === ";" && !isQuoted) {
      pieces.push(piece);
      piece = "";
    } else {
      piece += character;
    }
  }

  pieces.push(piece);

  const parameters: Map<string, string> = new Map<string, string>();

  for (const parameter of pieces.slice(1)) {
    const equals: number = parameter.indexOf("=");

    if (equals <= 0) {
      continue;
    }

    let parameterValue: string = parameter.slice(equals + 1).trim();

    if (
      parameterValue.length >= 2 &&
      parameterValue.startsWith('"') &&
      parameterValue.endsWith('"')
    ) {
      parameterValue = parameterValue.slice(1, -1);
    }

    parameters.set(
      parameter.slice(0, equals).trim().toLowerCase(),
      parameterValue,
    );
  }

  return {
    type: (pieces[0] || "").trim().toLowerCase() || "text/plain",
    parameters: parameters,
  };
};

const HEX_DIGITS: string = "0123456789ABCDEFabcdef";

const isHexDigit: (character: string | undefined) => boolean = (
  character: string | undefined,
): boolean => {
  return (
    character !== undefined &&
    character.length === 1 &&
    HEX_DIGITS.indexOf(character) !== -1
  );
};

// Quoted-printable (RFC 2045 section 6.7): "=XX" bytes and "=" soft breaks.
export const decodeQuotedPrintable: (encoded: string) => Buffer = (
  encoded: string,
): Buffer => {
  const joined: string = encoded.split("=\n").join("");
  const bytes: Array<number> = [];

  for (let index: number = 0; index < joined.length; index++) {
    const character: string = joined[index]!;

    if (
      character === "=" &&
      isHexDigit(joined[index + 1]) &&
      isHexDigit(joined[index + 2])
    ) {
      bytes.push(parseInt(joined.slice(index + 1, index + 3), 16));
      index += 2;
      continue;
    }

    for (const byte of Buffer.from(character, "utf8")) {
      bytes.push(byte);
    }
  }

  return Buffer.from(bytes);
};

const decodeBody: (body: string, encoding: string) => Buffer = (
  body: string,
  encoding: string,
): Buffer => {
  if (encoding === "base64") {
    return Buffer.from(body.split("\n").join("").split(" ").join(""), "base64");
  }

  if (encoding === "quoted-printable") {
    return decodeQuotedPrintable(body);
  }

  return Buffer.from(body, "utf8");
};

/*
 * The parts of a multipart body: what lies between its "--boundary" lines,
 * up to "--boundary--". The line break before a delimiter belongs to the
 * delimiter (RFC 2046 section 5.1.1), so a part keeps no trailing one.
 */
const splitParts: (body: string, boundary: string) => Array<string> = (
  body: string,
  boundary: string,
): Array<string> => {
  const delimiter: string = `--${boundary}`;
  const closing: string = `--${boundary}--`;
  const parts: Array<string> = [];
  let current: Array<string> | null = null;

  for (const line of body.split("\n")) {
    if (line === closing) {
      if (current) {
        parts.push(current.join("\n"));
      }

      return parts;
    }

    if (line === delimiter) {
      if (current) {
        parts.push(current.join("\n"));
      }

      current = [];
      continue;
    }

    if (current) {
      current.push(line);
    }
  }

  if (current) {
    parts.push(current.join("\n"));
  }

  return parts;
};

// `raw`, a whole message or one of its parts, as a MIME entity.
export const readMimeEntity: (raw: string) => MimeEntity = (
  raw: string,
): MimeEntity => {
  const text: string = raw.split("\r\n").join("\n");
  const headerEnd: number = text.indexOf("\n\n");
  const headerText: string = headerEnd === -1 ? text : text.slice(0, headerEnd);
  const bodyText: string = headerEnd === -1 ? "" : text.slice(headerEnd + 2);

  const lines: Array<string> = [];

  for (const line of headerText.split("\n")) {
    if (isFoldedLine(line) && lines.length > 0) {
      lines[lines.length - 1] = `${lines[lines.length - 1]} ${line.trim()}`;
    } else {
      lines.push(line);
    }
  }

  const headers: Map<string, string> = new Map<string, string>();

  for (const line of lines) {
    const colon: number = line.indexOf(":");

    if (colon <= 0) {
      continue;
    }

    const name: string = line.slice(0, colon).trim().toLowerCase();

    if (!headers.has(name)) {
      headers.set(name, line.slice(colon + 1).trim());
    }
  }

  const contentType: { type: string; parameters: Map<string, string> } =
    readHeaderValue(headers.get("content-type") || "text/plain");

  const boundary: string | undefined = contentType.parameters.get("boundary");

  if (contentType.type.startsWith("multipart/") && boundary) {
    return {
      headers: headers,
      type: contentType.type,
      parameters: contentType.parameters,
      parts: splitParts(bodyText, boundary).map(readMimeEntity),
      body: Buffer.alloc(0),
    };
  }

  return {
    headers: headers,
    type: contentType.type,
    parameters: contentType.parameters,
    parts: [],
    body: decodeBody(
      bodyText,
      (headers.get("content-transfer-encoding") || "").trim().toLowerCase(),
    ),
  };
};

// Every entity in `entity`, itself first, then each part's, depth first.
export const allMimeEntities: (entity: MimeEntity) => Array<MimeEntity> = (
  entity: MimeEntity,
): Array<MimeEntity> => {
  return [entity, ...entity.parts.flatMap(allMimeEntities)];
};

// The entities of `entity` of the type `type` ("image/png").
export const mimeEntitiesOfType: (
  entity: MimeEntity,
  type: string,
) => Array<MimeEntity> = (
  entity: MimeEntity,
  type: string,
): Array<MimeEntity> => {
  return allMimeEntities(entity).filter((part: MimeEntity): boolean => {
    return part.type === type;
  });
};

// A Content-ID header's id, without its angle brackets.
export const contentIdOf: (entity: MimeEntity) => string | undefined = (
  entity: MimeEntity,
): string | undefined => {
  const header: string | undefined = entity.headers.get("content-id");

  if (header === undefined) {
    return undefined;
  }

  const value: string = header.trim();

  return value.startsWith("<") && value.endsWith(">")
    ? value.slice(1, -1)
    : value;
};
