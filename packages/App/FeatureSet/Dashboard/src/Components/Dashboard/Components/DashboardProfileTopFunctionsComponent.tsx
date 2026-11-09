import React, { FunctionComponent, ReactElement, useMemo } from "react";
import { Link } from "react-router-dom";
import Route from "Common/Types/API/Route";
import { DashboardProfileTopFunctionsRank } from "Common/Types/Dashboard/DashboardComponents/DashboardProfileTopFunctionsComponent";
import DashboardProfileTopFunctionsComponent from "Common/Types/Dashboard/DashboardComponents/DashboardProfileTopFunctionsComponent";
import IconProp from "Common/Types/Icon/IconProp";
import JSONFunctions from "Common/Types/JSONFunctions";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import InlineSeparator from "Common/UI/Components/InlineSeparator/InlineSeparator";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import {
  TranslatableTerm,
  translatableTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { TelemetryEntityNameMap } from "Common/UI/Utils/Telemetry/TelemetryEntityNames";
import useTelemetryEntityNames from "Common/UI/Utils/Telemetry/UseTelemetryEntityNames";
import {
  readProfileWidgetRank,
  readProfileWidgetRows,
  readProfileWidgetServiceId,
} from "Common/Utils/Dashboard/Components/DashboardProfileWidgetShared";
import { ProfileFrameOrigin } from "Common/Utils/Profiles/ProfileFrames";
import {
  formatProfileShare,
  formatProfileValue,
} from "Common/Utils/Profiles/ProfileTypes";
import ProfileUtil from "../../../Utils/ProfileUtil";
import {
  PROFILE_KIND_LABELS,
  PROFILE_KIND_NOUNS,
  getProfileOrigin,
} from "../../../Utils/ProfilesView";
import {
  FUNCTIONS_OWN_EMPTY,
  HEADLINE_NO_DATA,
  PROFILE_ORIGIN_LABELS,
  SORT_BY_SELF,
  SORT_BY_TOTAL,
  VIEW_YOUR_CODE,
} from "../../Profiles/ProfileCopy";
import { ORIGIN_TO_MODULE } from "../../Profiles/ProfileFunctionTable";
import {
  ProfileFunctionListAnswer,
  fetchFunctionList,
} from "../../Profiles/ProfilesApi";
import useProfileRequest, {
  ProfileRequestState,
} from "../../Profiles/UseProfileRequest";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import {
  PROFILE_WIDGET_FUNCTION_READ_LIMIT,
  ProfileWidgetFunctionRow,
  getProfileWidgetFunctionRows,
  getProfileWidgetFunctionSort,
  getProfileWidgetProfilerRoute,
} from "./ProfileWidgetData";
import {
  PROFILE_WIDGET_ALL_SERVICES,
  PROFILE_WIDGET_INVALID_RANGE,
  PROFILE_WIDGET_OPEN_FUNCTION,
  PROFILE_WIDGET_THIS_SERVICE,
  PROFILE_WIDGET_TOP_FUNCTIONS_TITLE,
} from "./ProfileWidgetCopy";
import ProfileWidgetHeader from "./ProfileWidgetHeader";
import useProfileWidget, {
  ProfileWidgetAnswer,
  ProfileWidgetState,
} from "./UseProfileWidget";
import WidgetPlaceholder from "./WidgetPlaceholder";

/*
 * TOP FUNCTIONS: WHAT TAKES THE MOST, RANKED.
 *
 * The functions that take the most of a kind of profile - CPU time,
 * memory, lock waits - in the dashboard's time range, ranked the way the
 * Profiler ranks them (Self, Total, or only Your code), each with its
 * share of the window and what that share is. A function's name opens the
 * Profiler on it: its callers, what it calls, its source, a monitor on its
 * share.
 *
 *   1  ■ JSON.parse                                     42%
 *        node:internal/json · Runtime                12.4 s
 *        ▇▇▇▇▇▇▇▇▇░░░░░░░░░░░
 *
 * Its reads are the Profiler's own (UseProfileWidget, ProfilesApi), so the
 * tile and the Profiler one click later list the same functions.
 */

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardProfileTopFunctionsComponent;
}

export const PROFILE_TOP_FUNCTIONS_TEST_ID: string = "profile-top-functions";

const RANK_LABELS: Record<DashboardProfileTopFunctionsRank, string> = {
  self: SORT_BY_SELF,
  total: SORT_BY_TOTAL,
  own: VIEW_YOUR_CODE,
};

const DashboardProfileTopFunctionsComponentElement: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const translator: Translator = useTranslator();
  // A word of the product's, in the reader's language (English when it has none).
  const t: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };
  const args: DashboardProfileTopFunctionsComponent["arguments"] =
    props.component.arguments || {};

  const state: ProfileWidgetState = useProfileWidget({
    serviceId: args.serviceId,
    profileKind: args.profileKind,
    dashboardStartAndEndDate: props.dashboardStartAndEndDate,
    variables: props.variables,
    refreshTick: props.refreshTick,
  });

  const rank: DashboardProfileTopFunctionsRank = readProfileWidgetRank(
    args.rankBy,
  );
  const maxRows: number = readProfileWidgetRows(args.maxRows);
  const answerKey: string = `${state.contentKey}|${rank}`;

  const functions: ProfileRequestState<
    ProfileWidgetAnswer<ProfileFunctionListAnswer>
  > = useProfileRequest<ProfileWidgetAnswer<ProfileFunctionListAnswer>>(
    state.readKey ? `functions|${state.readKey}|${rank}` : null,
    async (): Promise<ProfileWidgetAnswer<ProfileFunctionListAnswer>> => {
      return {
        forKey: answerKey,
        value: await fetchFunctionList({
          window: {
            startTime: state.window!.startTime,
            endTime: state.window!.endTime,
          },
          serviceIds: state.scope.serviceIds,
          profileTypes: state.kind.queryTypes,
          sortBy: getProfileWidgetFunctionSort(rank),
          limit: PROFILE_WIDGET_FUNCTION_READ_LIMIT,
        }),
      };
    },
  );

  // A refresh keeps the rows drawn; another service, kind or ranking never does.
  const answer: ProfileFunctionListAnswer | null =
    state.hasData && functions.data && functions.data.forKey === answerKey
      ? functions.data.value
      : null;

  const rows: Array<ProfileWidgetFunctionRow> = useMemo(() => {
    return answer
      ? getProfileWidgetFunctionRows({
          rows: answer.functions,
          windowTotal: answer.windowTotal,
          rank,
          maxRows,
        })
      : [];
  }, [answer, rank, maxRows]);

  const pinnedServiceId: string | null = readProfileWidgetServiceId(
    args.serviceId,
  );
  const names: TelemetryEntityNameMap = useTelemetryEntityNames(
    pinnedServiceId ? [pinnedServiceId] : [],
  );

  const customTitle: string = (args.title || "").trim();

  if (state.isPublic) {
    return (
      <div
        className="flex h-full w-full flex-col"
        data-testid={PROFILE_TOP_FUNCTIONS_TEST_ID}
      >
        {customTitle ? (
          <div className="mb-1 truncate px-1 text-sm font-medium text-gray-700">
            <IsolatedText text={customTitle} />
          </div>
        ) : (
          <></>
        )}
        <div className="min-h-0 flex-1">
          {/*
           * A public dashboard reads no profiles: a profile names the code
           * it ran - functions, files, lines - which a page anyone with the
           * link can open must not show.
           */}
          <WidgetPlaceholder
            icon={IconProp.Fire}
            message="Profile widgets are not available on public dashboards."
          />
        </div>
      </div>
    );
  }

  const isNavigable: boolean =
    !props.isEditMode && !props.isPlayback && state.window !== null;

  const getRoute: (row?: ProfileWidgetFunctionRow) => Route | null = (
    row?: ProfileWidgetFunctionRow,
  ): Route | null => {
    if (!isNavigable || !state.window) {
      return null;
    }

    return getProfileWidgetProfilerRoute({
      serviceIds: state.scope.serviceIds,
      kind: state.category,
      window: state.window,
      functionName: row?.functionName,
      fileName: row?.fileName,
    });
  };

  const services: Array<string> =
    state.scope.kind === "pinned" && pinnedServiceId
      ? [
          names[pinnedServiceId]?.name || t(PROFILE_WIDGET_THIS_SERVICE),
        ]
      : state.scope.kind === "variable"
        ? state.variableServiceNames || []
        : [t(PROFILE_WIDGET_ALL_SERVICES)];

  const areServicesAsWritten: boolean =
    state.scope.kind === "variable" ||
    (state.scope.kind === "pinned" &&
      Boolean(pinnedServiceId && names[pinnedServiceId]));

  const kindNoun: TranslatableTerm = translatableTerm(
    PROFILE_KIND_NOUNS[state.category],
    { inSentence: true },
  );

  const quiet: (text: string, testId: string) => ReactElement = (
    text: string,
    testId: string,
  ): ReactElement => {
    return (
      <div
        className="flex h-full items-center justify-center px-4 text-center text-xs text-gray-500"
        data-testid={testId}
      >
        {text}
      </div>
    );
  };

  const renderBody: () => ReactElement = (): ReactElement => {
    if (!state.window) {
      return quiet(
        t(PROFILE_WIDGET_INVALID_RANGE),
        `${PROFILE_TOP_FUNCTIONS_TEST_ID}-invalid-range`,
      );
    }

    const error: string = state.error || (answer ? "" : functions.error);

    if (error) {
      return (
        <ErrorMessage
          message={error}
          onRefreshClick={() => {
            if (state.error) {
              state.retry();
              return;
            }

            functions.reload();
          }}
        />
      );
    }

    if (state.isLoading || (state.hasData && !answer)) {
      return (
        <div className="flex h-full items-center justify-center">
          <ComponentLoader />
        </div>
      );
    }

    if (!state.hasData || !answer || answer.functions.length === 0) {
      return quiet(
        translator.translateTemplate(HEADLINE_NO_DATA, { kind: kindNoun }),
        `${PROFILE_TOP_FUNCTIONS_TEST_ID}-empty`,
      );
    }

    if (rows.length === 0) {
      return quiet(
        t(FUNCTIONS_OWN_EMPTY),
        `${PROFILE_TOP_FUNCTIONS_TEST_ID}-empty`,
      );
    }

    return (
      <ol
        className="divide-y divide-gray-100"
        data-testid={`${PROFILE_TOP_FUNCTIONS_TEST_ID}-rows`}
        data-rank={rank}
        style={{
          opacity: functions.isLoading ? 0.5 : 1,
          transition: "opacity 0.2s ease-in-out",
        }}
      >
        {rows.map((row: ProfileWidgetFunctionRow, index: number) => {
          const origin: ProfileFrameOrigin = getProfileOrigin(row);
          const frameStyle: { bg: string } = ProfileUtil.getModuleFrameStyle(
            ORIGIN_TO_MODULE[origin],
            0.8,
          );
          const name: string = row.functionName || t("(anonymous)");
          const where: string = row.fileName
            ? `${ProfileUtil.formatFileName(row.fileName, 64)}${
                row.lineNumber > 0 ? `:${row.lineNumber}` : ""
              }`
            : "";
          const route: Route | null = getRoute(row);
          const nameClassName: string =
            "min-w-0 truncate font-mono text-[13px] font-medium text-gray-900";

          return (
            <li
              key={`${row.functionName}\u0000${row.fileName}`}
              className="flex items-start gap-2 px-1 py-1"
              data-testid={`${PROFILE_TOP_FUNCTIONS_TEST_ID}-row`}
            >
              <span className="mt-0.5 w-5 flex-none text-right font-mono text-[11px] text-gray-400">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span
                    className={`inline-block h-2 w-2 flex-none rounded-sm ${frameStyle.bg}`}
                    aria-hidden="true"
                  />
                  {route ? (
                    <Link
                      to={route.toString()}
                      className={`${nameClassName} rounded-sm hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`}
                      title={translator.translateTemplate(
                        PROFILE_WIDGET_OPEN_FUNCTION,
                        { function: name },
                      )}
                      data-testid={`${PROFILE_TOP_FUNCTIONS_TEST_ID}-name`}
                    >
                      <IsolatedText text={name} />
                    </Link>
                  ) : (
                    <span
                      className={nameClassName}
                      title={name}
                      data-testid={`${PROFILE_TOP_FUNCTIONS_TEST_ID}-name`}
                    >
                      <IsolatedText text={name} />
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex min-w-0 items-center gap-x-1 text-[11px] text-gray-500">
                  {where ? (
                    <>
                      <IsolatedText
                        text={where}
                        title={row.fileName}
                        className="min-w-0 truncate font-mono"
                      />
                      <span aria-hidden="true">
                        <InlineSeparator markOnly />
                      </span>
                    </>
                  ) : (
                    <></>
                  )}
                  <span
                    className={`flex-none ${
                      origin === ProfileFrameOrigin.Own
                        ? "font-medium text-orange-700"
                        : ""
                    }`}
                    data-testid={`${PROFILE_TOP_FUNCTIONS_TEST_ID}-origin`}
                  >
                    {t(PROFILE_ORIGIN_LABELS[origin])}
                  </span>
                </div>
                <div
                  className="mt-1 h-1 w-full overflow-hidden rounded-full bg-gray-100"
                  aria-hidden="true"
                >
                  <div
                    className={`h-full rounded-full ${
                      rank === "own" ? "bg-orange-400" : "bg-indigo-500"
                    }`}
                    style={{ width: `${Math.min(100, row.share)}%` }}
                  />
                </div>
              </div>
              <div className="flex-none text-right">
                <div
                  className="font-mono text-[13px] font-semibold text-gray-900"
                  data-testid={`${PROFILE_TOP_FUNCTIONS_TEST_ID}-share`}
                >
                  {formatProfileShare(row.share)}
                </div>
                <div
                  className="font-mono text-[11px] text-gray-500"
                  data-testid={`${PROFILE_TOP_FUNCTIONS_TEST_ID}-value`}
                >
                  {formatProfileValue(row.value, state.kind.unit)}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    );
  };

  return (
    <div
      className="flex h-full w-full flex-col"
      data-testid={PROFILE_TOP_FUNCTIONS_TEST_ID}
    >
      <ProfileWidgetHeader
        title={customTitle || t(PROFILE_WIDGET_TOP_FUNCTIONS_TITLE)}
        isTitleAsWritten={Boolean(customTitle)}
        services={services}
        areServicesAsWritten={areServicesAsWritten}
        kindLabel={t(PROFILE_KIND_LABELS[state.category])}
        rankLabel={t(RANK_LABELS[rank])}
        isWindowCapped={Boolean(state.window?.isCapped)}
        profilerRoute={getRoute()}
        dataTestId={PROFILE_TOP_FUNCTIONS_TEST_ID}
      />
      <div className="min-h-0 flex-1 overflow-auto">{renderBody()}</div>
      {answer && answer.truncated && rows.length > 0 ? (
        <p
          className="mt-1 flex-none px-1 text-[11px] text-gray-500"
          data-testid={`${PROFILE_TOP_FUNCTIONS_TEST_ID}-truncated`}
        >
          {translator.translateText(
            "This window held more distinct stacks than are read at once: the smallest are left out.",
          )}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

function arePropsEqual(prev: ComponentProps, next: ComponentProps): boolean {
  if (
    prev.componentId.toString() !== next.componentId.toString() ||
    prev.refreshTick !== next.refreshTick ||
    prev.isEditMode !== next.isEditMode ||
    prev.isSelected !== next.isSelected ||
    Boolean(prev.isPlayback) !== Boolean(next.isPlayback) ||
    prev.dashboardComponentWidthInPx !== next.dashboardComponentWidthInPx ||
    prev.dashboardComponentHeightInPx !== next.dashboardComponentHeightInPx
  ) {
    return false;
  }

  if (
    !JSONFunctions.deepEqual(
      prev.dashboardStartAndEndDate,
      next.dashboardStartAndEndDate,
    )
  ) {
    return false;
  }

  if (
    !JSONFunctions.deepEqual(prev.component.arguments, next.component.arguments)
  ) {
    return false;
  }

  // A pick of the dashboard's service variable moves what the widget reads.
  return JSONFunctions.deepEqual(prev.variables, next.variables);
}

export default React.memo(
  DashboardProfileTopFunctionsComponentElement,
  arePropsEqual,
);
