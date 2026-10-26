import PageComponentProps from "../../../PageComponentProps";
import PageMap from "../../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../../Utils/RouteMap";
import AppLink from "../../../../Components/AppLink/AppLink";
import { getCloudAccountResourcesQuery } from "../../../../Components/Cloud/CloudAccountScope";
import useCloudAccount, { CloudAccountRead } from "./UseCloudAccount";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import Route from "Common/Types/API/Route";
import { Gray500, Green } from "Common/Types/BrandColors";
import {
  CLOUD_RESOURCE_TYPES,
  CloudResourceTypeDescriptor,
  getCloudResourceTypeLabel,
} from "Common/Types/Cloud/CloudResourceCatalog";
import ObjectID from "Common/Types/ObjectID";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import LabelsElement from "Common/UI/Components/Label/Labels";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * A cloud account's Resources: every live Cloud Resource of its cloud and
 * account id - those its connections list and those its telemetry reports
 * - each a click from its own page.
 */
const CloudAccountResources: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const read: CloudAccountRead = useCloudAccount(modelId);
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

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
        query={getCloudAccountResourcesQuery({
          projectId,
          provider,
          accountId: (read.account.accountId as string) || "",
        })}
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        showRefreshButton={true}
        name="Cloud Resources"
        searchableFields={["name", "providerResourceId"]}
        selectMoreFields={{
          cloudResourceType: true,
          cloudProvider: true,
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
            getElement: (item: CloudResource): ReactElement => {
              const typeLabel: string = getCloudResourceTypeLabel(
                item.cloudProvider as string | undefined,
                item.cloudResourceType as string | undefined,
              );

              return (
                <div className="min-w-0">
                  <AppLink
                    to={viewRoute(item)}
                    className="text-sm font-medium text-gray-900 truncate hover:underline"
                  >
                    {(item.name as string) || "—"}
                  </AppLink>
                  {typeLabel ? (
                    <div className="text-xs text-gray-500 truncate">
                      {typeLabel}
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
              cloudRegion: true,
            },
            title: "Region",
            type: FieldType.Text,
            hideOnMobile: true,
          },
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
                <Pill
                  text={isReporting ? "Reporting" : "Not reporting"}
                  color={isReporting ? Green : Gray500}
                />
              );
            },
          },
          {
            field: {
              lastSeenAt: true,
            },
            title: "Last Seen",
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
            getElement: (item: CloudResource): ReactElement => {
              return <LabelsElement labels={item["labels"] || []} />;
            },
          },
        ]}
        onViewPage={(item: CloudResource): Promise<Route> => {
          return Promise.resolve(viewRoute(item));
        }}
      />
    </Fragment>
  );
};

export default CloudAccountResources;
