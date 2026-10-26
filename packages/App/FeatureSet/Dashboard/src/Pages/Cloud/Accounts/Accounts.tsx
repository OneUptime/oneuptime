import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import AppLink from "../../../Components/AppLink/AppLink";
import CloudConnectCallout from "../../../Components/Cloud/Connect/CloudConnectCallout";
import useFirstRecordWatch, {
  FirstRecordWatch,
} from "../../../Components/Infrastructure/UseFirstRecordWatch";
import CloudAccount from "Common/Models/DatabaseModels/CloudAccount";
import Route from "Common/Types/API/Route";
import {
  CLOUD_PROVIDER_LABELS,
  CloudProvider,
  getCloudProviderLabel,
} from "Common/Types/Cloud/CloudPlatform";
import ObjectID from "Common/Types/ObjectID";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import LabelsElement from "Common/UI/Components/Label/Labels";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * Cloud > Accounts: the AWS accounts, Azure subscriptions and Google Cloud
 * projects the cloud connections reach, each with how many resources it
 * holds, in how many regions, and when a connection last read it.
 *
 * Every row is a connection's: an account is added when a connection first
 * reaches it (CloudAccountService), so there is no create button -
 * connecting an account (Cloud > Connect, offered below while the list is
 * empty) is how one gets here. People label and describe them.
 */

const PROVIDER_DROPDOWN_OPTIONS: Array<DropdownOption> = Object.values(
  CloudProvider,
).map((provider: CloudProvider): DropdownOption => {
  return { label: CLOUD_PROVIDER_LABELS[provider], value: provider };
});

const CloudAccounts: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const firstRecordWatch: FirstRecordWatch = useFirstRecordWatch<CloudAccount>({
    modelType: CloudAccount,
  });

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

  const viewRoute: (item: CloudAccount) => Route = (
    item: CloudAccount,
  ): Route => {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.CLOUD_ACCOUNT_VIEW] as Route,
      { modelId: new ObjectID(item._id as string) },
    );
  };

  return (
    <Fragment>
      <ModelTable<CloudAccount>
        modelType={CloudAccount}
        id="cloud-accounts-table"
        userPreferencesKey="cloud-accounts-table"
        refreshToggle={firstRecordWatch.refreshToken}
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        showRefreshButton={true}
        showViewIdButton={true}
        name="Cloud Accounts"
        searchableFields={["name", "accountId", "providerAccountName"]}
        selectMoreFields={{
          provider: true,
          accountId: true,
        }}
        cardProps={{
          title: "Cloud Accounts",
          description:
            "The AWS accounts, Azure subscriptions and Google Cloud projects your cloud connections read, with what each one holds.",
        }}
        noItemsMessage="No cloud accounts yet. An account appears here once a cloud connection reads it."
        filters={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              provider: true,
            },
            title: "Cloud",
            type: FieldType.Dropdown,
            filterDropdownOptions: PROVIDER_DROPDOWN_OPTIONS,
          },
          {
            field: {
              accountId: true,
            },
            title: "Account ID",
            type: FieldType.Text,
          },
          {
            field: {
              lastSeenAt: true,
            },
            title: "Last Read",
            type: FieldType.Date,
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Element,
            isNotCustomizable: true,
            /*
             * The account's cloud and its id there under its name - not a
             * column of their own: an Azure subscription's id is 36
             * characters, and a column for it pushed Last Read and Labels
             * under the row's actions beside the side menu at 1280 pixels.
             */
            getElement: (item: CloudAccount): ReactElement => {
              const name: string = (item.name as string) || "";
              const accountId: string = (item.accountId as string) || "";
              const cloud: string = getCloudProviderLabel(
                (item.provider as string) || "",
              );
              const where: string =
                accountId && accountId !== name
                  ? `${cloud} · ${accountId}`
                  : cloud;

              return (
                <div className="min-w-0">
                  <AppLink
                    to={viewRoute(item)}
                    className="text-sm font-medium text-gray-900 truncate hover:underline"
                  >
                    {name || accountId || "—"}
                  </AppLink>
                  {/*
                   * Cut at 16rem with the whole line on hover: an Azure
                   * subscription's id would otherwise set the column's width.
                   */}
                  <div
                    className="max-w-[16rem] truncate text-xs text-gray-500"
                    title={where}
                    data-testid="cloud-account-where"
                  >
                    {where}
                  </div>
                </div>
              );
            },
          },
          {
            field: {
              resourceCount: true,
            },
            title: "Resources",
            type: FieldType.Number,
          },
          /*
           * On an account's Overview with its resources by Region; here only
           * when asked for, so Last Read and Labels fit beside the side menu.
           */
          {
            field: {
              regionCount: true,
            },
            title: "Regions",
            type: FieldType.Number,
            hideOnMobile: true,
            isHiddenByDefault: true,
          },
          {
            field: {
              lastSeenAt: true,
            },
            title: "Last Read",
            type: FieldType.DateTime,
            hideOnMobile: true,
          },
          {
            field: {
              labels: {
                name: true,
                color: true,
              },
            },
            title: "Labels",
            type: FieldType.EntityArray,
            hideOnMobile: true,
            getElement: (item: CloudAccount): ReactElement => {
              return <LabelsElement labels={item["labels"] || []} />;
            },
          },
        ]}
        onViewPage={(item: CloudAccount): Promise<Route> => {
          return Promise.resolve(viewRoute(item));
        }}
      />
      {/* The way in while the list is empty: connect a cloud account. */}
      {firstRecordWatch.count === 0 ? <CloudConnectCallout /> : <></>}
    </Fragment>
  );
};

export default CloudAccounts;
