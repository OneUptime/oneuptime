import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";
import AIRun from "Common/Models/DatabaseModels/AIRun";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import Route from "Common/Types/API/Route";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import CodeFixRunStatusPill, {
  getCodeFixTaskTypeLabel,
} from "./CodeFixRunStatus";

const PAGE_SIZE: number = 50;
const MAX_ERROR_LENGTH: number = 120;

/*
 * A row of the list: the AIRun plus its task-type discriminator. The
 * discriminator rides on the list response as `codeFixTaskType` (never
 * null — the server normalizes legacy rows to "FixException"), so it is
 * read from the raw JSON rather than the AIRun model.
 */
interface CodeFixRunRow {
  run: AIRun;
  taskType: string;
}

/*
 * The AI Agent Tasks list: exception code tasks (CodeFix AIRuns — fixes and
 * regression tests), newest first. These are system-authored runs hidden
 * from the generic AIRun CRUD by the per-user privacy pin, so this table
 * reads them through the dedicated /code-fix-run/list endpoint instead of
 * ModelTable.
 */
const CodeFixRunsTable: FunctionComponent = (): ReactElement => {
  const [rows, setRows] = useState<Array<CodeFixRunRow>>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [skip, setSkip] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | undefined>(undefined);

  const fetchRuns: (skipCount: number) => Promise<void> = useCallback(
    async (skipCount: number): Promise<void> => {
      try {
        setIsLoading(true);
        setError(undefined);

        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              "/code-fix-run/list",
            ),
            data: { limit: PAGE_SIZE, skip: skipCount },
            headers: ModelAPI.getCommonHeaders(),
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        const data: JSONObject = response.data as JSONObject;
        const runsJson: JSONArray = (data["runs"] as JSONArray) || [];

        setRows(
          runsJson.map((runJson: JSONObject): CodeFixRunRow => {
            return {
              run: AIRun.fromJSONObject(runJson, AIRun),
              taskType:
                (runJson["codeFixTaskType"] as string) || "FixException",
            };
          }),
        );
        setTotalCount((data["count"] as number) || 0);
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }

      setIsLoading(false);
    },
    [],
  );

  useEffect(() => {
    fetchRuns(skip).catch(() => {
      // handled inside fetchRuns
    });
  }, [fetchRuns, skip]);

  type NavigateToRunFunction = (run: AIRun) => void;

  const navigateToRun: NavigateToRunFunction = (run: AIRun): void => {
    if (!run.id) {
      return;
    }

    Navigation.navigate(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.AI_AGENT_TASK_VIEW] as Route,
        {
          modelId: run.id,
        },
      ),
    );
  };

  type FormatDateFunction = (date: Date | undefined) => string;

  const formatDate: FormatDateFunction = (date: Date | undefined): string => {
    if (!date) {
      return "-";
    }

    return OneUptimeDate.getDateAsLocalFormattedString(date);
  };

  type TruncateFunction = (text: string | undefined) => string;

  const truncateError: TruncateFunction = (
    text: string | undefined,
  ): string => {
    if (!text) {
      return "-";
    }

    if (text.length <= MAX_ERROR_LENGTH) {
      return text;
    }

    return `${text.substring(0, MAX_ERROR_LENGTH)}…`;
  };

  const hasPreviousPage: boolean = skip > 0;
  const hasNextPage: boolean = skip + PAGE_SIZE < totalCount;

  return (
    <Card
      title="AI Agent Tasks"
      description="Exception code tasks executed by the AI agent — fixes and regression tests, newest first. Open a task to watch what the agent did step by step."
      buttons={[
        {
          title: "Refresh",
          icon: IconProp.Refresh,
          buttonStyle: ButtonStyleType.NORMAL,
          onClick: () => {
            fetchRuns(skip).catch(() => {
              // handled inside fetchRuns
            });
          },
        },
      ]}
    >
      {isLoading ? <ComponentLoader /> : <></>}

      {!isLoading && error ? <ErrorMessage message={error} /> : <></>}

      {!isLoading && !error && rows.length === 0 ? (
        <p className="text-sm text-gray-500">
          No AI agent tasks yet. New tasks will appear here when you start a fix
          or a regression test from an exception page (Telemetry &gt;
          Exceptions).
        </p>
      ) : (
        <></>
      )}

      {!isLoading && !error && rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead>
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Type
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Status
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Created At
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Started At
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Completed At
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Error
                </th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-gray-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row: CodeFixRunRow): ReactElement => {
                const run: AIRun = row.run;
                return (
                  <tr key={run.id?.toString()}>
                    <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-600">
                      {getCodeFixTaskTypeLabel(row.taskType)}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <CodeFixRunStatusPill status={run.status} />
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-600">
                      {formatDate(run.createdAt)}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-600">
                      {formatDate(run.startedAt)}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-600">
                      {formatDate(run.completedAt)}
                    </td>
                    <td
                      className="px-3 py-3 text-sm text-gray-600"
                      title={run.errorMessage || ""}
                    >
                      {truncateError(run.errorMessage)}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-right">
                      <Button
                        title="View"
                        icon={IconProp.ExternalLink}
                        buttonSize={ButtonSize.Small}
                        buttonStyle={ButtonStyleType.OUTLINE}
                        onClick={() => {
                          navigateToRun(run);
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="mt-4 flex items-center justify-between">
            <p className="text-xs text-gray-500">
              Showing {totalCount === 0 ? 0 : skip + 1}–
              {Math.min(skip + PAGE_SIZE, totalCount)} of {totalCount}{" "}
              {totalCount === 1 ? "task" : "tasks"}
            </p>

            {hasPreviousPage || hasNextPage ? (
              <div className="flex gap-2">
                <Button
                  title="Previous"
                  buttonSize={ButtonSize.Small}
                  buttonStyle={ButtonStyleType.NORMAL}
                  disabled={!hasPreviousPage}
                  onClick={() => {
                    setSkip(Math.max(skip - PAGE_SIZE, 0));
                  }}
                />
                <Button
                  title="Next"
                  buttonSize={ButtonSize.Small}
                  buttonStyle={ButtonStyleType.NORMAL}
                  disabled={!hasNextPage}
                  onClick={() => {
                    setSkip(skip + PAGE_SIZE);
                  }}
                />
              </div>
            ) : (
              <></>
            )}
          </div>
        </div>
      ) : (
        <></>
      )}
    </Card>
  );
};

export default CodeFixRunsTable;
