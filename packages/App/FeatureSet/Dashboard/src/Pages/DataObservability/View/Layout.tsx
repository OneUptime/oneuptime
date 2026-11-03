import DataObservabilityApi from "../../../Components/DataObservability/DataObservabilityApi";
import { getDataObservabilityBreadcrumbs } from "../../../Utils/Breadcrumbs/DataObservabilityBreadcrumbs";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import StoreViewSideMenu from "./SideMenu";
import { StoreViewOutletContext } from "./StoreViewContext";
import { DataObservabilityStoreSummary } from "Common/Types/DataObservability/DataObservabilityApiTypes";
import Link from "Common/Types/Link";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Page from "Common/UI/Components/Page/Page";
import { nameRecordInTrail } from "Common/UI/Components/Page/RecordNameInTrail";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Outlet, useParams } from "react-router-dom";

// The database as it was last read, stamped with the id it was read for.
interface LoadedStore {
  dataStoreId: string;
  store: DataObservabilityStoreSummary | null;
  error: string;
}

/*
 * One database, worked on pages of its own: its Overview, its Tables and the
 * monitors recommended for them. The layout reads it once for all of them,
 * from Data Observability's own route - a data store is Data Security's
 * record, readable by the Security tiers only - and names it in the title
 * and the trail.
 */
const StoreViewLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const idString: string = id || "";
  const dataStoreId: ObjectID = useMemo((): ObjectID => {
    return new ObjectID(idString);
  }, [idString]);
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  const [loaded, setLoaded] = useState<LoadedStore | null>(null);
  const [readCount, setReadCount] = useState<number>(0);

  useEffect(() => {
    let isCurrent: boolean = true;

    DataObservabilityApi.getStores()
      .then((stores: Array<DataObservabilityStoreSummary>): void => {
        if (isCurrent) {
          setLoaded({
            dataStoreId: idString,
            store:
              stores.find((candidate: DataObservabilityStoreSummary) => {
                return candidate.dataStoreId === idString;
              }) || null,
            error: "",
          });
        }
      })
      .catch((err: unknown): void => {
        if (isCurrent) {
          setLoaded({
            dataStoreId: idString,
            store: null,
            error: API.getFriendlyMessage(err),
          });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [idString, readCount]);

  const refresh: () => void = useCallback((): void => {
    setReadCount((count: number): number => {
      return count + 1;
    });
  }, []);

  const isLoaded: boolean = loaded !== null && loaded.dataStoreId === idString;
  const store: DataObservabilityStoreSummary | null = isLoaded
    ? loaded!.store
    : null;

  const context: StoreViewOutletContext =
    useMemo((): StoreViewOutletContext => {
      return {
        dataStoreId: dataStoreId,
        store: store,
        refresh: refresh,
      };
    }, [dataStoreId, store, refresh]);

  const breadcrumbLinks: Array<Link> | undefined = nameRecordInTrail({
    links: getDataObservabilityBreadcrumbs(path),
    recordId: idString,
    recordName: store?.name,
  });

  const renderContent: () => ReactElement = (): ReactElement => {
    if (!isLoaded) {
      return <PageLoader isVisible={true} />;
    }

    if (loaded!.error) {
      return <ErrorMessage message={loaded!.error} onRefreshClick={refresh} />;
    }

    if (!store) {
      return <ErrorMessage message="This database was not found." />;
    }

    return <Outlet context={context} />;
  };

  return (
    <Page
      title={store?.name || "Database"}
      breadcrumbLinks={breadcrumbLinks}
      sideMenu={<StoreViewSideMenu modelId={dataStoreId} />}
    >
      {renderContent()}
    </Page>
  );
};

export default StoreViewLayout;
