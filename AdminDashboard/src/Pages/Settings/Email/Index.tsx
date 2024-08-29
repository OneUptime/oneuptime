import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import DashboardSideMenu from "../SideMenu";
import Route from "Common/Types/API/Route";
import { Green, Red } from "Common/Types/BrandColors";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import Page from "Common/UI/Components/Page/Page";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import GlobalConfig, {
  EmailServerType,
} from "Common/Models/DatabaseModels/GlobalConfig";
import React, { FunctionComponent, ReactElement, useEffect } from "react";

const Settings: FunctionComponent = (): ReactElement => {
  const [emailServerType, setemailServerType] = React.useState<EmailServerType>(
    EmailServerType.Internal,
  );

  const [isLoading, setIsLoading] = React.useState<boolean>(true);

  const [error, setError] = React.useState<string>("");

  const fetchItem: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);

    const globalConfig: GlobalConfig | null =
      await ModelAPI.getItem<GlobalConfig>({
        modelType: GlobalConfig,
        id: ObjectID.getZeroObjectID(),
        select: {
          _id: true,
          emailServerType: true,
        },
      });

    if (globalConfig) {
      setemailServerType(
        globalConfig.emailServerType || EmailServerType.Internal,
      );
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchItem().catch((err: Error) => {
      setError(err.message);
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage error={error} />;
  }

  return (
    <Page
      title={"Admin Settings"}
      breadcrumbLinks={[
        {
          title: "Admin Dashboard",
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: "Settings",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS] as Route,
          ),
        },
        {
          title: "Email Settings",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS_SMTP] as Route,
          ),
        },
      ]}
      sideMenu={<DashboardSideMenu />}
    >
      {/* Project Settings View  */}

      <CardModelDetail
        name="Admin Notification Email"
        cardProps={{
          title: "Admin Notification Email",
          description:
            "Enter the email address where you would like to receive admin-level notifications.",
        }}
        isEditable={true}
        editButtonText="Edit Email"
        formFields={[
          {
            field: {
              adminNotificationEmail: true,
            },
            title: "Admin Notification Email",
            fieldType: FormFieldSchemaType.Email,
            required: false,
          },
        ]}
        modelDetailProps={{
          modelType: GlobalConfig,
          id: "model-detail-global-config",
          fields: [
            {
              field: {
                adminNotificationEmail: true,
              },
              title: "Admin Notification Email",
              fieldType: FieldType.Email,
              placeholder: "None",
            },
          ],
          modelId: ObjectID.getZeroObjectID(),
        }}
      />

      <CardModelDetail
        name="Internal SMTP Settings"
        cardProps={{
          title: "Email Server Settings",
          description:
            "Pick which email server you would like to use to send emails.",
        }}
        isEditable={true}
        editButtonText="Edit Server"
        onSaveSuccess={() => {
          window.location.reload();
        }}
        formFields={[
          {
            field: {
              emailServerType: true,
            },
            title: "Email Server Type",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions:
              DropdownUtil.getDropdownOptionsFromEnum(EmailServerType),
            required: true,
          },
        ]}
        modelDetailProps={{
          modelType: GlobalConfig,
          id: "model-detail-global-config",
          fields: [
            {
              field: {
                emailServerType: true,
              },
              title: "Email Server Type",
              fieldType: FieldType.Text,
            },
          ],
          modelId: ObjectID.getZeroObjectID(),
        }}
      />

      {emailServerType === EmailServerType.CustomSMTP ? (
        <CardModelDetail
          name="Host Settings"
          cardProps={{
            title: "Custom Email and SMTP Settings",
            description:
              "If you have not enabled Internal SMTP server to send emails. Please configure your SMTP server here.",
          }}
          isEditable={true}
          editButtonText="Edit SMTP Config"
          formSteps={[
            {
              title: "SMTP Server",
              id: "server-info",
            },
            {
              title: "Authentication",
              id: "authentication",
            },
            {
              title: "Email",
              id: "email-info",
            },
          ]}
          formFields={[
            {
              field: {
                smtpHost: true,
              },
              title: "Hostname",
              stepId: "server-info",
              fieldType: FormFieldSchemaType.Hostname,
              required: true,
              placeholder: "smtp.server.com",
            },
            {
              field: {
                smtpPort: true,
              },
              title: "Port",
              stepId: "server-info",
              fieldType: FormFieldSchemaType.Port,
              required: true,
              placeholder: "587",
            },
            {
              field: {
                isSMTPSecure: true,
              },
              title: "Use SSL / TLS",
              stepId: "server-info",
              fieldType: FormFieldSchemaType.Toggle,
              description:
                "If you use port 465, please enable this. Do not enable this if you use port 587.",
            },
            {
              field: {
                smtpUsername: true,
              },
              title: "Username",
              stepId: "authentication",
              fieldType: FormFieldSchemaType.Text,
              required: false,
              placeholder: "emailuser",
            },
            {
              field: {
                smtpPassword: true,
              },
              title: "Password",
              stepId: "authentication",
              fieldType: FormFieldSchemaType.EncryptedText,
              required: false,
              placeholder: "Password",
            },
            {
              field: {
                smtpFromEmail: true,
              },
              title: "Email From",
              stepId: "email-info",
              fieldType: FormFieldSchemaType.Email,
              required: true,
              description:
                "Email used to log in to this SMTP Server. This is also the email your customers will see. ",
              placeholder: "email@company.com",
            },
            {
              field: {
                smtpFromName: true,
              },
              title: "From Name",
              stepId: "email-info",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              description:
                "This is the display name your team and customers see, when they receive emails from OneUptime.",
              placeholder: "Company, Inc.",
            },
          ]}
          modelDetailProps={{
            modelType: GlobalConfig,
            id: "model-detail-global-config",
            fields: [
              {
                field: {
                  smtpHost: true,
                },
                title: "SMTP Host",
                placeholder: "None",
              },
              {
                field: {
                  smtpPort: true,
                },
                title: "SMTP Port",
                placeholder: "None",
              },
              {
                field: {
                  smtpUsername: true,
                },
                title: "SMTP Username",
                placeholder: "None",
              },
              {
                field: {
                  smtpFromEmail: true,
                },
                title: "SMTP Email",
                placeholder: "None",
                fieldType: FieldType.Email,
              },
              {
                field: {
                  smtpFromName: true,
                },
                title: "SMTP From Name",
                placeholder: "None",
              },
              {
                field: {
                  isSMTPSecure: true,
                },
                title: "Use SSL/TLS",
                placeholder: "No",
                fieldType: FieldType.Boolean,
              },
            ],
            modelId: ObjectID.getZeroObjectID(),
          }}
        />
      ) : (
        <></>
      )}

      {emailServerType === EmailServerType.Sendgrid ? (
        <CardModelDetail<GlobalConfig>
          name="Sendgrid Settings"
          cardProps={{
            title: "Sendgrid Settings",
            description:
              "Enter your Sendgrid API key to send emails through Sendgrid.",
          }}
          isEditable={true}
          editButtonText="Edit API Key"
          formFields={[
            {
              field: {
                sendgridApiKey: true,
              },
              title: "Sendgrid API Key",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              placeholder: "Sendgrid API Key",
            },
            {
              field: {
                sendgridFromEmail: true,
              },
              title: "From Email",
              fieldType: FormFieldSchemaType.Email,
              required: true,
              placeholder: "email@yourcompany.com",
            },
            {
              field: {
                sendgridFromName: true,
              },
              title: "From Name",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              placeholder: "Acme, Inc.",
            },
          ]}
          modelDetailProps={{
            modelType: GlobalConfig,
            id: "model-detail-global-config",
            selectMoreFields: {
              sendgridFromEmail: true,
              sendgridFromName: true,
            },
            fields: [
              {
                field: {
                  sendgridApiKey: true,
                },
                title: "",
                placeholder: "None",
                getElement: (item: GlobalConfig) => {
                  if (
                    item["sendgridApiKey"] &&
                    item["sendgridFromEmail"] &&
                    item["sendgridFromName"]
                  ) {
                    return <Pill text="Enabled" color={Green} />;
                  } else if (!item["sendgridApiKey"]) {
                    return (
                      <Pill
                        text="Not Enabled. Please add the API key."
                        color={Red}
                      />
                    );
                  } else if (!item["sendgridFromEmail"]) {
                    return (
                      <Pill
                        text="Not Enabled. Please add the From Email."
                        color={Red}
                      />
                    );
                  } else if (!item["sendgridFromName"]) {
                    return (
                      <Pill
                        text="Not Enabled. Please add the From Name."
                        color={Red}
                      />
                    );
                  }

                  return <></>;
                },
              },
            ],
            modelId: ObjectID.getZeroObjectID(),
          }}
        />
      ) : (
        <></>
      )}
    </Page>
  );
};

export default Settings;
