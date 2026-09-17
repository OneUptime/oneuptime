import LabelsElement from "Common/UI/Components/Label/Labels";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkArchiveActions from "Common/UI/Components/BulkUpdate/BulkArchiveActions";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import User from "Common/Models/DatabaseModels/User";
import UserElement from "../../Components/User/User";
import AppLink from "../../Components/AppLink/AppLink";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const RumArchivedPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { unarchiveBulkActions } = useBulkArchiveActions<RumApplication>({
    modelType: RumApplication,
  });

  return (
    <Fragment>
      <ModelTable<RumApplication>
        modelType={RumApplication}
        id="rum-archived-table"
        userPreferencesKey="rum-archived-table"
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
        name="Archived RUM Applications"
        cardProps={{
          title: "Archived RUM Applications",
          description:
            "RUM applications you have archived. They are hidden from the main list but keep collecting telemetry. Select applications to unarchive them.",
        }}
        showViewIdButton={true}
        noItemsMessage={"No archived applications."}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        searchableFields={["name", "description"]}
        selectMoreFields={{
          appIdentifier: true,
        }}
        filters={[]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Element,
            getElement: (item: RumApplication): ReactElement => {
              const id: string = (item.appIdentifier as string) || "";
              const name: string = (item.name as string) || "";
              const showId: boolean = id !== "" && id !== name;
              const route: Route = RouteUtil.populateRouteParams(
                RouteMap[PageMap.RUM_APPLICATION_VIEW] as Route,
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
                  {showId && (
                    <div className="text-xs text-gray-500 font-mono truncate">
                      {id}
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
            getElement: (item: RumApplication): ReactElement => {
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
            getElement: (item: RumApplication): ReactElement => {
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

export default RumArchivedPage;
