import { getRumBreadcrumbs } from "../../../Utils/Breadcrumbs/RumBreadcrumbs";
import { RouteUtil } from "../../../Utils/RouteMap";
import {
  SessionReplayPlayerLayout,
  resolveSessionReplayPlayerLayout,
} from "../../../Utils/SessionReplayLayout";
import {
  ReplayViewPrefs,
  getReplayViewPrefsSnapshot,
  subscribeToReplayViewPrefs,
} from "../../../Components/SessionReplay/ReplayViewPrefs";
import PageComponentProps from "../../PageComponentProps";
import SideMenu from "./SideMenu";
import ObjectID from "Common/Types/ObjectID";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import Navigation from "Common/UI/Utils/Navigation";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import React, {
  FunctionComponent,
  ReactElement,
  useSyncExternalStore,
} from "react";
import { Outlet, useLocation, useParams } from "react-router-dom";

const RumApplicationViewLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  const location: ReturnType<typeof useLocation> = useLocation();

  /*
   * The session replay player goes wide: no side menu, tighter gutters.
   * Decided by the pure matcher on the CURRENT pathname (this layout stays
   * mounted across the list <-> player navigation, so the route template
   * alone would not re-evaluate) and by the viewer's "wide" preference,
   * which the player flips with its Wide button / the w key. Reading the
   * preference through useSyncExternalStore is what lets a toggle inside
   * the player re-render this ancestor without a context provider.
   */
  const prefs: ReplayViewPrefs = useSyncExternalStore(
    subscribeToReplayViewPrefs,
    getReplayViewPrefsSnapshot,
    getReplayViewPrefsSnapshot,
  );
  const layout: SessionReplayPlayerLayout = resolveSessionReplayPlayerLayout({
    path: location.pathname,
    isWide: prefs.wide,
  });

  return (
    <ModelPage
      title="RUM Application"
      modelType={RumApplication}
      modelId={modelId}
      modelNameField="name"
      breadcrumbLinks={getRumBreadcrumbs(path)}
      sideMenu={
        layout.shouldHideSideMenu ? undefined : <SideMenu modelId={modelId} />
      }
      className={layout.className}
    >
      <Outlet />
    </ModelPage>
  );
};

export default RumApplicationViewLayout;
