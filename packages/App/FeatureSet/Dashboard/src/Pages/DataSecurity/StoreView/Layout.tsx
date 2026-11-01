import { getDataSecurityBreadcrumbs } from "../../../Utils/Breadcrumbs/DataSecurityBreadcrumbs";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import {
  DATA_STORE_VIEW_SELECT,
  DataStoreViewOutletContext,
} from "./DataStoreViewContext";
import DataStoreViewSideMenu from "./SideMenu";
import DataStore from "Common/Models/DatabaseModels/DataStore";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
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

/*
 * The store as it was last read, stamped with the id it was read for, so a
 * store read for the page the reader just left is never shown for the one
 * they are on.
 */
interface LoadedDataStore {
  dataStoreId: string;
  dataStore: DataStore | null;
}

/*
 * One data store, worked on pages of its own under a side menu of its own:
 * its Overview, What's Inside, Who Can Reach It, its Issues, Data Flows and
 * Scans, its Owners and Settings, and under Advanced, Delete. The layout
 * reads the store once for all of them (DataStoreViewContext) and names it
 * in the title and the trail. A store gone from its cloud says so on every
 * page.
 */
const DataStoreViewLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const dataStoreIdString: string = id || "";
  const dataStoreId: ObjectID = useMemo((): ObjectID => {
    return new ObjectID(dataStoreIdString);
  }, [dataStoreIdString]);
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  const [loaded, setLoaded] = useState<LoadedDataStore | null>(null);
  const [readCount, setReadCount] = useState<number>(0);

  useEffect(() => {
    let isCurrent: boolean = true;

    ModelAPI.getItem<DataStore>({
      modelType: DataStore,
      id: dataStoreId,
      select: DATA_STORE_VIEW_SELECT,
    })
      .then((item: DataStore | null): void => {
        if (isCurrent) {
          setLoaded({ dataStoreId: dataStoreIdString, dataStore: item });
        }
      })
      .catch((): void => {
        /*
         * The page header reads the store too, and says why it could not
         * be read; the pages below read what they show themselves.
         */
        if (isCurrent) {
          setLoaded((previous: LoadedDataStore | null): LoadedDataStore => {
            return previous && previous.dataStoreId === dataStoreIdString
              ? previous
              : { dataStoreId: dataStoreIdString, dataStore: null };
          });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [dataStoreIdString, readCount]);

  const refresh: () => void = useCallback((): void => {
    setReadCount((count: number): number => {
      return count + 1;
    });
  }, []);

  const isLoaded: boolean =
    loaded !== null && loaded.dataStoreId === dataStoreIdString;
  const dataStore: DataStore | null = isLoaded ? loaded!.dataStore : null;

  const context: DataStoreViewOutletContext =
    useMemo((): DataStoreViewOutletContext => {
      return {
        dataStoreId: dataStoreId,
        dataStore: dataStore,
        refresh: refresh,
      };
    }, [dataStoreId, dataStore, refresh]);

  return (
    <ModelPage
      title="Data Store"
      modelType={DataStore}
      modelId={dataStoreId}
      modelNameField="name"
      breadcrumbLinks={getDataSecurityBreadcrumbs(path)}
      sideMenu={<DataStoreViewSideMenu modelId={dataStoreId} />}
      refreshToken={readCount}
    >
      {isLoaded ? (
        <>
          {dataStore?.isArchived ? (
            <Alert
              type={AlertType.INFO}
              title="This store is no longer found in its cloud or source. It is kept here with its history, and comes back by itself if it is found again."
            />
          ) : (
            <></>
          )}
          <Outlet context={context} />
        </>
      ) : (
        <PageLoader isVisible={true} />
      )}
    </ModelPage>
  );
};

export default DataStoreViewLayout;
