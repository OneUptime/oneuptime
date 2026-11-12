import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { ProductEventName } from "../../../Types/Analytics/ProductEvent";
import Project from "../../../Models/DatabaseModels/Project";
import Service from "../../../Models/DatabaseModels/Service";
import { DOCS_URL } from "../../../UI/Config";
import GlobalEvents from "../../../UI/Utils/GlobalEvents";
import { clearGlossaryReads } from "../../../UI/Utils/Glossary";
import DashboardCommandPalette, {
  ENTITY_SEARCH_KINDS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CommandPalette/DashboardCommandPalette";
import { takePendingAskAiRequest } from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/AskAiEvents";
import EventName from "../../../../App/FeatureSet/Dashboard/src/Utils/EventName";

/*
 * More that Search (Cmd/Ctrl+K) finds (#6816, #6936):
 *
 *  - How OneUptime works and the Glossary, and the Glossary's terms;
 *  - the person's other projects, "Switch to Acme Staging";
 *  - services, hosts, on-call schedules, scheduled maintenance, dashboards,
 *    workflows, runbooks and teams, besides the five kinds it always found,
 *    each only where the person may read it, in one debounced round;
 *  - "Ask AI: ..." for a question nothing answers, while the search still
 *    counts as one that found nothing (#6830's search/no_results).
 */

const navigateMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const getCurrentProjectIdMock: MockFunction = getJestMockFunction();
const getAllPermissionsMock: MockFunction = getJestMockFunction();
const isMasterAdminMock: MockFunction = getJestMockFunction();
const sendEventMock: MockFunction = getJestMockFunction();
const fetchMock: MockFunction = getJestMockFunction();

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, defaultValue?: string): string => {
          return defaultValue ?? key;
        },
        i18n: { resolvedLanguage: "en", language: "en" },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      isOnThisPage: () => {
        return false;
      },
      isStartWith: () => {
        return false;
      },
      navigate: (...args: Array<unknown>) => {
        return navigateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (...args: Array<unknown>) => {
        return getAllPermissionsMock(...args);
      },
      getProjectPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (...args: Array<unknown>) => {
        return isMasterAdminMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (...args: Array<unknown>) => {
        return getCurrentProjectIdMock(...args);
      },
      getCurrentProject: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/ProductEvents", () => {
  return {
    __esModule: true,
    default: {
      send: (...args: Array<unknown>) => {
        return sendEventMock(...args);
      },
    },
  };
});

const PROJECT_A: string = "65f0000000000000000000aa";
const PROJECT_B: string = "65f0000000000000000000bb";
const PROJECT_C: string = "65f0000000000000000000cc";
const DOCS: string = DOCS_URL.toString();

function project(id: string, name: string): Project {
  const value: Project = new Project();
  value._id = id;
  value.name = name;
  return value;
}

const PROJECTS: Array<Project> = [
  project(PROJECT_A, "Acme Production"),
  project(PROJECT_B, "Acme Staging"),
  project(PROJECT_C, "Side project"),
];

// The Glossary the docs serve, as the product reads it (Glossary.ts).
const GLOSSARY: unknown = {
  lang: "en",
  entries: [
    {
      id: "probe",
      term: "Probe",
      definition: "A machine that runs monitors' checks.",
      alsoCalled: ["Monitoring location"],
    },
    {
      id: "escalation-rule",
      term: "Escalation Rule",
      definition: "One step of an on-call policy.",
      alsoCalled: [],
    },
  ],
};

function palette(): HTMLElement | null {
  return screen.queryByTestId("command-palette");
}

function option(id: string): HTMLElement | null {
  return screen.queryByTestId(`command-palette-option-${id}`);
}

function openPalette(): void {
  fireEvent.keyDown(document.body, { key: "k", metaKey: true });
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function search(text: string): Promise<void> {
  fireEvent.change(screen.getByTestId("command-palette-input"), {
    target: { value: text },
  });
  // The record search waits for typing to stop (200ms), then answers.
  await act(async () => {
    jest.advanceTimersByTime(250);
  });
  await settle();
}

beforeAll(() => {
  Element.prototype.scrollIntoView = (): void => {};
});

beforeEach(() => {
  jest.useFakeTimers();
  window.localStorage.clear();
  clearGlossaryReads();
  takePendingAskAiRequest();
  getCurrentProjectIdMock.mockReturnValue(new ObjectID(PROJECT_A));
  getAllPermissionsMock.mockReturnValue([]);
  isMasterAdminMock.mockReturnValue(false);
  getListMock.mockResolvedValue({ data: [], count: 0 } as never);
  fetchMock.mockImplementation((): Promise<unknown> => {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: (): Promise<unknown> => {
        return Promise.resolve(GLOSSARY);
      },
    });
  });
  (globalThis as unknown as { fetch: unknown }).fetch = (
    ...args: Array<unknown>
  ): unknown => {
    return fetchMock(...args);
  };
});

afterEach(() => {
  cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
  navigateMock.mockReset();
  getListMock.mockReset();
  getCurrentProjectIdMock.mockReset();
  getAllPermissionsMock.mockReset();
  isMasterAdminMock.mockReset();
  sendEventMock.mockReset();
  fetchMock.mockReset();
});

describe("How OneUptime works and the Glossary (#6936)", () => {
  test.each(["how it works", "overview", "getting started", "concepts"])(
    "%p opens How OneUptime works, and the opening says it came from Search",
    async (query: string) => {
      const opened: MockFunction = getJestMockFunction();
      const listener: (event: CustomEvent) => void = (
        event: CustomEvent,
      ): void => {
        opened(event.detail);
      };
      GlobalEvents.addEventListener(
        EventName.HOW_ONEUPTIME_WORKS_OPEN,
        listener,
      );

      try {
        render(<DashboardCommandPalette />);
        openPalette();
        await search(query);

        const howItWorks: HTMLElement | null = option(
          "action-how-oneuptime-works",
        );
        expect(howItWorks).toHaveTextContent("How OneUptime works");
        fireEvent.click(howItWorks!);

        expect(opened).toHaveBeenCalledWith({ from: "command-palette" });
        expect(palette()).toBeNull();
      } finally {
        GlobalEvents.removeEventListener(
          EventName.HOW_ONEUPTIME_WORKS_OPEN,
          listener,
        );
      }
    },
  );

  test("browsing lists How OneUptime works and the Glossary among the actions, with no project and no permission", () => {
    getCurrentProjectIdMock.mockReturnValue(null);
    render(<DashboardCommandPalette />);
    openPalette();

    expect(option("action-how-oneuptime-works")).toBeInTheDocument();
    expect(option("action-glossary")).toBeInTheDocument();
  });

  test("the Glossary opens on this instance's docs, in a new tab", async () => {
    render(<DashboardCommandPalette />);
    openPalette();
    await search("glossary");

    fireEvent.click(option("action-glossary")!);

    expect(navigateMock).toHaveBeenCalledWith(
      URL.fromString(`${DOCS}/en/introduction/glossary`),
      { openInNewTab: true },
    );
    expect(palette()).toBeNull();
  });

  test("a term is found by its name, and opens at its place on the Glossary page", async () => {
    render(<DashboardCommandPalette />);
    openPalette();
    await settle();
    await search("probe");

    const probe: HTMLElement | null = option("glossary-term-probe");
    expect(probe).toHaveTextContent("Probe");
    // It says where it lives: the Glossary.
    expect(probe).toHaveTextContent("Glossary");
    fireEvent.click(probe!);

    expect(navigateMock).toHaveBeenCalledWith(
      URL.fromString(`${DOCS}/en/introduction/glossary#probe`),
      { openInNewTab: true },
    );
  });

  test("a term is found by its other names, and by part of a longer one", async () => {
    render(<DashboardCommandPalette />);
    openPalette();
    await settle();

    await search("monitoring location");
    expect(option("glossary-term-probe")).toBeInTheDocument();

    await search("escalation rule");
    expect(option("glossary-term-escalation-rule")).toBeInTheDocument();
  });

  test("the Glossary is read once, however often Search opens", async () => {
    render(<DashboardCommandPalette />);
    openPalette();
    await settle();
    fireEvent.keyDown(document, { key: "Escape" });
    openPalette();
    await settle();

    const glossaryReads: Array<unknown> = fetchMock.mock.calls.filter(
      (call: Array<unknown>): boolean => {
        return String(call[0]).includes("/glossary/");
      },
    );
    expect(glossaryReads).toHaveLength(1);
  });

  test("a Glossary that cannot be read leaves its terms out, and everything else is found", async () => {
    fetchMock.mockImplementation((): Promise<unknown> => {
      return Promise.reject(new Error("offline"));
    });

    render(<DashboardCommandPalette />);
    openPalette();
    await settle();
    await search("probe");

    expect(option("glossary-term-probe")).toBeNull();

    await search("glossary");
    expect(option("action-glossary")).toBeInTheDocument();
  });

  test("terms are offered only to someone searching, not in the list Search opens on", async () => {
    render(<DashboardCommandPalette />);
    openPalette();
    await settle();

    expect(option("glossary-term-probe")).toBeNull();
  });
});

describe("switching project (#6816)", () => {
  test("each other project is a result that switches to it, through the picker's own switch", async () => {
    const onProjectSelected: MockFunction = getJestMockFunction();

    render(
      <DashboardCommandPalette
        projects={PROJECTS}
        onProjectSelected={(selected: Project): void => {
          onProjectSelected(selected);
        }}
      />,
    );
    openPalette();
    await search("staging");

    const staging: HTMLElement | null = option(`project-switch-${PROJECT_B}`);
    expect(staging).toHaveTextContent("Switch to Acme Staging");
    fireEvent.click(staging!);

    expect(onProjectSelected).toHaveBeenCalledTimes(1);
    expect(onProjectSelected).toHaveBeenCalledWith(PROJECTS[1]);
    expect(palette()).toBeNull();
  });

  test('"switch project" lists every other project, never the one the person is in', async () => {
    render(
      <DashboardCommandPalette
        projects={PROJECTS}
        onProjectSelected={(): void => {}}
      />,
    );
    openPalette();
    await search("switch project");

    expect(option(`project-switch-${PROJECT_B}`)).toBeInTheDocument();
    expect(option(`project-switch-${PROJECT_C}`)).toBeInTheDocument();
    expect(option(`project-switch-${PROJECT_A}`)).toBeNull();
  });

  test("projects are offered only to someone searching", () => {
    render(
      <DashboardCommandPalette
        projects={PROJECTS}
        onProjectSelected={(): void => {}}
      />,
    );
    openPalette();

    expect(option(`project-switch-${PROJECT_B}`)).toBeNull();
  });

  test("with no way to switch, no project is offered", async () => {
    render(<DashboardCommandPalette projects={PROJECTS} />);
    openPalette();
    await search("staging");

    expect(option(`project-switch-${PROJECT_B}`)).toBeNull();
  });
});

describe("the kinds of record Search finds (#6816)", () => {
  const searchedModels: () => Array<string> = (): Array<string> => {
    return getListMock.mock.calls.map((call: Array<unknown>): string => {
      const modelType: { new (): { tableName?: string } } = (
        call[0] as { modelType: { new (): { tableName?: string } } }
      ).modelType;
      return new modelType().tableName || "";
    });
  };

  test("someone who may read everything searches thirteen kinds, in one round of requests, five rows each", async () => {
    isMasterAdminMock.mockReturnValue(true);
    render(<DashboardCommandPalette />);
    openPalette();

    fireEvent.change(screen.getByTestId("command-palette-input"), {
      target: { value: "ap" },
    });
    fireEvent.change(screen.getByTestId("command-palette-input"), {
      target: { value: "api" },
    });
    // Typing on: nothing is asked yet.
    expect(getListMock).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(250);
    });
    await settle();

    expect(getListMock).toHaveBeenCalledTimes(ENTITY_SEARCH_KINDS.length);
    expect(ENTITY_SEARCH_KINDS).toHaveLength(13);
    for (const call of getListMock.mock.calls) {
      expect((call[0] as { limit: number }).limit).toBe(5);
    }
    expect(new Set(searchedModels()).size).toBe(13);
  });

  test("a service is found by name, and opens on its page", async () => {
    isMasterAdminMock.mockReturnValue(true);
    getListMock.mockImplementation((data: unknown): Promise<unknown> => {
      const modelType: { new (): unknown } = (
        data as { modelType: { new (): unknown } }
      ).modelType;

      if (modelType === Service) {
        return Promise.resolve({
          data: [
            {
              _id: "5d6b2a0c-6a3e-4c2b-9f43-3f1b0a7c1d11",
              name: "Checkout API",
            },
          ],
          count: 1,
        });
      }

      return Promise.resolve({ data: [], count: 0 });
    });

    render(<DashboardCommandPalette />);
    openPalette();
    await search("checkout");

    const result: HTMLElement | null = option(
      "services-services-5d6b2a0c-6a3e-4c2b-9f43-3f1b0a7c1d11",
    );
    expect(result).toHaveTextContent("Checkout API");
    expect(
      screen.getByTestId("command-palette-section-services"),
    ).toHaveTextContent("Services");
    fireEvent.click(result!);

    expect(String(navigateMock.mock.calls[0]![0])).toBe(
      `/dashboard/${PROJECT_A}/service/5d6b2a0c-6a3e-4c2b-9f43-3f1b0a7c1d11`,
    );
  });

  test("a kind the person may not read is never asked for", async () => {
    // Someone whose only permission is to read services.
    const serviceRead: Permission = Permission.ReadService;
    expect(new Service().getReadPermissions()).toContain(serviceRead);
    getAllPermissionsMock.mockReturnValue([serviceRead]);

    render(<DashboardCommandPalette />);
    openPalette();
    await search("api");

    expect(searchedModels()).toEqual([new Service().tableName]);

    for (const call of getListMock.mock.calls) {
      const modelType: {
        new (): { getReadPermissions: () => Array<Permission> };
      } = (
        call[0] as {
          modelType: {
            new (): { getReadPermissions: () => Array<Permission> };
          };
        }
      ).modelType;
      expect(new modelType().getReadPermissions()).toContain(serviceRead);
    }
  });

  test("without a project, no record is searched", async () => {
    isMasterAdminMock.mockReturnValue(true);
    getCurrentProjectIdMock.mockReturnValue(null);
    render(<DashboardCommandPalette />);
    openPalette();
    await search("api");

    expect(getListMock).not.toHaveBeenCalled();
  });
});

describe("a question nothing answers (#6816)", () => {
  const QUESTION: string = "how do I add a phone number";

  test("is offered to Ask AI, which opens with the question in its composer, unsent", async () => {
    const asked: MockFunction = getJestMockFunction();
    const listener: (event: CustomEvent) => void = (
      event: CustomEvent,
    ): void => {
      asked(event.detail);
    };
    GlobalEvents.addEventListener(EventName.AI_CHAT_TOGGLE, listener);

    try {
      render(<DashboardCommandPalette />);
      openPalette();
      await search(QUESTION);

      const ask: HTMLElement | null = option("fallback-ask-ai-question");
      expect(ask).toHaveTextContent(`Ask AI: ${QUESTION}`);
      expect(screen.queryByText("No results found.")).toBeNull();
      fireEvent.click(ask!);

      expect(asked).toHaveBeenCalledWith({ prompt: QUESTION, open: true });
      expect(palette()).toBeNull();
    } finally {
      GlobalEvents.removeEventListener(EventName.AI_CHAT_TOGGLE, listener);
    }
  });

  test("Enter asks it: it is the one row, and the keyboard is on it", async () => {
    render(<DashboardCommandPalette />);
    openPalette();
    await search(QUESTION);

    fireEvent.keyDown(screen.getByTestId("command-palette-input"), {
      key: "Enter",
    });

    expect(takePendingAskAiRequest()).toEqual({ prompt: QUESTION });
    expect(palette()).toBeNull();
  });

  test("the search still counts as one that found nothing", async () => {
    render(<DashboardCommandPalette />);
    openPalette();
    await search(QUESTION);

    await act(async () => {
      jest.advanceTimersByTime(1100);
    });

    const foundNothing: Array<Array<unknown>> = sendEventMock.mock.calls.filter(
      (call: Array<unknown>): boolean => {
        return call[0] === ProductEventName.SearchFoundNothing;
      },
    );
    expect(foundNothing).toHaveLength(1);
    expect(foundNothing[0]![1]).toMatchObject({
      source: "command_palette",
      query_length: QUESTION.length,
    });
  });

  test("words that are not a question find nothing, as before: no offer", async () => {
    render(<DashboardCommandPalette />);
    openPalette();
    await search("zzqx");

    expect(option("fallback-ask-ai-question")).toBeNull();
    expect(screen.getByText("No results found.")).toBeInTheDocument();
  });

  test("a question something matches lists the match, not the offer", async () => {
    render(<DashboardCommandPalette />);
    openPalette();
    await search("glossary?");

    expect(option("action-glossary")).toBeInTheDocument();
    expect(option("fallback-ask-ai-question")).toBeNull();
  });

  test("the offer is never remembered as a recent command", async () => {
    render(<DashboardCommandPalette />);
    openPalette();
    await search(QUESTION);
    fireEvent.click(option("fallback-ask-ai-question")!);

    expect(
      window.localStorage.getItem("oneuptime-command-palette-recents") || "",
    ).not.toContain("ask-ai-question");
  });
});
