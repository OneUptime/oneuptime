import LabelsElement from "Common/UI/Components/Label/Labels";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import URL from "Common/Types/API/URL";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Label from "Common/Models/DatabaseModels/Label";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import React, { FunctionComponent, ReactElement } from "react";
import StatusPageElement from "../../Components/StatusPage/StatusPageElement";

const StatusPages: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <div>
      <ModelTable<StatusPage>
        modelType={StatusPage}
        id="status-page-table"
        userPreferencesKey="status-page-table"
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        name="Status Pages"
        isViewable={true}
        cardProps={{
          title: "Status Pages",
          description: "Here is a list of status pages for this project.",
        }}
        videoLink={URL.fromString("https://youtu.be/F6BNipy5VCk")}
        showViewIdButton={true}
        noItemsMessage={"No status pages found."}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Status Page Name",
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
            required: false,
            placeholder: "Description",
          },
        ]}
        saveFilterProps={{
          tableId: "all-status-pages-table",
        }}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
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
              description: true,
            },
            title: "Description",
            type: FieldType.LongText,
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
              projectId: ProjectUtil.getCurrentProjectId()!,
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
            title: "Name",
            type: FieldType.Element,
            getElement: (item: StatusPage): ReactElement => {
              return <StatusPageElement statusPage={item} />;
            },
          },
          {
            field: {
              description: true,
            },
            noValueMessage: "-",
            title: "Description",
            type: FieldType.LongText,
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

            getElement: (item: StatusPage): ReactElement => {
              return <LabelsElement labels={item["labels"] || []} />;
            },
          },
        ]}
      />
    </div>
  );
};

export default StatusPages;
