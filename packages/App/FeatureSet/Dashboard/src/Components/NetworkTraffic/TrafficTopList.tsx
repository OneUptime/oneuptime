import {
  formatSharePercent,
  formatTrafficBytes,
  getSharePercent,
} from "./NetworkTrafficFormat";
import Card from "Common/UI/Components/Card/Card";
import { CARD_GRID_CENTERED_STATE_CLASS_NAME } from "Common/UI/Components/Card/CardGridLayout";
import Icon from "Common/UI/Components/Icon/Icon";
import WordsWithInfoTooltip from "Common/UI/Components/Tooltip/WordsWithInfoTooltip";
import IconProp from "Common/Types/Icon/IconProp";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  ReactNode,
} from "react";

/*
 * One "top N" table of a Traffic page: the busiest sources, destinations,
 * applications, interfaces or devices of the window, each row with its bytes,
 * its share of the page's traffic and a bar the length of that share.
 *
 * A row is a button when the page can narrow to it: a click narrows the
 * whole page to it (the filter the page keeps in its URL), and a click on
 * the row the page is already narrowed to widens it again. A row that is
 * the filter says so. A row the page cannot narrow to (a Meraki
 * application: the uplinks it is totalled against know no applications)
 * is a plain row, and says nothing it cannot do.
 *
 * The lists sit two to a row on a wide page, each as tall as its row (the
 * card fills its grid cell), so a short list beside a long one ends where
 * it does instead of leaving a hole under it. The grid spaces the cards.
 *
 * A list cut at its ten says how many rows it has under them, and opens
 * them all ("View all 523 networks", issue #5762) - the one way to the rest,
 * where the rest is worth finding.
 */

/*
 * The way to every row of a list cut short: what it says, and what it
 * opens. Only for a list that has more rows than it shows.
 */
export interface TrafficTopListViewAll {
  label: string;
  onClick: () => void;
}

export interface TrafficTopRow {
  key: string;
  label: ReactNode;
  // Mono for addresses; plain for names.
  isMono?: boolean | undefined;
  /*
   * Under the pointer on the first line: the whole of what it says, for a
   * name cut short ("mumbai-fileserver-01.corp.example (10.18.167.35)").
   */
  title?: string | undefined;
  sublabel?: ReactNode | undefined;
  octets: number;
  // Right of the bytes, small: "in 1.2 GB · out 30 MB", say.
  detail?: ReactNode | undefined;
  isActive: boolean;
  // Absent: the row is not a filter, and is drawn as plain text.
  onClick?: (() => void) | undefined;
  /*
   * A control of its own beside the row (a link to the device's page): a
   * sibling of the row's button, never inside it.
   */
  trailing?: ReactNode | undefined;
  // What a screen reader hears for the row's button.
  ariaLabel?: string | undefined;
}

export interface ComponentProps {
  title: string;
  description: string;
  // The (i) beside the title: what the numbers are.
  help: string;
  rows: Array<TrafficTopRow>;
  // The page's total, the 100% every share is of.
  totalOctets: number;
  emptyMessage: string;
  dataTestId: string;
  // Under the rows, when the list has more to say than its rows do.
  footer?: ReactNode | undefined;
  // Under the rows, for a list with more rows than it shows.
  viewAll?: TrafficTopListViewAll | undefined;
  /*
   * Off for a list that is not in a grid: as tall as its row is what a list
   * beside another wants, and outside a row it would be as tall as the page.
   */
  fillHeight?: boolean | undefined;
}

// The card's room under its header, which the list or its empty sentence fills.
export const TRAFFIC_TOP_LIST_BODY_CLASS_NAME: string = "flex flex-1 flex-col";

// Nothing in the window, in the middle of the card's room.
export const TRAFFIC_TOP_LIST_EMPTY_CLASS_NAME: string = `${CARD_GRID_CENTERED_STATE_CLASS_NAME} py-6 text-sm text-gray-500`;

/*
 * A list's rows: each with its bytes, its share of the page's traffic and a
 * bar the length of that share - in a top list's card, and in the dialog
 * that lists every row of one (MerakiTrafficListModal), alike.
 */
export const TrafficTopRows: FunctionComponent<{
  rows: Array<TrafficTopRow>;
  totalOctets: number;
  dataTestId: string;
}> = (props: {
  rows: Array<TrafficTopRow>;
  totalOctets: number;
  dataTestId: string;
}): ReactElement => {
  // When some rows have a control beside them, the others keep its room.
  const hasTrailing: boolean = props.rows.some(
    (row: TrafficTopRow): boolean => {
      return Boolean(row.trailing);
    },
  );

  return (
    <ol className="-mx-2 space-y-0.5">
      {props.rows.map((row: TrafficTopRow): ReactElement => {
        const share: number = getSharePercent(row.octets, props.totalOctets);

        const body: ReactElement = (
          <Fragment>
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  {row.isActive ? (
                    <Icon
                      icon={IconProp.Filter}
                      className="h-3.5 w-3.5 flex-shrink-0 text-indigo-600"
                    />
                  ) : (
                    <></>
                  )}
                  <span
                    className={`truncate text-sm font-medium text-gray-900 ${
                      row.isMono ? "font-mono" : ""
                    }`}
                    title={row.title}
                    data-testid={`${props.dataTestId}-row-label`}
                  >
                    {row.label}
                  </span>
                </div>
                {row.sublabel ? (
                  <div
                    className="mt-0.5 truncate text-xs text-gray-500"
                    data-testid={`${props.dataTestId}-row-sublabel`}
                  >
                    {row.sublabel}
                  </div>
                ) : (
                  <></>
                )}
              </div>
              <div className="flex flex-shrink-0 items-baseline gap-2 text-right">
                <span
                  className="text-sm tabular-nums text-gray-900"
                  data-testid={`${props.dataTestId}-row-bytes`}
                >
                  {formatTrafficBytes(row.octets)}
                </span>
                <span className="w-9 text-xs tabular-nums text-gray-500">
                  {formatSharePercent(row.octets, props.totalOctets)}
                </span>
              </div>
            </div>
            {row.detail ? (
              <div className="mt-0.5 text-xs text-gray-500">{row.detail}</div>
            ) : (
              <></>
            )}
            <div
              className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-gray-100"
              aria-hidden="true"
            >
              <div
                className={`h-full rounded-full ${
                  row.isActive ? "bg-indigo-600" : "bg-indigo-400"
                }`}
                style={{ width: `${Math.max(share, 0.5)}%` }}
              />
            </div>
          </Fragment>
        );

        return (
          <li key={row.key} className="flex items-center gap-1">
            {row.onClick ? (
              <button
                type="button"
                className={`block min-w-0 flex-1 rounded-md px-2 py-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                  row.isActive ? "bg-indigo-50" : "hover:bg-gray-50"
                }`}
                aria-pressed={row.isActive}
                aria-label={row.ariaLabel}
                onClick={row.onClick}
                data-testid={`${props.dataTestId}-row`}
              >
                {body}
              </button>
            ) : (
              <div
                className="block min-w-0 flex-1 px-2 py-2"
                data-testid={`${props.dataTestId}-row`}
              >
                {body}
              </div>
            )}
            {row.trailing ? (
              <div className="w-7 flex-shrink-0">{row.trailing}</div>
            ) : hasTrailing ? (
              <div className="w-7 flex-shrink-0" aria-hidden="true" />
            ) : (
              <></>
            )}
          </li>
        );
      })}
    </ol>
  );
};

const TrafficTopList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <Card
      title={
        /* The (i) after the title's last word (issue #7348). */
        <WordsWithInfoTooltip
          text={translator.translateText(props.title) || props.title}
          label={props.title}
          description={props.help}
        />
      }
      description={props.description}
      fillHeight={props.fillHeight !== false}
    >
      {/*
       * The room the card has under its header: a list keeps its rows at
       * the top of it, and a list with nothing says so in its middle, as
       * every card of a row does (CardGrid).
       */}
      <div
        data-testid={props.dataTestId}
        className={TRAFFIC_TOP_LIST_BODY_CLASS_NAME}
      >
        {props.rows.length === 0 ? (
          <p
            className={TRAFFIC_TOP_LIST_EMPTY_CLASS_NAME}
            data-testid={`${props.dataTestId}-empty`}
          >
            {translator.translateText(props.emptyMessage)}
          </p>
        ) : (
          <TrafficTopRows
            rows={props.rows}
            totalOctets={props.totalOctets}
            dataTestId={props.dataTestId}
          />
        )}
        {props.viewAll && props.rows.length > 0 ? (
          /*
           * At the card's foot, so two lists side by side end on the same
           * line however many rows each has.
           */
          <div className="mt-auto pt-3">
            <div className="border-t border-gray-100 pt-3">
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={props.viewAll.onClick}
                className="inline-flex items-center gap-1 rounded-sm text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                data-testid={`${props.dataTestId}-view-all`}
              >
                {props.viewAll.label}
                <Icon
                  icon={IconProp.ChevronRight}
                  className="h-3.5 w-3.5 flex-shrink-0"
                />
              </button>
            </div>
          </div>
        ) : (
          <></>
        )}
        {props.footer ? (
          <div className="mt-4 border-t border-gray-100 pt-4">
            {props.footer}
          </div>
        ) : (
          <></>
        )}
      </div>
    </Card>
  );
};

export default TrafficTopList;
