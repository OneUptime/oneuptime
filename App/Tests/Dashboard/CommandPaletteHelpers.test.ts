import {
  buildEntitySearchQuery,
  buildEntitySearchSelect,
  buildEntitySearchSort,
  buildNavigationCommandDescriptors,
  computeCreateActionGates,
  getEntitySearchSpecs,
  getVisibleActionIds,
  isRoutePathNavigable,
  PALETTE_ENTITY_SEARCH_LIMIT,
  PALETTE_RECENTS_STORAGE_KEY,
  PaletteActionId,
  PaletteCreateActionGates,
  PaletteEntitySearchSpec,
  PaletteNavigationCatalogEntry,
  PaletteNavigationCommandDescriptor,
  slugifyPaletteCommandId,
} from "../../FeatureSet/Dashboard/src/Components/CommandPalette/DashboardCommandPaletteHelpers";
import PageMap from "../../FeatureSet/Dashboard/src/Utils/PageMap";
import MultiSearch from "Common/Types/BaseDatabase/MultiSearch";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { JSONObject, ObjectType } from "Common/Types/JSON";
import Permission from "Common/Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * The command palette's decision logic lives in a React-free helper module so
 * it can be pinned here, in the plain-node App suite: which catalog entries
 * become commands, which actions a permission snapshot unlocks, and what the
 * entity-search requests look like on the wire.
 */

function entry(
  overrides: Partial<PaletteNavigationCatalogEntry>,
): PaletteNavigationCatalogEntry {
  return {
    title: "Monitors",
    description: "Monitor anything.",
    category: "Essentials",
    routePath: "/dashboard/abc123/monitors",
    templatePath: "/dashboard/:projectId/monitors",
    ...overrides,
  };
}

describe("isRoutePathNavigable (the ':'-guard)", () => {
  test("a fully populated path is navigable", () => {
    expect(isRoutePathNavigable("/dashboard/abc123/monitors")).toBe(true);
  });

  test("a path with an unresolved :projectId is not navigable", () => {
    /*
     * populateRouteParams leaves ":projectId" in place when no project is
     * selected; navigating there lands on the 404 route, so the palette must
     * hide the entry — same guard Breadcrumbs/Helper.ts applies.
     */
    expect(isRoutePathNavigable("/dashboard/:projectId/monitors")).toBe(false);
  });

  test("a path with an unresolved :id is not navigable either", () => {
    expect(isRoutePathNavigable("/dashboard/abc123/monitors/:id")).toBe(false);
  });

  test("an empty path is not navigable", () => {
    expect(isRoutePathNavigable("")).toBe(false);
  });
});

describe("buildNavigationCommandDescriptors", () => {
  test("maps catalog entries and keeps their display fields", () => {
    const descriptors: Array<PaletteNavigationCommandDescriptor> =
      buildNavigationCommandDescriptors([entry({})]);

    expect(descriptors).toHaveLength(1);
    expect(descriptors[0]!.title).toBe("Monitors");
    expect(descriptors[0]!.description).toBe("Monitor anything.");
    expect(descriptors[0]!.category).toBe("Essentials");
    expect(descriptors[0]!.routePath).toBe("/dashboard/abc123/monitors");
  });

  test("drops entries whose populated route still has a ':' placeholder", () => {
    const descriptors: Array<PaletteNavigationCommandDescriptor> =
      buildNavigationCommandDescriptors([
        entry({}),
        entry({
          title: "Unpopulated",
          routePath: "/dashboard/:projectId/incidents",
          templatePath: "/dashboard/:projectId/incidents",
        }),
      ]);

    expect(descriptors).toHaveLength(1);
    expect(descriptors[0]!.title).toBe("Monitors");
  });

  test("ids come from the route TEMPLATE, so recents survive a project switch", () => {
    /*
     * Recents are persisted as command ids. If the id were derived from the
     * populated path it would embed the project id and every recent would be
     * orphaned on project switch; the template is project-independent.
     */
    const inProjectA: Array<PaletteNavigationCommandDescriptor> =
      buildNavigationCommandDescriptors([
        entry({ routePath: "/dashboard/project-a/monitors" }),
      ]);
    const inProjectB: Array<PaletteNavigationCommandDescriptor> =
      buildNavigationCommandDescriptors([
        entry({ routePath: "/dashboard/project-b/monitors" }),
      ]);

    expect(inProjectA[0]!.id).toBe(inProjectB[0]!.id);
    // And it is a DOM-safe slug (used in data-testids).
    expect(inProjectA[0]!.id).toMatch(/^nav-[a-z0-9-]+$/);
  });

  test("slugifyPaletteCommandId strips everything but alphanumerics", () => {
    expect(
      slugifyPaletteCommandId("nav", "/dashboard/:projectId/on-call"),
    ).toBe("nav-dashboard-projectid-on-call");
  });
});

describe("computeCreateActionGates (BaseModelTable's create gating, mirrored)", () => {
  test("a master admin can run every create action regardless of permissions", () => {
    const gates: PaletteCreateActionGates = computeCreateActionGates({
      permissions: null,
      isMasterAdmin: true,
    });

    expect(gates.canCreateIncident).toBe(true);
    expect(gates.canCreateMonitor).toBe(true);
    expect(gates.canCreateAlert).toBe(true);
    expect(gates.canCreateScheduledMaintenance).toBe(true);
    expect(gates.canCreateAnnouncement).toBe(true);
  });

  test("a missing permission snapshot (e.g. right after SSO) hides all create actions", () => {
    const gates: PaletteCreateActionGates = computeCreateActionGates({
      permissions: null,
      isMasterAdmin: false,
    });

    expect(
      Object.values(gates).every((gate: boolean) => {
        return !gate;
      }),
    ).toBe(true);
  });

  test("an empty permission list grants nothing", () => {
    const gates: PaletteCreateActionGates = computeCreateActionGates({
      permissions: [],
      isMasterAdmin: false,
    });

    expect(
      Object.values(gates).every((gate: boolean) => {
        return !gate;
      }),
    ).toBe(true);
  });

  test("a project owner can create all five entity types", () => {
    const gates: PaletteCreateActionGates = computeCreateActionGates({
      permissions: [Permission.ProjectOwner],
      isMasterAdmin: false,
    });

    expect(gates.canCreateIncident).toBe(true);
    expect(gates.canCreateMonitor).toBe(true);
    expect(gates.canCreateAlert).toBe(true);
    expect(gates.canCreateScheduledMaintenance).toBe(true);
    expect(gates.canCreateAnnouncement).toBe(true);
  });

  test("a scoped permission unlocks only its own create action", () => {
    const gates: PaletteCreateActionGates = computeCreateActionGates({
      permissions: [Permission.CreateProjectIncident],
      isMasterAdmin: false,
    });

    expect(gates.canCreateIncident).toBe(true);
    expect(gates.canCreateMonitor).toBe(false);
    expect(gates.canCreateAlert).toBe(false);
    expect(gates.canCreateScheduledMaintenance).toBe(false);
    expect(gates.canCreateAnnouncement).toBe(false);
  });
});

describe("getVisibleActionIds", () => {
  const allGatesOpen: PaletteCreateActionGates = {
    canCreateIncident: true,
    canCreateMonitor: true,
    canCreateAlert: true,
    canCreateScheduledMaintenance: true,
    canCreateAnnouncement: true,
  };

  test("without a project, no create action is offered (their routes cannot be populated)", () => {
    const actionIds: Array<PaletteActionId> = getVisibleActionIds({
      ...allGatesOpen,
      hasProjectSelected: false,
      isMasterAdmin: false,
    });

    expect(actionIds).not.toContain("action-declare-incident");
    expect(actionIds).not.toContain("action-create-monitor");
    expect(actionIds).not.toContain("action-create-alert");
    expect(actionIds).not.toContain("action-create-scheduled-maintenance");
    expect(actionIds).not.toContain("action-create-announcement");
  });

  test("the always-available actions survive every snapshot", () => {
    const actionIds: Array<PaletteActionId> = getVisibleActionIds({
      canCreateIncident: false,
      canCreateMonitor: false,
      canCreateAlert: false,
      canCreateScheduledMaintenance: false,
      canCreateAnnouncement: false,
      hasProjectSelected: false,
      isMasterAdmin: false,
    });

    expect(actionIds).toContain("action-toggle-theme");
    expect(actionIds).toContain("action-ask-ai");
    expect(actionIds).toContain("action-log-out");
    // The global (non-project) pages stay reachable without a project.
    expect(actionIds).toContain("action-active-incidents");
    expect(actionIds).toContain("action-my-on-call-policies");
    expect(actionIds).toContain("action-project-invitations");
  });

  test("with a project and open gates, the create actions appear", () => {
    const actionIds: Array<PaletteActionId> = getVisibleActionIds({
      ...allGatesOpen,
      hasProjectSelected: true,
      isMasterAdmin: false,
    });

    expect(actionIds).toContain("action-declare-incident");
    expect(actionIds).toContain("action-create-monitor");
    expect(actionIds).toContain("action-create-alert");
    expect(actionIds).toContain("action-create-scheduled-maintenance");
    expect(actionIds).toContain("action-create-announcement");
  });

  test("a closed gate hides exactly its own create action", () => {
    const actionIds: Array<PaletteActionId> = getVisibleActionIds({
      ...allGatesOpen,
      canCreateMonitor: false,
      hasProjectSelected: true,
      isMasterAdmin: false,
    });

    expect(actionIds).not.toContain("action-create-monitor");
    expect(actionIds).toContain("action-declare-incident");
  });

  test("the admin dashboard action requires master admin", () => {
    const asAdmin: Array<PaletteActionId> = getVisibleActionIds({
      ...allGatesOpen,
      hasProjectSelected: true,
      isMasterAdmin: true,
    });
    const asMortal: Array<PaletteActionId> = getVisibleActionIds({
      ...allGatesOpen,
      hasProjectSelected: true,
      isMasterAdmin: false,
    });

    expect(asAdmin).toContain("action-admin-dashboard");
    expect(asMortal).not.toContain("action-admin-dashboard");
  });
});

describe("entity search specs and query construction", () => {
  test("the search field lists match what the entity tables declare as searchable", () => {
    /*
     * A wrong field name reaches TypeORM as raw SQL and errors server-side.
     * These lists are verified against the model classes and mirror the
     * searchableFields of MonitorTable, IncidentsTable, AlertsTable,
     * StatusPages and OnCallDutyPolicies.
     */
    const byId: Map<string, PaletteEntitySearchSpec> = new Map(
      getEntitySearchSpecs().map((spec: PaletteEntitySearchSpec) => {
        return [spec.id, spec];
      }),
    );

    expect(byId.get("monitors")!.searchFields).toEqual(["name", "description"]);
    expect(byId.get("monitors")!.titleField).toBe("name");
    expect(byId.get("monitors")!.viewPageMap).toBe(PageMap.MONITOR_VIEW);

    expect(byId.get("incidents")!.searchFields).toEqual([
      "title",
      "description",
    ]);
    expect(byId.get("incidents")!.titleField).toBe("title");
    expect(byId.get("incidents")!.viewPageMap).toBe(PageMap.INCIDENT_VIEW);

    expect(byId.get("alerts")!.searchFields).toEqual(["title", "description"]);
    expect(byId.get("alerts")!.titleField).toBe("title");
    expect(byId.get("alerts")!.viewPageMap).toBe(PageMap.ALERT_VIEW);

    expect(byId.get("status-pages")!.searchFields).toEqual([
      "name",
      "description",
    ]);
    expect(byId.get("status-pages")!.titleField).toBe("name");
    expect(byId.get("status-pages")!.viewPageMap).toBe(
      PageMap.STATUS_PAGE_VIEW,
    );

    expect(byId.get("on-call-policies")!.searchFields).toEqual([
      "name",
      "description",
    ]);
    expect(byId.get("on-call-policies")!.titleField).toBe("name");
    expect(byId.get("on-call-policies")!.viewPageMap).toBe(
      PageMap.ON_CALL_DUTY_POLICY_VIEW,
    );
  });

  test("the query carries a MultiSearch under _multiFieldSearch, exactly like the table search box", () => {
    const spec: PaletteEntitySearchSpec = getEntitySearchSpecs()[0]!;
    const query: JSONObject = buildEntitySearchQuery(spec, "  api server  ");

    const operator: MultiSearch = query[
      "_multiFieldSearch"
    ] as unknown as MultiSearch;

    expect(operator).toBeInstanceOf(MultiSearch);
    expect(operator.fields).toEqual(spec.searchFields);
    // BaseModelTable searches the trimmed text; the palette must match.
    expect(operator.value).toBe("api server");

    // And it serializes to the wire shape the server's QueryUtil expects.
    expect(operator.toJSON()).toEqual({
      _type: ObjectType.MultiSearch,
      value: "api server",
      fields: spec.searchFields,
    });
  });

  test("select fetches only the id and the display column", () => {
    const monitorsSpec: PaletteEntitySearchSpec = getEntitySearchSpecs()[0]!;
    expect(buildEntitySearchSelect(monitorsSpec)).toEqual({
      _id: true,
      name: true,
    });

    const incidentsSpec: PaletteEntitySearchSpec = getEntitySearchSpecs()[1]!;
    expect(buildEntitySearchSelect(incidentsSpec)).toEqual({
      _id: true,
      title: true,
    });
  });

  test("sort is ascending on the display column", () => {
    const monitorsSpec: PaletteEntitySearchSpec = getEntitySearchSpecs()[0]!;
    expect(buildEntitySearchSort(monitorsSpec)).toEqual({
      name: SortOrder.Ascending,
    });
  });

  test("the fan-out stays cheap: five specs, five rows each", () => {
    expect(getEntitySearchSpecs()).toHaveLength(5);
    expect(PALETTE_ENTITY_SEARCH_LIMIT).toBe(5);
  });

  test("the recents storage key is the agreed dashboard-wide constant", () => {
    expect(PALETTE_RECENTS_STORAGE_KEY).toBe(
      "oneuptime-command-palette-recents",
    );
  });
});
