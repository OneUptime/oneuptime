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
 * read "swa…" and the description "The pr…". The hero's top row takes the
 * layout every resource hero shares (ResourceHeroLayout, the Kubernetes
 * cluster's): the name keeps its room and the refresh control gives way,
 * under the name when the row is too narrow for both. jsdom cannot
 * measure, so this holds the rendered hero to the layout's parts and
 * classes; the offline browser suite (packages/E2E/DockerSwarmPages)
 * measures it at 390, 768 and 1280 pixels, and App's
 * ResourceHeroLayoutGuard holds every hero's source to it.
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
  RESOURCE_HERO_CONTROLS_CLASS_NAME,
  RESOURCE_HERO_CONTROLS_TEST_ID,
  RESOURCE_HERO_DESCRIPTION_CLASS_NAME,
  RESOURCE_HERO_DESCRIPTION_COLLAPSED_CLASS_NAME,
  RESOURCE_HERO_DESCRIPTION_TEST_ID,
  RESOURCE_HERO_IDENTITY_CLASS_NAME,
  RESOURCE_HERO_IDENTITY_TEST_ID,
  RESOURCE_HERO_TOP_ROW_CLASS_NAME,
  RESOURCE_HERO_TOP_ROW_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ResourceHeroLayout";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import DockerSwarmCluster from "../../../Models/DatabaseModels/DockerSwarmCluster";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

// A Tailwind variant keyed to the window's width.
const WINDOW_BREAKPOINT: RegExp = /^(max-)?(sm|md|lg|xl|2xl):/;

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
  identity: HTMLElement;
  controls: HTMLElement;
}> {
  getItemMock.mockImplementation(async () => {
    return cluster(agentVersion);
  });
  render(<DockerSwarmClusterOverview {...PAGE_PROPS} />);
  await flush();

  const topRow: HTMLElement = await screen.findByTestId(
    RESOURCE_HERO_TOP_ROW_TEST_ID,
  );
  return {
    topRow,
    identity: within(topRow).getByTestId(RESOURCE_HERO_IDENTITY_TEST_ID),
    controls: within(topRow).getByTestId(RESOURCE_HERO_CONTROLS_TEST_ID),
  };
}

// Every element from the top row up to the document, the row included.
function rowAndAncestors(topRow: HTMLElement): Array<HTMLElement> {
  const chain: Array<HTMLElement> = [];
  let node: HTMLElement | null = topRow;
  while (node) {
    chain.push(node);
    node = node.parentElement;
  }
  return chain;
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
  test("a column on a phone: no window breakpoint decides the column", () => {
    const classes: Array<string> = RESOURCE_HERO_TOP_ROW_CLASS_NAME.split(" ");

    expect(classes).toEqual(expect.arrayContaining(["flex", "flex-col"]));
    expect(classes).not.toContain("flex-row");
    expect(
      classes.filter((className: string): boolean => {
        return !WINDOW_BREAKPOINT.test(className);
      }),
    ).toEqual(["flex", "flex-col", "gap-4"]);
  });

  test("from md, one row that wraps: the name and the controls side by side only while both fit", () => {
    expect(RESOURCE_HERO_TOP_ROW_CLASS_NAME.split(" ")).toEqual(
      expect.arrayContaining([
        "md:flex-row",
        "md:flex-wrap",
        "md:items-start",
        "md:justify-between",
      ]),
    );
  });

  test("the identity never shrinks below its own content; the controls give way", () => {
    const identity: Array<string> =
      RESOURCE_HERO_IDENTITY_CLASS_NAME.split(" ");
    expect(identity).not.toContain("min-w-0");
    expect(identity).toEqual(
      expect.arrayContaining(["md:w-full", "md:flex-1"]),
    );

    const controls: Array<string> =
      RESOURCE_HERO_CONTROLS_CLASS_NAME.split(" ");
    expect(controls).not.toContain("flex-shrink-0");
    expect(controls).toEqual(
      expect.arrayContaining([
        "md:flex-[1000_1_0%]",
        "md:max-w-max",
        "md:min-w-[min(100%,24rem)]",
        // The row's end on a right-to-left page too (#5298's UI review).
        "md:ms-auto",
        "md:[&>div]:justify-end",
      ]),
    );
    expect(controls).not.toContain("md:ml-auto");
  });
});

describe("the Docker Swarm Overview's hero", () => {
  test("its top row takes the shared layout: the row, the identity, the controls", async () => {
    const { topRow, identity, controls } = await renderOverview();

    expect(classesOf(topRow)).toEqual(
      RESOURCE_HERO_TOP_ROW_CLASS_NAME.split(" "),
    );
    expect(classesOf(identity)).toEqual(
      RESOURCE_HERO_IDENTITY_CLASS_NAME.split(" "),
    );
    expect(classesOf(controls)).toEqual(
      RESOURCE_HERO_CONTROLS_CLASS_NAME.split(" "),
    );
    // The two parts, in that order, and nothing else in the row.
    expect(Array.from(topRow.children)).toEqual([identity, controls]);
  });

  test("the identity holds the cluster's name and description; the controls the refresh control", async () => {
    const { identity, controls } = await renderOverview();

    const name: HTMLElement = within(identity).getByRole("heading", {
      name: "swarm-prod",
    });
    // A name longer than the whole row is cut inside the hero.
    expect(classesOf(name)).toContain("truncate");
    /*
     * The description is every hero's (ResourceHeroDescription): two lines
     * that wrap, never one cut line that claimed the row and pushed Refresh
     * under the name at 1280 (#5298's UI review).
     */
    const description: HTMLElement = within(identity).getByTestId(
      RESOURCE_HERO_DESCRIPTION_TEST_ID,
    );
    expect(description).toHaveTextContent("The production swarm in Frankfurt.");
    // Two lines until Show more opens the rest.
    expect(classesOf(description)).toEqual([
      ...RESOURCE_HERO_DESCRIPTION_CLASS_NAME.split(" "),
      RESOURCE_HERO_DESCRIPTION_COLLAPSED_CLASS_NAME,
    ]);
    expect(classesOf(description)).not.toContain("truncate");
    expect(
      within(controls).getByRole("combobox", { name: "Auto-refresh" }),
    ).toBeInTheDocument();
    expect(
      within(controls).getByRole("button", { name: "Refresh" }),
    ).toBeInTheDocument();
    expect(within(identity).queryByRole("combobox")).toBeNull();
  });

  test("no container query on the way up: the fixed dialogs the hero opens are laid out against the window", async () => {
    const { topRow } = await renderOverview();

    for (const element of rowAndAncestors(topRow)) {
      expect(
        classesOf(element).filter((className: string): boolean => {
          return className.includes("container");
        }),
      ).toEqual([]);
    }
  });

  test("the agent version's sign sits in the chips under the top row, not in it", async () => {
    const { topRow } = await renderOverview("0.161.0");

    const sign: HTMLElement = screen.getByTestId("agent-version-outdated");
    expect(sign).toHaveAttribute("data-agent-kind", "docker-swarm-agent");
    expect(topRow.contains(sign)).toBe(false);

    // The chips' row comes after the top row, in the hero.
    expect(
      topRow.compareDocumentPosition(sign) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("an agent with this release's files: the plain chip, under the top row too", async () => {
    const { topRow } = await renderOverview("0.161.1");

    expect(screen.queryByTestId("agent-version-outdated")).toBeNull();
    const chip: HTMLElement = screen.getByTestId("agent-version-chip");
    expect(chip).toHaveTextContent("Agent 0.161.1");
    expect(topRow.contains(chip)).toBe(false);
  });
});
