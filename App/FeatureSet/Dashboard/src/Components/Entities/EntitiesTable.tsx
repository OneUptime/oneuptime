import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import TelemetryEntity from "Common/Models/DatabaseModels/TelemetryEntity";
import EntitySource from "Common/Types/Telemetry/EntitySource";
import EntityType from "Common/Types/Telemetry/EntityType";
import { MANUAL_ENTITY_TYPES } from "Common/Types/Telemetry/EntityTypeGroups";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ProjectUtil from "Common/UI/Utils/Project";
import Route from "Common/Types/API/Route";
import Link from "Common/UI/Components/Link/Link";
import useTranslateValue from "Common/UI/Utils/Translation";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/**
 * Entity explorer — the one place the whole estate is listed, whatever
 * discovered it.
 *
 * Rows arrive from three directions and the Source column is what tells them
 * apart: `discovered` from OpenTelemetry resource attributes at ingest,
 * `inventory` mirrored from OneUptime's poller-collected tables (network
 * devices, cloud resources, IoT devices, ...), and `manual` for things that
 * emit no telemetry and appear in no inventory — a vendor API, an appliance —
 * which a user registers here so a dependency can terminate somewhere real.
 *
 * Create is restricted to the manual entity types. That restriction is
 * enforced server-side in TelemetryEntityService.onBeforeCreate; the dropdown
 * below just avoids offering choices the API would reject.
 */

const manualEntityTypeOptions: Array<DropdownOption> = Array.from(
  MANUAL_ENTITY_TYPES,
).map((entityType: EntityType): DropdownOption => {
  return {
    label: entityType,
    value: entityType,
  };
});

const EntitiesTable: FunctionComponent = (): ReactElement => {
  const { translateString } = useTranslateValue();

  return (
    <Fragment>
      <ModelTable<TelemetryEntity>
        modelType={TelemetryEntity}
        id="telemetry-entity-table"
        userPreferencesKey="telemetry-entity-table"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        isViewable={true}
        viewPageRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.ENTITIES_VIEW_ROOT]!,
        )}
        singularName="Entity"
        pluralName="Entities"
        name="Telemetry Entities"
        sortBy="lastSeenAt"
        sortOrder={SortOrder.Descending}
        createVerb="Add"
        cardProps={{
          title: "Entities",
          description:
            "Everything OneUptime knows about your estate: services, hosts, k8s pods and containers discovered from telemetry, network devices and cloud resources mirrored from inventory, plus anything you register by hand. Discovered and mirrored entities re-appear automatically after deletion — their source is the authority, not this table.",
        }}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        showRefreshButton={true}
        noItemsMessage={
          <div>
            <p>
              {translateString(
                "No entities yet. They are cataloged here as telemetry carrying resource attributes (service.name, host.name, k8s.*, container.id, ...) is ingested, and as inventory is registered. You can also add an entity manually for something that emits no telemetry, such as a third-party API.",
              ) || ""}
            </p>
            <Link
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.TRACES_DOCUMENTATION] as Route,
              )}
              className="mt-2 inline-block text-sm font-medium text-indigo-600 hover:text-indigo-800"
            >
              {translateString(
                "View telemetry setup documentation to send OpenTelemetry data",
              ) || ""}
            </Link>
          </div>
        }
        /*
         * Only the fields a human owns. Type and key are absent on purpose:
         * the key is derived from (project, type, name) server-side, and
         * letting either change after create would re-identify the row and
         * strand every edge pointing at the old key.
         */
        formFields={[
          {
            field: { entityType: true },
            title: "Type",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: manualEntityTypeOptions,
            required: true,
            description:
              "What kind of thing this is. Only types OneUptime cannot discover on its own can be added by hand — everything else appears here automatically.",
          },
          {
            field: { displayName: true },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Stripe Payments API",
            description:
              "Names the entity and, together with its type, forms its identity. Two entities of the same type cannot share a name.",
            validation: {
              minLength: 2,
            },
          },
          {
            field: { description: true },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Vendor-managed. No telemetry. Owned by Payments.",
          },
        ]}
        filters={[
          {
            field: { entityType: true },
            title: "Entity Type",
            type: FieldType.MultiSelectDropdown,
            filterDropdownOptions: Object.values(EntityType).map(
              (entityType: EntityType) => {
                return {
                  label: entityType,
                  value: entityType,
                };
              },
            ),
          },
          {
            field: { source: true },
            title: "Source",
            type: FieldType.MultiSelectDropdown,
            filterDropdownOptions: Object.values(EntitySource).map(
              (source: EntitySource) => {
                return {
                  label: source,
                  value: source,
                };
              },
            ),
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
            field: { lastSeenAt: true },
            title: "Last Seen",
            type: FieldType.DateTime,
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
            field: { source: true },
            title: "Source",
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
