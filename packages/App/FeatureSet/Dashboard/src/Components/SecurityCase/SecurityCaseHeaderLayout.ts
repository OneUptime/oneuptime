/*
 * How a case's header is laid out (SecurityCaseHeader.tsx), kept free of
 * React so the rules are pinned in a plain test.
 *
 * The header sits beside the case's side menu, so how wide it is depends on
 * the menu and the window, not on the window alone: about 430px of card at
 * a 768px window, 940 at 1280. So:
 *
 *   - the actions sit on the title's line, at the right, whenever both fit
 *     there with the title keeping at least TITLE_MIN_WIDTH, and wrap under
 *     it, still at the right, when they do not (a flex row that wraps: the
 *     title's block grows from that width, the actions keep theirs);
 *   - the header is a size container, and below PHONE_WIDTH (a phone, or a
 *     narrow window beside the side menu) its buttons take a line of their
 *     own and each grows to fill its row, as an incident's header's buttons
 *     do there, their icons left out so two share a row and none is cut
 *     short - and the ⋯ moves
 *     to the header's top-right corner, where it is on a wide header too,
 *     instead of being left alone on a row of its own after them.
 *
 * The buttons look like an incident's header's (EventStatusPanel): the same
 * height, border, weight and colours, so the two pages read alike - and,
 * unlike the shared Button, a locked one looks locked.
 *
 * Every class is spelled out whole, so Tailwind finds it.
 */

export type SecurityCaseHeaderLayout = "full" | "compact";

// The widths the layout is keyed to, as its classes name them.
export const SECURITY_CASE_HEADER_TITLE_MIN_WIDTH: string = "16rem";
export const SECURITY_CASE_HEADER_PHONE_WIDTH: string = "36rem";

export const SECURITY_CASE_HEADER_CLASS_NAME: string =
  "relative rounded-xl border border-gray-200 bg-white shadow-sm [container-type:inline-size]";

export const SECURITY_CASE_HEADER_TOP_ROW_CLASS_NAME: string =
  "flex flex-wrap items-start gap-x-4 gap-y-3";

// The title's block: at least TITLE_MIN_WIDTH, growing into what the actions leave.
export const SECURITY_CASE_HEADER_TITLE_BLOCK_CLASS_NAME: string =
  "min-w-0 flex-[1_1_16rem]";

// Room on the right for the ⋯, which sits in the corner on a phone.
export const SECURITY_CASE_HEADER_CHIPS_CLASS_NAME: string =
  "flex flex-wrap items-center gap-2 pr-12 [@container(min-width:36rem)]:pr-0";

export const SECURITY_CASE_HEADER_ACTIONS_CLASS_NAME: string =
  "ml-auto flex w-full max-w-full flex-wrap items-center justify-end gap-2 [@container(min-width:36rem)]:w-auto";

export const SECURITY_CASE_HEADER_MORE_PLACE_CLASS_NAME: string =
  "absolute right-4 top-3 sm:right-5 [@container(min-width:36rem)]:static";

export const SECURITY_CASE_HEADER_BUTTON_CLASS_NAME: string =
  "inline-flex h-9 min-w-[7rem] max-w-full flex-auto select-none items-center justify-center gap-2 whitespace-nowrap rounded-md border px-3.5 text-sm font-semibold shadow-sm transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [@container(min-width:36rem)]:max-w-64 [@container(min-width:36rem)]:flex-none";

/*
 * A button's icon, left out on a phone: the label says it, and without the
 * icon two buttons share a row where with it each took a row of its own
 * (a 360px phone drew three rows of one button each on every page).
 */
export const SECURITY_CASE_HEADER_BUTTON_ICON_CLASS_NAME: string =
  "hidden [@container(min-width:36rem)]:inline-flex";

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
  assignToMe: string;
  runPlaybook: string;
  declareIncident: string;
  close: string;
  reopen: string;
  more: string;
  morePlace: string;
  priorityOption: string;
  edit: string;
  delete: string;
} = {
  header: "security-case-header",
  title: "security-case-title",
  actions: "security-case-actions",
  assignToMe: "security-case-assign-to-me",
  runPlaybook: "security-case-run-playbook",
  declareIncident: "security-case-declare-incident",
  close: "security-case-close",
  reopen: "security-case-reopen",
  more: "security-case-more",
  morePlace: "security-case-more-place",
  priorityOption: "security-case-priority-option",
  edit: "security-case-edit",
  delete: "security-case-delete",
};
