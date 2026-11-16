import { JSONObject } from "../../Types/JSON";
import SyslogAttribute, {
  SYSLOG_STRUCTURED_ATTRIBUTE_PREFIX,
} from "../../Types/Syslog/SyslogAttribute";
import {
  ParsedSyslogMessage,
  SyslogLineLayout,
  SyslogStructuredDataParam,
  SyslogTextSpan,
  escapeSyslogStructuredDataValue,
  parseSyslogMessage,
  readSyslogStructuredData,
  syslogStructuredDataAttributeKey,
} from "./SyslogMessageParser";

/*
 * THE RAW COPIES OF A SYSLOG LINE HOLD WHAT THE SCRUB RULES LEFT OF ITS
 * PARTS (#9039).
 *
 * A syslog log keeps each part of its line on its own: the header's host,
 * app, process id and message id as attributes, each RFC 5424
 * structured-data parameter as syslog.structured.<SD-ID>.<name>, and the
 * message as the body. Beside them it keeps copies of the text they were
 * read from: the whole line as syslog.raw (syslog posted over HTTP), and
 * the structured data as syslog.structured.raw (that, and the syslog a
 * probe forwards).
 *
 * A scrub rule reads each part as what it is. A Sensitive Attribute Keys
 * rule hides syslog.structured.auth_1.password, whose key names a secret,
 * and the values under secret keys of a message that is JSON; a pattern
 * rule reads such a message with its escapes read, so "\n4111 1111 1111
 * 1111" holds a card number after a line break (#8923); a Body Only rule
 * reads the message alone. The rules read the raw copies only as the text
 * they are, and kept every one of those secrets in them.
 *
 * So, after the rules have run, each raw copy is put together again from
 * the text it arrived as, each part replaced by what the rules left of it -
 * a parameter's value written with RFC 5424's escapes - and the copy is then
 * read by the rules as any attribute is: a pattern rule still finds what
 * spans two parts, or sits between them. A part's value the record does
 * not keep - a parameter written twice keeps only one of its values - is
 * what the rules leave of it read where it would be kept.
 *
 * A copy none of whose parts the rules changed is left as the rules left
 * it, which for a line with nothing to hide is the line as it arrived,
 * byte for byte. A line whose parts cannot be found where its reading
 * says - which a reading never does - keeps no syslog.raw once the rules
 * changed any part of it, rather than one that may keep what they hid.
 */

// Runs a project's log scrub rules over a log row, and returns the row.
export type ScrubLogRow = (logRow: JSONObject) => JSONObject;

// A part of a raw copy that the record also keeps on its own.
interface RawCopyPart {
  // Where it sits in the copy, as written.
  span: SyslogTextSpan;
  // What it holds: a parameter's value with its escapes read.
  value: string;
  // The attribute that keeps it, or null for the message, which the body keeps.
  attribute: string | null;
  // A parameter's value, written back with RFC 5424's escapes.
  isStructuredDataValue: boolean;
}

interface RawCopy {
  attribute: string;
  text: string;
  // Null when the copy could not be read into its parts.
  parts: Array<RawCopyPart> | null;
}

// What each part's keeper held, before the rules ran.
interface KeptValues {
  body: unknown;
  attributes: Map<string, unknown>;
}

// The header fields a line holds, and the attribute that keeps each.
const HEADER_FIELDS: ReadonlyArray<
  [keyof Omit<SyslogLineLayout, "message" | "structuredData">, string]
> = [
  ["hostname", SyslogAttribute.Hostname],
  ["appName", SyslogAttribute.AppName],
  ["procId", SyslogAttribute.ProcessId],
  ["msgId", SyslogAttribute.MessageId],
];

export default class SyslogRawCopies {
  /*
   * Runs `scrub` - a project's log scrub rules - over a syslog log row, and
   * puts its raw copies together again from what the rules left of their
   * parts. `line` is the reading of the line syslog.raw holds, when the
   * caller has it; without it the line is read again.
   */
  public static scrubLog(data: {
    logRow: JSONObject;
    line?: ParsedSyslogMessage | null | undefined;
    scrub: ScrubLogRow;
  }): JSONObject {
    const copies: Array<RawCopy> = SyslogRawCopies.readCopies(
      data.logRow,
      data.line,
    );

    if (copies.length === 0) {
      return data.scrub(data.logRow);
    }

    // Before the rules run: they change the row where it is.
    const before: KeptValues = SyslogRawCopies.keptValues(data.logRow, copies);

    const scrubbed: JSONObject = data.scrub(data.logRow);

    SyslogRawCopies.rebuild(scrubbed, copies, before, data.scrub);

    return scrubbed;
  }

  // The raw copies a row holds, each read into its parts.
  private static readCopies(
    logRow: JSONObject,
    line: ParsedSyslogMessage | null | undefined,
  ): Array<RawCopy> {
    const attributes: JSONObject | null = SyslogRawCopies.attributesOf(logRow);

    if (!attributes) {
      return [];
    }

    const copies: Array<RawCopy> = [];
    const structuredData: unknown = attributes[SyslogAttribute.StructuredRaw];

    if (typeof structuredData === "string" && structuredData) {
      copies.push({
        attribute: SyslogAttribute.StructuredRaw,
        text: structuredData,
        parts: SyslogRawCopies.structuredDataParts(structuredData, 0),
      });
    }

    const raw: unknown = attributes[SyslogAttribute.Raw];

    if (typeof raw === "string" && raw) {
      const reading: ParsedSyslogMessage | null =
        line && line.raw === raw ? line : parseSyslogMessage(raw);

      copies.push({
        attribute: SyslogAttribute.Raw,
        text: raw,
        parts: reading ? SyslogRawCopies.lineParts(raw, reading) : null,
      });
    }

    return copies;
  }

  // Each parameter's value in structured data that starts at `offset`.
  private static structuredDataParts(
    structuredData: string,
    offset: number,
  ): Array<RawCopyPart> {
    return readSyslogStructuredData(structuredData).params.map(
      (param: SyslogStructuredDataParam): RawCopyPart => {
        return {
          span: {
            start: offset + param.valueSpan.start,
            end: offset + param.valueSpan.end,
          },
          value: param.value,
          attribute: syslogStructuredDataAttributeKey(param.sdId, param.name),
          isStructuredDataValue: true,
        };
      },
    );
  }

  // The header's fields, the structured data's values and the message.
  private static lineParts(
    raw: string,
    line: ParsedSyslogMessage,
  ): Array<RawCopyPart> | null {
    const layout: SyslogLineLayout | undefined = line.layout;

    if (!layout) {
      return null;
    }

    const parts: Array<RawCopyPart> = [];

    for (const [field, attribute] of HEADER_FIELDS) {
      const span: SyslogTextSpan | undefined = layout[field];

      if (span) {
        parts.push({
          span: span,
          value: raw.slice(span.start, span.end),
          attribute: attribute,
          isStructuredDataValue: false,
        });
      }
    }

    if (layout.structuredData) {
      parts.push(
        ...SyslogRawCopies.structuredDataParts(
          raw.slice(layout.structuredData.start, layout.structuredData.end),
          layout.structuredData.start,
        ),
      );
    }

    parts.push({
      span: layout.message,
      value: raw.slice(layout.message.start, layout.message.end),
      attribute: null,
      isStructuredDataValue: false,
    });

    return parts;
  }

  private static keptValues(
    logRow: JSONObject,
    copies: Array<RawCopy>,
  ): KeptValues {
    const attributes: JSONObject = SyslogRawCopies.attributesOf(logRow) || {};
    const kept: Map<string, unknown> = new Map<string, unknown>();

    for (const key of SyslogRawCopies.keepers(attributes, copies)) {
      kept.set(key, attributes[key]);
    }

    return { body: logRow["body"], attributes: kept };
  }

  /*
   * The attributes whose values the rules may change in a copy's parts: the
   * parts' own, and - for a copy that could not be read into its parts -
   * every part a syslog line can have.
   */
  private static keepers(
    attributes: JSONObject,
    copies: Array<RawCopy>,
  ): Set<string> {
    const keys: Set<string> = new Set<string>();

    for (const copy of copies) {
      if (copy.parts) {
        for (const part of copy.parts) {
          if (part.attribute !== null) {
            keys.add(part.attribute);
          }
        }

        continue;
      }

      for (const [, attribute] of HEADER_FIELDS) {
        keys.add(attribute);
      }

      for (const key of Object.keys(attributes)) {
        if (
          key.startsWith(SYSLOG_STRUCTURED_ATTRIBUTE_PREFIX) &&
          key !== SyslogAttribute.StructuredRaw
        ) {
          keys.add(key);
        }
      }
    }

    return keys;
  }

  private static rebuild(
    scrubbed: JSONObject,
    copies: Array<RawCopy>,
    before: KeptValues,
    scrub: ScrubLogRow,
  ): void {
    const attributes: JSONObject | null =
      SyslogRawCopies.attributesOf(scrubbed);

    if (!attributes) {
      return;
    }

    // What the rules leave of a value the record does not keep, once each.
    const unkept: Map<string, string> = new Map<string, string>();
    const rebuilt: JSONObject = {};

    for (const copy of copies) {
      if (!copy.parts) {
        if (SyslogRawCopies.anyKeptValueChanged(scrubbed, before)) {
          delete attributes[copy.attribute];
        }

        continue;
      }

      const replacements: Array<{ span: SyslogTextSpan; text: string }> = [];

      for (const part of copy.parts) {
        const after: string = SyslogRawCopies.scrubbedValueOf(
          part,
          scrubbed,
          before,
          unkept,
          scrub,
        );

        if (after !== part.value) {
          replacements.push({
            span: part.span,
            text: part.isStructuredDataValue
              ? escapeSyslogStructuredDataValue(after)
              : after,
          });
        }
      }

      // The rules read it as the attribute it is, and changed none of its parts.
      if (replacements.length === 0) {
        continue;
      }

      rebuilt[copy.attribute] = SyslogRawCopies.replaceSpans(
        copy.text,
        replacements,
      );
    }

    const keys: Array<string> = Object.keys(rebuilt);

    if (keys.length === 0) {
      return;
    }

    // Read by the rules as any attribute is.
    const read: JSONObject | null = SyslogRawCopies.attributesOf(
      scrub({ attributes: rebuilt }),
    );

    for (const key of keys) {
      const value: unknown = read ? read[key] : undefined;

      attributes[key] = typeof value === "string" ? value : rebuilt[key]!;
    }
  }

  /*
   * What the rules left of a part: its keeper's value after them, when the
   * keeper held this very value. A value the record does not keep - the
   * first of a parameter written twice - is read by the rules on its own,
   * where it would be kept.
   */
  private static scrubbedValueOf(
    part: RawCopyPart,
    scrubbed: JSONObject,
    before: KeptValues,
    unkept: Map<string, string>,
    scrub: ScrubLogRow,
  ): string {
    const keptBefore: unknown =
      part.attribute === null
        ? before.body
        : before.attributes.get(part.attribute);

    if (keptBefore === part.value) {
      const keptAfter: unknown =
        part.attribute === null
          ? scrubbed["body"]
          : SyslogRawCopies.attributesOf(scrubbed)?.[part.attribute];

      return typeof keptAfter === "string" ? keptAfter : part.value;
    }

    const key: string = `${part.attribute ?? ""}\u0000${part.value}`;
    const known: string | undefined = unkept.get(key);

    if (known !== undefined) {
      return known;
    }

    let read: unknown;

    if (part.attribute === null) {
      read = scrub({ body: part.value, attributes: {} })["body"];
    } else {
      const alone: JSONObject = {};

      alone[part.attribute] = part.value;
      read = SyslogRawCopies.attributesOf(scrub({ attributes: alone }))?.[
        part.attribute
      ];
    }

    const value: string = typeof read === "string" ? read : part.value;

    unkept.set(key, value);

    return value;
  }

  private static anyKeptValueChanged(
    scrubbed: JSONObject,
    before: KeptValues,
  ): boolean {
    if (scrubbed["body"] !== before.body) {
      return true;
    }

    const attributes: JSONObject = SyslogRawCopies.attributesOf(scrubbed) || {};

    for (const [key, value] of before.attributes) {
      if (attributes[key] !== value) {
        return true;
      }
    }

    return false;
  }

  // `text` with each span replaced; the spans never overlap.
  private static replaceSpans(
    text: string,
    replacements: Array<{ span: SyslogTextSpan; text: string }>,
  ): string {
    const ordered: Array<{ span: SyslogTextSpan; text: string }> = [
      ...replacements,
    ].sort(
      (
        a: { span: SyslogTextSpan; text: string },
        b: { span: SyslogTextSpan; text: string },
      ): number => {
        return a.span.start - b.span.start;
      },
    );

    let result: string = "";
    let written: number = 0;

    for (const replacement of ordered) {
      result += text.slice(written, replacement.span.start) + replacement.text;
      written = replacement.span.end;
    }

    return result + text.slice(written);
  }

  private static attributesOf(logRow: JSONObject): JSONObject | null {
    const attributes: unknown = logRow["attributes"];

    return attributes &&
      typeof attributes === "object" &&
      !Array.isArray(attributes)
      ? (attributes as JSONObject)
      : null;
  }
}
