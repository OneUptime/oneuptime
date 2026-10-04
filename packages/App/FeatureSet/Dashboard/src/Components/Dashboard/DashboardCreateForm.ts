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
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { getUniqueName } from "Common/UI/Components/Forms/Utils/UniqueName";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * CREATE A DASHBOARD: PICK A TEMPLATE, AND THE REST IS FILLED IN.
 *
 * Create Dashboard opens the template picker (Blank Dashboard and one card
 * per template, Common/Types/Dashboard/DashboardTemplates). Picking a card
 * used to open a second dialog that asked for a Name and a Description from
 * scratch - right after the user had said "Kubernetes Dashboard" - and,
 * once created, left them on the list to find the new row and open it to
 * see what the template had built. Now:
 *
 *   - the Name is filled in with the template's name, made unique in the
 *     project ("Kubernetes Dashboard", then "Kubernetes Dashboard 2"),
 *     because a dashboard's name is unique per project
 *     (@UniqueColumnBy("projectId")) and the server would refuse a copy.
 *     Blank Dashboard leaves the Name empty: only its creator knows what it
 *     is going to show. The names compared are every dashboard of the
 *     project the user can read, archived ones too - the server's check
 *     counts those as well;
 *   - the Description waits under the folded More fields section (the
 *     dashboard's Overview edits it too), so the form is one Name and one
 *     click on Create Dashboard;
 *   - Create opens the new dashboard (DashboardsPage's onCreateSuccess): a
 *     template's widgets at once, or a blank dashboard's empty canvas with
 *     its Add Widget button (Canvas/BlankCanvas).
 *
 * The server's unique check still decides. A name taken by someone else
 * between the picker and Create (or by a dashboard this user cannot read)
 * is refused with the server's own message, in the form, where the name can
 * be changed - and Create then still builds the picked template.
 *
 * React-free, so tests can read the fields and the naming rule without
 * rendering the page.
 */

/**
 * The create form: the Name, then the Description folded under More
 * fields. Two rows, no steps.
 */
export const getDashboardCreateFormFields: () => Array<
  ModelField<Dashboard>
> = (): Array<ModelField<Dashboard>> => {
  const moreFields: FormFieldCollapsibleSection<Dashboard> =
    getAdvancedFormSection<Dashboard>();

  return [
    {
      field: {
        name: true,
      },
      title: "Name",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      // Seen on a Blank dashboard only: a template's name is filled in.
      placeholder: "Production API Health",
      validation: {
        minLength: 2,
      },
    },
    {
      field: {
        description: true,
      },
      title: "Description",
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      placeholder: "Description",
      collapsibleSection: moreFields,
    },
  ];
};

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

export type GetDashboardCreateInitialValuesFunction = (data: {
  templateType: DashboardTemplateType;
  existingNames: Iterable<string | null | undefined>;
}) => FormValues<Dashboard>;

/**
 * What the create form starts with once a template is picked: its name, or
 * nothing at all for Blank Dashboard (so the Name shows its placeholder).
 */
export const getDashboardCreateInitialValues: GetDashboardCreateInitialValuesFunction =
  (data: {
    templateType: DashboardTemplateType;
    existingNames: Iterable<string | null | undefined>;
  }): FormValues<Dashboard> => {
    const name: string = getDashboardNameForTemplate(data);

    if (!name) {
      return {};
    }

    return { name };
  };

export type AddDashboardTemplateToMiscDataFunction = (data: {
  // The create request's misc data, as ModelForm hands it to onBeforeCreate.
  miscDataProps: JSONObject;
  // The card picked; null once the form is closed.
  templateType: DashboardTemplateType | null | undefined;
}) => JSONObject;

/**
 * Tells the server which template to build the new dashboard from, in the
 * create request's misc data. Blank, or nothing picked, adds nothing: the
 * dashboard starts empty.
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
 * ones included. A lookup that fails hands back no names: the form then
 * fills in the template's own name, and the server's check still has the
 * last word.
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
