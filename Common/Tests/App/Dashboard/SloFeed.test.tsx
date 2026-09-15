import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";

/*
 * ModelAPI is the only thing between the feed and the network. Stubbed inline
 * (jest.mock is hoisted above the imports) with the "mock" prefix jest
 * requires of anything the factory closes over - same as ResourceFeed.test.
 */
type GetListRequest = Record<string, unknown>;

const mockGetListCalls: Array<GetListRequest> = [];

let mockGetListResponse: (
  request: GetListRequest,
) => Promise<unknown> = (): Promise<unknown> => {
  return Promise.resolve({ data: [], count: 0 });
};

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (request: GetListRequest): Promise<unknown> => {
        mockGetListCalls.push(request);
        return mockGetListResponse(request);
      },
    },
  };
});

import SloFeed, {
  getSloResourceFeedProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloFeed";
import { getSloFeedEventIcon } from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloFeedIcon";
import {
  ComponentProps as ResourceFeedProps,
  resolveResourceFeedIcon,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceFeed/ResourceFeed";
import ServiceLevelObjectiveFeed, {
  ServiceLevelObjectiveFeedEventType,
} from "../../../Models/DatabaseModels/ServiceLevelObjectiveFeed";
import { Yellow } from "../../../Types/BrandColors";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";

/*
 * The SLO feed is the generic ResourceFeed, wired once in
 * getSloResourceFeedProps and shared by the Feed page and any embedded feed.
 * What is pinned here is what would otherwise go wrong silently: a wrong
 * column name renders an empty feed, and an event type with no icon renders
 * as the anonymous dot - a status change, a burn rate alert and a detached
 * monitor all looking the same.
 */

const SLO_ID: ObjectID = ObjectID.generate();

const ALL_EVENT_TYPES: Array<string> = Object.values(
  ServiceLevelObjectiveFeedEventType,
);

beforeEach(() => {
  mockGetListCalls.length = 0;
  mockGetListResponse = (): Promise<unknown> => {
    return Promise.resolve({ data: [], count: 0 });
  };
});

afterEach(() => {
  cleanup();
});

describe("getSloResourceFeedProps", () => {
  test("points ResourceFeed at the SLO feed's own columns", () => {
    const props: ResourceFeedProps<ServiceLevelObjectiveFeed> =
      getSloResourceFeedProps({ sloId: SLO_ID });

    expect(props.modelType).toBe(ServiceLevelObjectiveFeed);
    expect(props.resourceIdColumn).toBe("serviceLevelObjectiveId");
    expect(props.resourceId).toBe(SLO_ID);
    expect(props.eventTypeColumn).toBe("serviceLevelObjectiveFeedEventType");
    expect(props.title).toBe("SLO Feed");
    expect(props.description.length).toBeGreaterThan(0);
    expect(props.noItemsMessage).toBe(
      "No activity has been recorded for this SLO yet.",
    );
    // Both the page and any embedded feed get the SLO icons from here.
    expect(props.getIcon).toBe(getSloFeedEventIcon);
  });

  test("lets an embedded feed use its own title and description", () => {
    const props: ResourceFeedProps<ServiceLevelObjectiveFeed> =
      getSloResourceFeedProps({
        sloId: SLO_ID,
        title: "Recent activity",
        description: "The latest changes to this SLO.",
      });

    expect(props.title).toBe("Recent activity");
    expect(props.description).toBe("The latest changes to this SLO.");
  });
});

describe("SLO feed icons", () => {
  test.each(ALL_EVENT_TYPES)(
    "%s renders a real icon, never the anonymous fallback dot",
    (eventType: string) => {
      expect(
        resolveResourceFeedIcon({
          eventType: eventType,
          getIcon: getSloFeedEventIcon,
        }),
      ).not.toBe(IconProp.Circle);
    },
  );

  test.each([
    [
      ServiceLevelObjectiveFeedEventType.ServiceLevelObjectiveEnabled,
      IconProp.Play,
    ],
    [
      ServiceLevelObjectiveFeedEventType.ServiceLevelObjectiveDisabled,
      IconProp.Pause,
    ],
    [
      ServiceLevelObjectiveFeedEventType.StatusChanged,
      IconProp.ArrowCircleRight,
    ],
    [
      ServiceLevelObjectiveFeedEventType.BurnRateAlertRaised,
      IconProp.ExclaimationCircle,
    ],
    [
      ServiceLevelObjectiveFeedEventType.BurnRateIncidentDeclared,
      IconProp.Alert,
    ],
    [
      ServiceLevelObjectiveFeedEventType.BurnRateAlertResolved,
      IconProp.CheckCircle,
    ],
    [
      ServiceLevelObjectiveFeedEventType.BurnRateIncidentResolved,
      IconProp.CheckCircle,
    ],
    [ServiceLevelObjectiveFeedEventType.BurnRateRuleAdded, IconProp.Fire],
    [ServiceLevelObjectiveFeedEventType.BurnRateRuleChanged, IconProp.Fire],
    [ServiceLevelObjectiveFeedEventType.BurnRateRuleRemoved, IconProp.Fire],
    [ServiceLevelObjectiveFeedEventType.MonitorRuleAdded, IconProp.Filter],
    [ServiceLevelObjectiveFeedEventType.MonitorRuleChanged, IconProp.Filter],
    [ServiceLevelObjectiveFeedEventType.MonitorRuleRemoved, IconProp.Filter],
    [ServiceLevelObjectiveFeedEventType.MonitorsAttached, IconProp.Link],
    [ServiceLevelObjectiveFeedEventType.MonitorsDetached, IconProp.LinkSlash],
  ])("%s is drawn as %s", (eventType: string, icon: IconProp) => {
    expect(getSloFeedEventIcon(eventType)).toBe(icon);
  });

  test.each([
    [
      ServiceLevelObjectiveFeedEventType.ServiceLevelObjectiveCreated,
      IconProp.Add,
    ],
    [
      ServiceLevelObjectiveFeedEventType.ServiceLevelObjectiveUpdated,
      IconProp.Edit,
    ],
    [
      ServiceLevelObjectiveFeedEventType.ServiceLevelObjectiveArchived,
      IconProp.Archive,
    ],
    [
      ServiceLevelObjectiveFeedEventType.ServiceLevelObjectiveRestored,
      IconProp.Refresh,
    ],
    [ServiceLevelObjectiveFeedEventType.OwnerUserAdded, IconProp.User],
    [ServiceLevelObjectiveFeedEventType.OwnerTeamAdded, IconProp.Team],
    [ServiceLevelObjectiveFeedEventType.OwnerUserRemoved, IconProp.Close],
    [ServiceLevelObjectiveFeedEventType.OwnerTeamRemoved, IconProp.Close],
  ])(
    "%s is left to the shared rules, so it looks like every other feed's",
    (eventType: string, icon: IconProp) => {
      expect(getSloFeedEventIcon(eventType)).toBeUndefined();
      expect(
        resolveResourceFeedIcon({
          eventType: eventType,
          getIcon: getSloFeedEventIcon,
        }),
      ).toBe(icon);
    },
  );

  test("opposite events never share an icon", () => {
    const pairs: Array<[string, string]> = [
      [
        ServiceLevelObjectiveFeedEventType.ServiceLevelObjectiveEnabled,
        ServiceLevelObjectiveFeedEventType.ServiceLevelObjectiveDisabled,
      ],
      [
        ServiceLevelObjectiveFeedEventType.MonitorsAttached,
        ServiceLevelObjectiveFeedEventType.MonitorsDetached,
      ],
      [
        ServiceLevelObjectiveFeedEventType.BurnRateAlertRaised,
        ServiceLevelObjectiveFeedEventType.BurnRateAlertResolved,
      ],
      [
        ServiceLevelObjectiveFeedEventType.BurnRateIncidentDeclared,
        ServiceLevelObjectiveFeedEventType.BurnRateIncidentResolved,
      ],
      [
        ServiceLevelObjectiveFeedEventType.BurnRateAlertRaised,
        ServiceLevelObjectiveFeedEventType.BurnRateIncidentDeclared,
      ],
    ];

    for (const [first, second] of pairs) {
      expect(getSloFeedEventIcon(first)).not.toBe(getSloFeedEventIcon(second));
    }
  });
});

describe("SloFeed", () => {
  function statusChangedItem(markdown: string): ServiceLevelObjectiveFeed {
    const item: ServiceLevelObjectiveFeed = new ServiceLevelObjectiveFeed(
      ObjectID.generate(),
    );
    item.feedInfoInMarkdown = markdown;
    item.serviceLevelObjectiveFeedEventType =
      ServiceLevelObjectiveFeedEventType.StatusChanged;
    item.displayColor = Yellow;
    item.postedAt = new Date("2026-09-15T10:00:00.000Z");
    return item;
  }

  test("reads this SLO's feed, newest first, including the event type the icon comes from", async () => {
    render(<SloFeed sloId={SLO_ID} />);

    await waitFor(() => {
      expect(mockGetListCalls.length).toBe(1);
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const request: any = mockGetListCalls[0]!;

    expect(request.modelType).toBe(ServiceLevelObjectiveFeed);
    expect(request.query.serviceLevelObjectiveId).toBe(SLO_ID);
    expect(request.select.serviceLevelObjectiveFeedEventType).toBe(true);
    expect(request.select.postedAt).toBe(true);
  });

  test("renders what the SLO's history says, under the default title", async () => {
    mockGetListResponse = (): Promise<unknown> => {
      return Promise.resolve({
        data: [statusChangedItem("SLO Checkout is now At Risk")],
        count: 1,
      });
    };

    render(<SloFeed sloId={SLO_ID} />);

    await waitFor(() => {
      expect(
        screen.getByText(/SLO Checkout is now At Risk/),
      ).toBeInTheDocument();
    });

    expect(screen.getByText("SLO Feed")).toBeInTheDocument();
  });

  test("an embedded feed shows its own title, and says so when there is no history yet", async () => {
    render(<SloFeed sloId={SLO_ID} title="Recent activity" />);

    await waitFor(() => {
      expect(
        screen.getByText("No activity has been recorded for this SLO yet."),
      ).toBeInTheDocument();
    });

    expect(screen.getByText("Recent activity")).toBeInTheDocument();
  });
});
