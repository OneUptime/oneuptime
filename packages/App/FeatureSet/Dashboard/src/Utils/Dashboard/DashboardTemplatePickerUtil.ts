/*
 * The dashboard template picker's rules: the shared template picker's
 * (Utils/TemplatePicker/TemplatePickerUtil) bound to the dashboard catalog
 * (Common/Types/Dashboard/DashboardTemplates), and what a picked dashboard
 * template's details say. No React here, so every rule can be tested on its
 * own.
 *
 * Create from Template used to be a dialog of sixteen equally large cards,
 * each with three or four lines of description, in four labelled groups that
 * ran past the bottom of the dialog, and a click on any card went straight
 * on. The maintainer: "The workflow templates model is a lot easier to
 * understand and use. Please make the dashboard templates model like
 * workflow templates." So Create a dashboard is drawn the way Create a
 * workflow is: Start from scratch first (Blank Dashboard, as a template,
 * is gone from the list), a few recommended templates as one-line rows, a
 * search box and a category select, and a template's details - the widgets
 * it adds and the variables it brings - only once it is picked. What each
 * template creates is unchanged: the server builds it from the same
 * catalog (DashboardService, DASHBOARD_TEMPLATE_MISC_DATA_KEY).
 */

import DashboardBaseComponent from "Common/Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardComponentType from "Common/Types/Dashboard/DashboardComponentType";
import {
  DashboardTemplate,
  DashboardTemplateCategories,
  DashboardTemplateCategory,
  DashboardTemplateType,
  DashboardTemplates,
  getRecommendedDashboardTemplates,
  getTemplateConfig,
} from "Common/Types/Dashboard/DashboardTemplates";
import DashboardVariable from "Common/Types/Dashboard/DashboardVariable";
import DashboardViewConfig from "Common/Types/Dashboard/DashboardViewConfig";
import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  WIDGET_CATALOG,
  WidgetCatalogCategory,
  WidgetCatalogItem,
} from "../../Components/Dashboard/Toolbar/WidgetCatalog";
import {
  INITIAL_TEMPLATE_PICKER_STATE,
  TemplateCatalog,
  TemplatePickerRules,
  TemplatePickerState,
  TemplatePickerView,
  createTemplatePickerRules,
} from "../TemplatePicker/TemplatePickerUtil";

/*
 * A dashboard template as the picker lists it: its catalog entry, with its
 * type as the id the picker picks it by.
 */
export interface DashboardPickerTemplate extends DashboardTemplate {
  id: DashboardTemplateType;
}

type ToPickerTemplateFunction = (
  template: DashboardTemplate,
) => DashboardPickerTemplate;

const toPickerTemplate: ToPickerTemplateFunction = (
  template: DashboardTemplate,
): DashboardPickerTemplate => {
  return { ...template, id: template.type };
};

/*
 * Blank Dashboard is not a template to pick: the picker draws it as Start
 * from scratch, first and on its own, as Create a workflow does. So it is
 * not listed, and nor is the Get Started category it was the only entry
 * of.
 */
export const DASHBOARD_PICKER_CATEGORIES: ReadonlyArray<DashboardTemplateCategory> =
  DashboardTemplateCategories.filter(
    (category: DashboardTemplateCategory): boolean => {
      return category !== DashboardTemplateCategory.GetStarted;
    },
  );

export type GetDashboardPickerTemplatesFunction =
  () => Array<DashboardPickerTemplate>;

/** Every template the picker lists, in the catalog's order: all but Blank. */
export const getDashboardPickerTemplates: GetDashboardPickerTemplatesFunction =
  (): Array<DashboardPickerTemplate> => {
    return DashboardTemplates.filter((template: DashboardTemplate): boolean => {
      return template.type !== DashboardTemplateType.Blank;
    }).map(toPickerTemplate);
  };

export type GetDashboardPickerTemplateFunction = (
  type: DashboardTemplateType,
) => DashboardPickerTemplate | null;

/** A template the picker lists, by its type. Null for Blank, which it does not list. */
export const getDashboardPickerTemplate: GetDashboardPickerTemplateFunction = (
  type: DashboardTemplateType,
): DashboardPickerTemplate | null => {
  return (
    getDashboardPickerTemplates().find(
      (template: DashboardPickerTemplate): boolean => {
        return template.type === type;
      },
    ) || null
  );
};

/*
 * The name the picker shows for each category: in its select, and over the
 * category's rows in All templates. The enum's values are the names, but a
 * map the i18n extractor can read (translationKey) is what puts them in
 * every locale; and a Record, so a category added without a name fails to
 * compile rather than showing up untranslated.
 */
const DASHBOARD_CATEGORY_LABELS: Record<DashboardTemplateCategory, string> = {
  [DashboardTemplateCategory.GetStarted]: translationKey("Get Started"),
  [DashboardTemplateCategory.Monitoring]: translationKey("Monitoring & APM"),
  [DashboardTemplateCategory.IncidentResponse]:
    translationKey("Incident Response"),
  [DashboardTemplateCategory.Infrastructure]: translationKey("Infrastructure"),
};

export type GetDashboardTemplateCategoryLabelFunction = (
  category: DashboardTemplateCategory,
) => string;

/** A category's name, in English: the picker looks it up as it draws it. */
export const getDashboardTemplateCategoryLabel: GetDashboardTemplateCategoryLabelFunction =
  (category: DashboardTemplateCategory): string => {
    return DASHBOARD_CATEGORY_LABELS[category];
  };

/*
 * What a search reads, and how much a match in each place is worth: the
 * name, then the category, then the description, as in Create a workflow.
 * The words people search a template by that neither says ("k8s",
 * "servers") count as much as its description.
 */
const NAME_WEIGHT: number = 1;
const CATEGORY_WEIGHT: number = 0.7;
const DESCRIPTION_WEIGHT: number = 0.35;
const KEYWORDS_WEIGHT: number = 0.35;

/** The dashboard catalog, as the shared picker reads it. */
export const DASHBOARD_TEMPLATE_CATALOG: TemplateCatalog<
  DashboardPickerTemplate,
  DashboardTemplateCategory
> = {
  getTemplates: getDashboardPickerTemplates,
  getRecommendedTemplates: (): Array<DashboardPickerTemplate> => {
    return getRecommendedDashboardTemplates().map(toPickerTemplate);
  },
  categories: DASHBOARD_PICKER_CATEGORIES,
  getCategoryLabel: getDashboardTemplateCategoryLabel,
  getCategory: (
    template: DashboardPickerTemplate,
  ): DashboardTemplateCategory => {
    return template.category;
  },
  getSearchFields: (template: DashboardPickerTemplate) => {
    return [
      { text: template.name, weight: NAME_WEIGHT },
      { text: template.category, weight: CATEGORY_WEIGHT },
      { text: template.description, weight: DESCRIPTION_WEIGHT },
      { text: (template.keywords || []).join(" "), weight: KEYWORDS_WEIGHT },
    ];
  },
};

/** The shared picker's rules over the dashboard catalog. */
export const DASHBOARD_TEMPLATE_PICKER_RULES: TemplatePickerRules<
  DashboardPickerTemplate,
  DashboardTemplateCategory
> = createTemplatePickerRules(DASHBOARD_TEMPLATE_CATALOG);

export type DashboardTemplatePickerView =
  TemplatePickerView<DashboardTemplateCategory>;

/*
 * Everything the picker remembers. It lives in the wizard, so Back from the
 * Name step finds it as it was left.
 */
export type DashboardTemplatePickerState =
  TemplatePickerState<DashboardTemplateCategory>;

export const INITIAL_DASHBOARD_TEMPLATE_PICKER_STATE: DashboardTemplatePickerState =
  { ...INITIAL_TEMPLATE_PICKER_STATE };

/* ------------------------------ Details ----------------------------- */

/*
 * What a picked dashboard template's row opens to show, before anything is
 * created: the kinds of widget it adds, as Add Widget names them, and the
 * variables it brings - the pickers in the dashboard's toolbar that narrow
 * it to one cluster, host or service. Named "preview" because it is shown
 * before anything is created. Read from the template's own config, so it is
 * what the dashboard will hold.
 */

export interface DashboardTemplatePreviewWidget {
  componentType: DashboardComponentType;
  /** The widget's name, as Add Widget shows it. */
  label: string;
  icon: IconProp;
}

export interface DashboardTemplatePreview {
  template: DashboardPickerTemplate;
  /*
   * Every kind of widget on it, once each, in the order a reader meets them:
   * top to bottom, then left to right. Text is left out: a template's text
   * widgets are its section headings, not something it shows.
   */
  widgets: Array<DashboardTemplatePreviewWidget>;
  /** The variables' names, as the toolbar labels their pickers, in order. */
  variables: Array<string>;
}

export type FindWidgetCatalogItemFunction = (
  componentType: DashboardComponentType,
) => WidgetCatalogItem | undefined;

/** A widget type's entry in Add Widget's catalog, which names and draws it. */
export const findWidgetCatalogItem: FindWidgetCatalogItemFunction = (
  componentType: DashboardComponentType,
): WidgetCatalogItem | undefined => {
  for (const category of WIDGET_CATALOG as ReadonlyArray<WidgetCatalogCategory>) {
    const item: WidgetCatalogItem | undefined = category.items.find(
      (candidate: WidgetCatalogItem): boolean => {
        return candidate.type === componentType;
      },
    );

    if (item) {
      return item;
    }
  }

  return undefined;
};

// Every capital that starts a word inside a widget type's name.
const INNER_CAPITAL: RegExp = /(?<=[a-z])(?=[A-Z])/g;

type ToWidgetFunction = (
  componentType: DashboardComponentType,
) => DashboardTemplatePreviewWidget;

const toWidget: ToWidgetFunction = (
  componentType: DashboardComponentType,
): DashboardTemplatePreviewWidget => {
  const item: WidgetCatalogItem | undefined =
    findWidgetCatalogItem(componentType);

  if (item) {
    return { componentType: componentType, label: item.label, icon: item.icon };
  }

  // Not expected - every template's widgets are checked against the catalog.
  return {
    componentType: componentType,
    label: String(componentType).replace(INNER_CAPITAL, " "),
    icon: IconProp.Cube,
  };
};

type ReadingOrderFunction = (
  a: DashboardBaseComponent,
  b: DashboardBaseComponent,
) => number;

// Top to bottom, then left to right: the order a reader meets the widgets.
const inReadingOrder: ReadingOrderFunction = (
  a: DashboardBaseComponent,
  b: DashboardBaseComponent,
): number => {
  return (
    a.topInDashboardUnits - b.topInDashboardUnits ||
    a.leftInDashboardUnits - b.leftInDashboardUnits
  );
};

// A template's config does not change, and building one walks every widget.
const previewByType: Map<DashboardTemplateType, DashboardTemplatePreview> =
  new Map();

export type GetDashboardTemplatePreviewFunction = (
  template: DashboardPickerTemplate,
) => DashboardTemplatePreview | null;

/** Everything a picked template's details show, before anything is created. */
export const getDashboardTemplatePreview: GetDashboardTemplatePreviewFunction =
  (template: DashboardPickerTemplate): DashboardTemplatePreview | null => {
    const known: DashboardTemplatePreview | undefined = previewByType.get(
      template.type,
    );

    if (known) {
      return { ...known, template: template };
    }

    const config: DashboardViewConfig | null = getTemplateConfig(template.type);

    if (!config) {
      return null;
    }

    const shown: Array<DashboardBaseComponent> = [...config.components]
      .sort(inReadingOrder)
      .filter((component: DashboardBaseComponent): boolean => {
        return component.componentType !== DashboardComponentType.Text;
      });

    const kinds: Array<DashboardComponentType> = [];

    for (const component of shown) {
      if (!kinds.includes(component.componentType)) {
        kinds.push(component.componentType);
      }
    }

    const preview: DashboardTemplatePreview = {
      template: template,
      widgets: kinds.map(toWidget),
      variables: (config.variables || []).map(
        (variable: DashboardVariable): string => {
          return variable.label || variable.name;
        },
      ),
    };

    previewByType.set(template.type, preview);

    return preview;
  };
