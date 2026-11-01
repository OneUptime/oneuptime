import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import CloudAppRevision from "Common/Models/DatabaseModels/CloudAppRevision";
import Route from "Common/Types/API/Route";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
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
import { getShortRevision } from "../../Pages/AppPlatforms/Utils/CloudApps";

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

    ModelAPI.getList<CloudAppRevision>({
      modelType: CloudAppRevision,
      // A deploy names the revision it replaced; an app's first does not.
      query: { previousRevision: new NotNull() },
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
    })
      .then((result: { data: Array<CloudAppRevision> }): void => {
        if (!ignore) {
          setDeploys(result.data);
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
              RouteMap[PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_APP] as Route,
              {
                modelId: new ObjectID(deploy.cloudResourceId!.toString()),
                subModelId: new ObjectID(deploy.cloudAppId!.toString()),
              },
            ).toString()}?tab=Revisions`,
          );
          const where: Array<string> = [getManagedCloudPlatformLabel(platform)];

          if (deploy.cloudApp?.groupName) {
            where.push(deploy.cloudApp.groupName);
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
                  <span className="font-mono text-sm text-gray-600">
                    <bdi>
                      {getShortRevision({
                        revision: deploy.previousRevision,
                        appName,
                      })}
                      {" → "}
                      {getShortRevision({ revision: deploy.revision, appName })}
                    </bdi>
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-gray-500">
                  <bdi>{where.filter(Boolean).join(" · ")}</bdi>
                </div>
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
