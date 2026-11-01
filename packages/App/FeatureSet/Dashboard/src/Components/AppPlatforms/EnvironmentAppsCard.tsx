import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import CloudApp from "Common/Models/DatabaseModels/CloudApp";
import CloudAppRevision from "Common/Models/DatabaseModels/CloudAppRevision";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import CloudResourceInstance from "Common/Models/DatabaseModels/CloudResourceInstance";
import Route from "Common/Types/API/Route";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import ChartEventKind from "Common/UI/Components/Charts/Types/ChartEventKind";
import ChartTimeReferenceLineProps from "Common/UI/Components/Charts/Types/TimeReferenceLineProps";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import AppLink from "../AppLink/AppLink";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  CLOUD_APP_STATE_LABELS,
  CloudAppErrorRateTone,
  CloudAppSignals,
  CloudAppState,
  countLiveInstancesByApp,
  getCloudAppErrorRateTone,
  getCloudAppState,
  getShortRevision,
} from "../../Pages/AppPlatforms/Utils/CloudApps";
import {
  CloudAppSignalResult,
  fetchCloudAppInstances,
  fetchCloudAppSignals,
} from "../../Pages/AppPlatforms/Utils/CloudAppReads";
import {
  APP_INSTANCE_COUNT,
  APP_LAST_SEEN,
  CloudAppSignalsSummaryCell,
} from "./CloudAppCells";
import { APP_REVISION } from "./CloudAppHeader";

/*
 * An environment's Overview: the apps that run in it, the ones that need a
 * look first - not reporting, then the highest error rate - each with its
 * instances, revision and error rate in the last hour, and the way to all
 * of them. And the deploys of its apps, as the Overview's charts mark them.
 */

export const ENVIRONMENT_APPS_TITLE: string = translationKey("Apps");
export const ENVIRONMENT_APPS_DESCRIPTION: string = translationKey(
  "The apps this environment runs, the ones that need a look first.",
);
export const ENVIRONMENT_APPS_EMPTY: string = translationKey(
  "No app reported yet. An app appears when its telemetry names it: an ECS task definition family, a Cloud Run service, or a service.name.",
);
export const VIEW_ALL_APPS: PluralTemplate = {
  one: "View the app",
  other: "View all {{count}} apps",
};
export const ENVIRONMENT_DEPLOY_MARKER: string = translationKey(
  "Deployed {{app}} revision {{revision}}",
);

// How many apps the card lists before "View all".
export const ENVIRONMENT_APPS_SHOWN: number = 6;

const TONE_RANK: Readonly<Record<CloudAppErrorRateTone, number>> = {
  [CloudAppErrorRateTone.Danger]: 0,
  [CloudAppErrorRateTone.Warning]: 1,
  [CloudAppErrorRateTone.Healthy]: 2,
  [CloudAppErrorRateTone.Unknown]: 3,
};

/*
 * The order the card lists apps in: the ones not reporting, then by error
 * rate (red, amber, the rest), then by name. Exported for tests.
 */
export function sortAppsForAttention(data: {
  apps: ReadonlyArray<CloudApp>;
  signals: ReadonlyMap<string, CloudAppSignals>;
  now: Date;
}): Array<CloudApp> {
  const rank: (app: CloudApp) => [number, number, number, string] = (
    app: CloudApp,
  ): [number, number, number, string] => {
    const signals: CloudAppSignals | undefined = data.signals.get(
      app._id?.toString() || "",
    );
    const state: CloudAppState = getCloudAppState(app.lastSeenAt, data.now);

    return [
      state === CloudAppState.NotReporting ? 0 : 1,
      TONE_RANK[getCloudAppErrorRateTone(signals?.errorRatePercent)],
      -(signals?.errorRatePercent || 0),
      (app.name || "").toLowerCase(),
    ];
  };

  return [...data.apps].sort((a: CloudApp, b: CloudApp): number => {
    const ra: [number, number, number, string] = rank(a);
    const rb: [number, number, number, string] = rank(b);

    for (let index: number = 0; index < 3; index++) {
      const difference: number = (ra[index] as number) - (rb[index] as number);

      if (difference !== 0) {
        return difference;
      }
    }

    return ra[3].localeCompare(rb[3]);
  });
}

export interface ComponentProps {
  environmentId: ObjectID;
  // Its cloud.* attributes, which its apps' numbers are read through.
  environment: CloudResource;
  refreshToken?: number | undefined;
}

const EnvironmentAppsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const ruledList: string = useCardRuledListClassName();
  const environmentId: string = props.environmentId.toString();

  const [apps, setApps] = useState<Array<CloudApp> | null>(null);
  const [signals, setSignals] = useState<Map<string, CloudAppSignals>>(
    new Map<string, CloudAppSignals>(),
  );
  const [signalsFailed, setSignalsFailed] = useState<boolean>(false);
  const [signalsLoading, setSignalsLoading] = useState<boolean>(true);
  const [liveInstances, setLiveInstances] = useState<Map<
    string,
    number
  > | null>(null);
  const [error, setError] = useState<string>("");
  const [attempt, setAttempt] = useState<number>(0);

  useEffect(() => {
    let ignore: boolean = false;
    setError("");

    ModelAPI.getList<CloudApp>({
      modelType: CloudApp,
      query: { cloudResourceId: new ObjectID(environmentId) },
      select: {
        name: true,
        cloudResourceId: true,
        cloudPlatform: true,
        groupName: true,
        telemetryAttributes: true,
        currentRevision: true,
        currentRevisionSince: true,
        lastSeenAt: true,
      },
      sort: { name: SortOrder.Ascending },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    })
      .then((result: { data: Array<CloudApp> }): void => {
        if (ignore) {
          return;
        }

        setApps(result.data);
        setSignalsLoading(true);

        const environments: Map<string, CloudResource> = new Map<
          string,
          CloudResource
        >([[environmentId, props.environment]]);

        fetchCloudAppSignals({ apps: result.data, environments })
          .then((read: CloudAppSignalResult): void => {
            if (!ignore) {
              setSignals(read.signals);
              setSignalsFailed(read.failed);
              setSignalsLoading(false);
            }
          })
          .catch((): void => {
            if (!ignore) {
              setSignalsFailed(true);
              setSignalsLoading(false);
            }
          });

        fetchCloudAppInstances(
          result.data.map((app: CloudApp): string => {
            return app._id?.toString() || "";
          }),
        )
          .then((instances: Array<CloudResourceInstance>): void => {
            if (!ignore) {
              setLiveInstances(countLiveInstancesByApp(instances));
            }
          })
          .catch((): void => {
            if (!ignore) {
              setLiveInstances(new Map<string, number>());
            }
          });
      })
      .catch((err: Error): void => {
        if (!ignore) {
          setError(API.getFriendlyMessage(err));
        }
      });

    return (): void => {
      ignore = true;
    };
  }, [environmentId, props.refreshToken, attempt]);

  const appsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_APPS] as Route,
    { modelId: new ObjectID(environmentId) },
  );

  let body: ReactElement;

  if (error) {
    body = (
      <ErrorMessage
        message={error}
        onRefreshClick={() => {
          setAttempt((count: number): number => {
            return count + 1;
          });
        }}
      />
    );
  } else if (!apps) {
    body = <PageLoader isVisible={true} />;
  } else if (apps.length === 0) {
    body = (
      <p className="text-sm text-gray-500" data-testid="environment-apps-empty">
        {translator.translateText(ENVIRONMENT_APPS_EMPTY)}
      </p>
    );
  } else {
    const shown: Array<CloudApp> = sortAppsForAttention({
      apps,
      signals,
      now: new Date(),
    }).slice(0, ENVIRONMENT_APPS_SHOWN);

    body = (
      <ul className={ruledList} data-testid="environment-apps">
        {shown.map((app: CloudApp, index: number): ReactElement => {
          const appId: string = app._id?.toString() || "";
          const appSignals: CloudAppSignals | undefined = signals.get(appId);
          const state: CloudAppState = getCloudAppState(app.lastSeenAt);
          const live: number | undefined = liveInstances
            ? liveInstances.get(appId) || 0
            : undefined;
          const revision: string = getShortRevision({
            revision: app.currentRevision,
            appName: app.name,
          });

          /*
           * One line of what the app runs: its revision, and how many
           * instances run it - or, quiet, when it was last heard from.
           */
          const facts: Array<string> = [];

          if (revision) {
            facts.push(
              translator.translateTemplate(APP_REVISION, { revision }),
            );
          }

          if (state === CloudAppState.NotReporting && app.lastSeenAt) {
            facts.push(
              translator.translateTemplate(APP_LAST_SEEN, {
                time: OneUptimeDate.fromNow(
                  OneUptimeDate.fromString(app.lastSeenAt),
                ),
              }),
            );
          } else if (live !== undefined && live > 0) {
            facts.push(translator.translatePlural(APP_INSTANCE_COUNT, live));
          }

          return (
            <li
              key={appId || `app-${index}`}
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-3 px-5 py-3 md:px-6"
              data-testid="environment-app"
              data-state={state}
            >
              <span
                aria-hidden="true"
                className={`inline-block h-2 w-2 translate-y-[-1px] rounded-full ${
                  state === CloudAppState.Running
                    ? "bg-emerald-500"
                    : "bg-amber-500"
                }`}
              />
              <div className="min-w-0">
                <AppLink
                  to={RouteUtil.populateRouteParams(
                    RouteMap[
                      PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_APP_DETAIL
                    ] as Route,
                    {
                      modelId: new ObjectID(environmentId),
                      subModelId: new ObjectID(appId),
                    },
                  )}
                  className="break-words text-sm font-medium text-gray-900 hover:underline"
                >
                  <bdi>{app.name || "—"}</bdi>
                </AppLink>
                <span className="sr-only">
                  {translator.translateText(CLOUD_APP_STATE_LABELS[state])}
                </span>
                {facts.length > 0 ? (
                  <div
                    className={`mt-0.5 text-xs ${
                      state === CloudAppState.NotReporting
                        ? "text-amber-700"
                        : "text-gray-500"
                    }`}
                  >
                    <bdi>{facts.join(" · ")}</bdi>
                  </div>
                ) : (
                  <></>
                )}
              </div>
              <div className="text-end">
                <CloudAppSignalsSummaryCell
                  signals={
                    appSignals ||
                    (signalsFailed && !signalsLoading ? null : undefined)
                  }
                  isLoading={signalsLoading}
                />
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <Card
      id="environment-apps"
      title={ENVIRONMENT_APPS_TITLE}
      description={ENVIRONMENT_APPS_DESCRIPTION}
    >
      {body}
      {apps && apps.length > 0 ? (
        <div className="mt-4">
          <AppLink
            to={appsRoute}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
          >
            {translator.translatePlural(VIEW_ALL_APPS, apps.length)}
          </AppLink>
        </div>
      ) : (
        <></>
      )}
    </Card>
  );
};

/*
 * The deploys of an environment's apps inside a chart's window, as markers:
 * "Deployed checkout revision 43". An app's first revision is not a deploy.
 */
export function useEnvironmentDeployMarkers(data: {
  environmentId: ObjectID;
  window: { start: Date; end: Date } | null;
  refreshToken?: number | undefined;
}): Array<ChartTimeReferenceLineProps> {
  const translator: Translator = useTranslator();
  const [deploys, setDeploys] = useState<Array<CloudAppRevision>>([]);

  const startMs: number | undefined = data.window?.start.getTime();
  const endMs: number | undefined = data.window?.end.getTime();

  useEffect(() => {
    if (startMs === undefined || endMs === undefined) {
      return;
    }

    let ignore: boolean = false;

    ModelAPI.getList<CloudAppRevision>({
      modelType: CloudAppRevision,
      query: {
        cloudResourceId: data.environmentId,
        previousRevision: new NotNull(),
        firstSeenAt: new InBetween<Date>(new Date(startMs), new Date(endMs)),
      },
      select: {
        revision: true,
        firstSeenAt: true,
        cloudApp: { name: true },
      },
      sort: { firstSeenAt: SortOrder.Ascending },
      skip: 0,
      limit: 50,
    })
      .then((result: { data: Array<CloudAppRevision> }): void => {
        if (!ignore) {
          setDeploys(result.data);
        }
      })
      .catch((): void => {
        // No markers is the honest answer to a failed read.
        if (!ignore) {
          setDeploys([]);
        }
      });

    return (): void => {
      ignore = true;
    };
  }, [data.environmentId.toString(), startMs, endMs, data.refreshToken]);

  return deploys
    .filter((deploy: CloudAppRevision): boolean => {
      return Boolean(deploy.firstSeenAt);
    })
    .map((deploy: CloudAppRevision): ChartTimeReferenceLineProps => {
      const appName: string = deploy.cloudApp?.name || "";

      return {
        date: new Date(deploy.firstSeenAt as Date),
        label: translator.translateTemplate(ENVIRONMENT_DEPLOY_MARKER, {
          app: appName,
          revision: getShortRevision({ revision: deploy.revision, appName }),
        }),
        color: "#6366f1",
        strokeDasharray: "4 4",
        kind: ChartEventKind.Change,
      };
    });
}

export default EnvironmentAppsCard;
