import { getDataObservabilityBreadcrumbs } from "../../../Utils/Breadcrumbs/DataObservabilityBreadcrumbs";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import TableViewSideMenu from "./SideMenu";
import { TABLE_VIEW_SELECT, TableViewOutletContext } from "./TableViewContext";
import DataAsset from "Common/Models/DatabaseModels/DataAsset";
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

// The table as it was last read, stamped with the id it was read for.
interface LoadedDataAsset {
  dataAssetId: string;
  dataAsset: DataAsset | null;
}

/*
 * One table, worked on pages of its own: its Overview, Columns, Metrics and
 * Timeline, its Settings and, under Advanced, Delete. The layout reads the
 * table once for all of them and names it in the title and the trail. A
 * table gone from its database says so on every page.
 */
const TableViewLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const idString: string = id || "";
  const dataAssetId: ObjectID = useMemo((): ObjectID => {
    return new ObjectID(idString);
  }, [idString]);
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  const [loaded, setLoaded] = useState<LoadedDataAsset | null>(null);
  const [readCount, setReadCount] = useState<number>(0);

  useEffect(() => {
    let isCurrent: boolean = true;

    ModelAPI.getItem<DataAsset>({
      modelType: DataAsset,
      id: dataAssetId,
      select: TABLE_VIEW_SELECT,
    })
      .then((item: DataAsset | null): void => {
        if (isCurrent) {
          setLoaded({ dataAssetId: idString, dataAsset: item });
        }
      })
      .catch((): void => {
        if (isCurrent) {
          setLoaded((previous: LoadedDataAsset | null): LoadedDataAsset => {
            return previous && previous.dataAssetId === idString
              ? previous
              : { dataAssetId: idString, dataAsset: null };
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

  const isLoaded: boolean = loaded !== null && loaded.dataAssetId === idString;
  const dataAsset: DataAsset | null = isLoaded ? loaded!.dataAsset : null;

  const context: TableViewOutletContext =
    useMemo((): TableViewOutletContext => {
      return {
        dataAssetId: dataAssetId,
        dataAsset: dataAsset,
        refresh: refresh,
      };
    }, [dataAssetId, dataAsset, refresh]);

  return (
    <ModelPage
      title="Table"
      modelType={DataAsset}
      modelId={dataAssetId}
      modelNameField="assetKey"
      breadcrumbLinks={getDataObservabilityBreadcrumbs(path)}
      sideMenu={<TableViewSideMenu modelId={dataAssetId} />}
      refreshToken={readCount}
    >
      {isLoaded ? (
        <>
          {dataAsset?.isDropped ? (
            <Alert
              type={AlertType.INFO}
              title="This table is no longer in its database. It is kept here with its history, and comes back by itself if the table does."
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

export default TableViewLayout;
