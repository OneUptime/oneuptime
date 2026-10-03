import "@testing-library/jest-dom";
import {
  afterEach,
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
  RenderResult,
  screen,
  waitFor,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * A card that is one switch (UI/Components/ModelSwitch/ModelSwitchCard): it
 * reads the switch's column of one record, shows a loader while it reads
 * and why when the read fails (with a way to try again), reads a column
 * nothing was ever written to as its model's default, and then draws the
 * switch, which saves when it is flipped (ModelSwitchRow has its own
 * suite).
 */

const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
    },
  };
});

import ModelSwitchCard, {
  ComponentProps,
} from "../../../UI/Components/ModelSwitch/ModelSwitchCard";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

const RECORD_ID: string = "6b6b6b6b-0000-4000-8000-0000000000aa";
const OTHER_ID: string = "6b6b6b6b-0000-4000-8000-0000000000bb";
const TEST_ID: string = "card-switch";

let stored: Record<string, unknown> | null | Error = null;

beforeEach(() => {
  stored = {};

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    if (stored instanceof Error) {
      throw stored;
    }

    if (!stored) {
      return null;
    }

    const item: StatusPage = new StatusPage();
    item._id = RECORD_ID;
    Object.assign(item, stored);
    return item;
  });

  updateByIdMock.mockReset();
  updateByIdMock.mockImplementation(async (): Promise<unknown> => {
    return {};
  });

  getJestSpyOn(PermissionGate, "checkColumnUpdate").mockImplementation(
    (): PermissionGateResult => {
      return { isAllowed: true };
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function cardFor<TBaseModel extends BaseModel>(
  props: Partial<ComponentProps<TBaseModel>> &
    Pick<ComponentProps<TBaseModel>, "modelType" | "column">,
): ReactElement {
  const all: ComponentProps<TBaseModel> = {
    modelId: new ObjectID(RECORD_ID),
    cardTitle: "MCP Server",
    cardDescription: "Whether AI agents can read this status page.",
    title: "Enable MCP Server",
    dataTestId: TEST_ID,
    ...props,
  } as ComponentProps<TBaseModel>;

  return <ModelSwitchCard<TBaseModel> {...all} />;
}

function mcpCard(props?: Partial<ComponentProps<StatusPage>>): ReactElement {
  return cardFor<StatusPage>({
    modelType: StatusPage,
    column: "enableMcpServer",
    ...props,
  });
}

async function loaded(): Promise<HTMLElement> {
  return await screen.findByTestId(TEST_ID);
}

interface GetItemCall {
  modelType: unknown;
  id: ObjectID;
  select: Record<string, unknown>;
}

function getItemCall(index: number = 0): GetItemCall {
  return getItemMock.mock.calls[index]![0] as GetItemCall;
}

describe("ModelSwitchCard reads its column", () => {
  test("it is a card with its title and line, then the switch", async () => {
    stored = { enableMcpServer: true };

    render(mcpCard());

    expect(screen.getByText("MCP Server")).toBeInTheDocument();
    expect(
      screen.getByText("Whether AI agents can read this status page."),
    ).toBeInTheDocument();

    const control: HTMLElement = await loaded();
    expect(control).toHaveAttribute("role", "switch");
    expect(control).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId(`${TEST_ID}-card`)).toContainElement(control);
  });

  test("it reads that record, for that column alone", async () => {
    stored = { enableMcpServer: false };

    render(mcpCard());
    await loaded();

    expect(getItemMock).toHaveBeenCalledTimes(1);
    expect(getItemCall().modelType).toBe(StatusPage);
    expect(getItemCall().id.toString()).toBe(RECORD_ID);
    expect(getItemCall().select).toEqual({ enableMcpServer: true });
  });

  test("columns the page asks for are read along with it, and handed over", async () => {
    stored = {
      enableEmbeddedOverallStatus: true,
      embeddedOverallStatusToken: "token-1",
    };
    const onLoaded: MockFunction = getJestMockFunction();

    render(
      cardFor<StatusPage>({
        modelType: StatusPage,
        column: "enableEmbeddedOverallStatus",
        select: { embeddedOverallStatusToken: true },
        onLoaded,
      }),
    );
    await loaded();

    expect(getItemCall().select).toEqual({
      embeddedOverallStatusToken: true,
      enableEmbeddedOverallStatus: true,
    });
    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(
      (onLoaded.mock.calls[0]![0] as StatusPage).embeddedOverallStatusToken,
    ).toBe("token-1");
  });

  test("onChange hears what was read, then every move", async () => {
    stored = { enableMcpServer: false };
    const onChange: MockFunction = getJestMockFunction();

    render(mcpCard({ onChange }));

    fireEvent.click(await loaded());
    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    expect(onChange.mock.calls).toEqual([[false], [true]]);
  });

  test("a column nothing was written to reads as its model's default", async () => {
    // enableMcpServer defaults to on.
    stored = {};

    render(mcpCard());

    expect(await loaded()).toHaveAttribute("aria-checked", "true");
  });

  test("an inverted switch reads the other way round, default included", async () => {
    /*
     * Monitor.disableActiveMonitoring defaults to false: a monitor nobody
     * turned off is checked.
     */
    getItemMock.mockImplementation(async (): Promise<unknown> => {
      return new Monitor();
    });

    render(
      cardFor<Monitor>({
        modelType: Monitor,
        column: "disableActiveMonitoring",
        isInverted: true,
        title: "Check this monitor",
      }),
    );

    expect(await loaded()).toHaveAttribute("aria-checked", "true");
    cleanup();

    getItemMock.mockImplementation(async (): Promise<unknown> => {
      const monitor: Monitor = new Monitor();
      monitor.disableActiveMonitoring = true;
      return monitor;
    });

    render(
      cardFor<Monitor>({
        modelType: Monitor,
        column: "disableActiveMonitoring",
        isInverted: true,
        title: "Check this monitor",
      }),
    );

    expect(await loaded()).toHaveAttribute("aria-checked", "false");
  });

  test("flipped, it saves the column", async () => {
    stored = { enableMcpServer: true };

    render(mcpCard());
    fireEvent.click(await loaded());

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });
    const call: { data: Record<string, unknown> } = updateByIdMock.mock
      .calls[0]![0] as { data: Record<string, unknown> };
    expect(call.data).toEqual({ enableMcpServer: false });
  });
});

describe("ModelSwitchCard while it reads, and when the read fails", () => {
  test("a loader shows until the record arrives, and no switch", async () => {
    let answer: (value: unknown) => void = (): void => {};
    getItemMock.mockImplementation((): Promise<unknown> => {
      return new Promise<unknown>((resolve: (value: unknown) => void) => {
        answer = resolve;
      });
    });

    render(mcpCard());

    expect(screen.queryByTestId(TEST_ID)).toBeNull();
    expect(screen.getByTestId(`${TEST_ID}-card`).textContent).not.toContain(
      "Enable MCP Server",
    );

    await act(async () => {
      const page: StatusPage = new StatusPage();
      page.enableMcpServer = false;
      answer(page);
    });

    expect(await loaded()).toHaveAttribute("aria-checked", "false");
  });

  test("a failed read says why, and trying again reads again", async () => {
    stored = new Error("The status page could not be read.");

    render(mcpCard());

    expect(
      await screen.findByText("The status page could not be read."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId(TEST_ID)).toBeNull();

    stored = { enableMcpServer: true };
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));

    expect(await loaded()).toHaveAttribute("aria-checked", "true");
    expect(getItemMock).toHaveBeenCalledTimes(2);
  });

  test("a record that is not there says so", async () => {
    stored = null;

    render(mcpCard());

    expect(await screen.findByText("Item not found")).toBeInTheDocument();
    expect(screen.queryByTestId(TEST_ID)).toBeNull();
  });
});

describe("ModelSwitchCard follows the record it is for", () => {
  test("another record's id reads again, and a late answer for the first is dropped", async () => {
    let answerFirst: (value: unknown) => void = (): void => {};

    getItemMock
      .mockImplementationOnce((): Promise<unknown> => {
        return new Promise<unknown>((resolve: (value: unknown) => void) => {
          answerFirst = resolve;
        });
      })
      .mockImplementationOnce(async (): Promise<unknown> => {
        const page: StatusPage = new StatusPage();
        page._id = OTHER_ID;
        page.enableMcpServer = false;
        return page;
      });

    const view: RenderResult = render(mcpCard());
    view.rerender(mcpCard({ modelId: new ObjectID(OTHER_ID) }));

    expect(await loaded()).toHaveAttribute("aria-checked", "false");
    expect(getItemCall(1).id.toString()).toBe(OTHER_ID);

    await act(async () => {
      const page: StatusPage = new StatusPage();
      page.enableMcpServer = true;
      answerFirst(page);
    });

    expect(screen.getByTestId(TEST_ID)).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  test("it reads and saves through the API it is given", async () => {
    const adminGetItem: MockFunction = getJestMockFunction();
    const adminUpdateById: MockFunction = getJestMockFunction();
    adminGetItem.mockImplementation(async (): Promise<unknown> => {
      const page: StatusPage = new StatusPage();
      page.enableMcpServer = true;
      return page;
    });
    adminUpdateById.mockImplementation(async (): Promise<unknown> => {
      return {};
    });

    const AdminApi: typeof ModelAPI = {
      getItem: adminGetItem,
      updateById: adminUpdateById,
    } as unknown as typeof ModelAPI;

    render(mcpCard({ modelAPI: AdminApi }));

    fireEvent.click(await loaded());

    await waitFor(() => {
      expect(adminUpdateById).toHaveBeenCalledTimes(1);
    });
    expect(adminGetItem).toHaveBeenCalledTimes(1);
    expect(getItemMock).not.toHaveBeenCalled();
    expect(updateByIdMock).not.toHaveBeenCalled();
  });
});
