import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * The single metric tile used across the on-call policy surfaces.
 *
 * This markup was previously a local `getStatTile` closure inside
 * EscalationSummary.tsx, and the OnCallPolicy directory already carries roughly
 * five near-identical chip/tile class strings between EscalationSummary,
 * OnCallPolicySummary and the rule cards. Adding a readiness card would have
 * made it a third copy of this exact tile, so it moves here instead: one place
 * that decides what a tile looks like, and one place to change when it stops
 * looking right.
 *
 * `tone` exists because the readiness tiles have to mean something — an amber
 * "Needs setup: 3" and a red "Unreachable: 1" are not the same statement as
 * "Levels: 3". The default tone reproduces the original indigo tile byte for
 * byte so the escalation summary is visually unchanged by the move.
 *
 * Colours are hardcoded light-mode (bg-white, text-gray-900, border-gray-200) to
 * match every other surface in this directory. There is no dark-mode variant
 * anywhere in EscalationSummary or Card, and a single dark-aware tile would be
 * the odd one out rather than a step towards dark mode.
 */

export type StatTileTone = "neutral" | "positive" | "warning" | "critical";

export interface ComponentProps {
  icon: IconProp;
  label: string;
  value: string;
  tone?: StatTileTone | undefined;
  /*
   * Makes the tile a button. Supplied by the readiness page, where each tile
   * counts a status and pressing it filters the table down to that status - so
   * the number an admin is looking at and the control that acts on it are the
   * same object, rather than a count in one strip and a matching pill in
   * another.
   *
   * Absent leaves the tile a plain div, which is what the escalation summary
   * still wants: a tile that looks pressable and is not is worse than one that
   * never invited the click.
   */
  onClick?: (() => void) | undefined;
  /** Only meaningful with onClick. Draws the pressed state. */
  isActive?: boolean | undefined;
  /** Only meaningful with onClick. The accessible name for the button. */
  ariaLabel?: string | undefined;
}

export const STAT_TILE_LABEL_CLASS_NAME: string =
  "break-words text-xs leading-snug text-gray-500";

/*
 * A tile reads its own width (a container) to place its icon. Beside the
 * icon, a tile two to a row on a phone (some 150 pixels) left its name 65
 * pixels, and a word wider than that broke inside itself: "Responder / s",
 * "Unreachabl / e" (Norwegian's "Eskaleringsniveauer" needs 118). Where the
 * tile has less than 10.5rem of room, the icon sits over the number and the
 * name has the tile's whole width; from 10.5rem - two to a row beside the
 * side menu, four to a row at 1280 - the icon is beside the number, with 120
 * pixels and more for the name.
 *
 * Only the direction changes with the width, and nothing else sets it, so no
 * rule depends on coming after another in the stylesheet: the gaps are
 * gap-x (beside) and gap-y (over), and the icon is at the start of both.
 */
export const STAT_TILE_STACKED_BELOW_WIDTH_IN_REM: number = 10.5;

export const STAT_TILE_CONTAINER_CLASS_NAME: string =
  "w-full [container-type:inline-size]";

export const STAT_TILE_BODY_CLASS_NAME: string =
  "flex items-start gap-x-3 gap-y-2 [@container(max-width:10.49rem)]:flex-col";

// The number and the name: the room beside the icon, or the tile's width.
export const STAT_TILE_TEXT_CLASS_NAME: string = "w-full min-w-0 text-left";

/*
 * The tile's frame, a plain one's and a pressable one's alike: a column
 * whose content starts at the top. A row's tiles are as tall as its tallest
 * (a name on two lines: "Einrichtung / erforderlich"), and a button centres
 * what it holds - so the pressable tiles' icons and numbers sat lower than
 * a plain tile's beside them, and lower than those of a tile whose name took
 * two lines. From the top, every tile's icon and number keep one line.
 */
export const STAT_TILE_FRAME_CLASS_NAME: string =
  "flex w-full flex-col justify-start rounded-xl border bg-white px-4 py-3";

/*
 * Four tiles side by side only where the card has room for four - by the
 * card's width, not the window's. Beside the side menu at 1024 pixels four
 * tiles in a 660-pixel card left each name some 70 pixels: "Responder / s",
 * "Unreachabl / e". Two a row there, as on a phone.
 */
export const STAT_TILE_GRID_CONTAINER_CLASS_NAME: string =
  "[container-type:inline-size]";

export const STAT_TILE_GRID_CLASS_NAME: string =
  "grid grid-cols-2 gap-3 [@container(min-width:45rem)]:grid-cols-4";

export interface StatTileGridProps {
  children: ReactNode;
  // Under the grid; the tiles' own row of a card keeps 24px.
  className?: string | undefined;
}

export const StatTileGrid: FunctionComponent<StatTileGridProps> = (
  props: StatTileGridProps,
): ReactElement => {
  return (
    <div
      className={`${STAT_TILE_GRID_CONTAINER_CLASS_NAME} ${
        props.className ?? "mb-6"
      }`}
    >
      <div className={STAT_TILE_GRID_CLASS_NAME} data-testid="stat-tile-grid">
        {props.children}
      </div>
    </div>
  );
};

interface ToneClassNames {
  iconWrapperClassName: string;
  iconClassName: string;
  valueClassName: string;
}

const toneClassNames: Record<StatTileTone, ToneClassNames> = {
  neutral: {
    iconWrapperClassName: "bg-indigo-50",
    iconClassName: "text-indigo-600",
    valueClassName: "text-gray-900",
  },
  positive: {
    iconWrapperClassName: "bg-emerald-50",
    iconClassName: "text-emerald-600",
    valueClassName: "text-gray-900",
  },
  warning: {
    iconWrapperClassName: "bg-amber-50",
    iconClassName: "text-amber-600",
    valueClassName: "text-amber-700",
  },
  critical: {
    iconWrapperClassName: "bg-red-50",
    iconClassName: "text-red-600",
    valueClassName: "text-red-700",
  },
};

const StatTile: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const tone: ToneClassNames = toneClassNames[props.tone || "neutral"];
  // Callers hand over English labels; the tile shows them in the reader's language.
  const label: string = translator.translateText(props.label) || props.label;

  const body: ReactElement = (
    <div className={STAT_TILE_CONTAINER_CLASS_NAME}>
      <div className={STAT_TILE_BODY_CLASS_NAME} data-testid="stat-tile-body">
        <div
          className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${tone.iconWrapperClassName}`}
        >
          <Icon icon={props.icon} className={`h-4 w-4 ${tone.iconClassName}`} />
        </div>
        <div className={STAT_TILE_TEXT_CLASS_NAME}>
          <div
            className={`truncate text-lg font-semibold leading-tight ${tone.valueClassName}`}
          >
            {props.value}
          </div>
          {/*
           * Its name wraps onto a second line rather than being cut short:
           * two tiles side by side on a phone read "Respond...", "Needs
           * se..." and "Unreacha..." (and German's longer words lost more).
           */}
          <div className={STAT_TILE_LABEL_CLASS_NAME}>{label}</div>
        </div>
      </div>
    </div>
  );

  const baseClassName: string = STAT_TILE_FRAME_CLASS_NAME;

  if (!props.onClick) {
    return <div className={`${baseClassName} border-gray-200`}>{body}</div>;
  }

  return (
    <button
      type="button"
      aria-label={translator.translateText(props.ariaLabel) || label}
      aria-pressed={Boolean(props.isActive)}
      onClick={props.onClick}
      className={`${baseClassName} text-left transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
        props.isActive
          ? "border-indigo-500 ring-1 ring-inset ring-indigo-500"
          : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
      }`}
    >
      {body}
    </button>
  );
};

export default StatTile;
