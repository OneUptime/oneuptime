import "@testing-library/jest-dom";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import Page from "../../../UI/Components/Page/Page";
import ModelPage from "../../../UI/Components/Page/ModelPage";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Label from "../../../Models/DatabaseModels/Label";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";

let recordForTest: Monitor | null = null;

jest.mock("../../../UI/Utils/Analytics", () => {
  return { __esModule: true, default: { capture: jest.fn() } };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<Monitor | null> => {
        return recordForTest;
      },
    },
  };
});

beforeEach(() => {
  recordForTest = new Monitor();
  recordForTest.name = "Production API";
  document.title = "OneUptime";
});

afterEach(() => {
  cleanup();
});

describe("Page title visibility for event overviews", () => {
  test("retains an accessible h1 while the event header supplies the visible title", () => {
    render(
      <Page
        title="Incident overview"
        description="Respond to this incident"
        hideTitle={true}
      >
        <h2>Database connection failures</h2>
      </Page>,
    );

    const title: HTMLElement = screen.getByRole("heading", {
      level: 1,
      name: "Incident overview",
    });

    expect(title.closest(".sr-only")).toBeInTheDocument();
    expect(title).not.toHaveAttribute("aria-hidden");
    expect(
      screen.getByText("Respond to this incident").closest(".sr-only"),
    ).toBeInTheDocument();
    expect(
      screen
        .getByRole("heading", {
          level: 2,
          name: "Database connection failures",
        })
        .closest(".sr-only"),
    ).toBeNull();
    expect(document.title).toBe("OneUptime | Incident overview");
  });

  test("leaves existing page titles visible by default", () => {
    render(
      <Page title="Incidents">
        <p>Incident list</p>
      </Page>,
    );

    expect(
      screen
        .getByRole("heading", { level: 1, name: "Incidents" })
        .closest(".sr-only"),
    ).toBeNull();
    expect(screen.getByText("Incident list")).toBeInTheDocument();
  });

  test("preserves breadcrumbs, resource labels, and header actions when the title is visually hidden", () => {
    const label: Label = new Label();
    label.name = "Production";
    render(
      <MemoryRouter>
        <Page
          title="Incident overview"
          hideTitle={true}
          breadcrumbLinks={[
            { title: "Incidents", to: new Route("/incidents") },
            { title: "INC-42", to: new Route("/incidents/42") },
          ]}
          labels={[label]}
          headerRight={<button type="button">Subscribe</button>}
        >
          <p>Response activity</p>
        </Page>
      </MemoryRouter>,
    );

    const breadcrumbs: HTMLElement = screen.getByRole("navigation", {
      name: "Breadcrumb",
    });

    expect(
      within(breadcrumbs).getByRole("link", { name: "Incidents" }),
    ).toHaveAttribute("href", "/incidents");
    expect(within(breadcrumbs).getByText("INC-42")).toBeInTheDocument();
    expect(screen.getByText("Production").closest(".sr-only")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Subscribe" }).closest(".sr-only"),
    ).toBeNull();
    expect(document.title).toBe("OneUptime | Incidents - INC-42");
  });
});

describe("ModelPage event-overview presentation", () => {
  test.each([false, true])(
    "forwards hideTitle=%s without losing the loaded model title or body",
    async (hideTitle: boolean) => {
      render(
        <ModelPage<Monitor>
          modelType={Monitor}
          modelId={new ObjectID("11111111-1111-4111-8111-111111111111")}
          modelNameField="name"
          title="Monitor"
          hideTitle={hideTitle}
        >
          <p>Monitor overview content</p>
        </ModelPage>,
      );

      const heading: HTMLElement = await screen.findByRole("heading", {
        level: 1,
        name: "Monitor - Production API",
      });

      expect(Boolean(heading.closest(".sr-only"))).toBe(hideTitle);
      expect(screen.getByText("Monitor overview content")).toBeInTheDocument();
      await waitFor(() => {
        expect(document.title).toBe("OneUptime | Monitor - Production API");
      });
    },
  );

  test("still reports an unavailable record instead of exposing overview content", async () => {
    recordForTest = null;
    render(
      <ModelPage<Monitor>
        modelType={Monitor}
        modelId={new ObjectID("11111111-1111-4111-8111-111111111111")}
        modelNameField="name"
        title="Monitor"
        hideTitle={true}
      >
        <p>Monitor overview content</p>
      </ModelPage>,
    );

    await waitFor(() => {
      expect(screen.getByText(/Cannot load monitor/)).toBeInTheDocument();
    });
    expect(
      screen.queryByText("Monitor overview content"),
    ).not.toBeInTheDocument();
  });
});
