import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import LabelsElement from "Common/UI/Components/Label/Labels";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkArchiveActions from "Common/UI/Components/BulkUpdate/BulkArchiveActions";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import User from "Common/Models/DatabaseModels/User";
import UserElement from "../../Components/User/User";
import AppLink from "../../Components/AppLink/AppLink";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const CloudArchivedPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { unarchiveBulkActions } = useBulkArchiveActions<CloudResource>({
    modelType: CloudResource,
  });

  return (
    <Fragment>
      <ModelTable<CloudResource>
        modelType={CloudResource}
        id="cloud-archived-table"
        userPreferencesKey="cloud-archived-table"
        query={{
          isArchived: true,
        }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        bulkActions={{
          buttons: [...unarchiveBulkActions],
        }}
        name="Archived Cloud Resources"
        cardProps={{
          title: "Archived Cloud Resources",
          description:
            "Cloud resources you have archived. They are hidden from the main list but keep collecting telemetry. Select cloud resources to unarchive them.",
        }}
        showViewIdButton={true}
        noItemsMessage={"No archived cloud resources."}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        searchableFields={["name", "description"]}
        selectMoreFields={{
          cloudAccountId: true,
        }}
        filters={[]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Element,
            getElement: (item: CloudResource): ReactElement => {
              const account: string = (item.cloudAccountId as string) || "";
              const name: string = (item.name as string) || "";
              const route: Route = RouteUtil.populateRouteParams(
                RouteMap[PageMap.CLOUD_RESOURCE_VIEW] as Route,
                {
                  modelId: new ObjectID(item._id as string),
                },
              );
              return (
                <div className="min-w-0">
                  <AppLink
                    to={route}
                    className="text-sm font-medium text-gray-900 truncate hover:underline"
                  >
                    {name || "—"}
                  </AppLink>
                  {account && (
                    <div className="text-xs text-gray-500 font-mono truncate">
                      account {account}
                    </div>
                  )}
                </div>
              );
            },
          },
          {
            field: {
              lastSeenAt: true,
            },
            title: "Last Seen",
            type: FieldType.DateTime,
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
              archivedAt: true,
            },
            title: "Archived At",
            type: FieldType.DateTime,
          },
          {
            field: {
              archivedByUser: {
                name: true,
                email: true,
                profilePictureId: true,
              },
            },
            title: "Archived By",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: CloudResource): ReactElement => {
              if (!item["archivedByUser"]) {
                return <span className="text-gray-400">—</span>;
              }
              return <UserElement user={item["archivedByUser"] as User} />;
            },
          },
        ]}
      />
    </Fragment>
  );
};

export default CloudArchivedPage;
