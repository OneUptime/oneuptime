import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";
import { PROJECT_ID, goTo } from "./SideMenuHarness";
import MonitorCloudLinkSuggestions from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorCloudLinkSuggestions";
import {
  CLOUD_RESOURCE_SUGGESTIONS_ROUTE,
  linkCloudResourceToMonitor,
  readCloudLinkSuggestions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/CloudLinkSuggestionsApi";

/*
 * Under a monitor's Linked Resources: the cloud resources it seems to
 * check, each one Link away - nothing at all while there is nothing to
 * suggest, a disabled Link with why for someone who may not change the
 * links, and the monitor's other links kept when one is added.
 */

const MONITOR_ID: ObjectID = new ObjectID(
  "0193c0de-5555-4aaa-8bbb-000000000005",
);
const ALB_ID: string = "33333333-3333-4333-8333-333333333333";
const EXISTING_ID: string = "44444444-4444-4444-8444-444444444444";

const SUGGESTION: Record<string, string> = {
  cloudResourceId: ALB_ID,
  name: "web-alb",
  type: "AWS::ElasticLoadBalancingV2::LoadBalancer",
  provider: "aws",
  endpoint: "web-alb-123.eu-west-1.elb.amazonaws.com",
  via: "shop.example.com",
};

let getSpy: jest.SpyInstance<any, any>;
let gateSpy: jest.SpyInstance<any, any>;

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/monitors/${MONITOR_ID.toString()}`);
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
  getSpy = getJestSpyOn(API, "get").mockResolvedValue({
    data: { suggestions: [SUGGESTION] },
  });
  gateSpy = getJestSpyOn(PermissionGate, "checkColumnUpdate").mockReturnValue({
    isAllowed: true,
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderSuggestions(onLinked?: MockFunction): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <MonitorCloudLinkSuggestions
          monitorId={MONITOR_ID}
          onLinked={onLinked || getJestMockFunction()}
        />
      </MemoryRouter>,
    );
  });
}

describe("suggested cloud resources", () => {
  test("asks the server for this monitor's, and names each with how the host leads to it", async () => {
    await renderSuggestions();

    expect(
      await screen.findByTestId("monitor-cloud-link-suggestions"),
    ).toBeInTheDocument();
    expect(getSpy.mock.calls[0]![0].url.toString()).toContain(
      `${CLOUD_RESOURCE_SUGGESTIONS_ROUTE}/${MONITOR_ID.toString()}`,
    );
    expect(screen.getByText("web-alb")).toBeInTheDocument();
    expect(
      screen.getByText(
        "shop.example.com leads to web-alb-123.eu-west-1.elb.amazonaws.com, which it answers on.",
      ),
    ).toBeInTheDocument();
  });

  test("a resource answering on the monitor's own host says just that", async () => {
    getSpy.mockResolvedValue({
      data: {
        suggestions: [{ ...SUGGESTION, via: SUGGESTION["endpoint"] }],
      },
    });

    await renderSuggestions();

    expect(
      await screen.findByText(
        "It answers on web-alb-123.eu-west-1.elb.amazonaws.com.",
      ),
    ).toBeInTheDocument();
  });

  test("nothing to suggest, or no answer: nothing is drawn", async () => {
    getSpy.mockResolvedValue({ data: { suggestions: [] } });
    await renderSuggestions();
    expect(
      screen.queryByTestId("monitor-cloud-link-suggestions"),
    ).not.toBeInTheDocument();

    cleanup();
    getSpy.mockRejectedValue(new Error("network"));
    await renderSuggestions();
    expect(
      screen.queryByTestId("monitor-cloud-link-suggestions"),
    ).not.toBeInTheDocument();
  });

  test("Link adds it to the monitor's cloud resources, keeping the others, then reads the card again", async () => {
    const existing: CloudResource = new CloudResource();
    existing._id = EXISTING_ID;
    const monitor: Monitor = new Monitor();
    monitor.cloudResources = [existing];

    getJestSpyOn(ModelAPI, "getItem").mockResolvedValue(monitor);
    const updateSpy: jest.SpyInstance<any, any> = getJestSpyOn(
      ModelAPI,
      "updateById",
    ).mockResolvedValue({});
    const onLinked: MockFunction = getJestMockFunction();

    await renderSuggestions(onLinked);

    await act(async () => {
      fireEvent.click(
        await screen.findByTestId(`link-cloud-resource-${ALB_ID}`),
      );
    });

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledTimes(1);
    });
    expect(updateSpy.mock.calls[0]![0].data).toEqual({
      cloudResources: [EXISTING_ID, ALB_ID],
    });
    expect(updateSpy.mock.calls[0]![0].id.toString()).toBe(
      MONITOR_ID.toString(),
    );
    await waitFor(() => {
      expect(onLinked).toHaveBeenCalledTimes(1);
    });
    // The suggestions are read again: the linked one drops out on the server.
    await waitFor(() => {
      expect(getSpy).toHaveBeenCalledTimes(2);
    });
  });

  test("a link that fails says why, and can be tried again", async () => {
    getJestSpyOn(ModelAPI, "getItem").mockResolvedValue(new Monitor());
    getJestSpyOn(ModelAPI, "updateById").mockRejectedValue(
      new Error("You do not have permission to update this monitor."),
    );

    await renderSuggestions();

    await act(async () => {
      fireEvent.click(
        await screen.findByTestId(`link-cloud-resource-${ALB_ID}`),
      );
    });

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByTestId(`link-cloud-resource-${ALB_ID}`),
    ).not.toBeDisabled();
  });

  test("someone who may not change the links sees why Link is off", async () => {
    gateSpy.mockReturnValue({
      isAllowed: false,
      disabledReason: "You need Edit Monitor to change its links.",
    });

    await renderSuggestions();

    expect(
      await screen.findByTestId(`link-cloud-resource-${ALB_ID}`),
    ).toBeDisabled();
  });

  test("someone who may not change the links, and may not be told why, is offered nothing", async () => {
    gateSpy.mockReturnValue({ isAllowed: false });

    await renderSuggestions();
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      screen.queryByTestId("monitor-cloud-link-suggestions"),
    ).not.toBeInTheDocument();
  });
});

describe("the answer and the link, without React", () => {
  test("a malformed suggestion is dropped", () => {
    expect(
      readCloudLinkSuggestions({
        suggestions: [
          SUGGESTION,
          { ...SUGGESTION, cloudResourceId: "not-an-id" },
          null,
          "x",
          { name: "no id" },
        ],
      }),
    ).toEqual([SUGGESTION]);
    expect(readCloudLinkSuggestions(undefined)).toEqual([]);
    expect(readCloudLinkSuggestions({ suggestions: "x" })).toEqual([]);
  });

  test("linking one already linked writes nothing", async () => {
    const already: CloudResource = new CloudResource();
    already._id = ALB_ID;
    const monitor: Monitor = new Monitor();
    monitor.cloudResources = [already];

    getJestSpyOn(ModelAPI, "getItem").mockResolvedValue(monitor);
    const updateSpy: jest.SpyInstance<any, any> = getJestSpyOn(
      ModelAPI,
      "updateById",
    ).mockResolvedValue({});

    await linkCloudResourceToMonitor({
      monitorId: MONITOR_ID,
      cloudResourceId: ALB_ID,
    });

    expect(updateSpy).not.toHaveBeenCalled();
  });
});
