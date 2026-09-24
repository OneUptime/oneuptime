import PageComponentProps from "../../PageComponentProps";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import TelemetryResourceRetentionSettings from "../../../Components/TelemetryResource/TelemetryResourceRetentionSettings";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import Label from "Common/Models/DatabaseModels/Label";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import LabelsElement from "Common/UI/Components/Label/Labels";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import { useParams } from "react-router-dom";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * A database's retention governs only what is stored AS this database: the
 * engine metrics and logs its collector / Database Agent sends (ingest makes
 * the database their primary entity). The query spans applications send it
 * belong to the calling service and keep that service's retention, so the
 * page says which telemetry the setting covers before offering it.
 */
export const DATABASE_RETENTION_SCOPE_NOTE: string =
  "These settings apply to the engine metrics and logs collected from this database by the Database Agent or your OpenTelemetry Collector. The traces of the queries your applications send it belong to the calling services and follow their retention.";

/*
 * The name is not the identity: discovery keys a database by its endpoints
 * and workload, sets `name` only when it creates the row, and never writes
 * it again. So a discovered "PostgreSQL 10.0.3.17:5432" can be renamed
 * "Checkout primary" for good — and label and owner rules, which match on
 * name and description, then see the new one.
 */
export const DATABASE_NAME_HELP: string =
  "Shown everywhere this database appears. Renaming is safe: databases are matched by their endpoints, never by name, and label and owner rules match the new name.";

const DatabaseServerSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");

  return (
    <Fragment>
      <CardModelDetail<DatabaseServer>
        name="Database Settings"
        cardProps={{
          title: "Database Settings",
          description:
            "Manage the name, description and labels of this database.",
        }}
        isEditable={true}
        editButtonText="Edit Database"
        formSteps={[
          {
            title: "Database Info",
            id: "database-info",
          },
          {
            title: "Labels",
            id: "labels",
          },
        ]}
        formFields={[
          {
            field: {
              name: true,
            },
            stepId: "database-info",
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Checkout primary",
            description: DATABASE_NAME_HELP,
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            stepId: "database-info",
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Primary PostgreSQL cluster for the checkout stack",
          },
          {
            field: {
              labels: true,
            },
            stepId: "labels",
            title: "Labels",
            description:
              "Team members with access to these labels will only be able to access this resource. This is optional and an advanced feature.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Labels",
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: DatabaseServer,
          id: "model-detail-database-server",
          modelId: modelId,
          fields: [
            {
              field: {
                name: true,
              },
              title: "Name",
              fieldType: FieldType.Text,
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              fieldType: FieldType.Text,
              placeholder: "No description",
            },
            {
              field: {
                labels: {
                  name: true,
                  color: true,
                },
              },
              title: "Labels",
              fieldType: FieldType.Element,
              getElement: (item: DatabaseServer): ReactElement => {
                return <LabelsElement labels={item["labels"] || []} />;
              },
            },
          ],
        }}
      />
      <Alert
        type={AlertType.INFO}
        strongTitle="Which telemetry this covers."
        title={DATABASE_RETENTION_SCOPE_NOTE}
        className="mb-5"
        dataTestId="database-retention-scope-note"
      />
      <TelemetryResourceRetentionSettings<DatabaseServer>
        modelType={DatabaseServer}
        modelId={modelId}
        resourceName="database"
        modelDetailIdPrefix="database-server"
      />
      <ArchiveResourceCard<DatabaseServer>
        modelType={DatabaseServer}
        modelId={modelId}
        singularName="database"
        listRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.DATABASE_SERVERS] as Route,
        )}
      />
    </Fragment>
  );
};

export default DatabaseServerSettings;
