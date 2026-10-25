import AppLink from "../AppLink/AppLink";
import Route from "Common/Types/API/Route";
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
}

export interface ComponentProps {
  items: Array<RankedBarItem>;
  emptyText: string;
  // Bars are drawn against this; the largest count when unset.
  total?: number | undefined;
}

export const RANKED_BARS_EMPTY_CLASS_NAME: string =
  "flex flex-1 items-center justify-center py-6 text-center text-sm text-gray-500";

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
        const label: ReactElement = (
          <span className="block truncate text-sm text-gray-800">
            {item.label}
          </span>
        );

        return (
          <li key={item.key}>
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                {item.to ? (
                  <AppLink to={item.to} className="hover:underline">
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
              <span className="flex-shrink-0 text-sm font-semibold tabular-nums text-gray-900">
                {translator.formatNumber(item.count)}
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
              {/* Nothing to draw for a zero: the track alone says none. */}
              {item.count > 0 ? (
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(2, (item.count / max) * 100)}%`,
                    backgroundColor: item.color || "#6366f1",
                  }}
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
