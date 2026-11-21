import {
  AI_RESULTS_RECORDS_EMPTY,
  AI_RESULTS_RECORDS_TEST_ID,
  AI_RESULTS_RECORDS_WHAT_FAILED,
  describeRecordSubject,
  describeRecordsCount,
  getRecordFacts,
  parseAiOutcomesRecords,
} from "./AiResultsRecordsData";
import { AiResultsRecordsTarget } from "./AiResultsData";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  AI_OUTCOMES_RECORDS_PATH,
  AiOutcomesPart,
  AiOutcomesRecord,
  AiOutcomesRecordSubject,
  AiOutcomesRecords,
} from "Common/Types/AI/AiOutcomes";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import CardListSkeleton from "Common/UI/Components/Skeleton/CardListSkeleton";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * WHAT AN AI RESULTS NUMBER COUNTS (issue #7768): the dialog a part of a
 * card's breakdown opens. "Paged: the hold time ran out (4)" lists the four
 * held pages, each with its incident or alert one click away; "Missed the
 * root cause (15)" the fifteen investigations, with what each found and how
 * it was judged; "Still happening after the fix (2)" the two fix pull
 * requests.
 *
 * The server lists exactly what the number counts, from the same window
 * (the outcomes' windowEnd), so the count under the title is the card's -
 * unless something changed since the page loaded. A page at a time, newest
 * first, with Show more. It is read and left: one way out, Close.
 */

export interface ComponentProps {
  target: AiResultsRecordsTarget;
  // The part's label, in English: the dialog's title.
  label: string;
  // When the page's numbers were counted (AiOutcomes.windowEnd).
  windowEnd: string;
  onClose: () => void;
}

function getSubjectRoute(subject: AiOutcomesRecordSubject): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[
      subject.kind === "incident"
        ? PageMap.INCIDENT_VIEW
        : subject.kind === "dataSecurityIssue"
          ? PageMap.DATA_SECURITY_ISSUE_VIEW
          : PageMap.ALERT_VIEW
    ] as Route,
    { modelId: subject.id },
  );
}

function When(props: { at: string }): ReactElement {
  const date: Date = OneUptimeDate.fromString(props.at);

  if (Number.isNaN(date.getTime())) {
    return <></>;
  }

  return (
    <time
      className="whitespace-nowrap text-xs text-gray-500"
      dateTime={props.at}
      title={OneUptimeDate.getDateAsFormattedString(date)}
    >
      {OneUptimeDate.getDateAsLocalDayMonthTimeString(date)}
    </time>
  );
}

function RecordRow(props: {
  part: AiOutcomesPart;
  record: AiOutcomesRecord;
}): ReactElement {
  const translator: Translator = useTranslator();
  const { record, part } = props;
  const facts: Array<string> = getRecordFacts(part, record);
  const pullRequestLabel: string =
    record.pullRequestNumber !== undefined
      ? translator.translateTemplate("Pull request #{{number}}", {
          number: record.pullRequestNumber,
        })
      : translator.translateText("Pull request") || "Pull request";

  return (
    <li
      className="py-3 first:pt-0 last:pb-0"
      data-testid={`${AI_RESULTS_RECORDS_TEST_ID}-item`}
      data-record-id={record.id}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          {record.subject ? (
            <Link
              to={getSubjectRoute(record.subject)}
              className="break-words text-sm font-medium text-gray-900 hover:text-indigo-700 hover:underline"
              dataTestId={`${AI_RESULTS_RECORDS_TEST_ID}-subject`}
            >
              {describeRecordSubject(record.subject)}
            </Link>
          ) : (
            <></>
          )}
          {part === AiOutcomesPart.PullRequestFixes ? (
            <p
              className="break-words text-sm text-gray-900"
              data-testid={`${AI_RESULTS_RECORDS_TEST_ID}-pull-request`}
            >
              {record.pullRequestUrl ? (
                <Link
                  to={URL.fromString(record.pullRequestUrl)}
                  openInNewTab={true}
                  className="font-medium text-indigo-600 hover:text-indigo-800 hover:underline"
                >
                  {pullRequestLabel}
                </Link>
              ) : (
                <span className="font-medium">{pullRequestLabel}</span>
              )}
              {record.pullRequestTitle ? (
                <span className="text-gray-600">{` · ${record.pullRequestTitle}`}</span>
              ) : (
                <></>
              )}
            </p>
          ) : (
            <></>
          )}
        </div>
        <When at={record.at} />
      </div>

      {record.summary ? (
        <p
          className="mt-1 break-words text-sm text-gray-600"
          data-testid={`${AI_RESULTS_RECORDS_TEST_ID}-summary`}
        >
          {record.summary}
        </p>
      ) : (
        <></>
      )}

      {record.runbookName || facts.length > 0 ? (
        <p
          className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-gray-500"
          data-testid={`${AI_RESULTS_RECORDS_TEST_ID}-facts`}
        >
          {record.runbookName ? (
            <span>
              {translator.translateTemplate("Runbook: {{name}}", {
                name: record.runbookName,
              })}
            </span>
          ) : (
            <></>
          )}
          {facts.map((fact: string): ReactElement => {
            return <span key={fact}>{translator.translateText(fact)}</span>;
          })}
        </p>
      ) : (
        <></>
      )}
    </li>
  );
}

const AiResultsRecordsDialog: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [records, setRecords] = useState<AiOutcomesRecords | null>(null);
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  // Only the newest read's answer counts: a slow first one never wins.
  const readCount: MutableRefObject<number> = useRef<number>(0);

  const readPage: (skip: number) => Promise<AiOutcomesRecords> = useCallback(
    async (skip: number): Promise<AiOutcomesRecords> => {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            AI_OUTCOMES_RECORDS_PATH,
          ),
          data: {
            part: props.target.part,
            outcome: props.target.outcome,
            windowEnd: props.windowEnd,
            ...(skip > 0 ? { skip } : {}),
          },
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      const parsed: AiOutcomesRecords | null = parseAiOutcomesRecords(
        response.data,
      );

      if (!parsed) {
        throw new Error(
          translator.translateText(AI_RESULTS_RECORDS_WHAT_FAILED),
        );
      }

      return parsed;
    },
    [props.target.part, props.target.outcome, props.windowEnd],
  );

  const loadFirstPage: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      const thisRead: number = ++readCount.current;
      setIsLoading(true);
      setError("");

      try {
        const page: AiOutcomesRecords = await readPage(0);

        if (thisRead === readCount.current) {
          setRecords(page);
        }
      } catch (err) {
        if (thisRead === readCount.current) {
          setError(API.getFriendlyMessage(err));
        }
      } finally {
        if (thisRead === readCount.current) {
          setIsLoading(false);
        }
      }
    }, [readPage]);

  const loadMore: () => Promise<void> = async (): Promise<void> => {
    if (!records || records.nextSkip === null) {
      return;
    }

    const thisRead: number = ++readCount.current;
    setIsLoadingMore(true);
    setError("");

    try {
      const page: AiOutcomesRecords = await readPage(records.nextSkip);

      if (thisRead === readCount.current) {
        setRecords({
          ...page,
          records: [...records.records, ...page.records],
        });
      }
    } catch (err) {
      if (thisRead === readCount.current) {
        setError(API.getFriendlyMessage(err));
      }
    } finally {
      if (thisRead === readCount.current) {
        setIsLoadingMore(false);
      }
    }
  };

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  const renderBody: () => ReactElement = (): ReactElement => {
    if (isLoading && !records) {
      return (
        <div data-testid={`${AI_RESULTS_RECORDS_TEST_ID}-loading`}>
          <CardListSkeleton count={3} lines={2} />
        </div>
      );
    }

    if (error && !records) {
      return (
        <div data-testid={`${AI_RESULTS_RECORDS_TEST_ID}-error`}>
          <ErrorMessage
            message={error}
            whatFailed={translator.translateText(
              AI_RESULTS_RECORDS_WHAT_FAILED,
            )}
            onRefreshClick={() => {
              void loadFirstPage();
            }}
          />
        </div>
      );
    }

    const list: Array<AiOutcomesRecord> = records?.records || [];

    if (list.length === 0) {
      return (
        <div
          data-testid={`${AI_RESULTS_RECORDS_TEST_ID}-empty`}
          className="flex items-start gap-3 rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-600"
        >
          <Icon
            icon={IconProp.Info}
            className="mt-0.5 h-4 w-4 flex-none text-gray-400"
          />
          <span>{translator.translateText(AI_RESULTS_RECORDS_EMPTY)}</span>
        </div>
      );
    }

    return (
      <div>
        <ul
          data-testid={`${AI_RESULTS_RECORDS_TEST_ID}-list`}
          className="divide-y divide-gray-100"
        >
          {list.map((record: AiOutcomesRecord): ReactElement => {
            return (
              <RecordRow
                key={record.id}
                part={props.target.part}
                record={record}
              />
            );
          })}
        </ul>
        {error ? (
          <div
            className="mt-4"
            data-testid={`${AI_RESULTS_RECORDS_TEST_ID}-more-error`}
          >
            <ErrorMessage
              message={error}
              whatFailed={translator.translateText(
                AI_RESULTS_RECORDS_WHAT_FAILED,
              )}
              onRefreshClick={() => {
                void loadMore();
              }}
            />
          </div>
        ) : (
          <></>
        )}
        {records && records.nextSkip !== null && !error ? (
          <div className="mt-4 flex justify-center">
            <Button
              title="Show more"
              buttonStyle={ButtonStyleType.LINK}
              buttonSize={ButtonSize.Small}
              isLoading={isLoadingMore}
              onClick={() => {
                void loadMore();
              }}
              dataTestId={`${AI_RESULTS_RECORDS_TEST_ID}-more`}
            />
          </div>
        ) : (
          <></>
        )}
      </div>
    );
  };

  return (
    <Modal
      title={translator.translateText(props.label) || props.label}
      isTitleTranslated={true}
      description={
        records
          ? describeRecordsCount(props.target.part, records.total, translator)
          : undefined
      }
      onClose={props.onClose}
      closeButtonText="Close"
      modalWidth={ModalWidth.Medium}
    >
      <div
        data-testid={AI_RESULTS_RECORDS_TEST_ID}
        data-part={props.target.part}
        data-outcome={props.target.outcome}
      >
        {renderBody()}
      </div>
    </Modal>
  );
};

export default AiResultsRecordsDialog;
