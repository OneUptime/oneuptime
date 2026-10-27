import PageComponentProps from "../../../PageComponentProps";
import PageMap from "../../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../../Utils/RouteMap";
import AppLink from "../../../../Components/AppLink/AppLink";
import ResourceOverview, {
  ResourceOverviewChip,
  ResourceOverviewDetailRow,
  ResourceOverviewTile,
} from "../../../../Components/TelemetryResource/ResourceOverview";
import {
  CloudAccountStatus,
  getCloudAccountStatus,
} from "../../../../Components/Cloud/CloudAccountStatus";
import { getRecentCloudChangesQuery } from "../../../../Components/Cloud/CloudChangesScope";
import RankedBars, {
  RankedBarItem,
} from "../../../../Components/SecurityOverview/RankedBars";
import ChangeEvent from "Common/Models/AnalyticsModels/ChangeEvent";
import CloudAccount from "Common/Models/DatabaseModels/CloudAccount";
import Route from "Common/Types/API/Route";
import {
  CloudAccountRegionCount,
  CloudAccountResourceSummary,
  CloudAccountTypeCount,
  readCloudAccountResourceSummary,
} from "Common/Types/Cloud/CloudAccountSummary";
import { getCloudProviderLabel } from "Common/Types/Cloud/CloudPlatform";
import { getCloudResourceTypeLabel } from "Common/Types/Cloud/CloudResourceCatalog";
import OneUptimeDate from "Common/Types/Date";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import CardGrid from "Common/UI/Components/Card/CardGrid";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import API from "Common/UI/Utils/API/API";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * A cloud account's Overview: which cloud and account it is, the
 * connection that reads it and when it last did, how many resources it
 * holds and how much changed in it lately, and what it holds - its
 * resources by type and by Region, side by side, as the server last
 * counted them (CloudAccount.resourceSummary).
 */

// The rows of a count card drawn before "Show more": the most common first.
export const CLOUD_ACCOUNT_COUNTS_SHOWN: number = 8;

// How many changes the account recorded lately: unknown while it is read.
interface RecentChanges {
  count: number | null;
  failed: boolean;
}

/*
 * One count card's rows - a type or a Region and how many resources it
 * holds - the first CLOUD_ACCOUNT_COUNTS_SHOWN of them until all are asked
 * for.
 */
const CountsCard: FunctionComponent<{
  title: string;
  description: string;
  items: Array<RankedBarItem>;
  emptyText: string;
  dataTestId: string;
}> = (props: {
  title: string;
  description: string;
  items: Array<RankedBarItem>;
  emptyText: string;
  dataTestId: string;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const [showAll, setShowAll] = useState<boolean>(false);
  const hidden: number = props.items.length - CLOUD_ACCOUNT_COUNTS_SHOWN;
  const shown: Array<RankedBarItem> =
    showAll || hidden <= 0
      ? props.items
      : props.items.slice(0, CLOUD_ACCOUNT_COUNTS_SHOWN);

  return (
    <Card title={props.title} description={props.description}>
      <div data-testid={props.dataTestId}>
        <RankedBars items={shown} emptyText={props.emptyText} />
        {hidden > 0 ? (
          <button
            type="button"
            aria-expanded={showAll}
            className="mt-3 inline-flex items-center gap-1 rounded-md px-2 py-1 -ml-2 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50 hover:text-indigo-700"
            onClick={() => {
              setShowAll(!showAll);
            }}
          >
            <Icon
              icon={showAll ? IconProp.ChevronUp : IconProp.ChevronDown}
              className="h-3 w-3"
            />
            <span>
              {showAll
                ? translator.translateText("Show less")
                : translator.translatePlural(
                    {
                      one: "Show {{count}} more",
                      other: "Show {{count}} more",
                    },
                    hidden,
                  )}
            </span>
          </button>
        ) : (
          <></>
        )}
      </div>
    </Card>
  );
};

const CloudAccountOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();
  const translator: Translator = useTranslator();

  const [account, setAccount] = useState<CloudAccount | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [recentChanges, setRecentChanges] = useState<RecentChanges>({
    count: null,
    failed: false,
  });

  const fetchAccount: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");

    try {
      const item: CloudAccount | null = await ModelAPI.getItem({
        modelType: CloudAccount,
        id: modelId,
        select: {
          name: true,
          description: true,
          provider: true,
          accountId: true,
          providerAccountName: true,
          resourceCount: true,
          regionCount: true,
          resourceSummary: true,
          lastSeenAt: true,
          inventoryListedAt: true,
          cloudConnectionId: true,
          cloudConnection: {
            name: true,
          },
          labels: {
            name: true,
            color: true,
          },
        },
      });

      if (!item) {
        setError("Cloud account not found.");
      } else {
        setAccount(item);
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchAccount().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  /*
   * What changed in the account in the last day, read apart from the
   * account: the page never waits on it, and a count that cannot be read
   * leaves the tile saying nothing rather than the page failing.
   */
  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    let ignore: boolean = false;

    if (!projectId) {
      setRecentChanges({ count: null, failed: true });
      return;
    }

    AnalyticsModelAPI.count<ChangeEvent>(
      ChangeEvent,
      getRecentCloudChangesQuery({
        projectId,
        scope: { cloudAccountId: modelId },
        now: OneUptimeDate.getCurrentDate(),
      }),
    )
      .then((count: number): void => {
        if (!ignore) {
          setRecentChanges({ count, failed: false });
        }
      })
      .catch((): void => {
        if (!ignore) {
          setRecentChanges({ count: null, failed: true });
        }
      });

    return (): void => {
      ignore = true;
    };
  }, [modelId.toString()]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!account) {
    return <ErrorMessage message="Cloud account not found." />;
  }

  const provider: string = (account.provider as string) || "";
  const summary: CloudAccountResourceSummary = readCloudAccountResourceSummary(
    account.resourceSummary,
  );
  const status: CloudAccountStatus = getCloudAccountStatus({
    lastSeenAt: account.lastSeenAt,
    hasConnection: Boolean(account.cloudConnectionId),
    now: OneUptimeDate.getCurrentDate(),
  });

  const populate: (page: PageMap) => Route = (page: PageMap): Route => {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route, { modelId });
  };

  const chips: Array<ResourceOverviewChip> = [];

  if (provider) {
    chips.push({
      icon: IconProp.Cloud,
      label: getCloudProviderLabel(provider),
    });
  }

  /*
   * Four tiles, a row of them: what it holds - its resources (the way to
   * them), in how many Regions and of how many types - and how much
   * changed in it in the last day (the way to its Changes).
   */
  const tiles: Array<ResourceOverviewTile> = [
    {
      title: "Resources",
      value: translator.formatNumber(account.resourceCount || 0),
      icon: IconProp.SquareStack,
      iconColor: "blue",
      to: populate(PageMap.CLOUD_ACCOUNT_VIEW_RESOURCES),
      description:
        "Its live resources in OneUptime: those its connections list and those its telemetry reports.",
    },
    {
      title: "Regions",
      value: translator.formatNumber(account.regionCount || 0),
      icon: IconProp.Globe,
      iconColor: "sky",
    },
    {
      title: "Resource Types",
      value: translator.formatNumber(summary.types.length),
      icon: IconProp.Cube,
      iconColor: "violet",
    },
    {
      title: "Changes",
      value:
        recentChanges.count === null
          ? "—"
          : translator.formatNumber(recentChanges.count),
      loading: recentChanges.count === null && !recentChanges.failed,
      sublabel: "Last 24 hours",
      icon: IconProp.Activity,
      iconColor: "amber",
      to: populate(PageMap.CLOUD_ACCOUNT_VIEW_CHANGES),
      description:
        "What its activity log recorded and its provider's health events about it.",
    },
  ];

  const detailRows: Array<ResourceOverviewDetailRow> = [
    { label: "Cloud", value: getCloudProviderLabel(provider), mono: false },
    { label: "Account ID", value: account.accountId, mono: true },
    {
      label: "Name in the Cloud",
      value: account.providerAccountName,
      mono: false,
    },
    {
      label: "Cloud Connection",
      mono: false,
      value: account.cloudConnectionId
        ? account.cloudConnection?.name || ""
        : undefined,
      element: account.cloudConnectionId ? (
        <AppLink
          to={RouteUtil.populateRouteParams(
            RouteMap[PageMap.CLOUD_CONNECT] as Route,
          )}
          className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
        >
          <span>
            {account.cloudConnection?.name ||
              translator.translateText("Connect")}
          </span>
        </AppLink>
      ) : undefined,
    },
    {
      label: "Last Read",
      mono: false,
      value: account.lastSeenAt
        ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
            account.lastSeenAt,
          )
        : undefined,
    },
    {
      label: "Last Listed",
      mono: false,
      value: account.inventoryListedAt
        ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
            account.inventoryListedAt,
          )
        : undefined,
    },
  ];

  return (
    <>
      <ResourceOverview
        icon={IconProp.Cloud}
        title={(account.name as string) || (account.accountId as string) || ""}
        identifier={(account.accountId as string) || ""}
        identifierLabel="account"
        status={status.label}
        statusLabel={status.label}
        statusTone={status.tone}
        statusDescription="Reading while a cloud connection has read the account within the last hour."
        lastSeenAt={account.lastSeenAt}
        description={account.description as string}
        chips={chips}
        tiles={tiles}
        detailRows={detailRows}
        detailsDescription={translationKey(
          "Which account it is in its cloud, and the connection that reads it.",
        )}
        recordId={modelId.toString()}
        settingsRoute={populate(PageMap.CLOUD_ACCOUNT_VIEW_SETTINGS)}
        labels={account.labels}
      />

      {/*
       * What it holds, side by side while the page is wide enough: a short
       * ranked list each, its bars the share of the most common.
       */}
      <div className="mt-6">
        <CardGrid columns={2} cardWidth="narrow">
          <CountsCard
            title="Resources by Type"
            description="What the account holds, most first, as last counted."
            dataTestId="cloud-account-types"
            emptyText="No resources counted yet."
            items={summary.types.map(
              (entry: CloudAccountTypeCount): RankedBarItem => {
                return {
                  key: entry.type,
                  label: getCloudResourceTypeLabel(provider, entry.type),
                  count: entry.count,
                };
              },
            )}
          />
          <CountsCard
            title="Resources by Region"
            description="Where the account's resources are, most first, as last counted."
            dataTestId="cloud-account-regions"
            emptyText="No regions counted yet."
            items={summary.regions.map(
              (entry: CloudAccountRegionCount): RankedBarItem => {
                return {
                  key: entry.region,
                  label: entry.region,
                  count: entry.count,
                  color: "#0ea5e9",
                };
              },
            )}
          />
        </CardGrid>
      </div>
    </>
  );
};

export default CloudAccountOverview;
