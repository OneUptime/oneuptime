/*
 * How a case's header is laid out (SecurityCaseHeader.tsx), kept free of
 * React so the rules are pinned in a plain test.
 *
 * The header sits beside the case's side menu, so how wide it is depends on
 * the menu and the window, not on the window alone: about 480px of card at
 * a 768px window, 680 at 1024, 940 at 1280. So the header is a size
 * container, and its layout follows its own width:
 *
 *   - from WIDE_WIDTH (a laptop's window and wider), a grid: the number and
 *     pills on the left of the first row, the actions at its right, and the
 *     title under them across the whole header - a long title reads in two
 *     lines rather than five in the half the actions used to leave it. Where
 *     even that is not room enough for every button (five, in a long
 *     language), the pills keep CHIPS_MIN_WIDTH and the buttons wrap in
 *     their own place, at the right; the title stays under both;
 *   - below it, the title comes right after the pills and the buttons go
 *     under the title, at the right, on a row of their own;
 *   - below PHONE_WIDTH (a phone, or a narrow window beside the side menu)
 *     the buttons take a line of their own and each grows to fill its row,
 *     as an incident's header's buttons do there, their icons left out so
 *     two share a row and none is cut short.
 *
 * The ⋯ is in the header's top-right corner at every width: at the end of
 * the actions on a wide header, and, below it, in the corner itself, level
 * with the pills - never left alone on a row of its own after the buttons
 * (at a 1024px window four buttons and the ⋯ did not fit one row).
 *
 * In the page the title comes before the actions, as it is read and as a
 * screen reader reads it; the wide grid only places them.
 *
 * The buttons look like an incident's header's (EventStatusPanel): the same
 * height, border, weight and colours, so the two pages read alike - and,
 * unlike the shared Button, a locked one looks locked.
 *
 * Every class is spelled out whole, so Tailwind finds it.
 */

export type SecurityCaseHeaderLayout = "full" | "compact";

// The widths the layout is keyed to, as its classes name them.
export const SECURITY_CASE_HEADER_PHONE_WIDTH: string = "36rem";
/*
 * Wide enough for the pills and four buttons and the ⋯ on one row: a
 * 1280px window beside the side menu (the header is 940px there); at 1200
 * four buttons would wrap beside the pills, so the title and the actions
 * stack instead.
 */
export const SECURITY_CASE_HEADER_WIDE_WIDTH: string = "58rem";
// The least the pills keep beside the actions on a wide header.
export const SECURITY_CASE_HEADER_CHIPS_MIN_WIDTH: string = "12rem";

export const SECURITY_CASE_HEADER_CLASS_NAME: string =
  "relative rounded-xl border border-gray-200 bg-white shadow-sm [container-type:inline-size]";

/*
 * The pills, the title and the actions: a row that wraps, each on a line of
 * its own; from the wide width a grid of the pills and the actions over the
 * title.
 */
export const SECURITY_CASE_HEADER_TOP_ROW_CLASS_NAME: string =
  "flex flex-wrap items-start gap-x-4 gap-y-2 [@container(min-width:58rem)]:grid [@container(min-width:58rem)]:grid-cols-[minmax(12rem,1fr)_auto]";

/*
 * The number and pills: the first line; on a wide header the first row's
 * left, as tall as the buttons beside it so they sit level. Room on the
 * right for the ⋯, which sits in the corner on a phone.
 */
export const SECURITY_CASE_HEADER_CHIPS_CLASS_NAME: string =
  "flex w-full min-w-0 flex-wrap items-center gap-2 pr-12 [@container(min-width:58rem)]:col-start-1 [@container(min-width:58rem)]:row-start-1 [@container(min-width:58rem)]:min-h-9 [@container(min-width:58rem)]:pr-0";

/*
 * The title: a line of its own, the whole width of the header - after the
 * pills, and on a wide header under the pills and the actions both.
 */
export const SECURITY_CASE_HEADER_TITLE_CLASS_NAME: string =
  "min-w-0 basis-full break-words text-xl font-semibold text-gray-900 [@container(min-width:58rem)]:col-span-2 [@container(min-width:58rem)]:row-start-2";

/*
 * On the case's other pages the header is compact, and so is its title: two
 * lines at most, the whole of it on hover and on its Overview.
 */
export const SECURITY_CASE_HEADER_COMPACT_TITLE_CLASS_NAME: string =
  "line-clamp-2";

/*
 * Who has the case, what opened it and when, on the Overview: two to a row
 * on a phone, three from the phone width, and all five in one row once each
 * has room for "Oct 14 2026, 08:48 GMT" - by the header's width, not the
 * window's: at a 1024px window the side menu left five columns too narrow
 * for a name or a date on one line.
 */
export const SECURITY_CASE_HEADER_FACTS_CLASS_NAME: string =
  "grid grid-cols-2 gap-4 border-t border-gray-100 px-4 py-4 sm:px-5 [@container(min-width:36rem)]:grid-cols-3 [@container(min-width:56rem)]:grid-cols-5";

/*
 * The actions - the buttons, and the ⋯ after them: under the title, at the
 * right; on a wide header the first row's right, beside the pills.
 */
export const SECURITY_CASE_HEADER_ACTIONS_CLASS_NAME: string =
  "ml-auto flex w-full max-w-full items-start justify-end gap-2 [@container(min-width:36rem)]:w-auto [@container(min-width:58rem)]:col-start-2 [@container(min-width:58rem)]:row-start-1";

/*
 * The buttons: they wrap among themselves, at the right, when the place they
 * have is too narrow for every one in a row (four buttons in a long language
 * on a laptop's width) - the ⋯ beside them stays where it is.
 */
export const SECURITY_CASE_HEADER_BUTTONS_CLASS_NAME: string =
  "flex min-w-0 max-w-full flex-auto flex-wrap items-center justify-end gap-2";

// The ⋯: the header's top-right corner, and on a wide header the end of the actions.
export const SECURITY_CASE_HEADER_MORE_PLACE_CLASS_NAME: string =
  "absolute right-4 top-3 sm:right-5 [@container(min-width:58rem)]:static [@container(min-width:58rem)]:shrink-0";

export const SECURITY_CASE_HEADER_BUTTON_CLASS_NAME: string =
  "inline-flex h-9 min-w-[7rem] max-w-full flex-auto select-none items-center justify-center gap-2 whitespace-nowrap rounded-md border px-3.5 text-sm font-semibold shadow-sm transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [@container(min-width:36rem)]:max-w-64 [@container(min-width:36rem)]:flex-none";

/*
 * A button's icon, left out on a phone: the label says it, and without the
 * icon two buttons share a row where with it each took a row of its own
 * (a 360px phone drew three rows of one button each on every page). Shown
 * by default and hidden below the phone width, never a bare `hidden` shown
 * again by a variant, which a page's foreign `.hidden` rule would keep
 * hidden at every width (ForeignHiddenRuleGuard).
 */
export const SECURITY_CASE_HEADER_BUTTON_ICON_CLASS_NAME: string =
  "inline-flex [@container(max-width:35.99rem)]:hidden";

// The wrapper a locked button's reason is reached through: laid out as the button is.
export const SECURITY_CASE_HEADER_LOCKED_WRAPPER_CLASS_NAME: string =
  "inline-flex min-w-[7rem] max-w-full flex-auto rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 [@container(min-width:36rem)]:max-w-64 [@container(min-width:36rem)]:flex-none";

export const SECURITY_CASE_HEADER_PRIMARY_BUTTON_CLASS_NAME: string =
  "border-indigo-600 bg-indigo-600 text-white hover:border-indigo-700 hover:bg-indigo-700";

export const SECURITY_CASE_HEADER_NEUTRAL_BUTTON_CLASS_NAME: string =
  "border-gray-300 bg-white text-gray-700 hover:border-gray-400 hover:bg-gray-50 hover:text-gray-900";

export const SECURITY_CASE_HEADER_MORE_TRIGGER_CLASS_NAME: string =
  "inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-gray-300 bg-white text-gray-500 shadow-sm transition-colors duration-150 hover:border-gray-400 hover:bg-gray-50 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

// The header's test ids: the actions keep the ones the case page always had.
export const SECURITY_CASE_HEADER_TEST_IDS: {
  header: string;
  title: string;
  actions: string;
  buttons: string;
  assignToMe: string;
  runPlaybook: string;
  declareIncident: string;
  close: string;
  reopen: string;
  more: string;
  morePlace: string;
  priorityOption: string;
  assignToSomeoneElse: string;
  changeStatus: string;
  edit: string;
  delete: string;
} = {
  header: "security-case-header",
  title: "security-case-title",
  actions: "security-case-actions",
  buttons: "security-case-action-buttons",
  assignToMe: "security-case-assign-to-me",
  runPlaybook: "security-case-run-playbook",
  declareIncident: "security-case-declare-incident",
  close: "security-case-close",
  reopen: "security-case-reopen",
  more: "security-case-more",
  morePlace: "security-case-more-place",
  priorityOption: "security-case-priority-option",
  assignToSomeoneElse: "security-case-assign-to-someone-else",
  changeStatus: "security-case-change-status",
  edit: "security-case-edit",
  delete: "security-case-delete",
};
