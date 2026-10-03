import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import React from "react";
import { Mock } from "jest-mock";
import ObjectID from "../../../Types/ObjectID";

/*
 * Dashboard widgets and variables filter by incident and alert severity,
 * incident and alert state, monitor status and label through
 * EntityFilterDropdown. It listed them as plain names; like every other
 * picker of them it now asks for each row's colour and draws its dot.
 */

interface ListArgs {
  modelType: unknown;
  query: Record<string, unknown>;
  limit: number;
  skip: number;
  select: Record<string, unknown>;
  sort: Record<string, unknown>;
}

interface Row {
  _id: string;
  name: string;
  color?: string | undefined;
}

interface ListResultShape {
  data: Array<Row>;
  count: number;
  skip: number;
  limit: number;
}

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-7777-4aaa-8bbb-000000000007",
);

const getListMock: Mock<(args: ListArgs) => Promise<ListResultShape>> =
  jest.fn<(args: ListArgs) => Promise<ListResultShape>>();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (args: ListArgs): Promise<ListResultShape> => {
        return getListMock(args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): ObjectID => {
        return PROJECT_ID;
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyErrorMessage: (error: Error): string => {
        return error.message;
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

import EntityFilterDropdown from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/EntityFilterDropdown";
import { EntityFilterModelType } from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";

const FIRST: Row = {
  _id: "0193c0de-7777-4aaa-8bbb-000000000301",
  name: "Critical",
  color: "#dc2626",
};

const SECOND: Row = {
  _id: "0193c0de-7777-4aaa-8bbb-000000000302",
  name: "Minor",
  color: "#f59e0b",
};

// A row whose model has no colour, or that was saved without one.
const PLAIN: Row = {
  _id: "0193c0de-7777-4aaa-8bbb-000000000303",
  name: "API gateway",
};

function serve(rows: Array<Row>): void {
  getListMock.mockReset().mockImplementation((): Promise<ListResultShape> => {
    return Promise.resolve({
      data: rows,
      count: rows.length,
      skip: 0,
      limit: 1000,
    });
  });
}

function renderPicker(options: {
  type: EntityFilterModelType;
  isMultiSelect?: boolean | undefined;
  value?: string | Array<string> | undefined;
}): void {
  render(
    <EntityFilterDropdown
      entityFilterModelType={options.type}
      isMultiSelect={Boolean(options.isMultiSelect)}
      value={options.value}
      onChange={() => {
        return undefined;
      }}
    />,
  );
}

async function openMenu(): Promise<void> {
  await waitFor(() => {
    expect(screen.queryByText("Loading options...")).not.toBeInTheDocument();
  });

  fireEvent.keyDown(screen.getByRole("combobox"), {
    key: "ArrowDown",
    code: "ArrowDown",
  });
}

// The colour of the dot drawn in an element, as the dropdown titles it.
function dotIn(element: HTMLElement): string | undefined {
  const dot: HTMLElement | null = element.querySelector<HTMLElement>(
    'span[aria-hidden="true"][title]',
  );

  return dot?.getAttribute("title") || undefined;
}

beforeEach(() => {
  serve([FIRST, SECOND]);
});

afterEach(() => {
  cleanup();
});

const COLORED_TYPES: Array<EntityFilterModelType> = [
  EntityFilterModelType.IncidentSeverity,
  EntityFilterModelType.AlertSeverity,
  EntityFilterModelType.IncidentState,
  EntityFilterModelType.AlertState,
  EntityFilterModelType.MonitorStatus,
  EntityFilterModelType.Label,
];

describe("EntityFilterDropdown shows severities, states, statuses and labels with their colours", () => {
  test.each(COLORED_TYPES)(
    "%s: the list asks for each row's colour",
    async (type: EntityFilterModelType) => {
      renderPicker({ type: type });

      await waitFor(() => {
        expect(getListMock).toHaveBeenCalledTimes(1);
      });

      expect(getListMock.mock.calls[0]![0].select).toEqual({
        _id: true,
        name: true,
        color: true,
      });
    },
  );

  test.each(COLORED_TYPES)(
    "%s: each option in the menu has its row's colour",
    async (type: EntityFilterModelType) => {
      renderPicker({ type: type });

      await openMenu();

      const first: HTMLElement = await screen.findByRole("option", {
        name: "Critical",
      });
      const second: HTMLElement = screen.getByRole("option", {
        name: "Minor",
      });

      expect(dotIn(first)).toBe("#dc2626");
      expect(dotIn(second)).toBe("#f59e0b");
    },
  );

  test("the chosen severity shows its colour while the menu is closed", async () => {
    renderPicker({
      type: EntityFilterModelType.IncidentSeverity,
      value: SECOND._id,
    });

    const chosen: HTMLElement = await screen.findByText("Minor");

    await waitFor(() => {
      expect(dotIn(chosen.parentElement as HTMLElement)).toBe("#f59e0b");
    });
  });

  test("a row without a colour gets no dot", async () => {
    serve([FIRST, PLAIN]);

    renderPicker({ type: EntityFilterModelType.Label });

    await openMenu();

    const plain: HTMLElement = await screen.findByRole("option", {
      name: "API gateway",
    });

    expect(dotIn(plain)).toBeUndefined();
  });

  test("a monitor has no colour: none is asked for and none is drawn", async () => {
    serve([PLAIN]);

    renderPicker({ type: EntityFilterModelType.Monitor });

    await openMenu();

    const monitor: HTMLElement = await screen.findByRole("option", {
      name: "API gateway",
    });

    expect(getListMock.mock.calls[0]![0].select).toEqual({
      _id: true,
      name: true,
    });
    expect(dotIn(monitor)).toBeUndefined();
  });
});
