import { getSloBreadcrumbs } from "../Utils/Breadcrumbs";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import SideMenu from "./SideMenu";
import ObjectID from "Common/Types/ObjectID";
import SliType from "Common/Types/ServiceLevelObjective/SliType";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { Outlet, useParams } from "react-router-dom";

const SloViewLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  /*
   * What the SLO measures, for its side menu: a request SLO has no Monitors
   * or Monitor Rules pages. Read again on every page of the SLO, so a type
   * changed on Settings shows in the menu on the next step; a read that
   * fails, or lands after the reader moved to another SLO, changes nothing.
   */
  const [sliType, setSliType] = useState<SliType | null>(null);

  useEffect(() => {
    let isCurrent: boolean = true;

    if (!id) {
      return;
    }

    ModelAPI.getItem<ServiceLevelObjective>({
      modelType: ServiceLevelObjective,
      id: new ObjectID(id),
      select: {
        sliType: true,
      },
    })
      .then((slo: ServiceLevelObjective | null) => {
        if (isCurrent) {
          setSliType(slo?.sliType || null);
        }
      })
      .catch(() => {
        // The menu keeps every page, so each one is still one click away.
      });

    return () => {
      isCurrent = false;
    };
  }, [id, path]);

  return (
    <ModelPage
      title="SLO"
      modelType={ServiceLevelObjective}
      modelId={modelId}
      modelNameField="name"
      breadcrumbLinks={getSloBreadcrumbs(path)}
      sideMenu={<SideMenu modelId={modelId} sliType={sliType} />}
    >
      <Outlet />
    </ModelPage>
  );
};

export default SloViewLayout;
