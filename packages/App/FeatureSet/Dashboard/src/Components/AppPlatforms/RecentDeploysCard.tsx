import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import CloudAppRevision from "Common/Models/DatabaseModels/CloudAppRevision";
import DirectionArrow from "Common/UI/Components/DirectionArrow/DirectionArrow";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import Route from "Common/Types/API/Route";
import Includes from "Common/Types/BaseDatabase/Includes";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { CloudResourceKind } from "Common/Types/Cloud/CloudResourceKind";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import {
  getCloudProviderForPlatform,
  getManagedCloudPlatformLabel,
} from "Common/Types/Cloud/CloudPlatform";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import AppLink from "../AppLink/AppLink";
import CloudConnectionLogo from "../Cloud/Connect/CloudConnectionLogo";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  getCloudAppGroupLabel,
  getShortRevision,
} from "../../Pages/AppPlatforms/Utils/CloudApps";
import CloudAppFacts, { CloudAppFact } from "./CloudAppFacts";

/*
 * App Platforms' Overview: the newest deploys of every app - which app,
 * from which revision to which, and when - each opening the app's
 * Revisions. "What changed?" is the first thing asked when something
 * breaks, and this answers it before anyone opens an app.
 */

export const RECENT_DEPLOYS_TITLE: string = translationKey("Recent deploys");
export const RECENT_DEPLOYS_DESCRIPTION: string = translationKey(
  "The newest revisions your apps started running. Open one to compare it with the revision before it.",
);
export const NO_RECENT_DEPLOYS: string = translationKey(
  "No deploys yet. A deploy shows here when an app starts running a revision it has not run before.",
);

// How many deploys the card lists.
export const RECENT_DEPLOYS_SHOWN: number = 6;

/*
 * The newest deploys of the apps of the project's unarchived environments:
 * an archived environment's apps are hidden as All Apps hides them.
 * Exported for tests.
 */
export async function fetchRecentDeploys(): Promise<Array<CloudAppRevision>> {
  const environments: ListResult<CloudResource> =
    await ModelAPI.getList<CloudResource>({
      modelType: CloudResource,
      query: {
        isArchived: false,
        cloudResourceKind: CloudResourceKind.Environment,
      },
      select: { _id: true },
      sort: {},
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    });

  const environmentIds: Array<ObjectID> = environments.data
    .map((environment: CloudResource): string => {
      return environment._id?.toString() || "";
    })
    .filter(Boolean)
    .map((id: string): ObjectID => {
      return new ObjectID(id);
    });

  if (environmentIds.length === 0) {
    return [];
  }

  const result: ListResult<CloudAppRevision> =
    await ModelAPI.getList<CloudAppRevision>({
      modelType: CloudAppRevision,
      // A deploy names the revision it replaced; an app's first does not.
      query: {
        cloudResourceId: new Includes(environmentIds),
        previousRevision: new NotNull(),
      },
      select: {
        revision: true,
        previousRevision: true,
        firstSeenAt: true,
        cloudResourceId: true,
        cloudAppId: true,
        cloudApp: {
          name: true,
          groupName: true,
          cloudPlatform: true,
        },
      },
      sort: { firstSeenAt: SortOrder.Descending },
      skip: 0,
      limit: RECENT_DEPLOYS_SHOWN,
    });

  return result.data;
}

export interface ComponentProps {
  // Bump to read again.
  refreshToken?: number | undefined;
}

const RecentDeploysCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const ruledList: string = useCardRuledListClassName();
  const [deploys, setDeploys] = useState<Array<CloudAppRevision> | null>(null);
  const [error, setError] = useState<string>("");
  const [attempt, setAttempt] = useState<number>(0);

  useEffect(() => {
    let ignore: boolean = false;
    setError("");

    fetchRecentDeploys()
      .then((recent: Array<CloudAppRevision>): void => {
        if (!ignore) {
          setDeploys(recent);
        }
      })
      .catch((err: Error): void => {
        if (!ignore) {
          setError(API.getFriendlyMessage(err));
        }
      });

    return (): void => {
      ignore = true;
    };
  }, [props.refreshToken, attempt]);

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
  } else if (!deploys) {
    body = <PageLoader isVisible={true} />;
  } else if (deploys.length === 0) {
    body = (
      <p className="text-sm text-gray-500" data-testid="recent-deploys-empty">
        {translator.translateText(NO_RECENT_DEPLOYS)}
      </p>
    );
  } else {
    body = (
      <ul className={ruledList} data-testid="recent-deploys">
        {deploys.map((deploy: CloudAppRevision): ReactElement => {
          const appName: string = deploy.cloudApp?.name || "";
          const platform: string = deploy.cloudApp?.cloudPlatform || "";
          const route: Route = new Route(
            `${RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_APP_DETAIL
              ] as Route,
              {
                modelId: new ObjectID(deploy.cloudResourceId!.toString()),
                subModelId: new ObjectID(deploy.cloudAppId!.toString()),
              },
            ).toString()}?tab=Revisions`,
          );
          /*
           * Where it runs, as All Apps says it: "AWS ECS · cluster
           * production", not a bare "production".
           */
          const where: Array<CloudAppFact> = [];
          const platformLabel: string = getManagedCloudPlatformLabel(platform);
          const group: string = getCloudAppGroupLabel({
            groupName: deploy.cloudApp?.groupName,
            cloudPlatform: platform,
            translator,
          });

          if (platformLabel) {
            where.push({ key: "platform", content: platformLabel });
          }

          if (group) {
            where.push({ key: "group", content: group });
          }

          return (
            <li
              key={deploy._id?.toString() || deploy.revision}
              className="flex items-start gap-3 px-5 py-3 md:px-6"
              data-testid="recent-deploy"
            >
              <CloudConnectionLogo
                provider={getCloudProviderForPlatform(platform) || undefined}
                size="sm"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <AppLink
                    to={route}
                    className="break-words text-sm font-medium text-gray-900 hover:underline"
                  >
                    <bdi>{appName || "—"}</bdi>
                  </AppLink>
                  {/*
                   * The revision before, then this one, each set apart so
                   * the arrow points the way the page reads.
                   */}
                  <span className="font-mono text-sm text-gray-600">
                    <bdi>
                      {getShortRevision({
                        revision: deploy.previousRevision,
                        appName,
                      })}
                    </bdi>{" "}
                    <DirectionArrow />{" "}
                    <bdi>
                      {getShortRevision({ revision: deploy.revision, appName })}
                    </bdi>
                  </span>
                </div>
                <CloudAppFacts
                  facts={where}
                  className="mt-0.5 text-xs text-gray-500"
                />
              </div>
              <span className="flex-shrink-0 text-xs text-gray-500">
                {deploy.firstSeenAt
                  ? OneUptimeDate.fromNow(
                      OneUptimeDate.fromString(deploy.firstSeenAt),
                    )
                  : ""}
              </span>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <Card
      id="recent-deploys"
      title={RECENT_DEPLOYS_TITLE}
      description={RECENT_DEPLOYS_DESCRIPTION}
    >
      {body}
    </Card>
  );
};

export default RecentDeploysCard;
