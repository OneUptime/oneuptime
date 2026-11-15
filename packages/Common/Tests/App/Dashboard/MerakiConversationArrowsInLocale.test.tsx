/** @timezone UTC */

import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * WHO TALKS TO WHOM: THE ROW'S ARROW AND ITS TITLE'S POINT THE SAME WAY
 * (#7724).
 *
 * A row of the Meraki side's "Who talks to whom" names a network and what
 * it reached, with an arrow between them, and under the pointer says the
 * same as one line (its title, joinWithArrowsOn). The row was kept left to
 * right and drew an arrow icon, so on an Arabic or Persian page it pointed
 * right, from the network at the left, while its title, read from the
 * right, pointed left: two arrows side by side pointing opposite ways. The
 * row now reads the way the page does, its arrow DirectionArrow's: there
 * the network is at the right, and both arrows point left, to its target.
 * English reads as it did.
 *
 * Rendered through the Meraki side itself (MerakiTrafficView), in the
 * Dashboard's own locales, inside a page read the language's way.
 */

jest.mock("../../../UI/Components/Charts/Area/AreaChart", () => {
  return {
    ...(jest.requireActual(
      "../../../UI/Components/Charts/Area/AreaChart",
    ) as Record<string, unknown>),
    __esModule: true,
    default: (jest.requireActual("./ChartZoomStandIn") as { default: unknown })
      .default,
  };
});

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    ...(jest.requireActual(
      "../../../UI/Components/Charts/Line/LineChart",
    ) as Record<string, unknown>),
    __esModule: true,
    default: (jest.requireActual("./ChartZoomStandIn") as { default: unknown })
      .default,
  };
});

import MerakiTrafficView from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkTraffic/Meraki/MerakiTrafficView";
import {
  getUnavailableNetworkTrafficUsageSummary,
  NetworkTrafficUsageConversationRow,
  NetworkTrafficUsageSummary,
} from "../../../Types/NetFlow/NetworkTrafficUsage";
import { getReadingDirection } from "../../../Types/ReadingDirection";
import { ParagraphDirection } from "../../Helpers/BidiLayout";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { getPathArrows, PathArrow } from "../../Helpers/PathArrows";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const CONVERSATIONS: Array<NetworkTrafficUsageConversationRow> = [
  {
    controllerNetworkId: "L_1000",
    controllerNetworkName: "Branch 1",
    destination: "teams.microsoft.com",
    application: "Microsoft Teams",
    protocol: "UDP",
    port: 3478,
    sentOctets: 1_000_000,
    receivedOctets: 9_000_000,
    flows: 1204,
    clients: 34,
  },
  // A network named in Arabic letters, to an address.
  {
    controllerNetworkId: "L_1001",
    controllerNetworkName: "فرع الرياض",
    destination: "52.112.0.10",
    application: "Microsoft Teams",
    protocol: "TCP",
    port: 443,
    sentOctets: 500_000,
    receivedOctets: 500_000,
    flows: 1,
    clients: 1,
  },
];

const SUMMARY: NetworkTrafficUsageSummary = {
  ...getUnavailableNetworkTrafficUsageSummary({
    startTime: new Date("2026-10-01T11:00:00.000Z"),
    endTime: new Date("2026-10-01T12:00:00.000Z"),
  }),
  isAvailable: true,
  totals: { sentOctets: 30_000_000, receivedOctets: 150_000_000, flows: 180 },
  applicationTotals: { sentOctets: 1_500_000, receivedOctets: 9_500_000 },
  topNetworks: [
    {
      controllerNetworkId: "L_1000",
      name: "Branch 1",
      sentOctets: 20_000_000,
      receivedOctets: 100_000_000,
    },
    {
      controllerNetworkId: "L_1001",
      name: "فرع الرياض",
      sentOctets: 10_000_000,
      receivedOctets: 50_000_000,
    },
  ],
  topConversations: CONVERSATIONS,
  lastUplinkAt: "2026-10-01T11:55:00.000Z",
  lastAnalyticsAt: "2026-10-01T10:00:00.000Z",
};

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      ar: { translation: readLocale("ar") },
      fa: { translation: readLocale("fa") },
    },
    interpolation: { escapeValue: false },
  });
});

afterEach(() => {
  cleanup();
});

// The Meraki side of the whole network's page, in a page read `language`'s way.
async function renderView(language: string): Promise<ParagraphDirection> {
  await i18next.changeLanguage(language);

  const pageDirection: ParagraphDirection = getReadingDirection(language);

  render(
    <MemoryRouter>
      <div dir={pageDirection}>
        <MerakiTrafficView
          scopeKind="network"
          summary={SUMMARY}
          isLoading={false}
          error=""
          filters={{}}
          onFiltersChange={(): void => {
            return;
          }}
          headerElement={<></>}
          hasFlows={false}
          onShowFlows={(): void => {
            return;
          }}
          getRequest={() => {
            return {
              startTime: SUMMARY.windowStartAt,
              endTime: SUMMARY.windowEndAt,
            };
          }}
          onApplianceChanged={(): void => {
            return;
          }}
        />
      </div>
    </MemoryRouter>,
  );

  return pageDirection;
}

function conversationRows(): Array<HTMLElement> {
  return within(screen.getByTestId("meraki-conversations")).getAllByTestId(
    "meraki-conversations-row",
  );
}

// An arrow as it is drawn: the glyph (never mirrored), and whether it points back.
interface DrawnArrow {
  arrow: string;
  pointsBack: boolean;
}

/*
 * The row's own arrow, between the network and its target. The row is a
 * flex row: its first item, the network, is where the row's lines start -
 * at the right in a row read from the right - so the arrow points on, to
 * the target, when it is "←" there and "→" in a row read from the left.
 */
function rowArrow(row: HTMLElement): DrawnArrow {
  const arrow: HTMLElement = within(row).getByTestId(
    "meraki-conversation-arrow",
  );
  const rowDirection: string =
    arrow.closest("[dir]")?.getAttribute("dir") || "ltr";
  const glyph: string = arrow.textContent || "";

  return {
    arrow: glyph,
    pointsBack: (rowDirection === "rtl") === (glyph === "→"),
  };
}

// The row's title under the pointer, laid out as a line of the page.
function titleArrow(
  row: HTMLElement,
  pageDirection: ParagraphDirection,
): DrawnArrow {
  const title: string =
    within(row)
      .getByTestId("meraki-conversations-row-label")
      .getAttribute("title") || "";
  const arrows: Array<PathArrow> = getPathArrows(title, pageDirection);

  expect(arrows).toHaveLength(1);

  return {
    arrow: (arrows[0] as PathArrow).arrow,
    pointsBack: (arrows[0] as PathArrow).pointsBack,
  };
}

describe("Who talks to whom: a row's arrow and its title's point the same way", () => {
  for (const language of ["ar", "fa"]) {
    test(`${language}: from the network to its target, both arrows point left, the network at the right`, async () => {
      const pageDirection: ParagraphDirection = await renderView(language);
      const rows: Array<HTMLElement> = conversationRows();

      expect(pageDirection).toBe("rtl");
      expect(rows).toHaveLength(2);

      for (const row of rows) {
        expect(rowArrow(row)).toEqual({ arrow: "←", pointsBack: false });
        expect(titleArrow(row, pageDirection)).toEqual(rowArrow(row));
      }
    });

    test(`${language}: each name reads its own way, cut short at its own end`, async () => {
      await renderView(language);

      const [latin, arabic]: Array<HTMLElement> = conversationRows() as [
        HTMLElement,
        HTMLElement,
      ];

      expect(
        within(latin).getByTestId("meraki-conversation-from"),
      ).toHaveAttribute("dir", "ltr");
      expect(
        within(latin).getByTestId("meraki-conversation-to"),
      ).toHaveAttribute("dir", "ltr");
      // An Arabic name reads the page's way; an address has no letters to turn it.
      expect(
        within(arabic).getByTestId("meraki-conversation-from"),
      ).not.toHaveAttribute("dir");
      expect(
        within(arabic).getByTestId("meraki-conversation-to"),
      ).not.toHaveAttribute("dir");
    });
  }

  test("English: the row and its title read from the left, as before", async () => {
    const pageDirection: ParagraphDirection = await renderView("en");
    const [latin, arabic]: Array<HTMLElement> = conversationRows() as [
      HTMLElement,
      HTMLElement,
    ];

    expect(rowArrow(latin)).toEqual({ arrow: "→", pointsBack: false });
    expect(titleArrow(latin, pageDirection)).toEqual(rowArrow(latin));
    expect(
      within(latin)
        .getByTestId("meraki-conversations-row-label")
        .getAttribute("title"),
    ).toBe("Branch 1 → teams.microsoft.com");
    expect(
      within(latin).getByTestId("meraki-conversation-from"),
    ).not.toHaveAttribute("dir");
    expect(
      within(latin).getByTestId("meraki-conversation-to"),
    ).not.toHaveAttribute("dir");

    // A network named in Arabic letters reads its own way on an English page.
    expect(rowArrow(arabic)).toEqual({ arrow: "→", pointsBack: false });
    expect(titleArrow(arabic, pageDirection)).toEqual(rowArrow(arabic));
    expect(
      within(arabic).getByTestId("meraki-conversation-from"),
    ).toHaveAttribute("dir", "rtl");
    expect(
      withoutIsolateMarks(
        within(arabic)
          .getByTestId("meraki-conversations-row-label")
          .getAttribute("title") || "",
      ),
    ).toBe("فرع الرياض → 52.112.0.10");
  });
});
