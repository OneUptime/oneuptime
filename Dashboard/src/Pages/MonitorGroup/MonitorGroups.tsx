import LabelsElement from "../../Components/Label/Labels";
import CurrentStatusElement from "../../Components/MonitorGroup/CurrentStatus";
import DashboardNavigation from "../../Utils/Navigation";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import DashboardSideMenu from "../Monitor/SideMenu";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Page from "Common/UI/Components/Page/Page";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Label from "Common/Models/DatabaseModels/Label";
import MonitorGroup from "Common/Models/DatabaseModels/MonitorGroup";
import React, { FunctionComponent, ReactElement } from "react";

const MonitorGroupPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <Page
      title={"Monitors"}
      breadcrumbLinks={[
        {
          title: "Project",
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: "Monitors",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.MONITORS] as Route,
          ),
        },
        {
          title: "Monitor Groups",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.MONITOR_GROUPS] as Route,
          ),
        },
      ]}
      sideMenu={
        <DashboardSideMenu project={props.currentProject || undefined} />
      }
    >
      <ModelTable<MonitorGroup>
        modelType={MonitorGroup}
        name="Monitor Groups"
        id="monitors-group-table"
        isDeleteable={false}
        showViewIdButton={true}
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        cardProps={{
          title: "Monitor Groups",
          description: "Here is a list of monitors groups for this project.",
        }}
        noItemsMessage={"No monitor groups found."}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",

            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Monitor Name",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },

            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: true,
            placeholder: "Description",
          },
        ]}
        viewPageRoute={Navigation.getCurrentRoute()}
        showRefreshButton={true}
        filters={[
          {
            field: {
              name: true,
            },
            title: "Group Name",
            type: FieldType.Text,
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

            filterEntityType: Label,
            filterQuery: {
              projectId: DashboardNavigation.getProjectId()?.toString(),
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Group Name",
            type: FieldType.Text,
          },
          {
            field: {
              _id: true,
            },
            title: "Current Status",
            type: FieldType.Element,
            getElement: (item: MonitorGroup): ReactElement => {
              if (!item["_id"]) {
                throw new BadDataException("Monitor Group ID not found");
              }

              return (
                <CurrentStatusElement
                  monitorGroupId={new ObjectID(item["_id"].toString())}
                />
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

            getElement: (item: MonitorGroup): ReactElement => {
              return <LabelsElement labels={item["labels"] || []} />;
            },
          },
        ]}
      />
    </Page>
  );
};

export default MonitorGroupPage;
