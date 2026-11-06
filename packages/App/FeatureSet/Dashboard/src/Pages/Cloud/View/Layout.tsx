import { getCloudBreadcrumbs } from "../../../Utils/Breadcrumbs/CloudBreadcrumbs";
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
import { canCloudResourceHaveStreamedLogs } from "Common/Types/Cloud/CloudLogGroups";
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
 * A cloud resource's page in Cloud. The CloudResource table also holds the
 * environments App Platforms shows, and an environment's id under …/cloud/
 * is an address from before the two products split - a bookmark, a feed
 * entry, a message - or a link that could not tell the kinds apart. So the
 * kind is read first: an environment forwards to the same tab in App
 * Platforms, keeping the query string and the hash (CloudResourceViewPages),
 * and only a resource is drawn here. A failed read draws the resource page,
 * whose tabs load the row themselves and show their own error.
 */
const CloudResourceViewLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const location: Location = useLocation();
  const modelId: ObjectID = new ObjectID(id || "");
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  const [cloudResourceKind, setCloudResourceKind] =
    useState<CloudResourceKind | null>(null);
  // Whether its menu has Logs: a kind of resource a log group names.
  const [hasStreamedLogs, setHasStreamedLogs] = useState<boolean>(false);

  useEffect(() => {
    let ignore: boolean = false;
    setCloudResourceKind(null);
    setHasStreamedLogs(false);

    ModelAPI.getItem({
      modelType: CloudResource,
      id: modelId,
      select: {
        cloudResourceKind: true,
        cloudProvider: true,
        cloudResourceType: true,
      },
    })
      .then((item: CloudResource | null): void => {
        if (!ignore) {
          setHasStreamedLogs(
            canCloudResourceHaveStreamedLogs({
              provider: item?.cloudProvider,
              type: item?.cloudResourceType,
            }),
          );
          /*
           * A row that is not there is drawn as a resource, so its tabs say
           * it was not found where it was looked for.
           */
          setCloudResourceKind(
            !item || isCloudResourceKindResource(item.cloudResourceKind)
              ? CloudResourceKind.Resource
              : CloudResourceKind.Environment,
          );
        }
      })
      .catch((): void => {
        if (!ignore) {
          setCloudResourceKind(CloudResourceKind.Resource);
        }
      });

    return (): void => {
      ignore = true;
    };
  }, [id]);

  if (cloudResourceKind === CloudResourceKind.Environment) {
    return (
      <Navigate
        replace={true}
        to={getCloudResourceForwardRoute({
          cloudResourceKind: CloudResourceKind.Environment,
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
      title="Cloud Resource"
      modelType={CloudResource}
      modelId={modelId}
      modelNameField="name"
      breadcrumbLinks={getCloudBreadcrumbs(path)}
      sideMenu={
        <SideMenu modelId={modelId} hasStreamedLogs={hasStreamedLogs} />
      }
    >
      {cloudResourceKind ? <Outlet /> : <PageLoader isVisible={true} />}
    </ModelPage>
  );
};

export default CloudResourceViewLayout;
