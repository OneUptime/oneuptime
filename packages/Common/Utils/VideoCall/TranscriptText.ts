import BadDataException from "../../Types/Exception/BadDataException";
import { removeMarkupFromText } from "../../Types/HtmlMarkup";
import {
  MAX_VIDEO_CALL_TRANSCRIPT_CHARACTERS,
  MAX_VIDEO_CALL_TRANSCRIPT_INPUT_CHARACTERS,
  MAX_VIDEO_CALL_TRANSCRIPT_LINES,
  VideoCallTranscriptInfo,
} from "../../Types/VideoCall/VideoCallTranscript";

/*
 * A CALL'S TRANSCRIPT, READ INTO REMARKS.
 *
 * A transcript reaches OneUptime in whatever shape a meeting tool saves it:
 *
 *   - WebVTT, which Zoom, Microsoft Teams and most recorders write: cues of
 *     "00:01:02.500 --> 00:01:04.000" and the words, the speaker in a voice
 *     span ("<v Priya Shah>...</v>", Teams) or before a colon
 *     ("Priya Shah: ...", Zoom);
 *   - SRT, the same cues with numbers and "00:01:02,500" times;
 *   - text a person pasted: lines of "Priya Shah: ...", maybe with a time
 *     ("[00:01:02] ..." or "00:01:02 ..."), or a time on a line of its own
 *     every few minutes, as a Google Docs transcript has it;
 *   - entries Google Meet's API answers with (read by its client, which
 *     builds remarks directly).
 *
 * Each becomes the same thing: remarks - who spoke (when the source says),
 * how far into the call (when it says) and what was said - one cue or line
 * a remark, a speaker's consecutive short cues joined into one, a very long
 * one cut at a word. A remark is what OneUptime AI cites (L12) and what the
 * transcript dialog shows.
 *
 * It is stored as text, one remark a line: the time (HH:MM:SS, empty when
 * unknown), a tab, the speaker (empty when unknown), a tab, the words. Tabs
 * and line breaks never survive into a remark, so the stored text reads
 * back exactly, without guessing (deserialize).
 *
 * The text is somebody else's - a file anyone could have written - so it
 * is read in time that grows with its length alone: split into lines, and
 * every pattern below reads a short, bounded piece of one line, anchored,
 * with no repeat inside a repeat.
 */

export interface TranscriptLine {
  // How far into the call it was said, when the source says.
  offsetInSeconds?: number | undefined;
  speaker?: string | undefined;
  text: string;
}

export enum TranscriptSourceFormat {
  WebVTT = "WebVTT",
  SRT = "SRT",
  Text = "Text",
}

export interface PreparedTranscript {
  format: TranscriptSourceFormat;
  lines: Array<TranscriptLine>;
  // The text to store (serialize).
  stored: string;
  info: VideoCallTranscriptInfo;
}

// The longest a speaker's name may be; anything longer is not a name.
export const MAX_SPEAKER_LENGTH: number = 60;

/*
 * The longest one remark gets: longer is cut at a word into several, so a
 * citation points at what was said rather than at a monologue.
 */
export const MAX_REMARK_LENGTH: number = 2_000;

/*
 * A speaker's consecutive cues are one remark while they stay this short
 * and this close: captions cut a sentence into two-second pieces.
 */
export const MERGED_REMARK_LENGTH: number = 600;
export const MERGE_WINDOW_IN_SECONDS: number = 60;

/*
 * The most of a source line that is read. A line longer than this is a
 * file that is not a transcript, or a remark longer than any one remark
 * kept (MAX_REMARK_LENGTH), and the rest of it is dropped with nothing
 * missed.
 */
const MAX_SOURCE_LINE_LENGTH: number = 20_000;

// How far into a line a time, a cue arrow or a speaker's colon is looked for.
const MAX_CLOCK_LENGTH: number = 16;
const MAX_VOICE_TAG_LENGTH: number = 200;

// How many lines from the top a file is read for its format.
const FORMAT_SNIFF_LINES: number = 40;

const CUE_ARROW: string = "-->";
const VOICE_TAG_START: string = "<v";
const VOICE_TAG_END: string = "</v>";
const FULL_WIDTH_COLON: string = "：";

const STORED_FIELD_SEPARATOR: string = "\t";

// Blocks of a WebVTT file that are not cues.
const VTT_NON_CUE_BLOCKS: ReadonlyArray<string> = [
  "WEBVTT",
  "NOTE",
  "STYLE",
  "REGION",
];

/*
 * The character references a caption carries, decoded last-but-one; "&amp;"
 * goes last so "&amp;lt;" stays the text "&lt;".
 */
const CHARACTER_REFERENCES: ReadonlyArray<[string, string]> = [
  ["&lt;", "<"],
  ["&gt;", ">"],
  ["&quot;", '"'],
  ["&#39;", "'"],
  ["&apos;", "'"],
  ["&nbsp;", " "],
  ["&lrm;", ""],
  ["&rlm;", ""],
  ["&amp;", "&"],
];

// A run of digits, the whole of a short field.
const DIGITS: RegExp = /^\d+$/;

// A speaker's name starts like a name: a capital, or a letter of a script without case.
const NAME_WORD_START: RegExp = /^[\p{Lu}\p{Lo}]/u;

// A piece of a name never holds a digit or sentence punctuation.
const NOT_IN_A_NAME: RegExp = /[\d.,;!?()[\]{}<>/\\|@#$%^&*=+"]/;

// A text that is a link, not a name: "https://...".
const LINK_START: RegExp = /^[a-z][a-z0-9+.-]{0,15}:\/\//i;

export default class TranscriptText {
  /*
   * Reads a transcript a person added, checks it against what a transcript
   * may hold, and answers with what to store. Throws a BadDataException
   * whose message says what is wrong, in words for the person who added it.
   */
  public static prepare(data: {
    text: string;
    fileName?: string | undefined;
  }): PreparedTranscript {
    const raw: string = typeof data.text === "string" ? data.text : "";

    if (raw.length > MAX_VIDEO_CALL_TRANSCRIPT_INPUT_CHARACTERS) {
      throw new BadDataException(
        `This transcript is too long to add: more than ${TranscriptText.formatCount(MAX_VIDEO_CALL_TRANSCRIPT_INPUT_CHARACTERS)} characters. Add the part of the call about the incident.`,
      );
    }

    const format: TranscriptSourceFormat = TranscriptText.detectFormat(raw);
    const lines: Array<TranscriptLine> = TranscriptText.parse(raw, format);

    return TranscriptText.prepareLines({
      lines,
      format,
      fileName: data.fileName,
    });
  }

  /*
   * Remarks read some other way - a provider's API - joined, cut and
   * checked the same way as a file's.
   */
  public static prepareLines(data: {
    lines: Array<TranscriptLine>;
    format?: TranscriptSourceFormat | undefined;
    fileName?: string | undefined;
  }): PreparedTranscript {
    const lines: Array<TranscriptLine> = TranscriptText.splitLongRemarks(
      TranscriptText.mergeRemarks(TranscriptText.cleanLines(data.lines)),
    );

    if (lines.length === 0) {
      throw new BadDataException(
        "This transcript has no words in it. Add the transcript file your meeting tool saved (.vtt, .srt or .txt), or paste its text.",
      );
    }

    if (lines.length > MAX_VIDEO_CALL_TRANSCRIPT_LINES) {
      throw new BadDataException(
        `This transcript is too long to add: more than ${TranscriptText.formatCount(MAX_VIDEO_CALL_TRANSCRIPT_LINES)} remarks. Add the part of the call about the incident.`,
      );
    }

    const stored: string = TranscriptText.serialize(lines);

    if (stored.length > MAX_VIDEO_CALL_TRANSCRIPT_CHARACTERS) {
      throw new BadDataException(
        `This transcript is too long to add: more than ${TranscriptText.formatCount(MAX_VIDEO_CALL_TRANSCRIPT_CHARACTERS)} characters of talk, about eight hours. Add the part of the call about the incident.`,
      );
    }

    return {
      format: data.format || TranscriptSourceFormat.Text,
      lines,
      stored,
      info: TranscriptText.getInfo(lines, {
        fileName: TranscriptText.cleanFileName(data.fileName),
      }),
    };
  }

  // Which kind of file the text is, from its first lines.
  public static detectFormat(raw: string): TranscriptSourceFormat {
    const lines: Array<string> = TranscriptText.toSourceLines(raw);
    let seen: number = 0;

    for (const line of lines) {
      const trimmed: string = line.trim();

      if (!trimmed) {
        continue;
      }

      if (seen === 0 && trimmed.startsWith("WEBVTT")) {
        return TranscriptSourceFormat.WebVTT;
      }

      if (TranscriptText.readCueTiming(trimmed) !== null) {
        return TranscriptSourceFormat.SRT;
      }

      seen++;

      if (seen >= FORMAT_SNIFF_LINES) {
        break;
      }
    }

    return TranscriptSourceFormat.Text;
  }

  public static parse(
    raw: string,
    format?: TranscriptSourceFormat | undefined,
  ): Array<TranscriptLine> {
    const resolved: TranscriptSourceFormat =
      format || TranscriptText.detectFormat(raw);

    if (resolved === TranscriptSourceFormat.Text) {
      return TranscriptText.parsePlainText(raw);
    }

    return TranscriptText.parseCues(raw);
  }

  /*
   * WebVTT and SRT: blocks between blank lines, each a cue when it has a
   * timing line. What comes before the timing line is the cue's number or
   * name; what comes after it is the caption.
   */
  public static parseCues(raw: string): Array<TranscriptLine> {
    const result: Array<TranscriptLine> = [];
    let block: Array<string> = [];

    const flush: () => void = (): void => {
      if (block.length === 0) {
        return;
      }

      const first: string = block[0]!.trim();
      const isNonCueBlock: boolean = VTT_NON_CUE_BLOCKS.some(
        (keyword: string): boolean => {
          return first === keyword || first.startsWith(`${keyword} `);
        },
      );

      if (!isNonCueBlock) {
        const timingIndex: number = block.findIndex(
          (line: string): boolean => {
            return TranscriptText.readCueTiming(line.trim()) !== null;
          },
        );

        if (timingIndex !== -1) {
          const offset: number | null = TranscriptText.readCueTiming(
            block[timingIndex]!.trim(),
          );
          const caption: string = block
            .slice(timingIndex + 1)
            .map((line: string): string => {
              return line.trim();
            })
            .filter((line: string): boolean => {
              return line.length > 0;
            })
            .join(" ");

          const remark: TranscriptLine | null = TranscriptText.readCaption(
            caption,
            offset === null ? undefined : offset,
          );

          if (remark) {
            result.push(remark);
          }
        }
      }

      block = [];
    };

    for (const line of TranscriptText.toSourceLines(raw)) {
      if (line.trim() === "") {
        flush();
        continue;
      }

      block.push(line);
    }

    flush();

    return result;
  }

  /*
   * Pasted text: one remark a line. A line may start with its time - in
   * brackets or not - and a line that is only a time (a Google Docs
   * transcript has one every few minutes) dates the lines after it.
   */
  public static parsePlainText(raw: string): Array<TranscriptLine> {
    const result: Array<TranscriptLine> = [];
    let currentOffset: number | undefined = undefined;

    for (const line of TranscriptText.toSourceLines(raw)) {
      let rest: string = line.trim();

      if (!rest) {
        continue;
      }

      const standalone: number | null = TranscriptText.readStandaloneClock(rest);

      if (standalone !== null) {
        currentOffset = standalone;
        continue;
      }

      let offset: number | undefined = currentOffset;
      const leading: { offset: number; rest: string } | null =
        TranscriptText.readLeadingClock(rest);

      if (leading) {
        offset = leading.offset;
        currentOffset = leading.offset;
        rest = leading.rest;
      }

      const remark: TranscriptLine | null = TranscriptText.readCaption(
        rest,
        offset,
      );

      if (remark) {
        result.push(remark);
      }
    }

    return result;
  }

  // One remark a line: time, tab, speaker, tab, words.
  public static serialize(lines: Array<TranscriptLine>): string {
    return lines
      .map((line: TranscriptLine): string => {
        return [
          line.offsetInSeconds === undefined
            ? ""
            : TranscriptText.formatOffset(line.offsetInSeconds),
          TranscriptText.toField(line.speaker || ""),
          TranscriptText.toField(line.text),
        ].join(STORED_FIELD_SEPARATOR);
      })
      .join("\n");
  }

  // The stored text read back into its remarks.
  public static deserialize(
    stored: string | undefined | null,
  ): Array<TranscriptLine> {
    if (!stored) {
      return [];
    }

    const result: Array<TranscriptLine> = [];

    for (const line of stored.split("\n")) {
      if (!line) {
        continue;
      }

      const firstTab: number = line.indexOf(STORED_FIELD_SEPARATOR);
      const secondTab: number =
        firstTab === -1
          ? -1
          : line.indexOf(STORED_FIELD_SEPARATOR, firstTab + 1);

      // A line written some other way (an older format, a hand edit) is all words.
      if (firstTab === -1 || secondTab === -1) {
        const text: string = line.trim();

        if (text) {
          result.push({ text });
        }

        continue;
      }

      const clock: string = line.slice(0, firstTab);
      const speaker: string = line.slice(firstTab + 1, secondTab).trim();
      const text: string = line.slice(secondTab + 1).trim();

      if (!text) {
        continue;
      }

      const offset: number | null = clock
        ? TranscriptText.parseClock(clock)
        : null;
      const remark: TranscriptLine = { text };

      if (offset !== null) {
        remark.offsetInSeconds = offset;
      }

      if (speaker) {
        remark.speaker = speaker;
      }

      result.push(remark);
    }

    return result;
  }

  // "[00:12:03] Priya Shah: words", one remark a line, for a person to read.
  public static toReadableText(lines: Array<TranscriptLine>): string {
    return lines
      .map((line: TranscriptLine): string => {
        return TranscriptText.toReadableLine(line);
      })
      .join("\n");
  }

  public static toReadableLine(line: TranscriptLine): string {
    const time: string =
      line.offsetInSeconds === undefined
        ? ""
        : `[${TranscriptText.formatOffset(line.offsetInSeconds)}] `;
    const speaker: string = line.speaker ? `${line.speaker}: ` : "";

    return `${time}${speaker}${line.text}`;
  }

  public static getInfo(
    lines: Array<TranscriptLine>,
    extra?: { fileName?: string | undefined } | undefined,
  ): VideoCallTranscriptInfo {
    const speakers: Set<string> = new Set<string>();
    let characterCount: number = 0;
    let first: number | undefined = undefined;
    let last: number | undefined = undefined;

    for (const line of lines) {
      characterCount += line.text.length;

      if (line.speaker) {
        speakers.add(line.speaker.toLowerCase());
      }

      if (line.offsetInSeconds !== undefined) {
        if (first === undefined || line.offsetInSeconds < first) {
          first = line.offsetInSeconds;
        }

        if (last === undefined || line.offsetInSeconds > last) {
          last = line.offsetInSeconds;
        }
      }
    }

    const info: VideoCallTranscriptInfo = {
      lineCount: lines.length,
      speakerCount: speakers.size,
      characterCount,
    };

    if (first !== undefined && last !== undefined && last > first) {
      info.durationInSeconds = Math.round(last - first);
    }

    if (extra?.fileName) {
      info.fileName = extra.fileName;
    }

    return info;
  }

  // HH:MM:SS, the hours zero-padded to two digits.
  public static formatOffset(offsetInSeconds: number): string {
    const total: number = Math.max(0, Math.floor(offsetInSeconds));
    const hours: number = Math.floor(total / 3600);
    const minutes: number = Math.floor((total % 3600) / 60);
    const seconds: number = total % 60;

    return [hours, minutes, seconds]
      .map((part: number): string => {
        return part.toString().padStart(2, "0");
      })
      .join(":");
  }

  /*
   * A clock as captions and transcripts write it - "1:02:03", "01:02:03.500",
   * "00:01:02,500", "12:03" - in seconds, or null. Read by hand: two or
   * three fields of digits, the minutes and seconds under 60, and a
   * fraction of a second after the last.
   */
  public static parseClock(value: string): number | null {
    const trimmed: string = value.trim();

    if (!trimmed || trimmed.length > MAX_CLOCK_LENGTH) {
      return null;
    }

    let main: string = trimmed;
    let fraction: string = "";
    const fractionAt: number = Math.max(
      trimmed.lastIndexOf("."),
      trimmed.lastIndexOf(","),
    );

    if (fractionAt !== -1) {
      main = trimmed.slice(0, fractionAt);
      fraction = trimmed.slice(fractionAt + 1);

      if (!DIGITS.test(fraction) || fraction.length > 3) {
        return null;
      }
    }

    const fields: Array<string> = main.split(":");

    if (fields.length < 2 || fields.length > 3) {
      return null;
    }

    for (const field of fields) {
      if (!DIGITS.test(field) || field.length > 3) {
        return null;
      }
    }

    const numbers: Array<number> = fields.map((field: string): number => {
      return Number(field);
    });

    // Every field but the first counts up to 59.
    for (let index: number = 1; index < numbers.length; index++) {
      if (numbers[index]! >= 60 || fields[index]!.length !== 2) {
        return null;
      }
    }

    const seconds: number =
      numbers.length === 3
        ? numbers[0]! * 3600 + numbers[1]! * 60 + numbers[2]!
        : numbers[0]! * 60 + numbers[1]!;

    return fraction ? seconds + Number(`0.${fraction}`) : seconds;
  }

  /*
   * The start of a cue whose timing line this is ("00:00:01.000 -->
   * 00:00:04.000 align:start"), or null for any other line.
   */
  public static readCueTiming(line: string): number | null {
    const arrow: number = line.indexOf(CUE_ARROW);

    if (arrow <= 0 || arrow > MAX_CLOCK_LENGTH + 2) {
      return null;
    }

    const start: number | null = TranscriptText.parseClock(
      line.slice(0, arrow),
    );

    if (start === null) {
      return null;
    }

    const afterArrow: string = line
      .slice(arrow + CUE_ARROW.length, arrow + CUE_ARROW.length + 32)
      .trim();
    const endToken: string = afterArrow.split(" ")[0] || "";

    return TranscriptText.parseClock(endToken) === null ? null : start;
  }

  /*
   * A caption or a pasted line into a remark: the speaker from a voice span
   * or a "Name: " before the words, and the words without markup.
   */
  public static readCaption(
    caption: string,
    offset: number | undefined,
  ): TranscriptLine | null {
    let text: string = caption.trim();
    let speaker: string | undefined = undefined;

    const voice: { speaker: string; rest: string } | null =
      TranscriptText.readVoiceSpan(text);

    if (voice) {
      speaker = voice.speaker;
      text = voice.rest;
    }

    text = TranscriptText.cleanCaptionText(text);

    if (!speaker) {
      const prefixed: { speaker: string; rest: string } | null =
        TranscriptText.readSpeakerPrefix(text);

      if (prefixed) {
        speaker = prefixed.speaker;
        text = prefixed.rest;
      }
    }

    text = TranscriptText.collapseWhitespace(text);

    if (!text) {
      return null;
    }

    const remark: TranscriptLine = { text };

    if (offset !== undefined) {
      remark.offsetInSeconds = offset;
    }

    const cleanSpeaker: string = TranscriptText.cleanSpeaker(speaker);

    if (cleanSpeaker) {
      remark.speaker = cleanSpeaker;
    }

    return remark;
  }

  /*
   * WebVTT's voice span, "<v Priya Shah>" or "<v.loud Priya Shah>", at the
   * start of a caption.
   */
  public static readVoiceSpan(
    caption: string,
  ): { speaker: string; rest: string } | null {
    if (!caption.startsWith(VOICE_TAG_START)) {
      return null;
    }

    const next: string = caption.charAt(VOICE_TAG_START.length);

    if (next !== " " && next !== ".") {
      return null;
    }

    const end: number = caption.indexOf(">", VOICE_TAG_START.length);

    if (end === -1 || end > MAX_VOICE_TAG_LENGTH) {
      return null;
    }

    let inside: string = caption.slice(VOICE_TAG_START.length, end);

    // Classes come before the name: ".loud.quiet Name".
    if (inside.startsWith(".")) {
      const space: number = inside.indexOf(" ");
      inside = space === -1 ? "" : inside.slice(space + 1);
    }

    const speaker: string = inside.trim();
    const rest: string = caption
      .slice(end + 1)
      .split(VOICE_TAG_END)
      .join(" ");

    if (!speaker) {
      return { speaker: "", rest };
    }

    return { speaker, rest };
  }

  /*
   * "Priya Shah: words" (or "Priya Shah：words", as CJK transcripts write
   * it). What is before the colon is a speaker only when it reads like a
   * name: short, a few words, each starting like a name, with no digits or
   * punctuation, and not a link. A sentence such as "Note: we restarted it"
   * may still be read as said by "Note", which costs nothing.
   */
  public static readSpeakerPrefix(
    text: string,
  ): { speaker: string; rest: string } | null {
    const head: string = text.slice(0, MAX_SPEAKER_LENGTH + 2);
    const colon: number = head.indexOf(":");
    const fullWidthColon: number = head.indexOf(FULL_WIDTH_COLON);

    let at: number = -1;
    let skip: number = 0;

    if (
      fullWidthColon > 0 &&
      (colon === -1 || fullWidthColon < colon) &&
      fullWidthColon <= MAX_SPEAKER_LENGTH
    ) {
      at = fullWidthColon;
      skip = 1;
    } else if (
      colon > 0 &&
      colon <= MAX_SPEAKER_LENGTH &&
      text.charAt(colon + 1) === " "
    ) {
      at = colon;
      skip = 2;
    }

    if (at === -1) {
      return null;
    }

    const candidate: string = text.slice(0, at).trim();

    if (!TranscriptText.looksLikeName(candidate) || LINK_START.test(text)) {
      return null;
    }

    const rest: string = text.slice(at + skip).trim();

    if (!rest) {
      return null;
    }

    return { speaker: candidate, rest };
  }

  public static looksLikeName(candidate: string): boolean {
    if (!candidate || candidate.length > MAX_SPEAKER_LENGTH) {
      return false;
    }

    const words: Array<string> = candidate
      .split(" ")
      .filter((word: string): boolean => {
        return word.length > 0;
      });

    if (words.length === 0 || words.length > 5) {
      return false;
    }

    return words.every((word: string): boolean => {
      return NAME_WORD_START.test(word) && !NOT_IN_A_NAME.test(word);
    });
  }

  // How many ever, written with thousands separators: "400,000".
  public static formatCount(count: number): string {
    return count.toLocaleString("en-US");
  }

  /*
   * A transcript's length in English words, for the feed and a prompt:
   * "52 minutes, 6 speakers, 312 remarks".
   */
  public static describeInfo(info: VideoCallTranscriptInfo): string {
    const parts: Array<string> = [];

    if (info.durationInSeconds && info.durationInSeconds >= 60) {
      const minutes: number = Math.round(info.durationInSeconds / 60);
      parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
    }

    if (info.speakerCount > 0) {
      parts.push(
        `${info.speakerCount} ${info.speakerCount === 1 ? "speaker" : "speakers"}`,
      );
    }

    parts.push(
      `${TranscriptText.formatCount(info.lineCount)} ${info.lineCount === 1 ? "remark" : "remarks"}`,
    );

    return parts.join(", ");
  }

  /*
   * A transcript's info as stored (a JSON column), read defensively; null
   * when it is not there.
   */
  public static readInfo(value: unknown): VideoCallTranscriptInfo | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const json: Record<string, unknown> = value as Record<string, unknown>;
    const count: (key: string) => number = (key: string): number => {
      const found: unknown = json[key];
      return typeof found === "number" && Number.isFinite(found) && found >= 0
        ? Math.floor(found)
        : 0;
    };

    const info: VideoCallTranscriptInfo = {
      lineCount: count("lineCount"),
      speakerCount: count("speakerCount"),
      characterCount: count("characterCount"),
    };

    if (count("durationInSeconds") > 0) {
      info.durationInSeconds = count("durationInSeconds");
    }

    if (typeof json["fileName"] === "string" && json["fileName"]) {
      info.fileName = json["fileName"];
    }

    return info;
  }

  /*
   * A speaker's consecutive cues joined: captions cut one sentence into
   * pieces a couple of seconds long, and a citation of one piece says
   * little. Pieces join while the remark stays short and within a minute
   * of its start. Remarks with neither a speaker nor a time (plain lines)
   * stay as they were written.
   */
  public static mergeRemarks(
    lines: Array<TranscriptLine>,
  ): Array<TranscriptLine> {
    const result: Array<TranscriptLine> = [];

    for (const line of lines) {
      const previous: TranscriptLine | undefined = result[result.length - 1];

      if (
        previous &&
        TranscriptText.canJoin(previous, line) &&
        previous.text.length + 1 + line.text.length <= MERGED_REMARK_LENGTH
      ) {
        previous.text = `${previous.text} ${line.text}`;
        continue;
      }

      result.push({ ...line });
    }

    return result;
  }

  // A remark longer than MAX_REMARK_LENGTH, cut at words into several.
  public static splitLongRemarks(
    lines: Array<TranscriptLine>,
  ): Array<TranscriptLine> {
    const result: Array<TranscriptLine> = [];

    for (const line of lines) {
      let text: string = line.text;

      while (text.length > MAX_REMARK_LENGTH) {
        let cut: number = text.lastIndexOf(" ", MAX_REMARK_LENGTH);

        if (cut < MAX_REMARK_LENGTH / 2) {
          cut = MAX_REMARK_LENGTH;
        }

        result.push({ ...line, text: text.slice(0, cut).trim() });
        text = text.slice(cut).trim();
      }

      if (text) {
        result.push({ ...line, text });
      }
    }

    return result;
  }

  private static canJoin(
    previous: TranscriptLine,
    next: TranscriptLine,
  ): boolean {
    if ((previous.speaker || "") !== (next.speaker || "")) {
      return false;
    }

    if (
      previous.offsetInSeconds === undefined ||
      next.offsetInSeconds === undefined
    ) {
      // Untimed lines join only as one speaker's turn.
      return (
        Boolean(previous.speaker) &&
        previous.offsetInSeconds === undefined &&
        next.offsetInSeconds === undefined
      );
    }

    return (
      next.offsetInSeconds >= previous.offsetInSeconds &&
      next.offsetInSeconds - previous.offsetInSeconds <= MERGE_WINDOW_IN_SECONDS
    );
  }

  // Remarks as a source gave them, with their words and names tidied.
  private static cleanLines(
    lines: Array<TranscriptLine>,
  ): Array<TranscriptLine> {
    const result: Array<TranscriptLine> = [];

    for (const line of lines) {
      const text: string = TranscriptText.collapseWhitespace(
        TranscriptText.removeControlCharacters(line.text || ""),
      );

      if (!text) {
        continue;
      }

      const remark: TranscriptLine = { text };
      const speaker: string = TranscriptText.cleanSpeaker(line.speaker);

      if (speaker) {
        remark.speaker = speaker;
      }

      if (
        typeof line.offsetInSeconds === "number" &&
        Number.isFinite(line.offsetInSeconds) &&
        line.offsetInSeconds >= 0
      ) {
        remark.offsetInSeconds = line.offsetInSeconds;
      }

      result.push(remark);
    }

    return result;
  }

  private static cleanSpeaker(speaker: string | undefined): string {
    const cleaned: string = TranscriptText.collapseWhitespace(
      TranscriptText.removeControlCharacters(speaker || ""),
    );

    if (cleaned.length > MAX_SPEAKER_LENGTH) {
      return cleaned.slice(0, MAX_SPEAKER_LENGTH).trim();
    }

    return cleaned;
  }

  private static cleanFileName(fileName: string | undefined): string {
    const cleaned: string = TranscriptText.collapseWhitespace(
      TranscriptText.removeControlCharacters(fileName || ""),
    );

    // Only the name: a browser can send a path.
    const lastSlash: number = Math.max(
      cleaned.lastIndexOf("/"),
      cleaned.lastIndexOf("\\"),
    );
    const name: string = cleaned.slice(lastSlash + 1);

    return name.length > 200 ? name.slice(0, 200) : name;
  }

  /*
   * Caption markup out - a class or style span, an inline timestamp - and
   * the character references a caption may carry turned back into text.
   */
  private static cleanCaptionText(text: string): string {
    let cleaned: string = TranscriptText.removeInlineTimestamps(
      text.split(VOICE_TAG_END).join(" "),
    );

    cleaned = removeMarkupFromText(cleaned);

    for (const [reference, character] of CHARACTER_REFERENCES) {
      if (cleaned.includes(reference)) {
        cleaned = cleaned.split(reference).join(character);
      }
    }

    return cleaned;
  }

  /*
   * WebVTT's karaoke timestamps, "<00:00:01.500>", which the markup reader
   * keeps as text (a "<" before a digit starts no tag).
   */
  private static removeInlineTimestamps(text: string): string {
    if (!text.includes("<")) {
      return text;
    }

    let result: string = "";
    let index: number = 0;

    while (index < text.length) {
      const open: number = text.indexOf("<", index);

      if (open === -1) {
        result += text.slice(index);
        break;
      }

      result += text.slice(index, open);

      const close: number = text.indexOf(">", open + 1);

      if (
        close !== -1 &&
        close - open - 1 <= MAX_CLOCK_LENGTH &&
        TranscriptText.parseClock(text.slice(open + 1, close)) !== null
      ) {
        index = close + 1;
        continue;
      }

      result += "<";
      index = open + 1;
    }

    return result;
  }

  // A line that is only a time: "00:05:00", "[00:05]".
  private static readStandaloneClock(line: string): number | null {
    if (line.length > MAX_CLOCK_LENGTH + 2) {
      return null;
    }

    const inner: string =
      line.startsWith("[") && line.endsWith("]") ? line.slice(1, -1) : line;

    return TranscriptText.parseClock(inner);
  }

  // A time at the start of a line: "[00:01:02] words" or "00:01:02 words".
  private static readLeadingClock(
    line: string,
  ): { offset: number; rest: string } | null {
    if (line.startsWith("[")) {
      const close: number = line.indexOf("]");

      if (close === -1 || close > MAX_CLOCK_LENGTH + 1) {
        return null;
      }

      const offset: number | null = TranscriptText.parseClock(
        line.slice(1, close),
      );

      return offset === null
        ? null
        : { offset, rest: line.slice(close + 1).trim() };
    }

    const space: number = line.indexOf(" ");

    if (space <= 0 || space > MAX_CLOCK_LENGTH) {
      return null;
    }

    const offset: number | null = TranscriptText.parseClock(
      line.slice(0, space),
    );

    return offset === null
      ? null
      : { offset, rest: line.slice(space + 1).trim() };
  }

  // The text split into lines, each cut at MAX_SOURCE_LINE_LENGTH.
  private static toSourceLines(raw: string): Array<string> {
    const text: string = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;

    return text.split("\n").map((line: string): string => {
      const withoutReturn: string = line.endsWith("\r")
        ? line.slice(0, -1)
        : line;

      return withoutReturn.length > MAX_SOURCE_LINE_LENGTH
        ? withoutReturn.slice(0, MAX_SOURCE_LINE_LENGTH)
        : withoutReturn;
    });
  }

  // Tabs, line breaks and the other control characters, as spaces.
  private static removeControlCharacters(text: string): string {
    let result: string = "";
    let start: number = 0;

    for (let index: number = 0; index < text.length; index++) {
      const code: number = text.charCodeAt(index);

      if (code < 0x20 || code === 0x7f) {
        result += `${text.slice(start, index)} `;
        start = index + 1;
      }
    }

    return start === 0 ? text : result + text.slice(start);
  }

  // Runs of spaces as one space, and none at either end.
  private static collapseWhitespace(text: string): string {
    return text
      .split(" ")
      .filter((piece: string): boolean => {
        return piece.length > 0;
      })
      .join(" ")
      .trim();
  }

  // A stored field: no tab or line break can survive into one.
  private static toField(value: string): string {
    return TranscriptText.collapseWhitespace(
      TranscriptText.removeControlCharacters(value),
    );
  }
}
