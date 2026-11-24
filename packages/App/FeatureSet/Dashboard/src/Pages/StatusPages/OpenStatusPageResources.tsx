import PageComponentProps from "../PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import RouteParams from "../../Utils/RouteParams";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Page from "Common/UI/Components/Page/Page";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * A STATUS PAGE'S RESOURCES, OPENED BY THE PAGE'S ID ALONE (#9180).
 *
 * The status page's preview says "Visitors see this until you add
 * resources." under a page with nothing on it, and links its owner here,
 * /dashboard/status-pages/<id>/resources
 * (Common/Types/StatusPage/StatusPageResourcesLink): it knows the page's id,
 * and the public overview hands out no project id. This finds the page
 * among the projects the person belongs to - one read across them, as
 * Active Incidents reads - and passes the browser on to its Resources in
 * its project, in place of itself, so Back does not land here to be passed
 * on again. A page of the project open in this tab opens inside the tab; a
 * page of another project opens in full, so the Dashboard opens that
 * project with it.
 *
 * A page the person cannot read - another project's, a deleted one, an id
 * that is no id - is answered the same way, with what to do next: the link
 * told them nothing more than its id.
 */

export const STATUS_PAGE_NOT_IN_YOUR_PROJECTS: string = translationKey(
  "This status page is not in any project you belong to. Check the link, or ask someone in its project to invite you.",
);

// The project the status page is in, among the person's; null when it is in none.
export const findProjectOfStatusPage: (
  statusPageId: ObjectID,
) => Promise<ObjectID | null> = async (
  statusPageId: ObjectID,
): Promise<ObjectID | null> => {
  const result: ListResult<StatusPage> = await ModelAPI.getList<StatusPage>({
    modelType: StatusPage,
    query: { _id: statusPageId },
    limit: 1,
    skip: 0,
    select: { _id: true, projectId: true },
    sort: {},
    requestOptions: { isMultiTenantRequest: true },
  });

  const projectId: ObjectID | undefined = result.data[0]?.projectId;

  return projectId ? new ObjectID(projectId.toString()) : null;
};

// The page's Resources, in its own project.
export const getStatusPageResourcesRoute: (data: {
  projectId: ObjectID;
  statusPageId: ObjectID;
}) => Route = (data: { projectId: ObjectID; statusPageId: ObjectID }): Route => {
  return new Route(RouteMap[PageMap.STATUS_PAGE_VIEW_RESOURCES]!.toString())
    .addRouteParam(RouteParams.ProjectID, data.projectId.toString())
    .addRouteParam(RouteParams.ModelID, data.statusPageId.toString());
};

const OpenStatusPageResources: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let isCurrent: boolean = true;

    const statusPageId: string =
      Navigation.getParamByName(
        RouteParams.ModelID,
        RouteMap[PageMap.STATUS_PAGE_RESOURCES_BY_ID] as Route,
      ) || "";

    if (!ObjectID.isValidUUID(statusPageId)) {
      setError(STATUS_PAGE_NOT_IN_YOUR_PROJECTS);
      return;
    }

    const open: () => Promise<void> = async (): Promise<void> => {
      try {
        const projectId: ObjectID | null = await findProjectOfStatusPage(
          new ObjectID(statusPageId),
        );

        if (!isCurrent) {
          return;
        }

        if (!projectId) {
          setError(STATUS_PAGE_NOT_IN_YOUR_PROJECTS);
          return;
        }

        const isOpenInThisTab: boolean =
          ProjectUtil.getCurrentProjectId()?.toString().toLowerCase() ===
          projectId.toString().toLowerCase();

        Navigation.navigate(
          getStatusPageResourcesRoute({
            projectId: projectId,
            statusPageId: new ObjectID(statusPageId),
          }),
          { replace: true, forceNavigate: !isOpenInThisTab },
        );
      } catch (err) {
        if (isCurrent) {
          setError(API.getFriendlyMessage(err));
        }
      }
    };

    void open();

    return () => {
      isCurrent = false;
    };
  }, []);

  return (
    <Page
      title="Status Page"
      breadcrumbLinks={[]}
      isLoading={!error}
      error={error || undefined}
    >
      <></>
    </Page>
  );
};

export default OpenStatusPageResources;
