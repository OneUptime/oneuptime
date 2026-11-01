import DataStore from "Common/Models/DatabaseModels/DataStore";
import {
  DataStoreKind,
  DataStoreKindInfo,
  DataStoreProvider,
  TELEMETRY_DATA_STORE_KINDS,
  getDataStoreKindInfo,
} from "Common/Types/DataSecurity/DataStoreKind";
import ObjectID from "Common/Types/ObjectID";
import { useOutletContext, useParams } from "react-router-dom";

/*
 * What every page of a data store shares: the store as its layout read it -
 * what kind of store it is, where it lives - and a way to read it again
 * after a change. The layout reads it once, so the side menu, the Overview,
 * What's Inside (Scrub It, for a service's telemetry) and Settings (the
 * scanning method of a database you run yourself) agree without each
 * fetching it.
 */

// The columns the layout reads for every page.
export const DATA_STORE_VIEW_SELECT: {
  _id: true;
  name: true;
  kind: true;
  provider: true;
  family: true;
  isArchived: true;
  isContentScanEnabled: true;
} = {
  _id: true,
  name: true,
  kind: true,
  provider: true,
  family: true,
  isArchived: true,
  isContentScanEnabled: true,
};

export interface DataStoreViewOutletContext {
  dataStoreId: ObjectID;
  // As the layout read it: null while it is read, or when it could not be.
  dataStore: DataStore | null;
  // Read the store again: after Settings saves, say.
  refresh: () => void;
}

// What a store's kind says about it, for the pages that differ by kind.
export interface DataStoreKindFacts {
  kindInfo: DataStoreKindInfo | undefined;
  // A service's logs, traces, exceptions, replays or AI conversations.
  isTelemetry: boolean;
  // A database a team runs itself, scanned with a connection string or a probe.
  isSelfManaged: boolean;
  // Whether Data Security can sample its content at all.
  isContentScannable: boolean;
}

export function getDataStoreKindFacts(
  kind: string | undefined | null,
): DataStoreKindFacts {
  const kindInfo: DataStoreKindInfo | undefined = getDataStoreKindInfo(kind);

  return {
    kindInfo: kindInfo,
    isTelemetry: Boolean(
      kind && TELEMETRY_DATA_STORE_KINDS.includes(kind as DataStoreKind),
    ),
    isSelfManaged: kindInfo?.provider === DataStoreProvider.SelfManaged,
    isContentScannable: Boolean(kindInfo?.contentScannable),
  };
}

/*
 * The store the layout read. A page rendered outside the layout (a test, or
 * a route mounted elsewhere) reads the store's id from the address, and no
 * store.
 */
export function useDataStoreViewContext(): DataStoreViewOutletContext {
  const context: DataStoreViewOutletContext | undefined | null =
    useOutletContext<DataStoreViewOutletContext | undefined | null>();
  const { id } = useParams();

  if (context) {
    return context;
  }

  return {
    dataStoreId: new ObjectID(id || ""),
    dataStore: null,
    refresh: (): void => {
      // Nothing to read again outside the layout.
    },
  };
}
