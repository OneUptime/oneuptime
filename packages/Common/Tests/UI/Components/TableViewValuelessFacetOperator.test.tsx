import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { act, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { JSONObject } from "../../../Types/JSON";

/*
 * "Owner is empty" - the schedules nobody owns - is a filter with no value
 * picked, and the view people most want to keep once owners filter at all.
 * Saved Views counted only picked values as something to save, so with
 * that chip alone it stayed hidden: the operators that filter on their own
 * ("is empty", "is not empty") count too; "is" and "is not" with nothing
 * picked still do not.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
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

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      deleteItem: () => {
        return Promise.resolve();
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return {
          toString: () => {
            return "e6c4b9a0-1a2b-4c3d-8e5f-6a7b8c9d0e1f";
          },
        };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      getUserId: () => {
        return {
          toString: () => {
            return "c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f";
          },
        };
      },
      isMasterAdmin: (): boolean => {
        return false;
      },
    },
  };
});

import TableViewElement, {
  VALUELESS_FACET_OPERATORS,
  isValuelessFacetOperator,
} from "../../../UI/Components/ModelTable/TableView";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";

// What useResourceOwners hands a table as its chips' state.
const facetState: (changes: JSONObject) => JSONObject = (
  changes: JSONObject,
): JSONObject => {
  return {
    selectedOwnerKeys: [],
    selectedLabelIds: [],
    facetSelections: {},
    ownerOperator: "is",
    labelOperator: "is",
    facetOperators: {},
    ...changes,
  };
};

const control: (currentFacetState: JSONObject) => ReactElement = (
  currentFacetState: JSONObject,
): ReactElement => {
  return (
    <TableViewElement<OnCallDutyPolicySchedule>
      tableId="on-call-schedules-table"
      onViewChange={() => {
        // the table's business
      }}
      currentQuery={{} as any}
      currentSortOrder={null}
      currentSortBy={null}
      currentItemsOnPage={10}
      currentFacetState={currentFacetState}
      tableView={null}
    />
  );
};

/*
 * The control shows itself while the project's views load; what it offers
 * is decided once they are in. So every assertion waits for that load.
 */
const renderSettled: (
  currentFacetState: JSONObject,
) => Promise<ReturnType<typeof render>> = async (
  currentFacetState: JSONObject,
): Promise<ReturnType<typeof render>> => {
  const view: ReturnType<typeof render> = render(control(currentFacetState));

  await waitFor(() => {
    expect(getListMock).toHaveBeenCalled();
  });

  // The views' load has answered; a task later, the control has drawn it.
  for (let task: number = 0; task < 2; task++) {
    await act(async (): Promise<void> => {
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 0);
      });
    });
  }

  return view;
};

describe("Saved Views for a chip that filters with no value picked", () => {
  beforeEach(() => {
    getListMock.mockReset();
    // The project has no saved views yet.
    getListMock.mockResolvedValue({
      data: [],
      count: 0,
      skip: 0,
      limit: 10,
    } as never);
  });

  test("the operators that filter on their own are is empty and is not empty", () => {
    expect([...VALUELESS_FACET_OPERATORS]).toEqual([
      "is_empty",
      "is_not_empty",
    ]);
    expect(isValuelessFacetOperator("is_empty")).toBe(true);
    expect(isValuelessFacetOperator("is_not_empty")).toBe(true);
    expect(isValuelessFacetOperator("is")).toBe(false);
    expect(isValuelessFacetOperator("is_not")).toBe(false);
  });

  test.each<[string, JSONObject]>([
    ["Owner is empty", { ownerOperator: "is_empty" }],
    ["Owner is not empty", { ownerOperator: "is_not_empty" }],
    ["Labels is empty", { labelOperator: "is_empty" }],
  ])(
    "%s, with nothing picked, can be saved",
    async (_chip: string, changes: JSONObject) => {
      await renderSettled(facetState(changes));

      expect(screen.getByText("Saved Views")).toBeInTheDocument();
    },
  );

  test("a picked owner can be saved, as before", async () => {
    await renderSettled(
      facetState({
        selectedOwnerKeys: ["team:40000000-0000-4000-8000-000000000001"],
      }),
    );

    expect(screen.getByText("Saved Views")).toBeInTheDocument();
  });

  test.each<[string, JSONObject]>([
    ["the chips untouched", {}],
    ["Owner is not, with no one picked", { ownerOperator: "is_not" }],
  ])(
    "%s offers nothing to save",
    async (_chip: string, changes: JSONObject) => {
      const { container } = await renderSettled(facetState(changes));

      expect(container).toBeEmptyDOMElement();
    },
  );
});
