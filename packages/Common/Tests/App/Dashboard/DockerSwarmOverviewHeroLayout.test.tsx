import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Follow-up of #5076, the Swarm pages on a phone: the Overview's hero drew
 * its refresh control beside the cluster's name at every width, so a phone
 * read "swa…" and the description "The pr…". The hero's top row sits in a
 * container now (ResourceHeroLayout): stacked until the row is wide enough
 * for the name and the refresh control side by side. jsdom cannot measure,
 * so this holds the hero to the layout's classes; the offline browser suite
 * (packages/E2E/DockerSwarmPages) measures it at 390, 768 and 1280 pixels.
 */

const CLUSTER_ID: string = "11111111-1111-4111-8111-111111111111";

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

// The AI agent card's status read: answered with nothing, no network.
jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (): Promise<unknown> => {
        return Promise.resolve({ data: {} });
      },
      getFriendlyMessage: (error: unknown): string => {
        return String((error as Error)?.message || error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  const ObjectIDClass: typeof import("../../../Types/ObjectID").default = (
    jest.requireActual("../../../Types/ObjectID") as {
      default: typeof import("../../../Types/ObjectID").default;
    }
  ).default;

  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: () => {
        return new ObjectIDClass(CLUSTER_ID);
      },
      // RouteMap asks for the project from the URL; there is none here.
      getFirstParam: (): undefined => {
        return undefined;
      },
      navigate: (): void => {},
    },
  };
});

// Auto-refresh off: no timer under the test.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/useAutoRefresh",
  () => {
    return {
      __esModule: true,
      default: () => {
        return {
          autoRefreshInterval: "off",
          setAutoRefreshInterval: (): void => {},
        };
      },
    };
  },
);

import DockerSwarmClusterOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/Index";
import {
  RESOURCE_HERO_SIDE_BY_SIDE_MIN_WIDTH_REM,
  RESOURCE_HERO_TOP_ROW_CLASS_NAME,
  RESOURCE_HERO_TOP_ROW_CONTAINER_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ResourceHeroLayout";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import DockerSwarmCluster from "../../../Models/DatabaseModels/DockerSwarmCluster";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

// A Tailwind variant keyed to the window's width.
const WINDOW_BREAKPOINT: RegExp = /^(max-)?(sm|md|lg|xl|2xl):/;

const SIDE_BY_SIDE_VARIANT: string = `[@container(min-width:${RESOURCE_HERO_SIDE_BY_SIDE_MIN_WIDTH_REM}rem)]:`;

function cluster(agentVersion: string): DockerSwarmCluster {
  const model: DockerSwarmCluster = new DockerSwarmCluster();
  model.name = "swarm-prod";
  model.description = "The production swarm in Frankfurt.";
  model.otelCollectorStatus = "connected";
  model.dockerVersion = "28.5.1";
  model.agentVersion = agentVersion;
  return model;
}

function classesOf(element: HTMLElement): Array<string> {
  return element.className.split(" ").filter(Boolean);
}

async function flush(): Promise<void> {
  for (let i: number = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderOverview(agentVersion: string = "0.161.0"): Promise<{
  topRow: HTMLElement;
  container: HTMLElement;
}> {
  getItemMock.mockImplementation(async () => {
    return cluster(agentVersion);
  });
  render(<DockerSwarmClusterOverview {...PAGE_PROPS} />);
  await flush();

  const topRow: HTMLElement = await screen.findByTestId(
    "resource-hero-top-row",
  );
  return { topRow, container: topRow.parentElement as HTMLElement };
}

beforeEach(() => {
  getItemMock.mockReset();
  getListMock.mockReset();
  getListMock.mockImplementation(async () => {
    return { data: [], count: 0, skip: 0, limit: 0 };
  });
});

afterEach(() => {
  cleanup();
});

describe("the layout's classes", () => {
  test("stacked by default: a column, with no window breakpoint anywhere", () => {
    const classes: Array<string> = RESOURCE_HERO_TOP_ROW_CLASS_NAME.split(" ");

    expect(classes).toEqual(expect.arrayContaining(["flex", "flex-col"]));
    expect(classes).not.toContain("flex-row");
    expect(
      classes.filter((className: string): boolean => {
        return WINDOW_BREAKPOINT.test(className);
      }),
    ).toEqual([]);
  });

  test("side by side only from the row's own width, as the hero's start and end", () => {
    const sideBySide: Array<string> = RESOURCE_HERO_TOP_ROW_CLASS_NAME.split(
      " ",
    ).filter((className: string): boolean => {
      return className.startsWith("[@container");
    });

    expect(sideBySide).toEqual([
      `${SIDE_BY_SIDE_VARIANT}flex-row`,
      `${SIDE_BY_SIDE_VARIANT}items-start`,
      `${SIDE_BY_SIDE_VARIANT}justify-between`,
    ]);
  });

  test("a whole two-digit rem, which the Tailwind runtime sorts correctly as text", () => {
    expect(Number.isInteger(RESOURCE_HERO_SIDE_BY_SIDE_MIN_WIDTH_REM)).toBe(
      true,
    );
    expect(RESOURCE_HERO_SIDE_BY_SIDE_MIN_WIDTH_REM).toBeGreaterThanOrEqual(10);
    expect(RESOURCE_HERO_SIDE_BY_SIDE_MIN_WIDTH_REM).toBeLessThan(100);
  });

  test("the container measures the inline size only", () => {
    expect(RESOURCE_HERO_TOP_ROW_CONTAINER_CLASS_NAME).toBe(
      "[container-type:inline-size]",
    );
  });
});

describe("the Docker Swarm Overview's hero", () => {
  test("its top row takes the layout, inside a container of its own", async () => {
    const { topRow, container } = await renderOverview();

    for (const className of RESOURCE_HERO_TOP_ROW_CLASS_NAME.split(" ")) {
      expect(classesOf(topRow)).toContain(className);
    }
    expect(classesOf(container)).toEqual([
      RESOURCE_HERO_TOP_ROW_CONTAINER_CLASS_NAME,
    ]);

    // The old row that put the two side by side at every width is gone.
    expect(classesOf(topRow)).not.toContain("justify-between");
  });

  test("the top row holds the cluster's name and description first, then the refresh control", async () => {
    const { topRow } = await renderOverview();

    const parts: Array<Element> = Array.from(topRow.children);
    expect(parts).toHaveLength(2);

    const [identity, controls] = parts as [HTMLElement, HTMLElement];
    expect(
      within(identity).getByRole("heading", { name: "swarm-prod" }),
    ).toBeInTheDocument();
    expect(
      within(identity).getByText("The production swarm in Frankfurt."),
    ).toBeInTheDocument();
    expect(
      within(controls).getByRole("combobox", { name: "Auto-refresh" }),
    ).toBeInTheDocument();
    expect(
      within(controls).getByRole("button", { name: "Refresh" }),
    ).toBeInTheDocument();
  });

  test("the agent version's sign, and so the dialog it opens, sit outside the container", async () => {
    const { container } = await renderOverview("0.161.0");

    const sign: HTMLElement = screen.getByTestId("agent-version-outdated");
    expect(sign).toHaveAttribute("data-agent-kind", "docker-swarm-agent");
    expect(container.contains(sign)).toBe(false);

    // The chips' row comes after the top row's container, in the hero.
    expect(
      container.compareDocumentPosition(sign) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("an agent with this release's files: the plain chip, outside the container too", async () => {
    const { container } = await renderOverview("0.161.1");

    expect(screen.queryByTestId("agent-version-outdated")).toBeNull();
    const chip: HTMLElement = screen.getByTestId("agent-version-chip");
    expect(chip).toHaveTextContent("Agent 0.161.1");
    expect(container.contains(chip)).toBe(false);
  });
});
