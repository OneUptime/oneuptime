import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
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
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import React, { ReactElement, ReactNode } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE AFFECTED RESOURCES PICKER AND CARD IN THE READER'S LANGUAGE - from the
 * Dashboard's shipped locale files (issue #5341's UI review).
 *
 *   - the placeholder of a picker of many kinds says how to find them, short
 *     enough for a phone in German, and a short picker lists its kinds the
 *     way the language lists names ("ホスト、ネットワークデバイス");
 *   - the monitors a search also matches are said in the reader's words,
 *     the field named in bold;
 *   - Show N more, a failed search and its Try again read in the language;
 *   - the kinds a person may not read are listed the language's way
 *     ("پایگاه داده، منبع ابری"), and a sentence a locale has not worded yet
 *     keeps its kinds in English rather than a German name in an English
 *     sentence;
 *   - the card's counts are the reader's digits.
 *
 * The Dashboard sets i18next up once, globally, with react-i18next; so does
 * this file. Each jest file has its own module registry, so it reaches no
 * other suite.
 */

const searchMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourceSearchApi",
  () => {
    return {
      __esModule: true,
      searchAffectedResources: (query: unknown): unknown => {
        return searchMock(query);
      },
    };
  },
);

// The card's names link to their pages: a plain link, with no router.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: {
        to?: { toString: () => string };
        children: ReactNode;
        className?: string;
      }): ReactElement => {
        return React.createElement(
          "a",
          { href: props.to?.toString(), className: props.className },
          props.children,
        );
      },
    };
  },
);

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async (): Promise<unknown> => {
        return { data: [], count: 0, skip: 0, limit: 10 };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return true;
      },
    },
  };
});

import AffectedResourcesPicker, {
  AffectedResourceType,
  ComponentProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourcesPicker";
import AffectedResourcesDisplay from "../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourcesDisplay";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import { AffectedResourceKind } from "../../../Types/AffectedResources/AffectedResourceSearch";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

const OTHER_TYPES: Array<AffectedResourceType> = [
  "Host",
  "NetworkDevice",
  "KubernetesCluster",
  "DockerHost",
  "PodmanHost",
  "ProxmoxCluster",
  "VMwareVCenter",
  "CephCluster",
  "StorageArray",
  "DockerSwarmCluster",
  "IoTFleet",
  "DatabaseServer",
  "CloudResource",
  "Service",
];

const id: (n: number) => string = (n: number): string => {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
};

interface Query {
  search: string;
  kinds: Array<AffectedResourceKind>;
  limitPerKind: number;
  countKinds: Array<AffectedResourceKind>;
}

let failing: boolean;
let unreadable: Array<AffectedResourceKind>;

// 180 switches, two routers and two monitors that say "wan".
const DEVICES: Array<{ _id: string; name: string }> = [
  { _id: id(1), name: "WAN-RTR-01" },
  { _id: id(2), name: "WAN-RTR-02" },
  ...Array.from({ length: 180 }, (_value: unknown, index: number) => {
    return { _id: id(100 + index), name: `access-sw-${index}` };
  }),
];

async function answer(query: Query): Promise<unknown> {
  if (failing) {
    throw new Error("Server error");
  }

  const text: string = query.search.toLowerCase();
  const devices: Array<{ _id: string; name: string }> = DEVICES.filter(
    (device: { _id: string; name: string }): boolean => {
      return device.name.toLowerCase().includes(text);
    },
  );

  return {
    kinds: query.kinds
      .filter((kind: AffectedResourceKind): boolean => {
        return !unreadable.includes(kind);
      })
      .map((kind: AffectedResourceKind) => {
        const rows: Array<{ _id: string; name: string }> =
          kind === AffectedResourceKind.NetworkDevice ? devices : [];
        return {
          kind,
          count: rows.length,
          matches: rows.slice(0, query.limitPerKind),
        };
      }),
    counts: query.countKinds.map((kind: AffectedResourceKind) => {
      return {
        kind,
        count: kind === AffectedResourceKind.Monitor && text === "wan" ? 2 : 0,
      };
    }),
    unreadableKinds: query.kinds.filter((kind: AffectedResourceKind) => {
      return unreadable.includes(kind);
    }),
  };
}

function renderPicker(props: Partial<ComponentProps> = {}): void {
  render(
    <AffectedResourcesPicker
      resourceTypes={OTHER_TYPES}
      onChange={(): void => {}}
      {...props}
    />,
  );
}

function input(): HTMLInputElement {
  return screen.getByRole("combobox") as HTMLInputElement;
}

async function settle(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId("affected-resources-results")).toHaveAttribute(
      "aria-busy",
      "false",
    );
  });
}

async function search(text: string): Promise<void> {
  await act(async () => {
    fireEvent.focus(input());
  });
  await settle();
  const before: number = searchMock.mock.calls.length;
  await act(async () => {
    fireEvent.change(input(), { target: { value: text } });
  });
  await waitFor(() => {
    expect(searchMock.mock.calls.length).toBeGreaterThan(before);
  });
  await settle();
}

async function inLanguage(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "de",
    fallbackLng: "en",
    resources: {
      de: { translation: readLocale("de") },
      fa: { translation: readLocale("fa") },
      ja: { translation: readLocale("ja") },
      en: { translation: readLocale("en") },
      /*
       * A language that has worded the kinds but not the sentence they go
       * in - as a locale is while it is being translated.
       */
      xx: {
        translation: {
          Database: "Datenbank",
          "Cloud Resource": "Cloud-Ressource",
        },
      },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  failing = false;
  unreadable = [];
  searchMock.mockReset();
  searchMock.mockImplementation((query: unknown) => {
    return answer(query as Query);
  });
});

afterEach(async () => {
  cleanup();
  await inLanguage("de");
});

afterAll(() => {
  cleanup();
});

describe("the placeholder", () => {
  test("German: how to find what it searches, short enough for a phone, its verb kept", async () => {
    await inLanguage("de");
    renderPicker();

    expect(input()).toHaveAttribute(
      "placeholder",
      "Nach Name oder IP-Adresse suchen...",
    );
  });

  test("Japanese: two kinds listed the way Japanese lists names", async () => {
    await inLanguage("ja");
    renderPicker({ resourceTypes: ["Host", "NetworkDevice"] });

    expect(input()).toHaveAttribute(
      "placeholder",
      "ホスト、ネットワークデバイスを検索...",
    );
  });
});

describe("the results' words", () => {
  test("German: the monitors a search also matches, the field named in bold", async () => {
    await inLanguage("de");
    renderPicker({ monitorFieldTitle: "Monitors" });

    await search("wan");

    const hint: HTMLElement = screen.getByTestId(
      "affected-resources-monitors-hint",
    );

    expect(hint).toHaveTextContent(
      "Auch 2 Monitore passen. Monitore werden im Feld Monitore ausgewählt.",
    );
    expect(
      within(hint).getByText("Monitore", { selector: "span" }),
    ).toHaveClass("font-medium");
  });

  test("Persian: the same line, its count in Persian digits", async () => {
    await inLanguage("fa");
    renderPicker({ monitorFieldTitle: "Monitors" });

    await search("wan");

    expect(
      screen.getByTestId("affected-resources-monitors-hint"),
    ).toHaveTextContent(
      "۲ مانیتور هم مطابقت دارد. مانیتورها در فیلد «مانیتورها» انتخاب می‌شوند.",
    );
  });

  test("German: Show N more says how many more it brings", async () => {
    await inLanguage("de");
    renderPicker();

    await search("sw");

    expect(
      screen.getByTestId("affected-resources-show-more-NetworkDevice"),
    ).toHaveTextContent("35 weitere anzeigen");
  });

  test("German: a failed search, and its Try again", async () => {
    failing = true;
    await inLanguage("de");
    renderPicker();

    await search("wan");

    const failed: HTMLElement = screen.getByTestId(
      "affected-resources-search-failed",
    );

    expect(failed).toHaveTextContent(
      "Die Ressourcen konnten nicht durchsucht werden.",
    );
    expect(
      within(failed).getByRole("button", { name: "Erneut versuchen" }),
    ).toBeInTheDocument();
  });
});

describe("the kinds a person may not read", () => {
  test("Persian: listed with the Persian comma, in a Persian sentence", async () => {
    unreadable = [
      AffectedResourceKind.DatabaseServer,
      AffectedResourceKind.CloudResource,
    ];
    await inLanguage("fa");
    renderPicker();

    await search("wan");

    expect(
      screen.getByText(
        "اجازهٔ خواندن این موارد را ندارید: پایگاه داده، منبع ابری.",
      ),
    ).toBeInTheDocument();
  });

  test("German: named in German", async () => {
    unreadable = [AffectedResourceKind.DatabaseServer];
    await inLanguage("de");
    renderPicker();

    await search("wan");

    expect(
      screen.getByText("Keine Leseberechtigung für: Datenbank."),
    ).toBeInTheDocument();
  });

  test("a locale that has not worded the sentence yet keeps it whole in English, its kinds too", async () => {
    unreadable = [
      AffectedResourceKind.DatabaseServer,
      AffectedResourceKind.CloudResource,
    ];
    await inLanguage("xx");
    renderPicker();

    await search("wan");

    expect(
      screen.getByText(
        "You don't have permission to read: Database, Cloud Resource.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Datenbank/)).toBeNull();
  });
});

describe("the Affected Resources card", () => {
  function monitors(count: number): Array<Monitor> {
    return Array.from({ length: count }, (_value: unknown, index: number) => {
      const monitor: Monitor = new Monitor();
      monitor._id = id(500 + index);
      monitor.name = `Monitor ${index}`;
      return monitor;
    });
  }

  test("Persian: a category's count in Persian digits, like the summary above it", async () => {
    await inLanguage("fa");
    render(<AffectedResourcesDisplay monitors={monitors(12)} />);

    expect(
      screen.getByTestId("affected-resource-category-count"),
    ).toHaveTextContent(/^۱۲$/);
  });

  test("German: a four-digit count grouped the German way", async () => {
    await inLanguage("de");
    render(<AffectedResourcesDisplay monitors={monitors(1200)} />);

    expect(
      screen.getByTestId("affected-resource-category-count"),
    ).toHaveTextContent(/^1\.200$/);
  });
});
