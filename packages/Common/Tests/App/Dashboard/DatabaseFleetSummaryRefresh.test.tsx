import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * When the Databases list refreshes the stat strip above it. The strip's
 * nine counts are project-wide, so what the table below is showing — a
 * page, a sort, a search, a facet — cannot change them: those fetches must
 * not re-run them, and the table's first fetch must not repeat the strip's
 * own first one. What CAN change them does refresh them at once: a
 * database created, databases archived. Anything else (a refresh click, the
 * live window moving on) refreshes them once they are old enough to have
 * drifted.
 */

const countMock: MockFunction = getJestMockFunction();
const stripTokens: Array<number> = [];

interface TableProps {
  onFetchSuccess: (data: Array<unknown>, totalCount: number) => void;
  onCreateSuccess: (item: unknown) => Promise<unknown>;
  bulkActions: {
    buttons: Array<{
      title: string;
      onClick: (props: {
        items: Array<unknown>;
        onProgressInfo: (info: unknown) => void;
        onBulkActionStart: () => void;
        onBulkActionEnd: () => void;
      }) => Promise<void>;
    }>;
  };
}

let tableProps: TableProps | null = null;
const archiveEndMock: MockFunction = getJestMockFunction();

// The arrow wrappers are load bearing: jest.mock is hoisted above the mocks.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (...args: Array<unknown>) => {
        return countMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: TableProps) => {
      tableProps = props;
      return <div data-testid="databases-table" />;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseServerSummaryStrip",
  () => {
    return {
      __esModule: true,
      default: (props: { refreshToken?: number }) => {
        stripTokens.push(props.refreshToken || 0);
        return (
          <div data-testid="summary-strip">{String(props.refreshToken)}</div>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DocumentationCard",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners",
  () => {
    return {
      __esModule: true,
      buildEnumFacetQuery: () => {
        return undefined;
      },
      default: () => {
        return {
          getOwnersForResource: () => {
            return [];
          },
          isLoadingOwners: false,
          onResourcesFetched: () => {},
          filterBar: <div />,
          mergeFiltersIntoQuery: (query: unknown) => {
            return query;
          },
          facetSaveState: undefined,
          restoreFacetState: () => {},
        };
      },
    };
  },
);

jest.mock("../../../UI/Components/BulkUpdate/BulkLabelActions", () => {
  return {
    __esModule: true,
    default: () => {
      return { bulkActions: [], modals: <></> };
    },
  };
});

jest.mock("../../../UI/Components/BulkUpdate/BulkOwnerActions", () => {
  return {
    __esModule: true,
    default: () => {
      return { bulkActions: [], modals: <></> };
    },
  };
});

jest.mock("../../../UI/Components/BulkUpdate/BulkArchiveActions", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        archiveBulkActions: [
          {
            title: "Archive",
            onClick: async (props: {
              onBulkActionStart: () => void;
              onBulkActionEnd: () => void;
            }): Promise<void> => {
              props.onBulkActionStart();
              props.onBulkActionEnd();
            },
          },
        ],
        unarchiveBulkActions: [],
      };
    },
  };
});

import Databases from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Databases";
import { DATABASE_FLEET_SUMMARY_MIN_REFRESH_MS } from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerSummary";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Route from "../../../Types/API/Route";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/test/databases"),
  currentProject: null,
  hasPaymentMethod: true,
};

let now: number = Date.parse("2026-09-24T10:00:00.000Z");

function latestToken(): number {
  return stripTokens[stripTokens.length - 1] as number;
}

async function renderPage(): Promise<TableProps> {
  render(
    <MemoryRouter>
      <Databases {...PAGE_PROPS} />
    </MemoryRouter>,
  );
  await screen.findByTestId("summary-strip");
  return tableProps as TableProps;
}

function tableFetched(table: TableProps): void {
  act(() => {
    table.onFetchSuccess([], 3);
  });
}

beforeEach(() => {
  now = Date.parse("2026-09-24T10:00:00.000Z");
  jest.spyOn(Date, "now").mockImplementation((): number => {
    return now;
  });
  countMock.mockReset();
  countMock.mockResolvedValue(3);
  archiveEndMock.mockReset();
  stripTokens.length = 0;
  tableProps = null;
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the Databases list's summary strip", () => {
  test("the table's first fetch does not repeat the strip's own first one", async () => {
    const table: TableProps = await renderPage();

    tableFetched(table);

    expect(latestToken()).toBe(0);
  });

  test("paging, sorting, searching and filtering the table leave the counts alone", async () => {
    const table: TableProps = await renderPage();

    for (let fetch: number = 0; fetch < 10; fetch++) {
      now += 1000;
      tableFetched(table);
    }

    expect(latestToken()).toBe(0);
  });

  test("a table fetch once the counts are old refreshes them (a refresh click, say)", async () => {
    const table: TableProps = await renderPage();

    now += DATABASE_FLEET_SUMMARY_MIN_REFRESH_MS;
    tableFetched(table);
    expect(latestToken()).toBe(1);

    // And not again straight after.
    now += 1000;
    tableFetched(table);
    expect(latestToken()).toBe(1);
  });

  test("creating a database refreshes them at once", async () => {
    const table: TableProps = await renderPage();

    await act(async () => {
      await table.onCreateSuccess({});
    });

    expect(latestToken()).toBe(1);
  });

  test("archiving databases refreshes them at once, after the table's own end handler", async () => {
    const table: TableProps = await renderPage();
    const archive: TableProps["bulkActions"]["buttons"][number] | undefined =
      table.bulkActions.buttons.find((button: { title: string }): boolean => {
        return button.title === "Archive";
      });
    expect(archive).toBeDefined();

    await act(async () => {
      await archive!.onClick({
        items: [],
        onProgressInfo: (): void => {},
        onBulkActionStart: (): void => {},
        onBulkActionEnd: (): void => {
          archiveEndMock();
        },
      });
    });

    expect(archiveEndMock).toHaveBeenCalledTimes(1);
    expect(latestToken()).toBe(1);
  });
});
