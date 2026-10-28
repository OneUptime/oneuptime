import { SensitivityPill } from "./DataSecurityPills";
import StoreDataTypeList from "./StoreDataTypeList";
import AppLink from "../AppLink/AppLink";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import DataSecurityFlow from "Common/Models/DatabaseModels/DataSecurityFlow";
import DataStore from "Common/Models/DatabaseModels/DataStore";
import Route from "Common/Types/API/Route";
import { Gray500, Green500 } from "Common/Types/BrandColors";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import FieldType from "Common/UI/Components/Types/FieldType";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Where one store's data goes, or where it comes from. OneUptime draws a
 * flow from the services seen reading and writing the store in traces, from
 * calls to outside hosts and AI providers, and from copies of the store's
 * values found in other stores; a flow is Confirmed once a scan found the
 * data at the other end, not only the path to it.
 */

export type StoreFlowDirection = "outgoing" | "incoming";

function getStoreRoute(storeId: ObjectID | string): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.DATA_SECURITY_STORE_VIEW] as Route,
    { modelId: new ObjectID(storeId.toString()) },
  );
}

// The other store of a flow, as a link to its page.
const OtherStore: FunctionComponent<{
  store: DataStore | undefined;
  fallback: string | undefined;
}> = (props: {
  store: DataStore | undefined;
  fallback: string | undefined;
}): ReactElement => {
  if (props.store?._id) {
    return (
      <AppLink
        to={getStoreRoute(props.store._id)}
        className="text-sm font-medium text-gray-900 hover:underline"
      >
        {props.store.name || "—"}
      </AppLink>
    );
  }

  if (props.fallback) {
    return (
      <span className="text-sm font-medium text-gray-900">
        {props.fallback}
      </span>
    );
  }

  return <TableEmptyValue />;
};

export interface ComponentProps {
  dataStoreId: ObjectID;
  direction: StoreFlowDirection;
}

const StoreFlowsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isOutgoing: boolean = props.direction === "outgoing";
  const id: string = isOutgoing
    ? "data-store-flows-outgoing-table"
    : "data-store-flows-incoming-table";

  return (
    <ModelTable<DataSecurityFlow>
      modelType={DataSecurityFlow}
      id={id}
      userPreferencesKey={id}
      name={isOutgoing ? "Where Its Data Goes" : "Where Its Data Comes From"}
      query={
        isOutgoing
          ? { sourceDataStoreId: props.dataStoreId }
          : { destinationDataStoreId: props.dataStoreId }
      }
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      isViewable={false}
      showRefreshButton={true}
      sortBy="lastSeenAt"
      sortOrder={SortOrder.Descending}
      cardProps={
        isOutgoing
          ? {
              title: "Where Its Data Goes",
              description:
                "The services that read this store, where they send its data - other stores, outside hosts and AI providers - and the stores that hold copies of it.",
            }
          : {
              title: "Where Its Data Comes From",
              description:
                "The services that write to this store, and the stores whose data was copied into it.",
            }
      }
      noItemsMessage={
        isOutgoing
          ? "No data is seen leaving this store yet. Flows appear once its services send traces to OneUptime."
          : "No data is seen arriving in this store yet. Flows appear once its services send traces to OneUptime."
      }
      selectMoreFields={{
        destination: true,
        sourceDataStore: { _id: true, name: true },
        destinationDataStore: { _id: true, name: true },
      }}
      filters={[]}
      columns={[
        {
          field: { kind: true },
          title: "Kind",
          type: FieldType.Element,
          getElement: (item: DataSecurityFlow): ReactElement => {
            return (
              <span className="text-sm text-gray-700">
                {translator.translateText(item.kind) || "—"}
              </span>
            );
          },
        },
        isOutgoing
          ? {
              field: { destinationDataStoreId: true },
              title: "Goes To",
              type: FieldType.Element,
              getElement: (item: DataSecurityFlow): ReactElement => {
                return (
                  <OtherStore
                    store={item.destinationDataStore}
                    fallback={item.destination}
                  />
                );
              },
            }
          : {
              field: { sourceDataStoreId: true },
              title: "Comes From",
              type: FieldType.Element,
              getElement: (item: DataSecurityFlow): ReactElement => {
                return (
                  <OtherStore
                    store={item.sourceDataStore}
                    fallback={undefined}
                  />
                );
              },
            },
        {
          field: { service: { name: true } },
          title: "Through Service",
          type: FieldType.Element,
          hideOnMobile: true,
          getElement: (item: DataSecurityFlow): ReactElement => {
            return item.service?.name ? (
              <span className="text-sm text-gray-700">{item.service.name}</span>
            ) : (
              <TableEmptyValue />
            );
          },
        },
        {
          field: { dataTypeIds: true },
          title: "Data Types",
          type: FieldType.Element,
          hideOnMobile: true,
          getElement: (item: DataSecurityFlow): ReactElement => {
            return <StoreDataTypeList dataTypeIds={item.dataTypeIds} />;
          },
        },
        {
          field: { sensitivity: true },
          title: "Sensitivity",
          type: FieldType.Element,
          getElement: (item: DataSecurityFlow): ReactElement => {
            return item.sensitivity ? (
              <SensitivityPill sensitivity={item.sensitivity} />
            ) : (
              <TableEmptyValue />
            );
          },
        },
        {
          field: { isConfirmed: true },
          title: "Confirmed",
          type: FieldType.Element,
          hideOnMobile: true,
          getElement: (item: DataSecurityFlow): ReactElement => {
            return item.isConfirmed ? (
              <Pill
                text="Confirmed"
                color={Green500}
                tooltip="A scan found the data at the other end."
              />
            ) : (
              <Pill
                text="Path only"
                color={Gray500}
                tooltip="The path exists; no scan has found the data at the other end yet."
              />
            );
          },
        },
        {
          field: { lastSeenAt: true },
          title: "Last Seen",
          type: FieldType.DateTime,
          hideOnMobile: true,
        },
      ]}
    />
  );
};

export default StoreFlowsTable;
