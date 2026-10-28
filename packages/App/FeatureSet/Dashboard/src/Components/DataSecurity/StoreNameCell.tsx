import AppLink from "../AppLink/AppLink";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import DataStore from "Common/Models/DatabaseModels/DataStore";
import Route from "Common/Types/API/Route";
import {
  DataStoreKindInfo,
  getDataStoreKindInfo,
} from "Common/Types/DataSecurity/DataStoreKind";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import OneUptimeDate from "Common/Types/Date";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A data store as a row of a list names it: its name, which opens its page,
 * with its kind and region under it, and the kind's icon beside it - a
 * bucket's folder, a database's cylinder, a service's logs.
 */

export function getDataStoreRoute(dataStoreId: ObjectID | string): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.DATA_SECURITY_STORE_VIEW] as Route,
    { modelId: new ObjectID(dataStoreId.toString()) },
  );
}

/*
 * When OneUptime last looked at a store: the later of its configuration
 * read and its content scan, or undefined when it has done neither.
 */
export function getStoreLastCheckedAt(store: DataStore): Date | undefined {
  const dates: Array<Date> = [store.configurationReadAt, store.contentScannedAt]
    .filter((value: Date | undefined): value is Date => {
      return Boolean(value);
    })
    .map((value: Date): Date => {
      return new Date(value);
    })
    .filter((value: Date): boolean => {
      return !Number.isNaN(value.getTime());
    });

  if (dates.length === 0) {
    return undefined;
  }

  return dates.reduce((latest: Date, value: Date): Date => {
    return value.getTime() > latest.getTime() ? value : latest;
  });
}

// The later of a store's checks, as a table's date cells write dates.
export const StoreLastCheckedCell: FunctionComponent<{
  store: DataStore;
}> = (props: { store: DataStore }): ReactElement => {
  const lastCheckedAt: Date | undefined = getStoreLastCheckedAt(props.store);

  if (!lastCheckedAt) {
    return (
      <TableEmptyValue screenReaderText={translationKey("Not checked yet")} />
    );
  }

  return (
    <span className="text-sm text-gray-700">
      {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(lastCheckedAt)}
    </span>
  );
};

export interface ComponentProps {
  store: DataStore;
}

const StoreNameCell: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const kindInfo: DataStoreKindInfo | undefined = getDataStoreKindInfo(
    props.store.kind,
  );
  const region: string = props.store.region || "";

  return (
    <div className="flex min-w-0 items-start gap-2">
      <Icon
        icon={kindInfo?.icon || IconProp.Database}
        className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
      />
      <div className="min-w-0">
        {props.store._id ? (
          <AppLink
            to={getDataStoreRoute(props.store._id)}
            className="block truncate text-sm font-medium text-gray-900 hover:underline"
          >
            {props.store.name || "—"}
          </AppLink>
        ) : (
          <span className="block truncate text-sm font-medium text-gray-900">
            {props.store.name || "—"}
          </span>
        )}
        <div className="truncate text-xs text-gray-500">
          {props.store.kind || ""}
          {region ? <span className="font-mono">{` · ${region}`}</span> : <></>}
        </div>
      </div>
    </div>
  );
};

export default StoreNameCell;
