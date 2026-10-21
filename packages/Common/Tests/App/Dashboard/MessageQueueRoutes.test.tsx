import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter, Route as RouterRoute, Routes } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { PROJECT_ID } from "./SideMenuHarness";

/*
 * The Queues route group, rendered by React Router at every URL the product
 * has, with each page replaced by a marker that records its props. Pins what
 * the source-level wiring test cannot: that the static product pages
 * (archived, documentation, settings/...) win over the queue view's `:id`,
 * that every tab lands on its own page under the view layout, and that only
 * the rule VIEW routes pass the rule model.
 */

const routedPagesMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/Layout",
  () => {
    return {
      __esModule: true,
      default: () => {
        const { Outlet } = jest.requireActual("react-router-dom") as {
          Outlet: React.ComponentType;
        };
        return (
          <div data-testid="product-layout">
            <Outlet />
          </div>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/View/Layout",
  () => {
    return {
      __esModule: true,
      default: () => {
        const { Outlet } = jest.requireActual("react-router-dom") as {
          Outlet: React.ComponentType;
        };
        return (
          <div data-testid="view-layout">
            <Outlet />
          </div>
        );
      },
    };
  },
);

/*
 * One marker per page module; each records the page's props under its name.
 * (Written out per module: jest.mock factories are hoisted, so they cannot
 * share a helper.)
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/MessageQueues",
  () => {
    return {
      __esModule: true,
      default: (props: unknown) => {
        routedPagesMock("MessageQueues", props);
        return <div data-testid="page">MessageQueues</div>;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/Archived",
  () => {
    return {
      __esModule: true,
      default: (props: unknown) => {
        routedPagesMock("Archived", props);
        return <div data-testid="page">Archived</div>;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/Documentation",
  () => {
    return {
      __esModule: true,
      default: (props: unknown) => {
        routedPagesMock("ProductDocumentation", props);
        return <div data-testid="page">ProductDocumentation</div>;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/Settings/LabelRules",
  () => {
    return {
      __esModule: true,
      default: (props: unknown) => {
        routedPagesMock("LabelRules", props);
        return <div data-testid="page">LabelRules</div>;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/Settings/OwnerRules",
  () => {
    return {
      __esModule: true,
      default: (props: unknown) => {
        routedPagesMock("OwnerRules", props);
        return <div data-testid="page">OwnerRules</div>;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/View/Overview",
  () => {
    return {
      __esModule: true,
      default: (props: unknown) => {
        routedPagesMock("Overview", props);
        return <div data-testid="page">Overview</div>;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/View/Traces",
  () => {
    return {
      __esModule: true,
      default: (props: unknown) => {
        routedPagesMock("Traces", props);
        return <div data-testid="page">Traces</div>;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/View/Metrics",
  () => {
    return {
      __esModule: true,
      default: (props: unknown) => {
        routedPagesMock("Metrics", props);
        return <div data-testid="page">Metrics</div>;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/View/Owners",
  () => {
    return {
      __esModule: true,
      default: (props: unknown) => {
        routedPagesMock("Owners", props);
        return <div data-testid="page">Owners</div>;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/View/Settings",
  () => {
    return {
      __esModule: true,
      default: (props: unknown) => {
        routedPagesMock("Settings", props);
        return <div data-testid="page">Settings</div>;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/View/Documentation",
  () => {
    return {
      __esModule: true,
      default: (props: unknown) => {
        routedPagesMock("Documentation", props);
        return <div data-testid="page">Documentation</div>;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/View/Delete",
  () => {
    return {
      __esModule: true,
      default: (props: unknown) => {
        routedPagesMock("Delete", props);
        return <div data-testid="page">Delete</div>;
      },
    };
  },
);

import MessageQueueRoutes from "../../../../App/FeatureSet/Dashboard/src/Routes/MessageQueueRoutes";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import MessageQueueLabelRule from "../../../Models/DatabaseModels/MessageQueueLabelRule";
import MessageQueueOwnerRule from "../../../Models/DatabaseModels/MessageQueueOwnerRule";
import Route from "../../../Types/API/Route";

const ID: string = "5d9e2c11-7a3b-4c1d-9e8f-00000000a0b1";
const BASE: string = `/dashboard/${PROJECT_ID}/queues`;

function visit(url: string): void {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <RouterRoute
          path={RouteMap[PageMap.MESSAGE_QUEUE_ROOT]!.toString()}
          element={
            <MessageQueueRoutes
              pageRoute={new Route(BASE)}
              currentProject={null}
              hasPaymentMethod={true}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function routedProps(page: string): Record<string, any> {
  const calls: Array<Array<unknown>> = routedPagesMock.mock.calls.filter(
    (call: Array<unknown>): boolean => {
      return call[0] === page;
    },
  );
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![1] as Record<string, any>;
}

beforeEach(() => {
  routedPagesMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("the Queues route group", () => {
  test.each([
    [BASE, "MessageQueues", "product-layout", PageMap.MESSAGE_QUEUES],
    [
      `${BASE}/archived`,
      "Archived",
      "product-layout",
      PageMap.MESSAGE_QUEUES_ARCHIVED,
    ],
    [
      `${BASE}/documentation`,
      "ProductDocumentation",
      "product-layout",
      PageMap.MESSAGE_QUEUES_DOCUMENTATION,
    ],
    [
      `${BASE}/settings/label-rules`,
      "LabelRules",
      "product-layout",
      PageMap.MESSAGE_QUEUES_SETTINGS_LABEL_RULES,
    ],
    [
      `${BASE}/settings/label-rules/${ID}`,
      "LabelRules",
      "product-layout",
      PageMap.MESSAGE_QUEUES_SETTINGS_LABEL_RULES_VIEW,
    ],
    [
      `${BASE}/settings/owner-rules`,
      "OwnerRules",
      "product-layout",
      PageMap.MESSAGE_QUEUES_SETTINGS_OWNER_RULES,
    ],
    [
      `${BASE}/settings/owner-rules/${ID}`,
      "OwnerRules",
      "product-layout",
      PageMap.MESSAGE_QUEUES_SETTINGS_OWNER_RULES_VIEW,
    ],
    [`${BASE}/${ID}`, "Overview", "view-layout", PageMap.MESSAGE_QUEUE_VIEW],
    [
      `${BASE}/${ID}/traces`,
      "Traces",
      "view-layout",
      PageMap.MESSAGE_QUEUE_VIEW_TRACES,
    ],
    [
      `${BASE}/${ID}/metrics`,
      "Metrics",
      "view-layout",
      PageMap.MESSAGE_QUEUE_VIEW_METRICS,
    ],
    [
      `${BASE}/${ID}/owners`,
      "Owners",
      "view-layout",
      PageMap.MESSAGE_QUEUE_VIEW_OWNERS,
    ],
    [
      `${BASE}/${ID}/settings`,
      "Settings",
      "view-layout",
      PageMap.MESSAGE_QUEUE_VIEW_SETTINGS,
    ],
    [
      `${BASE}/${ID}/documentation`,
      "Documentation",
      "view-layout",
      PageMap.MESSAGE_QUEUE_VIEW_DOCUMENTATION,
    ],
    [
      `${BASE}/${ID}/delete`,
      "Delete",
      "view-layout",
      PageMap.MESSAGE_QUEUE_VIEW_DELETE,
    ],
  ])(
    "%s renders %s in the %s",
    (url: string, page: string, layout: string, key: string) => {
      visit(url);

      expect(screen.getByTestId(layout)).toBeInTheDocument();
      expect(screen.getAllByTestId("page")).toHaveLength(1);
      expect(screen.getByTestId("page")).toHaveTextContent(page);
      expect(routedProps(page)["pageRoute"]).toBe(RouteMap[key]);
    },
  );

  test("the product pages are never read as a queue id", () => {
    for (const segment of ["archived", "documentation"]) {
      cleanup();
      visit(`${BASE}/${segment}`);
      expect(screen.queryByTestId("view-layout")).not.toBeInTheDocument();
    }
  });

  test("only a rule VIEW route passes its rule model", () => {
    visit(`${BASE}/settings/label-rules`);
    expect(routedProps("LabelRules")["ruleViewModelType"]).toBeUndefined();
    cleanup();

    visit(`${BASE}/settings/label-rules/${ID}`);
    expect(routedProps("LabelRules")["ruleViewModelType"]).toBe(
      MessageQueueLabelRule,
    );
    cleanup();

    visit(`${BASE}/settings/owner-rules`);
    expect(routedProps("OwnerRules")["ruleViewModelType"]).toBeUndefined();
    cleanup();

    visit(`${BASE}/settings/owner-rules/${ID}`);
    expect(routedProps("OwnerRules")["ruleViewModelType"]).toBe(
      MessageQueueOwnerRule,
    );
  });

  test("an unknown tab renders no page", () => {
    visit(`${BASE}/${ID}/not-a-tab`);
    expect(screen.queryByTestId("page")).not.toBeInTheDocument();
  });
});
