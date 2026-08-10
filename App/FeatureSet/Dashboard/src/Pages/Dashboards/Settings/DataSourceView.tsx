import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import API from "Common/UI/Utils/API/API";
import { JSONObject } from "Common/Types/JSON";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import TestDataSource, {
  DataSourceTestResult,
} from "Common/UI/Utils/TestDataSource";
import DataSource from "Common/Models/DatabaseModels/DataSource";
import DataSourceType, {
  DataSourceTypeUtil,
} from "Common/Types/DataSource/DataSourceType";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

const DataSourceView: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const [modelId] = useState<ObjectID>(Navigation.getLastParamAsObjectID());

  const [showTestModal, setShowTestModal] = useState<boolean>(false);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testError, setTestError] = useState<string>("");
  const [testMessage, setTestMessage] = useState<string>("");

  const [showCredentialsModal, setShowCredentialsModal] =
    useState<boolean>(false);
  const [isUpdatingCredentials, setIsUpdatingCredentials] =
    useState<boolean>(false);
  const [credentialsError, setCredentialsError] = useState<string>("");

  const runTest: () => Promise<void> = async (): Promise<void> => {
    setIsTesting(true);
    setTestError("");
    setTestMessage("");

    const result: DataSourceTestResult = await TestDataSource.test({
      dataSourceId: modelId.toString(),
      headers: ModelAPI.getCommonHeaders(),
    });

    if (result.success) {
      setTestMessage(result.message);
    } else {
      setTestError(result.message);
    }

    setIsTesting(false);
  };

  return (
    <Fragment>
      {/* Data Source View  */}
      <CardModelDetail<DataSource>
        name="Data Source Details"
        cardProps={{
          title: "Data Source Details",
          description: "Here are more details for this data source.",
          buttons: [
            {
              title: "Update Credentials",
              icon: IconProp.Lock,
              buttonStyle: ButtonStyleType.OUTLINE,
              onClick: () => {
                setShowCredentialsModal(true);
              },
            },
            {
              title: "Test",
              icon: IconProp.Play,
              buttonStyle: ButtonStyleType.NORMAL,
              onClick: () => {
                setShowTestModal(true);
                runTest().catch(() => {
                  // errors are surfaced via the test result modal
                });
              },
            },
          ],
        }}
        isEditable={true}
        formSteps={[
          {
            title: "Basic Info",
            id: "basic-info",
          },
          {
            title: "Connection",
            id: "connection",
          },
          {
            title: "Authentication",
            id: "auth",
          },
          {
            title: "Advanced",
            id: "advanced",
          },
        ]}
        formFields={[
          {
            field: {
              name: true,
            },
            stepId: "basic-info",
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Production Prometheus",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Prometheus in the production Kubernetes cluster.",
          },
          {
            field: {
              dataSourceType: true,
            },
            title: "Data Source Type",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            /*
             * Never rendered: the type is a create-time choice (create a new
             * data source to change it). The field still has to be here so
             * the edit form fetches it into the form values — every
             * conditional field below is chosen by it.
             */
            showEvenIfPermissionDoesNotExist: true,
            doNotShowWhenEditing: true,
            showIf: (): boolean => {
              return false;
            },
          },
          {
            field: {
              url: true,
            },
            title: "URL",
            stepId: "connection",
            showIf: (item: FormValues<DataSource>): boolean => {
              return DataSourceTypeUtil.isHttpBasedType(
                item.dataSourceType as DataSourceType,
              );
            },
            required: (item: FormValues<DataSource>): boolean => {
              return DataSourceTypeUtil.isHttpBasedType(
                item.dataSourceType as DataSourceType,
              );
            },
            fieldType: FormFieldSchemaType.URL,
            placeholder: "https://prometheus.example.com",
            description:
              "Base URL of the HTTP endpoint this source is reached at.",
          },
          {
            field: {
              databaseHost: true,
            },
            title: "Database Host",
            stepId: "connection",
            showIf: (item: FormValues<DataSource>): boolean => {
              return DataSourceTypeUtil.isDatabaseType(
                item.dataSourceType as DataSourceType,
              );
            },
            required: (item: FormValues<DataSource>): boolean => {
              return DataSourceTypeUtil.isDatabaseType(
                item.dataSourceType as DataSourceType,
              );
            },
            fieldType: FormFieldSchemaType.Text,
            placeholder: "db.example.com",
            description: "Hostname or IP address of the database server.",
          },
          {
            field: {
              databasePort: true,
            },
            title: "Database Port",
            stepId: "connection",
            showIf: (item: FormValues<DataSource>): boolean => {
              return DataSourceTypeUtil.isDatabaseType(
                item.dataSourceType as DataSourceType,
              );
            },
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder:
              "5432 (PostgreSQL), 3306 (MySQL), 1433 (SQL Server), 8123 (ClickHouse)",
            description: "Leave empty to use the engine's default port.",
          },
          {
            field: {
              databaseName: true,
            },
            title: "Database Name",
            stepId: "connection",
            showIf: (item: FormValues<DataSource>): boolean => {
              return DataSourceTypeUtil.isDatabaseType(
                item.dataSourceType as DataSourceType,
              );
            },
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "analytics",
            description: "Database to connect to.",
          },
          {
            field: {
              username: true,
            },
            title: "Username",
            stepId: "auth",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "oneuptime_readonly",
            description: "Use a READ-ONLY account — dashboards only read.",
          },
          /*
           * password / apiToken / customHeaders are write-only (read: [])
           * — including them here would make the edit modal's prefetch
           * select unreadable columns and fail for every user. They are
           * updated through the dedicated "Update Credentials" modal
           * below, which never fetches (MonitorSecrets pattern).
           */
          {
            field: {
              additionalOptions: true,
            },
            title: "Additional Options",
            stepId: "advanced",
            fieldType: FormFieldSchemaType.JSON,
            required: false,
            description:
              "Optional JSON object of per-type options. Recognized keys: sslEnabled (boolean), sslRejectUnauthorized (boolean), elasticsearchIndex (string).",
          },
        ]}
        modelDetailProps={{
          modelType: DataSource,
          id: "model-detail-data-source",
          fields: [
            {
              field: {
                _id: true,
              },
              title: "Data Source ID",
              fieldType: FieldType.ObjectID,
            },
            {
              field: {
                name: true,
              },
              title: "Name",
            },
            {
              field: {
                dataSourceType: true,
              },
              title: "Type",
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              placeholder: "No description provided.",
            },
            {
              field: {
                url: true,
              },
              title: "URL",
              placeholder: "-",
            },
            {
              field: {
                databaseHost: true,
              },
              title: "Database Host",
              placeholder: "-",
            },
            {
              field: {
                databasePort: true,
              },
              title: "Database Port",
              placeholder: "-",
            },
            {
              field: {
                databaseName: true,
              },
              title: "Database Name",
              placeholder: "-",
            },
            {
              field: {
                username: true,
              },
              title: "Username",
              placeholder: "-",
            },
          ],
          modelId: modelId,
        }}
      />

      <ModelDelete
        modelType={DataSource}
        modelId={modelId}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.DASHBOARDS_SETTINGS_DATA_SOURCES] as Route,
              { modelId },
            ),
          );
        }}
      />

      {showCredentialsModal ? (
        <BasicFormModal
          title={"Update Credentials"}
          description={
            "Credentials are write-only: they are encrypted at rest and can never be read back. Fill only the fields you want to replace — empty fields are left unchanged."
          }
          isLoading={isUpdatingCredentials}
          error={credentialsError}
          onClose={() => {
            setIsUpdatingCredentials(false);
            setCredentialsError("");
            setShowCredentialsModal(false);
          }}
          onSubmit={async (data: JSONObject) => {
            const update: JSONObject = {};
            if (data["password"]) {
              update["password"] = data["password"];
            }
            if (data["apiToken"]) {
              update["apiToken"] = data["apiToken"];
            }
            if (data["customHeaders"]) {
              update["customHeaders"] = data["customHeaders"];
            }

            if (Object.keys(update).length === 0) {
              setShowCredentialsModal(false);
              return;
            }

            try {
              setIsUpdatingCredentials(true);
              await ModelAPI.updateById<DataSource>({
                modelType: DataSource,
                id: modelId,
                data: update,
              });
              setCredentialsError("");
              setShowCredentialsModal(false);
            } catch (err) {
              setCredentialsError(API.getFriendlyMessage(err));
            }

            setIsUpdatingCredentials(false);
          }}
          formProps={{
            initialValues: {},
            fields: [
              {
                field: {
                  password: true,
                },
                title: "Password",
                fieldType: FormFieldSchemaType.Password,
                required: false,
                description:
                  "Database password, or HTTP basic-auth password for HTTP sources.",
              },
              {
                field: {
                  apiToken: true,
                },
                title: "API Token",
                fieldType: FormFieldSchemaType.Password,
                required: false,
                description: "Sent as a Bearer token (HTTP sources only).",
              },
              {
                field: {
                  customHeaders: true,
                },
                title: "Custom HTTP Headers",
                fieldType: FormFieldSchemaType.JSON,
                required: false,
                description:
                  'JSON object of header-name: value pairs sent with every request (HTTP sources only) — e.g. { "X-Scope-OrgID": "tenant-1" }.',
              },
            ],
          }}
        />
      ) : null}

      {showTestModal ? (
        <ConfirmModal
          title={"Test Data Source"}
          error={testError}
          description={
            isTesting
              ? "Connecting to your data source…"
              : testMessage ||
                "Testing the connection to your data source using its configured connection details and credentials."
          }
          submitButtonText={"Close"}
          isLoading={isTesting}
          onSubmit={async () => {
            setShowTestModal(false);
            setTestError("");
            setTestMessage("");
          }}
        />
      ) : null}
    </Fragment>
  );
};

export default DataSourceView;
