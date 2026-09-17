import LabelsElement from "Common/UI/Components/Label/Labels";
import ServiceElement from "../../Components/Service/ServiceElement";
import PageComponentProps from "../PageComponentProps";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkArchiveActions from "Common/UI/Components/BulkUpdate/BulkArchiveActions";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Service from "Common/Models/DatabaseModels/Service";
import User from "Common/Models/DatabaseModels/User";
import UserElement from "../../Components/User/User";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const ServiceArchivedPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { unarchiveBulkActions } = useBulkArchiveActions<Service>({
    modelType: Service,
  });

  return (
    <Fragment>
      <ModelTable<Service>
        modelType={Service}
        id="service-archived-table"
        userPreferencesKey="service-archived-table"
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
        name="Archived Services"
        cardProps={{
          title: "Archived Services",
          description:
            "Services you have archived. They are hidden from the main list but keep collecting telemetry. Select services to unarchive them.",
        }}
        showViewIdButton={true}
        noItemsMessage={"No archived services."}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        searchableFields={["name", "description"]}
        selectMoreFields={{
          serviceColor: true,
        }}
        filters={[]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Element,
            getElement: (service: Service): ReactElement => {
              return (
                <Fragment>
                  <ServiceElement service={service} />
                </Fragment>
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
            getElement: (item: Service): ReactElement => {
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
            getElement: (item: Service): ReactElement => {
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

export default ServiceArchivedPage;
