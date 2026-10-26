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
  within,
} from "@testing-library/react";
import * as fs from "fs";
import * as path from "path";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import { CloudEndpointSuggestion } from "../../../Types/Cloud/CloudEndpointMatch";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  Translator,
  createTranslator,
} from "../../../UI/Utils/TranslateTemplate";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";
import { PROJECT_ID, goTo } from "./SideMenuHarness";
import MonitorCloudLinkSuggestions, {
  MONITOR_CLOUD_LINK_SUGGESTIONS_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorCloudLinkSuggestions";
import {
  CLOUD_RESOURCE_SUGGESTIONS_ROUTE,
  getCloudLinkSuggestionReason,
  linkCloudResourceToMonitor,
  readCloudLinkSuggestions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/CloudLinkSuggestionsApi";

/*
 * At the foot of a monitor's Linked Resources card: the cloud resources it
 * seems to check, each in a dashed box (offered, not linked) with its
 * type, why it is offered and Link resource - nothing at all while there
 * is nothing to suggest, a disabled Link resource with why for someone who
 * may not change the links, and the monitor's other links kept when one
 * is added.
 */

const MONITOR_ID: ObjectID = new ObjectID(
  "0193c0de-5555-4aaa-8bbb-000000000005",
);
const ALB_ID: string = "33333333-3333-4333-8333-333333333333";
const CDN_ID: string = "55555555-5555-4555-8555-555555555555";
const EXISTING_ID: string = "44444444-4444-4444-8444-444444444444";

const SUGGESTION: CloudEndpointSuggestion = {
  cloudResourceId: ALB_ID,
  name: "web-alb",
  type: "AWS::ElasticLoadBalancingV2::LoadBalancer",
  provider: "aws",
  endpoint: "web-alb-123.eu-west-1.elb.amazonaws.com",
  via: "shop.example.com",
};

const DIRECT: CloudEndpointSuggestion = {
  cloudResourceId: CDN_ID,
  name: "shop-cdn",
  type: "AWS::CloudFront::Distribution",
  provider: "aws",
  endpoint: "shop.example.com",
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
  test("asks the server for this monitor's, and names each with its type and how the host leads to it", async () => {
    await renderSuggestions();

    const section: HTMLElement = await screen.findByTestId(
      MONITOR_CLOUD_LINK_SUGGESTIONS_TEST_ID,
    );
    expect(getSpy.mock.calls[0]![0].url.toString()).toContain(
      `${CLOUD_RESOURCE_SUGGESTIONS_ROUTE}/${MONITOR_ID.toString()}`,
    );

    // A section of the card, named by its heading, not a card of its own.
    expect(
      screen.getByRole("region", { name: "Suggested Cloud Resources" }),
    ).toBe(section);
    expect(section.tagName).toBe("SECTION");
    expect(section.querySelector('[data-testid="card"]')).toBeNull();

    const item: HTMLElement = within(section).getByTestId(
      "monitor-cloud-link-suggestion",
    );
    // Offered, not linked: a dashed box.
    expect(item.className).toContain("border-dashed");
    expect(within(item).getByRole("link", { name: "web-alb" })).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/cloud/${ALB_ID}`,
    );
    expect(
      within(item).getByText("Elastic Load Balancer (ALB, NLB, GWLB)"),
    ).toBeInTheDocument();

    const reason: HTMLElement = within(item).getByTestId(
      "monitor-cloud-link-suggestion-reason",
    );
    expect(reason).toHaveTextContent(
      "shop.example.com points to web-alb-123.eu-west-1.elb.amazonaws.com",
    );
    // Two lines at most, any name broken where it must, the whole on hover.
    expect(reason.className).toContain("line-clamp-2");
    expect(reason.className).toContain("[overflow-wrap:anywhere]");
    expect(reason).toHaveAttribute(
      "title",
      "shop.example.com points to web-alb-123.eu-west-1.elb.amazonaws.com",
    );
  });

  test("a resource answering on the monitor's own host says just that", async () => {
    getSpy.mockResolvedValue({ data: { suggestions: [DIRECT] } });

    await renderSuggestions();

    expect(
      await screen.findByTestId("monitor-cloud-link-suggestion-reason"),
    ).toHaveTextContent("Answers on shop.example.com");
  });

  test("several suggestions are listed in the order the server ranked them, each with its own Link resource", async () => {
    getSpy.mockResolvedValue({ data: { suggestions: [DIRECT, SUGGESTION] } });

    await renderSuggestions();

    const items: Array<HTMLElement> = await screen.findAllByTestId(
      "monitor-cloud-link-suggestion",
    );
    expect(
      items.map((item: HTMLElement): string => {
        return within(item).getAllByRole("link")[0]!.textContent || "";
      }),
    ).toEqual(["shop-cdn", "web-alb"]);
    expect(
      screen.getByTestId(`link-cloud-resource-${CDN_ID}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`link-cloud-resource-${ALB_ID}`),
    ).toBeInTheDocument();
  });

  test("each Link resource names the resource it links, for a screen reader", async () => {
    await renderSuggestions();

    expect(await screen.findByRole("button", { name: "Link web-alb" })).toBe(
      screen.getByTestId(`link-cloud-resource-${ALB_ID}`),
    );
  });

  test("nothing to suggest, or no answer: nothing is drawn", async () => {
    getSpy.mockResolvedValue({ data: { suggestions: [] } });
    await renderSuggestions();
    expect(
      screen.queryByTestId(MONITOR_CLOUD_LINK_SUGGESTIONS_TEST_ID),
    ).not.toBeInTheDocument();

    cleanup();
    getSpy.mockRejectedValue(new Error("network"));
    await renderSuggestions();
    expect(
      screen.queryByTestId(MONITOR_CLOUD_LINK_SUGGESTIONS_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("Link resource adds it to the monitor's cloud resources, keeping the others, then reads the card again", async () => {
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

  test("while one is being linked, no other Link resource can be pressed", async () => {
    getSpy.mockResolvedValue({ data: { suggestions: [DIRECT, SUGGESTION] } });
    getJestSpyOn(ModelAPI, "getItem").mockReturnValue(
      new Promise<Monitor>(() => {
        // never answers: the link stays in progress
      }),
    );

    await renderSuggestions();

    await act(async () => {
      fireEvent.click(
        await screen.findByTestId(`link-cloud-resource-${CDN_ID}`),
      );
    });

    expect(screen.getByTestId(`link-cloud-resource-${ALB_ID}`)).toBeDisabled();
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

  test("someone who may not change the links sees why Link resource is off", async () => {
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
      screen.queryByTestId(MONITOR_CLOUD_LINK_SUGGESTIONS_TEST_ID),
    ).not.toBeInTheDocument();
  });
});

describe("why a resource is suggested", () => {
  const english: Translator = createTranslator(undefined, "en");

  test("a name the host points to says the host and that name", () => {
    expect(getCloudLinkSuggestionReason(english, SUGGESTION)).toBe(
      "shop.example.com points to web-alb-123.eu-west-1.elb.amazonaws.com",
    );
  });

  test("the host itself, in any case, says it answers on it", () => {
    expect(getCloudLinkSuggestionReason(english, DIRECT)).toBe(
      "Answers on shop.example.com",
    );
    expect(
      getCloudLinkSuggestionReason(english, {
        ...DIRECT,
        via: "Shop.Example.COM",
      }),
    ).toBe("Answers on shop.example.com");
  });

  test("with no host recorded, the endpoint it answers on", () => {
    expect(
      getCloudLinkSuggestionReason(english, { ...SUGGESTION, via: "" }),
    ).toBe("Answers on web-alb-123.eu-west-1.elb.amazonaws.com");
  });

  test("in the reader's language: the sentence is looked up whole", () => {
    const words: Record<string, string> = {
      "Answers on {{host}}": "Antwortet auf {{host}}",
      "{{host}} points to {{endpoint}}": "{{host}} verweist auf {{endpoint}}",
    };
    const german: Translator = createTranslator(
      (text: string): string | undefined => {
        return words[text];
      },
      "de",
    );

    expect(getCloudLinkSuggestionReason(german, DIRECT)).toBe(
      "Antwortet auf shop.example.com",
    );
    expect(getCloudLinkSuggestionReason(german, SUGGESTION)).toBe(
      "shop.example.com verweist auf web-alb-123.eu-west-1.elb.amazonaws.com",
    );
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

/*
 * Where they are drawn: inside the Linked Resources card, under what the
 * monitor is linked to - the field's own element - so linking one reads the
 * card again, and nothing stands as a second card under it.
 */
describe("the suggestions sit in the Linked Resources card", () => {
  const CARD_SOURCE: string = fs
    .readFileSync(
      path.resolve(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorLinkedResourcesCard.tsx",
      ),
      "utf8",
    )
    .replace(/\s+/g, " ");

  test("rendered by the card's own field, after what it is linked to", () => {
    const element: number = CARD_SOURCE.indexOf(
      "getElement: (item: Monitor): ReactElement => {",
    );
    const display: number = CARD_SOURCE.indexOf(
      "<AffectedResourcesDisplay",
      element,
    );
    const suggestions: number = CARD_SOURCE.indexOf(
      "<MonitorCloudLinkSuggestions",
      element,
    );

    expect(element).toBeGreaterThan(-1);
    expect(display).toBeGreaterThan(element);
    expect(suggestions).toBeGreaterThan(display);
    // Once: not again outside the card.
    expect(CARD_SOURCE.split("<MonitorCloudLinkSuggestions").length).toBe(2);
  });

  test("a link reads the card again", () => {
    expect(CARD_SOURCE).toContain("refresher={refresher}");
    expect(CARD_SOURCE).toContain(
      "onLinked={() => { setRefresher((value: boolean): boolean => { return !value; }); }}",
    );
  });
});
