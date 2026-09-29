import { getMonitorBreadcrumbs } from "../../../Utils/Breadcrumbs";
import { RouteUtil } from "../../../Utils/RouteMap";
import MonitorViewOutletContext from "./MonitorViewOutletContext";
import SideMenu from "./SideMenu";
import ObjectID from "Common/Types/ObjectID";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import { Outlet, useParams } from "react-router-dom";

/*
 * The monitor's type, or why it could not be read, stamped with the id it was
 * read for. The side menu is built from the type, so a type read for the
 * monitor the reader just left must never be shown for the one they are on.
 */
interface LoadedMonitorType {
  modelId: string;
  monitorType: MonitorType | null;
  error: string;
}

const MonitorViewLayout: FunctionComponent = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");

  /*
   * Keyed on the id's string, not the ObjectID: a new ObjectID is built from
   * the route params on every render.
   */
  const modelIdString: string = modelId.toString();
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  const [loaded, setLoaded] = useState<LoadedMonitorType | null>(null);

  /*
   * Bumped to have ModelPage read the header again, after the page below
   * edits the monitor's name or labels.
   */
  const [headerRefreshToken, setHeaderRefreshToken] = useState<number>(0);

  /*
   * Bumped by every read, when the id changes and on unmount. A read only
   * lands while no newer one has started, so a slow read of the monitor the
   * reader already left cannot put its type (and so its side menu) back.
   */
  const latestRequestRef: MutableRefObject<number> = useRef<number>(0);

  type LoadMonitorTypeFunction = (requestedModelId: string) => Promise<void>;

  const loadMonitorType: LoadMonitorTypeFunction = async (
    requestedModelId: string,
  ): Promise<void> => {
    const requestNumber: number = latestRequestRef.current + 1;
    latestRequestRef.current = requestNumber;

    let result: LoadedMonitorType;

    try {
      const item: Monitor | null = await ModelAPI.getItem({
        modelType: Monitor,
        id: new ObjectID(requestedModelId),
        select: {
          monitorType: true,
        },
      });

      result = item
        ? {
            modelId: requestedModelId,
            monitorType: item.monitorType || null,
            error: "",
          }
        : {
            modelId: requestedModelId,
            monitorType: null,
            error: ExceptionMessages.MonitorNotFound,
          };
    } catch (err) {
      result = {
        modelId: requestedModelId,
        monitorType: null,
        error: API.getFriendlyMessage(err),
      };
    }

    if (requestNumber !== latestRequestRef.current) {
      return;
    }

    setLoaded(result);
  };

  type StartLoadFunction = (requestedModelId: string) => void;

  const startLoad: StartLoadFunction = (requestedModelId: string): void => {
    loadMonitorType(requestedModelId).catch((err: Error) => {
      setLoaded({
        modelId: requestedModelId,
        monitorType: null,
        error: API.getFriendlyMessage(err),
      });
    });
  };

  /*
   * Read again whenever the id changes. The layout stays mounted when the
   * reader follows a link from one monitor to another, and it used to read
   * the type once, on mount, so the second monitor was shown with the first
   * one's side menu.
   */
  useEffect(() => {
    startLoad(modelIdString);

    return () => {
      latestRequestRef.current++;
    };
  }, [modelIdString]);

  type RetryFunction = () => void;

  const retry: RetryFunction = (): void => {
    setLoaded(null);
    startLoad(modelIdString);
  };

  /*
   * Stable for the life of the layout, so a page that keeps it in an effect's
   * dependencies is not re-run on every render.
   */
  const outletContext: MonitorViewOutletContext =
    useMemo((): MonitorViewOutletContext => {
      return {
        refreshHeader: (): void => {
          setHeaderRefreshToken((current: number) => {
            return current + 1;
          });
        },
      };
    }, []);

  /*
   * Decided at render time from the id stamp, so the first render for a new
   * id already shows the loader rather than the previous monitor's pages.
   */
  if (!loaded || loaded.modelId !== modelIdString) {
    return <PageLoader isVisible={true} />;
  }

  if (loaded.error) {
    return <ErrorMessage message={loaded.error} onRefreshClick={retry} />;
  }

  /*
   * Every page here, starting with the side menu, is chosen by the monitor's
   * type. Without one there is nothing correct to show, and waiting would
   * only mean a loader that never ends, which is what this used to do.
   */
  if (!loaded.monitorType) {
    return (
      <ErrorMessage
        message="This monitor has no monitor type, so its pages cannot be shown."
        onRefreshClick={retry}
      />
    );
  }

  return (
    <ModelPage
      title="Monitor"
      modelType={Monitor}
      modelId={modelId}
      modelNameField="name"
      refreshToken={headerRefreshToken}
      breadcrumbLinks={getMonitorBreadcrumbs(path)}
      sideMenu={<SideMenu monitorType={loaded.monitorType} modelId={modelId} />}
    >
      <Outlet context={outletContext} />
    </ModelPage>
  );
};

export default MonitorViewLayout;
