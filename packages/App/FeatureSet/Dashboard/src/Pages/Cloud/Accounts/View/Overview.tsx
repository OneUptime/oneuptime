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
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * A cloud account's Overview: which cloud and account it is, the
 * connection that reads it and when it last did, and what it holds - its
 * resources by type and by region, as the server last counted them
 * (CloudAccount.resourceSummary).
 */

const CloudAccountOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();
  const translator: Translator = useTranslator();

  const [account, setAccount] = useState<CloudAccount | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

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
  ];

  const detailRows: Array<ResourceOverviewDetailRow> = [
    { label: "Cloud", value: getCloudProviderLabel(provider), mono: false },
    { label: "Account ID", value: account.accountId, mono: true },
    { label: "Name in the Cloud", value: account.providerAccountName },
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

  const renderCounts: (
    rows: Array<{ key: string; label: string; count: number }>,
    emptyText: string,
  ) => ReactElement = (
    rows: Array<{ key: string; label: string; count: number }>,
    emptyText: string,
  ): ReactElement => {
    if (rows.length === 0) {
      return (
        <p className="text-sm text-gray-500">
          {translator.translateText(emptyText)}
        </p>
      );
    }

    return (
      <ul className="divide-y divide-gray-100">
        {rows.map(
          (row: {
            key: string;
            label: string;
            count: number;
          }): ReactElement => {
            return (
              <li
                key={row.key}
                className="flex items-center justify-between gap-4 py-2"
              >
                <span className="min-w-0 text-sm text-gray-700 break-words">
                  {row.label}
                </span>
                <span className="text-sm font-medium tabular-nums text-gray-900">
                  {translator.formatNumber(row.count)}
                </span>
              </li>
            );
          },
        )}
      </ul>
    );
  };

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
        settingsRoute={populate(PageMap.CLOUD_ACCOUNT_VIEW_SETTINGS)}
        labels={account.labels}
      />

      <div className="mt-6">
        <Card
          title="Resources by Type"
          description="What the account holds, most first, as last counted."
        >
          {renderCounts(
            summary.types.map(
              (
                entry: CloudAccountTypeCount,
              ): { key: string; label: string; count: number } => {
                return {
                  key: entry.type,
                  label: getCloudResourceTypeLabel(provider, entry.type),
                  count: entry.count,
                };
              },
            ),
            "No resources counted yet.",
          )}
        </Card>
      </div>

      <div className="mt-6">
        <Card
          title="Resources by Region"
          description="Where the account's resources are, most first, as last counted."
        >
          {renderCounts(
            summary.regions.map(
              (
                entry: CloudAccountRegionCount,
              ): { key: string; label: string; count: number } => {
                return {
                  key: entry.region,
                  label: entry.region,
                  count: entry.count,
                };
              },
            ),
            "No regions counted yet.",
          )}
        </Card>
      </div>
    </>
  );
};

export default CloudAccountOverview;
