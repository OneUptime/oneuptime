import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import Card from "Common/UI/Components/Card/Card";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import TestDataSource, {
  DataSourceTestResult,
} from "Common/UI/Utils/TestDataSource";
import Navigation from "Common/UI/Utils/Navigation";
import DataSource from "Common/Models/DatabaseModels/DataSource";
import DataSourceType, {
  DataSourceTypeUtil,
} from "Common/Types/DataSource/DataSourceType";
import DataSourceTypeUIUtil from "../../Utils/DataSourceType";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";

const DataSourcesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [showTestModal, setShowTestModal] = useState<boolean>(false);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testError, setTestError] = useState<string>("");
  const [testMessage, setTestMessage] = useState<string>("");

  const runTest: (item: DataSource) => Promise<void> = async (
    item: DataSource,
  ): Promise<void> => {
    setIsTesting(true);
    setTestError("");
    setTestMessage("");

    const result: DataSourceTestResult = await TestDataSource.test({
      dataSourceId: item["_id"]?.toString() || "",
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
      <>
        <Card
          title="What are Data Sources?"
          description="Data Sources connect external systems to OneUptime so your dashboards can chart their data."
        >
          <div className="mt-4 space-y-3">
            <div className="flex items-start">
              <Icon
                icon={IconProp.CheckCircle}
                className="h-5 w-5 text-green-500 mr-3 mt-0.5 flex-shrink-0"
              />
              <div>
                <span className="font-medium">
                  Build dashboards on external data
                </span>
                <span className="text-gray-500">
                  {" "}
                  - Chart Prometheus, PostgreSQL, MySQL, SQL Server, ClickHouse,
                  Loki, Elasticsearch, or REST API data right next to your
                  OneUptime data
                </span>
              </div>
            </div>
            <div className="flex items-start">
              <Icon
                icon={IconProp.CheckCircle}
                className="h-5 w-5 text-green-500 mr-3 mt-0.5 flex-shrink-0"
              />
              <div>
                <span className="font-medium">Credentials stay secret</span>
                <span className="text-gray-500">
                  {" "}
                  - Passwords, API tokens, and custom headers are encrypted at
                  rest and never returned by the API
                </span>
              </div>
            </div>
            <div className="flex items-start">
              <Icon
                icon={IconProp.CheckCircle}
                className="h-5 w-5 text-green-500 mr-3 mt-0.5 flex-shrink-0"
              />
              <div>
                <span className="font-medium">Use read-only accounts</span>
                <span className="text-gray-500">
                  {" "}
                  - We strongly recommend connecting databases with a read-only
                  account. Dashboards only ever read data
                </span>
              </div>
            </div>
          </div>
        </Card>

        <ModelTable<DataSource>
          modelType={DataSource}
          query={{
            projectId: ProjectUtil.getCurrentProjectId()!,
          }}
          id="data-sources-table"
          userPreferencesKey={"settings-data-sources-table"}
          name="Settings > Data Sources"
          saveFilterProps={{
            tableId: "settings-data-sources-table",
          }}
          isDeleteable={true}
          isEditable={false}
          isViewable={true}
          isCreateable={true}
          actionButtons={[
            {
              title: "Test",
              buttonStyleType: ButtonStyleType.NORMAL,
              icon: IconProp.Play,
              onClick: async (
                item: DataSource,
                onCompleteAction: VoidFunction,
                onError: ErrorFunction,
              ) => {
                try {
                  setShowTestModal(true);
                  await runTest(item);
                  onCompleteAction();
                } catch (err) {
                  onCompleteAction();
                  onError(err as Error);
                }
              },
            },
          ]}
          cardProps={{
            title: "Data Sources",
            description:
              "Connections to external systems that dashboards can query and chart alongside OneUptime data.",
          }}
          noItemsMessage={
            "No data sources yet. Connect one to chart its data on your dashboards."
          }
          viewPageRoute={Navigation.getCurrentRoute()}
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
              description:
                "The kind of external system to connect. The type is a create-time choice — create a new data source to use a different type.",
              fieldType: FormFieldSchemaType.CardSelect,
              required: true,
              showEvenIfPermissionDoesNotExist: true,
              doNotShowWhenEditing: true,
              cardSelectOptions:
                DataSourceTypeUIUtil.dataSourceTypesAsCardSelectOptions(),
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
            {
              field: {
                password: true,
              },
              title: "Password",
              stepId: "auth",
              fieldType: FormFieldSchemaType.Password,
              required: false,
              description: "Encrypted at rest and never shown again.",
            },
            {
              field: {
                apiToken: true,
              },
              title: "API Token",
              stepId: "auth",
              showIf: (item: FormValues<DataSource>): boolean => {
                return DataSourceTypeUtil.isHttpBasedType(
                  item.dataSourceType as DataSourceType,
                );
              },
              fieldType: FormFieldSchemaType.Password,
              required: false,
              description:
                "Sent as a Bearer token. Encrypted at rest and never shown again.",
            },
            {
              field: {
                customHeaders: true,
              },
              title: "Custom HTTP Headers",
              stepId: "advanced",
              showIf: (item: FormValues<DataSource>): boolean => {
                return DataSourceTypeUtil.isHttpBasedType(
                  item.dataSourceType as DataSourceType,
                );
              },
              fieldType: FormFieldSchemaType.JSON,
              required: false,
              description:
                'JSON object of header-name: value pairs sent with every request — e.g. { "X-Scope-OrgID": "tenant-1" }. Values are encrypted at rest.',
            },
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
          showRefreshButton={true}
          searchableFields={["name", "description"]}
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
              type: FieldType.Text,
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
                dataSourceType: true,
              },
              title: "Type",
              type: FieldType.Text,
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              type: FieldType.Text,
              noValueMessage: "-",
            },
          ]}
        />

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
      </>
    </Fragment>
  );
};

export default DataSourcesPage;
