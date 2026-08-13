import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkArchiveActions from "Common/UI/Components/BulkUpdate/BulkArchiveActions";
import InventoryItemCustomField from "Common/Models/DatabaseModels/InventoryItemCustomField";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import EntitySource from "Common/Types/Telemetry/EntitySource";
import EntityType from "Common/Types/Telemetry/EntityType";
import { MANUAL_ENTITY_TYPES } from "Common/Types/Telemetry/EntityTypeGroups";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Query from "Common/Types/BaseDatabase/Query";
import ProjectUtil from "Common/UI/Utils/Project";
import Navigation from "Common/UI/Utils/Navigation";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import {
  InventoryLivenessBadge,
  InventorySourceBadge,
  InventoryTypeBadge,
} from "./InventoryBadges";
import {
  INVENTORY_TYPE_DESCRIPTORS,
  InventoryTypeDescriptor,
  getInventoryTypeLabel,
} from "./InventoryTypeCatalog";
import {
  getInventoryLiveness,
  formatMinutesAgo,
  InventoryLiveness,
} from "./InventoryLiveness";
import { getInventorySourceLabel } from "./InventorySource";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * The inventory list — the one place the whole estate is listed, whatever
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
 * enforced server-side in InventoryItemService.onBeforeCreate; the dropdown
 * below just avoids offering choices the API would reject.
 *
 * Presentation-wise the rule is that no cell shows a wire value. Types render
 * through the catalog ("Kubernetes Pod", not `k8s.pod`), sources through their
 * descriptor, and `lastSeenAt` through the liveness rule rather than as a bare
 * timestamp — a date on its own does not answer the question the column is
 * being asked, which is "is this thing still there?".
 */

/*
 * Manual types, in catalog order, labelled for humans. Ordering matters here:
 * a dropdown of dotted strings in enum-declaration order is the kind of
 * detail that makes a form feel unfinished.
 */
const manualEntityTypeOptions: Array<DropdownOption> =
  INVENTORY_TYPE_DESCRIPTORS.filter(
    (descriptor: InventoryTypeDescriptor): boolean => {
      return MANUAL_ENTITY_TYPES.has(descriptor.entityType);
    },
  ).map((descriptor: InventoryTypeDescriptor): DropdownOption => {
    return {
      label: descriptor.label,
      value: descriptor.entityType,
    };
  });

/*
 * The filter offers the whole vocabulary, not just the manual subset: you
 * filter by anything that can appear, but you can only create the things
 * OneUptime cannot discover for itself.
 */
const allEntityTypeFilterOptions: Array<DropdownOption> = Object.values(
  EntityType,
).map((entityType: EntityType): DropdownOption => {
  return {
    label: getInventoryTypeLabel(entityType),
    value: entityType,
  };
});

const sourceFilterOptions: Array<DropdownOption> = Object.values(
  EntitySource,
).map((source: EntitySource): DropdownOption => {
  return {
    label: getInventorySourceLabel(source),
    value: source,
  };
});

export interface ComponentProps {
  /**
   * Extra narrowing merged into the base query — how the Overview's
   * drill-downs scope this list. Applied as part of the model query rather
   * than as a filter chip, so it is the page's scope and not something the
   * user removes one chip at a time.
   */
  query?: Query<InventoryItem> | undefined;
  /**
   * Distinguishes two mounts of this table (scoped vs unscoped) in saved
   * column preferences and URL state. Defaults to the plain items table.
   */
  tableKey?: string | undefined;
  cardTitle?: string | undefined;
  cardDescription?: string | undefined;
  /** Only meaningful with `query`: used to remount when the scope changes. */
  refreshToggle?: string | undefined;
  /**
   * Show the archived items instead of the live ones. The two are the same
   * table over disjoint halves of the same column, so they share everything
   * except which half they select and what you can do to a row once you are
   * looking at it.
   */
  archivedOnly?: boolean | undefined;
}

const InventoryTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  const isArchivedView: boolean = Boolean(props.archivedOnly);

  const tableKey: string =
    props.tableKey ||
    (isArchivedView ? "inventory-archived-table" : "inventory-items-table");

  const { archiveBulkActions, unarchiveBulkActions } =
    useBulkArchiveActions<InventoryItem>({
      modelType: InventoryItem,
    });

  /*
   * One clock for the whole render pass. Reading `new Date()` per cell would
   * let two rows in the same table be aged against different instants, which
   * is invisible right up until it puts a row either side of a threshold.
   */
  const now: Date = new Date();

  return (
    <Fragment>
      <ModelTable<InventoryItem>
        modelType={InventoryItem}
        id={tableKey}
        userPreferencesKey={tableKey}
        /*
         * An archived row is read-only until it is restored: editing or
         * deleting something you have already put out of sight is a way to
         * act on the wrong row.
         */
        isDeleteable={!isArchivedView}
        isEditable={!isArchivedView}
        isCreateable={!isArchivedView}
        isViewable={true}
        bulkActions={{
          buttons: isArchivedView
            ? [...unarchiveBulkActions]
            : [...archiveBulkActions],
        }}
        customFieldsModelType={InventoryItemCustomField}
        viewPageRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.INVENTORY_VIEW_ROOT]!,
        )}
        singularName="Item"
        pluralName="Items"
        name="Inventory"
        sortBy="lastSeenAt"
        sortOrder={SortOrder.Descending}
        createVerb="Add"
        refreshToggle={props.refreshToggle}
        searchableFields={["displayName", "description"]}
        searchPlaceholder="Search inventory by name..."
        cardProps={{
          title: props.cardTitle || "Inventory",
          description:
            props.cardDescription ||
            "Everything OneUptime knows about your estate: services, hosts, pods and containers discovered from telemetry, network devices and cloud resources mirrored from elsewhere in OneUptime, plus anything you register by hand.",
        }}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          isArchived: isArchivedView,
          ...(props.query || {}),
        }}
        showRefreshButton={true}
        noItemsMessage={
          <EmptyState
            id="inventory-empty-state"
            icon={IconProp.Cube}
            title="Nothing here yet"
            description={
              translateString(
                "Items appear here on their own as you send OpenTelemetry data and register infrastructure in OneUptime. You can also add something by hand — a vendor API or an appliance that will never report telemetry on its own.",
              ) || ""
            }
            footer={
              <Button
                title="Read the setup guide"
                icon={IconProp.Book}
                buttonStyle={ButtonStyleType.OUTLINE}
                onClick={() => {
                  Navigation.navigate(
                    RouteUtil.populateRouteParams(
                      RouteMap[PageMap.INVENTORY_DOCUMENTATION] as Route,
                    ),
                  );
                }}
              />
            }
          />
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
              "Names the item and, together with its type, forms its identity. Two items of the same type cannot share a name.",
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
            field: { displayName: true },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: { entityType: true },
            title: "Type",
            type: FieldType.MultiSelectDropdown,
            filterDropdownOptions: allEntityTypeFilterOptions,
          },
          {
            field: { source: true },
            title: "Source",
            type: FieldType.MultiSelectDropdown,
            filterDropdownOptions: sourceFilterOptions,
          },
          {
            field: { entityKey: true },
            title: "Identity Key",
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
        /*
         * The Name cell renders the description as a subtitle and the Status
         * cell is derived from source + lastSeenAt, so all three have to be
         * fetched even when their own columns are hidden.
         */
        selectMoreFields={{
          description: true,
          source: true,
          lastSeenAt: true,
        }}
        columns={[
          {
            field: { displayName: true },
            title: "Name",
            type: FieldType.Text,
            isNotCustomizable: true,
            getElement: (item: InventoryItem): ReactElement => {
              return (
                <div className="flex flex-col">
                  <span className="font-medium text-gray-900">
                    {item.displayName || item.entityKey || "Unnamed"}
                  </span>
                  {item.description ? (
                    <span className="text-xs text-gray-500 line-clamp-1">
                      {item.description}
                    </span>
                  ) : null}
                </div>
              );
            },
            getExportValue: (item: InventoryItem): string => {
              return item.displayName || item.entityKey || "";
            },
          },
          {
            field: { entityType: true },
            title: "Type",
            type: FieldType.Text,
            getElement: (item: InventoryItem): ReactElement => {
              return <InventoryTypeBadge entityType={item.entityType} />;
            },
            getExportValue: (item: InventoryItem): string => {
              return getInventoryTypeLabel(item.entityType || "");
            },
          },
          {
            field: { source: true },
            title: "Source",
            type: FieldType.Text,
            getElement: (item: InventoryItem): ReactElement => {
              return <InventorySourceBadge source={item.source} />;
            },
            getExportValue: (item: InventoryItem): string => {
              return getInventorySourceLabel(item.source);
            },
          },
          {
            /*
             * Status is derived from `source` + `lastSeenAt` rather than
             * being a column of its own, so it declares a placeholder field
             * and an explicit id — see Column.id.
             */
            field: { _id: true },
            id: "inventory-status",
            title: "Status",
            type: FieldType.Element,
            disableSort: true,
            getElement: (item: InventoryItem): ReactElement => {
              return (
                <InventoryLivenessBadge
                  source={item.source}
                  lastSeenAt={item.lastSeenAt}
                  now={now}
                  showAge={true}
                />
              );
            },
            getExportValue: (item: InventoryItem): string => {
              const liveness: InventoryLiveness = getInventoryLiveness({
                source: item.source,
                lastSeenAt: item.lastSeenAt,
                now,
              }).liveness;

              return liveness === InventoryLiveness.NotTracked ? "" : liveness;
            },
          },
          {
            field: { lastSeenAt: true },
            title: "Last Seen",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: InventoryItem): ReactElement => {
              if (!item.lastSeenAt) {
                return <span className="text-sm text-gray-400">-</span>;
              }

              const minutes: number = Math.max(
                0,
                Math.floor(
                  (now.getTime() - new Date(item.lastSeenAt).getTime()) /
                    (60 * 1000),
                ),
              );

              return (
                <span
                  className="text-sm text-gray-500"
                  title={OneUptimeDate.getDateAsLocalFormattedString(
                    item.lastSeenAt,
                  )}
                >
                  {formatMinutesAgo(minutes)}
                </span>
              );
            },
            getExportValue: (item: InventoryItem): string => {
              return item.lastSeenAt
                ? OneUptimeDate.getDateAsLocalFormattedString(item.lastSeenAt)
                : "";
            },
          },
          {
            field: { entityKey: true },
            title: "Identity Key",
            type: FieldType.Text,
            isHiddenByDefault: true,
            description:
              "The stable hash OneUptime identifies this item by across every signal it appears in.",
          },
          {
            field: { firstSeenAt: true },
            title: "First Seen",
            type: FieldType.DateTime,
            isHiddenByDefault: true,
          },
        ]}
      />
    </Fragment>
  );
};

export default InventoryTable;
