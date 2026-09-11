import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  forwardRef,
} from "react";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";

/*
 * The player's visual vocabulary, in one file.
 *
 * Before this existed, every surface of the replay UI invented its own
 * chip: the header had ACTION_BUTTON_CLASS, the controls row had
 * SMALL_BUTTON_CLASS, the rail had a third variant inline, the stage's
 * fit toggle a fourth. They differed in height (h-8 vs py-0.5), in
 * radius (rounded-md vs rounded), in how "on" was drawn (indigo tint vs
 * gray fill vs nothing) and in whether they carried a ring. Twenty of
 * them in a row is what made the player look assembled rather than
 * designed.
 *
 * Everything here is presentational and stateless. The rules it encodes:
 *
 *  - ONE control height (h-8) and ONE radius (rounded-lg) for every
 *    button a viewer can press in the player chrome.
 *  - Related controls sit in a ReplayButtonGroup - a recessed gray track
 *    where the pressed member is a raised white thumb. That replaces the
 *    old habit of ringing every button individually, which is what
 *    produced the wall of outlines.
 *  - Standalone buttons are ghosts: no border at rest, a gray wash on
 *    hover. Colour is reserved for meaning (rose = error, amber =
 *    frustration, indigo = the one primary action), never for chrome.
 *  - Tone maps to a fixed pair of classes, so "the error buttons" look
 *    the same in the transport row, the rail and the timeline legend.
 */

export type ReplayTone =
  | "neutral"
  | "accent"
  | "danger"
  | "warning"
  | "success"
  | "live";

/* The player's card: used by the shell, the rail and the detail sheets. */
export const REPLAY_SURFACE_CLASS: string =
  "rounded-xl border border-gray-200 bg-white shadow-sm";

/* Every pressable control in the player chrome is this tall. */
export const REPLAY_CONTROL_HEIGHT_CLASS: string = "h-8";

const BUTTON_BASE_CLASS: string = [
  "inline-flex",
  REPLAY_CONTROL_HEIGHT_CLASS,
  "shrink-0 items-center justify-center gap-1.5 rounded-lg text-xs font-medium",
  "transition-colors duration-100 focus:outline-none",
  "focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1",
].join(" ");

const GHOST_TONE_CLASS: Record<ReplayTone, string> = {
  neutral: "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
  accent: "text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700",
  danger: "text-rose-600 hover:bg-rose-50 hover:text-rose-700",
  warning: "text-amber-600 hover:bg-amber-50 hover:text-amber-700",
  success: "text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700",
  live: "text-red-600 hover:bg-red-50 hover:text-red-700",
};

/*
 * "On" for a standalone ghost: a solid fill, so a pressed view
 * preference (Wide, Theater, Skip idle) is unmistakable next to the
 * ghosts that are merely hoverable.
 */
const GHOST_PRESSED_TONE_CLASS: Record<ReplayTone, string> = {
  neutral: "bg-gray-900 text-white hover:bg-gray-800",
  accent: "bg-indigo-600 text-white hover:bg-indigo-700",
  danger: "bg-rose-600 text-white hover:bg-rose-700",
  warning: "bg-amber-500 text-white hover:bg-amber-600",
  success: "bg-emerald-600 text-white hover:bg-emerald-700",
  live: "bg-red-600 text-white hover:bg-red-700",
};

const DISABLED_CLASS: string = "cursor-not-allowed text-gray-300";

/*
 * Inside a group the track already supplies the container, so a member
 * only ever draws its own selected thumb.
 */
const SEGMENT_IDLE_CLASS: string =
  "text-gray-600 hover:bg-white/70 hover:text-gray-900";
const SEGMENT_SELECTED_TONE_CLASS: Record<ReplayTone, string> = {
  neutral: "bg-white text-gray-900 shadow-sm ring-1 ring-inset ring-black/5",
  accent: "bg-white text-indigo-700 shadow-sm ring-1 ring-inset ring-black/5",
  danger: "bg-white text-rose-700 shadow-sm ring-1 ring-inset ring-black/5",
  warning: "bg-white text-amber-700 shadow-sm ring-1 ring-inset ring-black/5",
  success: "bg-white text-emerald-700 shadow-sm ring-1 ring-inset ring-black/5",
  live: "bg-white text-red-700 shadow-sm ring-1 ring-inset ring-black/5",
};

export interface ReplaySegmentClassOptions {
  isSelected: boolean;
  isDisabled?: boolean | undefined;
  tone?: ReplayTone | undefined;
  /*
   * "compact" trims the side padding. The rail is 480px wide and carries
   * five tabs with a count on each; at the default padding that row wraps
   * to two lines and the recessed track grows a second row of its own,
   * which costs more vertical space in the rail than the tabs are worth.
   */
  size?: "default" | "compact" | undefined;
}

/*
 * The segment look without the button.
 *
 * ReplayToolButton renders role="button" with aria-pressed, which is
 * right for a toggle and WRONG for the two places that only look like
 * segments: the header's browser-tab pills and the rail's signal tabs
 * are real tabs (role="tab", aria-selected, roving tabindex, arrow-key
 * navigation). They take the classes and keep their own semantics -
 * which is the whole reason the styling is exported separately rather
 * than the components being forced through one element.
 */
export function getReplaySegmentClassName(
  options: ReplaySegmentClassOptions,
): string {
  const tone: ReplayTone = options.tone || "neutral";

  const stateClass: string = options.isDisabled
    ? DISABLED_CLASS
    : options.isSelected
      ? SEGMENT_SELECTED_TONE_CLASS[tone]
      : SEGMENT_IDLE_CLASS;

  const paddingClass: string = options.size === "compact" ? "px-2" : "px-2.5";

  return `${BUTTON_BASE_CLASS} ${paddingClass} ${stateClass}`;
}

export type ReplayToolButtonVariant = "ghost" | "segment";

export interface ReplayToolButtonProps {
  /*
   * The visible label. Omitted for icon-only buttons, which then MUST
   * supply title or ariaLabel - an icon button with no accessible name
   * is the single most common a11y defect in a toolbar.
   */
  label?: string | undefined;
  icon?: IconProp | undefined;
  /* Drawn after the label rather than before it (the "10s >" button). */
  trailingIcon?: IconProp | undefined;
  variant?: ReplayToolButtonVariant | undefined;
  tone?: ReplayTone | undefined;
  /* Renders aria-pressed and the "on" styling. Undefined = not a toggle. */
  isPressed?: boolean | undefined;
  isDisabled?: boolean | undefined;
  title?: string | undefined;
  ariaLabel?: string | undefined;
  dataTestId?: string | undefined;
  className?: string | undefined;
  onClick: () => void;
  /*
   * aria-haspopup, for the menu triggers. `true` (rendered "true") is the
   * generic "opens a menu" the speed trigger wants; a trigger whose panel
   * is not role="menu" must say what it does open - the sessions switcher
   * opens a listbox, and a screen reader promised a menu would then meet
   * options where it expected menu items.
   */
  hasPopup?: boolean | "listbox" | "menu" | "dialog" | undefined;
  isExpanded?: boolean | undefined;
  /*
   * data-* hooks for tests and styling ("data-truncated" on the sessions
   * trigger). Only data-*: everything aria has a named prop above.
   */
  dataAttributes?: Record<`data-${string}`, string> | undefined;
}

function toneClassFor(props: ReplayToolButtonProps): string {
  const tone: ReplayTone = props.tone || "neutral";

  if (props.isDisabled) {
    return DISABLED_CLASS;
  }

  if (props.variant === "segment") {
    return props.isPressed
      ? SEGMENT_SELECTED_TONE_CLASS[tone]
      : SEGMENT_IDLE_CLASS;
  }

  return props.isPressed
    ? GHOST_PRESSED_TONE_CLASS[tone]
    : GHOST_TONE_CLASS[tone];
}

/*
 * The one button of the player chrome. forwardRef because the speed
 * trigger has to take focus back when its menu closes.
 */
export const ReplayToolButton: React.ForwardRefExoticComponent<
  ReplayToolButtonProps & React.RefAttributes<HTMLButtonElement>
> = forwardRef<HTMLButtonElement, ReplayToolButtonProps>(
  (
    props: ReplayToolButtonProps,
    ref: React.ForwardedRef<HTMLButtonElement>,
  ): ReactElement => {
    /*
     * A single icon with no label gets a square button; anything wider -
     * a label, or the two-glyph "< !" previous-error button - gets side
     * padding instead, so nothing is ever clipped by the 32px box.
     */
    const isSingleGlyph: boolean =
      !props.label && !(props.icon && props.trailingIcon);
    const paddingClass: string = isSingleGlyph ? "w-8" : "px-2.5";

    const pressedProps: Record<string, boolean> =
      props.isPressed === undefined ? {} : { "aria-pressed": props.isPressed };

    /*
     * A VISIBLE label is the accessible name; the title is only a
     * tooltip. Falling back to the title whenever ariaLabel was absent
     * renamed "Fit" to "Scale the picture to fit the stage", which
     * breaks WCAG 2.5.3 (Label in Name) and every voice command for the
     * word on the button. The title only becomes the name where there
     * is no visible text at all - an icon-only button - and an explicit
     * ariaLabel always wins, which is how "10s" says "Back 10 seconds".
     */
    const accessibleName: string | undefined =
      props.ariaLabel || (props.label ? undefined : props.title);

    return (
      <button
        ref={ref}
        type="button"
        disabled={props.isDisabled}
        title={props.title}
        aria-label={accessibleName}
        aria-haspopup={props.hasPopup}
        aria-expanded={props.isExpanded}
        data-testid={props.dataTestId}
        {...props.dataAttributes}
        className={`${BUTTON_BASE_CLASS} ${paddingClass} ${toneClassFor(
          props,
        )} ${props.className || ""}`}
        onClick={props.onClick}
        {...pressedProps}
      >
        {props.icon && <Icon icon={props.icon} className="h-3.5 w-3.5" />}
        {props.label && <span>{props.label}</span>}
        {props.trailingIcon && (
          <Icon icon={props.trailingIcon} className="h-3.5 w-3.5" />
        )}
      </button>
    );
  },
);

ReplayToolButton.displayName = "ReplayToolButton";

export interface ReplayButtonGroupProps {
  children: ReactNode;
  /* role="group" by default; the fit and scope toggles pass a label. */
  ariaLabel?: string | undefined;
  role?: string | undefined;
  dataTestId?: string | undefined;
  className?: string | undefined;
}

/*
 * The recessed track. One container for N buttons instead of N rings,
 * which is the difference between a toolbar and a pile of chips.
 */
export const ReplayButtonGroup: FunctionComponent<ReplayButtonGroupProps> = (
  props: ReplayButtonGroupProps,
): ReactElement => {
  return (
    <div
      role={props.role || "group"}
      aria-label={props.ariaLabel}
      data-testid={props.dataTestId}
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-xl bg-gray-100 p-0.5 ${
        props.className || ""
      }`}
    >
      {props.children}
    </div>
  );
};

/* A hairline between toolbar sections. Decorative, never announced. */
export const ReplayToolbarDivider: FunctionComponent = (): ReactElement => {
  return (
    <span
      aria-hidden="true"
      data-testid="replay-toolbar-divider"
      className="h-5 w-px shrink-0 bg-gray-200"
    />
  );
};

const PILL_TONE_CLASS: Record<ReplayTone, string> = {
  neutral: "bg-gray-100 text-gray-700",
  accent: "bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-100",
  danger: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-100",
  warning: "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-100",
  success: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-100",
  live: "bg-red-50 text-red-700 ring-1 ring-inset ring-red-100",
};

const PULSE_DOT_TONE_CLASS: Record<ReplayTone, string> = {
  neutral: "bg-gray-400",
  accent: "bg-indigo-500",
  danger: "bg-rose-500",
  warning: "bg-amber-500",
  success: "bg-emerald-500",
  live: "bg-red-500",
};

export interface ReplayPillProps {
  children: ReactNode;
  tone?: ReplayTone | undefined;
  icon?: IconProp | undefined;
  /* A pulsing dot instead of an icon: Live, buffering. */
  hasPulse?: boolean | undefined;
  title?: string | undefined;
  role?: string | undefined;
  dataTestId?: string | undefined;
  className?: string | undefined;
  isHiddenFromScreenReaders?: boolean | undefined;
}

/* Status, never an action: the same shape wherever the player says a word. */
export const ReplayPill: FunctionComponent<ReplayPillProps> = (
  props: ReplayPillProps,
): ReactElement => {
  const tone: ReplayTone = props.tone || "neutral";

  return (
    <span
      role={props.role}
      title={props.title}
      data-testid={props.dataTestId}
      aria-hidden={props.isHiddenFromScreenReaders ? "true" : undefined}
      className={`inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
        PILL_TONE_CLASS[tone]
      } ${props.className || ""}`}
    >
      {props.hasPulse && (
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 shrink-0 animate-pulse rounded-full ${PULSE_DOT_TONE_CLASS[tone]}`}
        />
      )}
      {props.icon && <Icon icon={props.icon} className="h-3 w-3 shrink-0" />}
      <span className="truncate">{props.children}</span>
    </span>
  );
};

export interface ReplaySwitchProps {
  isChecked: boolean;
  label: string;
  title?: string | undefined;
  dataTestId?: string | undefined;
  onChange: (isChecked: boolean) => void;
}

/*
 * A switch scaled for a transport row.
 *
 * Common/UI's Toggle is 24px tall with a text-sm label beside it; parked
 * between 32px chips carrying 12px text it was the single loudest thing
 * in the controls row and set the row's height by itself. This keeps the
 * switch semantics that matter (role, aria-checked, one click = one
 * change) at the chrome's own scale.
 */
export const ReplaySwitch: FunctionComponent<ReplaySwitchProps> = (
  props: ReplaySwitchProps,
): ReactElement => {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.isChecked ? "true" : "false"}
      title={props.title}
      data-testid={props.dataTestId}
      className={`${BUTTON_BASE_CLASS} gap-2 px-2.5 ${
        props.isChecked
          ? "text-gray-900"
          : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"
      }`}
      onClick={(): void => {
        props.onChange(!props.isChecked);
      }}
    >
      {/*
       * The thumb is an in-flow flex item, not an absolutely positioned
       * one: with `absolute` and no `left`, it lands on its STATIC
       * position - which in an otherwise empty track is the end of the
       * line box, so the translate pushed it clean out of the track and
       * over the label beside it.
       */}
      <span
        aria-hidden="true"
        className={`inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors duration-150 ${
          props.isChecked ? "bg-indigo-600" : "bg-gray-300"
        }`}
      >
        <span
          className={`h-3 w-3 rounded-full bg-white shadow transition-transform duration-150 ${
            props.isChecked ? "translate-x-3.5" : "translate-x-0.5"
          }`}
        />
      </span>
      <span>{props.label}</span>
    </button>
  );
};

export interface ReplayClockProps {
  currentText: string;
  totalText: string;
  dataTestId?: string | undefined;
}

/*
 * The playhead readout. The elapsed half carries the weight because it
 * is the number that moves; the total is a reference and recedes. Both
 * halves are tabular so the row does not twitch every tick.
 */
export const ReplayClock: FunctionComponent<ReplayClockProps> = (
  props: ReplayClockProps,
): ReactElement => {
  return (
    <div
      data-testid={props.dataTestId}
      aria-live="off"
      className="flex shrink-0 items-baseline gap-1 px-1 font-mono tabular-nums"
    >
      <span className="text-sm font-semibold text-gray-900">
        {props.currentText}
      </span>
      {/*
       * The separator keeps its literal spaces: the readout's text is
       * asserted as one string ("0:12 / 10:00"), and two adjacent spans
       * with only a flex gap between them would read as "0:12/ 10:00".
       */}
      <span className="text-xs text-gray-400">{` / ${props.totalText}`}</span>
    </div>
  );
};
