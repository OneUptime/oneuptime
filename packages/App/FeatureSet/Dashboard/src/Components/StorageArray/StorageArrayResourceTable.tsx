import React, { FunctionComponent, ReactElement } from "react";
import StorageArrayResource from "Common/Models/DatabaseModels/StorageArrayResource";
import StorageArrayResourceKind from "Common/Types/StorageArray/StorageArrayResourceKind";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Columns from "Common/UI/Components/ModelTable/Columns";
import FieldType from "Common/UI/Components/Types/FieldType";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import Link from "Common/UI/Components/Link/Link";
import StorageArrayResourceUtils from "../../Pages/StorageArray/Utils/StorageArrayResourceUtils";

export interface ComponentProps {
  storageArrayId: ObjectID;
  kind: StorageArrayResourceKind;
  // DOM id and the key the viewer's column choices are saved under.
  tableId: string;
  // The table's name in saved views and exports.
  name: string;
  singularName: string;
  pluralName: string;
  title: string;
  description: string;
  noItemsMessage: string;
  // The columns after the name, which every table starts with.
  columns: Columns<StorageArrayResource>;
  // The object's own page, when it has one; the name links to it.
  getDetailRoute?: ((item: StorageArrayResource) => Route) | undefined;
}

/*
 * One kind of a storage array's inventory (StorageArrayResource rows of
 * one kind), read straight from the Postgres table the ingest path keeps
 * current — the same rows the side menu badges count. Server-side paging
 * and sorting, because a FlashArray can hold thousands of volumes and the
 * question is usually "which one is slow".
 */
const StorageArrayResourceTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ModelTable<StorageArrayResource>
      modelType={StorageArrayResource}
      id={props.tableId}
      userPreferencesKey={props.tableId}
      name={props.name}
      singularName={props.singularName}
      pluralName={props.pluralName}
      query={{
        storageArrayId: props.storageArrayId,
        kind: props.kind,
      }}
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      isViewable={Boolean(props.getDetailRoute)}
      showRefreshButton={true}
      sortBy="name"
      sortOrder={SortOrder.Ascending}
      selectMoreFields={{
        kind: true,
        externalId: true,
        metricsUpdatedAt: true,
        details: true,
      }}
      cardProps={{
        title: props.title,
        description: props.description,
      }}
      noItemsMessage={props.noItemsMessage}
      searchableFields={["name"]}
      filters={[
        {
          field: {
            name: true,
          },
          title: "Name",
          type: FieldType.Text,
        },
      ]}
      {...(props.getDetailRoute
        ? {
            onViewPage: (item: StorageArrayResource): Promise<Route> => {
              return Promise.resolve(props.getDetailRoute!(item));
            },
          }
        : {})}
      columns={[
        {
          field: {
            name: true,
          },
          title: "Name",
          type: FieldType.Element,
          isNotCustomizable: true,
          getElement: (item: StorageArrayResource): ReactElement => {
            const name: string =
              StorageArrayResourceUtils.displayNameForResource(item);
            if (props.getDetailRoute) {
              return (
                <Link
                  to={props.getDetailRoute(item)}
                  className="font-medium text-gray-900 hover:text-indigo-600 hover:underline"
                >
                  {name}
                </Link>
              );
            }
            return <span className="font-medium text-gray-900">{name}</span>;
          },
        },
        ...props.columns,
      ]}
    />
  );
};

export default StorageArrayResourceTable;
