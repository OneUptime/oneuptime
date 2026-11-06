import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * #5646'S UI REVIEW, FINISHED: what read wrong on Cloud's Overview and Spend
 * pages in German and Persian, and the App Platforms card.
 *
 *   - Ways to spend less said what to do in English ("Rightsize", "Purchase
 *     Savings Plans") on every page: the Overview's card, Savings and an
 *     account's Costs. OneUptime's words for an action are drawn in the
 *     reader's language now; a recommender's own sentence as written.
 *   - A stat tile's (i) went to a line of its own under a title that
 *     wrapped, and a German title was hyphenated where its long word would
 *     have fitted the next line ("ERFORDERT AUFMERK- / SAMKEIT"). The (i)
 *     follows the title's last word (held to it when that word is short),
 *     and the tiles of a row share the strip's rows, so their values start
 *     on one line.
 *   - The App Platforms card counts the environments in the accounts Cloud
 *     reads, and links to App Platforms' lists, which hold every
 *     environment: it says how many more the lists hold.
 */

const mockCapturedTableProps: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): null => {
      mockCapturedTableProps.push(props);
      return null;
    },
  };
});

const mockFetchCloudSavings: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudSavingsReads",
  () => {
    return {
      __esModule: true,
      fetchCloudSavings: (...args: Array<unknown>): unknown => {
        return mockFetchCloudSavings(...args);
      },
    };
  },
);

import CloudCostRecommendation from "../../../Models/DatabaseModels/CloudCostRecommendation";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import Route from "../../../Types/API/Route";
import { CloudResourceKind } from "../../../Types/Cloud/CloudResourceKind";
import { CloudSavingKind } from "../../../Types/Cloud/CloudCost";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import { getJestSpyOn } from "../../Spy";
import { PROJECT_ID, goTo } from "./SideMenuHarness";
import CloudAppPlatformsCard, {
  APP_PLATFORMS_OTHER_ENVIRONMENTS,
  fetchCloudAppPlatformsCounts,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudAppPlatformsCard";
import CloudSavingsCard from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudSavingsCard";
import CloudSavingsTable from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudSavingsTable";
import CloudStatStrip from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudStatStrip";
import {
  CLOUD_STAT_TILE_HEAD_CLASS_NAME,
  CLOUD_STAT_TILE_ROWS_CLASS_NAME,
  CLOUD_STAT_TILE_TITLE_END_CLASS_NAME,
  getCloudStatTileTitleWords,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudStatTileTitle";
import { TILE_TITLE_LONG_WORD_BOX_CLASS_NAME } from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/TileTitleWords";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import persianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const [language, locale] of [
    ["en", englishLocale],
    ["de", germanLocale],
    ["fa", persianLocale],
  ] as Array<[string, Record<string, unknown>]>) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: englishLocale },
        [language]: { translation: locale },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    instances[language] = instance;
  }
});

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/cloud`);
  mockCapturedTableProps.length = 0;
  mockFetchCloudSavings.mockReset();
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function drawIn(
  language: string,
  element: React.ReactElement,
): Promise<void> {
  await act(async () => {
    render(
      <I18nextProvider i18n={instances[language]!}>
        <MemoryRouter>{element}</MemoryRouter>
      </I18nextProvider>,
    );
  });
}

function recommendation(
  overrides: Record<string, unknown> = {},
): CloudCostRecommendation {
  const model: CloudCostRecommendation = new CloudCostRecommendation();
  Object.assign(model, {
    _id: "10000000-0000-4000-8000-0000000000f1",
    kind: CloudSavingKind.Rightsize,
    action: "Rightsize",
    resourceName: "orders-db",
    monthlySavings: 410.5,
    currency: "USD",
    cloudAccount: { name: "web-prod" },
    ...overrides,
  });
  return model;
}

describe("what a way to spend less asks, in the reader's language", () => {
  test("the Overview's card: OneUptime's words translated, Azure's sentence as written", async () => {
    mockFetchCloudSavings.mockResolvedValue([
      recommendation(),
      recommendation({
        _id: "10000000-0000-4000-8000-0000000000f2",
        kind: CloudSavingKind.Commitment,
        action: "Purchase Savings Plans",
      }),
      recommendation({
        _id: "10000000-0000-4000-8000-0000000000f3",
        kind: CloudSavingKind.Rightsize,
        action: "Right-size or shutdown underutilized virtual machines",
      }),
    ]);

    await drawIn(
      "de",
      <CloudSavingsCard
        projectId={new ObjectID(PROJECT_ID)}
        accounts={[]}
        savings={{
          currency: "USD",
          monthlySavings: 990.82,
          count: 3,
          byKind: {},
          accountsRead: 1,
          accountsInOtherCurrencies: 0,
          accountsNotAllowed: 0,
          accountsNotSetUp: 0,
          accountsFailed: 0,
        }}
        savingsRoute={new Route(`/dashboard/${PROJECT_ID}/cloud/savings`)}
      />,
    );

    const rows: Array<HTMLElement> = await screen.findAllByTestId(
      "cloud-savings-top-row",
    );

    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Größe anpassen");
    expect(rows[0]).not.toHaveTextContent("Rightsize");
    expect(rows[1]).toHaveTextContent("Savings Plans kaufen");
    expect(rows[2]).toHaveTextContent(
      "Right-size or shutdown underutilized virtual machines",
    );
  });

  test("Savings and an account's Costs: the Recommendation cell, in Persian", async () => {
    await drawIn("fa", <CloudSavingsTable id="savings" currency="USD" />);

    const props: Record<string, unknown> =
      mockCapturedTableProps[mockCapturedTableProps.length - 1]!;
    const columns: Array<{
      title: string;
      getElement?: (item: CloudCostRecommendation) => React.ReactElement;
    }> = props["columns"] as Array<{
      title: string;
      getElement?: (item: CloudCostRecommendation) => React.ReactElement;
    }>;
    const cell: (item: CloudCostRecommendation) => React.ReactElement =
      columns.find((column: { title: string }): boolean => {
        return column.title === "Recommendation";
      })!.getElement!;

    const { container: purchase } = render(
      cell(recommendation({ action: "Purchase Savings Plans" })),
    );
    expect(purchase).toHaveTextContent("خرید Savings Plans");

    // No action at all: what kind of saving it is, read with the row.
    const { container: empty } = render(
      cell(recommendation({ action: "", kind: CloudSavingKind.Idle })),
    );
    expect(empty.textContent).not.toBe("");
    expect((props["selectMoreFields"] as Record<string, unknown>)["kind"]).toBe(
      true,
    );
  });
});

describe("a stat tile's title and its (i)", () => {
  test("the word that ends a title goes with the (i), unless it is long, or the title is one long word", () => {
    // English: "attention" with the (i), "Needs " before.
    expect(
      getCloudStatTileTitleWords({
        text: "Needs attention",
        lang: undefined,
        hasInfo: true,
      }),
    ).toEqual({
      className: "break-words",
      runs: [{ text: "Needs ", mayHyphenate: false }],
      lastWord: "attention",
    });

    // German: the long word may need hyphenating, so it stays its own box.
    const german: ReturnType<typeof getCloudStatTileTitleWords> =
      getCloudStatTileTitleWords({
        text: "Erfordert Aufmerksamkeit",
        lang: "de",
        hasInfo: true,
      });
    expect(german.lastWord).toBe("");
    expect(german.runs).toEqual([
      { text: "Erfordert ", mayHyphenate: false },
      { text: "Aufmerksamkeit", mayHyphenate: true },
    ]);

    // A long word, then a short one: the short one goes with the (i).
    expect(
      getCloudStatTileTitleWords({
        text: "Ausgaben diesen Monat",
        lang: "de",
        hasInfo: true,
      }).lastWord,
    ).toBe("Monat");

    // One long word: the title itself is hyphenated, nothing is held.
    expect(
      getCloudStatTileTitleWords({
        text: "Sparpotenzial",
        lang: "de",
        hasInfo: true,
      }).lastWord,
    ).toBe("");

    // No (i): nothing to hold a word to.
    expect(
      getCloudStatTileTitleWords({
        text: "Needs attention",
        lang: undefined,
        hasInfo: false,
      }).lastWord,
    ).toBe("");

    // A script without spaces is one word: held only while it is short.
    expect(
      getCloudStatTileTitleWords({
        text: "要注意",
        lang: "ja",
        hasInfo: true,
      }).lastWord,
    ).toBe("要注意");
    expect(
      getCloudStatTileTitleWords({
        text: "今月これまでのクラウドの支出額",
        lang: "ja",
        hasInfo: true,
      }).lastWord,
    ).toBe("");
  });

  test("drawn: the (i) inside the title's block, after its last word, and the tile three of the strip's rows", async () => {
    await drawIn(
      "en",
      <CloudStatStrip
        tiles={[
          {
            key: "attention",
            title: "Needs attention",
            description: "Resources whose key metrics show something wrong.",
            value: "3",
            icon: IconProp.Alert,
            color: "rose",
            to: new Route(`/dashboard/${PROJECT_ID}/cloud/resources`),
          },
          {
            key: "resources",
            title: "Resources",
            value: "493",
            icon: IconProp.Squares,
            color: "sky",
          },
        ]}
      />,
    );

    const tiles: Array<HTMLElement> = screen.getAllByTestId("cloud-stat-tile");
    const titles: Array<HTMLElement> = screen.getAllByTestId(
      "cloud-stat-tile-title",
    );

    // The (i) follows "attention", held to it.
    const info: HTMLElement = within(titles[0]!).getByRole("button", {
      name: "About Needs attention",
    });
    const end: HTMLElement = info.parentElement as HTMLElement;
    expect(end).toHaveClass(CLOUD_STAT_TILE_TITLE_END_CLASS_NAME);
    expect(end.textContent).toBe("attention");
    expect(titles[0]!.textContent).toBe("Needs attention");

    // A title without a description draws no (i).
    expect(within(titles[1]!).queryByRole("button")).toBeNull();

    // Each tile is three of the strip's rows - its link too.
    for (const tile of tiles) {
      expect(tile.className).toContain(CLOUD_STAT_TILE_ROWS_CLASS_NAME);
      // The room is measured on the title's row, not on the tile.
      expect(tile.className).not.toContain("container-type");
      expect(tile.firstElementChild!.className).toBe(
        CLOUD_STAT_TILE_HEAD_CLASS_NAME,
      );
    }
    expect(screen.getByTestId("cloud-stat-tile-link").className).toContain(
      CLOUD_STAT_TILE_ROWS_CLASS_NAME,
    );
  });

  test("in German: the long word is a box of its own and the (i) follows it", async () => {
    await drawIn(
      "de",
      <CloudStatStrip
        tiles={[
          {
            key: "attention",
            title: "Needs attention",
            description: "Resources whose key metrics show something wrong.",
            value: "3",
            icon: IconProp.Alert,
            color: "rose",
          },
        ]}
      />,
    );

    const title: HTMLElement = screen.getByTestId("cloud-stat-tile-title");
    const box: HTMLElement = title.querySelector(
      "span.inline-block",
    ) as HTMLElement;

    expect(title).toHaveTextContent("Erfordert Aufmerksamkeit");
    expect(box).toHaveTextContent("Aufmerksamkeit");
    expect(box.className).toContain(TILE_TITLE_LONG_WORD_BOX_CLASS_NAME);
    expect(box.parentElement).toHaveAttribute("lang", "de");
    // The (i) comes after the words, in the title's block.
    const info: HTMLElement = within(title).getByRole("button");
    expect(
      box.compareDocumentPosition(info) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("the App Platforms card says what its lists hold beyond the accounts Cloud reads", () => {
  function environment(id: string, accountId: string): CloudResource {
    const resource: CloudResource = new CloudResource();
    Object.assign(resource, {
      _id: id,
      cloudProvider: "aws",
      cloudAccountId: accountId,
      cloudResourceKind: CloudResourceKind.Environment,
    });
    return resource;
  }

  function listEnvironments(environments: Array<CloudResource>): void {
    getJestSpyOn(ModelAPI, "getList").mockResolvedValue({
      data: environments,
      count: environments.length,
      skip: 0,
      limit: 100,
    } as never);
    getJestSpyOn(ModelAPI, "count").mockResolvedValue(4 as never);
  }

  const READ: Array<{ provider: string; accountId: string }> = [
    { provider: "aws", accountId: "123456789012" },
  ];

  test("counts the environments in accounts no connection here reads", async () => {
    listEnvironments([
      environment("10000000-0000-4000-8000-0000000000e1", "123456789012"),
      environment("10000000-0000-4000-8000-0000000000e2", "123456789012"),
      environment("10000000-0000-4000-8000-0000000000e3", "999999999999"),
    ]);

    expect(await fetchCloudAppPlatformsCounts(READ)).toEqual({
      environments: 2,
      apps: 4,
      otherEnvironments: 1,
    });
  });

  test("says so under the counts, in English and in German", async () => {
    listEnvironments([
      environment("10000000-0000-4000-8000-0000000000e1", "123456789012"),
      environment("10000000-0000-4000-8000-0000000000e3", "999999999999"),
      environment("10000000-0000-4000-8000-0000000000e4", "888888888888"),
    ]);

    await drawIn("en", <CloudAppPlatformsCard accounts={READ} />);
    expect(
      await screen.findByTestId("cloud-app-platforms-other-environments"),
    ).toHaveTextContent(
      "App Platforms also lists 2 environments, with their apps, from accounts not connected to Cloud.",
    );
    cleanup();

    await drawIn("de", <CloudAppPlatformsCard accounts={READ} />);
    expect(
      withoutIsolateMarks(
        (await screen.findByTestId("cloud-app-platforms-other-environments"))
          .textContent || "",
      ),
    ).toBe(
      "In App-Plattformen stehen außerdem 2 Umgebungen samt ihren Apps aus Konten, die nicht mit Cloud verbunden sind.",
    );
    expect(APP_PLATFORMS_OTHER_ENVIRONMENTS.one).toContain("{{count}}");
  });

  /*
   * On a phone the card's description is folded away, so the line says
   * where the lists are and what "not read" means by itself: App
   * Platforms, and the word Cloud > Connect uses (#5702's review).
   */
  test("names App Platforms and says not connected, in both forms", () => {
    for (const sentence of [
      APP_PLATFORMS_OTHER_ENVIRONMENTS.one,
      APP_PLATFORMS_OTHER_ENVIRONMENTS.other,
    ]) {
      expect(sentence).toMatch(/^App Platforms also lists /);
      expect(sentence).toContain("not connected to Cloud");
      expect(sentence).not.toContain("The lists");
      expect(sentence).not.toContain("does not read");
    }
  });

  test("one: in the singular; none: no line", async () => {
    listEnvironments([
      environment("10000000-0000-4000-8000-0000000000e1", "123456789012"),
      environment("10000000-0000-4000-8000-0000000000e3", "999999999999"),
    ]);
    await drawIn("en", <CloudAppPlatformsCard accounts={READ} />);
    expect(
      await screen.findByTestId("cloud-app-platforms-other-environments"),
    ).toHaveTextContent(
      "App Platforms also lists 1 environment, with its apps, from an account not connected to Cloud.",
    );
    cleanup();

    listEnvironments([
      environment("10000000-0000-4000-8000-0000000000e1", "123456789012"),
    ]);
    await drawIn("en", <CloudAppPlatformsCard accounts={READ} />);
    await screen.findByTestId("cloud-app-platforms-card");
    expect(
      screen.queryByTestId("cloud-app-platforms-other-environments"),
    ).toBeNull();
  });
});
