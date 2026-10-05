import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The trail a create page draws when opened from a record's tab
 * (Components/CreateFromRecord) is that tab's own trail with the create page
 * after it: Project > Hosts > View Host > Incidents > Declare New Incident.
 * The shared module spells each trail out; this keeps it in step with the
 * products' own breadcrumbs and routes, so a renamed crumb or a moved page
 * cannot leave the create page pointing somewhere else:
 *
 *   - every tab's own breadcrumbs read as the module's trail up to the tab;
 *   - the create pages' own breadcrumbs end on the title the trail ends on;
 *   - the list, the record and its tab are pages one under the other, and
 *     the links resolve to them in the current project, for the record.
 */

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): { toString: () => string } => {
        return {
          toString: (): string => {
            return "00000000-0000-4000-8000-000000000001";
          },
        };
      },
    },
  };
});

import {
  CREATE_FROM_RECORD_KINDS,
  CREATE_PAGES,
  CreateFromRecordKind,
  CreateFromRecordKindDefinition,
  CreatedRecordKind,
  PROJECT_CRUMB_TITLE,
  RecordTab,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CreateFromRecord/CreateFromRecord";
import { getCreateFromRecordBreadcrumbLinks } from "../../../../App/FeatureSet/Dashboard/src/Components/CreateFromRecord/useRecordToCreateFrom";
import { getAlertsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/AlertBreadcrumbs";
import { getIncidentsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/IncidentBreadcrumbs";
import {
  getCephBreadcrumbs,
  getDatabaseBreadcrumbs,
  getDockerBreadcrumbs,
  getDockerSwarmBreadcrumbs,
  getHostBreadcrumbs,
  getIoTBreadcrumbs,
  getKubernetesBreadcrumbs,
  getMonitorBreadcrumbs,
  getPodmanBreadcrumbs,
  getProxmoxBreadcrumbs,
  getScheduleMaintenanceBreadcrumbs,
  getServiceBreadcrumbs,
  getStatusPagesBreadcrumbs,
  getVMwareBreadcrumbs,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs";
import { getNetworkSiteBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkSite/Utils/Breadcrumbs";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Link from "../../../Types/Link";
import Navigation from "../../../UI/Utils/Navigation";
import { Location } from "react-router-dom";

const PROJECT_ID: string = "00000000-0000-4000-8000-000000000001";
const RECORD_ID: string = "0193c0de-3333-4aaa-8bbb-000000000001";

type GetBreadcrumbs = (path: string) => Array<Link> | undefined;

// Each kind's product, by the breadcrumbs its layout draws.
const PRODUCT_BREADCRUMBS: Record<CreateFromRecordKind, GetBreadcrumbs> = {
  [CreateFromRecordKind.Monitor]: getMonitorBreadcrumbs,
  [CreateFromRecordKind.Host]: getHostBreadcrumbs,
  [CreateFromRecordKind.KubernetesCluster]: getKubernetesBreadcrumbs,
  [CreateFromRecordKind.DockerHost]: getDockerBreadcrumbs,
  [CreateFromRecordKind.PodmanHost]: getPodmanBreadcrumbs,
  [CreateFromRecordKind.ProxmoxCluster]: getProxmoxBreadcrumbs,
  [CreateFromRecordKind.VMwareVCenter]: getVMwareBreadcrumbs,
  [CreateFromRecordKind.CephCluster]: getCephBreadcrumbs,
  [CreateFromRecordKind.DockerSwarmCluster]: getDockerSwarmBreadcrumbs,
  [CreateFromRecordKind.IoTFleet]: getIoTBreadcrumbs,
  [CreateFromRecordKind.DatabaseServer]: getDatabaseBreadcrumbs,
  [CreateFromRecordKind.NetworkSite]: getNetworkSiteBreadcrumbs,
  [CreateFromRecordKind.Service]: getServiceBreadcrumbs,
  [CreateFromRecordKind.StatusPage]: getStatusPagesBreadcrumbs,
};

// The create pages drawn inside a product's layout, by its breadcrumbs.
const CREATE_PAGE_BREADCRUMBS: Partial<
  Record<CreatedRecordKind, GetBreadcrumbs>
> = {
  [CreatedRecordKind.Incident]: getIncidentsBreadcrumbs,
  [CreatedRecordKind.Alert]: getAlertsBreadcrumbs,
  [CreatedRecordKind.ScheduledMaintenance]: getScheduleMaintenanceBreadcrumbs,
};

const routeOf: (page: PageMap) => string = (page: PageMap): string => {
  return RouteUtil.getRouteString(page).replace(/\/+$/, "");
};

const titlesAt: (
  getBreadcrumbs: GetBreadcrumbs,
  page: PageMap,
) => Array<string> = (
  getBreadcrumbs: GetBreadcrumbs,
  page: PageMap,
): Array<string> => {
  return (getBreadcrumbs(RouteUtil.getRouteString(page)) || []).map(
    (link: Link): string => {
      return link.title;
    },
  );
};

interface TabCase {
  kind: CreateFromRecordKind;
  created: CreatedRecordKind;
  definition: CreateFromRecordKindDefinition;
  tab: RecordTab;
}

const TAB_CASES: Array<TabCase> = CREATE_FROM_RECORD_KINDS.flatMap(
  (definition: CreateFromRecordKindDefinition): Array<TabCase> => {
    return (Object.keys(definition.tabs) as Array<CreatedRecordKind>).map(
      (created: CreatedRecordKind): TabCase => {
        return {
          kind: definition.kind,
          created: created,
          definition: definition,
          tab: definition.tabs[created]!,
        };
      },
    );
  },
);

beforeEach(() => {
  // The products' breadcrumbs resolve their links against the address.
  Navigation.setLocation({
    pathname: `/dashboard/${PROJECT_ID}/home`,
    search: "",
    hash: "",
    state: null,
    key: "test",
  } as Location);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the trail through a record's tab reads as the tab's own", () => {
  test("every kind has its product's breadcrumbs here", () => {
    expect(Object.keys(PRODUCT_BREADCRUMBS).sort()).toEqual(
      (Object.values(CreateFromRecordKind) as Array<string>).sort(),
    );
  });

  test.each(TAB_CASES)(
    "$kind > $created: the tab's breadcrumbs are Project, the list, the record, the tab",
    ({ kind, definition, tab }: TabCase) => {
      expect(titlesAt(PRODUCT_BREADCRUMBS[kind], tab.page)).toEqual([
        PROJECT_CRUMB_TITLE,
        definition.listTitle,
        definition.viewTitle,
        tab.title,
      ]);
    },
  );

  test.each(TAB_CASES)(
    "$kind > $created: the list, the record and its tab are pages one under the other",
    ({ definition, tab }: TabCase) => {
      const list: string = routeOf(definition.listPage);
      const view: string = routeOf(definition.viewPage);
      const tabRoute: string = routeOf(tab.page);

      expect(list.length).toBeGreaterThan(0);
      expect(view.startsWith(`${list}/`)).toBe(true);
      expect(view).toContain(":id");
      expect(tabRoute.startsWith(`${view}/`)).toBe(true);
    },
  );
});

describe("the trail ends on the create page, as its own breadcrumbs do", () => {
  test.each(Object.keys(CREATE_PAGE_BREADCRUMBS) as Array<CreatedRecordKind>)(
    "%s",
    (created: CreatedRecordKind) => {
      const titles: Array<string> = titlesAt(
        CREATE_PAGE_BREADCRUMBS[created]!,
        CREATE_PAGES[created].page,
      );

      expect(titles[0]).toBe(PROJECT_CRUMB_TITLE);
      expect(titles[titles.length - 1]).toBe(CREATE_PAGES[created].title);
    },
  );
});

describe("the trail's links", () => {
  test("resolve to the project's pages, for the record", () => {
    const links: Array<Link> | null = getCreateFromRecordBreadcrumbLinks(
      { kind: CreateFromRecordKind.Monitor, id: RECORD_ID },
      CreatedRecordKind.Incident,
    );

    expect(
      links!.map((link: Link): { title: string; to: string } => {
        return { title: link.title, to: link.to.toString() };
      }),
    ).toEqual([
      {
        title: "Project",
        to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME]!).toString(),
      },
      { title: "Monitors", to: `/dashboard/${PROJECT_ID}/monitors` },
      {
        title: "View Monitor",
        to: `/dashboard/${PROJECT_ID}/monitors/${RECORD_ID}`,
      },
      {
        title: "Incidents",
        to: `/dashboard/${PROJECT_ID}/monitors/${RECORD_ID}/incidents`,
      },
      {
        title: "Declare New Incident",
        to: `/dashboard/${PROJECT_ID}/incidents/create`,
      },
    ]);
  });

  test.each(TAB_CASES)(
    "$kind > $created: no link is left with a placeholder in it",
    ({ kind, created }: TabCase) => {
      const links: Array<Link> | null = getCreateFromRecordBreadcrumbLinks(
        { kind: kind, id: RECORD_ID },
        created,
      );

      expect(links).toHaveLength(5);

      for (const link of links!) {
        expect(link.to.toString()).not.toContain(":");
        expect(link.to.toString()).toContain(PROJECT_ID);
      }

      expect(links![2]!.to.toString()).toContain(RECORD_ID);
      expect(links![3]!.to.toString()).toContain(RECORD_ID);
    },
  );

  test("are none for a kind the page cannot be opened from", () => {
    expect(
      getCreateFromRecordBreadcrumbLinks(
        { kind: CreateFromRecordKind.NetworkSite, id: RECORD_ID },
        CreatedRecordKind.Incident,
      ),
    ).toBeNull();
  });
});
