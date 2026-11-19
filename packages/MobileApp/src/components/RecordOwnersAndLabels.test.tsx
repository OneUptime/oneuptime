import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { beforeEach, describe, expect, test } from "@jest/globals";
import RecordOwnersAndLabels, { orderOwners } from "./RecordOwnersAndLabels";
import { ThemeProvider } from "../theme";
import type { RecordOwnersAndLabels as OwnersAndLabelsResult } from "../hooks/useRecordOwnersAndLabels";
import type { RecordOwner } from "../api/recordPeople";

/*
 * A record's owners and labels on its detail screen: You first and marked,
 * nobody shown as "No owners yet", a failed read never shown as nobody, and
 * labels only when there are some.
 */

const mockResult: { current: OwnersAndLabelsResult } = {
  current: {} as OwnersAndLabelsResult,
};
const mockRefetch: jest.Mock = jest.fn(async () => {
  return undefined;
});

jest.mock("../hooks/useRecordOwnersAndLabels", () => {
  return {
    useRecordOwnersAndLabels: () => {
      return mockResult.current;
    },
  };
});

jest.mock("../auth/currentUser", () => {
  return {
    getCurrentUserIdSync: (): string => {
      return "user-me";
    },
  };
});

jest.mock("react-native/Libraries/Utilities/useColorScheme", () => {
  return {
    __esModule: true,
    default: (): "light" => {
      return "light";
    },
  };
});

function result(
  overrides: Partial<OwnersAndLabelsResult> = {},
): OwnersAndLabelsResult {
  return {
    owners: [],
    labels: [],
    isLoading: false,
    ownersFailed: false,
    refetch: mockRefetch,
    ...overrides,
  };
}

async function renderRows(): Promise<void> {
  await render(
    <ThemeProvider>
      <RecordOwnersAndLabels list="incidents" projectId="p" recordId="i1" />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  mockRefetch.mockClear();
});

describe("orderOwners", () => {
  test("the reader comes first and is marked; teams keep their place", () => {
    const owners: Array<RecordOwner> = [
      { kind: "team", id: "t1", name: "Platform" },
      { kind: "user", id: "user-2", name: "Priya" },
      { kind: "user", id: "user-me", name: "Alex" },
    ];
    expect(orderOwners(owners, "user-me")).toEqual([
      { kind: "user", id: "user-me", name: "Alex", isYou: true },
      { kind: "team", id: "t1", name: "Platform", isYou: false },
      { kind: "user", id: "user-2", name: "Priya", isYou: false },
    ]);
  });

  test("a team that shares an id with the reader is never You", () => {
    expect(
      orderOwners([{ kind: "team", id: "user-me", name: "Ops" }], "user-me")[0]
        ?.isYou,
    ).toBe(false);
  });
});

describe("RecordOwnersAndLabels", () => {
  test("names the owners, You first", async () => {
    mockResult.current = result({
      owners: [
        { kind: "team", id: "t1", name: "Platform" },
        { kind: "user", id: "user-me", name: "Alex Morgan" },
      ],
    });
    await renderRows();
    expect(screen.getByLabelText("Owners: You, Platform")).toBeTruthy();
    expect(screen.getByTestId("record-owner-user-user-me")).toBeTruthy();
    expect(screen.getByText("You")).toBeTruthy();
    expect(screen.queryByText("Alex Morgan")).toBeNull();
  });

  test("a record nobody owns says so", async () => {
    mockResult.current = result();
    await renderRows();
    expect(screen.getByText("No owners yet")).toBeTruthy();
    expect(screen.getByLabelText("Owners: none yet")).toBeTruthy();
  });

  test("owners that could not be read are not shown as nobody, and can be read again", async () => {
    mockResult.current = result({ ownersFailed: true });
    await renderRows();
    expect(screen.queryByText("No owners yet")).toBeNull();
    expect(screen.getByText("Could not load owners.")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Retry loading owners"));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  test("says it is loading, not that nobody owns it", async () => {
    mockResult.current = result({ isLoading: true });
    await renderRows();
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(screen.queryByText("No owners yet")).toBeNull();
  });

  test("labels show only when the record has some", async () => {
    mockResult.current = result();
    await renderRows();
    expect(screen.queryByTestId("record-labels")).toBeNull();

    mockResult.current = result({
      labels: [
        { id: "l1", name: "checkout", color: "#ff0000" },
        { id: "l2", name: "payments" },
      ],
    });
    await renderRows();
    expect(screen.getByLabelText("Labels: checkout, payments")).toBeTruthy();
  });
});
