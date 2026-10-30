import HeldPermissionsUtil from "Common/Types/HeldPermissions";
import {
  buildEntitySearchQuery,
  buildEntitySearchSelect,
  buildEntitySearchSort,
  buildNavigationCommandDescriptors,
  computeCreateActionGates,
  getEntitySearchResultTitle,
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
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Alert from "Common/Models/DatabaseModels/Alert";
import Incident from "Common/Models/DatabaseModels/Incident";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import MultiSearch from "Common/Types/BaseDatabase/MultiSearch";
import { TableColumnMetadata } from "Common/Types/Database/TableColumn";
import TableColumnType from "Common/Types/Database/TableColumnType";
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

  test("preserves search aliases while keeping command ids tied to routes", () => {
    const descriptors: Array<PaletteNavigationCommandDescriptor> =
      buildNavigationCommandDescriptors([
        entry({
          title: "Real User Monitoring",
          keywords: ["rum", "browser monitoring"],
          routePath: "/dashboard/abc123/rum",
          templatePath: "/dashboard/:projectId/rum",
        }),
        entry({
          title: "Kubernetes",
          keywords: ["k8s", "pods"],
          routePath: "/dashboard/abc123/kubernetes",
          templatePath: "/dashboard/:projectId/kubernetes",
        }),
        entry({}),
      ]);

    expect(descriptors[0]).toMatchObject({
      id: "nav-dashboard-projectid-rum",
      keywords: ["rum", "browser monitoring"],
      routePath: "/dashboard/abc123/rum",
    });
    expect(descriptors[1]).toMatchObject({
      id: "nav-dashboard-projectid-kubernetes",
      keywords: ["k8s", "pods"],
      routePath: "/dashboard/abc123/kubernetes",
    });
    expect(descriptors[2]!.keywords).toBeUndefined();
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
      held: null,
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
      held: null,
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
      held: HeldPermissionsUtil.fromPermissions([]),
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
      held: HeldPermissionsUtil.fromPermissions([Permission.ProjectOwner]),
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
      held: HeldPermissionsUtil.fromPermissions([
        Permission.CreateProjectIncident,
      ]),
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
    /*
     * The shortcuts dialog is a reference, not a capability. Someone who has
     * just found the palette for the first time is exactly the person who
     * needs it, and they may have no project and no permissions yet.
     */
    expect(actionIds).toContain("action-keyboard-shortcuts");
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

  test("the way back to the system theme is offered only while Light or Dark is picked", () => {
    const withPick: Array<PaletteActionId> = getVisibleActionIds({
      ...allGatesOpen,
      hasProjectSelected: true,
      isMasterAdmin: false,
      isThemeFollowingDevice: false,
    });
    const followingDevice: Array<PaletteActionId> = getVisibleActionIds({
      ...allGatesOpen,
      hasProjectSelected: true,
      isMasterAdmin: false,
      isThemeFollowingDevice: true,
    });
    const unsaid: Array<PaletteActionId> = getVisibleActionIds({
      ...allGatesOpen,
      hasProjectSelected: true,
      isMasterAdmin: false,
    });

    expect(withPick).toContain("action-system-theme");
    // Right after the switch to the other theme.
    expect(withPick.indexOf("action-system-theme")).toBe(
      withPick.indexOf("action-toggle-theme") + 1,
    );
    expect(followingDevice).not.toContain("action-system-theme");
    expect(unsaid).not.toContain("action-system-theme");
    // The switch to the other theme is there either way.
    expect(followingDevice).toContain("action-toggle-theme");
    expect(withPick).toContain("action-toggle-theme");
  });

  test("the theme actions need no project and no permission", () => {
    const actionIds: Array<PaletteActionId> = getVisibleActionIds({
      canCreateIncident: false,
      canCreateMonitor: false,
      canCreateAlert: false,
      canCreateScheduledMaintenance: false,
      canCreateAnnouncement: false,
      hasProjectSelected: false,
      isMasterAdmin: false,
      isThemeFollowingDevice: false,
    });

    expect(actionIds).toContain("action-toggle-theme");
    expect(actionIds).toContain("action-system-theme");
  });

  test("no action id is offered twice", () => {
    /*
     * The host maps each id straight onto a command, so a duplicate becomes
     * two identical palette rows with the same React key.
     */
    const actionIds: Array<PaletteActionId> = getVisibleActionIds({
      ...allGatesOpen,
      hasProjectSelected: true,
      isMasterAdmin: true,
      isThemeFollowingDevice: false,
    });

    expect(new Set(actionIds).size).toBe(actionIds.length);
  });
});

describe("entity search specs and query construction", () => {
  // The model class each provider searches — same pairing the palette host wires up.
  const modelTypeBySpecId: Record<string, { new (): BaseModel }> = {
    monitors: Monitor,
    incidents: Incident,
    alerts: Alert,
    "status-pages": StatusPage,
    "on-call-policies": OnCallDutyPolicy,
  };

  test("every spec searches real text columns of its model", () => {
    /*
     * A wrong field name reaches TypeORM as raw SQL and errors server-side.
     * Rather than comparing the spec to a copy of itself, each spec's fields
     * are checked against the MODEL's own column metadata, so a model-side
     * rename (or a repoint at a non-text column no ILIKE can search) turns
     * this suite red.
     */
    const specs: Array<PaletteEntitySearchSpec> = getEntitySearchSpecs();

    expect(
      specs
        .map((spec: PaletteEntitySearchSpec) => {
          return spec.id;
        })
        .sort(),
    ).toEqual(Object.keys(modelTypeBySpecId).sort());

    // The one-OR-joined-ILIKE the server builds only makes sense over text.
    const searchableColumnTypes: Array<TableColumnType> = [
      TableColumnType.ShortText,
      TableColumnType.LongText,
      TableColumnType.VeryLongText,
      TableColumnType.Markdown,
    ];

    for (const spec of specs) {
      const model: BaseModel = new modelTypeBySpecId[spec.id]!();

      // The displayed column must itself be searched, or results look random.
      expect(spec.searchFields).toContain(spec.titleField);

      for (const field of new Set<string>([
        ...spec.searchFields,
        spec.titleField,
      ])) {
        // The column exists on the model...
        expect(model.hasColumn(field)).toBe(true);

        // ...and is a free-text one.
        const metadata: TableColumnMetadata =
          model.getTableColumnMetadata(field);
        expect(searchableColumnTypes).toContain(metadata.type);
      }
    }
  });

  test("each spec's view route is its entity's view page", () => {
    // Routing is a UI decision the models cannot verify — pin it directly.
    const byId: Map<string, PaletteEntitySearchSpec> = new Map(
      getEntitySearchSpecs().map((spec: PaletteEntitySearchSpec) => {
        return [spec.id, spec];
      }),
    );

    expect(byId.get("monitors")!.viewPageMap).toBe(PageMap.MONITOR_VIEW);
    expect(byId.get("incidents")!.viewPageMap).toBe(PageMap.INCIDENT_VIEW);
    expect(byId.get("alerts")!.viewPageMap).toBe(PageMap.ALERT_VIEW);
    expect(byId.get("status-pages")!.viewPageMap).toBe(
      PageMap.STATUS_PAGE_VIEW,
    );
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

  test("select fetches only the id and the display column, and a numbered entity's number", () => {
    const monitorsSpec: PaletteEntitySearchSpec = getEntitySearchSpecs()[0]!;
    expect(buildEntitySearchSelect(monitorsSpec)).toEqual({
      _id: true,
      name: true,
    });

    const incidentsSpec: PaletteEntitySearchSpec = getEntitySearchSpecs()[1]!;
    expect(buildEntitySearchSelect(incidentsSpec)).toEqual({
      _id: true,
      title: true,
      incidentNumber: true,
      incidentNumberWithPrefix: true,
    });

    const alertsSpec: PaletteEntitySearchSpec = getEntitySearchSpecs()[2]!;
    expect(buildEntitySearchSelect(alertsSpec)).toEqual({
      _id: true,
      title: true,
      alertNumber: true,
      alertNumberWithPrefix: true,
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

/*
 * Two incidents can share a title - "Manually declared", or a monitor's
 * "Checkout API p95 latency above 2s" each time it fails - and the palette
 * listed them as two identical rows. A numbered entity's result leads with
 * its number, as its page is headed ("INC-18 Manually declared"), and the
 * number is searched: "INC-18" finds it.
 */
describe("a numbered entity's results lead with its number", () => {
  const specById: (id: string) => PaletteEntitySearchSpec = (
    id: string,
  ): PaletteEntitySearchSpec => {
    return getEntitySearchSpecs().find((spec: PaletteEntitySearchSpec) => {
      return spec.id === id;
    })!;
  };

  const incidentNumbered: (number: number) => Incident = (
    number: number,
  ): Incident => {
    const incident: Incident = new Incident();
    incident.title = "Manually declared";
    incident.incidentNumber = number;
    incident.incidentNumberWithPrefix = "INC-" + String(number);
    return incident;
  };

  test("incidents and alerts are numbered by their models' own columns", () => {
    expect(specById("incidents").numberFields).toEqual({
      numberColumn: "incidentNumber",
      numberWithPrefixColumn: "incidentNumberWithPrefix",
    });
    expect(specById("alerts").numberFields).toEqual({
      numberColumn: "alertNumber",
      numberWithPrefixColumn: "alertNumberWithPrefix",
    });
  });

  test("the rest are not numbered", () => {
    for (const id of ["monitors", "status-pages", "on-call-policies"]) {
      expect({ id, numberFields: specById(id).numberFields }).toEqual({
        id,
        numberFields: undefined,
      });
    }
  });

  test("the number with its prefix is searched, so INC-18 finds it", () => {
    expect(specById("incidents").searchFields).toEqual([
      "title",
      "description",
      "incidentNumberWithPrefix",
    ]);
    expect(specById("alerts").searchFields).toEqual([
      "title",
      "description",
      "alertNumberWithPrefix",
    ]);

    const query: JSONObject = buildEntitySearchQuery(
      specById("incidents"),
      " INC-18 ",
    );
    const operator: MultiSearch = query[
      "_multiFieldSearch"
    ] as unknown as MultiSearch;
    expect(operator.fields).toContain("incidentNumberWithPrefix");
    expect(operator.value).toBe("INC-18");
  });

  test("an incident's result is its number, then its title", () => {
    expect(
      getEntitySearchResultTitle(specById("incidents"), incidentNumbered(18)),
    ).toBe("INC-18 Manually declared");
  });

  test("two incidents of one title are two results that read differently", () => {
    expect(
      [17, 18].map((number: number): string => {
        return getEntitySearchResultTitle(
          specById("incidents"),
          incidentNumbered(number),
        );
      }),
    ).toEqual(["INC-17 Manually declared", "INC-18 Manually declared"]);
  });

  test("a record keeps the prefix it was numbered with; one numbered before prefixes reads #7", () => {
    const renamed: Alert = new Alert();
    renamed.title = "CPU high on web-1";
    renamed.alertNumber = 7;
    renamed.alertNumberWithPrefix = "OPS/7";
    expect(getEntitySearchResultTitle(specById("alerts"), renamed)).toBe(
      "OPS/7 CPU high on web-1",
    );

    const old: Alert = new Alert();
    old.title = "CPU high on web-1";
    old.alertNumber = 7;
    expect(getEntitySearchResultTitle(specById("alerts"), old)).toBe(
      "#7 CPU high on web-1",
    );
  });

  test("a record without a number is its title alone, as before", () => {
    const incident: Incident = new Incident();
    incident.title = "Manually declared";

    expect(getEntitySearchResultTitle(specById("incidents"), incident)).toBe(
      "Manually declared",
    );
  });

  test("a row with no title is left out, whatever its number", () => {
    const incident: Incident = incidentNumbered(18);
    incident.title = "  ";

    expect(getEntitySearchResultTitle(specById("incidents"), incident)).toBe(
      "",
    );
    expect(getEntitySearchResultTitle(specById("incidents"), null)).toBe("");
  });

  test("a monitor's result is its name, with nothing before it", () => {
    const monitor: Monitor = new Monitor();
    monitor.name = "Website: acme.com";

    expect(getEntitySearchResultTitle(specById("monitors"), monitor)).toBe(
      "Website: acme.com",
    );
  });

  test("a row read as JSON is named the same way", () => {
    expect(
      getEntitySearchResultTitle(specById("incidents"), {
        _id: "5f8b9c1a-0000-4000-8000-000000000018",
        title: "Manually declared",
        incidentNumber: 18,
        incidentNumberWithPrefix: "INC-18",
      }),
    ).toBe("INC-18 Manually declared");
  });
});
