import { getCloudBreadcrumbs } from "../../../Utils/Breadcrumbs/CloudBreadcrumbs";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import SideMenu from "./SideMenu";
import { CloudResourceViewOutletContext } from "./CloudResourceViewContext";
import ObjectID from "Common/Types/ObjectID";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Navigation from "Common/UI/Utils/Navigation";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import {
  CloudResourceKind,
  isCloudResourceKindResource,
} from "Common/Types/Cloud/CloudResourceKind";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { Outlet, useParams } from "react-router-dom";

/*
 * One page for both kinds of Cloud row. The kind is read once, here, and
 * passed to the side menu and to every tab (CloudResourceViewContext): an
 * environment and a resource discovered from cloud monitoring share the
 * route tree but not their tabs. A failed read falls back to an
 * environment - the tabs then load the row themselves and show their own
 * error.
 */
const CloudResourceViewLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  const [cloudResourceKind, setCloudResourceKind] =
    useState<CloudResourceKind | null>(null);

  useEffect(() => {
    let ignore: boolean = false;
    setCloudResourceKind(null);

    ModelAPI.getItem({
      modelType: CloudResource,
      id: modelId,
      select: {
        cloudResourceKind: true,
      },
    })
      .then((item: CloudResource | null): void => {
        if (!ignore) {
          setCloudResourceKind(
            isCloudResourceKindResource(item?.cloudResourceKind)
              ? CloudResourceKind.Resource
              : CloudResourceKind.Environment,
          );
        }
      })
      .catch((): void => {
        if (!ignore) {
          setCloudResourceKind(CloudResourceKind.Environment);
        }
      });

    return (): void => {
      ignore = true;
    };
  }, [id]);

  const isResource: boolean = isCloudResourceKindResource(cloudResourceKind);

  const context: CloudResourceViewOutletContext = {
    cloudResourceKind: cloudResourceKind || CloudResourceKind.Environment,
  };

  return (
    <ModelPage
      title={isResource ? "Cloud Resource" : "Cloud Environment"}
      modelType={CloudResource}
      modelId={modelId}
      modelNameField="name"
      breadcrumbLinks={getCloudBreadcrumbs(path)}
      sideMenu={
        <SideMenu
          modelId={modelId}
          cloudResourceKind={context.cloudResourceKind}
        />
      }
    >
      {cloudResourceKind ? (
        <Outlet context={context} />
      ) : (
        <PageLoader isVisible={true} />
      )}
    </ModelPage>
  );
};

export default CloudResourceViewLayout;
