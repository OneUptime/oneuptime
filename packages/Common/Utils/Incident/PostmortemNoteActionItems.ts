/*
 * THE ACTION ITEMS A POSTMORTEM'S NOTE LISTS (issue #6801).
 *
 * A postmortem's action items used to be words in its note and nothing
 * else: OneUptime AI's draft and every postmortem template end with an
 * "Action Items" section ("How We Prevent It" in the brief one), written as
 * a checklist, a list or a table with Owner and Due Date columns, and
 * nothing said which of them were done. Action items are records now
 * (IncidentPostmortemActionItem), and this reads the ones a note lists, so
 * the postmortem offers to track them in one click instead of having them
 * typed in again.
 *
 * What counts as an action item:
 *
 *   - the items of a section whose heading names action items, follow-ups,
 *     next steps or corrective and preventive actions, in English or in
 *     another of the Dashboard's languages (a team can have OneUptime AI
 *     write its postmortems in its own). A heading is a Markdown heading
 *     ("## Action Items") or a line in bold on its own ("**Action
 *     Items:**"). A section runs to the next heading of the same level or
 *     above, so its own sub-headings ("### This week") stay in it;
 *   - in that section, each item of its outermost list - a nested item is a
 *     detail of the one above it - and each row of its table, the action
 *     read from the column named for it (Action, Item, Task, ...) or else
 *     the first one;
 *   - a checked box ("- [x]") or a Status column that says done is an item
 *     already done.
 *
 * What does not: a heading that only says prevention ("## Prevention" in
 * the detailed template holds what went well and what went wrong), a
 * template's placeholder left as it was ("[Action item 1]"), an empty or
 * "none" item, and anything in a code block.
 *
 * Pure, no I/O and no React: the Dashboard reads the note it shows with
 * it, the server could read a stored one the same way, and the tests pin
 * it on the templates' own text.
 */

import moment from "moment-timezone";

// One action item as a note lists it.
export interface PostmortemNoteActionItem {
  // The action, as written, without its Markdown marks.
  title: string;
  // Checked off in the note, or a Status column that says done.
  isDone: boolean;
  // Who the note says owns it (an Owner column, or "Owner: Ana"), as written.
  ownerText?: string | undefined;
  /*
   * The day the note says it is due, when written as a date: "2026-11-20".
   * A day, not a time: whoever tracks the item places it in the reader's
   * time zone, as the Due Date picker does (toDueDate).
   */
  dueDay?: string | undefined;
}

// The longest action item title kept: the title column's length.
export const MAX_ACTION_ITEM_TITLE_LENGTH: number = 500;

// The most items one note is read for: a section longer than this is not a list of actions.
export const MAX_NOTE_ACTION_ITEMS: number = 50;

/*
 * Headings that name a postmortem's action items, by language. Matched as
 * whole words, after the heading is lowercased and its punctuation dropped
 * (so "Follow-up Actions:" reads as "follow up actions"), anywhere in the
 * heading: "Open Action Items", "Action Items and Owners". Only words that
 * mean actions still to take: "Actions" alone, or "Maßnahmen", is as often
 * what was done during the incident.
 */
export const ACTION_ITEM_HEADING_WORDS: ReadonlyArray<string> = [
  // English: what OneUptime AI's draft and the templates write, and common variants.
  "action items",
  "action item",
  "follow ups",
  "follow up",
  "followups",
  "followup",
  "next steps",
  "corrective actions",
  "preventive actions",
  "preventative actions",
  "prevention actions",
  "how we prevent it",
  "remediation items",
  "to dos",
  "todos",
  "todo",
  // German
  "aktionspunkte",
  "maßnahmenplan",
  "nächste schritte",
  "folgemaßnahmen",
  "korrekturmaßnahmen",
  // French
  "points d action",
  "plan d action",
  "actions correctives",
  "actions préventives",
  "prochaines étapes",
  // Spanish
  "elementos de acción",
  "acciones correctivas",
  "acciones preventivas",
  "próximos pasos",
  // Italian
  "azioni correttive",
  "azioni preventive",
  "prossimi passi",
  // Portuguese
  "itens de ação",
  "ações corretivas",
  "ações preventivas",
  "próximos passos",
  // Dutch
  "actiepunten",
  "vervolgacties",
  "vervolgstappen",
  "volgende stappen",
  // Danish
  "handlingspunkter",
  "opfølgningspunkter",
  "næste skridt",
  // Norwegian
  "tiltakspunkter",
  "oppfølgingspunkter",
  "neste steg",
  // Swedish
  "åtgärdspunkter",
  "uppföljningspunkter",
  "nästa steg",
  // Russian
  "план действий",
  "корректирующие действия",
  "превентивные меры",
  "следующие шаги",
  // Hindi
  "कार्य आइटम",
  "कार्रवाई आइटम",
  "सुधारात्मक कार्रवाई",
  "अगले कदम",
  // Persian
  "موارد اقدام",
  "اقدامات اصلاحی",
  "اقدامات پیشگیرانه",
  "گام های بعدی",
  // Arabic
  "بنود العمل",
  "الإجراءات التصحيحية",
  "الإجراءات الوقائية",
  "الخطوات التالية",
];

/*
 * Headings that name action items only when they are the whole heading:
 * "## To Do" lists what is still to do, "## How to do a rollback" does not.
 */
export const ACTION_ITEM_WHOLE_HEADINGS: ReadonlyArray<string> = [
  "to do",
  "tasks",
];

/*
 * Headings in languages written without spaces between words, matched
 * anywhere in the heading: Japanese, Korean and Chinese.
 */
export const ACTION_ITEM_HEADING_SUBSTRINGS: ReadonlyArray<string> = [
  // Japanese
  "アクションアイテム",
  "対応事項",
  "再発防止策",
  "今後の対応",
  // Korean
  "조치 사항",
  "조치사항",
  "액션 아이템",
  "후속 조치",
  "재발 방지",
  // Chinese (simplified, then traditional)
  "行动项",
  "后续行动",
  "改进措施",
  "待办事项",
  "行動項目",
  "後續行動",
  "改善措施",
  "待辦事項",
];

// Table columns, by what they hold: lowercased header words.
const ACTION_COLUMN_WORDS: ReadonlyArray<string> = [
  "action",
  "action item",
  "item",
  "task",
  "what",
  "description",
  "title",
  "follow up",
];
const OWNER_COLUMN_WORDS: ReadonlyArray<string> = [
  "owner",
  "owners",
  "assignee",
  "assigned to",
  "who",
  "responsible",
];
const DUE_COLUMN_WORDS: ReadonlyArray<string> = [
  "due",
  "due date",
  "deadline",
  "by when",
  "target date",
];
const STATUS_COLUMN_WORDS: ReadonlyArray<string> = ["status", "state", "done"];

// A Status cell that says the item is done.
const DONE_STATUS_WORDS: ReadonlyArray<string> = [
  "done",
  "complete",
  "completed",
  "closed",
  "fixed",
  "resolved",
  "yes",
  "x",
  "✅",
  "✔",
  "✓",
];

// An item that says there is nothing to do.
const EMPTY_ITEM_WORDS: ReadonlyArray<string> = [
  "none",
  "n a",
  "na",
  "tbd",
  "nothing",
  "no action items",
  "not available in the incident record",
  "no data available",
];

interface Heading {
  // 1 to 6 for "#" to "######"; 7 for a line in bold, below every "#".
  level: number;
  text: string;
}

const ATX_HEADING_REGEX: RegExp =
  /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const BOLD_HEADING_REGEX: RegExp =
  /^ {0,3}(?:\*\*|__)(.+?)(?:\*\*|__)[ \t]*:?[ \t]*$/;
const FENCE_REGEX: RegExp = /^ {0,3}(```|~~~)/;
const LIST_ITEM_REGEX: RegExp =
  /^([ \t]*)(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[([ xX])\][ \t]+)?(.*)$/;
const TABLE_ROW_REGEX: RegExp = /^[ \t]*\|.*\|[ \t]*$/;
const TABLE_SEPARATOR_REGEX: RegExp =
  /^[ \t]*\|?(?:[ \t]*:?-{1,}:?[ \t]*\|)+[ \t]*:?-*:?[ \t]*\|?[ \t]*$/;
const ISO_DATE_REGEX: RegExp = /\b(\d{4})-(\d{2})-(\d{2})\b/;
/*
 * A digit as a Persian or an Arabic note may write one: "۲۰۲۶-۱۱-۲۰" is the
 * same day as 2026-11-20 (toLatinDigits).
 */
const NON_LATIN_DIGIT_REGEX: RegExp = /[٠-٩۰-۹]/g;
const ARABIC_INDIC_ZERO: number = 0x0660;
const PERSIAN_ZERO: number = 0x06f0;
const INLINE_OWNER_REGEX: RegExp =
  /[([,;\s-]+(?:owner|assignee|assigned to)[ \t]*[:=][ \t]*([^,;)\]]+)[)\]]?/i;
const INLINE_DUE_REGEX: RegExp =
  /[([,;\s-]+(?:due(?: date)?|deadline|by)[ \t]*[:=]?[ \t]*([\d٠-٩۰-۹]{4}-[\d٠-٩۰-۹]{2}-[\d٠-٩۰-۹]{2})[)\]]?/i;
// A template's placeholder left as it was: the whole item in square brackets.
const PLACEHOLDER_REGEX: RegExp = /^\[[^\]]*\]$/;

export default class PostmortemNoteActionItems {
  /*
   * The action items a note lists, in the order it lists them, at most
   * MAX_NOTE_ACTION_ITEMS. An empty note, or one with no action items
   * section, lists none.
   */
  public static read(
    note: string | null | undefined,
  ): Array<PostmortemNoteActionItem> {
    if (!note || !note.trim()) {
      return [];
    }

    const lines: Array<string> = note.replace(/\r\n?/g, "\n").split("\n");
    const items: Array<PostmortemNoteActionItem> = [];

    // The heading level of the action items section the line is in, if any.
    let sectionLevel: number | null = null;
    let isInFence: boolean = false;
    let fenceMarker: string = "";
    // The indent of the section's outermost list, once it has one.
    let listIndent: number | null = null;
    // The lines of the table being read, header first.
    let tableLines: Array<string> = [];

    const flushTable: () => void = (): void => {
      if (tableLines.length) {
        items.push(...PostmortemNoteActionItems.readTable(tableLines));
        tableLines = [];
      }
    };

    for (const line of lines) {
      const fence: RegExpMatchArray | null = line.match(FENCE_REGEX);

      if (fence) {
        if (!isInFence) {
          flushTable();
          isInFence = true;
          fenceMarker = fence[1]!;
        } else if (line.trim().startsWith(fenceMarker)) {
          isInFence = false;
        }
        continue;
      }

      if (isInFence) {
        continue;
      }

      const heading: Heading | null =
        PostmortemNoteActionItems.readHeading(line);

      if (heading) {
        flushTable();

        if (sectionLevel !== null && heading.level > sectionLevel) {
          // A sub-heading of the action items section keeps the section open.
          listIndent = null;
          continue;
        }

        sectionLevel = PostmortemNoteActionItems.isActionItemHeading(
          heading.text,
        )
          ? heading.level
          : null;
        listIndent = null;
        continue;
      }

      if (sectionLevel === null) {
        continue;
      }

      if (TABLE_ROW_REGEX.test(line)) {
        tableLines.push(line);
        continue;
      }

      flushTable();

      const listItem: RegExpMatchArray | null = line.match(LIST_ITEM_REGEX);

      if (!listItem) {
        continue;
      }

      const indent: number = listItem[1]!.replace(/\t/g, "    ").length;

      if (listIndent === null || indent < listIndent) {
        listIndent = indent;
      }

      if (indent > listIndent) {
        // A nested item: a detail of the item above it.
        continue;
      }

      const item: PostmortemNoteActionItem | null =
        PostmortemNoteActionItems.toItem({
          text: listItem[3] || "",
          isChecked: (listItem[2] || "").toLowerCase() === "x",
        });

      if (item) {
        items.push(item);
      }
    }

    flushTable();

    return items.slice(0, MAX_NOTE_ACTION_ITEMS);
  }

  /*
   * The items a note lists that are not tracked yet: none whose title is,
   * but for case, spaces and punctuation, the title of one of the
   * incident's action items. Duplicates in the note count once.
   */
  public static getUntracked(data: {
    items: Array<PostmortemNoteActionItem>;
    trackedTitles: Array<string>;
  }): Array<PostmortemNoteActionItem> {
    const seen: Set<string> = new Set(
      data.trackedTitles.map((title: string): string => {
        return PostmortemNoteActionItems.toComparableTitle(title);
      }),
    );

    const untracked: Array<PostmortemNoteActionItem> = [];

    for (const item of data.items) {
      const comparable: string = PostmortemNoteActionItems.toComparableTitle(
        item.title,
      );

      if (!comparable || seen.has(comparable)) {
        continue;
      }

      seen.add(comparable);
      untracked.push(item);
    }

    return untracked;
  }

  // A title as it is compared: lowercased, its punctuation and extra spaces dropped.
  public static toComparableTitle(title: string): string {
    return PostmortemNoteActionItems.toWords(title);
  }

  // Whether a heading's words name a postmortem's action items.
  public static isActionItemHeading(headingText: string): boolean {
    const words: string = PostmortemNoteActionItems.toWords(headingText);

    if (!words) {
      return false;
    }

    if (ACTION_ITEM_WHOLE_HEADINGS.includes(words)) {
      return true;
    }

    const padded: string = ` ${words} `;

    for (const phrase of ACTION_ITEM_HEADING_WORDS) {
      if (padded.includes(` ${PostmortemNoteActionItems.toWords(phrase)} `)) {
        return true;
      }
    }

    const compact: string = headingText.normalize("NFC");

    for (const phrase of ACTION_ITEM_HEADING_SUBSTRINGS) {
      if (compact.includes(phrase)) {
        return true;
      }
    }

    return false;
  }

  private static readHeading(line: string): Heading | null {
    const atx: RegExpMatchArray | null = line.match(ATX_HEADING_REGEX);

    if (atx) {
      return { level: atx[1]!.length, text: atx[2] || "" };
    }

    const bold: RegExpMatchArray | null = line.match(BOLD_HEADING_REGEX);

    if (bold) {
      return { level: 7, text: bold[1] || "" };
    }

    return null;
  }

  private static readTable(
    lines: Array<string>,
  ): Array<PostmortemNoteActionItem> {
    // A table is a header row, its separator row, then the rows.
    if (lines.length < 3 || !TABLE_SEPARATOR_REGEX.test(lines[1]!)) {
      return [];
    }

    const header: Array<string> = PostmortemNoteActionItems.toCells(
      lines[0]!,
    ).map((cell: string): string => {
      return PostmortemNoteActionItems.toWords(cell);
    });

    const columnOf: (words: ReadonlyArray<string>) => number = (
      words: ReadonlyArray<string>,
    ): number => {
      return header.findIndex((cell: string): boolean => {
        return words.includes(cell);
      });
    };

    const actionColumn: number = Math.max(columnOf(ACTION_COLUMN_WORDS), 0);
    const ownerColumn: number = columnOf(OWNER_COLUMN_WORDS);
    const dueColumn: number = columnOf(DUE_COLUMN_WORDS);
    const statusColumn: number = columnOf(STATUS_COLUMN_WORDS);

    const items: Array<PostmortemNoteActionItem> = [];

    for (const row of lines.slice(2)) {
      const cells: Array<string> = PostmortemNoteActionItems.toCells(row);

      const status: string =
        statusColumn >= 0
          ? PostmortemNoteActionItems.toWords(cells[statusColumn] || "") ||
            (cells[statusColumn] || "").trim()
          : "";

      const item: PostmortemNoteActionItem | null =
        PostmortemNoteActionItems.toItem({
          text: cells[actionColumn] || "",
          isChecked: DONE_STATUS_WORDS.includes(status),
          ownerText: ownerColumn >= 0 ? cells[ownerColumn] : undefined,
          dueText: dueColumn >= 0 ? cells[dueColumn] : undefined,
        });

      if (item) {
        items.push(item);
      }
    }

    return items;
  }

  private static toCells(row: string): Array<string> {
    let trimmed: string = row.trim();

    if (trimmed.startsWith("|")) {
      trimmed = trimmed.slice(1);
    }

    if (trimmed.endsWith("|") && !trimmed.endsWith("\\|")) {
      trimmed = trimmed.slice(0, -1);
    }

    return trimmed.split(/(?<!\\)\|/).map((cell: string): string => {
      return cell.replace(/\\\|/g, "|").trim();
    });
  }

  private static toItem(data: {
    text: string;
    isChecked: boolean;
    ownerText?: string | undefined;
    dueText?: string | undefined;
  }): PostmortemNoteActionItem | null {
    let title: string = PostmortemNoteActionItems.toPlainText(data.text);
    let ownerText: string = PostmortemNoteActionItems.toPlainText(
      data.ownerText || "",
    );
    let dueText: string = data.dueText || "";

    // "Increase the pool (Owner: Ana, due 2026-11-20)": the owner and date go to their own fields.
    const inlineOwner: RegExpMatchArray | null =
      title.match(INLINE_OWNER_REGEX);

    if (inlineOwner && !ownerText) {
      ownerText = inlineOwner[1]!.trim();
      title = title.replace(inlineOwner[0], "").trim();
    }

    const inlineDue: RegExpMatchArray | null = title.match(INLINE_DUE_REGEX);

    if (inlineDue && !dueText) {
      dueText = inlineDue[1]!;
      title = title.replace(inlineDue[0], "").trim();
    }

    title = title
      .replace(/[ \t]*\(\s*\)$/, "")
      .replace(/[ \t,;-]+$/, "")
      .trim();

    if (
      !title ||
      PLACEHOLDER_REGEX.test(title) ||
      EMPTY_ITEM_WORDS.includes(PostmortemNoteActionItems.toWords(title))
    ) {
      return null;
    }

    if (title.length > MAX_ACTION_ITEM_TITLE_LENGTH) {
      title = `${title.slice(0, MAX_ACTION_ITEM_TITLE_LENGTH - 1).trimEnd()}…`;
    }

    const item: PostmortemNoteActionItem = {
      title: title,
      isDone: data.isChecked,
    };

    if (ownerText && !PLACEHOLDER_REGEX.test(ownerText)) {
      item.ownerText = ownerText;
    }

    const dueDay: string | null = PostmortemNoteActionItems.toDay(dueText);

    if (dueDay) {
      item.dueDay = dueDay;
    }

    return item;
  }

  /*
   * A due day as the Due Date picker stores one: the start of that day in
   * the reader's time zone (an IANA name, "Europe/Berlin"). A zone this
   * build does not know reads as UTC. Null for anything that is not a day.
   */
  public static toDueDate(dueDay: string, timezone: string): Date | null {
    const day: string | null = PostmortemNoteActionItems.toDay(dueDay);

    if (!day) {
      return null;
    }

    const zone: string = moment.tz.zone(timezone) ? timezone : "UTC";

    return moment.tz(day, "YYYY-MM-DD", true, zone).toDate();
  }

  /*
   * A date written YYYY-MM-DD, as that day, in Persian or Arabic digits too;
   * anything else, 2026-02-30 too, is no day.
   */
  private static toDay(text: string): string | null {
    const match: RegExpMatchArray | null =
      PostmortemNoteActionItems.toLatinDigits(text).match(ISO_DATE_REGEX);

    if (!match) {
      return null;
    }

    const year: number = Number(match[1]);
    const month: number = Number(match[2]);
    const day: number = Number(match[3]);
    const date: Date = new Date(Date.UTC(year, month - 1, day));

    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return null;
    }

    return `${match[1]}-${match[2]}-${match[3]}`;
  }

  // Persian (۰-۹) and Arabic-Indic (٠-٩) digits as the Latin ones.
  private static toLatinDigits(text: string): string {
    return text.replace(NON_LATIN_DIGIT_REGEX, (digit: string): string => {
      const code: number = digit.charCodeAt(0);

      return String(
        code >= PERSIAN_ZERO ? code - PERSIAN_ZERO : code - ARABIC_INDIC_ZERO,
      );
    });
  }

  /*
   * Markdown's marks taken off: links to their text, emphasis and code to
   * their words. An underscore inside a word stays: "db_pool_wait" is a
   * metric's name, not emphasis.
   */
  private static toPlainText(markdown: string): string {
    return markdown
      .replace(/`([^`]*)`/g, "$1")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/(^|[^\p{L}\p{N}_])__(.+?)__(?![\p{L}\p{N}_])/gu, "$1$2")
      .replace(/\*(\S(?:.*?\S)?)\*/g, "$1")
      .replace(/(^|[^\p{L}\p{N}_])_(\S(?:.*?\S)?)_(?![\p{L}\p{N}_])/gu, "$1$2")
      .replace(/~~(.+?)~~/g, "$1")
      .replace(/[ \t]+/g, " ")
      .trim();
  }

  // Lowercased words: punctuation and marks become spaces, and runs of spaces one.
  private static toWords(text: string): string {
    return text
      .normalize("NFC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
      .trim();
  }
}
