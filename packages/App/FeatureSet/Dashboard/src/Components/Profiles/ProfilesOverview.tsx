import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import TableEmptyState, {
  TableEmptyStateAction,
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import Navigation from "Common/UI/Utils/Navigation";
import {
  ResolvedTelemetryEntity,
  TelemetryEntityNameMap,
} from "Common/UI/Utils/Telemetry/TelemetryEntityNames";
import useTelemetryEntityNames from "Common/UI/Utils/Telemetry/UseTelemetryEntityNames";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  ProfileFunctionChange,
  getNotableOwnCodeGrowth,
  getNotableSlowdown,
} from "Common/Utils/Profiles/ProfileComparison";
import { ProfileFrameOrigin } from "Common/Utils/Profiles/ProfileFrames";
import { ProfileTypeActivity } from "Common/Utils/Profiles/ProfileTypes";
import AppLink from "../AppLink/AppLink";
import { getChangeEventMarkerLabel } from "../Metrics/Utils/UseEventTimeReferenceLines";
import TelemetryFirstStepsEmptyState from "../Telemetry/TelemetryFirstStepsEmptyState";
import {
  SHOW_PAST_WEEK_ACTION,
  TelemetryFirstStepsSignal,
} from "../Telemetry/TelemetryFirstSteps";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  MAX_PROFILES_WINDOW_MINUTES,
  ProfilesCompareMode,
  ProfilesUrlState,
  getProfilesQueryParams,
  parseProfilesUrlState,
} from "../../Utils/ProfilesUrlState";
import {
  MIN_MINUTES_AFTER_A_CHANGE,
  ProfileFunctionView,
  ProfileHeadlineFacts,
  ProfileKindChoice,
  ProfileKindChoices,
  ProfilesWindow,
  ProfilesWindowPair,
  getDefaultProfileSelection,
  getFunctionListSort,
  getProfileHeadlineFacts,
  getProfileKindChoices,
  getProfileOrigin,
  getProfilesComparison,
  getProfilesWindow,
  resolveProfileKind,
} from "../../Utils/ProfilesView";
import {
  ALL_PROFILES_LINK,
  COMPARED_WITH,
  COMPARED_WITH_NAMED_CHANGE,
  EMPTY_WINDOW_DESCRIPTION,
  EMPTY_WINDOW_TITLE,
  FUNCTIONS_COMPARE_TITLE,
  FUNCTIONS_TITLE,
  HEADLINE_CHANGE_TOO_RECENT,
  SORT_BY_SELF,
  SORT_BY_TOTAL,
  VIEW_ALL_FUNCTIONS,
  VIEW_YOUR_CODE,
} from "./ProfileCopy";
import ProfileFlameCard from "./ProfileFlameCard";
import ProfileFunctionPanel from "./ProfileFunctionPanel";
import ProfileFunctionTable from "./ProfileFunctionTable";
import ProfileHeadline, { ProfileHeadlineComparison } from "./ProfileHeadline";
import ProfileScopeBar, {
  ProfileDeployOption,
  ProfileScopeService,
} from "./ProfileScopeBar";
import ProfileServicesCard from "./ProfileServicesCard";
import { formatAgo, formatWindow } from "./ProfileTimeText";
import {
  ProfileComparisonAnswer,
  ProfileFunctionListAnswer,
  ProfileRecentChange,
  ProfileSourceLink,
  ProfiledEntity,
  fetchFunctionComparison,
  fetchFunctionList,
  fetchProfileTypes,
  fetchProfiledEntities,
  fetchRecentChanges,
  fetchSourceLinks,
} from "./ProfilesApi";
import useProfileRequest, { ProfileRequestState } from "./UseProfileRequest";

/*
 * THE PROFILER'S OVERVIEW.
 *
 * One page that answers, top to bottom:
 *
 *   1. What am I looking at? (ProfileScopeBar) A service, a kind of
 *      profile the scope has data for, a window - and what to compare it
 *      with: the period before, a day or a week ago, or a deploy.
 *   2. Where does it go? (ProfileHeadline) In words, before any chart:
 *      "checkout spent 41% of its CPU time in parseOrder", or - comparing -
 *      what got slower, or that nothing did.
 *   3. The flame graph (ProfileFlameCard), and the functions ranked with
 *      self and total explained where they are shown (ProfileFunctionTable).
 *   4. With every service in scope, which ones are profiled
 *      (ProfileServicesCard).
 *
 * Any function opens its panel (ProfileFunctionPanel): who calls it, what
 * it calls, a link to its source, a monitor on its share, and Fix with AI
 * where it applies.
 *
 * The view lives in the address (Utils/ProfilesUrlState), so it survives a
 * reload and can be opened from anywhere already pointed at the right
 * thing. On a service's (or host's) own Profiles tab the scope is locked
 * to it and the address leaves the service out. A locked page whose
 * resource sent no profile in 30 days shows the first steps alone: there
 * is no service, kind or window to pick yet.
 */

export interface ComponentProps {
  // A page about one resource: only its profiles, and no service picker.
  lockedEntityId?: string | undefined;
  // How the headline names it, when the page knows.
  lockedEntityName?: string | undefined;
  /*
   * Told, once the overview knows, whether the scope has any profile in
   * the last 30 days - so the page around it can leave out what would
   * only repeat "nothing yet" (a service's list of profiles).
   */
  onHasProfiles?: ((hasProfiles: boolean) => void) | undefined;
  /*
   * Draw nothing at all when the scope sent no profile in 30 days, for a
   * page that says so itself (a host's list also holds the profiles of
   * the services running on it).
   */
  isEmptyHidden?: boolean | undefined;
}

// How far back "is there any profile at all?" looks.
const EVER_DAYS: number = 30;

// How many functions are read for the list and the headline.
const FUNCTION_READ_LIMIT: number = 200;

// How many of the shown functions' files are looked up in repositories.
const SOURCE_LINK_FRAMES: number = 25;

const ENTITY_TYPES: ReadonlyArray<string> = Object.values(ServiceType);

const readUrlState: () => ProfilesUrlState = (): ProfilesUrlState => {
  return parseProfilesUrlState((name: string): string | null => {
    return Navigation.getQueryStringByName(name);
  });
};

const ProfilesOverview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isLocked: boolean = Boolean(props.lockedEntityId);

  const [urlState, setUrlState] = useState<ProfilesUrlState>(readUrlState);
  const [now, setNow] = useState<Date>(() => {
    return OneUptimeDate.getCurrentDate();
  });
  const [refreshCount, setRefreshCount] = useState<number>(0);
  const [functionView, setFunctionView] = useState<ProfileFunctionView>("self");
  const [highlight, setHighlight] = useState<string>("");

  // The address follows the view; a locked page's service is its route's.
  useEffect(() => {
    Navigation.setQueryString(
      getProfilesQueryParams(
        isLocked ? { ...urlState, serviceId: undefined } : urlState,
      ),
    );
  }, [urlState, isLocked]);

  const updateState: (change: Partial<ProfilesUrlState>) => void = useCallback(
    (change: Partial<ProfilesUrlState>): void => {
      setUrlState((previous: ProfilesUrlState): ProfilesUrlState => {
        return { ...previous, ...change };
      });
    },
    [],
  );

  const serviceId: string | null =
    props.lockedEntityId || urlState.serviceId || null;
  const serviceIds: Array<string> | undefined = serviceId
    ? [serviceId]
    : undefined;
  const serviceObjectIds: Array<ObjectID> | undefined = useMemo(() => {
    return serviceId ? [new ObjectID(serviceId)] : undefined;
  }, [serviceId]);

  const shownWindow: ProfilesWindow = useMemo(() => {
    return getProfilesWindow(urlState, now);
  }, [
    urlState.startTime?.getTime(),
    urlState.endTime?.getTime(),
    urlState.rangeMinutes,
    now.getTime(),
  ]);

  const windowKey: string = `${shownWindow.startTime.toISOString()}|${shownWindow.endTime.toISOString()}|${refreshCount}`;
  const scopeKey: string = `${serviceId || "all"}|${windowKey}`;

  // 1. The kinds of profile the scope has data for.
  const types: ProfileRequestState<Array<ProfileTypeActivity>> =
    useProfileRequest<Array<ProfileTypeActivity>>(`types|${scopeKey}`, () => {
      return fetchProfileTypes({ window: shownWindow, serviceIds });
    });

  const choices: ProfileKindChoices = useMemo(() => {
    return getProfileKindChoices(types.data || []);
  }, [types.data]);

  const kind: ProfileKindChoice = useMemo(() => {
    return resolveProfileKind({
      selection: urlState.profileType || getDefaultProfileSelection(choices),
      choices,
    });
  }, [urlState.profileType, choices]);

  const hasData: boolean = Boolean(types.data && types.data.length > 0);
  const kindKey: string = `${kind.selection}|${kind.queryTypes.join(",")}`;

  const comparison: ProfilesWindowPair | null = useMemo(() => {
    return getProfilesComparison(urlState, shownWindow, now);
  }, [
    urlState.compare,
    urlState.changeTime?.getTime(),
    shownWindow,
    now.getTime(),
  ]);

  // 2. With nothing in the window: anything in the last 30 days?
  const ever: ProfileRequestState<Array<ProfileTypeActivity>> =
    useProfileRequest<Array<ProfileTypeActivity>>(
      types.data && !hasData
        ? `ever|${serviceId || "all"}|${refreshCount}`
        : null,
      () => {
        return fetchProfileTypes({
          window: {
            startTime: new Date(
              now.getTime() - EVER_DAYS * 24 * 60 * 60 * 1000,
            ),
            endTime: now,
          },
          serviceIds,
        });
      },
    );

  // 3. The functions of one window.
  const functions: ProfileRequestState<ProfileFunctionListAnswer> =
    useProfileRequest<ProfileFunctionListAnswer>(
      hasData && !comparison
        ? `functions|${scopeKey}|${kindKey}|${functionView}`
        : null,
      () => {
        return fetchFunctionList({
          window: shownWindow,
          serviceIds,
          profileTypes: kind.queryTypes,
          sortBy: getFunctionListSort(functionView),
          limit: FUNCTION_READ_LIMIT,
        });
      },
    );

  // 4. Or two windows, side by side.
  const compared: ProfileRequestState<ProfileComparisonAnswer> =
    useProfileRequest<ProfileComparisonAnswer>(
      hasData && comparison
        ? `compare|${serviceId || "all"}|${kindKey}|${comparison.before.startTime.toISOString()}|${comparison.after.startTime.toISOString()}|${comparison.after.endTime.toISOString()}|${refreshCount}`
        : null,
      () => {
        return fetchFunctionComparison({
          before: comparison!.before,
          after: comparison!.after,
          serviceIds,
          profileTypes: kind.queryTypes,
          limit: FUNCTION_READ_LIMIT,
        });
      },
    );

  // 5. Where the shown functions of the application's own code live.
  const linkFrames: Array<{ fileName: string; lineNumber: number }> =
    useMemo(() => {
      const rows: Array<{
        functionName: string;
        fileName: string;
        lineNumber: number;
        frameType: string;
      }> = comparison
        ? compared.data?.changes || []
        : functions.data?.functions || [];
      const seen: Set<string> = new Set();
      const frames: Array<{ fileName: string; lineNumber: number }> = [];

      for (const row of rows) {
        if (
          !row.fileName ||
          getProfileOrigin(row) !== ProfileFrameOrigin.Own ||
          seen.has(row.fileName)
        ) {
          continue;
        }

        seen.add(row.fileName);
        frames.push({ fileName: row.fileName, lineNumber: row.lineNumber });

        if (frames.length >= SOURCE_LINK_FRAMES) {
          break;
        }
      }

      return frames;
    }, [comparison, compared.data, functions.data]);

  const linkKey: string = linkFrames
    .map((frame: { fileName: string; lineNumber: number }): string => {
      return `${frame.fileName}:${frame.lineNumber}`;
    })
    .join("\u0000");

  const links: ProfileRequestState<Array<ProfileSourceLink>> =
    useProfileRequest<Array<ProfileSourceLink>>(
      linkFrames.length > 0 ? `links|${linkKey}` : null,
      async (): Promise<Array<ProfileSourceLink>> => {
        try {
          return await fetchSourceLinks(linkFrames);
        } catch {
          // A link is a bonus: none is no error.
          return [];
        }
      },
    );

  // 6. What is profiled (every service in scope).
  const entities: ProfileRequestState<Array<ProfiledEntity>> =
    useProfileRequest<Array<ProfiledEntity>>(
      isLocked ? null : `entities|${windowKey}`,
      () => {
        return fetchProfiledEntities({ window: shownWindow });
      },
    );

  const entityIds: Array<string> = useMemo(() => {
    const ids: Array<string> = (entities.data || []).map(
      (entity: ProfiledEntity): string => {
        return entity.id;
      },
    );

    if (serviceId && !ids.includes(serviceId)) {
      ids.push(serviceId);
    }

    return ids;
  }, [entities.data, serviceId]);

  const typeHints: Record<string, ServiceType | undefined> = useMemo(() => {
    const hints: Record<string, ServiceType | undefined> = {};

    for (const entity of entities.data || []) {
      if (ENTITY_TYPES.includes(entity.entityType)) {
        hints[entity.id] = entity.entityType as ServiceType;
      }
    }

    return hints;
  }, [entities.data]);

  const names: TelemetryEntityNameMap = useTelemetryEntityNames(entityIds, {
    typeHints,
  });

  const scopeServices: Array<ProfileScopeService> = useMemo(() => {
    const list: Array<ProfileScopeService> = (entities.data || []).map(
      (entity: ProfiledEntity): ProfileScopeService => {
        const resolved: ResolvedTelemetryEntity | undefined = names[entity.id];

        return {
          id: entity.id,
          name: resolved?.name || entity.id,
          typeLabel:
            resolved && resolved.entityType !== ServiceType.OpenTelemetry
              ? resolved.typeLabel
              : undefined,
          sampleCount: entity.sampleCount,
        };
      },
    );

    // A service picked from a link, with nothing in this window, is named too.
    if (
      serviceId &&
      !list.some((service: ProfileScopeService): boolean => {
        return service.id === serviceId;
      })
    ) {
      list.push({
        id: serviceId,
        name: names[serviceId]?.name || serviceId,
        sampleCount: 0,
      });
    }

    return list.sort(
      (a: ProfileScopeService, b: ProfileScopeService): number => {
        return b.sampleCount - a.sampleCount || a.name.localeCompare(b.name);
      },
    );
  }, [entities.data, names, serviceId]);

  // 7. One service's recent deploys and changes, to compare across.
  const changes: ProfileRequestState<Array<ProfileRecentChange>> =
    useProfileRequest<Array<ProfileRecentChange>>(
      serviceId ? `changes|${serviceId}|${refreshCount}` : null,
      async (): Promise<Array<ProfileRecentChange>> => {
        try {
          return await fetchRecentChanges({ serviceId: serviceId!, now });
        } catch {
          // The compare menu then offers the earlier periods only.
          return [];
        }
      },
    );

  const deploys: Array<ProfileDeployOption> = (changes.data || []).map(
    (change: ProfileRecentChange): ProfileDeployOption => {
      return {
        time: change.time,
        label: getChangeEventMarkerLabel(change.eventType, change.title),
        whenText: formatAgo({ time: change.time, now, translator }),
      };
    },
  );

  // The change compared across, when the menu lists it.
  const comparedChange: ProfileDeployOption | undefined =
    urlState.compare === ProfilesCompareMode.Change && urlState.changeTime
      ? deploys.find((deploy: ProfileDeployOption): boolean => {
          return deploy.time.getTime() === urlState.changeTime!.getTime();
        })
      : undefined;

  /*
   * Whether the scope has any profile in the last 30 days: known once the
   * window's kinds are read and, with none, the 30 days' too.
   */
  const hasAnyProfiles: boolean | null = hasData
    ? true
    : types.data && ever.data
      ? ever.data.length > 0
      : null;
  const onHasProfiles: ((hasProfiles: boolean) => void) | undefined =
    props.onHasProfiles;

  useEffect(() => {
    if (hasAnyProfiles !== null && onHasProfiles) {
      onHasProfiles(hasAnyProfiles);
    }
  }, [hasAnyProfiles, onHasProfiles]);

  const serviceName: string | null = serviceId
    ? props.lockedEntityName ||
      names[serviceId]?.name ||
      translator.translateText("This service") ||
      "This service"
    : null;

  const windowText: string = formatWindow({
    startTime: shownWindow.startTime,
    endTime: shownWindow.endTime,
    isCustom: shownWindow.isCustom,
    translator,
  });

  const refresh: () => void = (): void => {
    setNow(OneUptimeDate.getCurrentDate());
    setRefreshCount((count: number): number => {
      return count + 1;
    });
  };

  const openFunction: (row: {
    functionName: string;
    fileName: string;
  }) => void = (row: { functionName: string; fileName: string }): void => {
    updateState({
      functionName: row.functionName,
      fileName: row.fileName || undefined,
    });
  };

  const toggleHighlight: (functionName: string) => void = (
    functionName: string,
  ): void => {
    setHighlight((previous: string): string => {
      return previous === functionName ? "" : functionName;
    });
  };

  const headlineFacts: ProfileHeadlineFacts | null = functions.data
    ? getProfileHeadlineFacts(
        functions.data.functions,
        functions.data.windowTotal,
      )
    : null;

  const headlineComparison: ProfileHeadlineComparison | null =
    comparison && compared.data
      ? {
          notable: getNotableSlowdown(compared.data.changes),
          ownGrowth: getNotableOwnCodeGrowth(compared.data.changes),
          isFooted: compared.data.isFooted,
          againstText:
            urlState.compare === ProfilesCompareMode.Change &&
            urlState.changeTime
              ? comparedChange
                ? translator.translateTemplate(COMPARED_WITH_NAMED_CHANGE, {
                    when: comparedChange.whenText,
                    change: comparedChange.label,
                  })
                : translator.translateTemplate(
                    COMPARED_WITH[ProfilesCompareMode.Change],
                    {
                      time: OneUptimeDate.getDateAsLocalFormattedString(
                        urlState.changeTime,
                      ),
                    },
                  )
              : translator.translateText(
                  COMPARED_WITH[
                    urlState.compare || ProfilesCompareMode.Previous
                  ],
                ) || "",
        }
      : null;

  const panelChange: ProfileFunctionChange | null =
    urlState.functionName && compared.data
      ? compared.data.changes.find((change: ProfileFunctionChange): boolean => {
          return (
            change.functionName === urlState.functionName &&
            change.fileName === (urlState.fileName || "")
          );
        }) || null
      : null;

  const allProfilesRoute: Route = useMemo(() => {
    const base: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.PROFILES_INSIGHTS] as Route,
    );
    const search: URLSearchParams = new URLSearchParams();

    if (serviceId) {
      search.set("serviceId", serviceId);
    }

    if (kind.isRawType) {
      search.set("profileType", kind.selection);
    }

    const query: string = search.toString();

    return query ? new Route(`${base.toString()}?${query}`) : base;
  }, [serviceId, kind.selection, kind.isRawType]);

  const scopeBar: ReactElement = (
    <ProfileScopeBar
      services={isLocked ? null : scopeServices}
      selectedServiceId={isLocked ? null : serviceId}
      onSelectService={(id: string | null) => {
        updateState({
          serviceId: id || undefined,
          functionName: undefined,
          fileName: undefined,
          // A deploy belongs to the service it was picked for.
          ...(urlState.compare === ProfilesCompareMode.Change
            ? { compare: undefined, changeTime: undefined }
            : {}),
        });
      }}
      choices={choices}
      selectedKind={kind}
      onSelectKind={(selection: string) => {
        updateState({ profileType: selection });
      }}
      rangeMinutes={urlState.rangeMinutes || 60}
      customWindow={
        shownWindow.isCustom
          ? { startTime: shownWindow.startTime, endTime: shownWindow.endTime }
          : null
      }
      onSelectRange={(minutes: number) => {
        setNow(OneUptimeDate.getCurrentDate());
        updateState({
          rangeMinutes: minutes,
          startTime: undefined,
          endTime: undefined,
        });
      }}
      compareMode={urlState.compare || null}
      changeTime={urlState.changeTime || null}
      deploys={deploys}
      onCompare={(mode: ProfilesCompareMode | null, changeTime?: Date) => {
        updateState({
          compare: mode || undefined,
          changeTime:
            mode === ProfilesCompareMode.Change ? changeTime : undefined,
        });
      }}
      onRefresh={refresh}
    />
  );

  const panel: ReactElement =
    urlState.functionName !== undefined && hasData ? (
      <ProfileFunctionPanel
        key={`${urlState.functionName}\u0000${urlState.fileName || ""}`}
        functionName={urlState.functionName}
        fileName={urlState.fileName || ""}
        serviceId={serviceId}
        kind={kind}
        startTime={shownWindow.startTime}
        endTime={shownWindow.endTime}
        comparison={comparison}
        change={panelChange}
        sourceLinks={links.data || []}
        isHighlighted={
          highlight.length > 0 && highlight === urlState.functionName
        }
        onHighlight={() => {
          toggleHighlight(urlState.functionName || "");
        }}
        onOpenFunction={openFunction}
        onClose={() => {
          updateState({ functionName: undefined, fileName: undefined });
        }}
      />
    ) : (
      <></>
    );

  // The kinds are not known yet: nothing else can be read.
  if (types.error) {
    return (
      <Fragment>
        {scopeBar}
        <ErrorMessage message={types.error} onRefreshClick={types.reload} />
      </Fragment>
    );
  }

  if (!types.data || (types.data && !hasData && ever.isLoading)) {
    return (
      <Fragment>
        {scopeBar}
        <ProfileHeadline
          serviceName={serviceName}
          kind={kind}
          windowText={windowText}
          isLoading={true}
          onOpenFunction={openFunction}
        />
      </Fragment>
    );
  }

  if (!hasData) {
    const hadProfiles: boolean = Boolean(ever.data && ever.data.length > 0);

    if (!hadProfiles && props.isEmptyHidden) {
      return <></>;
    }

    /*
     * No profile anywhere - or none for the resource a page is about: the
     * Profiler's first steps, and nothing else. A service picked in the
     * Profiler keeps the bar, to pick another.
     */
    if (!hadProfiles && (!serviceId || isLocked)) {
      return (
        <div className="rounded-xl border border-gray-200 bg-white">
          <TelemetryFirstStepsEmptyState
            signal={TelemetryFirstStepsSignal.Profiles}
          />
        </div>
      );
    }

    const windowMinutes: number =
      (shownWindow.endTime.getTime() - shownWindow.startTime.getTime()) /
      (60 * 1000);
    const actions: Array<TableEmptyStateAction> = [];

    if (hadProfiles && windowMinutes < MAX_PROFILES_WINDOW_MINUTES) {
      actions.push({
        title: SHOW_PAST_WEEK_ACTION,
        icon: IconProp.Calendar,
        dataTestId: "profiles-empty-window-past-week",
        onClick: (): void => {
          setNow(OneUptimeDate.getCurrentDate());
          updateState({
            rangeMinutes: MAX_PROFILES_WINDOW_MINUTES,
            startTime: undefined,
            endTime: undefined,
          });
        },
      });
    }

    return (
      <Fragment>
        {scopeBar}
        <div className="rounded-xl border border-gray-200 bg-white">
          {hadProfiles ? (
            <div className="px-4 sm:px-0">
              <TableEmptyState
                kind={TableEmptyStateKind.Filtered}
                icon={IconProp.Fire}
                title={EMPTY_WINDOW_TITLE}
                description={EMPTY_WINDOW_DESCRIPTION}
                actions={actions}
                dataTestId="profiles-empty-window"
              />
            </div>
          ) : (
            <TelemetryFirstStepsEmptyState
              signal={TelemetryFirstStepsSignal.Profiles}
            />
          )}
        </div>
      </Fragment>
    );
  }

  const changeTooRecent: boolean =
    urlState.compare === ProfilesCompareMode.Change && !comparison;

  // Comparing, the list ranks by change: All functions, or Your code.
  const viewOptions: Array<{ view: ProfileFunctionView; label: string }> =
    comparison
      ? [
          { view: "self", label: VIEW_ALL_FUNCTIONS },
          { view: "own", label: VIEW_YOUR_CODE },
        ]
      : [
          { view: "self", label: SORT_BY_SELF },
          { view: "total", label: SORT_BY_TOTAL },
          { view: "own", label: VIEW_YOUR_CODE },
        ];
  const shownView: ProfileFunctionView =
    comparison && functionView === "total" ? "self" : functionView;

  const functionsCardControls: ReactElement = (
    <div
      className="flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1"
      role="group"
      aria-label={translator.translateText("Rank by")}
      data-testid="profiles-functions-view"
    >
      {viewOptions.map(
        (option: { view: ProfileFunctionView; label: string }) => {
          const isActive: boolean = shownView === option.view;

          return (
            <button
              key={option.view}
              type="button"
              aria-pressed={isActive}
              className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                isActive
                  ? "bg-white text-gray-900 shadow-sm ring-1 ring-gray-200"
                  : "text-gray-600 hover:text-gray-900"
              }`}
              data-testid={`profiles-functions-view-${option.view}`}
              onClick={() => {
                setFunctionView(option.view);
              }}
            >
              {translator.translateText(option.label)}
            </button>
          );
        },
      )}
    </div>
  );

  return (
    <Fragment>
      {scopeBar}

      {changeTooRecent ? (
        <p
          className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900"
          role="status"
          data-testid="profiles-change-too-recent"
        >
          {translator.translateTemplate(HEADLINE_CHANGE_TOO_RECENT, {
            minutes: String(MIN_MINUTES_AFTER_A_CHANGE),
          })}
        </p>
      ) : (
        <></>
      )}

      <ProfileHeadline
        serviceName={serviceName}
        kind={kind}
        windowText={windowText}
        isLoading={comparison ? compared.isLoading : functions.isLoading}
        facts={headlineFacts}
        comparison={headlineComparison}
        onOpenFunction={openFunction}
      />

      <div className="space-y-6">
        <ProfileFlameCard
          startTime={shownWindow.startTime}
          endTime={shownWindow.endTime}
          comparison={comparison}
          serviceIds={serviceObjectIds}
          kind={kind}
          searchTerm={highlight}
          onSearchTermChange={setHighlight}
          onOpenFunction={openFunction}
          refreshCount={refreshCount}
        />

        <Card
          title={comparison ? FUNCTIONS_COMPARE_TITLE : FUNCTIONS_TITLE}
          rightElement={functionsCardControls}
        >
          <ProfileFunctionTable
            isLoading={comparison ? compared.isLoading : functions.isLoading}
            error={comparison ? compared.error : functions.error}
            onRetry={comparison ? compared.reload : functions.reload}
            unit={kind.unit}
            rows={functions.data?.functions}
            windowTotal={functions.data?.windowTotal}
            changes={comparison ? compared.data?.changes || [] : undefined}
            view={shownView}
            truncated={Boolean(
              comparison ? compared.data?.truncated : functions.data?.truncated,
            )}
            sourceLinks={links.data || []}
            highlightedFunctionName={highlight}
            onOpenFunction={openFunction}
            onHighlight={toggleHighlight}
          />
        </Card>

        {!isLocked && !serviceId ? (
          <ProfileServicesCard
            isLoading={entities.isLoading}
            error={entities.error}
            onRetry={entities.reload}
            services={scopeServices}
            onSelect={(id: string) => {
              updateState({
                serviceId: id,
                functionName: undefined,
                fileName: undefined,
              });
            }}
          />
        ) : (
          <></>
        )}

        {!isLocked ? (
          <div className="flex justify-end">
            <AppLink
              className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
              to={allProfilesRoute}
            >
              {translator.translateText(ALL_PROFILES_LINK) || ""}
            </AppLink>
          </div>
        ) : (
          <></>
        )}
      </div>

      {panel}
    </Fragment>
  );
};

export default ProfilesOverview;
