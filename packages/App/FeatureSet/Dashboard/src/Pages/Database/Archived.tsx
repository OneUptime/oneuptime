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
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import User from "Common/Models/DatabaseModels/User";
import UserElement from "../../Components/User/User";
import AppLink from "../../Components/AppLink/AppLink";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import {
  getDatabaseEndpointLabel,
  getDatabaseEngineLabel,
} from "./Utils/DatabaseServerPresentation";

/*
 * Archived databases. A discovered database that is not seen for a while is
 * archived automatically (autoArchivedAt set, "Archived By" empty) and comes
 * back on its own the next time any source sees it; one archived by a person
 * stays here until someone unarchives it.
 */
const DatabaseArchivedPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { unarchiveBulkActions } = useBulkArchiveActions<DatabaseServer>({
    modelType: DatabaseServer,
  });

  return (
    <Fragment>
      <ModelTable<DatabaseServer>
        modelType={DatabaseServer}
        id="database-archived-table"
        userPreferencesKey="database-archived-table"
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
        name="Archived Databases"
        cardProps={{
          title: "Archived Databases",
          description:
            "Databases you archived, and discovered databases archived automatically after they stopped being seen. They are hidden from the main list; an automatically archived database returns on its own when it is seen again. Select databases to unarchive them.",
        }}
        showViewIdButton={true}
        noItemsMessage={"No archived databases."}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        searchableFields={["name", "description", "serverAddress"]}
        filters={[]}
        columns={[
          {
            field: {
              name: true,
              serverAddress: true,
              serverPort: true,
              kubernetesNamespace: true,
              workloadKind: true,
              workloadName: true,
            },
            title: "Name",
            type: FieldType.Element,
            getElement: (item: DatabaseServer): ReactElement => {
              const route: Route = RouteUtil.populateRouteParams(
                RouteMap[PageMap.DATABASE_SERVER_VIEW] as Route,
                {
                  modelId: new ObjectID(item._id as string),
                },
              );
              const subtitle: string = getDatabaseEndpointLabel(item);
              return (
                <div className="min-w-0">
                  <AppLink
                    to={route}
                    className="text-sm font-medium text-gray-900 truncate hover:underline"
                  >
                    {(item.name as string) || "—"}
                  </AppLink>
                  {subtitle && (
                    <div className="text-xs text-gray-500 font-mono truncate">
                      {subtitle}
                    </div>
                  )}
                </div>
              );
            },
          },
          {
            field: {
              dbSystem: true,
            },
            title: "Engine",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: DatabaseServer): ReactElement => {
              return (
                <span className="text-sm text-gray-700">
                  {getDatabaseEngineLabel(item.dbSystem)}
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
            getElement: (item: DatabaseServer): ReactElement => {
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
              autoArchivedAt: true,
            },
            title: "Archived By",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: DatabaseServer): ReactElement => {
              if (item["archivedByUser"]) {
                return <UserElement user={item["archivedByUser"] as User} />;
              }
              if (item.autoArchivedAt) {
                return (
                  <span className="text-sm text-gray-500">
                    Automatically (not seen)
                  </span>
                );
              }
              return <span className="text-gray-400">—</span>;
            },
          },
        ]}
      />
    </Fragment>
  );
};

export default DatabaseArchivedPage;
