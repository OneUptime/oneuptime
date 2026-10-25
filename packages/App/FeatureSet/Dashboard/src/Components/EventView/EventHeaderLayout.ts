/*
 * How the header of an incident, an alert, an episode and a scheduled
 * maintenance event is laid out (EventStatusPanel.tsx), kept free of React
 * so the rules are pinned in a plain test.
 *
 * The header sits beside the record's side menu, so how wide it is depends
 * on the menu and the window together: about 330px of card on a phone, 420
 * at a 768px window, 620 at 1024, 880 at 1280 and 1040 at 1440. So the
 * header is a size container, and everything in it follows the header's own
 * width, never the window's:
 *
 *   - the top row is the record's number and its state, severity and
 *     privacy, then the title on a line of its own across the whole header -
 *     a long title reads in two lines, never cut short or squeezed beside
 *     the buttons;
 *   - the actions sit at the right of the top row, beside the pills,
 *     whenever the header is wide enough for both - how wide that is depends
 *     on the buttons there are and their words in the reader's language, so
 *     the header works it out from them (getEventHeaderActionsBesideWidth)
 *     and picks the container query that matches. Narrower, the buttons take
 *     a row of their own under the title, at the right, and on a phone they
 *     grow to fill it;
 *   - the ⋯ (the other states) is in the header's top-right corner at every
 *     width: at the end of the buttons beside the pills, and in the corner
 *     itself when the buttons are under the title - never left alone on a
 *     row after them;
 *   - under the title, the record's way through its states as one track;
 *   - then what the reader needs at a glance - how long, who is on it, what
 *     it is about - as labelled facts on a grid of two to five columns;
 *   - and last, a band of its own for what the page wants read next: the AI
 *     root cause analysis (or that OneUptime AI is on it), a maintenance
 *     event that missed its start, an episode that could not be refreshed.
 *
 * The header's pieces look like a security case's header's
 * (SecurityCaseHeaderLayout.ts) - the same number chip, title, buttons and
 * facts - so the two read as one product.
 *
 * Every margin, padding and inset that has a side names it by where the
 * line starts and ends (ms-, pe-, end-), not by left and right, so a page
 * drawn right to left mirrors the header whole.
 */

// The header's test ids.
export const EVENT_HEADER_TEST_IDS: {
  header: string;
  top: string;
  chips: string;
  number: string;
  title: string;
  actions: string;
  buttons: string;
  morePlace: string;
  track: string;
  facts: string;
  notice: string;
} = {
  header: "event-header",
  top: "event-header-top",
  chips: "event-header-chips",
  number: "event-header-number",
  title: "event-header-title",
  actions: "event-header-actions",
  buttons: "event-header-buttons",
  morePlace: "event-header-more-place",
  track: "event-state-track",
  facts: "event-status-facts",
  notice: "event-header-notice",
};

/*
 * The card. It is the size container every rule below is read against, and
 * the ⋯'s place is pinned to its corner on a narrow header.
 */
export const EVENT_HEADER_CLASS_NAME: string =
  "relative rounded-xl border border-gray-200 bg-white shadow-sm [container-type:inline-size]";

// The number, the title, the actions and the state track.
export const EVENT_HEADER_TOP_SECTION_CLASS_NAME: string = "px-4 py-4 sm:px-5";

// The record's number: a security case's number chip.
export const EVENT_HEADER_NUMBER_CLASS_NAME: string =
  "inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 font-mono text-xs font-semibold text-gray-700";

/*
 * The title: a line of its own, as wide as the header, whole. A long title
 * wraps between its words, and a word longer than the header (an address)
 * wherever it must.
 */
export const EVENT_HEADER_TITLE_CLASS_NAME: string =
  "min-w-0 basis-full break-words text-xl font-semibold leading-snug text-gray-900 [overflow-wrap:anywhere]";

/*
 * Below this width the header is a phone's, or a narrow window's beside the
 * side menu: the buttons grow to fill their rows. The ⋯ goes to the corner
 * below whatever width the actions need beside the pills.
 */
export const EVENT_HEADER_PHONE_WIDTH_REM: number = 36;

/*
 * The widths the header can switch the actions beside the pills at, in rem,
 * smallest first, every 2rem: a header switches at most 32px later than its
 * buttons need. A header needs at least the first - a single button beside
 * a number and a state - and one that needs more than the last keeps its
 * buttons under the title at every width.
 */
export const EVENT_HEADER_BESIDE_WIDTHS_REM: ReadonlyArray<number> = [
  20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50, 52, 54, 56,
  58, 60, 62, 64, 66, 68, 70, 72, 74, 76, 78, 80,
];

/*
 * The classes of one width: each class, behind a container query for that
 * width - "[@container(min-width:44rem)]:grid".
 */
export function atContainerWidth(widthRem: number, classes: string): string {
  return classes
    .split(" ")
    .filter((className: string): boolean => {
      return className.length > 0;
    })
    .map((className: string): string => {
      return `[@container(min-width:${widthRem}rem)]:${className}`;
    })
    .join(" ");
}

export interface EventHeaderTopRowClassNames {
  // The number and pills, the title and the actions.
  row: string;
  chips: string;
  title: string;
  actions: string;
  // The ⋯'s place.
  morePlace: string;
}

/*
 * The top row, for the width the actions need beside the pills (or null:
 * never). Narrower than that, it wraps: the pills, the title on a line of
 * its own, then the actions on theirs, at the right, the ⋯ in the corner -
 * where the pills keep room for it. From that width it is a grid: the pills
 * and the actions on the first row, the title under both.
 */
export function getEventHeaderTopRowClassNames(data: {
  besideWidthRem: number | null;
  hasMore: boolean;
}): EventHeaderTopRowClassNames {
  const width: number | null = data.besideWidthRem;
  const beside: (classes: string) => string = (classes: string): string => {
    return width === null ? "" : atContainerWidth(width, classes);
  };
  const join: (...classNames: Array<string>) => string = (
    ...classNames: Array<string>
  ): string => {
    return classNames
      .filter((className: string): boolean => {
        return className.length > 0;
      })
      .join(" ");
  };

  return {
    row: join(
      "flex flex-wrap items-start gap-x-4 gap-y-2",
      beside("grid grid-cols-[minmax(0,1fr)_auto]"),
    ),
    chips: join(
      "flex w-full min-w-0 flex-wrap items-center gap-2",
      /*
       * As tall as the ⋯ in the corner, or the buttons beside the pills,
       * so they sit level with it; with neither, as tall as the pills.
       */
      data.hasMore ? "min-h-9 pe-11" : "",
      beside("col-start-1 row-start-1 min-h-9 pe-0"),
    ),
    title: join(
      EVENT_HEADER_TITLE_CLASS_NAME,
      beside("col-span-2 row-start-2"),
    ),
    actions: join(
      "ms-auto flex w-full max-w-full items-start justify-end gap-2",
      beside("col-start-2 row-start-1 w-auto"),
    ),
    morePlace: join("absolute end-4 top-4 sm:end-5", beside("static shrink-0")),
  };
}

/*
 * The buttons: they wrap among themselves, at the right, when the room they
 * have is too narrow for all of them in a row; the ⋯ beside them stays put.
 */
export const EVENT_HEADER_BUTTONS_CLASS_NAME: string =
  "flex min-w-0 max-w-full flex-auto flex-wrap items-center justify-end gap-2";

/*
 * A button: as tall as a security case's, its main move in indigo. On a
 * phone's width it grows from its own width (flex-auto), so two that do not
 * both fit wrap onto rows of their own instead of each being cut to half a
 * row; wider, it keeps its own width, at most 20rem - room for the longest
 * of the header's own words in every language ("Отметить как
 * «Запланировано»", "علامت‌گذاری به‌عنوان زمان‌بندی‌شده"), so only a
 * project's own, longer state name is ever cut.
 */
export const EVENT_HEADER_BUTTON_CLASS_NAME: string = `inline-flex h-9 min-w-[7rem] max-w-full flex-auto select-none items-center justify-center gap-2 whitespace-nowrap rounded-md border px-3.5 text-sm font-semibold shadow-sm transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${atContainerWidth(
  EVENT_HEADER_PHONE_WIDTH_REM,
  "max-w-80 flex-none",
)}`;

// The wrapper a locked button's reason is reached through: laid out as the button is.
export const EVENT_HEADER_LOCKED_WRAPPER_CLASS_NAME: string = `inline-flex min-w-[7rem] max-w-full flex-auto rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${atContainerWidth(
  EVENT_HEADER_PHONE_WIDTH_REM,
  "max-w-80 flex-none",
)}`;

// A menu button's own wrapper (Open channel): laid out as a button is.
export const EVENT_HEADER_MENU_WRAPPER_CLASS_NAME: string = `flex min-w-[7rem] max-w-full flex-auto [&>div]:w-full ${atContainerWidth(
  EVENT_HEADER_PHONE_WIDTH_REM,
  "max-w-80 flex-none",
)}`;

export const EVENT_HEADER_PRIMARY_BUTTON_CLASS_NAME: string =
  "border-indigo-600 bg-indigo-600 text-white hover:border-indigo-700 hover:bg-indigo-700";

export const EVENT_HEADER_NEUTRAL_BUTTON_CLASS_NAME: string =
  "border-gray-300 bg-white text-gray-700 hover:border-gray-400 hover:bg-gray-50 hover:text-gray-900";

export const EVENT_HEADER_MORE_TRIGGER_CLASS_NAME: string =
  "inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-gray-300 bg-white text-gray-500 shadow-sm transition-colors duration-150 hover:border-gray-400 hover:bg-gray-50 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

/*
 * What the reader needs at a glance, as labelled facts on a grid that
 * follows the header's width: up to two columns on a phone, three beside
 * the side menu at 1024px, four from 50rem and five on a wide screen - in
 * as few rows as that allows, shared out evenly (getEventHeaderFactColumns):
 * four facts where three would fit are two rows of two, never three and one
 * left alone, and four on a wide screen share its width rather than leave a
 * column empty.
 */
export const EVENT_HEADER_FACT_COLUMN_STEPS: ReadonlyArray<{
  columns: number;
  widthRem: number;
}> = [
  { columns: 2, widthRem: 18 },
  { columns: 3, widthRem: 34 },
  { columns: 4, widthRem: 50 },
  { columns: 5, widthRem: 64 },
];

/*
 * Each fact is two rows of the grid - its label's, then its value's - and
 * lays its label and value on them (a subgrid), so the facts side by side
 * share their rows: a label that wraps ("INCIDENT COMMANDER" on a phone,
 * "VORFALL-KOMMANDANT") makes its row taller for all of them, every value
 * of the row starts on the same line, and every label sits right above its
 * value. The space between the rows of facts is the values' own (pb-4), so
 * the grid has no row gap and no bottom padding of its own.
 */
const EVENT_HEADER_FACTS_BASE_CLASS_NAME: string =
  "grid grid-cols-1 gap-x-6 border-t border-gray-100 px-4 pt-4 sm:px-5";

/*
 * The columns `count` facts take where at most `allowed` fit: the fewest
 * rows that width allows, the facts shared out evenly between them.
 */
export function getEventHeaderFactColumns(
  count: number,
  allowed: number,
): number {
  const most: number = Math.max(1, Math.min(count, allowed));
  const rows: number = Math.ceil(Math.max(1, count) / most);

  return Math.max(1, Math.ceil(count / rows));
}

export function getEventHeaderFactsClassName(factCount: number): string {
  const classNames: Array<string> = [EVENT_HEADER_FACTS_BASE_CLASS_NAME];
  let columnsBefore: number = 1;

  for (const step of EVENT_HEADER_FACT_COLUMN_STEPS) {
    const columns: number = getEventHeaderFactColumns(factCount, step.columns);

    // A width that changes nothing adds no rule.
    if (columns !== columnsBefore) {
      classNames.push(atContainerWidth(step.widthRem, `grid-cols-${columns}`));
      columnsBefore = columns;
    }
  }

  return classNames.join(" ");
}

/*
 * A fact: its label over its value, as a security case's facts and the stat
 * tiles say theirs - on the two rows of the facts' grid it spans.
 */
export const EVENT_HEADER_FACT_CLASS_NAME: string =
  "row-span-2 grid min-w-0 grid-rows-subgrid";

/*
 * The label, at the foot of its row: right above its value whether or not
 * the label beside it wraps. Its icon keeps to the first line of a label
 * that wraps.
 */
export const EVENT_HEADER_FACT_LABEL_CLASS_NAME: string =
  "flex items-start gap-1.5 self-end pb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500";

export const EVENT_HEADER_FACT_LABEL_ICON_CLASS_NAME: string =
  "mt-px h-3.5 w-3.5 flex-shrink-0 text-gray-400";

// The value, and under it the space before the next row of facts.
export const EVENT_HEADER_FACT_VALUE_CLASS_NAME: string =
  "min-w-0 break-words pb-4 text-sm font-medium text-gray-900";

/*
 * The band at the foot of the header, by what it says: OneUptime AI's
 * (indigo), a warning (amber), a failure (red), or plain. A band, not a box:
 * it runs from edge to edge under a hairline, its corners the card's own.
 */
export type EventHeaderNoticeTone = "ai" | "warning" | "danger" | "neutral";

const NOTICE_BAND_CLASS_NAME: string =
  "rounded-b-[11px] border-t px-4 py-3.5 sm:px-5";

export const EVENT_HEADER_NOTICE_CLASS_NAMES: Record<
  EventHeaderNoticeTone,
  string
> = {
  ai: `${NOTICE_BAND_CLASS_NAME} border-indigo-100 bg-indigo-50/60`,
  warning: `${NOTICE_BAND_CLASS_NAME} border-amber-200 bg-amber-50/70`,
  danger: `${NOTICE_BAND_CLASS_NAME} border-red-100 bg-red-50/60`,
  neutral: `${NOTICE_BAND_CLASS_NAME} border-gray-100`,
};

/*
 * ---------------------------------------------------------------------------
 * How wide the header must be for the actions to sit beside the pills
 * ---------------------------------------------------------------------------
 * Worked out from what the header holds and how the reader's language spells
 * it, rather than measured, so the layout is decided before the header is
 * drawn and never jumps. Every figure leans wide - a header the estimate
 * overrates puts its buttons under the title a little early, one it
 * underrates would wrap them beside the pills - and was taken from the
 * header as Chromium draws it in Inter (14px semibold buttons, 13px pills,
 * a 12px monospace number).
 */

export interface EventHeaderActionWidthInput {
  label: string;
  hasIcon: boolean;
  // A menu's button (Open channel) adds its chevron.
  hasMenu?: boolean | undefined;
}

export interface EventHeaderWidthInput {
  // "#1042", "INC-42".
  identifier?: string | undefined;
  // The pills' words: the state, the severity, Private.
  pills: Array<string>;
  // Whether one of the pills shows an icon in its dot's place (Private).
  hasPillIcon?: boolean | undefined;
  actions: Array<EventHeaderActionWidthInput>;
  hasMore: boolean;
}

/*
 * A mark drawn over or under the letter before it (a Devanagari virama, an
 * Arabic vowel sign) and an invisible joiner (Persian's zero-width
 * non-joiner) take no width of their own.
 */
const ZERO_WIDTH_CHARACTER: RegExp = /[\p{Mn}\p{Me}\p{Cf}]/u;
const WIDE_CHARACTER: RegExp =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff00-\uffef]/u;
const ARABIC_SCRIPT_CHARACTER: RegExp = /[\p{Script=Arabic}\p{Script=Hebrew}]/u;
const CYRILLIC_SCRIPT_CHARACTER: RegExp =
  /[\p{Script=Cyrillic}\p{Script=Greek}]/u;
const DEVANAGARI_CHARACTER: RegExp = /\p{Script=Devanagari}/u;
const SPACE_CHARACTER: RegExp = /\s/u;

/*
 * A text's width in ems, by script, each a little wider than the script's
 * letters are drawn on average, so a long label never comes out short: a
 * CJK character is a whole em; an Arabic or Persian letter 0.75 (its shapes
 * vary more than Latin's); a Cyrillic one 0.68; a Devanagari letter 0.6; a
 * space about a third; a mark or a joiner nothing; and anything else - a
 * Latin letter, a digit - 0.65.
 */
export function estimateTextWidthEm(text: string): number {
  let width: number = 0;

  for (const character of Array.from(text)) {
    if (ZERO_WIDTH_CHARACTER.test(character)) {
      continue;
    }

    if (WIDE_CHARACTER.test(character)) {
      width += 1.05;
    } else if (ARABIC_SCRIPT_CHARACTER.test(character)) {
      width += 0.75;
    } else if (CYRILLIC_SCRIPT_CHARACTER.test(character)) {
      width += 0.68;
    } else if (DEVANAGARI_CHARACTER.test(character)) {
      width += 0.6;
    } else if (SPACE_CHARACTER.test(character)) {
      width += 0.32;
    } else {
      width += 0.65;
    }
  }

  return width;
}

const BUTTON_FONT_SIZE_PX: number = 14;
// px-3.5 on each side and the 1px border.
const BUTTON_PADDING_PX: number = 30;
// The icon and the gap after it.
const BUTTON_ICON_PX: number = 24;
// A menu's chevron and the gap before it.
const BUTTON_MENU_CHEVRON_PX: number = 22;
const BUTTON_MIN_WIDTH_PX: number = 112;
const BUTTON_MAX_WIDTH_PX: number = 320;
const MORE_BUTTON_WIDTH_PX: number = 36;
const GAP_PX: number = 8;
const ROW_GAP_PX: number = 16;
const PILL_FONT_SIZE_PX: number = 13;
// The dot (or icon), the gap after it and the pill's padding.
const PILL_EXTRAS_PX: number = 28;
const PILL_ICON_EXTRA_PX: number = 5;
const NUMBER_CHARACTER_PX: number = 7.8;
const NUMBER_PADDING_PX: number = 16;
// The header's own padding (sm:px-5) and a margin for rounding.
const HEADER_PADDING_PX: number = 40;
const SAFETY_MARGIN_PX: number = 16;
const PX_PER_REM: number = 16;

export function estimateEventHeaderButtonWidthPx(
  action: EventHeaderActionWidthInput,
): number {
  const width: number =
    estimateTextWidthEm(action.label) * BUTTON_FONT_SIZE_PX +
    BUTTON_PADDING_PX +
    (action.hasIcon ? BUTTON_ICON_PX : 0) +
    (action.hasMenu ? BUTTON_MENU_CHEVRON_PX : 0);

  return Math.min(BUTTON_MAX_WIDTH_PX, Math.max(BUTTON_MIN_WIDTH_PX, width));
}

export function estimateEventHeaderChipsWidthPx(
  input: Pick<EventHeaderWidthInput, "identifier" | "pills" | "hasPillIcon">,
): number {
  const pieces: Array<number> = [];

  if (input.identifier) {
    pieces.push(
      Array.from(input.identifier).length * NUMBER_CHARACTER_PX +
        NUMBER_PADDING_PX,
    );
  }

  for (const pill of input.pills) {
    pieces.push(estimateTextWidthEm(pill) * PILL_FONT_SIZE_PX + PILL_EXTRAS_PX);
  }

  if (input.hasPillIcon) {
    pieces.push(PILL_ICON_EXTRA_PX);
  }

  return (
    pieces.reduce((sum: number, piece: number): number => {
      return sum + piece;
    }, 0) +
    Math.max(0, pieces.length - 1) * GAP_PX
  );
}

export function estimateEventHeaderActionsWidthPx(
  input: Pick<EventHeaderWidthInput, "actions" | "hasMore">,
): number {
  const widths: Array<number> = input.actions.map(
    (action: EventHeaderActionWidthInput): number => {
      return estimateEventHeaderButtonWidthPx(action);
    },
  );

  if (input.hasMore) {
    widths.push(MORE_BUTTON_WIDTH_PX);
  }

  return (
    widths.reduce((sum: number, width: number): number => {
      return sum + width;
    }, 0) +
    Math.max(0, widths.length - 1) * GAP_PX
  );
}

/*
 * The header width, in rem, from which the actions sit beside the pills:
 * the smallest of EVENT_HEADER_BESIDE_WIDTHS_REM that holds the pills, the
 * buttons and the ⋯ on one row - or null when even the widest does not, and
 * the buttons stay under the title. A header with no actions has nothing to
 * place: null.
 */
export function getEventHeaderActionsBesideWidth(
  input: EventHeaderWidthInput,
): number | null {
  if (input.actions.length === 0 && !input.hasMore) {
    return null;
  }

  const neededPx: number =
    estimateEventHeaderChipsWidthPx(input) +
    ROW_GAP_PX +
    estimateEventHeaderActionsWidthPx(input) +
    HEADER_PADDING_PX +
    SAFETY_MARGIN_PX;

  for (const widthRem of EVENT_HEADER_BESIDE_WIDTHS_REM) {
    if (widthRem * PX_PER_REM >= neededPx) {
      return widthRem;
    }
  }

  return null;
}
