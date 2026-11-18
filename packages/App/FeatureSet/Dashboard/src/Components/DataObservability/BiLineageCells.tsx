import { getBiLineageReason } from "./BiLineageWords";
import {
  DataBiLineageSummary,
  DataBiSource,
  DataDashboardDataset,
  DataDashboardUpstream,
  getDataBiSourceName,
} from "Common/Types/DataObservability/DataBiLineage";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import {
  PluralTemplate,
  Translator,
  formatInline,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * THE BI PAGE'S CELLS THAT SAY WHAT A DASHBOARD IS BUILT ON (#9507).
 *
 *  - Tables Matched, on a BI tool: the count, and under it the first thing
 *    keeping its dashboards off their tables - "Power BI sent no tables",
 *    "3 databases not connected" - with See Why, which opens the Tables
 *    Matched dialog (BiLineageDialog).
 *  - Built On, on a dashboard: the datasets it charts and where their data
 *    comes from, as its tool says, whether or not OneUptime watches it.
 */

const MORE: PluralTemplate = {
  one: "+{{count}} more",
  other: "+{{count}} more",
};

// The datasets and sources a cell names before it counts the rest.
const SHOWN: number = 2;

export interface TablesMatchedProps {
  matchedTableCount: number | undefined;
  summary: DataBiLineageSummary | null;
  onExplain: () => void;
}

export const BiTablesMatchedCell: FunctionComponent<TablesMatchedProps> = (
  props: TablesMatchedProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const reason: string | null = props.summary
    ? getBiLineageReason(translator, props.summary)
    : null;

  return (
    <div className="min-w-0" data-testid="bi-tables-matched">
      <span className="block text-sm text-gray-900">
        {typeof props.matchedTableCount === "number" ? (
          translator.formatNumber(props.matchedTableCount)
        ) : (
          <TableEmptyValue />
        )}
      </span>
      {reason ? (
        <span className="flex flex-wrap items-center gap-x-2 text-xs">
          <span
            className="text-yellow-700"
            data-testid="bi-tables-matched-reason"
          >
            {reason}
          </span>
          <Button
            title="See Why"
            buttonStyle={ButtonStyleType.LINK}
            buttonSize={ButtonSize.ExtraSmall}
            className="text-xs font-medium"
            dataTestId="bi-tables-matched-why"
            onClick={props.onExplain}
          />
        </span>
      ) : (
        <></>
      )}
    </div>
  );
};

function namesOf(
  translator: Translator,
  names: Array<string>,
): { shown: Array<string>; more: string | null } {
  return {
    shown: names.slice(0, SHOWN),
    more:
      names.length > SHOWN
        ? translator.translatePlural(MORE, names.length - SHOWN)
        : null,
  };
}

// A source in a cell: what it is, and where.
export function getBiSourceLine(
  translator: Translator,
  source: DataBiSource,
): string {
  const name: string = getDataBiSourceName(source);

  return name === source.type
    ? name
    : formatInline([source.type, name], translator);
}

// What a dashboard is built on, as text: for its export.
export function getBiBuiltOnText(
  translator: Translator,
  upstream: DataDashboardUpstream | null,
): string {
  if (!upstream) {
    return "";
  }

  return [
    ...upstream.datasets.map((dataset: DataDashboardDataset): string => {
      return dataset.name;
    }),
    ...upstream.sources.map((source: DataBiSource): string => {
      return getBiSourceLine(translator, source);
    }),
  ].join("; ");
}

export interface BuiltOnProps {
  upstream: DataDashboardUpstream | null;
}

export const BiBuiltOnCell: FunctionComponent<BuiltOnProps> = (
  props: BuiltOnProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const upstream: DataDashboardUpstream | null = props.upstream;

  if (
    !upstream ||
    (upstream.datasets.length === 0 && upstream.sources.length === 0)
  ) {
    return <TableEmptyValue />;
  }

  const datasets: { shown: Array<string>; more: string | null } = namesOf(
    translator,
    upstream.datasets.map((dataset: DataDashboardDataset): string => {
      return dataset.name;
    }),
  );
  const sources: { shown: Array<string>; more: string | null } = namesOf(
    translator,
    upstream.sources.map((source: DataBiSource): string => {
      return getBiSourceLine(translator, source);
    }),
  );

  return (
    <div className="min-w-0 space-y-0.5" data-testid="bi-built-on">
      {datasets.shown.length > 0 ? (
        <span className="block text-sm text-gray-900 [overflow-wrap:anywhere]">
          <IsolatedText text={datasets.shown.join(", ")} />
          {datasets.more ? (
            <span className="text-gray-500"> {datasets.more}</span>
          ) : (
            <></>
          )}
        </span>
      ) : (
        <></>
      )}
      {sources.shown.map((line: string, index: number): ReactElement => {
        return (
          <span
            key={`${line}-${index}`}
            className="block text-xs text-gray-500 [overflow-wrap:anywhere]"
          >
            <IsolatedText text={line} />
          </span>
        );
      })}
      {sources.more ? (
        <span className="block text-xs text-gray-500">{sources.more}</span>
      ) : (
        <></>
      )}
    </div>
  );
};
