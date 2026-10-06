import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import LabelsElement from "Common/UI/Components/Label/Labels";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkArchiveActions from "Common/UI/Components/BulkUpdate/BulkArchiveActions";
import FieldType from "Common/UI/Components/Types/FieldType";
import StorageArray from "Common/Models/DatabaseModels/StorageArray";
import User from "Common/Models/DatabaseModels/User";
import UserElement from "../../Components/User/User";
import AppLink from "../../Components/AppLink/AppLink";
import ObjectID from "Common/Types/ObjectID";
import { StorageSystemUtil } from "Common/Types/StorageArray/StorageSystem";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const StorageArraysArchivedPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { unarchiveBulkActions } = useBulkArchiveActions<StorageArray>({
    modelType: StorageArray,
  });

  return (
    <Fragment>
      <ModelTable<StorageArray>
        modelType={StorageArray}
        id="storage-arrays-archived-table"
        userPreferencesKey="storage-arrays-archived-table"
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
        name="Archived Storage Arrays"
        cardProps={{
          title: "Archived Storage Arrays",
          description:
            "Storage arrays you have archived. They are hidden from the main list but keep collecting telemetry. Select arrays to unarchive them.",
        }}
        showViewIdButton={true}
        noItemsMessage={"No archived storage arrays."}
        showRefreshButton={true}
        /*
         * View opens the resource's own page. The default view route (this
         * list's URL + /<id>) would be ".../archived/<id>", which no route
         * matches, so the user would land on a blank page.
         */
        onViewPage={(item: StorageArray): Promise<Route> => {
          return Promise.resolve(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.STORAGE_ARRAY_VIEW] as Route,
              {
                modelId: new ObjectID(item._id as string),
              },
            ),
          );
        }}
        searchableFields={["name", "description"]}
        filters={[]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Element,
            getElement: (item: StorageArray): ReactElement => {
              const route: Route = RouteUtil.populateRouteParams(
                RouteMap[PageMap.STORAGE_ARRAY_VIEW] as Route,
                {
                  modelId: new ObjectID(item._id as string),
                },
              );
              return (
                <AppLink
                  to={route}
                  className="text-sm font-medium text-gray-900 hover:underline"
                >
                  {(item.name as string) || "—"}
                </AppLink>
              );
            },
          },
          {
            field: {
              storageSystem: true,
            },
            title: "Platform",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: StorageArray): ReactElement => {
              if (!item.storageSystem) {
                return <span className="text-gray-400">—</span>;
              }
              return (
                <span className="text-sm text-gray-700">
                  {StorageSystemUtil.getDisplayName(item.storageSystem)}
                </span>
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
            getElement: (item: StorageArray): ReactElement => {
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
            getElement: (item: StorageArray): ReactElement => {
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

export default StorageArraysArchivedPage;
