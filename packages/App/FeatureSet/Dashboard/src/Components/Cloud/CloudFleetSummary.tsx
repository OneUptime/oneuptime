import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import CloudApp from "Common/Models/DatabaseModels/CloudApp";
import CloudAppRevision from "Common/Models/DatabaseModels/CloudAppRevision";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import CloudResourceInstance from "Common/Models/DatabaseModels/CloudResourceInstance";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import Includes from "Common/Types/BaseDatabase/Includes";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import { CloudResourceKind } from "Common/Types/Cloud/CloudResourceKind";
import {
  CLOUD_FLEET_DEPLOYS_WINDOW_HOURS,
  CloudFleetCounts,
  CloudFleetSummaryTile,
  summarizeCloudFleet,
} from "../../Pages/AppPlatforms/Utils/CloudFleetSummary";
import { CLOUD_INSTANCE_LIVE_WINDOW_MINUTES } from "../../Pages/AppPlatforms/Utils/CloudResourceTelemetryScope";
import CloudStatTileTitle, {
  CLOUD_STAT_TILE_HEAD_CLASS_NAME,
  CLOUD_STAT_TILE_ICON_ROOM_CLASS_NAME,
  CLOUD_STAT_TILE_ROWS_CLASS_NAME,
} from "./CloudStatTileTitle";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

/*
 * The stat strip at the top of App Platforms' Overview: how many apps there
 * are and how many run, how many environments, the deploys of the last day,
 * and how many tasks are live right now.
 *
 * It is strictly decorative — the table underneath is the source of truth —
 * so it must never get in the way: it renders nothing while loading, nothing
 * when there is nothing to summarise (the empty state already has the setup
 * guide), and nothing on error rather than a second error banner next to
 * the table's own.
 */

export interface ComponentProps {
  /*
   * Bump to refetch, e.g. after the create modal adds an environment. The
   * strip has no other reason to poll.
   */
  refreshToken?: number | null | undefined;
}

interface TileStyle {
  icon: IconProp;
  bg: string;
  ring: string;
  text: string;
}

/*
 * One entry per tile that summarizeCloudFleet returns, in the same order.
 * The palette matches ResourceOverview's golden-metric tiles so the list
 * page and the environment overview read as one product.
 */
const TILE_STYLES: ReadonlyArray<TileStyle> = [
  {
    icon: IconProp.Squares,
    bg: "bg-emerald-50",
    ring: "ring-emerald-200",
    text: "text-emerald-600",
  },
  {
    icon: IconProp.Cloud,
    bg: "bg-blue-50",
    ring: "ring-blue-200",
    text: "text-blue-600",
  },
  {
    icon: IconProp.RocketLaunch,
    bg: "bg-indigo-50",
    ring: "ring-indigo-200",
    text: "text-indigo-600",
  },
  {
    icon: IconProp.Cube,
    bg: "bg-violet-50",
    ring: "ring-violet-200",
    text: "text-violet-600",
  },
];

const FALLBACK_TILE_STYLE: TileStyle = {
  icon: IconProp.Info,
  bg: "bg-slate-50",
  ring: "ring-slate-200",
  text: "text-slate-600",
};

/*
 * The strip summarises the environments list; the Cloud Resources discovered
 * from cloud monitoring share the table, and are counted on their own list.
 */
const ENVIRONMENT: CloudResourceKind = CloudResourceKind.Environment;

/*
 * The ids of the environments the strip summarises, for the counts of their
 * apps: an archived environment's apps are hidden as All Apps hides them.
 */
async function fetchEnvironmentIds(): Promise<Array<ObjectID>> {
  const result: ListResult<CloudResource> =
    await ModelAPI.getList<CloudResource>({
      modelType: CloudResource,
      query: { isArchived: false, cloudResourceKind: ENVIRONMENT },
      select: { _id: true },
      sort: {},
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    });

  return result.data
    .map((environment: CloudResource): ObjectID | null => {
      return environment._id ? new ObjectID(environment._id.toString()) : null;
    })
    .filter((id: ObjectID | null): id is ObjectID => {
      return id !== null;
    });
}

/*
 * The environments' counts and their ids, issued together, then the counts
 * of their apps, running apps and deploys. Providers are enumerated from
 * the shared CloudProvider enum so a new provider shows up here without a
 * dashboard change; the total stays bounded because that enum is short.
 */
export async function fetchCloudFleetCounts(): Promise<CloudFleetCounts> {
  const providers: Array<CloudProvider> = Object.values(CloudProvider);
  const liveSince: Date = OneUptimeDate.getSomeMinutesAgo(
    CLOUD_INSTANCE_LIVE_WINDOW_MINUTES,
  );
  const deploysSince: Date = OneUptimeDate.addRemoveHours(
    OneUptimeDate.getCurrentDate(),
    -CLOUD_FLEET_DEPLOYS_WINDOW_HOURS,
  );

  const [environmentIds, environmentCounts]: [Array<ObjectID>, Array<number>] =
    await Promise.all([
      fetchEnvironmentIds(),
      Promise.all([
        ModelAPI.count({
          modelType: CloudResource,
          query: { isArchived: false, cloudResourceKind: ENVIRONMENT },
        }),
        ModelAPI.count({
          modelType: CloudResource,
          query: {
            isArchived: false,
            cloudResourceKind: ENVIRONMENT,
            otelCollectorStatus: "connected",
          },
        }),
        ModelAPI.count({
          modelType: CloudResourceInstance,
          query: { lastSeenAt: new GreaterThan<Date>(liveSince) },
        }),
        // Never heard from: waiting for their first data, not disconnected.
        ModelAPI.count({
          modelType: CloudResource,
          query: {
            isArchived: false,
            cloudResourceKind: ENVIRONMENT,
            lastSeenAt: new IsNull(),
          },
        }),
        ...providers.map((provider: CloudProvider): Promise<number> => {
          return ModelAPI.count({
            modelType: CloudResource,
            query: {
              isArchived: false,
              cloudResourceKind: ENVIRONMENT,
              cloudProvider: provider,
            },
          });
        }),
      ]),
    ]);

  const [
    total,
    connected,
    liveInstances,
    neverSeen,
    ...providerCounts
  ]: Array<number> = environmentCounts;

  /*
   * No environment, no app to count: the strip is not drawn then, and an
   * empty Includes would match nothing anyway.
   */
  const [apps, runningApps, deploys]: Array<number> =
    environmentIds.length > 0
      ? await Promise.all([
          ModelAPI.count({
            modelType: CloudApp,
            query: { cloudResourceId: new Includes(environmentIds) },
          }),
          ModelAPI.count({
            modelType: CloudApp,
            query: {
              cloudResourceId: new Includes(environmentIds),
              lastSeenAt: new GreaterThan<Date>(liveSince),
            },
          }),
          // A deploy names the revision it replaced; an app's first does not.
          ModelAPI.count({
            modelType: CloudAppRevision,
            query: {
              cloudResourceId: new Includes(environmentIds),
              firstSeenAt: new GreaterThan<Date>(deploysSince),
              previousRevision: new NotNull(),
            },
          }),
        ])
      : [0, 0, 0];

  const byProvider: Record<string, number> = {};
  providers.forEach((provider: CloudProvider, index: number): void => {
    byProvider[provider] = providerCounts[index] || 0;
  });

  const safeTotal: number = total || 0;
  const safeConnected: number = Math.min(safeTotal, connected || 0);
  const safeWaiting: number = Math.min(
    safeTotal - safeConnected,
    neverSeen || 0,
  );

  return {
    total: safeTotal,
    connected: safeConnected,
    waiting: safeWaiting,
    disconnected: safeTotal - safeConnected - safeWaiting,
    byProvider,
    liveInstances: liveInstances || 0,
    apps: apps || 0,
    runningApps: runningApps || 0,
    deploys: deploys || 0,
  };
}

const CloudFleetSummary: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [counts, setCounts] = useState<CloudFleetCounts | null>(null);
  const [failed, setFailed] = useState<boolean>(false);

  useEffect(() => {
    /*
     * A refetch triggered by refreshToken can resolve before the one it
     * superseded; the flag keeps the older response from overwriting the
     * newer one.
     */
    let ignore: boolean = false;

    fetchCloudFleetCounts()
      .then((result: CloudFleetCounts): void => {
        if (ignore) {
          return;
        }
        setCounts(result);
        setFailed(false);
      })
      .catch((): void => {
        if (ignore) {
          return;
        }
        setFailed(true);
      });

    return (): void => {
      ignore = true;
    };
  }, [props.refreshToken]);

  if (failed || !counts || counts.total <= 0) {
    return <></>;
  }

  const tiles: Array<CloudFleetSummaryTile> = summarizeCloudFleet(counts);

  /*
   * Laid out by the room the strip and each tile have, not the window's:
   * beside the side menu a 1024px window leaves a quarter of the row too
   * narrow for a title, its (i) and the icon. Four in a row from 52rem of
   * strip, two below; a tile under 11rem drops its icon, which only
   * decorates, so the title and its (i) are never drawn under it. As
   * Cloud's strip: a tile is three of the strip's rows, so a row's values
   * start on one line, and a title's (i) follows its last word.
   */
  return (
    <div
      data-testid="cloud-fleet-summary"
      className="mb-6 [container-type:inline-size]"
    >
      <div className="grid grid-cols-2 gap-4 [@container(min-width:52rem)]:grid-cols-4">
        {tiles.map(
          (tile: CloudFleetSummaryTile, index: number): ReactElement => {
            const style: TileStyle = TILE_STYLES[index] || FALLBACK_TILE_STYLE;
            const sublabel: string =
              translator.translateText(tile.sublabel) || tile.sublabel;
            return (
              <div
                key={tile.title}
                data-testid="cloud-fleet-summary-tile"
                className={`${CLOUD_STAT_TILE_ROWS_CLASS_NAME} rounded-xl border border-gray-200 bg-white p-4 shadow-sm`}
              >
                <div className={CLOUD_STAT_TILE_HEAD_CLASS_NAME}>
                  {/*
                   * In the reader's language, as the golden-metric tiles
                   * draw theirs (ResourceOverview): the title says its
                   * language, so a long word longer than a line breaks
                   * where that language hyphenates it. The (i) translates
                   * its own label and text.
                   */}
                  <CloudStatTileTitle
                    title={tile.title}
                    description={tile.description}
                    dataTestId="cloud-fleet-summary-tile-title"
                  />
                  <div
                    data-testid="cloud-fleet-summary-tile-icon"
                    className={`flex h-7 w-7 flex-none items-center justify-center rounded-md ${style.bg} ring-1 ring-inset ${style.ring} ${CLOUD_STAT_TILE_ICON_ROOM_CLASS_NAME}`}
                  >
                    <Icon
                      icon={style.icon}
                      className={`h-3.5 w-3.5 ${style.text}`}
                    />
                  </div>
                </div>
                <div className="text-2xl font-semibold leading-none text-gray-900">
                  {tile.value}
                </div>
                {/*
                 * Wraps rather than cuts: the providers' breakdown (2 AWS · 2
                 * Azure · 2 Google Cloud) is longer than a quarter of a laptop's
                 * row, and the row's tiles grow together. It wraps between
                 * providers, never inside one: "2 Google" over "Cloud" read
                 * as two things. Isolated (bdi), the breakdown keeps its
                 * order on a right-to-left page.
                 */}
                <div
                  data-testid="cloud-fleet-summary-tile-sublabel"
                  className="mt-1 break-words text-xs text-gray-500"
                >
                  <bdi>
                    {tile.sublabelParts && tile.sublabelParts.length > 1
                      ? tile.sublabelParts.map(
                          (part: string, partIndex: number): ReactElement => {
                            return (
                              <Fragment key={part}>
                                {partIndex > 0 ? " · " : ""}
                                <span
                                  className="whitespace-nowrap"
                                  data-testid="cloud-fleet-summary-tile-sublabel-part"
                                >
                                  {part}
                                </span>
                              </Fragment>
                            );
                          },
                        )
                      : sublabel}
                  </bdi>
                </div>
              </div>
            );
          },
        )}
      </div>
    </div>
  );
};

export default CloudFleetSummary;
