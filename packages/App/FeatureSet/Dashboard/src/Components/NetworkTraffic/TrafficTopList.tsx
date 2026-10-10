import {
  formatSharePercent,
  formatTrafficBytes,
  getSharePercent,
} from "./NetworkTrafficFormat";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import IconProp from "Common/Types/Icon/IconProp";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * One "top N" table of a Traffic page: the busiest sources, destinations,
 * applications, interfaces or devices of the window, each row with its bytes,
 * its share of the page's traffic and a bar the length of that share.
 *
 * Every row is a button: a click narrows the whole page to it (the filter
 * the page keeps in its URL), and a click on the row the page is already
 * narrowed to widens it again. A row that is the filter says so.
 */

export interface TrafficTopRow {
  key: string;
  label: ReactNode;
  // Mono for addresses; plain for names.
  isMono?: boolean | undefined;
  sublabel?: ReactNode | undefined;
  octets: number;
  // Right of the bytes, small: "in 1.2 GB · out 30 MB", say.
  detail?: ReactNode | undefined;
  isActive: boolean;
  onClick: () => void;
  /*
   * A control of its own beside the row (a link to the device's page): a
   * sibling of the row's button, never inside it.
   */
  trailing?: ReactNode | undefined;
  // What a screen reader hears for the row's button.
  ariaLabel: string;
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
}

const TrafficTopList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  // When some rows have a control beside them, the others keep its room.
  const hasTrailing: boolean = props.rows.some(
    (row: TrafficTopRow): boolean => {
      return Boolean(row.trailing);
    },
  );

  return (
    <Card
      title={
        <span className="inline-flex items-center gap-1.5">
          {translator.translateText(props.title)}
          <InfoTooltip label={props.title} text={props.help} />
        </span>
      }
      description={props.description}
    >
      <div data-testid={props.dataTestId}>
        {props.rows.length === 0 ? (
          <p
            className="py-6 text-center text-sm text-gray-500"
            data-testid={`${props.dataTestId}-empty`}
          >
            {translator.translateText(props.emptyMessage)}
          </p>
        ) : (
          <ol className="-mx-2 space-y-0.5">
            {props.rows.map((row: TrafficTopRow): ReactElement => {
              const share: number = getSharePercent(
                row.octets,
                props.totalOctets,
              );

              return (
                <li key={row.key} className="flex items-center gap-1">
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
                          >
                            {row.label}
                          </span>
                        </div>
                        {row.sublabel ? (
                          <div className="mt-0.5 truncate text-xs text-gray-500">
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
                      <div className="mt-0.5 text-xs text-gray-500">
                        {row.detail}
                      </div>
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
                  </button>
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
        )}
      </div>
    </Card>
  );
};

export default TrafficTopList;
