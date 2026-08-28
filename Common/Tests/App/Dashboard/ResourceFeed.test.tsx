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
 * ModelAPI is the only thing between this component and the network. Stubbed
 * inline rather than through a helper because jest.mock is hoisted above the
 * imports - a helper imported from another module is not initialised yet when
 * the factory runs. The names carry the "mock" prefix jest requires of
 * anything a hoisted factory closes over.
 */
type GetListRequest = Record<string, Record<string, unknown>>;

const mockGetListCalls: Array<GetListRequest> = [];

let mockGetListResponse: () => Promise<unknown> = (): Promise<unknown> => {
  return Promise.resolve({ data: [], count: 0 });
};

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (request: GetListRequest): Promise<unknown> => {
        mockGetListCalls.push(request);
        return mockGetListResponse();
      },
    },
  };
});

import ResourceFeed, {
  getIconForEventType,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceFeed/ResourceFeed";
import KubernetesClusterFeed, {
  KubernetesClusterFeedEventType,
} from "../../../Models/DatabaseModels/KubernetesClusterFeed";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import { Green500 } from "../../../Types/BrandColors";

/*
 * One component serves all nine resource feeds, parameterised by the two
 * column names that differ between them. That is what makes it worth testing
 * once and worth testing carefully: the query column and the event-type column
 * arrive as strings, so a typo in either compiles perfectly and produces an
 * empty feed (wrong query column) or an every-item-looks-the-same timeline
 * (wrong event-type column).
 */

const CLUSTER_ID: ObjectID = ObjectID.generate();

function feedItem(
  eventType: KubernetesClusterFeedEventType,
  markdown: string,
): KubernetesClusterFeed {
  const item: KubernetesClusterFeed = new KubernetesClusterFeed(
    ObjectID.generate(),
  );
  item.feedInfoInMarkdown = markdown;
  item.kubernetesClusterFeedEventType = eventType;
  item.displayColor = Green500;
  item.postedAt = new Date("2024-01-15T10:30:00.000Z");
  return item;
}

function renderFeed(): void {
  render(
    <ResourceFeed<KubernetesClusterFeed>
      modelType={KubernetesClusterFeed}
      resourceIdColumn="kubernetesClusterId"
      resourceId={CLUSTER_ID}
      eventTypeColumn="kubernetesClusterFeedEventType"
      title="Kubernetes Cluster Feed"
      description="Everything that has happened to this Kubernetes cluster."
      noItemsMessage="No activity has been recorded for this Kubernetes cluster yet."
    />,
  );
}

beforeEach(() => {
  mockGetListCalls.length = 0;
  mockGetListResponse = (): Promise<unknown> => {
    return Promise.resolve({ data: [], count: 0 });
  };
});

afterEach(() => {
  cleanup();
});

describe("ResourceFeed", () => {
  test("queries the feed for the resource it was given", async () => {
    renderFeed();

    await waitFor(() => {
      expect(mockGetListCalls.length).toBe(1);
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const request: any = mockGetListCalls[0]!;

    expect(request.modelType).toBe(KubernetesClusterFeed);
    expect(request.query.kubernetesClusterId).toBe(CLUSTER_ID);

    /*
     * The event type drives the icon. Forgetting to select it renders every
     * item with the fallback dot and nothing else goes wrong, so nothing else
     * would catch it.
     */
    expect(request.select.kubernetesClusterFeedEventType).toBe(true);
    expect(request.select.feedInfoInMarkdown).toBe(true);
    expect(request.select.postedAt).toBe(true);
  });

  test("renders the items it is given", async () => {
    mockGetListResponse = (): Promise<unknown> => {
      return Promise.resolve({
        data: [
          feedItem(
            KubernetesClusterFeedEventType.KubernetesClusterCreated,
            "cluster was created automatically",
          ),
          feedItem(
            KubernetesClusterFeedEventType.OwnerUserAdded,
            "Jane Doe was added as an owner",
          ),
        ],
        count: 2,
      });
    };

    renderFeed();

    await waitFor(() => {
      expect(
        screen.getByText(/cluster was created automatically/),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText(/Jane Doe was added as an owner/),
    ).toBeInTheDocument();
  });

  test("says so when the resource has no history yet", async () => {
    renderFeed();

    await waitFor(() => {
      expect(
        screen.getByText(
          "No activity has been recorded for this Kubernetes cluster yet.",
        ),
      ).toBeInTheDocument();
    });
  });

  test("surfaces a failed load instead of an empty timeline", async () => {
    /*
     * An error rendered as "no activity" is worse than an error: it tells the
     * reader the resource has no history when the truth is unknown.
     */
    mockGetListResponse = (): Promise<unknown> => {
      return Promise.reject(new Error("nope"));
    };

    renderFeed();

    await waitFor(() => {
      expect(
        screen.queryByText(
          "No activity has been recorded for this Kubernetes cluster yet.",
        ),
      ).not.toBeInTheDocument();
    });
  });
});

describe("getIconForEventType", () => {
  test("gives each resource lifecycle event its own icon", () => {
    /*
     * Matched on the suffix, because every family names these after its own
     * model - KubernetesClusterCreated, DockerHostCreated, ServiceCreated and
     * so on. One mapping, nine enums.
     */
    for (const model of [
      "KubernetesCluster",
      "DockerHost",
      "DockerSwarmCluster",
      "CephCluster",
      "PodmanHost",
      "ProxmoxCluster",
      "Host",
      "CloudResource",
      "Service",
    ]) {
      expect(getIconForEventType(`${model}Created`)).toBe(IconProp.Add);
      expect(getIconForEventType(`${model}Updated`)).toBe(IconProp.Edit);
      expect(getIconForEventType(`${model}Archived`)).toBe(IconProp.Archive);
      expect(getIconForEventType(`${model}Restored`)).toBe(IconProp.Refresh);
    }
  });

  test("distinguishes owners being added from owners being removed", () => {
    expect(getIconForEventType("OwnerUserAdded")).toBe(IconProp.User);
    expect(getIconForEventType("OwnerTeamAdded")).toBe(IconProp.Team);
    expect(getIconForEventType("OwnerUserRemoved")).toBe(IconProp.Close);
    expect(getIconForEventType("OwnerTeamRemoved")).toBe(IconProp.Close);
  });

  test("marks rule-driven events apart from hand-made ones", () => {
    expect(getIconForEventType("OwnerRuleExecuted")).toBe(IconProp.Team);
    expect(getIconForEventType("LabelRuleExecuted")).toBe(IconProp.Label);
  });

  test("falls back rather than throwing on an event it has never seen", () => {
    expect(getIconForEventType("SomethingNobodyHasWrittenYet")).toBe(
      IconProp.Circle,
    );
    expect(getIconForEventType("")).toBe(IconProp.Circle);
  });
});
