import { DataObservabilityStoreSummary } from "Common/Types/DataObservability/DataObservabilityApiTypes";
import ObjectID from "Common/Types/ObjectID";
import { useOutletContext } from "react-router-dom";

/*
 * What every page of a database shares: the database as its layout read it
 * from Data Observability's own route (a data store is readable by the
 * Security tiers only), and a way to read it again after Collect Now.
 */
export interface StoreViewOutletContext {
  dataStoreId: ObjectID;
  store: DataObservabilityStoreSummary | null;
  refresh: () => void;
}

export function useStoreView(): StoreViewOutletContext {
  return useOutletContext<StoreViewOutletContext>();
}
