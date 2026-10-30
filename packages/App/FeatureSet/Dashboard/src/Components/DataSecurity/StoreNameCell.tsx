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
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
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

/*
 * A store's name on its line, cut at its own end (dir="auto"): a bucket's
 * name reads left to right on a Persian page too, and cut there from the
 * right it lost its start ("…tomer-exports"). Lined up as the page reads -
 * left, or right on a Persian page - beside the kind's icon.
 */
export const STORE_NAME_LINE_CLASS_NAME: string =
  "truncate text-sm font-medium text-gray-900 [text-align:left] rtl:[text-align:right]";

/*
 * The kind, then the region after a dot - or on the next line when the
 * two do not fit side by side (a list beside the side menu leaves the name
 * 168 pixels): both kept whole rather than "AWS S3 Bucket · eu-west-…".
 * Each piece brings its dot in its padding at its start, and the row is
 * moved back by as much inside a clip, so the piece a line starts with
 * shows none.
 */
export const STORE_KIND_ROW_CLASS_NAME: string = "-ms-3 flex flex-wrap";
export const STORE_KIND_PIECE_CLASS_NAME: string =
  "min-w-0 max-w-full truncate ps-3";
export const STORE_REGION_PIECE_CLASS_NAME: string =
  "relative min-w-0 max-w-full truncate ps-3 font-mono before:absolute before:start-0 before:w-3 before:text-center before:font-sans before:content-['·']";

export interface ComponentProps {
  store: DataStore;
}

const StoreNameCell: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const kindInfo: DataStoreKindInfo | undefined = getDataStoreKindInfo(
    props.store.kind,
  );
  // A cloud's own product names stay as they are; Logs and Traces do not.
  const kind: string = props.store.kind
    ? translator.translateText(props.store.kind) || props.store.kind
    : "";
  const region: string = props.store.region || "";

  return (
    <div className="flex min-w-0 items-start gap-2">
      <Icon
        icon={kindInfo?.icon || IconProp.Database}
        className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
      />
      <div className="min-w-0">
        <div
          dir="auto"
          className={STORE_NAME_LINE_CLASS_NAME}
          data-testid="data-store-name"
        >
          {props.store._id ? (
            <AppLink
              to={getDataStoreRoute(props.store._id)}
              className="hover:underline"
            >
              {props.store.name || "—"}
            </AppLink>
          ) : (
            <span>{props.store.name || "—"}</span>
          )}
        </div>
        {kind || region ? (
          <div
            className="overflow-hidden text-xs text-gray-500"
            data-testid="data-store-kind-and-region"
          >
            <div className={STORE_KIND_ROW_CLASS_NAME}>
              {kind ? (
                <span className={STORE_KIND_PIECE_CLASS_NAME}>{kind}</span>
              ) : (
                <></>
              )}
              {region ? (
                <span className={STORE_REGION_PIECE_CLASS_NAME}>{region}</span>
              ) : (
                <></>
              )}
            </div>
          </div>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

export default StoreNameCell;
