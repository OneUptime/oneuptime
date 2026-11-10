import "@testing-library/jest-dom";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Route from "../../../Types/API/Route";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import { PRODUCT_ANALYTICS_USER_PROPERTY_LIMITS } from "../../../Types/Rum/ProductAnalyticsEvents";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * Product Analytics > Analytics Settings
 * (Pages/Rum/View/ProductAnalyticsSettings.tsx), issue #6444, part two:
 * one switch that saves the moment it is flipped - whether the recorders
 * send the application's events - and the identify() traits the events
 * keep, as chips. The switch's words say what it sends, from which
 * sessions, and that consent and Do Not Track still apply; the panel the
 * Events, Funnels and Retention pages show while it is off holds the same
 * switch, and both say when Session Replay, whose recorder sends the
 * events, is off too - with the way to the page that turns it on.
 *
 * CardModelDetail is a stand-in that records its props (its own suite draws
 * it); the switch card is the real one, over a stand-in ModelAPI.
 */

const mockDetails: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      mockDetails.push(props);

      return React.createElement("div", {
        "data-testid": "card-model-detail-stand-in",
        "data-name": props["name"],
      });
    },
  };
});

const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

import RumApplicationProductAnalyticsSettings, {
  ProductAnalyticsUserPropertyChips,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/ProductAnalyticsSettings";
import ProductAnalyticsEventsSwitchCopy, {
  PRODUCT_ANALYTICS_EVENTS_SWITCH_COLUMN,
  PRODUCT_ANALYTICS_EVENTS_SWITCH_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ProductAnalytics/ProductAnalyticsEventsSwitchCopy";
import {
  ProductAnalyticsEventsOff,
  ProductAnalyticsNoEventsYet,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ProductAnalytics/ProductAnalyticsEventsGate";

const PROJECT_ID: string = "0193a1b2-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
const APP_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";
const PAGE_PATH: string = `/dashboard/${PROJECT_ID}/rum/${APP_ID}/product-analytics-settings`;

let stored: JSONObject = {};

// The application's Replay Policy page, for the project the address names.
function replayPolicyPath(): string {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_SETTINGS] as Route,
    { modelId: new ObjectID(APP_ID) },
  ).toString();
}

function drawPage(): void {
  window.history.replaceState(null, "", PAGE_PATH);
  render(
    <MemoryRouter>
      <RumApplicationProductAnalyticsSettings
        pageRoute={new Route(PAGE_PATH)}
        currentProject={null}
        hasPaymentMethod={false}
      />
    </MemoryRouter>,
  );
}

function card(name: string): Record<string, unknown> {
  const drawn: Array<Record<string, unknown>> = mockDetails.filter(
    (props: Record<string, unknown>): boolean => {
      return props["name"] === name;
    },
  );

  expect(drawn.length).toBeGreaterThan(0);

  return drawn[drawn.length - 1]!;
}

function chipTexts(keys: unknown): Array<string> {
  const { container } = render(
    <ProductAnalyticsUserPropertyChips keys={keys as Array<string>} />,
  );

  return Array.from(container.querySelectorAll("code")).map(
    (chip: Element): string => {
      return chip.textContent || "";
    },
  );
}

beforeEach(() => {
  mockDetails.length = 0;
  stored = {};
  getItemMock.mockReset();
  updateByIdMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    const item: RumApplication = new RumApplication();

    for (const [key, value] of Object.entries(stored)) {
      (item as unknown as Record<string, unknown>)[key] = value;
    }

    return item;
  });
  updateByIdMock.mockImplementation(async (): Promise<unknown> => {
    return {};
  });
  getJestSpyOn(PermissionGate, "checkColumnUpdate").mockImplementation(
    (): PermissionGateResult => {
      return { isAllowed: true };
    },
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the switch's words", () => {
  test("say what is sent, from which sessions, and that consent and Do Not Track still apply", () => {
    expect(ProductAnalyticsEventsSwitchCopy.cardDescription).toContain(
      "track()",
    );
    expect(ProductAnalyticsEventsSwitchCopy.cardDescription).toContain(
      "metric()",
    );
    expect(ProductAnalyticsEventsSwitchCopy.switchDescription).toContain(
      "recorded or not",
    );
    expect(ProductAnalyticsEventsSwitchCopy.switchDescription).toContain(
      "Do Not Track",
    );
    expect(PRODUCT_ANALYTICS_EVENTS_SWITCH_COLUMN).toBe(
      "isProductAnalyticsEnabled",
    );
  });

  /*
   * A switch's and a field's description is one line on a phone: at most
   * 150 characters (App's ShortDescriptionsGuard). Shortened to fit
   * (issue #6660), each still says everything it said before.
   */
  test("fit the 150 characters a switch's or a field's description has", () => {
    for (const description of [
      ProductAnalyticsEventsSwitchCopy.switchDescription,
      ProductAnalyticsEventsSwitchCopy.offDescription,
      ProductAnalyticsEventsSwitchCopy.propertiesFieldDescription,
    ]) {
      expect({ description, fits: description.length <= 150 }).toEqual({
        description,
        fits: true,
      });
    }
  });

  test("the switch says what is sent, recorded or not, and what still applies", () => {
    for (const said of [
      "session starts",
      "page views",
      "track()",
      "metric()",
      "from every session, recorded or not",
      "Consent",
      "Do Not Track",
      "allowed origins",
    ]) {
      expect(ProductAnalyticsEventsSwitchCopy.switchDescription).toContain(
        said,
      );
    }
  });

  test("turning events on changes nothing on the pages: the Session Replay recorder sends them", () => {
    for (const said of [
      "session starts",
      "page views",
      "track()",
      "Nothing changes on your pages",
      "Session Replay recorder",
    ]) {
      expect(ProductAnalyticsEventsSwitchCopy.offDescription).toContain(said);
    }
  });

  test("the user properties field gives the format, the limit, when they are kept and what never to list", () => {
    const description: string =
      ProductAnalyticsEventsSwitchCopy.propertiesFieldDescription;

    expect(description).toContain("identify()");
    expect(description).toContain('JSON array: ["plan", "role"]');
    expect(description).toContain(
      `Up to ${PRODUCT_ANALYTICS_USER_PROPERTY_LIMITS.maxKeys},`,
    );
    expect(description).toContain("while end-user identity capture is on");
    expect(description).toContain("No personal data");
  });
});

describe("Analytics Settings", () => {
  test("the switch reads the application, and is off for one that never turned events on", async () => {
    drawPage();

    const toggle: HTMLElement = await screen.findByRole("switch", {
      name: "Send product analytics events",
    });

    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(getItemMock).toHaveBeenCalled();

    const read: { id: ObjectID; select: JSONObject } = getItemMock.mock
      .calls[0]![0] as { id: ObjectID; select: JSONObject };

    expect(read.id.toString()).toBe(APP_ID);
    expect(read.select).toEqual(
      expect.objectContaining({ isProductAnalyticsEnabled: true }),
    );
    expect(
      screen.getByTestId(`${PRODUCT_ANALYTICS_EVENTS_SWITCH_TEST_ID}-card`),
    ).toBeInTheDocument();
    expect(screen.getByText("Product Analytics")).toBeInTheDocument();
  });

  test("flipping it saves the one column at once", async () => {
    stored = { isProductAnalyticsEnabled: true };
    drawPage();

    const toggle: HTMLElement = await screen.findByRole("switch", {
      name: "Send product analytics events",
    });

    await waitFor(() => {
      expect(toggle).toHaveAttribute("aria-checked", "true");
    });

    await act(async () => {
      fireEvent.click(toggle);
    });

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    const write: { id: ObjectID; data: JSONObject } = updateByIdMock.mock
      .calls[0]![0] as { id: ObjectID; data: JSONObject };

    expect(write.id.toString()).toBe(APP_ID);
    expect(write.data).toEqual({ isProductAnalyticsEnabled: false });
  });

  test("with Session Replay off, says under the switch that its recorder sends the events, with the way to Replay Policy", async () => {
    stored = { isProductAnalyticsEnabled: true, isSessionReplayEnabled: false };
    drawPage();

    const note: HTMLElement = await screen.findByTestId(
      "product-analytics-events-replay-off",
    );

    expect(note).toHaveTextContent(
      "Session Replay is off for this application, and its recorder is what sends the events. Turn it on under Replay Policy too.",
    );
    expect(
      screen.getByTestId(`${PRODUCT_ANALYTICS_EVENTS_SWITCH_TEST_ID}-details`),
    ).toContainElement(note);
    expect(screen.getByRole("link", { name: "Replay Policy" })).toHaveAttribute(
      "href",
      replayPolicyPath(),
    );
    expect(
      (getItemMock.mock.calls[0]![0] as { select: JSONObject }).select,
    ).toEqual(expect.objectContaining({ isSessionReplayEnabled: true }));
  });

  test("with Session Replay on, says nothing of it", async () => {
    stored = { isProductAnalyticsEnabled: true, isSessionReplayEnabled: true };
    drawPage();

    await waitFor(() => {
      expect(
        screen.getByRole("switch", { name: "Send product analytics events" }),
      ).toHaveAttribute("aria-checked", "true");
    });
    expect(
      screen.queryByTestId("product-analytics-events-replay-off"),
    ).not.toBeInTheDocument();
  });

  test("the user properties card edits one JSON list and shows it as chips", () => {
    drawPage();

    const properties: Record<string, unknown> = card(
      "User Properties for Analytics",
    );

    expect(
      (properties["cardProps"] as { title: string; description: string }).title,
    ).toBe("User Properties for Analytics");
    expect(
      (properties["cardProps"] as { title: string; description: string })
        .description,
    ).toBe(ProductAnalyticsEventsSwitchCopy.propertiesCardDescription);
    expect(properties["isEditable"]).toBe(true);
    /* Its dialog is titled for what it edits, not the whole application. */
    expect(properties["editButtonText"]).toBe("Edit User Properties");
    expect(properties["editModalTitle"]).toBe("Edit User Properties");

    const formFields: Array<{
      field: Record<string, boolean>;
      fieldType: FormFieldSchemaType;
      required: boolean;
    }> = properties["formFields"] as Array<{
      field: Record<string, boolean>;
      fieldType: FormFieldSchemaType;
      required: boolean;
    }>;

    expect(formFields).toHaveLength(1);
    expect(formFields[0]!.field).toEqual({
      productAnalyticsUserPropertyKeys: true,
    });
    expect(formFields[0]!.fieldType).toBe(FormFieldSchemaType.JSON);
    expect(formFields[0]!.required).toBe(false);

    const detail: {
      modelId: ObjectID;
      fields: Array<{ getElement: (item: RumApplication) => ReactElement }>;
    } = properties["modelDetailProps"] as {
      modelId: ObjectID;
      fields: Array<{ getElement: (item: RumApplication) => ReactElement }>;
    };

    expect(detail.modelId.toString()).toBe(APP_ID);

    const item: RumApplication = new RumApplication();

    item.productAnalyticsUserPropertyKeys = ["plan", "role"];

    const { container } = render(detail.fields[0]!.getElement(item));

    expect(
      Array.from(container.querySelectorAll("code")).map(
        (chip: Element): string => {
          return chip.textContent || "";
        },
      ),
    ).toEqual(["plan", "role"]);
  });
});

describe("the user property chips", () => {
  test("show each key once, as the application wrote it, at most the cap", () => {
    expect(chipTexts([" plan ", "Plan", "role", "", 7, "__proto__"])).toEqual([
      "plan",
      "role",
    ]);

    const many: Array<string> = Array.from(
      { length: PRODUCT_ANALYTICS_USER_PROPERTY_LIMITS.maxKeys + 5 },
      (_value: unknown, index: number): string => {
        return `trait${index}`;
      },
    );

    expect(chipTexts(many)).toHaveLength(
      PRODUCT_ANALYTICS_USER_PROPERTY_LIMITS.maxKeys,
    );
  });

  test.each([undefined, [], ["  "], "plan"])(
    "%p shows that the events carry none",
    (keys: unknown) => {
      const { container } = render(
        <ProductAnalyticsUserPropertyChips keys={keys as Array<string>} />,
      );

      expect(container).toHaveTextContent(
        "None: events carry no user properties",
      );
    },
  );
});

describe("the panels the pages show before there is anything to read", () => {
  function drawn(element: ReactElement): void {
    window.history.replaceState(null, "", PAGE_PATH);
    render(<MemoryRouter>{element}</MemoryRouter>);
  }

  test("events off: the switch, saying what turning it on does; once on, what it sends", async () => {
    const onSaved: MockFunction = getJestMockFunction();

    drawn(
      <ProductAnalyticsEventsOff
        rumApplicationId={new ObjectID(APP_ID)}
        isSessionReplayEnabled={true}
        onSaved={onSaved as unknown as (isOn: boolean) => void}
      />,
    );

    const panel: HTMLElement = screen.getByTestId(
      "product-analytics-events-off",
    );
    const toggle: HTMLElement = screen.getByRole("switch", {
      name: "Send product analytics events",
    });

    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(panel).toHaveTextContent(
      ProductAnalyticsEventsSwitchCopy.offDescription,
    );
    expect(panel).not.toHaveTextContent(
      ProductAnalyticsEventsSwitchCopy.switchDescription,
    );

    await act(async () => {
      fireEvent.click(toggle);
    });

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith(true);
    });
    expect(
      (updateByIdMock.mock.calls[0]![0] as { data: JSONObject }).data,
    ).toEqual({ isProductAnalyticsEnabled: true });
    expect(panel).toHaveTextContent(
      ProductAnalyticsEventsSwitchCopy.switchDescription,
    );
  });

  test("events off with Session Replay off: a warning under the switch, either way it is set, with the way to Replay Policy", async () => {
    drawn(
      <ProductAnalyticsEventsOff
        rumApplicationId={new ObjectID(APP_ID)}
        isSessionReplayEnabled={false}
        onSaved={(): void => {}}
      />,
    );

    const warning: HTMLElement = screen.getByTestId(
      "product-analytics-events-off-switch-warning",
    );

    expect(warning).toHaveTextContent(
      "Session Replay is off for this application, and its recorder is what sends the events. Turn it on under Replay Policy too.",
    );
    expect(
      within(warning).getByRole("link", { name: "Replay Policy" }),
    ).toHaveAttribute("href", replayPolicyPath());

    await act(async () => {
      fireEvent.click(
        screen.getByRole("switch", { name: "Send product analytics events" }),
      );
    });

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.getByTestId("product-analytics-events-replay-off"),
    ).toBeInTheDocument();
  });

  test("events off with Session Replay on says nothing of it", () => {
    drawn(
      <ProductAnalyticsEventsOff
        rumApplicationId={new ObjectID(APP_ID)}
        isSessionReplayEnabled={true}
        onSaved={(): void => {}}
      />,
    );

    expect(
      screen.queryByTestId("product-analytics-events-replay-off"),
    ).not.toBeInTheDocument();
  });

  test("none yet: both calls, written left to right whatever the page's direction, with a copy button, the guide and the recorder's install page", () => {
    drawn(
      <ProductAnalyticsNoEventsYet
        rumApplicationId={new ObjectID(APP_ID)}
        isSessionReplayEnabled={true}
      />,
    );

    const snippet: HTMLElement = screen.getByTestId(
      "product-analytics-events-snippet",
    );

    expect(snippet).toHaveAttribute("dir", "ltr");
    expect(snippet.querySelector("code")?.textContent).toBe(
      'OneUptimeReplay.track("Signed up", { plan: "pro" });\nOneUptimeReplay.metric("cart.value", 42.5, { currency: "EUR" });',
    );
    expect(
      within(snippet).getByRole("button", { name: "Copy to clipboard" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "How to send events and metrics" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Install the recorder" }),
    ).toHaveAttribute(
      "href",
      RouteUtil.populateRouteParams(
        RouteMap[
          PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_DOCUMENTATION
        ] as Route,
        { modelId: new ObjectID(APP_ID) },
      ).toString(),
    );
    expect(
      screen.queryByTestId("product-analytics-events-replay-off"),
    ).not.toBeInTheDocument();
  });

  test("none yet, with Session Replay off: says its recorder sends them, with the way to Replay Policy", () => {
    drawn(
      <ProductAnalyticsNoEventsYet
        rumApplicationId={new ObjectID(APP_ID)}
        isSessionReplayEnabled={false}
      />,
    );

    expect(
      screen.getByTestId("product-analytics-events-replay-off"),
    ).toHaveTextContent("Turn it on under Replay Policy too.");
    expect(screen.getByRole("link", { name: "Replay Policy" })).toHaveAttribute(
      "href",
      replayPolicyPath(),
    );
  });
});
