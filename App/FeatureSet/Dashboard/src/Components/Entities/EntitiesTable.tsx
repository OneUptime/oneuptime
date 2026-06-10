import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import TelemetryEntity from "Common/Models/DatabaseModels/TelemetryEntity";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/**
 * Entity explorer — lists the TelemetryEntity registry (the catalog of
 * OpenTelemetry entities discovered from telemetry resource attributes).
 * Read-only: the registry is machine-populated forward-only at ingest.
 */
const EntitiesTable: FunctionComponent = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<TelemetryEntity>
        modelType={TelemetryEntity}
        id="telemetry-entity-table"
        userPreferencesKey="telemetry-entity-table"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        singularName="Entity"
        pluralName="Entities"
        name="Telemetry Entities"
        sortBy="lastSeenAt"
        sortOrder={SortOrder.Descending}
        cardProps={{
          title: "Telemetry Entities",
          description:
            "Services, hosts, k8s pods, containers and other entities discovered from your telemetry resource attributes.",
        }}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        showRefreshButton={true}
        noItemsMessage={
          "No telemetry entities discovered yet. Entities are cataloged here as telemetry carrying resource attributes (service.name, host.name, k8s.*, container.id, ...) is ingested."
        }
        filters={[
          {
            field: { entityType: true },
            title: "Entity Type",
            type: FieldType.Text,
          },
          {
            field: { displayName: true },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: { entityKey: true },
            title: "Entity Key",
            type: FieldType.Text,
          },
        ]}
        columns={[
          {
            field: { entityType: true },
            title: "Entity Type",
            type: FieldType.Text,
          },
          {
            field: { displayName: true },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: { entityKey: true },
            title: "Entity Key",
            type: FieldType.Text,
          },
          {
            field: { firstSeenAt: true },
            title: "First Seen",
            type: FieldType.DateTime,
          },
          {
            field: { lastSeenAt: true },
            title: "Last Seen",
            type: FieldType.DateTime,
          },
        ]}
      />
    </Fragment>
  );
};

export default EntitiesTable;
