import MonitorStatuesElement from "../../../Components/MonitorStatus/MonitorStatusesElement";
import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Navigation from "Common/UI/Utils/Navigation";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageHistoryChartBarColorRule from "Common/Models/DatabaseModels/StatusPageHistoryChartBarColorRule";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import UptimePrecision from "Common/Types/StatusPage/UptimePrecision";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ProjectUtil from "Common/UI/Utils/Project";
import MarkdownUtil from "Common/UI/Utils/Markdown";

const StatusPageDelete: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <CardModelDetail<StatusPage>
        name="Status Page > Branding > Overview Page"
        cardProps={{
          title: "Overview Page",
          description: "Essential branding elements for overview page.",
        }}
        createEditModalWidth={ModalWidth.Large}
        isEditable={true}
        editButtonText={"Edit Branding"}
        formFields={[
          {
            field: {
              overviewPageDescription: true,
            },
            title: "Overview Page Description.",
            fieldType: FormFieldSchemaType.Markdown,
            required: false,
            description: MarkdownUtil.getMarkdownCheatsheet(
              "Describe your status page overview here",
            ),
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: StatusPage,
          id: "overview-page-description",
          fields: [
            {
              field: {
                overviewPageDescription: true,
              },
              fieldType: FieldType.Markdown,
              title: "Overview Page Description",
              placeholder: "No description set.",
            },
          ],
          modelId: modelId,
        }}
      />

      <ModelTable<StatusPageHistoryChartBarColorRule>
        modelType={StatusPageHistoryChartBarColorRule}
        id={`status-page-history-chart-bar-color-rules`}
        isDeleteable={true}
        name="Status Page > Branding > History Chart Bar Color Rules"
        userPreferencesKey="status-page-history-chart-bar-color-rules"
        sortBy="order"
        showViewIdButton={true}
        sortOrder={SortOrder.Ascending}
        isCreateable={true}
        isViewable={false}
        isEditable={true}
        query={{
          statusPageId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        enableDragAndDrop={true}
        dragDropIndexField="order"
        singularName="Rule"
        pluralName="Rules"
        onBeforeCreate={(
          item: StatusPageHistoryChartBarColorRule,
        ): Promise<StatusPageHistoryChartBarColorRule> => {
          if (!props.currentProject || !props.currentProject._id) {
            throw new BadDataException("Project ID cannot be null");
          }

          item.statusPageId = modelId;
          item.projectId = new ObjectID(props.currentProject._id);

          return Promise.resolve(item);
        }}
        cardProps={{
          title: `Rules for Bar Colors of History Chart`,
          description: "Rules for history chart bar colors.",
        }}
        noItemsMessage={
          "No history chart bar color rules have been set. By default the lowest monitor state color of that particular day will be used."
        }
        formFields={[
          {
            field: {
              uptimePercentGreaterThanOrEqualTo: true,
            },
            title: "When uptime % is greater than or equal to",
            description:
              "This rule will be applied when uptime is greater than or equal to this value.",
            fieldType: FormFieldSchemaType.Number,
            validation: {
              minValue: 0,
              maxValue: 100,
            },
            required: true,
            placeholder: "90",
          },
          {
            field: {
              barColor: true,
            },
            title: "Then, use this bar color",
            fieldType: FormFieldSchemaType.Color,
            required: true,
            placeholder: "No color set",
          },
        ]}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[]}
        columns={[
          {
            field: {
              uptimePercentGreaterThanOrEqualTo: true,
            },
            title: "When Uptime Percent >=",
            type: FieldType.Percent,
          },
          {
            field: {
              barColor: true,
            },
            title: "Then, Bar Color is",
            type: FieldType.Color,
          },
        ]}
      />

      <CardModelDetail<StatusPage>
        name="Status Page > Branding > Downtime Monitor Statuses"
        cardProps={{
          title: "Downtime Monitor Statuses",
          description:
            "These monitor statuses are be considered as down when we calculate uptime %.",
        }}
        isEditable={true}
        editButtonText={"Edit Statuses"}
        formFields={[
          {
            field: {
              downtimeMonitorStatuses: true,
            },
            title: "These monitor statuses are considered as down",
            description:
              "These monitor statuses are be considered as down when we calculate uptime %.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: MonitorStatus,
              labelField: "name",
              valueField: "_id",
            },
            required: true,
            placeholder: "Select monitor statuses",
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: StatusPage,
          id: "default-bar-color",
          fields: [
            {
              field: {
                downtimeMonitorStatuses: {
                  _id: true,
                  name: true,
                  color: true,
                },
              },
              title: "Downtime Monitor Statuses",
              description:
                "These monitor statuses are be considered as down when we calculate uptime %",
              fieldType: FieldType.EntityArray,
              getElement: (item: StatusPage): ReactElement => {
                if (item["downtimeMonitorStatuses"]) {
                  return (
                    <MonitorStatuesElement
                      shouldAnimate={false}
                      monitorStatuses={
                        (item[
                          "downtimeMonitorStatuses"
                        ] as Array<MonitorStatus>) || []
                      }
                    />
                  );
                }

                return <></>;
              },
            },
          ],
          modelId: modelId,
        }}
      />

      <CardModelDetail<StatusPage>
        name="Status Page > Branding > Default Bar Color"
        cardProps={{
          title: "Default Bar Color of the History Chart",
          description:
            "Bar color will be used for history chart when no data is set.",
        }}
        isEditable={true}
        editButtonText={"Edit Default Bar Color"}
        formFields={[
          {
            field: {
              defaultBarColor: true,
            },
            title: "Default Bar Color",
            fieldType: FormFieldSchemaType.Color,
            required: true,
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: StatusPage,
          id: "default-bar-color",
          fields: [
            {
              field: {
                defaultBarColor: true,
              },
              fieldType: FieldType.Color,
              title: "Default Bar Color",
              placeholder: "No color set.",
            },
          ],
          modelId: modelId,
        }}
      />

      <CardModelDetail<StatusPage>
        name="Status Page > Settings"
        cardProps={{
          title: "Overall Uptime Percent",
          description: "Settings for overall uptime percent on status page",
        }}
        editButtonText="Edit Settings"
        isEditable={true}
        formFields={[
          {
            field: {
              showOverallUptimePercentOnStatusPage: true,
            },
            title: "Show Overall Uptime Percent",
            description:
              "Show or hide the overall uptime percent on the status page",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            placeholder: "No",
          },
          {
            field: {
              overallUptimePercentPrecision: true,
            },
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions:
              DropdownUtil.getDropdownOptionsFromEnum(UptimePrecision),
            showIf: (item: FormValues<StatusPage>): boolean => {
              return Boolean(item.showOverallUptimePercentOnStatusPage);
            },
            title: "Select Uptime Precision",
            defaultValue: UptimePrecision.TWO_DECIMAL,
            required: true,
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: StatusPage,
          id: "model-detail-status-page",
          fields: [
            {
              field: {
                showOverallUptimePercentOnStatusPage: true,
              },
              fieldType: FieldType.Boolean,
              title: "Show Overall Uptime Percent",
            },

            {
              field: {
                overallUptimePercentPrecision: true,
              },
              title: "Overall Uptime Precision",
              fieldType: FieldType.Text,
            },
          ],
          modelId: modelId,
        }}
      />
    </Fragment>
  );
};

export default StatusPageDelete;
