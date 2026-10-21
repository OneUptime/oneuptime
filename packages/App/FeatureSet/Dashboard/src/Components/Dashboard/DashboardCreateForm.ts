import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import Route from "Common/Types/API/Route";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import {
  DASHBOARD_TEMPLATE_MISC_DATA_KEY,
  DashboardTemplateType,
  getDashboardTemplateStartingName,
} from "Common/Types/Dashboard/DashboardTemplates";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { getUniqueName } from "Common/UI/Components/Forms/Utils/UniqueName";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * CREATE A DASHBOARD: PICK HOW TO START, AND THE NAME IS FILLED IN.
 *
 * Create Dashboard opens Create a dashboard (CreateDashboardModal): Start
 * from scratch, or a template picked the way Create a workflow picks one,
 * then a Name step. These are the rules behind it that are not about the
 * picker:
 *
 *   - the Name is filled in with the template's name, made unique in the
 *     project ("Kubernetes Dashboard", then "Kubernetes Dashboard 2"),
 *     because a dashboard's name is unique per project
 *     (@UniqueColumnBy("projectId")) and the server would refuse a copy.
 *     Start from scratch leaves the Name empty: only its creator knows what
 *     the dashboard is going to show. The names compared are every
 *     dashboard of the project the user can read, archived ones too - the
 *     server's check counts those as well;
 *   - the create request names the template the server builds the new
 *     dashboard from (DashboardService reads DASHBOARD_TEMPLATE_MISC_DATA_KEY);
 *     an empty dashboard names none;
 *   - Create opens the new dashboard: a template's widgets at once, or an
 *     empty dashboard's canvas with its Add Widget button
 *     (Canvas/BlankCanvas).
 *
 * The server's unique check still decides. A name taken by someone else
 * between the picker and Create (or by a dashboard this user cannot read)
 * is refused with the server's own message, on the Name step, where the
 * name can be changed - and Create then still builds the picked template.
 *
 * React-free, so tests can read the naming rule without rendering the
 * page.
 */

export type GetDashboardNameForTemplateFunction = (data: {
  templateType: DashboardTemplateType;
  // The names of the dashboards the project already has.
  existingNames: Iterable<string | null | undefined>;
}) => string;

/**
 * The name a dashboard made from this template starts with: the template's
 * name, numbered past the dashboards that have it already ("Kubernetes
 * Dashboard 2"). Empty for Blank Dashboard.
 */
export const getDashboardNameForTemplate: GetDashboardNameForTemplateFunction =
  (data: {
    templateType: DashboardTemplateType;
    existingNames: Iterable<string | null | undefined>;
  }): string => {
    const startingName: string = getDashboardTemplateStartingName(
      data.templateType,
    );

    if (!startingName) {
      return "";
    }

    return getUniqueName({
      name: startingName,
      existingNames: data.existingNames,
    });
  };

export type AddDashboardTemplateToMiscDataFunction = (data: {
  // The create request's misc data.
  miscDataProps: JSONObject;
  // The template chosen; null for an empty dashboard.
  templateType: DashboardTemplateType | null | undefined;
}) => JSONObject;

/**
 * Tells the server which template to build the new dashboard from, in the
 * create request's misc data. Blank, or no template (Start from scratch),
 * adds nothing: the dashboard starts empty.
 */
export const addDashboardTemplateToMiscData: AddDashboardTemplateToMiscDataFunction =
  (data: {
    miscDataProps: JSONObject;
    templateType: DashboardTemplateType | null | undefined;
  }): JSONObject => {
    if (
      data.templateType &&
      data.templateType !== DashboardTemplateType.Blank
    ) {
      data.miscDataProps[DASHBOARD_TEMPLATE_MISC_DATA_KEY] = data.templateType;
    }

    return data.miscDataProps;
  };

/**
 * The names of every dashboard of the project the user can read, archived
 * ones included. A lookup that fails hands back no names: the Name step
 * then fills in the template's own name, and the server's check still has
 * the last word.
 */
export const fetchDashboardNames: () => Promise<
  Array<string>
> = async (): Promise<Array<string>> => {
  try {
    const result: ListResult<Dashboard> = await ModelAPI.getList<Dashboard>({
      modelType: Dashboard,
      query: {},
      select: {
        name: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      sort: {},
    });

    return (result.data || [])
      .map((dashboard: Dashboard): string => {
        return dashboard.name || "";
      })
      .filter((name: string): boolean => {
        return name.trim().length > 0;
      });
  } catch {
    return [];
  }
};

// Where a dashboard is opened: its canvas.
export const getDashboardViewRoute: (dashboardId: ObjectID) => Route = (
  dashboardId: ObjectID,
): Route => {
  return new Route(
    RouteUtil.populateRouteParams(RouteMap[PageMap.DASHBOARD_VIEW] as Route, {
      modelId: dashboardId,
    }).toString(),
  );
};
