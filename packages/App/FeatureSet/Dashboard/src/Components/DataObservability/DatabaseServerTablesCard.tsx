import AppLink from "../AppLink/AppLink";
import DataObservabilityApi from "./DataObservabilityApi";
import StoreStatusPill from "./StoreStatusPill";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import { DataObservabilityStoreSummary } from "Common/Types/DataObservability/DataObservabilityApiTypes";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  databaseServerId: ObjectID;
}

/*
 * How the tables on this database server are, from Data Observability: a server
 * that is overloaded or down is usually why its tables have gone late. With no
 * database of this server connected there, it shows nothing.
 */
const DatabaseServerTablesCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [stores, setStores] = useState<Array<DataObservabilityStoreSummary>>(
    [],
  );

  useEffect(() => {
    let isCurrent: boolean = true;

    DataObservabilityApi.getStoresOfDatabaseServer(props.databaseServerId)
      .then((found: Array<DataObservabilityStoreSummary>): void => {
        if (isCurrent) {
          setStores(found);
        }
      })
      .catch((): void => {
        // Extra to the page it is on: when it cannot be read, the page carries on without it.
      });

    return () => {
      isCurrent = false;
    };
  }, [props.databaseServerId.toString()]);

  if (stores.length === 0) {
    return <></>;
  }

  return (
    <Card
      title="Tables"
      description="How the tables on this server are, as Data Observability reads them."
    >
      <ul className="divide-y divide-gray-100 px-6 pb-6">
        {stores.map((store: DataObservabilityStoreSummary): ReactElement => {
          return (
            <li
              key={store.dataStoreId}
              className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <AppLink
                  className="font-medium text-gray-900 hover:underline"
                  to={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.DATA_OBSERVABILITY_STORE_VIEW] as Route,
                    { modelId: new ObjectID(store.dataStoreId) },
                  )}
                >
                  {store.name}
                </AppLink>
                <StoreStatusPill store={store} />
              </div>
              <span className="text-xs text-gray-600">
                {translator.translatePlural(
                  {
                    one: "{{count}} table watched",
                    other: "{{count}} tables watched",
                  },
                  store.assetCount,
                )}
                {store.lateAssetCount > 0
                  ? ` · ${translator.translatePlural(
                      {
                        one: "{{count}} late",
                        other: "{{count}} late",
                      },
                      store.lateAssetCount,
                    )}`
                  : ""}
                {store.collectedAt
                  ? ` · ${translator.translateTemplate(
                      "Last collected {{time}}",
                      {
                        time: OneUptimeDate.fromNow(
                          OneUptimeDate.fromString(store.collectedAt),
                        ),
                      },
                    )}`
                  : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
};

export default DatabaseServerTablesCard;
