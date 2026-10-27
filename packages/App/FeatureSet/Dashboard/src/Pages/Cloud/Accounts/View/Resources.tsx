import PageComponentProps from "../../../PageComponentProps";
import PageMap from "../../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../../Utils/RouteMap";
import AppLink from "../../../../Components/AppLink/AppLink";
import { getCloudAccountResourcesQuery } from "../../../../Components/Cloud/CloudAccountScope";
import OwnersCell from "../../../../Components/ResourceOwners/OwnersCell";
import useResourceOwners from "../../../../Components/ResourceOwners/useResourceOwners";
import useCloudAccount, { CloudAccountRead } from "./UseCloudAccount";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import CloudResourceOwnerTeam from "Common/Models/DatabaseModels/CloudResourceOwnerTeam";
import CloudResourceOwnerUser from "Common/Models/DatabaseModels/CloudResourceOwnerUser";
import Route from "Common/Types/API/Route";
import { Gray500, Green } from "Common/Types/BrandColors";
import OneUptimeDate from "Common/Types/Date";
import {
  CLOUD_RESOURCE_TYPES,
  CloudResourceTypeDescriptor,
  getCloudResourceTypeLabel,
} from "Common/Types/Cloud/CloudResourceCatalog";
import ObjectID from "Common/Types/ObjectID";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import useBulkOwnerActions from "Common/UI/Components/BulkUpdate/BulkOwnerActions";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import LabelsElement from "Common/UI/Components/Label/Labels";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * A cloud account's Resources: every live Cloud Resource of its cloud and
 * account id - those its connections list and those its telemetry reports
 * - each a click from its own page. Found by owner and label as on All
 * Resources, with the same bulk label and owner actions.
 */
const CloudAccountResources: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const read: CloudAccountRead = useCloudAccount(modelId);
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const translator: Translator = useTranslator();

  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<CloudResource>({ modelType: CloudResource });

  const { bulkActions: ownerBulkActions, modals: ownerBulkActionModals } =
    useBulkOwnerActions<CloudResource>({
      ownerUserModelType: CloudResourceOwnerUser,
      ownerTeamModelType: CloudResourceOwnerTeam,
      resourceIdField: "cloudResourceId",
    });

  /*
   * The Owner and Labels chips above the table - the server answers the
   * Owner chip in the list's own query - and the Owners column shows who
   * owns each resource.
   */
  const {
    getOwnersForResource,
    isLoadingOwners,
    onResourcesFetched,
    filterBar,
    emptyState: facetEmptyState,
    mergeFiltersIntoQuery,
  } = useResourceOwners<CloudResource>({
    persistKey: "cloud-account-resources-table",
    ownerUserModelType: CloudResourceOwnerUser,
    ownerTeamModelType: CloudResourceOwnerTeam,
    resourceIdField: "cloudResourceId",
    showLabelsFacet: true,
  });

  if (read.isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (read.error || !read.account || !projectId) {
    return <ErrorMessage message={read.error || "Cloud account not found."} />;
  }

  const provider: string = (read.account.provider as string) || "";

  // The types of this account's cloud, for the Type filter.
  const typeOptions: Array<DropdownOption> = CLOUD_RESOURCE_TYPES.filter(
    (descriptor: CloudResourceTypeDescriptor): boolean => {
      return descriptor.provider === provider;
    },
  )
    .map((descriptor: CloudResourceTypeDescriptor): DropdownOption => {
      return { label: descriptor.label, value: descriptor.type };
    })
    .sort((a: DropdownOption, b: DropdownOption): number => {
      return a.label.localeCompare(b.label);
    });

  const viewRoute: (item: CloudResource) => Route = (
    item: CloudResource,
  ): Route => {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.CLOUD_RESOURCE_VIEW] as Route,
      { modelId: new ObjectID(item._id as string) },
    );
  };

  return (
    <Fragment>
      <ModelTable<CloudResource>
        modelType={CloudResource}
        id="cloud-account-resources-table"
        userPreferencesKey="cloud-account-resources-table"
        topContent={filterBar}
        emptyState={facetEmptyState}
        query={mergeFiltersIntoQuery(
          getCloudAccountResourcesQuery({
            projectId,
            provider,
            accountId: (read.account.accountId as string) || "",
          }),
        )}
        onFetchSuccess={(data: Array<CloudResource>) => {
          onResourcesFetched(data);
        }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        bulkActions={{
          buttons: [...labelBulkActions, ...ownerBulkActions],
        }}
        showRefreshButton={true}
        name="Cloud Resources"
        searchableFields={["name", "providerResourceId"]}
        selectMoreFields={{
          cloudResourceType: true,
          cloudProvider: true,
          cloudRegion: true,
          lastSeenAt: true,
        }}
        cardProps={{
          title: "Resources",
          description:
            "Every live resource of this account: those its cloud connections list and those its telemetry reports.",
        }}
        noItemsMessage="No resources in this account yet. They appear once a cloud connection lists them."
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
              cloudResourceType: true,
            },
            title: "Type",
            type: FieldType.Dropdown,
            filterDropdownOptions: typeOptions,
          },
          {
            field: {
              cloudRegion: true,
            },
            title: "Region",
            type: FieldType.Text,
          },
          {
            field: {
              lastSeenAt: true,
            },
            title: "Last Seen",
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
             * What it is and where, under its name - the way the accounts
             * list says each account's cloud and id - not a Region column
             * of its own: beside the side menu at 1280 pixels a German
             * list ran 20 pixels past its card with one. On a phone the
             * Region is then still said.
             */
            getElement: (item: CloudResource): ReactElement => {
              const typeLabel: string = getCloudResourceTypeLabel(
                item.cloudProvider as string | undefined,
                item.cloudResourceType as string | undefined,
              );
              const where: string = [
                typeLabel,
                ((item.cloudRegion as string) || "").trim(),
              ]
                .filter((part: string): boolean => {
                  return part.length > 0;
                })
                .join(" · ");

              return (
                <div className="min-w-0">
                  <AppLink
                    to={viewRoute(item)}
                    className="text-sm font-medium text-gray-900 truncate hover:underline"
                  >
                    {(item.name as string) || "—"}
                  </AppLink>
                  {where ? (
                    <div
                      className="max-w-[18rem] text-xs text-gray-500 truncate"
                      title={where}
                      data-testid="cloud-account-resource-where"
                    >
                      {where}
                    </div>
                  ) : (
                    <></>
                  )}
                </div>
              );
            },
          },
          /*
           * Whether it reports, and when it was last seen, in one column -
           * as the accounts list says when each account was last read - so
           * Labels and Owners stay clear of the row's actions beside the
           * side menu.
           */
          {
            field: {
              otelCollectorStatus: true,
            },
            title: "Status",
            type: FieldType.Element,
            getElement: (item: CloudResource): ReactElement => {
              const isReporting: boolean =
                item.otelCollectorStatus === "connected";

              return (
                <div
                  className="min-w-0 space-y-1"
                  data-testid="cloud-account-resource-status"
                >
                  <Pill
                    text={isReporting ? "Reporting" : "Not reporting"}
                    color={isReporting ? Green : Gray500}
                  />
                  {item.lastSeenAt ? (
                    <div
                      className="text-xs text-gray-500"
                      title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                        item.lastSeenAt,
                      )}
                    >
                      {translator.translateTemplate("Last seen {{time}}", {
                        time: OneUptimeDate.getDateAsLocalShortDateTimeString(
                          item.lastSeenAt,
                        ),
                      })}
                    </div>
                  ) : (
                    <></>
                  )}
                </div>
              );
            },
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
            getElement: (item: CloudResource): ReactElement => {
              return <LabelsElement labels={item["labels"] || []} />;
            },
          },
          {
            field: {
              _id: true,
            },
            title: "Owners",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: CloudResource): ReactElement => {
              return (
                <OwnersCell
                  owners={getOwnersForResource(item)}
                  isLoading={isLoadingOwners}
                />
              );
            },
          },
        ]}
        onViewPage={(item: CloudResource): Promise<Route> => {
          return Promise.resolve(viewRoute(item));
        }}
      />
      {labelBulkActionModals}
      {ownerBulkActionModals}
    </Fragment>
  );
};

export default CloudAccountResources;
