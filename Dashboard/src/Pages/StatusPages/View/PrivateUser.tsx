import PageComponentProps from "../../PageComponentProps";
import { Green, Yellow } from "Common/Types/BrandColors";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPagePrivateUser from "Common/Models/DatabaseModels/StatusPagePrivateUser";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ProjectUtil from "Common/UI/Utils/Project";

const StatusPageDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const [isMasterPasswordEnabled, setIsMasterPasswordEnabled] =
    useState<boolean>(false);

  useEffect(() => {
    const fetchStatusPage = async (): Promise<void> => {
      try {
        const statusPage: StatusPage | null = await ModelAPI.getItem({
          modelType: StatusPage,
          id: modelId,
          select: {
            enableMasterPassword: true,
          },
        });

        setIsMasterPasswordEnabled(
          Boolean(statusPage?.enableMasterPassword),
        );
      } catch (error) {
        console.error("Failed to fetch status page details", error);
      }
    };

    void fetchStatusPage();
  }, [modelId]);

  return (
    <Fragment>
      {isMasterPasswordEnabled && (
        <Alert
          className="mb-5"
          type={AlertType.INFO}
          title="Master password is enabled for this status page. Private users authentication is disabled while the master password is active."
        />
      )}
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
