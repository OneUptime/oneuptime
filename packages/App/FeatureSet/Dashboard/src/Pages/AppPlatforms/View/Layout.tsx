import { getAppPlatformsBreadcrumbs } from "../../../Utils/Breadcrumbs/AppPlatformsBreadcrumbs";
import { RouteUtil } from "../../../Utils/RouteMap";
import { getCloudResourceForwardRoute } from "../../../Utils/CloudResourceViewPages";
import PageComponentProps from "../../PageComponentProps";
import SideMenu from "./SideMenu";
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
import {
  Location,
  Navigate,
  Outlet,
  useLocation,
  useParams,
} from "react-router-dom";

/*
 * An environment's page in App Platforms. The CloudResource table also holds
 * the resources of the cloud accounts Cloud shows, so the kind is read
 * first: a resource's id under …/app-platforms/environments/ forwards to the
 * same tab in Cloud (CloudResourceViewPages), and only an environment is
 * drawn here. A failed read draws the environment page, whose tabs load the
 * row themselves and show their own error.
 */
const AppPlatformEnvironmentViewLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const location: Location = useLocation();
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
            item && isCloudResourceKindResource(item.cloudResourceKind)
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

  if (cloudResourceKind === CloudResourceKind.Resource) {
    return (
      <Navigate
        replace={true}
        to={getCloudResourceForwardRoute({
          cloudResourceKind: CloudResourceKind.Resource,
          modelId: modelId.toString(),
          pathname: location.pathname,
          search: location.search,
          hash: location.hash,
        })}
      />
    );
  }

  return (
    <ModelPage
      title="Cloud Environment"
      modelType={CloudResource}
      modelId={modelId}
      modelNameField="name"
      breadcrumbLinks={getAppPlatformsBreadcrumbs(path)}
      sideMenu={<SideMenu modelId={modelId} />}
    >
      {cloudResourceKind ? <Outlet /> : <PageLoader isVisible={true} />}
    </ModelPage>
  );
};

export default AppPlatformEnvironmentViewLayout;
