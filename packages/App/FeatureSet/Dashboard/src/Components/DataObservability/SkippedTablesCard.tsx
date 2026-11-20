import OneUptimeDate from "Common/Types/Date";
import { DataObservabilitySkippedTable } from "Common/Types/DataObservability/DataObservabilityApiTypes";
import { SkippedTableRead } from "Common/Types/DataObservability/SkippedTables";
import { translationKey } from "Common/Types/Translator";
import Card from "Common/UI/Components/Card/Card";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * THE TABLES A DATABASE KEEPS REFUSING, ON ITS PAGE (#9541).
 *
 * Collections skip a table the database keeps refusing - a Dataverse table
 * the app's role may not read, or one Dataverse cannot count or describe -
 * until its next try, instead of finding it again every five minutes. This
 * card says which tables, what is not read of each, why in the database's
 * own words, and when each is asked again; Collect Now asks them all again
 * at once. It is drawn only while there is a table to list.
 */

// How many tables show before Show all: the first few say what is wrong.
export const SKIPPED_TABLES_SHOWN: number = 5;

// What is not read of a table, in the words the Dashboard gives these elsewhere.
export const SKIPPED_TABLE_READ_LABELS: Record<SkippedTableRead, string> = {
  [SkippedTableRead.RowCount]: translationKey("Row Count"),
  [SkippedTableRead.Columns]: translationKey("Columns"),
  [SkippedTableRead.LastChange]: translationKey("Last Changed"),
};

export interface ComponentProps {
  skippedTables: Array<DataObservabilitySkippedTable>;
}

const SkippedTablesCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isShownInFull, setIsShownInFull] = useState<boolean>(false);
  const tables: Array<DataObservabilitySkippedTable> = props.skippedTables;

  if (tables.length === 0) {
    return <></>;
  }

  const shown: Array<DataObservabilitySkippedTable> = isShownInFull
    ? tables
    : tables.slice(0, SKIPPED_TABLES_SHOWN);

  // When a table is asked again: a time to come, or the next collection once that time has passed.
  const describeNextTry: (nextTryAt: string) => string | undefined = (
    nextTryAt: string,
  ): string | undefined => {
    const at: Date = OneUptimeDate.fromString(nextTryAt);

    return at.getTime() > Date.now()
      ? translator.translateTemplate("Asked again {{time}}", {
          time: OneUptimeDate.fromNow(at),
        })
      : translator.translateText("Asked again at the next collection");
  };

  return (
    <Card
      title="Skipped Tables"
      description="The database refused these tables, so collections skip each one until its next try instead of asking every five minutes. Collect Now asks them all again at once."
    >
      <ul className="divide-y divide-gray-100">
        {shown.map((entry: DataObservabilitySkippedTable): ReactElement => {
          return (
            <li
              key={`${entry.read}\u0000${entry.table}`}
              className="py-3 first:pt-0 last:pb-0"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-mono text-sm font-medium text-gray-900 [overflow-wrap:anywhere]">
                  <IsolatedText text={entry.table} breaksLikeAName={true} />
                </span>
                <span className="text-xs font-medium text-gray-600">
                  {translator.translateText(
                    SKIPPED_TABLE_READ_LABELS[entry.read] || entry.read,
                  )}
                </span>
                <span className="text-xs text-gray-500">
                  {describeNextTry(entry.nextTryAt)}
                </span>
              </div>
              {entry.reason ? (
                <p className="mt-1 text-sm text-gray-600 [overflow-wrap:anywhere]">
                  <IsolatedText text={entry.reason} />
                </p>
              ) : (
                <></>
              )}
            </li>
          );
        })}
      </ul>
      {tables.length > SKIPPED_TABLES_SHOWN ? (
        <button
          type="button"
          className="mt-3 text-sm font-medium text-indigo-600 hover:text-indigo-800"
          aria-expanded={isShownInFull}
          onClick={() => {
            setIsShownInFull(!isShownInFull);
          }}
        >
          {isShownInFull
            ? translator.translateText("Show fewer")
            : translator.translateTemplate("Show all {{count}}", {
                count: translator.formatNumber(tables.length),
              })}
        </button>
      ) : (
        <></>
      )}
    </Card>
  );
};

export default SkippedTablesCard;
