import React, { FunctionComponent, ReactElement } from "react";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * Parts of a whole as bars on one baseline, one hue, each with its figures
 * printed beside it (issue #6444): users and sessions by device, browser or
 * page, and finished sessions by length. Every figure is text, so nothing
 * is read off the bar alone, and the list is read in order by a screen
 * reader as the table it is.
 */

export interface ProductAnalyticsBarRow {
  key: string;
  // Drawn as given: the page words it (a device type) or it is data (a page).
  label: string;
  // The bar's length, against the longest row's.
  value: number;
  // The figures beside the bar, already written ("1,204", "42%").
  figures: Array<string>;
}

export interface ProductAnalyticsBarsProps {
  rows: Array<ProductAnalyticsBarRow>;
  // What the label column is ("Browser"), as English the list translates.
  labelTitle: string;
  // What each figure is ("Users", "Percent"), as English the list translates.
  figureTitles: Array<string>;
  dataTestId: string;
}

const ProductAnalyticsBars: FunctionComponent<ProductAnalyticsBarsProps> = (
  props: ProductAnalyticsBarsProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const longest: number = props.rows.reduce(
    (most: number, row: ProductAnalyticsBarRow): number => {
      return Math.max(most, row.value);
    },
    0,
  );
  const columns: string = `minmax(0,1fr) ${props.figureTitles
    .map((): string => {
      return "auto";
    })
    .join(" ")}`;

  return (
    <div role="table" data-testid={props.dataTestId}>
      <div
        role="row"
        className="grid gap-x-4 border-b border-gray-100 pb-2 text-xs font-medium uppercase tracking-wider text-gray-500"
        style={{ gridTemplateColumns: columns }}
      >
        <span role="columnheader">
          {translator.translateText(props.labelTitle)}
        </span>
        {props.figureTitles.map((title: string): ReactElement => {
          return (
            <span key={title} role="columnheader" className="text-end">
              {translator.translateText(title)}
            </span>
          );
        })}
      </div>
      {props.rows.map((row: ProductAnalyticsBarRow): ReactElement => {
        const width: number =
          longest > 0 ? Math.max(0, (row.value / longest) * 100) : 0;

        return (
          <div
            key={row.key}
            role="row"
            className="grid gap-x-4 gap-y-1.5 border-b border-gray-100 py-2.5 last:border-b-0"
            style={{ gridTemplateColumns: columns }}
            data-testid={`${props.dataTestId}-row`}
            data-key={row.key}
          >
            <span
              role="cell"
              className="min-w-0 truncate text-sm text-gray-900"
              title={row.label}
              dir="auto"
            >
              {row.label}
            </span>
            {row.figures.map((figure: string, index: number): ReactElement => {
              return (
                <span
                  key={`${row.key}-${index}`}
                  role="cell"
                  className={`text-end text-sm tabular-nums ${
                    index === 0 ? "text-gray-900" : "text-gray-500"
                  }`}
                >
                  {figure}
                </span>
              );
            })}
            <div
              className="h-1.5 rounded-full bg-gray-100"
              style={{ gridColumn: "1 / -1" }}
              aria-hidden="true"
            >
              <div
                className="h-1.5 rounded-full bg-indigo-500"
                style={{ width: `${width}%` }}
                data-testid={`${props.dataTestId}-bar`}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ProductAnalyticsBars;
