import AppLink from "../AppLink/AppLink";
import Route from "Common/Types/API/Route";
import { CARD_GRID_CENTERED_STATE_CLASS_NAME } from "Common/UI/Components/Card/CardGridLayout";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface RankedBarItem {
  key: string;
  label: string | ReactElement;
  count: number;
  // The bar's color; indigo when unset.
  color?: string | undefined;
  to?: Route | undefined;
  // A line under the label: a rule's source, an entity's type.
  hint?: string | undefined;
  /*
   * How full its bar is, from 0 to 100, when it is not its share of the
   * list: an entity's risk fills its bar as Entity Risk's meter does,
   * against twice the project's threshold.
   */
  fillPercent?: number | undefined;
  /*
   * Before the count, what it reads as: an entity's risk level, as Entity
   * Risk draws it beside the score. The count stays at the line's end, so
   * the counts of a list line up as every other list's do, whatever each
   * badge says.
   */
  badge?: ReactElement | undefined;
  /*
   * The label whole, under the pointer, for a label cut short to its line.
   * A label in words is its own; one drawn as an element (an entity's value)
   * says it here.
   */
  title?: string | undefined;
}

// How much of its track an item's bar fills, from 0 to 100.
export function getRankedBarFillPercent(
  item: RankedBarItem,
  max: number,
): number {
  if (item.fillPercent !== undefined) {
    return Number.isFinite(item.fillPercent)
      ? Math.min(100, Math.max(0, item.fillPercent))
      : 0;
  }

  if (!(item.count > 0)) {
    return 0;
  }

  // A count above nothing always shows: never thinner than a sliver.
  return Math.min(100, Math.max(2, (item.count / Math.max(1, max)) * 100));
}

// What a row's label says under the pointer, when anything.
export function getRankedBarTitle(item: RankedBarItem): string | undefined {
  if (item.title) {
    return item.title;
  }

  return typeof item.label === "string" && item.label ? item.label : undefined;
}

/*
 * A row that opens something opens it from anywhere on it - its label, its
 * hint, its count and its bar - not from its label's few letters alone: the
 * link's ::after is stretched over the row (the li is its box), above the
 * bar's track, which is placed too. It reaches 4px above and below the row,
 * less than half the 10px between two rows, so no two rows ever share a
 * point. Under the pointer the label is underlined wherever the row is
 * pointed at, and a keyboard's focus rings the whole row.
 */
export const RANKED_BAR_ROW_LINK_CLASS_NAME: string =
  "group/ranked-row block rounded-sm hover:underline focus:outline-none after:absolute after:-inset-x-2 after:-inset-y-1 after:z-10 after:rounded-md after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-indigo-500";

/*
 * For a label drawn as a box of its own (an inline-block cut short at its
 * own end), which its link's underline does not reach: underlined with the
 * row it is in.
 */
export const RANKED_BAR_LABEL_HOVER_CLASS_NAME: string =
  "group-hover/ranked-row:underline";

export interface ComponentProps {
  items: Array<RankedBarItem>;
  emptyText: string;
  // Bars are drawn against this; the largest count when unset.
  total?: number | undefined;
  /*
   * A mark halfway along each bar, as Entity Risk's meter has: where a case
   * opens, for bars that fill against twice the project's threshold.
   */
  hasThresholdMark?: boolean | undefined;
}

// Nothing to rank, as any card of a row says it (CardGrid).
export const RANKED_BARS_EMPTY_CLASS_NAME: string = `${CARD_GRID_CENTERED_STATE_CLASS_NAME} py-6 text-sm text-gray-500`;

/*
 * A short ranked list - the rules that fired most, the tactics seen most -
 * each row with a bar for its share, so the list reads at a glance.
 */
const RankedBars: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  /*
   * Nothing to rank: the sentence takes the room the card has and sits in
   * its middle. Beside a taller card in its row the card is tall, and the
   * sentence at its top would leave the rest of it blank under it.
   */
  if (props.items.length === 0) {
    return (
      <p
        data-testid="ranked-bars-empty"
        className={RANKED_BARS_EMPTY_CLASS_NAME}
      >
        {translator.translateText(props.emptyText)}
      </p>
    );
  }

  const max: number = Math.max(
    1,
    props.total ||
      Math.max(
        ...props.items.map((item: RankedBarItem): number => {
          return item.count;
        }),
      ),
  );

  return (
    <ul className="space-y-2.5">
      {props.items.map((item: RankedBarItem): ReactElement => {
        const fill: number = getRankedBarFillPercent(item, max);
        const title: string | undefined = getRankedBarTitle(item);
        const label: ReactElement = (
          <span
            className={`block truncate text-sm text-gray-800 ${RANKED_BAR_LABEL_HOVER_CLASS_NAME}`}
            // A row's link says it, wherever the row is pointed at.
            title={item.to ? undefined : title}
          >
            {item.label}
          </span>
        );
        const count: ReactElement = (
          <span className="flex-shrink-0 text-sm font-semibold tabular-nums text-gray-900">
            {translator.formatNumber(item.count)}
          </span>
        );

        return (
          <li key={item.key} className={item.to ? "relative" : undefined}>
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                {item.to ? (
                  <AppLink
                    to={item.to}
                    title={title}
                    className={RANKED_BAR_ROW_LINK_CLASS_NAME}
                  >
                    {label}
                  </AppLink>
                ) : (
                  label
                )}
                {item.hint ? (
                  <span className="block truncate text-[11px] text-gray-500">
                    {item.hint}
                  </span>
                ) : (
                  <></>
                )}
              </div>
              {item.badge ? (
                <span
                  className="flex flex-shrink-0 items-center gap-2"
                  data-testid="ranked-bar-count"
                >
                  {item.badge}
                  {count}
                </span>
              ) : (
                count
              )}
            </div>
            <div className="relative mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
              {/* Nothing to draw for a zero: the track alone says none. */}
              {fill > 0 ? (
                <div
                  className="h-full rounded-full"
                  data-testid="ranked-bar-fill"
                  style={{
                    width: `${fill}%`,
                    backgroundColor: item.color || "#6366f1",
                  }}
                />
              ) : (
                <></>
              )}
              {props.hasThresholdMark ? (
                <div
                  className="absolute inset-y-0 start-1/2 w-px bg-gray-300"
                  data-testid="ranked-bar-threshold"
                  aria-hidden="true"
                />
              ) : (
                <></>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
};

export default RankedBars;
