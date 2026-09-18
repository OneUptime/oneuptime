import PageComponentProps from "../PageComponentProps";
import InventoryTable from "../../Components/Inventory/InventoryTable";
import { normalizeInventoryListFacetSearch } from "../../Components/Inventory/InventoryListFacetRoute";
import React, { FunctionComponent, ReactElement } from "react";
import { useLocation, Location, Navigate } from "react-router-dom";

const InventoryItems: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const location: Location = useLocation();
  const normalizedSearch: string = normalizeInventoryListFacetSearch(
    location.search,
  );

  // The facet hook must mount after the legacy link becomes a regular facet URL.
  if (normalizedSearch !== location.search) {
    return (
      <Navigate
        replace={true}
        state={location.state}
        to={{
          pathname: location.pathname,
          search: normalizedSearch,
          hash: location.hash,
        }}
      />
    );
  }

  return (
    <InventoryTable
      key={`inventory-items-${location.search}`}
      cardTitle="All Items"
      cardDescription="Every service, host, pod, container, device and hand-registered dependency OneUptime knows about in this project."
    />
  );
};

export default InventoryItems;
