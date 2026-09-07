import PageComponentProps from "../PageComponentProps";
import InventoryTable from "../../Components/Inventory/InventoryTable";
import {
  InventoryScope,
  InventoryScopeQuery,
  buildInventoryScopeQuery,
  isInventoryScopeEmpty,
  parseInventoryScope,
} from "../../Components/Inventory/InventoryScope";
import Query from "Common/Types/BaseDatabase/Query";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import React, { FunctionComponent, ReactElement, useMemo } from "react";
import { useLocation, Location } from "react-router-dom";

/*
 * The full inventory list, optionally scoped by the `?type` / `?source` /
 * `?stale` params the Overview's drill-downs and the side menu link with.
 *
 * The params are read off `useLocation().search` rather than through
 * Navigation's global: a query-string-only change does not remount this
 * component, so a value captured at first render would leave the table showing
 * the previous scope after navigation.
 */

const InventoryItems: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const location: Location = useLocation();
  const search: string = location.search;

  const scope: InventoryScope = useMemo((): InventoryScope => {
    const params: URLSearchParams = new URLSearchParams(search);

    return parseInventoryScope((paramName: string): string | null => {
      return params.get(paramName);
    });
  }, [search]);

  /*
   * Memoised because building the query reads the clock for the stale cutoff:
   * a fresh object on every render would be a fresh `query` prop on every
   * render, and ModelTable re-fetches when its query changes.
   */
  const scopeQuery: Query<InventoryItem> | undefined = useMemo(():
    | Query<InventoryItem>
    | undefined => {
    if (isInventoryScopeEmpty(scope)) {
      return undefined;
    }

    const built: InventoryScopeQuery = buildInventoryScopeQuery(
      scope,
      new Date(),
    );

    return built as Query<InventoryItem>;
  }, [scope]);

  return (
    <InventoryTable
      /*
       * Keyed by the scope so a change of scope remounts the table. Without
       * it the table keeps the previous scope's page number and sort, and
       * page 4 of a 300-row list is rarely a valid page of a 6-row one.
       */
      key={`inventory-items-${search}`}
      query={scopeQuery}
      cardTitle="All Items"
      cardDescription="Every service, host, pod, container, device and hand-registered dependency OneUptime knows about in this project."
    />
  );
};

export default InventoryItems;
