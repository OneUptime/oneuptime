import DashboardNavigation from "../../Utils/Navigation";
import PageComponentProps from "../PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ApiKey from "Common/Models/DatabaseModels/ApiKey";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const APIKeys: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<ApiKey>
        modelType={ApiKey}
        query={{
          projectId: DashboardNavigation.getProjectId()!,
        }}
        id="api-keys-table"
        name="Settings > API Keys"
        isDeleteable={false}
        isEditable={false}
        showViewIdButton={false}
        isCreateable={true}
        isViewable={true}
        cardProps={{
          title: "API Keys",
          description:
            "Everything you can do on the dashboard can also be done via the OneUptime API- use it to automate repetitive work or integrate with other platforms.",
        }}
        noItemsMessage={"No API Keys found."}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "API Key Name",
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
            placeholder: "API Key Description",
          },
          {
            field: {
              expiresAt: true,
            },
            title: "Expires",
            fieldType: FormFieldSchemaType.Date,
            required: true,
            placeholder: "Expires at",
            validation: {
              dateShouldBeInTheFuture: true,
            },
          },
        ]}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[
          {
            field: {
              name: true,
            },
            type: FieldType.Text,
            title: "Name",
          },
          {
            field: {
              description: true,
            },
            type: FieldType.Text,
            title: "Description",
          },
          {
            field: {
              expiresAt: true,
            },
            type: FieldType.Date,
            title: "Expires",
          },
        ]}
        columns={[
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
            type: FieldType.Text,
          },
          {
            field: {
              expiresAt: true,
            },
            title: "Expires",
            type: FieldType.Date,
          },
        ]}
      />
    </Fragment>
  );
};

export default APIKeys;
