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
import { DOCS_URL } from "../../../UI/Config";
import { clearGlossaryReads } from "../../../UI/Utils/Glossary";
import DashboardCommandPalette from "../../../../App/FeatureSet/Dashboard/src/Components/CommandPalette/DashboardCommandPalette";
import { takePendingAskAiRequest } from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/AskAiEvents";

/*
 * Search (Cmd/Ctrl+K) finds the docs (#6822): a Documentation group under
 * the pages and records, read from the installation's own docs search (the
 * one the docs' search box asks), in the reader's language, with or without
 * a project. A result opens its page - at its section - in a new tab, so
 * the person keeps the page they were on. A docs search that cannot be read
 * shows no group, and everything else works as before.
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
        i18n: { resolvedLanguage: "de", language: "de" },
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
const DOCS: string = DOCS_URL.toString().replace(/\/$/, "");

// What the docs server answers for a search (App's Docs/Utils/DocsSearch).
const DOCS_ANSWER: unknown = {
  query: "eskalaton",
  words: ["eskalationsregel"],
  results: [
    {
      title: "Eine Eskalationsregel hinzufügen",
      where: "Bereitschaft › Eskalationsregeln",
      url: "/docs/de/on-call/escalation-rules#eine-eskalationsregel-hinzufügen",
      snippet: "Jede Eskalationsregel ist eine Stufe.",
      isSection: true,
      isGuide: false,
    },
    {
      title: "Eskalationsregeln",
      where: "Bereitschaft",
      url: "/docs/de/on-call/escalation-rules",
      snippet: "Eine Bereitschaftsrichtlinie alarmiert Personen in Stufen.",
      isSection: false,
      isGuide: false,
    },
  ],
};

// The German heading's anchor, percent-encoded as an address carries it.
const SECTION_URL: string = `${DOCS}/de/on-call/escalation-rules#eine-eskalationsregel-hinzuf%C3%BCgen`;

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
    await Promise.resolve();
  });
}

async function search(text: string): Promise<void> {
  fireEvent.change(screen.getByTestId("command-palette-input"), {
    target: { value: text },
  });
  // Providers wait for typing to stop (200ms), then answer.
  await act(async () => {
    jest.advanceTimersByTime(250);
  });
  await settle();
}

function docsReads(): Array<string> {
  return fetchMock.mock.calls
    .map((call: Array<unknown>): string => {
      return String(call[0]);
    })
    .filter((url: string): boolean => {
      return url.includes("/search/");
    });
}

function sectionIds(): Array<string> {
  return Array.from(
    document.querySelectorAll('[data-testid^="command-palette-section-"]'),
  )
    .map((section: Element): string => {
      return section.getAttribute("data-testid") || "";
    })
    .filter((id: string): boolean => {
      return !id.startsWith("command-palette-section-pending-");
    });
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
  isMasterAdminMock.mockReturnValue(true);
  getListMock.mockResolvedValue({ data: [], count: 0 } as never);
  fetchMock.mockImplementation((url: unknown): Promise<unknown> => {
    const answer: unknown = String(url).includes("/search/")
      ? DOCS_ANSWER
      : { lang: "de", entries: [] };

    return Promise.resolve({
      ok: true,
      status: 200,
      json: (): Promise<unknown> => {
        return Promise.resolve(answer);
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

describe("Search finds the docs (#6822)", () => {
  test("shows a Documentation group under the pages and records, from the docs search in the reader's language", async () => {
    render(<DashboardCommandPalette />);
    openPalette();
    await search("eskalaton");

    expect(docsReads()).toEqual([`${DOCS}/search/de.json?q=eskalaton&limit=5`]);

    const section: HTMLElement = screen.getByTestId(
      "command-palette-section-docs",
    );
    expect(section).toHaveTextContent("Documentation");

    const result: HTMLElement | null = option(`docs-docs-0-${SECTION_URL}`);
    expect(result).toHaveTextContent("Eine Eskalationsregel hinzufügen");
    // It says where it is in the docs.
    expect(result).toHaveTextContent("Bereitschaft › Eskalationsregeln");

    // Under everything else Search found.
    const sections: Array<string> = sectionIds();
    expect(sections[sections.length - 1]).toBe("command-palette-section-docs");
  });

  test("opens a result at its section, in a new tab, and closes Search", async () => {
    render(<DashboardCommandPalette />);
    openPalette();
    await search("eskalaton");

    fireEvent.click(option(`docs-docs-0-${SECTION_URL}`)!);

    expect(navigateMock).toHaveBeenCalledWith(URL.fromString(SECTION_URL), {
      openInNewTab: true,
    });
    expect(screen.queryByTestId("command-palette")).toBeNull();
  });

  test("finds the docs with no project, where it finds no records", async () => {
    getCurrentProjectIdMock.mockReturnValue(null);
    render(<DashboardCommandPalette />);
    openPalette();
    await search("eskalaton");

    expect(getListMock).not.toHaveBeenCalled();
    expect(option(`docs-docs-0-${SECTION_URL}`)).toBeInTheDocument();
  });

  test("shows no Documentation group when the docs search cannot be read, and the rest of Search works", async () => {
    fetchMock.mockImplementation((): Promise<unknown> => {
      return Promise.reject(new Error("offline"));
    });

    render(<DashboardCommandPalette />);
    openPalette();
    await search("how do I page my team?");

    expect(screen.queryByTestId("command-palette-section-docs")).toBeNull();
    // A question nothing answers still offers Ask AI.
    expect(screen.getByTestId("command-palette").textContent || "").toContain(
      "Ask AI",
    );
  });

  test("asks nothing for a word too short to search", async () => {
    render(<DashboardCommandPalette />);
    openPalette();
    await search("e");

    expect(docsReads()).toEqual([]);
  });
});
