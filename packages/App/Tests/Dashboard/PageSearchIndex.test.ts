import {
  buildPageSearchCommandDescriptors,
  BuildPageSearchCommandsInput,
  canDeleteProject,
  getPageSearchIndexEntries,
  PageSearchAvailability,
  PageSearchCommandDescriptor,
  PageSearchIndexEntry,
} from "../../FeatureSet/Dashboard/src/Components/CommandPalette/DashboardCommandPaletteHelpers";
import {
  getPageSearchAreas,
  PAGE_SEARCH_AREAS,
  PageSearchAction,
  PageSearchArea,
  PageSearchGate,
  PageSearchPermission,
  PageSearchSection,
} from "../../FeatureSet/Dashboard/src/Components/CommandPalette/PageSearchIndex";
import {
  DEVELOPER_DOCS_PAGES,
  DEVELOPER_DOCS_PARENT_PAGES,
  DEVELOPER_DOCS_SECTION_TITLE,
  DeveloperDocsPageDefinition,
  DeveloperDocsParentPage,
  DeveloperDocsScope,
  getDeveloperDocsPageKey,
} from "../../FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsPages";
import PageMap from "../../FeatureSet/Dashboard/src/Utils/PageMap";
import IconProp from "Common/Types/Icon/IconProp";
import Permission from "Common/Types/Permission";
import HeldPermissionsUtil from "Common/Types/HeldPermissions";
import {
  filterPaletteCommands,
  PaletteCommandMatch,
} from "Common/UI/Components/CommandPalette/PaletteFilter";
import { PaletteCommand } from "Common/UI/Components/CommandPalette/Types";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Search (Cmd/Ctrl+K) offers every page the menus link to, from one list:
 * PageSearchIndex.ts. These pin the list itself (sound, complete for the
 * Developer pages, gated where the menus gate) and the pure step that turns
 * it into the palette's rows: names translated, breadcrumbs built, pages
 * nobody may open right now left out. That the list matches the menus is
 * checked by drawing them, in Common's PageSearchIndexCoversMenus suite.
 */

const AREAS: Array<PageSearchArea> = getPageSearchAreas();
const ENTRIES: Array<PageSearchIndexEntry> = getPageSearchIndexEntries(AREAS);
const PAGE_MAP_VALUES: Set<string> = new Set<string>(Object.values(PageMap));

const PROJECT: string = "project-a";

// A route table for the tests: every key opens "/dashboard/:projectId/<key>".
const TEMPLATE: (key: string) => string = (key: string): string => {
  if (key.startsWith("USER_PROFILE") || key === PageMap.USER_PASSKEYS) {
    return `/dashboard/user-profile/${key.toLowerCase()}`;
  }

  if (key === PageMap.USER_TWO_FACTOR_AUTH) {
    return `/dashboard/user-profile/${key.toLowerCase()}`;
  }

  return `/dashboard/:projectId/${key.toLowerCase()}`;
};

const ALL_ON: PageSearchAvailability = {
  isBillingEnabled: true,
  isMonitorGroupsEnabled: true,
  canDeleteProject: true,
};

function build(
  overrides?: Partial<BuildPageSearchCommandsInput>,
): Array<PageSearchCommandDescriptor> {
  return buildPageSearchCommandDescriptors({
    areas: AREAS,
    availability: ALL_ON,
    getRouteTemplate: (key: string): string => {
      return TEMPLATE(key);
    },
    getRoutePath: (key: string): string => {
      return TEMPLATE(key).replace(":projectId", PROJECT);
    },
    getProductTitle: (): string | undefined => {
      return undefined;
    },
    translate: (text: string): string => {
      return text;
    },
    catalog: [],
    ...overrides,
  });
}

function findPage(
  descriptors: Array<PageSearchCommandDescriptor>,
  key: string,
  title?: string,
): PageSearchCommandDescriptor | undefined {
  return descriptors.find((descriptor: PageSearchCommandDescriptor) => {
    return (
      !descriptor.isAction &&
      descriptor.routePath.endsWith(`/${key.toLowerCase()}`) &&
      (title === undefined || descriptor.title === title)
    );
  });
}

describe("the page index is sound", () => {
  test("it covers Project Settings, every product the maintainer named, and your own pages", () => {
    const areaIds: Array<string> = AREAS.map((area: PageSearchArea) => {
      return area.id;
    });

    expect(areaIds).toEqual(
      expect.arrayContaining([
        "project-settings",
        "incidents",
        "alerts",
        "on-call-duty",
        "monitors",
        "status-pages",
        "user-settings",
        "user-profile",
        "users",
        "teams",
      ]),
    );
    // Project Settings first: it wins ties ("slack", "notification settings").
    expect(areaIds[0]).toBe("project-settings");
    expect(ENTRIES.length).toBeGreaterThanOrEqual(380);
  });

  test("area ids are unique, and every area has a title, an icon, a colour and pages", () => {
    const seen: Set<string> = new Set<string>();

    for (const area of AREAS) {
      expect(seen.has(area.id)).toBe(false);
      seen.add(area.id);
      expect(area.id).toMatch(/^[a-z0-9-]+$/);
      expect(area.title.trim().length).toBeGreaterThan(0);
      expect(Object.values(IconProp)).toContain(area.icon);
      expect(area.sections.length).toBeGreaterThan(0);

      for (const section of area.sections) {
        expect(section.pages.length).toBeGreaterThan(0);

        if (section.title !== undefined) {
          expect(section.title.trim()).toBe(section.title);
          expect(section.title.length).toBeGreaterThan(0);
        }
      }
    }
  });

  test("every colour is one the palette paints (PaletteRow's icon colours)", () => {
    const paletteRow: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "Common",
        "UI",
        "Components",
        "CommandPalette",
        "PaletteRow.tsx",
      ),
      "utf8",
    );

    for (const area of AREAS) {
      expect({
        area: area.id,
        painted: new RegExp(`\\b${area.iconColor}: \\{`).test(paletteRow),
      }).toEqual({ area: area.id, painted: true });
    }
  });

  test("every page is a PageMap page or a generated Developer page", () => {
    const developerKeys: Set<string> = new Set<string>(
      DEVELOPER_DOCS_PARENT_PAGES.flatMap(
        (parent: DeveloperDocsParentPage): Array<string> => {
          return DEVELOPER_DOCS_PAGES.map(
            (page: DeveloperDocsPageDefinition): string => {
              return getDeveloperDocsPageKey(parent.pageKey, page.type);
            },
          );
        },
      ),
    );

    for (const entry of ENTRIES) {
      expect({
        page: entry.page.page,
        known:
          PAGE_MAP_VALUES.has(entry.page.page) ||
          developerKeys.has(entry.page.page),
      }).toEqual({ page: entry.page.page, known: true });
    }
  });

  test("no page is listed twice (the same page, opened the same way)", () => {
    const seen: Map<string, string> = new Map();

    for (const entry of ENTRIES) {
      const key: string = `${entry.page.page}${entry.page.queryString || ""}`;
      expect({ key, firstIn: seen.get(key) }).toEqual({
        key,
        firstIn: undefined,
      });
      seen.set(key, entry.area.id);
    }
  });

  test("titles are trimmed and non-empty; query strings start with '?'", () => {
    for (const entry of ENTRIES) {
      expect(entry.page.title.trim()).toBe(entry.page.title);
      expect(entry.page.title.length).toBeGreaterThan(0);

      if (entry.page.queryString !== undefined) {
        expect(entry.page.queryString.startsWith("?")).toBe(true);
      }
    }
  });

  test("keywords are lowercase, trimmed, non-empty, not repeated, and never the title itself", () => {
    const checkKeywords: (
      owner: string,
      title: string,
      keywords: Array<string>,
    ) => void = (
      owner: string,
      title: string,
      keywords: Array<string>,
    ): void => {
      expect({
        owner,
        unique: new Set(keywords).size === keywords.length,
      }).toEqual({
        owner,
        unique: true,
      });

      for (const keyword of keywords) {
        expect({ owner, keyword }).toEqual({
          owner,
          keyword: keyword.trim().toLowerCase(),
        });
        expect(keyword.length).toBeGreaterThan(0);
        expect({ owner, isTitle: keyword === title.toLowerCase() }).toEqual({
          owner,
          isTitle: false,
        });
      }
    };

    for (const entry of ENTRIES) {
      checkKeywords(
        `${entry.area.id} > ${entry.page.title}`,
        entry.page.title,
        entry.page.keywords || [],
      );

      for (const action of entry.page.actions || []) {
        checkKeywords(
          `${entry.area.id} > ${action.title}`,
          action.title,
          action.keywords || [],
        );
      }
    }
  });

  test("action ids are unique, and Delete Project is offered only to people who may delete it", () => {
    const actions: Array<PageSearchAction> = ENTRIES.flatMap(
      (entry: PageSearchIndexEntry): Array<PageSearchAction> => {
        return entry.page.actions || [];
      },
    );

    expect(
      new Set(
        actions.map((action: PageSearchAction) => {
          return action.id;
        }),
      ).size,
    ).toBe(actions.length);

    const deleteProject: PageSearchAction | undefined = actions.find(
      (action: PageSearchAction) => {
        return action.id === "delete-project";
      },
    );

    expect(deleteProject).toMatchObject({
      title: "Delete Project",
      permission: PageSearchPermission.DeleteProject,
    });

    // It is done on the Danger Zone page.
    const owner: PageSearchIndexEntry | undefined = ENTRIES.find(
      (entry: PageSearchIndexEntry) => {
        return (entry.page.actions || []).includes(deleteProject!);
      },
    );
    expect(owner?.page.page).toBe(PageMap.SETTINGS_DANGERZONE);
  });

  test("only billing pages wait for billing, and only Monitor Groups for its flag", () => {
    const gated: Array<string> = [];

    for (const area of AREAS) {
      for (const section of area.sections) {
        for (const page of section.pages) {
          const gate: PageSearchGate | undefined = page.gate || section.gate;

          if (gate) {
            gated.push(`${gate}:${page.page}`);
          }
        }
      }
    }

    expect(gated.sort()).toEqual(
      [
        `${PageSearchGate.Billing}:${PageMap.SETTINGS_AI_CREDITS}`,
        `${PageSearchGate.Billing}:${PageMap.SETTINGS_BILLING}`,
        `${PageSearchGate.Billing}:${PageMap.SETTINGS_BILLING_INVOICES}`,
        `${PageSearchGate.Billing}:${PageMap.SETTINGS_USAGE_HISTORY}`,
        `${PageSearchGate.MonitorGroups}:${PageMap.MONITOR_GROUPS}`,
      ].sort(),
    );
  });
});

describe("the Developer pages come from the list their menus are drawn from", () => {
  test("every area with a resource list has its Terraform, API and AI Assistants pages", () => {
    const listParents: Array<DeveloperDocsParentPage> =
      DEVELOPER_DOCS_PARENT_PAGES.filter((parent: DeveloperDocsParentPage) => {
        return parent.scope === DeveloperDocsScope.List;
      });

    for (const parent of listParents) {
      const area: PageSearchArea | undefined = AREAS.find(
        (candidate: PageSearchArea) => {
          return candidate.sections.some((section: PageSearchSection) => {
            return section.pages.some((page: { page: string }) => {
              return page.page === parent.pageKey;
            });
          });
        },
      );

      // Every resource list Search offers carries its Developer pages.
      expect({ parent: parent.pageKey, inIndex: Boolean(area) }).toEqual({
        parent: parent.pageKey,
        inIndex: true,
      });

      const developer: PageSearchSection | undefined = area!.sections.find(
        (section: PageSearchSection) => {
          return section.title === DEVELOPER_DOCS_SECTION_TITLE;
        },
      );

      expect(
        developer?.pages.map((page: { page: string; title: string }) => {
          return [page.page, page.title];
        }),
      ).toEqual(
        expect.arrayContaining(
          DEVELOPER_DOCS_PAGES.map(
            (definition: DeveloperDocsPageDefinition) => {
              return [
                getDeveloperDocsPageKey(parent.pageKey, definition.type),
                definition.title,
              ];
            },
          ),
        ),
      );
    }
  });

  test("the written list has no Developer section of its own: it is generated", () => {
    for (const area of PAGE_SEARCH_AREAS) {
      for (const section of area.sections) {
        expect(section.title).not.toBe(DEVELOPER_DOCS_SECTION_TITLE);
      }
    }
  });
});

describe("buildPageSearchCommandDescriptors", () => {
  test("a page reads the way its menu does: title, and the section it sits in", () => {
    const apiKeys: PageSearchCommandDescriptor | undefined = findPage(
      build(),
      PageMap.SETTINGS_APIKEYS,
    );

    expect(apiKeys).toMatchObject({
      id: "page-dashboard-projectid-settings-apikeys",
      title: "API Keys",
      breadcrumb: ["Project Settings", "Advanced"],
      breadcrumbKeywords: ["Project Settings", "Advanced"],
      routePath: "/dashboard/project-a/settings_apikeys",
      areaId: "project-settings",
      isAction: false,
      iconColor: "slate",
      icon: IconProp.Terminal,
      titleAliases: [],
    });
  });

  test("a section that repeats the page's or the area's name is left out of the breadcrumb", () => {
    const descriptors: Array<PageSearchCommandDescriptor> = build();

    // "Danger Zone" in the Danger Zone section.
    expect(
      findPage(descriptors, PageMap.SETTINGS_DANGERZONE)?.breadcrumb,
    ).toEqual(["Project Settings"]);
    // "All Monitors" in the Monitors section of Monitors.
    expect(findPage(descriptors, PageMap.MONITORS)?.breadcrumb).toEqual([
      "Monitors",
    ]);
    // A product's tabs have no section.
    expect(findPage(descriptors, PageMap.LOGS_INSIGHTS)?.breadcrumb).toEqual([
      "Logs",
    ]);
  });

  test("the breadcrumb starts with the products menu's name for the product", () => {
    const descriptors: Array<PageSearchCommandDescriptor> = build({
      getProductTitle: (routePath: string): string | undefined => {
        return routePath === "/dashboard/project-a/settings"
          ? "Projekteinstellungen"
          : undefined;
      },
    });

    expect(findPage(descriptors, PageMap.SETTINGS_APIKEYS)?.breadcrumb[0]).toBe(
      "Projekteinstellungen",
    );
    // Its English name is still searched.
    expect(
      findPage(descriptors, PageMap.SETTINGS_APIKEYS)?.breadcrumbKeywords[0],
    ).toBe("Project Settings");
  });

  test("names are translated; the English title becomes a title alias", () => {
    const german: Record<string, string> = {
      "API Keys": "API-Schlüssel",
      Advanced: "Erweitert",
      "Project Settings": "Projekteinstellungen",
      "Delete Project": "Projekt löschen",
    };

    const descriptors: Array<PageSearchCommandDescriptor> = build({
      translate: (text: string): string => {
        return german[text] || text;
      },
    });

    expect(findPage(descriptors, PageMap.SETTINGS_APIKEYS)).toMatchObject({
      title: "API-Schlüssel",
      titleAliases: ["API Keys"],
      breadcrumb: ["Projekteinstellungen", "Erweitert"],
      breadcrumbKeywords: ["Project Settings", "Advanced"],
    });

    const deleteProject: PageSearchCommandDescriptor | undefined =
      descriptors.find((descriptor: PageSearchCommandDescriptor) => {
        return descriptor.id === "page-action-delete-project";
      });

    expect(deleteProject).toMatchObject({
      title: "Projekt löschen",
      titleAliases: ["Delete Project"],
      isAction: true,
    });
  });

  test("an action names the page it is done on, and opens that page", () => {
    const deleteProject: PageSearchCommandDescriptor | undefined = build().find(
      (descriptor: PageSearchCommandDescriptor) => {
        return descriptor.id === "page-action-delete-project";
      },
    );

    expect(deleteProject).toMatchObject({
      title: "Delete Project",
      breadcrumb: ["Project Settings", "Danger Zone"],
      routePath: "/dashboard/project-a/settings_dangerzone",
      isAction: true,
      icon: IconProp.Trash,
    });
  });

  test("Delete Project is left out for someone who may not delete the project", () => {
    const descriptors: Array<PageSearchCommandDescriptor> = build({
      availability: { ...ALL_ON, canDeleteProject: false },
    });

    expect(
      descriptors.some((descriptor: PageSearchCommandDescriptor) => {
        return descriptor.id === "page-action-delete-project";
      }),
    ).toBe(false);
    // The page is still offered: it says why the button is locked.
    expect(findPage(descriptors, PageMap.SETTINGS_DANGERZONE)).toBeDefined();
  });

  test("billing pages wait for billing; Monitor Groups for its flag", () => {
    const off: Array<PageSearchCommandDescriptor> = build({
      availability: {
        isBillingEnabled: false,
        isMonitorGroupsEnabled: false,
        canDeleteProject: true,
      },
    });

    for (const key of [
      PageMap.SETTINGS_BILLING,
      PageMap.SETTINGS_USAGE_HISTORY,
      PageMap.SETTINGS_BILLING_INVOICES,
      PageMap.SETTINGS_AI_CREDITS,
      PageMap.MONITOR_GROUPS,
    ]) {
      expect({ key, offered: Boolean(findPage(off, key)) }).toEqual({
        key,
        offered: false,
      });
      expect({ key, offered: Boolean(findPage(build(), key)) }).toEqual({
        key,
        offered: true,
      });
    }

    // Everything else in Project Settings is offered either way.
    expect(findPage(off, PageMap.SETTINGS_APIKEYS)).toBeDefined();
    expect(findPage(off, PageMap.SETTINGS_SSO)).toBeDefined();
  });

  test("without a project only the pages outside a project are offered", () => {
    const descriptors: Array<PageSearchCommandDescriptor> = build({
      getRoutePath: (key: string): string => {
        return TEMPLATE(key);
      },
    });

    expect(descriptors.length).toBeGreaterThan(0);

    for (const descriptor of descriptors) {
      expect(descriptor.routePath).not.toContain(":");
      expect(descriptor.areaId).toBe("user-profile");
    }
  });

  test("a page the route table does not know is skipped, never offered broken", () => {
    const descriptors: Array<PageSearchCommandDescriptor> = build({
      getRouteTemplate: (key: string): string | undefined => {
        return key === PageMap.SETTINGS_APIKEYS ? undefined : TEMPLATE(key);
      },
    });

    expect(findPage(descriptors, PageMap.SETTINGS_APIKEYS)).toBeUndefined();
    expect(findPage(descriptors, PageMap.SETTINGS_SSO)).toBeDefined();
  });

  test("a page that is a product the palette lists, under the same name, is not listed twice", () => {
    const withoutCatalog: Array<PageSearchCommandDescriptor> = build();
    const withCatalog: Array<PageSearchCommandDescriptor> = build({
      catalog: [
        { routePath: "/dashboard/project-a/workflows", title: "Workflows" },
        // Same place, other name: the page stays ("On-Call Policies").
        {
          routePath: "/dashboard/project-a/on_call_duty_policies",
          title: "On-Call Duty",
        },
      ],
    });

    expect(findPage(withoutCatalog, PageMap.WORKFLOWS)).toBeDefined();
    expect(findPage(withCatalog, PageMap.WORKFLOWS)).toBeUndefined();
    expect(
      findPage(withCatalog, PageMap.ON_CALL_DUTY_POLICIES, "On-Call Policies"),
    ).toBeDefined();
    expect(withCatalog.length).toBe(withoutCatalog.length - 1);
  });

  test("ids come from the route template and query, so recents survive a project switch", () => {
    const inA: Array<PageSearchCommandDescriptor> = build();
    const inB: Array<PageSearchCommandDescriptor> = build({
      getRoutePath: (key: string): string => {
        return TEMPLATE(key).replace(":projectId", "project-b");
      },
    });

    expect(
      inA.map((descriptor: PageSearchCommandDescriptor) => {
        return descriptor.id;
      }),
    ).toEqual(
      inB.map((descriptor: PageSearchCommandDescriptor) => {
        return descriptor.id;
      }),
    );

    // Unique, and DOM-safe (they are test ids and option ids).
    const ids: Array<string> = inA.map(
      (descriptor: PageSearchCommandDescriptor) => {
        return descriptor.id;
      },
    );
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^page(-action)?-[a-z0-9-]+$/);
    }
  });

  test("the inventory lists a menu opens with a query keep it, and get ids of their own", () => {
    const descriptors: Array<PageSearchCommandDescriptor> = build();
    const goneQuiet: PageSearchCommandDescriptor | undefined = descriptors.find(
      (descriptor: PageSearchCommandDescriptor) => {
        return descriptor.title === "Gone Quiet";
      },
    );

    expect(goneQuiet?.routePath).toBe(
      "/dashboard/project-a/inventory_items?source=discovered&stale=true",
    );
    expect(goneQuiet?.id).toBe(
      "page-dashboard-projectid-inventory-items-source-discovered-stale-true",
    );
  });
});

describe("canDeleteProject (the Danger Zone's own rule, mirrored)", () => {
  test("a project owner may", () => {
    expect(
      canDeleteProject({
        held: HeldPermissionsUtil.fromPermissions([Permission.ProjectOwner]),
        isMasterAdmin: false,
      }),
    ).toBe(true);
  });

  test("the Delete Project permission is enough", () => {
    expect(
      canDeleteProject({
        held: HeldPermissionsUtil.fromPermissions([Permission.DeleteProject]),
        isMasterAdmin: false,
      }),
    ).toBe(true);
  });

  test("a member may not", () => {
    expect(
      canDeleteProject({
        held: HeldPermissionsUtil.fromPermissions([
          Permission.ProjectMember,
          Permission.ProjectAdmin,
        ]),
        isMasterAdmin: false,
      }),
    ).toBe(false);
  });

  test("a missing permission snapshot hides it; a master admin always may", () => {
    expect(canDeleteProject({ held: null, isMasterAdmin: false })).toBe(false);
    expect(canDeleteProject({ held: null, isMasterAdmin: true })).toBe(true);
  });
});

describe("what the maintainer asked for, through the real search", () => {
  const pages: Array<PaletteCommand> = build().map(
    (descriptor: PageSearchCommandDescriptor): PaletteCommand => {
      return {
        id: descriptor.id,
        title: descriptor.title,
        titleAliases: descriptor.titleAliases,
        keywords: descriptor.keywords,
        breadcrumb: descriptor.breadcrumb,
        breadcrumbKeywords: descriptor.breadcrumbKeywords,
        category: descriptor.isAction ? "Actions" : "Pages",
        isSearchOnly: true,
        onSelect: (): void => {},
      };
    },
  );

  const first: (query: string) => string = (query: string): string => {
    const matches: Array<PaletteCommandMatch> = filterPaletteCommands(
      pages,
      query,
    );
    return matches[0] ? matches[0].command.title : "";
  };

  test.each([
    ["api keys", "API Keys"],
    ["API key", "API Keys"],
    ["delete project", "Delete Project"],
    ["on-call schedules", "On-Call Schedules"],
    ["on call policy", "On-Call Policies"],
    ["escalation", "On-Call Policies"],
    ["pager", "On-Call Policies"],
    ["rota", "On-Call Schedules"],
    ["billing", "Billing"],
    ["single sign-on", "SSO"],
    ["2fa", "Two-factor authentication"],
    ["incident roles", "Incident Roles"],
    ["mttr", "Measurements"],
  ])('"%s" opens %s first', (query: string, title: string) => {
    expect(first(query)).toBe(title);
  });

  test("every word must be found: a word nothing holds finds nothing", () => {
    expect(first("slack")).toBe("Slack");
    expect(first("slack webhook")).toBe("");
  });
});
