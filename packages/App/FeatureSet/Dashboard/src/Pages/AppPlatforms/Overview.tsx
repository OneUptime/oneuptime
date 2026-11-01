import PageComponentProps from "../PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../../Components/AppLink/AppLink";
import CloudFleetSummary from "../../Components/Cloud/CloudFleetSummary";
import CloudConnectionLogo from "../../Components/Cloud/Connect/CloudConnectionLogo";
import CLOUD_ENVIRONMENT_ONBOARDING from "../../Components/Cloud/CloudEnvironmentOnboarding";
import CLOUD_ENVIRONMENT_SHOWCASE from "../../Components/Cloud/CloudEnvironmentShowcase";
import useFirstRecordWatch, {
  FirstRecordWatch,
} from "../../Components/Infrastructure/UseFirstRecordWatch";
import AddResourceModal from "../../Components/ResourceOnboarding/AddResourceModal";
import ResourceShowcaseCard from "../../Components/ResourceShowcase/ResourceShowcaseCard";
import {
  AppPlatformEnvironmentRow,
  AppPlatformGroup,
  AppPlatformGroupTone,
  ENVIRONMENTS_SHOWN_PER_PLATFORM,
  getAppPlatformGroupTone,
  groupEnvironmentsByPlatform,
} from "./Utils/AppPlatformsOverview";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Green, Red, Yellow } from "Common/Types/BrandColors";
import { CloudResourceKind } from "Common/Types/Cloud/CloudResourceKind";
import Color from "Common/Types/Color";
import OneUptimeDate from "Common/Types/Date";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Pill from "Common/UI/Components/Pill/Pill";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * App Platforms' Overview, the page the product opens on: how the apps on
 * every managed app and container platform are doing, at a glance.
 *
 *   - The strip on top counts the environments, how many are connected and
 *     how many instances are live (CloudFleetSummary).
 *   - "Platforms" has one group per platform the apps run on - AWS ECS /
 *     Fargate, Google Cloud Run, Azure App Service and the rest - each with
 *     its environments: the ones that went quiet first, with when they were
 *     last heard from, so the page answers "is anything wrong?" before
 *     anything else.
 *
 * A project with no environment yet sees what the product does and the way
 * to add one, the same showcase and guide All Environments offers.
 */

export const PLATFORMS_CARD_TITLE: string = translationKey("Platforms");
export const PLATFORMS_CARD_DESCRIPTION: string = translationKey(
  "Where your apps run, and whether each environment is connected.",
);
/*
 * The words the environments list and the strip above use: an environment
 * is Connected while its telemetry arrives, Disconnected after 15 quiet
 * minutes.
 */
export const ALL_CONNECTED: string = translationKey("All connected");
export const NONE_CONNECTED: string = translationKey("Disconnected");
export const SOME_CONNECTED: string = translationKey(
  "{{connected}} of {{total}} connected",
);
export const ENVIRONMENT_CONNECTED: string = translationKey("Connected");
export const ENVIRONMENT_LAST_SEEN: string = translationKey(
  "Last seen {{time}}",
);
export const ENVIRONMENT_NEVER_SEEN: string = translationKey(
  "Waiting for its first data",
);
export const UNKNOWN_PLATFORM: string = translationKey(
  "Platform not reported yet",
);
export const MORE_ENVIRONMENTS: {
  one: string;
  other: string;
} = {
  one: translationKey("{{count}} more environment"),
  other: translationKey("{{count}} more environments"),
};
export const PLATFORM_ENVIRONMENT_COUNT: {
  one: string;
  other: string;
} = {
  one: translationKey("{{count}} environment"),
  other: translationKey("{{count}} environments"),
};

const TONE_COLORS: Readonly<Record<AppPlatformGroupTone, Color>> = {
  [AppPlatformGroupTone.Healthy]: Green,
  [AppPlatformGroupTone.Partial]: Yellow,
  [AppPlatformGroupTone.Silent]: Red,
};

function toRow(item: CloudResource): AppPlatformEnvironmentRow {
  return {
    id: (item._id as string) || "",
    name: (item.name as string) || "",
    cloudPlatform: (item.cloudPlatform as string) || "",
    cloudProvider: (item.cloudProvider as string) || "",
    isConnected: item.otelCollectorStatus === "connected",
    lastSeenAt: item.lastSeenAt ? new Date(item.lastSeenAt) : null,
  };
}

const PlatformGroupRows: FunctionComponent<{
  group: AppPlatformGroup;
  translator: Translator;
}> = (props: {
  group: AppPlatformGroup;
  translator: Translator;
}): ReactElement => {
  const { group, translator } = props;
  const tone: AppPlatformGroupTone = getAppPlatformGroupTone(group);
  const total: number = group.environments.length;
  const shown: Array<AppPlatformEnvironmentRow> = group.environments.slice(
    0,
    ENVIRONMENTS_SHOWN_PER_PLATFORM,
  );
  const more: number = total - shown.length;

  const toneText: string =
    tone === AppPlatformGroupTone.Healthy
      ? translator.translateText(ALL_CONNECTED) || ALL_CONNECTED
      : tone === AppPlatformGroupTone.Silent
        ? translator.translateText(NONE_CONNECTED) || NONE_CONNECTED
        : translator.translateTemplate(SOME_CONNECTED, {
            connected: group.connected,
            total: total,
          });

  return (
    <li
      className="px-5 py-4 md:px-6"
      data-testid="app-platforms-platform"
      data-platform={group.platform || "unknown"}
    >
      <div className="flex items-start gap-3">
        <CloudConnectionLogo provider={group.provider} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-gray-900 break-words">
            {group.title || translator.translateText(UNKNOWN_PLATFORM)}
          </div>
          <div className="mt-0.5 text-xs text-gray-500">
            {group.providerLabel ? `${group.providerLabel} · ` : ""}
            {translator.translatePlural(PLATFORM_ENVIRONMENT_COUNT, total)}
          </div>
        </div>
        <div className="flex-shrink-0" data-testid="app-platforms-platform-status">
          <Pill text={toneText} color={TONE_COLORS[tone]} />
        </div>
      </div>
      <ul className="mt-3 space-y-2 ps-9">
        {shown.map((row: AppPlatformEnvironmentRow): ReactElement => {
          return (
            <li
              key={row.id}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5"
              data-testid="app-platforms-environment"
            >
              <span className="flex min-w-0 items-baseline gap-2">
                <span
                  aria-hidden="true"
                  className={`inline-block h-2 w-2 flex-shrink-0 translate-y-[-1px] rounded-full ${
                    row.isConnected ? "bg-emerald-500" : "bg-gray-300"
                  }`}
                />
                <AppLink
                  to={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW] as Route,
                    { modelId: new ObjectID(row.id) },
                  )}
                  className="min-w-0 break-words text-sm font-medium text-gray-900 hover:underline"
                >
                  {row.name || "—"}
                </AppLink>
              </span>
              <span
                className={`text-xs ${
                  row.isConnected ? "text-gray-500" : "text-amber-700"
                }`}
                data-testid="app-platforms-environment-status"
              >
                {row.isConnected
                  ? translator.translateText(ENVIRONMENT_CONNECTED)
                  : row.lastSeenAt
                    ? translator.translateTemplate(ENVIRONMENT_LAST_SEEN, {
                        time: OneUptimeDate.fromNow(row.lastSeenAt),
                      })
                    : translator.translateText(ENVIRONMENT_NEVER_SEEN)}
              </span>
            </li>
          );
        })}
      </ul>
      {more > 0 ? (
        <div className="mt-2 ps-9">
          <AppLink
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.APP_PLATFORMS_ENVIRONMENTS] as Route,
            )}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
          >
            {translator.translatePlural(MORE_ENVIRONMENTS, more)}
          </AppLink>
        </div>
      ) : (
        <></>
      )}
    </li>
  );
};

const PlatformGroupList: FunctionComponent<{
  groups: Array<AppPlatformGroup>;
}> = (props: { groups: Array<AppPlatformGroup> }): ReactElement => {
  const translator: Translator = useTranslator();
  const ruledList: string = useCardRuledListClassName();

  return (
    <ul className={ruledList} data-testid="app-platforms-platforms">
      {props.groups.map((group: AppPlatformGroup): ReactElement => {
        return (
          <PlatformGroupRows
            key={group.platform || "unknown"}
            group={group}
            translator={translator}
          />
        );
      })}
    </ul>
  );
};

const AppPlatformsOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const firstRecordWatch: FirstRecordWatch = useFirstRecordWatch<CloudResource>(
    {
      modelType: CloudResource,
      query: {
        isArchived: false,
        cloudResourceKind: CloudResourceKind.Environment,
      },
    },
  );
  const [isAddEnvironmentOpen, setIsAddEnvironmentOpen] =
    useState<boolean>(false);
  // Environments connected from the Add dialog show on the page at once.
  const [connectedCount, setConnectedCount] = useState<number>(0);
  const [groups, setGroups] = useState<Array<AppPlatformGroup> | null>(null);
  const [groupsError, setGroupsError] = useState<string>("");
  const [groupsAttempt, setGroupsAttempt] = useState<number>(0);

  const hasEnvironments: boolean = (firstRecordWatch.count || 0) > 0;

  useEffect(() => {
    if (!hasEnvironments) {
      return;
    }

    let ignore: boolean = false;
    setGroupsError("");

    ModelAPI.getList<CloudResource>({
      modelType: CloudResource,
      query: {
        isArchived: false,
        cloudResourceKind: CloudResourceKind.Environment,
      },
      select: {
        name: true,
        cloudPlatform: true,
        cloudProvider: true,
        otelCollectorStatus: true,
        lastSeenAt: true,
      },
      sort: { name: SortOrder.Ascending },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    })
      .then((result: { data: Array<CloudResource> }): void => {
        if (!ignore) {
          setGroups(groupEnvironmentsByPlatform(result.data.map(toRow)));
        }
      })
      .catch((err: Error): void => {
        if (!ignore) {
          setGroupsError(API.getFriendlyMessage(err));
        }
      });

    return (): void => {
      ignore = true;
    };
  }, [hasEnvironments, firstRecordWatch.refreshToken, connectedCount, groupsAttempt]);

  if (firstRecordWatch.error) {
    return (
      <ErrorMessage
        message={firstRecordWatch.error}
        onRefreshClick={firstRecordWatch.retry}
      />
    );
  }

  if (firstRecordWatch.isLoading) {
    return <PageLoader isVisible={true} />;
  }

  const openAdd: () => void = (): void => {
    setIsAddEnvironmentOpen(true);
  };

  const addDialog: ReactElement = isAddEnvironmentOpen ? (
    <AddResourceModal
      onboarding={CLOUD_ENVIRONMENT_ONBOARDING}
      onClose={() => {
        setIsAddEnvironmentOpen(false);
      }}
      onConnected={() => {
        // The showcase gives way, and the page reads the new environment.
        firstRecordWatch.onRecordCreated();
        setConnectedCount((count: number): number => {
          return count + 1;
        });
      }}
    />
  ) : (
    <></>
  );

  if (!hasEnvironments) {
    return (
      <Fragment>
        <ResourceShowcaseCard
          showcase={CLOUD_ENVIRONMENT_SHOWCASE}
          addButton={{
            title: CLOUD_ENVIRONMENT_ONBOARDING.addTitle,
            onClick: openAdd,
          }}
        />
        {addDialog}
      </Fragment>
    );
  }

  return (
    <Fragment>
      <CloudFleetSummary
        refreshToken={(firstRecordWatch.count || 0) + connectedCount}
      />
      <Card
        id="platforms"
        title={PLATFORMS_CARD_TITLE}
        description={PLATFORMS_CARD_DESCRIPTION}
        buttons={[
          {
            title: CLOUD_ENVIRONMENT_ONBOARDING.addTitle,
            icon: IconProp.Add,
            buttonStyle: ButtonStyleType.NORMAL,
            onClick: openAdd,
          },
        ]}
      >
        {groupsError ? (
          <ErrorMessage
            message={groupsError}
            onRefreshClick={() => {
              setGroupsAttempt((attempt: number): number => {
                return attempt + 1;
              });
            }}
          />
        ) : groups ? (
          <PlatformGroupList groups={groups} />
        ) : (
          <PageLoader isVisible={true} />
        )}
      </Card>
      {addDialog}
    </Fragment>
  );
};

export default AppPlatformsOverview;
