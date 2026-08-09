import MonitorElement from "../Monitor/Monitor";
import MonitorGroupElement from "../MonitorGroup/MonitorGroupElement";
import BulkAddStatusPageMonitorsModal from "./BulkAddStatusPageMonitorsModal";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import Filter from "Common/UI/Components/ModelFilter/Filter";
import Columns from "Common/UI/Components/ModelTable/Column";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  statusPageId: ObjectID;
  projectId: ObjectID;
  /* Undefined for the bucket of resources that belong to no group at all. */
  statusPageGroupId?: ObjectID | undefined;
  /*
   * Distinguishes this panel's table from every other one on the page - table
   * DOM ids, drag and drop scopes and saved filter namespaces all key off it,
   * and more than one group can be open at a time.
   */
  panelKey: string;
  title: string;
  /* The group's ancestors, shown under the title when it is nested. */
  description?: string | undefined;
  canCreateStatusPageResource: boolean;
  isMonitorGroupsFeatureEnabled: boolean;
  formFields: Array<ModelField<StatusPageResource>>;
  formSteps: Array<FormStep<StatusPageResource>>;
  /*
   * How many resources this group turned out to hold, reported on every fetch
   * the table makes - which covers creating, editing, deleting, bulk deleting
   * and bulk adding, because every one of those ends in a refetch.
   *
   * This is why the page does not re-read every resource on the status page
   * after each change: the group that changed tells it its own new number, and
   * that is the only number that changed.
   */
  onResourceCountLoaded?: ((count: number) => void) | undefined;
  testId?: string | undefined;
}

/*
 * The resources of one status page group (or of no group at all), drawn inside
 * an open row of the Resources tree.
 *
 * This is mounted only while its row is open. That is the fix for issue #3042:
 * a ModelTable fetches the moment it mounts and there is no way to ask it not
 * to, so "collapsed" has to mean "not in the React tree" rather than
 * "hidden" - otherwise fifteen hundred groups is still fifteen hundred
 * requests.
 *
 * The table keeps its Card. Create, refresh, filter, column customisation and
 * saved views all live in that Card's header and are unreachable without it,
 * and none of them is what made the old page fall over - rendering fifteen
 * hundred of these at once was.
 */
const StatusPageResourceListPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isBulkAddModalOpen, setIsBulkAddModalOpen] = useState<boolean>(false);

  /*
   * The count the table reports is the count of what it fetched, and a filtered
   * table fetches a subset. Narrowing a group's table to one monitor must not
   * make the tree above it say the group holds one resource, so while a filter
   * is on, the count the row already had is left alone - clearing the filter
   * refetches and reports the real number again.
   */
  const [isTableFilterApplied, setIsTableFilterApplied] =
    useState<boolean>(false);

  /*
   * Bumped after a bulk add, which writes its resources through its own API
   * calls rather than through the table.
   */
  const [bulkAddCounter, setBulkAddCounter] = useState<number>(0);

  const tableColumns: Array<Columns<StatusPageResource>> = [
    {
      field: {
        monitor: {
          name: true,
          _id: true,
          projectId: true,
        },
      },
      title: props.isMonitorGroupsFeatureEnabled ? "Resource" : "Monitor",
      type: FieldType.Entity,
      getElement: (item: StatusPageResource): ReactElement => {
        if (item["monitor"]) {
          return (
            <MonitorElement
              monitor={item["monitor"]}
              showIcon={props.isMonitorGroupsFeatureEnabled}
            />
          );
        }

        if (item["monitorGroup"]) {
          return (
            <MonitorGroupElement
              monitorGroup={item["monitorGroup"]}
              showIcon={props.isMonitorGroupsFeatureEnabled}
            />
          );
        }

        return <></>;
      },
    },
    {
      field: {
        displayName: true,
      },
      title: "Display Name",
      type: FieldType.Text,
    },
  ];

  const tableFilters: Array<Filter<StatusPageResource>> = [
    {
      field: {
        monitor: {
          name: true,
        },
      },
      title: "Monitor",
      type: FieldType.Entity,
      filterEntityType: Monitor,
      filterQuery: {
        projectId: props.projectId,
      },
      filterDropdownField: {
        label: "name",
        value: "_id",
      },
    },
    {
      field: {
        displayName: true,
      },
      title: "Display Name",
      type: FieldType.Text,
    },
  ];

  type OnBeforeCreateFunction = (
    item: StatusPageResource,
  ) => Promise<StatusPageResource>;

  const onBeforeCreate: OnBeforeCreateFunction = (
    item: StatusPageResource,
  ): Promise<StatusPageResource> => {
    if (!props.projectId) {
      throw new BadDataException("Project ID cannot be null");
    }

    item.statusPageId = props.statusPageId;
    item.projectId = props.projectId;

    if (props.statusPageGroupId) {
      item.statusPageGroupId = props.statusPageGroupId;
    }

    return Promise.resolve(item);
  };

  /*
   * `null` is a legal value here - it is what selects the resources that
   * belong to no group at all, and the server turns it into `IS NULL`. The
   * query type only admits the column's own type, so the null has to be
   * asserted through it.
   */
  const statusPageGroupIdForQuery: ObjectID = (props.statusPageGroupId ||
    null)!;

  const cardButtons: Array<CardButtonSchema> = props.canCreateStatusPageResource
    ? [
        {
          title: "Add Multiple Monitors",
          buttonStyle: ButtonStyleType.OUTLINE,
          icon: IconProp.Add,
          onClick: () => {
            setIsBulkAddModalOpen(true);
          },
        },
      ]
    : [];

  return (
    <div data-testid={props.testId || "status-page-resource-list-panel"}>
      <ModelTable<StatusPageResource>
        modelType={StatusPageResource}
        id={`status-page-resources-${props.panelKey}`}
        userPreferencesKey="status-page-resource-table"
        urlStateKey={`status-page-resources-${props.panelKey}`}
        saveFilterProps={{
          tableId: `status-page-resources-table-${props.panelKey}`,
        }}
        name="Status Page > Resources"
        singularName="Resource"
        pluralName="Resources"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        isViewable={false}
        showViewIdButton={true}
        showRefreshButton={true}
        sortBy="order"
        sortOrder={SortOrder.Ascending}
        enableDragAndDrop={true}
        dragDropIndexField="order"
        cardProps={{
          title: props.title,
          description: props.description || "",
          buttons: cardButtons,
        }}
        query={{
          statusPageId: props.statusPageId,
          projectId: props.projectId,
          statusPageGroupId: statusPageGroupIdForQuery,
        }}
        refreshToggle={`resources-${props.panelKey}-${bulkAddCounter}`}
        onBeforeCreate={onBeforeCreate}
        /*
         * Every write path through this table ends in a refetch, so this one
         * hook keeps the tree's counts honest for creates, edits, deletes and
         * bulk deletes alike - without the page re-reading every resource on
         * the status page after each of them.
         */
        onFilterApplied={(isFilterApplied: boolean) => {
          setIsTableFilterApplied(isFilterApplied);
        }}
        onFetchSuccess={(
          _data: Array<StatusPageResource>,
          totalCount: number,
        ) => {
          if (props.onResourceCountLoaded && !isTableFilterApplied) {
            props.onResourceCountLoaded(totalCount);
          }
        }}
        noItemsMessage="No monitors here yet. Use Create Resource to put one on the status page."
        formFields={props.formFields}
        formSteps={props.formSteps}
        selectMoreFields={{
          monitorGroup: {
            name: true,
            _id: true,
            projectId: true,
          },
        }}
        filters={tableFilters}
        columns={tableColumns}
      />

      {isBulkAddModalOpen ? (
        <BulkAddStatusPageMonitorsModal
          projectId={props.projectId}
          statusPageId={props.statusPageId}
          statusPageGroupId={props.statusPageGroupId}
          onClose={() => {
            setIsBulkAddModalOpen(false);
          }}
          onComplete={() => {
            setBulkAddCounter((counter: number) => {
              return counter + 1;
            });
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default StatusPageResourceListPanel;
