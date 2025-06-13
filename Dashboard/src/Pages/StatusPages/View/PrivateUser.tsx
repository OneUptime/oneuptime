import PageComponentProps from "../../PageComponentProps";
import { Green, Yellow } from "Common/Types/BrandColors";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPagePrivateUser from "Common/Models/DatabaseModels/StatusPagePrivateUser";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ProjectUtil from "Common/UI/Utils/Project";

const StatusPageDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ModelTable<StatusPagePrivateUser>
        modelType={StatusPagePrivateUser}
        id="status-page-group"
        name="Status Page > Private Users"
        userPreferencesKey="status-page-private-user-table"
        isDeleteable={true}
        showViewIdButton={true}
        isCreateable={true}
        isViewable={false}
        query={{
          statusPageId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        onBeforeCreate={(
          item: StatusPagePrivateUser,
        ): Promise<StatusPagePrivateUser> => {
          item.statusPageId = modelId;
          item.projectId = ProjectUtil.getCurrentProjectId()!;
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Private Users",
          description: "Here are a list of private users for this status page.",
        }}
        noItemsMessage={"No private users created for this status page."}
        formFields={[
          {
            field: {
              email: true,
            },
            title: "Email",
            fieldType: FormFieldSchemaType.Email,
            required: true,
            placeholder: "user@company.com",
            disableSpellCheck: true,
          },
        ]}
        showRefreshButton={true}
        filters={[
          {
            field: {
              email: true,
            },
            title: "Email",
            type: FieldType.Email,
          },
        ]}
        columns={[
          {
            field: {
              email: true,
            },
            title: "Email",
            type: FieldType.Email,
          },
          {
            field: {
              password: true,
            },
            title: "Status",
            type: FieldType.Password,

            getElement: (item: StatusPagePrivateUser): ReactElement => {
              if (item["password"]) {
                return <Pill color={Green} text={"Signed up"} />;
              }
              return <Pill color={Yellow} text={"Invite Sent"} />;
            },
          },
        ]}
      />
    </Fragment>
  );
};

export default StatusPageDelete;
