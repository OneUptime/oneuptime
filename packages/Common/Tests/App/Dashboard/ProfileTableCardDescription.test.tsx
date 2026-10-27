import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ---------------------------------------------------------------------------
 * What the All profiles card says a row is, wherever the list sits
 * ---------------------------------------------------------------------------
 *
 * The Profiler's own All profiles page sits under its Overview in the side
 * menu, where what is slow is ranked across every service, so its card
 * points there. A service's, host's, cluster's, container host's or
 * inventory item's Profiles tab has its own ranked functions above the
 * list (or, an inventory item's, none), and there "use the Overview" read
 * as the resource's own Overview page, which shows no profiles: the card
 * says only what a row is. A table drawn without a card says neither.
 *
 * The real component renders with the table mocked to capture its props.
 */

type CapturedTableProps = {
  cardProps?: { title?: string; description?: string } | undefined;
};

let capturedTableProps: CapturedTableProps | null = null;

jest.mock("../../../UI/Components/ModelTable/AnalyticsModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps) => {
      capturedTableProps = props;
      return null;
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
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

import ProfileTable from "../../../../App/FeatureSet/Dashboard/src/Components/Profiles/ProfileTable";
import Profile from "../../../Models/AnalyticsModels/Profile";
import Query from "../../../Types/BaseDatabase/Query";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);

const PROFILER_DESCRIPTION: string =
  "Each row is one recording of about a minute. For what is slow right now, use the Overview.";
const RESOURCE_DESCRIPTION: string =
  "Each row is one recording of about a minute.";

async function cardPropsOf(
  element: React.ReactElement,
): Promise<CapturedTableProps["cardProps"]> {
  await act(async (): Promise<void> => {
    render(<MemoryRouter>{element}</MemoryRouter>);
  });
  await waitFor(() => {
    expect(capturedTableProps).not.toBeNull();
  });

  return capturedTableProps!.cardProps;
}

describe("the All profiles card's description", () => {
  beforeEach(() => {
    capturedTableProps = null;
    getListMock.mockReset();
    getListMock.mockImplementation(async () => {
      return { data: [], count: 0 };
    });
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    window.history.pushState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("the Profiler's own list points at its Overview", async () => {
    const cardProps: CapturedTableProps["cardProps"] = await cardPropsOf(
      <ProfileTable />,
    );

    expect(cardProps?.title).toBe("All profiles");
    expect(cardProps?.description).toBe(PROFILER_DESCRIPTION);
  });

  test("REGRESSION: a service's Profiles tab says what a row is, and no Overview it does not mean", async () => {
    const cardProps: CapturedTableProps["cardProps"] = await cardPropsOf(
      <ProfileTable
        modelId={SERVICE_ID}
        noItemsMessage="No profiles found for this service."
      />,
    );

    expect(cardProps?.title).toBe("All profiles");
    expect(cardProps?.description).toBe(RESOURCE_DESCRIPTION);
    expect(cardProps?.description).not.toContain("Overview");
  });

  test("so does a host's, a cluster's or a container host's tab (a profile query)", async () => {
    const hostQuery: Query<Profile> = {
      attributes: { "resource.host.name": "web-01" },
    } as unknown as Query<Profile>;

    const cardProps: CapturedTableProps["cardProps"] = await cardPropsOf(
      <ProfileTable profileQuery={hostQuery} />,
    );

    expect(cardProps?.description).toBe(RESOURCE_DESCRIPTION);
  });

  test("and an inventory item's tab (entity keys), which has nothing ranked above it", async () => {
    const cardProps: CapturedTableProps["cardProps"] = await cardPropsOf(
      <ProfileTable
        entityKeys={["host:11111111-1111-4111-8111-111111111111:web-01"]}
      />,
    );

    expect(cardProps?.description).toBe(RESOURCE_DESCRIPTION);
  });

  test("a table drawn without its card says neither", async () => {
    const cardProps: CapturedTableProps["cardProps"] = await cardPropsOf(
      <ProfileTable modelId={SERVICE_ID} isMinimalTable={true} />,
    );

    expect(cardProps).toBeUndefined();
  });

  test("both lines are short: one sentence says what a row is", () => {
    expect(PROFILER_DESCRIPTION.startsWith(RESOURCE_DESCRIPTION)).toBe(true);
    expect(PROFILER_DESCRIPTION.length).toBeLessThanOrEqual(100);
  });
});
