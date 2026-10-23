import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "Common/Tests/MockType";

/*
 * The Enterprise Powered by OneUptime card (ee/Dashboard/StatusPageBranding):
 * one switch, on = visitors see the line, stored the other way round
 * (StatusPage.hidePoweredByOneUptimeBranding).
 *
 * The switch row is recorded rather than drawn (StatusPageSwitchRow has
 * suites of its own): what matters is that the card reads the one column,
 * hands the row the page, the column, the inverted value and its words, and
 * says what a lapsed license means for the line.
 */

type Recorded = Record<string, unknown>;

const recordedRows: Array<Recorded> = [];
const getItemMock: MockFunction = getJestMockFunction();
let licenseModeForTest: string = "editable";

jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return (
          globalThis as unknown as { __poweredByGetItem: MockFunction }
        ).__poweredByGetItem(...args);
      },
    },
  };
});

jest.mock(
  "@oneuptime/dashboard/Components/StatusPage/StatusPageSwitchRow",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): ReactElement => {
        (
          globalThis as unknown as { __poweredByRows: Array<Recorded> }
        ).__poweredByRows.push(props);

        const react: typeof React = jest.requireActual("react") as typeof React;

        return react.createElement("div", {
          "data-testid": "recorded-switch-row",
        });
      },
    };
  },
);

jest.mock(
  "../../../Dashboard/Identity/License/UseEnterpriseLicenseMode",
  () => {
    return {
      __esModule: true,
      default: (): string => {
        return (
          globalThis as unknown as { __poweredByLicenseMode: () => string }
        ).__poweredByLicenseMode();
      },
    };
  },
);

(
  globalThis as unknown as { __poweredByGetItem: MockFunction }
).__poweredByGetItem = getItemMock;
(
  globalThis as unknown as { __poweredByRows: Array<Recorded> }
).__poweredByRows = recordedRows;
(
  globalThis as unknown as { __poweredByLicenseMode: () => string }
).__poweredByLicenseMode = (): string => {
  return licenseModeForTest;
};

import PoweredByCard from "../../../Dashboard/StatusPageBranding/PoweredByCard";
import StatusPagePoweredByCopy, {
  getPoweredByDescription,
  POWERED_BY_COLUMN,
  STATUS_PAGE_POWERED_BY_SWITCH_TEST_ID,
} from "@oneuptime/dashboard/Components/StatusPage/StatusPagePoweredByCopy";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import ObjectID from "Common/Types/ObjectID";

const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const pageWith: (hidden: boolean | undefined) => StatusPage = (
  hidden: boolean | undefined,
): StatusPage => {
  const page: StatusPage = new StatusPage();
  page.id = STATUS_PAGE_ID;

  if (hidden !== undefined) {
    page.hidePoweredByOneUptimeBranding = hidden;
  }

  return page;
};

beforeEach(() => {
  recordedRows.length = 0;
  licenseModeForTest = "editable";
  getItemMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("the Powered by OneUptime card", () => {
  test("reads the one column of this status page", async () => {
    getItemMock.mockResolvedValue(pageWith(false) as never);

    render(<PoweredByCard statusPageId={STATUS_PAGE_ID} />);

    await screen.findByTestId("recorded-switch-row");

    expect(getItemMock).toHaveBeenCalledTimes(1);
    expect(getItemMock).toHaveBeenCalledWith({
      modelType: StatusPage,
      id: STATUS_PAGE_ID,
      select: { hidePoweredByOneUptimeBranding: true },
    });
    expect(
      screen.getByText(StatusPagePoweredByCopy.cardTitle),
    ).toBeInTheDocument();
  });

  test.each([
    ["shown", false, true],
    ["hidden", true, false],
    ["never set (shown)", undefined, true],
  ] as Array<[string, boolean | undefined, boolean]>)(
    "a page with the line %s starts the switch at %p's opposite: on = shown",
    async (_label: string, hidden: boolean | undefined, switchOn: boolean) => {
      getItemMock.mockResolvedValue(pageWith(hidden) as never);

      render(<PoweredByCard statusPageId={STATUS_PAGE_ID} />);

      await screen.findByTestId("recorded-switch-row");

      expect(recordedRows[0]).toMatchObject({
        statusPageId: STATUS_PAGE_ID,
        column: POWERED_BY_COLUMN,
        initialValue: switchOn,
        isInverted: true,
        title: StatusPagePoweredByCopy.switchTitle,
        dataTestId: STATUS_PAGE_POWERED_BY_SWITCH_TEST_ID,
      });
    },
  );

  test("the line under the switch says what each position means", async () => {
    getItemMock.mockResolvedValue(pageWith(false) as never);

    render(<PoweredByCard statusPageId={STATUS_PAGE_ID} />);

    await screen.findByTestId("recorded-switch-row");

    const sayWhatItMeans: (isShown: boolean) => string = recordedRows[0]![
      "getDescription"
    ] as (isShown: boolean) => string;

    expect(sayWhatItMeans(true)).toBe(getPoweredByDescription(true));
    expect(sayWhatItMeans(false)).toBe(getPoweredByDescription(false));
    expect(getPoweredByDescription(true)).toBe(
      StatusPagePoweredByCopy.shownDescription,
    );
    expect(getPoweredByDescription(false)).toBe(
      StatusPagePoweredByCopy.hiddenDescription,
    );
  });

  test("a read that fails says why, and draws no switch", async () => {
    getItemMock.mockRejectedValue(new Error("The server is down") as never);

    render(<PoweredByCard statusPageId={STATUS_PAGE_ID} />);

    await waitFor(() => {
      expect(getItemMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(
        screen.queryByTestId("recorded-switch-row"),
      ).not.toBeInTheDocument();
    });
  });

  test("a valid license draws no notice", async () => {
    getItemMock.mockResolvedValue(pageWith(true) as never);

    render(<PoweredByCard statusPageId={STATUS_PAGE_ID} />);

    await screen.findByTestId("recorded-switch-row");

    expect(
      screen.queryByTestId(
        "enterprise-setting-license-read-only-notice-status-page-branding",
      ),
    ).not.toBeInTheDocument();
  });

  test("a lapsed license says every status page shows the line again, and the switch is kept", async () => {
    licenseModeForTest = "read-only";
    getItemMock.mockResolvedValue(pageWith(true) as never);

    render(<PoweredByCard statusPageId={STATUS_PAGE_ID} />);

    await screen.findByTestId("recorded-switch-row");

    expect(
      screen.getByTestId(
        "enterprise-setting-license-read-only-notice-status-page-branding",
      ),
    ).toHaveTextContent(
      "Every status page shows Powered by OneUptime, whatever this switch says.",
    );
  });
});
