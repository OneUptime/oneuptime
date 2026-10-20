/*
 * Create a dashboard's template picker, over the real dashboard catalog
 * (Common/Types/Dashboard/DashboardTemplates): which templates it lists,
 * under which categories, what it opens on, what a search finds, and what a
 * picked template's details say.
 *
 * The maintainer: "The workflow templates model is a lot easier to
 * understand and use. Please make the dashboard templates model like
 * workflow templates." The dialog used to show all sixteen templates at
 * once, as equally large cards. Now it opens on a few, the rest a category
 * or a search away - which only helps if no template went missing on the
 * way, so several of these tests walk the whole catalog rather than a
 * sample of it. And what each template creates is unchanged: these tests
 * read every template's details from the same config the server builds the
 * dashboard from.
 */

import { describe, expect, test } from "@jest/globals";
import DashboardBaseComponent from "Common/Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardComponentType from "Common/Types/Dashboard/DashboardComponentType";
import {
  DashboardTemplate,
  DashboardTemplateCategories,
  DashboardTemplateCategory,
  DashboardTemplateType,
  DashboardTemplates,
  RECOMMENDED_DASHBOARD_TEMPLATE_TYPES,
  getDashboardTemplate,
  getRecommendedDashboardTemplates,
  getTemplateConfig,
} from "Common/Types/Dashboard/DashboardTemplates";
import DashboardVariable from "Common/Types/Dashboard/DashboardVariable";
import DashboardViewConfig from "Common/Types/Dashboard/DashboardViewConfig";
import {
  WordMatchKind,
  getSearchWords,
  matchWord,
} from "Common/UI/Components/Workflow/ComponentPicker/ComponentSearch";
import {
  WIDGET_CATALOG,
  WidgetCatalogCategory,
  WidgetCatalogItem,
} from "../../FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/WidgetCatalog";
import {
  DASHBOARD_PICKER_CATEGORIES,
  DASHBOARD_TEMPLATE_CATALOG,
  DASHBOARD_TEMPLATE_PICKER_RULES,
  DashboardPickerTemplate,
  DashboardTemplatePickerState,
  DashboardTemplatePreview,
  DashboardTemplatePreviewWidget,
  INITIAL_DASHBOARD_TEMPLATE_PICKER_STATE,
  findWidgetCatalogItem,
  getDashboardPickerTemplate,
  getDashboardPickerTemplates,
  getDashboardTemplateCategoryLabel,
  getDashboardTemplatePreview,
} from "../../FeatureSet/Dashboard/src/Utils/Dashboard/DashboardTemplatePickerUtil";
import {
  TemplateCollection,
  TemplateMove,
  TemplatePickerList,
  TemplatePickerViewInfo,
} from "../../FeatureSet/Dashboard/src/Utils/TemplatePicker/TemplatePickerUtil";

const RULES: typeof DASHBOARD_TEMPLATE_PICKER_RULES =
  DASHBOARD_TEMPLATE_PICKER_RULES;

// Every template but Blank, which the picker draws as Start from scratch.
const LISTED: Array<DashboardTemplate> = DashboardTemplates.filter(
  (template: DashboardTemplate): boolean => {
    return template.type !== DashboardTemplateType.Blank;
  },
);

type TypesFunction = (
  templates: Array<{ type: DashboardTemplateType }>,
) => Array<DashboardTemplateType>;

const types: TypesFunction = (
  templates: Array<{ type: DashboardTemplateType }>,
): Array<DashboardTemplateType> => {
  return templates.map(
    (template: { type: DashboardTemplateType }): DashboardTemplateType => {
      return template.type;
    },
  );
};

type SearchFunction = (search: string) => Array<DashboardTemplateType>;

// What a search lists, best first, as the picker shows it from All templates.
const searchTypes: SearchFunction = (
  search: string,
): Array<DashboardTemplateType> => {
  return types(
    RULES.getList(
      RULES.withSearch(INITIAL_DASHBOARD_TEMPLATE_PICKER_STATE, search),
    ).templates,
  );
};

type PreviewFunction = (
  type: DashboardTemplateType,
) => DashboardTemplatePreview;

const previewOf: PreviewFunction = (
  type: DashboardTemplateType,
): DashboardTemplatePreview => {
  const template: DashboardPickerTemplate | null =
    getDashboardPickerTemplate(type);

  if (!template) {
    throw new Error(`No template ${type} in the picker.`);
  }

  const preview: DashboardTemplatePreview | null =
    getDashboardTemplatePreview(template);

  if (!preview) {
    throw new Error(`No preview for ${type}.`);
  }

  return preview;
};

type LabelsFunction = (preview: DashboardTemplatePreview) => Array<string>;

const widgetLabels: LabelsFunction = (
  preview: DashboardTemplatePreview,
): Array<string> => {
  return preview.widgets.map(
    (widget: DashboardTemplatePreviewWidget): string => {
      return widget.label;
    },
  );
};

describe("what the picker lists", () => {
  test("every template of the catalog but Blank, each once, in the catalog's order", () => {
    expect(types(getDashboardPickerTemplates())).toEqual(types(LISTED));
    expect(types(getDashboardPickerTemplates())).not.toContain(
      DashboardTemplateType.Blank,
    );
    expect(LISTED.length).toBe(15);
  });

  test("a template's id is its type, which the server builds it by", () => {
    for (const template of getDashboardPickerTemplates()) {
      expect(template.id).toBe(template.type);
      expect(template).toEqual(
        expect.objectContaining(getDashboardTemplate(template.type)!),
      );
    }
  });

  test("Blank is not a template to pick: there is Start from scratch", () => {
    expect(getDashboardPickerTemplate(DashboardTemplateType.Blank)).toBeNull();
    expect(
      getDashboardPickerTemplate(DashboardTemplateType.Kubernetes)?.name,
    ).toBe("Kubernetes Dashboard");
  });

  test("the categories are the catalog's, in its order, but Get Started, which only held Blank", () => {
    expect(DASHBOARD_PICKER_CATEGORIES).toEqual([
      DashboardTemplateCategory.Monitoring,
      DashboardTemplateCategory.IncidentResponse,
      DashboardTemplateCategory.Infrastructure,
    ]);
    expect(
      DashboardTemplates.filter((template: DashboardTemplate): boolean => {
        return template.category === DashboardTemplateCategory.GetStarted;
      }).map((template: DashboardTemplate) => {
        return template.type;
      }),
    ).toEqual([DashboardTemplateType.Blank]);
    // Every other category the catalog has is offered.
    expect(
      DashboardTemplateCategories.filter(
        (category: DashboardTemplateCategory): boolean => {
          return category !== DashboardTemplateCategory.GetStarted;
        },
      ),
    ).toEqual(DASHBOARD_PICKER_CATEGORIES);
  });

  test("the category select: Recommended, the three categories by name, All templates", () => {
    expect(
      RULES.getViews().map(
        (info: TemplatePickerViewInfo<DashboardTemplateCategory>): string => {
          return info.label;
        },
      ),
    ).toEqual([
      "Recommended",
      "Monitoring & APM",
      "Incident Response",
      "Infrastructure",
      "All templates",
    ]);
  });

  test("every category has a name, its own words", () => {
    for (const category of DashboardTemplateCategories) {
      expect(getDashboardTemplateCategoryLabel(category)).toBe(category);
    }
  });

  test("All templates groups every template under its category, in the select's order", () => {
    const list: TemplatePickerList<
      DashboardPickerTemplate,
      DashboardTemplateCategory
    > = RULES.getList({
      ...INITIAL_DASHBOARD_TEMPLATE_PICKER_STATE,
      browseView: TemplateCollection.All,
    });

    expect(
      list.sections.map(
        (section: {
          title: string;
          templates: Array<DashboardPickerTemplate>;
        }) => {
          return [section.title, types(section.templates)];
        },
      ),
    ).toEqual(
      DASHBOARD_PICKER_CATEGORIES.map((category: DashboardTemplateCategory) => {
        return [
          category,
          types(
            LISTED.filter((template: DashboardTemplate): boolean => {
              return template.category === category;
            }),
          ),
        ];
      }),
    );
    expect(new Set(types(list.templates)).size).toBe(LISTED.length);
  });

  test("each category lists its own templates and nothing else", () => {
    for (const category of DASHBOARD_PICKER_CATEGORIES) {
      const listed: Array<DashboardPickerTemplate> = RULES.getList({
        ...INITIAL_DASHBOARD_TEMPLATE_PICKER_STATE,
        browseView: category,
      }).templates;

      expect(listed.length).toBeGreaterThan(0);
      expect(
        listed.every((template: DashboardPickerTemplate): boolean => {
          return template.category === category;
        }),
      ).toBe(true);
    }
  });
});

describe("what the picker opens on", () => {
  test("six recommended templates, in their order, and nothing picked", () => {
    const list: TemplatePickerList<
      DashboardPickerTemplate,
      DashboardTemplateCategory
    > = RULES.getList(INITIAL_DASHBOARD_TEMPLATE_PICKER_STATE);

    expect(types(list.templates)).toEqual([
      DashboardTemplateType.Monitor,
      DashboardTemplateType.Incident,
      DashboardTemplateType.Alert,
      DashboardTemplateType.Kubernetes,
      DashboardTemplateType.Host,
      DashboardTemplateType.Metrics,
    ]);
    expect(types(list.templates)).toEqual([
      ...RECOMMENDED_DASHBOARD_TEMPLATE_TYPES,
    ]);
    expect(list.sections).toHaveLength(1);
    expect(list.sections[0]!.title).toBe("");
    expect(
      RULES.getActiveTemplate(INITIAL_DASHBOARD_TEMPLATE_PICKER_STATE),
    ).toBeNull();
  });

  test("a handful, not the wall it was: well under half the catalog", () => {
    expect(RECOMMENDED_DASHBOARD_TEMPLATE_TYPES.length).toBeLessThanOrEqual(6);
    expect(RECOMMENDED_DASHBOARD_TEMPLATE_TYPES.length * 2).toBeLessThan(
      LISTED.length,
    );
  });

  test("each recommended template is in the catalog, once, and builds a dashboard", () => {
    expect(new Set(RECOMMENDED_DASHBOARD_TEMPLATE_TYPES).size).toBe(
      RECOMMENDED_DASHBOARD_TEMPLATE_TYPES.length,
    );
    expect(types(getRecommendedDashboardTemplates())).toEqual([
      ...RECOMMENDED_DASHBOARD_TEMPLATE_TYPES,
    ]);

    for (const type of RECOMMENDED_DASHBOARD_TEMPLATE_TYPES) {
      expect(type).not.toBe(DashboardTemplateType.Blank);
      expect(getTemplateConfig(type)?.components.length).toBeGreaterThan(0);
    }
  });

  test("the picker's state starts on Recommended, as Create a workflow's does", () => {
    expect(INITIAL_DASHBOARD_TEMPLATE_PICKER_STATE).toEqual({
      search: "",
      browseView: TemplateCollection.Recommended,
      searchView: TemplateCollection.All,
      selectedTemplateId: null,
    });
  });
});

describe("the search", () => {
  test.each(
    LISTED.map((template: DashboardTemplate) => [template.name, template.type]),
  )("typing %s finds it first", (name: string, type: DashboardTemplateType) => {
    expect(searchTypes(name)[0]).toBe(type);
  });

  test("the words people use that the name does not say", () => {
    expect(searchTypes("k8s")).toEqual([
      DashboardTemplateType.Kubernetes,
      DashboardTemplateType.KubernetesCost,
    ]);
    expect(searchTypes("servers")[0]).toBe(DashboardTemplateType.Host);
    expect(searchTypes("vsphere")).toEqual([DashboardTemplateType.VMware]);
    expect(searchTypes("pve")).toEqual([DashboardTemplateType.Proxmox]);
    expect(searchTypes("otel")).toEqual([DashboardTemplateType.Metrics]);
    // APM is the category's own name: its four templates, in the catalog's order.
    expect(searchTypes("apm")).toEqual([
      DashboardTemplateType.Monitor,
      DashboardTemplateType.Metrics,
      DashboardTemplateType.Rum,
      DashboardTemplateType.Slo,
    ]);
    expect(searchTypes("rum")).toEqual([DashboardTemplateType.Rum]);
    expect(searchTypes("san")).toEqual([DashboardTemplateType.StorageArray]);
    expect(searchTypes("switches")).toEqual([DashboardTemplateType.Network]);
  });

  test("a category's name finds its templates", () => {
    expect(new Set(searchTypes("infrastructure"))).toEqual(
      new Set(
        types(
          LISTED.filter((template: DashboardTemplate): boolean => {
            return (
              template.category === DashboardTemplateCategory.Infrastructure
            );
          }),
        ),
      ),
    );
  });

  test("a description's words find a template, a typo too", () => {
    expect(searchTypes("web vitals")[0]).toBe(DashboardTemplateType.Rum);
    expect(searchTypes("error budget")[0]).toBe(DashboardTemplateType.Slo);
    expect(searchTypes("kubernets")[0]).toBe(DashboardTemplateType.Kubernetes);
    expect(searchTypes("opencost")).toEqual([
      DashboardTemplateType.KubernetesCost,
    ]);
  });

  test("the name counts first: incident finds the Incident Dashboard before the others that mention incidents", () => {
    expect(searchTypes("incident")[0]).toBe(DashboardTemplateType.Incident);
    expect(searchTypes("alert")[0]).toBe(DashboardTemplateType.Alert);
  });

  test("a search that finds nothing finds nothing", () => {
    expect(searchTypes("zzzzzz")).toEqual([]);
  });

  test("Blank is never a result: Start from scratch is not searched for", () => {
    for (const search of ["blank", "scratch", "empty", "dashboard"]) {
      expect(searchTypes(search)).not.toContain(DashboardTemplateType.Blank);
    }
  });

  /*
   * A keyword is for a word people search by that the template's name and
   * description do not say. One that repeats them adds nothing but noise.
   */
  test("every keyword finds its template, and none repeats its name, category or description", () => {
    for (const template of LISTED) {
      const own: Array<string> = getSearchWords(
        `${template.name} ${template.category} ${template.description}`,
      );

      for (const keyword of template.keywords || []) {
        expect({
          template: template.type,
          keyword: keyword,
          found: searchTypes(keyword).includes(template.type),
        }).toEqual({ template: template.type, keyword: keyword, found: true });

        for (const word of getSearchWords(keyword)) {
          const repeated: boolean = own.some((ownWord: string): boolean => {
            const kind: WordMatchKind | null = matchWord(word, ownWord);

            return (
              kind === WordMatchKind.Exact || kind === WordMatchKind.Variant
            );
          });

          expect({ template: template.type, word: word, repeated }).toEqual({
            template: template.type,
            word: word,
            repeated: false,
          });
        }
      }
    }
  });

  test("the search reads the name, the category, the description and the keywords, the name counting most", () => {
    const kubernetes: DashboardPickerTemplate = getDashboardPickerTemplate(
      DashboardTemplateType.Kubernetes,
    )!;

    expect(
      DASHBOARD_TEMPLATE_CATALOG.getSearchFields(kubernetes).map(
        (field: { text: string; weight: number }) => {
          return field.weight;
        },
      ),
    ).toEqual([1, 0.7, 0.35, 0.35]);
    expect(
      DASHBOARD_TEMPLATE_CATALOG.getSearchFields(kubernetes)[0]!.text,
    ).toBe("Kubernetes Dashboard");
  });

  test("Enter after typing takes the best match", () => {
    const searching: DashboardTemplatePickerState = RULES.withSearch(
      INITIAL_DASHBOARD_TEMPLATE_PICKER_STATE,
      "ceph",
    );

    expect(RULES.getActiveTemplate(searching)?.type).toBe(
      DashboardTemplateType.Ceph,
    );
  });

  test("the arrow keys walk the recommended handful, top to bottom", () => {
    let state: DashboardTemplatePickerState =
      INITIAL_DASHBOARD_TEMPLATE_PICKER_STATE;
    const walked: Array<string> = [];

    for (let index: number = 0; index < 7; index++) {
      const next: string | null = RULES.getMovedTemplateId(
        state,
        TemplateMove.Next,
      );

      walked.push(next || "");
      state = RULES.withSelected(state, next || "");
    }

    expect(walked).toEqual([
      ...RECOMMENDED_DASHBOARD_TEMPLATE_TYPES,
      // It stops at the bottom.
      DashboardTemplateType.Metrics,
    ]);
  });
});

describe("a picked template's details", () => {
  type ComponentsFunction = (
    type: DashboardTemplateType,
  ) => Array<DashboardBaseComponent>;

  // The template's widgets as the dashboard shows them: top to bottom, left to right.
  const componentsOf: ComponentsFunction = (
    type: DashboardTemplateType,
  ): Array<DashboardBaseComponent> => {
    const config: DashboardViewConfig = getTemplateConfig(type)!;

    return [...config.components].sort(
      (a: DashboardBaseComponent, b: DashboardBaseComponent): number => {
        return (
          a.topInDashboardUnits - b.topInDashboardUnits ||
          a.leftInDashboardUnits - b.leftInDashboardUnits
        );
      },
    );
  };

  test.each(types(LISTED))(
    "%s: every kind of widget it adds, once, in the order the dashboard shows them, its headings left out",
    (type: DashboardTemplateType) => {
      const expected: Array<DashboardComponentType> = [];

      for (const component of componentsOf(type)) {
        if (
          component.componentType !== DashboardComponentType.Text &&
          !expected.includes(component.componentType)
        ) {
          expected.push(component.componentType);
        }
      }

      expect(
        previewOf(type).widgets.map(
          (widget: DashboardTemplatePreviewWidget) => {
            return widget.componentType;
          },
        ),
      ).toEqual(expected);
      expect(expected.length).toBeGreaterThan(0);
    },
  );

  test.each(types(LISTED))(
    "%s: each widget named and drawn as Add Widget names and draws it",
    (type: DashboardTemplateType) => {
      for (const widget of previewOf(type).widgets) {
        const item: WidgetCatalogItem | undefined = findWidgetCatalogItem(
          widget.componentType,
        );

        expect({
          type: widget.componentType,
          inCatalog: Boolean(item),
        }).toEqual({ type: widget.componentType, inCatalog: true });
        expect(widget.label).toBe(item!.label);
        expect(widget.icon).toBe(item!.icon);
      }
    },
  );

  test.each(types(LISTED))(
    "%s: its variables, as the toolbar labels their pickers, in order",
    (type: DashboardTemplateType) => {
      expect(previewOf(type).variables).toEqual(
        (getTemplateConfig(type)!.variables || []).map(
          (variable: DashboardVariable): string => {
            return variable.label || variable.name;
          },
        ),
      );
    },
  );

  test("Kubernetes: values and charts, its pods and nodes, a table and its logs; picked by cluster and namespace", () => {
    const preview: DashboardTemplatePreview = previewOf(
      DashboardTemplateType.Kubernetes,
    );

    expect(widgetLabels(preview)).toEqual([
      "Value",
      "Chart",
      "Pods",
      "Nodes",
      "Table",
      "Log Stream",
    ]);
    expect(preview.variables).toEqual(["Cluster", "Namespace"]);
  });

  test("Incident: no variables at all", () => {
    const preview: DashboardTemplatePreview = previewOf(
      DashboardTemplateType.Incident,
    );

    expect(widgetLabels(preview)).toEqual(["Value", "Chart", "Gauge", "Table"]);
    expect(preview.variables).toEqual([]);
  });

  test("SLO: its list first, then the tiles and charts of the SLO picked in the toolbar", () => {
    const preview: DashboardTemplatePreview = previewOf(
      DashboardTemplateType.Slo,
    );

    expect(widgetLabels(preview)).toEqual([
      "SLO List",
      "Value",
      "Chart",
      "SLO",
    ]);
    expect(preview.variables).toEqual(["SLO"]);
  });

  test("Network: the map first", () => {
    expect(widgetLabels(previewOf(DashboardTemplateType.Network))[0]).toBe(
      "Network Map",
    );
  });

  test("never names a Text widget: a template's text widgets are its headings", () => {
    for (const type of types(LISTED)) {
      expect(widgetLabels(previewOf(type))).not.toContain("Text");
    }
  });

  test("the preview is the template it was asked for, however often it is read", () => {
    const template: DashboardPickerTemplate = getDashboardPickerTemplate(
      DashboardTemplateType.Ceph,
    )!;
    const first: DashboardTemplatePreview =
      getDashboardTemplatePreview(template)!;
    const again: DashboardTemplatePreview = getDashboardTemplatePreview({
      ...template,
    })!;

    expect(again.widgets).toEqual(first.widgets);
    expect(again.template.type).toBe(DashboardTemplateType.Ceph);
  });

  test("every widget type a template uses is one Add Widget offers", () => {
    const offered: Set<DashboardComponentType> = new Set(
      (WIDGET_CATALOG as ReadonlyArray<WidgetCatalogCategory>).flatMap(
        (category: WidgetCatalogCategory): Array<DashboardComponentType> => {
          return category.items.map((item: WidgetCatalogItem) => {
            return item.type;
          });
        },
      ),
    );

    for (const type of types(LISTED)) {
      for (const component of componentsOf(type)) {
        expect({
          template: type,
          widget: component.componentType,
          offered: offered.has(component.componentType),
        }).toEqual({
          template: type,
          widget: component.componentType,
          offered: true,
        });
      }
    }
  });
});
