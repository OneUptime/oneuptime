import {
  COULD_NOT_RUN,
  FOUND_EVENT_COUNT,
  HUNTS_TEST_IDS,
  RUN_COLUMN_TITLE,
  RUN_FOUND_COLUMN_TITLE,
  RUN_HISTORY_DESCRIPTION,
  RUN_HISTORY_EMPTY,
  RUN_HISTORY_TITLE,
  RUN_NOTHING_FOUND,
  RUN_PLURAL,
  RUN_SEARCHED,
  RUN_SINGULAR,
  SHOW_THEM,
} from "./HuntsCopy";
import { HUNT_RUN_HISTORY_PAGE_SIZE, getHuntRunWindow } from "./HuntsModel";
import { HUNT_RUN_REFUSED } from "../RefusedTelemetry/RefusedTelemetryCopy";
import { isPeriodRefused } from "../RefusedTelemetry/RefusedTelemetryModel";
import useProjectRefusedTelemetry from "../RefusedTelemetry/useProjectRefusedTelemetry";
import { RefusedTelemetry } from "Common/Utils/SecurityEvent/RefusedTelemetry";
import RelativeTime from "../../EpisodeView/RelativeTime";
import SecurityHuntRun from "Common/Models/DatabaseModels/SecurityHuntRun";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  SecurityHuntRunResult,
  SecurityHuntRunWindow,
  getSecurityHuntRunResult,
} from "Common/Types/SecurityEvent/SecurityHunt";
import Icon from "Common/UI/Components/Icon/Icon";
import SideOver from "Common/UI/Components/SideOver/SideOver";
import Table from "Common/UI/Components/Table/Table";
import Columns from "Common/UI/Components/Table/Types/Columns";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { useWriteDatesInSentenceLanguage } from "Common/UI/Utils/SentenceLanguage";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { ErrorInSentence } from "Common/UI/Components/ErrorMessage/ErrorSentence";

export interface ComponentProps {
  huntId: ObjectID;
  onClose: () => void;
  // Show what a run found: its window, on the hunt's explorer.
  onShowWindow: (window: SecurityHuntRunWindow) => void;
}

/*
 * A run's moment, as every list writes a date (TableDate): short - "Nov 3,
 * 9:00 AM", its year only when it is not this year's, and no zone - and
 * whole under the pointer, "Nov 3 2026, 09:00 AM GMT", in the reader's time
 * and clock and in the language of the sentence it is drawn in. Written in
 * full, the year and the zone said the same three times on every row.
 */
const RunMoment: FunctionComponent<{ date: Date }> = (props: {
  date: Date;
}): ReactElement => {
  const writeDates: <T>(write: () => T) => T =
    useWriteDatesInSentenceLanguage();

  return (
    <time
      dateTime={props.date.toISOString()}
      className="whitespace-nowrap"
      title={writeDates((): string => {
        return OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
          props.date,
        );
      })}
    >
      {writeDates((): string => {
        return OneUptimeDate.getDateAsCompactLocalString(props.date);
      })}
    </time>
  );
};

/*
 * The Run column: when the run was made, how long ago, and under it the
 * events it searched - from the moment after the run before it stopped to
 * two minutes before it ran.
 */
const RunCell: FunctionComponent<{ run: SecurityHuntRun }> = (props: {
  run: SecurityHuntRun;
}): ReactElement => {
  const run: SecurityHuntRun = props.run;
  const window: SecurityHuntRunWindow | null = getHuntRunWindow(run);

  return (
    <div className="grid min-w-0 grid-cols-1 gap-0.5">
      {run.createdAt ? (
        <span className="flex flex-wrap items-baseline gap-x-2 text-sm text-gray-900">
          <RunMoment date={OneUptimeDate.fromString(run.createdAt)} />
          <RelativeTime
            date={run.createdAt}
            className="whitespace-nowrap text-xs text-gray-500"
          />
        </span>
      ) : (
        <></>
      )}
      {window ? (
        <span className="text-xs font-normal text-gray-500">
          <TranslatedSentence
            template={RUN_SEARCHED}
            slots={{
              start: <RunMoment date={window.startTime} />,
              end: <RunMoment date={window.endTime} />,
            }}
          />
        </span>
      ) : (
        <></>
      )}
    </div>
  );
};

/*
 * Under a run that searched a window in which an ingestion budget or rate
 * refused some of the telemetry Security Events reads (#10431): what it
 * found - or that it found nothing - is not all there was.
 */
const RefusedNote: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <span
      className="inline-flex items-start gap-1 text-xs font-normal text-amber-800"
      data-testid={`${HUNTS_TEST_IDS.runRow}-refused`}
    >
      <Icon
        icon={IconProp.SignalSlash}
        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600"
      />
      <span>
        {translator.translateText(HUNT_RUN_REFUSED) || HUNT_RUN_REFUSED}
      </span>
    </span>
  );
};

/*
 * The Found column: how many events the run's search found, with Show them
 * - the explorer on that run's window; that it found nothing; or, in red,
 * that it could not run, and why (its window is searched again by the next
 * run). Under what it found, or that it found nothing, that some of the
 * telemetry of its window was refused, when it was.
 */
const FoundCell: FunctionComponent<{
  run: SecurityHuntRun;
  onShowWindow: (window: SecurityHuntRunWindow) => void;
  refusals: ReadonlyArray<RefusedTelemetry>;
}> = (props: {
  run: SecurityHuntRun;
  onShowWindow: (window: SecurityHuntRunWindow) => void;
  refusals: ReadonlyArray<RefusedTelemetry>;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const run: SecurityHuntRun = props.run;
  const result: SecurityHuntRunResult = getSecurityHuntRunResult(run);
  const window: SecurityHuntRunWindow | null = getHuntRunWindow(run);
  const isRefused: boolean = isPeriodRefused({
    refusals: props.refusals,
    from: window?.startTime || null,
    to: window?.endTime || null,
    now: OneUptimeDate.getCurrentDate(),
  });

  if (result === SecurityHuntRunResult.Failed) {
    const error: string =
      translator.translateText(run.error || "") || run.error || "";

    return (
      <div
        className="grid min-w-0 grid-cols-1 gap-0.5"
        data-state={result}
        data-testid={`${HUNTS_TEST_IDS.runRow}-found`}
      >
        <span className="inline-flex items-center gap-1 text-sm font-medium text-red-700">
          <Icon icon={IconProp.Alert} className="h-3.5 w-3.5 shrink-0" />
          {translator.translateText(COULD_NOT_RUN) || COULD_NOT_RUN}
        </span>
        <span className="break-words text-xs font-normal text-red-700">
          <ErrorInSentence message={error} showWhereToLook={true} />
        </span>
      </div>
    );
  }

  if (result === SecurityHuntRunResult.NothingFound) {
    return (
      <div className="grid min-w-0 grid-cols-1 gap-0.5">
        <span
          className="text-sm font-normal text-gray-500"
          data-state={result}
          data-testid={`${HUNTS_TEST_IDS.runRow}-found`}
        >
          {translator.translateText(RUN_NOTHING_FOUND) || RUN_NOTHING_FOUND}
        </span>
        {isRefused ? <RefusedNote /> : <></>}
      </div>
    );
  }

  return (
    <div className="grid min-w-0 grid-cols-1 gap-0.5">
      <span
        className="flex flex-wrap items-center gap-x-3 gap-y-0.5"
        data-state={result}
        data-testid={`${HUNTS_TEST_IDS.runRow}-found`}
      >
        <span className="text-sm font-medium tabular-nums text-gray-900">
          {translator.translatePlural(FOUND_EVENT_COUNT, run.eventCount || 0)}
        </span>
        {window ? (
          <button
            type="button"
            className="text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            data-testid={HUNTS_TEST_IDS.runShowThem}
            onClick={() => {
              props.onShowWindow(window);
            }}
          >
            {translator.translateText(SHOW_THEM) || SHOW_THEM}
          </button>
        ) : (
          <></>
        )}
      </span>
      {isRefused ? <RefusedNote /> : <></>}
    </div>
  );
};

/*
 * A HUNT'S RUN HISTORY, beside its page: every scheduled run of the last 90
 * days, newest first, ten at a time (or as many as the reader picks under
 * the list) - when it ran and the events it
 * searched, then what it found, with Show them, which closes the panel and
 * opens the explorer under it on that run's window, as a notification's
 * link does; or that it found nothing; or, in red, why it could not run.
 *
 * Read with the hunt's own rights: whoever opens the hunt reads its runs.
 */
const HuntRunHistory: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [runs, setRuns] = useState<Array<SecurityHuntRun>>([]);
  const [count, setCount] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  // Ten at a time, or as many as the reader picks under the list.
  const [pageSize, setPageSize] = useState<number>(HUNT_RUN_HISTORY_PAGE_SIZE);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [readCount, setReadCount] = useState<number>(0);
  // What a budget or a rate refused of what the hunt's events come from (#10431).
  const refusals: Array<RefusedTelemetry> = useProjectRefusedTelemetry();

  useEffect(() => {
    let isCurrent: boolean = true;

    const read: () => Promise<void> = async (): Promise<void> => {
      setIsLoading(true);
      setError("");

      try {
        const result: ListResult<SecurityHuntRun> =
          await ModelAPI.getList<SecurityHuntRun>({
            modelType: SecurityHuntRun,
            query: {
              securityHuntId: props.huntId,
            },
            select: {
              _id: true,
              createdAt: true,
              windowStartAt: true,
              windowEndAt: true,
              eventCount: true,
              error: true,
            },
            sort: {
              createdAt: SortOrder.Descending,
            },
            skip: (page - 1) * pageSize,
            limit: pageSize,
          });

        if (isCurrent) {
          setRuns(result.data);
          setCount(result.count);
        }
      } catch (err) {
        if (isCurrent) {
          setRuns([]);
          setError(API.getFriendlyMessage(err));
        }
      }

      if (isCurrent) {
        setIsLoading(false);
      }
    };

    void read();

    return () => {
      isCurrent = false;
    };
  }, [props.huntId.toString(), page, pageSize, readCount]);

  const columns: Columns<SecurityHuntRun> = [
    {
      title: RUN_COLUMN_TITLE,
      type: FieldType.Element,
      key: "createdAt",
      disableSort: true,
      hideTitleOnMobile: true,
      wrapContent: true,
      wrapMaxWidthClassName: "max-w-[24rem]",
      contentClassName: "min-w-[12rem]",
      getElement: (run: SecurityHuntRun): ReactElement => {
        return <RunCell run={run} />;
      },
    },
    {
      title: RUN_FOUND_COLUMN_TITLE,
      type: FieldType.Element,
      key: "eventCount",
      disableSort: true,
      // A phone's card says what a run found without a "Result" over it.
      hideTitleOnMobile: true,
      wrapContent: true,
      wrapMaxWidthClassName: "max-w-[18rem]",
      contentClassName: "min-w-[8rem]",
      getElement: (run: SecurityHuntRun): ReactElement => {
        return (
          <FoundCell
            run={run}
            onShowWindow={props.onShowWindow}
            refusals={refusals}
          />
        );
      },
    },
  ];

  return (
    <SideOver
      title={RUN_HISTORY_TITLE}
      description={RUN_HISTORY_DESCRIPTION}
      onClose={props.onClose}
    >
      <div data-testid={HUNTS_TEST_IDS.runHistory}>
        <Table<SecurityHuntRun>
          id={HUNTS_TEST_IDS.runHistoryTable}
          data={runs}
          columns={columns}
          singularLabel={RUN_SINGULAR}
          pluralLabel={RUN_PLURAL}
          isLoading={isLoading}
          error={error}
          onRefreshClick={() => {
            setReadCount((value: number): number => {
              return value + 1;
            });
          }}
          noItemsMessage={RUN_HISTORY_EMPTY}
          currentPageNumber={page}
          totalItemsCount={count}
          itemsOnPage={pageSize}
          onNavigateToPage={(pageNumber: number, itemsOnPage: number) => {
            setPage(pageNumber);
            setPageSize(itemsOnPage);
          }}
          // Newest first, always: a history is read from its latest run.
          sortBy={null}
          sortOrder={SortOrder.Descending}
          onSortChanged={() => {
            // No column sorts.
          }}
          getRowProps={(run: SecurityHuntRun) => {
            return {
              "data-testid": `${HUNTS_TEST_IDS.runRow}-${run._id?.toString() || ""}`,
              "data-state": getSecurityHuntRunResult(run),
            } as React.HTMLAttributes<HTMLElement>;
          }}
        />
      </div>
    </SideOver>
  );
};

export default HuntRunHistory;
