import React, { FunctionComponent, ReactElement, useMemo } from "react";
import Route from "Common/Types/API/Route";
import DashboardProfileFlameGraphComponent from "Common/Types/Dashboard/DashboardComponents/DashboardProfileFlameGraphComponent";
import IconProp from "Common/Types/Icon/IconProp";
import JSONFunctions from "Common/Types/JSONFunctions";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import Navigation from "Common/UI/Utils/Navigation";
import {
  TranslatableTerm,
  translatableTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { TelemetryEntityNameMap } from "Common/UI/Utils/Telemetry/TelemetryEntityNames";
import useTelemetryEntityNames from "Common/UI/Utils/Telemetry/UseTelemetryEntityNames";
import { readProfileWidgetServiceId } from "Common/Utils/Dashboard/Components/DashboardProfileWidgetShared";
import {
  PROFILE_KIND_LABELS,
  PROFILE_KIND_NOUNS,
} from "../../../Utils/ProfilesView";
import { FLAME_TITLES, HEADLINE_NO_DATA } from "../../Profiles/ProfileCopy";
import FlamegraphView, {
  FlamegraphNode,
  normaliseServerFlamegraphNode,
} from "../../Profiles/FlamegraphView";
import {
  ProfileFlamegraphAnswer,
  fetchFlamegraph,
} from "../../Profiles/ProfilesApi";
import useProfileRequest, {
  ProfileRequestState,
} from "../../Profiles/UseProfileRequest";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import { getProfileWidgetProfilerRoute } from "./ProfileWidgetData";
import {
  PROFILE_WIDGET_ALL_SERVICES,
  PROFILE_WIDGET_INVALID_RANGE,
  PROFILE_WIDGET_NOT_ON_PUBLIC_DASHBOARDS,
  PROFILE_WIDGET_THIS_SERVICE,
} from "./ProfileWidgetCopy";
import ProfileWidgetHeader from "./ProfileWidgetHeader";
import useProfileWidget, {
  ProfileWidgetAnswer,
  ProfileWidgetState,
} from "./UseProfileWidget";
import WidgetPlaceholder from "./WidgetPlaceholder";

/*
 * FLAME GRAPH: WHERE THE TIME GOES, AS ONE PICTURE.
 *
 * Every profile of a service (or of every profiled service) in the
 * dashboard's time range, merged into the Profiler's flame graph, compact:
 * the wider a frame, the bigger its share; hover one for its numbers,
 * click one to zoom in. Zoomed in, "Callers & callees" opens the Profiler
 * on that function; the icon beside the title opens it on the whole graph.
 *
 * Its reads are the Profiler's own (UseProfileWidget, ProfilesApi), so the
 * tile and the Profiler one click later draw the same graph.
 */

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardProfileFlameGraphComponent;
}

export const PROFILE_FLAME_GRAPH_TEST_ID: string = "profile-flame-graph";

// The widget's own padding (12px a side, 28px on top while editing).
const VIEW_PADDING_IN_PX: number = 24;
const EDIT_PADDING_IN_PX: number = 40;
// The title and the line under it.
const HEADER_IN_PX: number = 46;
// The fewest pixels of graph the widget draws, however small it is.
const MIN_GRAPH_IN_PX: number = 88;

const DashboardProfileFlameGraphComponentElement: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const translator: Translator = useTranslator();
  // A word of the product's, in the reader's language (English when it has none).
  const t: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };
  const args: DashboardProfileFlameGraphComponent["arguments"] =
    props.component.arguments || {};

  const state: ProfileWidgetState = useProfileWidget({
    serviceId: args.serviceId,
    profileKind: args.profileKind,
    dashboardStartAndEndDate: props.dashboardStartAndEndDate,
    variables: props.variables,
    refreshTick: props.refreshTick,
  });

  const flame: ProfileRequestState<
    ProfileWidgetAnswer<ProfileFlamegraphAnswer>
  > = useProfileRequest<ProfileWidgetAnswer<ProfileFlamegraphAnswer>>(
    state.readKey ? `flame|${state.readKey}` : null,
    async (): Promise<ProfileWidgetAnswer<ProfileFlamegraphAnswer>> => {
      return {
        forKey: state.contentKey,
        value: await fetchFlamegraph({
          window: {
            startTime: state.window!.startTime,
            endTime: state.window!.endTime,
          },
          serviceIds: state.scope.serviceIds,
          profileTypes: state.kind.queryTypes,
        }),
      };
    },
  );

  // A refresh keeps the graph drawn; another service or kind never does.
  const answer: ProfileFlamegraphAnswer | null =
    state.hasData && flame.data && flame.data.forKey === state.contentKey
      ? flame.data.value
      : null;

  const root: FlamegraphNode | null = useMemo(() => {
    return answer ? normaliseServerFlamegraphNode(answer.root) : null;
  }, [answer]);

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
        data-testid={PROFILE_FLAME_GRAPH_TEST_ID}
      >
        {customTitle ? (
          <div className="mb-1 truncate px-1 text-sm font-medium text-gray-700">
            <IsolatedText text={customTitle} />
          </div>
        ) : (
          <></>
        )}
        <div className="min-h-0 flex-1">
          <WidgetPlaceholder
            icon={IconProp.Fire}
            message={PROFILE_WIDGET_NOT_ON_PUBLIC_DASHBOARDS}
          />
        </div>
      </div>
    );
  }

  const isNavigable: boolean =
    !props.isEditMode && !props.isPlayback && state.window !== null;

  const getRoute: (frame?: {
    functionName: string;
    fileName: string;
  }) => Route | null = (frame?: {
    functionName: string;
    fileName: string;
  }): Route | null => {
    if (!isNavigable || !state.window) {
      return null;
    }

    return getProfileWidgetProfilerRoute({
      serviceIds: state.scope.serviceIds,
      kind: state.category,
      window: state.window,
      functionName: frame?.functionName,
      fileName: frame?.fileName,
    });
  };

  const services: Array<string> =
    state.scope.kind === "pinned" && pinnedServiceId
      ? [names[pinnedServiceId]?.name || t(PROFILE_WIDGET_THIS_SERVICE)]
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

  const graphHeight: number = Math.max(
    MIN_GRAPH_IN_PX,
    props.dashboardComponentHeightInPx -
      (props.isEditMode ? EDIT_PADDING_IN_PX : VIEW_PADDING_IN_PX) -
      HEADER_IN_PX,
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
        `${PROFILE_FLAME_GRAPH_TEST_ID}-invalid-range`,
      );
    }

    const error: string = state.error || (answer ? "" : flame.error);

    if (error) {
      return (
        <ErrorMessage
          message={error}
          onRefreshClick={() => {
            if (state.error) {
              state.retry();
              return;
            }

            flame.reload();
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

    if (!state.hasData || !root || root.totalValue <= 0) {
      return quiet(
        translator.translateTemplate(HEADLINE_NO_DATA, { kind: kindNoun }),
        `${PROFILE_FLAME_GRAPH_TEST_ID}-empty`,
      );
    }

    return (
      <div
        data-testid={`${PROFILE_FLAME_GRAPH_TEST_ID}-graph`}
        style={{
          opacity: flame.isLoading ? 0.5 : 1,
          transition: "opacity 0.2s ease-in-out",
        }}
      >
        <FlamegraphView
          root={root}
          unit={state.kind.unit}
          compact={true}
          maxHeight={graphHeight}
          truncated={Boolean(answer?.truncated)}
          onFocusFunction={
            isNavigable
              ? (frame: { functionName: string; fileName: string }) => {
                  const route: Route | null = getRoute(frame);

                  if (route) {
                    Navigation.navigate(route);
                  }
                }
              : undefined
          }
        />
      </div>
    );
  };

  return (
    <div
      className="flex h-full w-full flex-col"
      data-testid={PROFILE_FLAME_GRAPH_TEST_ID}
    >
      <ProfileWidgetHeader
        title={customTitle || t(FLAME_TITLES[state.category])}
        isTitleAsWritten={Boolean(customTitle)}
        services={services}
        areServicesAsWritten={areServicesAsWritten}
        kindLabel={t(PROFILE_KIND_LABELS[state.category])}
        isWindowCapped={Boolean(state.window?.isCapped)}
        profilerRoute={getRoute()}
        dataTestId={PROFILE_FLAME_GRAPH_TEST_ID}
      />
      <div className="min-h-0 flex-1 overflow-auto">{renderBody()}</div>
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
  DashboardProfileFlameGraphComponentElement,
  arePropsEqual,
);
