import fs from "fs";
import path from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  RenderResult,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";

/*
 * ModelAPI is the only thing between these pages and the network. Stubbed
 * inline (jest.mock is hoisted above the imports) with the "mock" prefix jest
 * requires of anything the factory closes over - same as ResourceFeed.test.
 */
type GetListRequest = Record<string, unknown>;

const mockGetListCalls: Array<GetListRequest> = [];

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (request: GetListRequest): Promise<unknown> => {
        mockGetListCalls.push(request);
        return Promise.resolve({ data: [], count: 0 });
      },
    },
  };
});

/*
 * The real Icon draws an SVG that says nothing about which icon it is. This
 * one names the icon, so the checklist's icons can be read back off the page.
 * Everything else the module exports (SizeProp, ThickProp, IconType) stays
 * real - components across the page read those at render time.
 */
jest.mock("../../../UI/Components/Icon/Icon", () => {
  const actualIconModule: Record<string, unknown> = jest.requireActual(
    "../../../UI/Components/Icon/Icon",
  ) as Record<string, unknown>;

  return {
    ...actualIconModule,
    __esModule: true,
    default: (props: { icon: string }) => {
      return <span data-icon={props.icon} aria-hidden="true" />;
    },
  };
});

import KubernetesClusterFeedPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Feed";
import DockerHostFeedPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Docker/View/Feed";
import DockerSwarmClusterFeedPage from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/Feed";
import PodmanHostFeedPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Podman/View/Feed";
import ProxmoxClusterFeedPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/Feed";
import CephClusterFeedPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/Feed";
import VMwareVCenterFeedPage from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/Feed";
import HostFeedPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/Feed";
import CloudResourceFeedPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/View/Feed";
import DatabaseServerFeedPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/View/Feed";
import ServiceFeedPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Service/View/Feed";
import SloFeedPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/View/Feed";
import SloFeed from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloFeed";
import { getSloFeedEventIcon } from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloFeedIcon";
import {
  GetResourceFeedIconFunction,
  ResourceFeedModel,
  getIconForEventType,
  resolveResourceFeedIcon,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceFeed/ResourceFeed";
import type PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import RouteParams from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteParams";
import KubernetesClusterFeed, {
  KubernetesClusterFeedEventType,
} from "../../../Models/DatabaseModels/KubernetesClusterFeed";
import DockerHostFeed, {
  DockerHostFeedEventType,
} from "../../../Models/DatabaseModels/DockerHostFeed";
import DockerSwarmClusterFeed, {
  DockerSwarmClusterFeedEventType,
} from "../../../Models/DatabaseModels/DockerSwarmClusterFeed";
import PodmanHostFeed, {
  PodmanHostFeedEventType,
} from "../../../Models/DatabaseModels/PodmanHostFeed";
import ProxmoxClusterFeed, {
  ProxmoxClusterFeedEventType,
} from "../../../Models/DatabaseModels/ProxmoxClusterFeed";
import CephClusterFeed, {
  CephClusterFeedEventType,
} from "../../../Models/DatabaseModels/CephClusterFeed";
import VMwareVCenterFeed, {
  VMwareVCenterFeedEventType,
} from "../../../Models/DatabaseModels/VMwareVCenterFeed";
import HostFeed, {
  HostFeedEventType,
} from "../../../Models/DatabaseModels/HostFeed";
import CloudResourceFeed, {
  CloudResourceFeedEventType,
} from "../../../Models/DatabaseModels/CloudResourceFeed";
import DatabaseServerFeed, {
  DatabaseServerFeedEventType,
} from "../../../Models/DatabaseModels/DatabaseServerFeed";
import ServiceFeed, {
  ServiceFeedEventType,
} from "../../../Models/DatabaseModels/ServiceFeed";
import ServiceLevelObjectiveFeed, {
  ServiceLevelObjectiveFeedEventType,
} from "../../../Models/DatabaseModels/ServiceLevelObjectiveFeed";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { DEFAULT_LIMIT } from "../../../Types/Database/LimitMax";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import {
  DEFAULT_FEED_OPTIONS,
  FEED_OPTIONS_TEXT,
  FILTERED_FEED_NO_ITEMS_MESSAGE,
  FeedOptions,
  getFeedEventTypeLabel,
  getFeedOptionsSummary,
} from "../../../UI/Components/Feed/FeedOptions";
import { getSortOrderStorageKey } from "../../../UI/Components/Feed/useFeedOptions";

/*
 * ResourceFeed.test pins the shared component with hand-written props. What
 * it cannot see is the eleven real pages that hand it those props - each one a
 * near copy of the next, with two column names and an enum pasted in as
 * strings. A slip there compiles and fails quietly: the wrong resource column
 * is an empty feed, the wrong event type column is a filter the API cannot
 * apply, another product's enum is a checklist of events this feed never
 * records, and a shared storage key makes "Oldest first" on one product flip
 * every other product's feed.
 *
 * So every real page is rendered at its real route with only the network
 * stubbed, and driven through the real Filter & Sort button - plus the SLO
 * feed embedded on the SLO overview, which renders the same ResourceFeed from
 * a component instead of a page.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
);

const PROJECT_ID: ObjectID = ObjectID.generate();

type FeedModelType = new () => ResourceFeedModel;

type MountFunction = (resourceId: ObjectID) => React.ReactElement;

interface ResourceFeedSurface {
  // Names the surface in test titles.
  product: string;
  /*
   * The product whose feed this surface shows. Two surfaces can show one
   * product's feed - the SLO Feed page and the feed on the SLO overview - and
   * those are meant to agree about the reader's sort order.
   */
  feedProduct: string;
  // The file that renders <ResourceFeed>, relative to the dashboard's src.
  file: string;
  // That file's default export - the coverage guard checks the two agree.
  component: unknown;
  modelType: FeedModelType;
  resourceIdColumn: string;
  eventTypeColumn: string;
  enumObject: Record<string, string>;
  // The feed's own icons, for the event types the shared rules do not know.
  getIcon?: GetResourceFeedIconFunction | undefined;
  /*
   * Puts the resource id where this surface reads it, and returns the element.
   * Re-rendering a mounted surface with a new one's element is the dashboard
   * moving that surface on to another resource.
   */
  mount: MountFunction;
}

interface FeedPageSpec {
  product: string;
  file: string;
  Page: React.FunctionComponent<PageComponentProps>;
  route: Route;
  modelType: FeedModelType;
  resourceIdColumn: string;
  eventTypeColumn: string;
  enumObject: Record<string, string>;
  getIcon?: GetResourceFeedIconFunction | undefined;
}

const FEED_PAGES: Array<FeedPageSpec> = [
  {
    product: "Kubernetes",
    file: "Pages/Kubernetes/View/Feed.tsx",
    Page: KubernetesClusterFeedPage,
    route: RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_FEED] as Route,
    modelType: KubernetesClusterFeed,
    resourceIdColumn: "kubernetesClusterId",
    eventTypeColumn: "kubernetesClusterFeedEventType",
    enumObject: KubernetesClusterFeedEventType,
  },
  {
    product: "Docker",
    file: "Pages/Docker/View/Feed.tsx",
    Page: DockerHostFeedPage,
    route: RouteMap[PageMap.DOCKER_HOST_VIEW_FEED] as Route,
    modelType: DockerHostFeed,
    resourceIdColumn: "dockerHostId",
    eventTypeColumn: "dockerHostFeedEventType",
    enumObject: DockerHostFeedEventType,
  },
  {
    product: "Docker Swarm",
    file: "Pages/DockerSwarm/View/Feed.tsx",
    Page: DockerSwarmClusterFeedPage,
    route: RouteMap[PageMap.DOCKER_SWARM_CLUSTER_VIEW_FEED] as Route,
    modelType: DockerSwarmClusterFeed,
    resourceIdColumn: "dockerSwarmClusterId",
    eventTypeColumn: "dockerSwarmClusterFeedEventType",
    enumObject: DockerSwarmClusterFeedEventType,
  },
  {
    product: "Podman",
    file: "Pages/Podman/View/Feed.tsx",
    Page: PodmanHostFeedPage,
    route: RouteMap[PageMap.PODMAN_HOST_VIEW_FEED] as Route,
    modelType: PodmanHostFeed,
    resourceIdColumn: "podmanHostId",
    eventTypeColumn: "podmanHostFeedEventType",
    enumObject: PodmanHostFeedEventType,
  },
  {
    product: "Proxmox",
    file: "Pages/Proxmox/View/Feed.tsx",
    Page: ProxmoxClusterFeedPage,
    route: RouteMap[PageMap.PROXMOX_CLUSTER_VIEW_FEED] as Route,
    modelType: ProxmoxClusterFeed,
    resourceIdColumn: "proxmoxClusterId",
    eventTypeColumn: "proxmoxClusterFeedEventType",
    enumObject: ProxmoxClusterFeedEventType,
  },
  {
    product: "Ceph",
    file: "Pages/Ceph/View/Feed.tsx",
    Page: CephClusterFeedPage,
    route: RouteMap[PageMap.CEPH_CLUSTER_VIEW_FEED] as Route,
    modelType: CephClusterFeed,
    resourceIdColumn: "cephClusterId",
    eventTypeColumn: "cephClusterFeedEventType",
    enumObject: CephClusterFeedEventType,
  },
  {
    product: "VMware",
    file: "Pages/VMware/View/Feed.tsx",
    Page: VMwareVCenterFeedPage,
    route: RouteMap[PageMap.VMWARE_VCENTER_VIEW_FEED] as Route,
    modelType: VMwareVCenterFeed,
    resourceIdColumn: "vmwareVCenterId",
    eventTypeColumn: "vmwareVCenterFeedEventType",
    enumObject: VMwareVCenterFeedEventType,
  },
  {
    product: "Host",
    file: "Pages/Host/View/Feed.tsx",
    Page: HostFeedPage,
    route: RouteMap[PageMap.HOST_VIEW_FEED] as Route,
    modelType: HostFeed,
    resourceIdColumn: "hostId",
    eventTypeColumn: "hostFeedEventType",
    enumObject: HostFeedEventType,
  },
  {
    product: "Cloud",
    file: "Pages/Cloud/View/Feed.tsx",
    Page: CloudResourceFeedPage,
    route: RouteMap[PageMap.CLOUD_RESOURCE_VIEW_FEED] as Route,
    modelType: CloudResourceFeed,
    resourceIdColumn: "cloudResourceId",
    eventTypeColumn: "cloudResourceFeedEventType",
    enumObject: CloudResourceFeedEventType,
  },
  {
    product: "Databases",
    file: "Pages/Database/View/Feed.tsx",
    Page: DatabaseServerFeedPage,
    route: RouteMap[PageMap.DATABASE_SERVER_VIEW_FEED] as Route,
    modelType: DatabaseServerFeed,
    resourceIdColumn: "databaseServerId",
    eventTypeColumn: "databaseServerFeedEventType",
    enumObject: DatabaseServerFeedEventType,
  },
  {
    product: "Service Catalog",
    file: "Pages/Service/View/Feed.tsx",
    Page: ServiceFeedPage,
    route: RouteMap[PageMap.SERVICE_VIEW_FEED] as Route,
    modelType: ServiceFeed,
    resourceIdColumn: "serviceId",
    eventTypeColumn: "serviceFeedEventType",
    enumObject: ServiceFeedEventType,
  },
  {
    product: "SLO",
    file: "Pages/Slo/View/Feed.tsx",
    Page: SloFeedPage,
    route: RouteMap[PageMap.SLO_VIEW_FEED] as Route,
    modelType: ServiceLevelObjectiveFeed,
    resourceIdColumn: "serviceLevelObjectiveId",
    eventTypeColumn: "serviceLevelObjectiveFeedEventType",
    enumObject: ServiceLevelObjectiveFeedEventType,
    getIcon: getSloFeedEventIcon,
  },
];

type GetFeedPageUrl = (spec: FeedPageSpec, resourceId: ObjectID) => string;

// The page's own route with the project and resource filled in.
const getFeedPageUrl: GetFeedPageUrl = (
  spec: FeedPageSpec,
  resourceId: ObjectID,
): string => {
  return spec.route
    .toString()
    .replace(RouteParams.ProjectID, PROJECT_ID.toString())
    .replace(RouteParams.ModelID, resourceId.toString());
};

type ToSurface = (spec: FeedPageSpec) => ResourceFeedSurface;

/*
 * A page reads its resource from the address bar (the route is
 * <modelId>/feed, so Navigation.getLastParamAsObjectID(1)), so mounting one
 * means going to its URL first. It reads it on every render, so going to
 * another resource's URL and rendering the page again is what the router does
 * when the reader moves between two resources of one product: same route,
 * same page, still mounted.
 */
const toSurface: ToSurface = (spec: FeedPageSpec): ResourceFeedSurface => {
  return {
    product: `${spec.product} feed page`,
    feedProduct: spec.product,
    file: spec.file,
    component: spec.Page,
    modelType: spec.modelType,
    resourceIdColumn: spec.resourceIdColumn,
    eventTypeColumn: spec.eventTypeColumn,
    enumObject: spec.enumObject,
    getIcon: spec.getIcon,
    mount: (resourceId: ObjectID): React.ReactElement => {
      window.history.pushState({}, "", getFeedPageUrl(spec, resourceId));

      const pageProps: PageComponentProps = {
        pageRoute: spec.route,
        currentProject: null,
        hasPaymentMethod: true,
      };

      return <spec.Page {...pageProps} />;
    },
  };
};

const SLO_FEED_PAGE: FeedPageSpec = FEED_PAGES.find((spec: FeedPageSpec) => {
  return spec.file === "Pages/Slo/View/Feed.tsx";
})!;

/*
 * The SLO overview embeds the feed through SloFeed, which takes the SLO from
 * its props rather than the URL - so the address bar is pointed somewhere
 * else entirely, and only the prop can put the right id in the query.
 */
const EMBEDDED_SLO_FEED: ResourceFeedSurface = {
  product: "Embedded SLO feed",
  feedProduct: SLO_FEED_PAGE.product,
  file: "Components/Slo/SloFeed.tsx",
  component: SloFeed,
  modelType: ServiceLevelObjectiveFeed,
  resourceIdColumn: "serviceLevelObjectiveId",
  eventTypeColumn: "serviceLevelObjectiveFeedEventType",
  enumObject: ServiceLevelObjectiveFeedEventType,
  getIcon: getSloFeedEventIcon,
  mount: (resourceId: ObjectID): React.ReactElement => {
    window.history.pushState(
      {},
      "",
      getFeedPageUrl(SLO_FEED_PAGE, ObjectID.generate()),
    );

    return <SloFeed sloId={resourceId} />;
  },
};

const SLO_FEED_PAGE_SURFACE: ResourceFeedSurface = toSurface(SLO_FEED_PAGE);

const SURFACES: Array<ResourceFeedSurface> = [
  ...FEED_PAGES.map(toSurface),
  EMBEDDED_SLO_FEED,
];

type GetEventTypes = (surface: ResourceFeedSurface) => Array<string>;

const getEventTypes: GetEventTypes = (
  surface: ResourceFeedSurface,
): Array<string> => {
  return Object.values(surface.enumObject);
};

type GetQuery = (request: GetListRequest) => Record<string, unknown>;

const getQuery: GetQuery = (
  request: GetListRequest,
): Record<string, unknown> => {
  return request["query"] as Record<string, unknown>;
};

type WaitForFeed = (requestCount: number) => Promise<void>;

// The feed has asked the API `requestCount` times and drawn the last answer.
const waitForFeed: WaitForFeed = async (
  requestCount: number,
): Promise<void> => {
  await waitFor(() => {
    expect(mockGetListCalls).toHaveLength(requestCount);
    expect(screen.queryByTestId("component-loader")).not.toBeInTheDocument();
  });
};

type GetFilterAndSortButton = () => HTMLElement;

/*
 * The feed's header has exactly one Filter & Sort button, found the way a
 * screen reader finds it: by its name. What the feed is showing is the
 * button's description, not part of its name, so the name stays the label
 * whatever the reader has chosen.
 */
const getFilterAndSortButton: GetFilterAndSortButton = (): HTMLElement => {
  const triggers: Array<HTMLElement> = screen.getAllByRole("button", {
    name: FEED_OPTIONS_TEXT.triggerLabel,
  });

  expect(triggers).toHaveLength(1);

  return triggers[0]!;
};

type OpenFeedOptions = () => HTMLElement;

// Presses Filter & Sort and returns the panel it opens.
const openFeedOptions: OpenFeedOptions = (): HTMLElement => {
  fireEvent.click(getFilterAndSortButton());

  return screen.getByRole("dialog", { name: FEED_OPTIONS_TEXT.panelLabel });
};

type CloseFeedOptions = () => void;

// A press anywhere outside the panel - on a link to another resource, say.
const closeFeedOptions: CloseFeedOptions = (): void => {
  fireEvent.mouseDown(document.body);

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
};

type GetExpectedSummary = (
  surface: ResourceFeedSurface,
  options: FeedOptions,
) => string;

/*
 * The sentence the trigger is described by, counted over this surface's own
 * event types. Built by the same function the button uses, so the wording can
 * change without this suite noticing - what is pinned is that the description
 * follows the feed's live order and filter, over the right product's enum.
 */
const getExpectedSummary: GetExpectedSummary = (
  surface: ResourceFeedSurface,
  options: FeedOptions,
): string => {
  return getFeedOptionsSummary({
    options: options,
    eventTypeCount: getEventTypes(surface).length,
  });
};

interface ChecklistEntry {
  label: string;
  icon: string | null;
  checkbox: HTMLElement;
}

type ReadChecklist = (panel: HTMLElement) => Array<ChecklistEntry>;

// The event type checklist as the reader sees it, top to bottom.
const readChecklist: ReadChecklist = (
  panel: HTMLElement,
): Array<ChecklistEntry> => {
  return within(panel)
    .getAllByRole("checkbox")
    .map((checkbox: HTMLElement): ChecklistEntry => {
      const label: HTMLLabelElement | null = checkbox.closest("label");

      return {
        label: label?.textContent?.trim() || "",
        icon:
          label?.querySelector("[data-icon]")?.getAttribute("data-icon") ||
          null,
        checkbox: checkbox,
      };
    });
};

interface ChecklistRow {
  label: string;
  icon: string | null;
}

type ToChecklistRows = (entries: Array<ChecklistEntry>) => Array<ChecklistRow>;

const toChecklistRows: ToChecklistRows = (
  entries: Array<ChecklistEntry>,
): Array<ChecklistRow> => {
  return entries.map((entry: ChecklistEntry): ChecklistRow => {
    return { label: entry.label, icon: entry.icon };
  });
};

type GetStoredSortOrderKeys = () => Array<string>;

/*
 * Every remembered feed sort order in this browser, whichever feed wrote it.
 * The prefix is whatever getSortOrderStorageKey puts in front of a feed's
 * name, so it is read from there rather than copied.
 */
const getStoredSortOrderKeys: GetStoredSortOrderKeys = (): Array<string> => {
  const prefix: string = getSortOrderStorageKey("");
  const keys: Array<string> = [];

  for (let index: number = 0; index < window.localStorage.length; index++) {
    const key: string | null = window.localStorage.key(index);

    if (key && key.startsWith(prefix)) {
      keys.push(key);
    }
  }

  return keys;
};

type ChooseSortOrder = (label: string) => void;

const chooseSortOrder: ChooseSortOrder = (label: string): void => {
  const panel: HTMLElement = openFeedOptions();

  fireEvent.click(within(panel).getByRole("radio", { name: label }));
};

beforeEach(() => {
  mockGetListCalls.length = 0;
  // The chosen sort order is remembered, so one test's choice must not leak.
  window.localStorage.clear();
  window.history.pushState({}, "", "/");
});

afterEach(() => {
  cleanup();
});

describe("Resource feed pages - Filter & Sort on the real pages", () => {
  test.each(SURFACES)(
    "$product asks the API for this resource's own feed, newest first",
    async (surface: ResourceFeedSurface) => {
      const resourceId: ObjectID = ObjectID.generate();

      render(surface.mount(resourceId));
      await waitForFeed(1);

      const request: GetListRequest = mockGetListCalls[0]!;
      const query: Record<string, unknown> = getQuery(request);

      expect(request["modelType"]).toBe(surface.modelType);

      /*
       * Exactly the resource and nothing else: an untouched Filter & Sort adds
       * nothing to the query, and the id is the one in the address (or, for
       * the embedded feed, the prop) - not the project id one segment over.
       */
      expect(Object.keys(query)).toEqual([surface.resourceIdColumn]);
      expect(query[surface.resourceIdColumn]).toBeInstanceOf(ObjectID);
      expect(String(query[surface.resourceIdColumn])).toBe(
        resourceId.toString(),
      );

      expect(request["sort"]).toEqual({ postedAt: SortOrder.Descending });
      expect(request["skip"]).toBe(0);
      expect(request["limit"]).toBe(DEFAULT_LIMIT);

      // The icon is chosen from the event type, so it has to be selected.
      expect(
        (request["select"] as Record<string, unknown>)[surface.eventTypeColumn],
      ).toBe(true);

      /*
       * The button says what the feed is showing without being opened, as
       * its description and its tooltip.
       */
      const summary: string = getExpectedSummary(surface, DEFAULT_FEED_OPTIONS);
      const trigger: HTMLElement = getFilterAndSortButton();

      expect(trigger).toHaveAccessibleDescription(summary);
      expect(trigger).toHaveAttribute("title", summary);
    },
  );

  test.each(SURFACES)(
    "$product offers every event type of its own feed model, labelled and in order",
    async (surface: ResourceFeedSurface) => {
      render(surface.mount(ObjectID.generate()));
      await waitForFeed(1);

      const eventTypes: Array<string> = getEventTypes(surface);
      const entries: Array<ChecklistEntry> = readChecklist(openFeedOptions());

      expect(eventTypes.length).toBeGreaterThan(0);
      expect(entries).toHaveLength(eventTypes.length);

      /*
       * Each entry reads as its event type's label and carries the icon the
       * feed's items of that type carry, alphabetical so the reader can scan
       * for the one they want. Another product's enum pasted into the page
       * fails here by label.
       */
      const expectedRows: Array<ChecklistRow> = eventTypes
        .map((eventType: string): ChecklistRow => {
          return {
            label: getFeedEventTypeLabel(eventType),
            icon: resolveResourceFeedIcon({
              eventType: eventType,
              getIcon: surface.getIcon,
            }),
          };
        })
        .sort((a: ChecklistRow, b: ChecklistRow): number => {
          return a.label.localeCompare(b.label);
        });

      expect(toChecklistRows(entries)).toEqual(expectedRows);

      // Two entries reading the same would leave the reader guessing.
      const labels: Array<string> = entries.map((entry: ChecklistEntry) => {
        return entry.label;
      });
      expect(new Set(labels).size).toBe(labels.length);

      // Nothing is ticked until the reader ticks it.
      for (const entry of entries) {
        expect(entry.checkbox).not.toBeChecked();
      }
    },
  );

  test.each(SURFACES)(
    "$product filters on its own event type column in the API, keeping the resource",
    async (surface: ResourceFeedSurface) => {
      const resourceId: ObjectID = ObjectID.generate();

      render(surface.mount(resourceId));
      await waitForFeed(1);

      const entries: Array<ChecklistEntry> = readChecklist(openFeedOptions());
      const firstEntry: ChecklistEntry | undefined = entries[0];

      expect(firstEntry).toBeDefined();

      const tickedEventType: string | undefined = getEventTypes(surface).find(
        (eventType: string) => {
          return getFeedEventTypeLabel(eventType) === firstEntry!.label;
        },
      );

      expect(tickedEventType).toBeDefined();

      fireEvent.click(firstEntry!.checkbox);
      await waitForFeed(2);

      const request: GetListRequest = mockGetListCalls[1]!;
      const query: Record<string, unknown> = getQuery(request);

      expect(Object.keys(query).sort()).toEqual(
        [surface.resourceIdColumn, surface.eventTypeColumn].sort(),
      );
      expect(String(query[surface.resourceIdColumn])).toBe(
        resourceId.toString(),
      );

      const eventTypeFilter: unknown = query[surface.eventTypeColumn];

      expect(eventTypeFilter).toBeInstanceOf(Includes);
      expect((eventTypeFilter as Includes).values).toEqual([tickedEventType]);

      // A new filter reads the newest window again, not the rows on screen.
      expect(request["sort"]).toEqual({ postedAt: SortOrder.Descending });
      expect(request["skip"]).toBe(0);
      expect(request["limit"]).toBe(DEFAULT_LIMIT);

      // Nothing matched, and the feed says the filter is why.
      expect(
        await screen.findByText(FILTERED_FEED_NO_ITEMS_MESSAGE),
      ).toBeInTheDocument();

      /*
       * The button's description now says the feed is narrowed - to one of
       * this product's event types, not one of some other enum's.
       */
      expect(getFilterAndSortButton()).toHaveAccessibleDescription(
        getExpectedSummary(surface, {
          sortOrder: SortOrder.Descending,
          eventTypes: [tickedEventType!],
        }),
      );

      /*
       * The filter narrows one look at one resource. It is not remembered,
       * so the next visit shows every event again.
       */
      expect(getStoredSortOrderKeys()).toEqual([]);

      cleanup();
      mockGetListCalls.length = 0;

      render(surface.mount(resourceId));
      await waitForFeed(1);

      expect(Object.keys(getQuery(mockGetListCalls[0]!))).toEqual([
        surface.resourceIdColumn,
      ]);
    },
  );

  test.each(SURFACES)(
    "$product starts the next resource's feed unfiltered, from its first request",
    async (surface: ResourceFeedSurface) => {
      /*
       * Moving between two resources of one product keeps the page mounted
       * (see toSurface), so the filter ticked on the first is still in the
       * feed's state when the second arrives. It was chosen for the first
       * resource's investigation: carried over, the second resource's feed
       * would open with events silently missing - and a reset that only
       * lands after that first request still sends the API the old filter
       * for the new resource.
       */
      const firstResourceId: ObjectID = ObjectID.generate();
      const nextResourceId: ObjectID = ObjectID.generate();

      const view: RenderResult = render(surface.mount(firstResourceId));
      await waitForFeed(1);

      fireEvent.click(readChecklist(openFeedOptions())[0]!.checkbox);
      await waitForFeed(2);

      // The first resource's feed really was narrowed.
      const filteredQuery: Record<string, unknown> = getQuery(
        mockGetListCalls[1]!,
      );

      expect(String(filteredQuery[surface.resourceIdColumn])).toBe(
        firstResourceId.toString(),
      );
      expect(filteredQuery[surface.eventTypeColumn]).toBeInstanceOf(Includes);
      expect(
        await screen.findByText(FILTERED_FEED_NO_ITEMS_MESSAGE),
      ).toBeInTheDocument();

      // The reader follows a link to another resource of the same product.
      closeFeedOptions();
      view.rerender(surface.mount(nextResourceId));
      await waitForFeed(3);

      /*
       * One request for the new resource, and it was already unfiltered -
       * not a filtered one that a later reset replaced.
       */
      const request: GetListRequest = mockGetListCalls[2]!;
      const query: Record<string, unknown> = getQuery(request);

      expect(Object.keys(query)).toEqual([surface.resourceIdColumn]);
      expect(String(query[surface.resourceIdColumn])).toBe(
        nextResourceId.toString(),
      );
      expect(request["sort"]).toEqual({ postedAt: SortOrder.Descending });
      expect(request["skip"]).toBe(0);
      expect(request["limit"]).toBe(DEFAULT_LIMIT);

      /*
       * The page agrees with the request: an empty feed is the resource's
       * own empty state, not "nothing matches", and the button no longer
       * says the feed is narrowed.
       */
      expect(
        screen.queryByText(FILTERED_FEED_NO_ITEMS_MESSAGE),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("feed-options-count"),
      ).not.toBeInTheDocument();
      expect(getFilterAndSortButton()).toHaveAccessibleDescription(
        getExpectedSummary(surface, DEFAULT_FEED_OPTIONS),
      );

      for (const entry of readChecklist(openFeedOptions())) {
        expect(entry.checkbox).not.toBeChecked();
      }

      // And nothing asked for the old filter afterwards either.
      expect(mockGetListCalls).toHaveLength(3);
    },
  );

  test.each(SURFACES)(
    "$product sends Oldest first to the API and remembers it under one key",
    async (surface: ResourceFeedSurface) => {
      const resourceId: ObjectID = ObjectID.generate();

      render(surface.mount(resourceId));
      await waitForFeed(1);

      // Nothing is remembered until the reader changes something.
      expect(getStoredSortOrderKeys()).toEqual([]);

      chooseSortOrder("Oldest first");
      await waitForFeed(2);

      const request: GetListRequest = mockGetListCalls[1]!;

      // Reversing the loaded rows would show the newest ten upside down.
      expect(request["sort"]).toEqual({ postedAt: SortOrder.Ascending });
      expect(request["skip"]).toBe(0);
      expect(request["limit"]).toBe(DEFAULT_LIMIT);
      expect(Object.keys(getQuery(request))).toEqual([
        surface.resourceIdColumn,
      ]);

      expect(getFilterAndSortButton()).toHaveAccessibleDescription(
        getExpectedSummary(surface, {
          sortOrder: SortOrder.Ascending,
          eventTypes: [],
        }),
      );

      /*
       * One key written, holding the new order. Which key it is does not
       * matter here - that no two products share one is checked below, from
       * the keys the pages are seen writing.
       */
      const storedKeys: Array<string> = getStoredSortOrderKeys();

      expect(storedKeys).toHaveLength(1);
      expect(window.localStorage.getItem(storedKeys[0]!)).toBe(
        SortOrder.Ascending,
      );

      // The next visit to this feed starts oldest first.
      cleanup();
      mockGetListCalls.length = 0;

      render(surface.mount(ObjectID.generate()));
      await waitForFeed(1);

      expect(mockGetListCalls[0]?.["sort"]).toEqual({
        postedAt: SortOrder.Ascending,
      });
      expect(
        within(openFeedOptions()).getByRole("radio", { name: "Oldest first" }),
      ).toHaveAttribute("aria-checked", "true");
    },
  );

  test("each product remembers its sort order under a key of its own, and both SLO feeds under the same one", async () => {
    /*
     * The keys are read off what each real surface writes when the reader
     * picks Oldest first, not worked out from this file's table - a table
     * can only agree with itself. Storage is emptied between surfaces, so
     * each one's key is its own and not one left behind by the one before.
     */
    interface WrittenSortOrder {
      surface: ResourceFeedSurface;
      keys: Array<string>;
      values: Array<string | null>;
    }

    const written: Array<WrittenSortOrder> = [];

    for (const surface of SURFACES) {
      render(surface.mount(ObjectID.generate()));
      await waitForFeed(1);

      chooseSortOrder("Oldest first");
      await waitForFeed(2);

      const keys: Array<string> = getStoredSortOrderKeys();

      written.push({
        surface: surface,
        keys: keys,
        values: keys.map((key: string): string | null => {
          return window.localStorage.getItem(key);
        }),
      });

      window.localStorage.clear();
      cleanup();
      mockGetListCalls.length = 0;
    }

    // Every surface wrote exactly one key, holding the order just chosen.
    expect(
      written.map((entry: WrittenSortOrder) => {
        return { product: entry.surface.product, values: entry.values };
      }),
    ).toEqual(
      SURFACES.map((surface: ResourceFeedSurface) => {
        return { product: surface.product, values: [SortOrder.Ascending] };
      }),
    );

    // Which products' feeds wrote each key.
    const productsByKey: Map<string, Set<string>> = new Map<
      string,
      Set<string>
    >();

    for (const entry of written) {
      const key: string = entry.keys[0]!;

      productsByKey.set(
        key,
        new Set<string>([
          ...(productsByKey.get(key) || []),
          entry.surface.feedProduct,
        ]),
      );
    }

    type ByName = (a: Array<string>, b: Array<string>) => number;

    const byName: ByName = (a: Array<string>, b: Array<string>): number => {
      return a.join(",").localeCompare(b.join(","));
    };

    /*
     * Exactly one product per key, and each product once. A key two products
     * share would show up as one entry naming both: Oldest first on one of
     * them would turn the other's feed over. A product with two keys would
     * show up twice: the SLO Feed page and the SLO overview's feed, one feed
     * shown in two places, disagreeing about which way time runs.
     */
    expect(
      Array.from(productsByKey.values())
        .map((products: Set<string>): Array<string> => {
          return Array.from(products).sort();
        })
        .sort(byName),
    ).toEqual(
      FEED_PAGES.map((spec: FeedPageSpec): Array<string> => {
        return [spec.product];
      }).sort(byName),
    );

    // Spelled out for the one product shown twice.
    type GetWrittenKey = (surface: ResourceFeedSurface) => string | undefined;

    const getWrittenKey: GetWrittenKey = (
      surface: ResourceFeedSurface,
    ): string | undefined => {
      return written.find((entry: WrittenSortOrder) => {
        return entry.surface.product === surface.product;
      })?.keys[0];
    };

    expect(getWrittenKey(EMBEDDED_SLO_FEED)).toBeDefined();
    expect(getWrittenKey(EMBEDDED_SLO_FEED)).toBe(
      getWrittenKey(SLO_FEED_PAGE_SURFACE),
    );
  });
});

/*
 * The SLO Feed page and the feed embedded on the SLO overview are the same
 * feed shown in two places. The reader should not find them disagreeing
 * about which way time runs, what can be filtered, or what an event looks
 * like.
 */
describe("SLO feed - page and embedded feed", () => {
  type ReadSurfaceChecklist = (
    surface: ResourceFeedSurface,
  ) => Promise<Array<ChecklistRow>>;

  const readSurfaceChecklist: ReadSurfaceChecklist = async (
    surface: ResourceFeedSurface,
  ): Promise<Array<ChecklistRow>> => {
    render(surface.mount(ObjectID.generate()));
    await waitForFeed(1);

    const rows: Array<ChecklistRow> = toChecklistRows(
      readChecklist(openFeedOptions()),
    );

    cleanup();
    mockGetListCalls.length = 0;

    return rows;
  };

  test("offer the same event types, with the same labels and icons", async () => {
    const pageRows: Array<ChecklistRow> = await readSurfaceChecklist(
      SLO_FEED_PAGE_SURFACE,
    );
    const embeddedRows: Array<ChecklistRow> =
      await readSurfaceChecklist(EMBEDDED_SLO_FEED);

    expect(pageRows).toHaveLength(
      Object.values(ServiceLevelObjectiveFeedEventType).length,
    );
    expect(embeddedRows).toEqual(pageRows);
  });

  test("share one remembered sort order", async () => {
    // Oldest first on the Feed page...
    render(SLO_FEED_PAGE_SURFACE.mount(ObjectID.generate()));
    await waitForFeed(1);
    chooseSortOrder("Oldest first");
    await waitForFeed(2);

    expect(getStoredSortOrderKeys()).toHaveLength(1);

    cleanup();
    mockGetListCalls.length = 0;

    // ...is how the overview's feed opens.
    render(EMBEDDED_SLO_FEED.mount(ObjectID.generate()));
    await waitForFeed(1);

    expect(mockGetListCalls[0]?.["sort"]).toEqual({
      postedAt: SortOrder.Ascending,
    });

    // And back to Newest first there is how the Feed page opens next.
    chooseSortOrder("Newest first");
    await waitForFeed(2);

    expect(mockGetListCalls[1]?.["sort"]).toEqual({
      postedAt: SortOrder.Descending,
    });

    cleanup();
    mockGetListCalls.length = 0;

    render(SLO_FEED_PAGE_SURFACE.mount(ObjectID.generate()));
    await waitForFeed(1);

    expect(mockGetListCalls[0]?.["sort"]).toEqual({
      postedAt: SortOrder.Descending,
    });
  });

  test("show the SLO feed's own icons for the SLO's own event types", async () => {
    /*
     * StatusChanged, the burn rate events, the rule and monitor changes: the
     * shared suffix rules know none of them and would draw each as the same
     * anonymous dot. getSloFeedEventIcon is what tells them apart, and it is
     * what both checklists must show.
     */
    const sloOwnEventTypes: Array<string> = Object.values(
      ServiceLevelObjectiveFeedEventType,
    ).filter((eventType: string) => {
      return getSloFeedEventIcon(eventType) !== undefined;
    });

    expect(sloOwnEventTypes.length).toBeGreaterThan(0);

    for (const eventType of sloOwnEventTypes) {
      const ownIcon: IconProp = getSloFeedEventIcon(eventType)!;

      expect(
        resolveResourceFeedIcon({
          eventType: eventType,
          getIcon: getSloFeedEventIcon,
        }),
      ).toBe(ownIcon);
      expect(ownIcon).not.toBe(getIconForEventType(eventType));
    }

    for (const surface of [SLO_FEED_PAGE_SURFACE, EMBEDDED_SLO_FEED]) {
      const rows: Array<ChecklistRow> = await readSurfaceChecklist(surface);

      for (const eventType of sloOwnEventTypes) {
        const row: ChecklistRow | undefined = rows.find(
          (candidate: ChecklistRow) => {
            return candidate.label === getFeedEventTypeLabel(eventType);
          },
        );

        expect(row).toBeDefined();
        expect(row!.icon).toBe(getSloFeedEventIcon(eventType));
      }
    }
  });
});

type FindResourceFeedRenderers = (directory: string) => Array<string>;

const TYPESCRIPT_FILE: RegExp = /\.tsx?$/;

const RESOURCE_FEED_ELEMENT: RegExp = /<ResourceFeed[\s</>]/;

/*
 * Every file under the dashboard's src that renders <ResourceFeed>, relative
 * to src with forward slashes. Matches the JSX opening tag - with or without
 * a type argument - and not ResourceFeedModel or other longer names.
 */
const findResourceFeedRenderers: FindResourceFeedRenderers = (
  directory: string,
): Array<string> => {
  const renderers: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      renderers.push(...findResourceFeedRenderers(entryPath));
      continue;
    }

    if (!TYPESCRIPT_FILE.test(entry.name)) {
      continue;
    }

    if (RESOURCE_FEED_ELEMENT.test(fs.readFileSync(entryPath, "utf8"))) {
      renderers.push(
        path.relative(DASHBOARD_SRC, entryPath).split(path.sep).join("/"),
      );
    }
  }

  return renderers;
};

/*
 * The sweep above is only as good as its table. A new product's feed page
 * copies one of these and would otherwise ship untested - so the dashboard is
 * scanned, and whatever renders ResourceFeed has to be in the table.
 */
describe("Resource feed pages - the sweep covers every ResourceFeed", () => {
  test("every file that renders <ResourceFeed> is driven above, and nothing else is", () => {
    const renderers: Array<string> = findResourceFeedRenderers(DASHBOARD_SRC);
    const covered: Array<string> = SURFACES.map(
      (surface: ResourceFeedSurface) => {
        return surface.file;
      },
    );

    expect(renderers.length).toBeGreaterThan(0);

    // A renderer missing here is a feed nobody drives: add it to FEED_PAGES.
    expect(
      renderers.filter((file: string) => {
        return !covered.includes(file);
      }),
    ).toEqual([]);

    // A row missing there is a file that no longer renders ResourceFeed.
    expect(
      covered.filter((file: string) => {
        return !renderers.includes(file);
      }),
    ).toEqual([]);

    expect(new Set(covered).size).toBe(covered.length);
  });

  test.each(SURFACES)(
    "$product is the component $file exports",
    async (surface: ResourceFeedSurface) => {
      /*
       * The row's file is what the scan matched, and the row's component is
       * what was rendered - so the two must be the same module, or a new page
       * could be "covered" by a row that still renders an old one.
       */
      const feedModule: { default: unknown } = await import(
        path.join(DASHBOARD_SRC, surface.file)
      );

      expect(feedModule.default).toBe(surface.component);
    },
  );
});
