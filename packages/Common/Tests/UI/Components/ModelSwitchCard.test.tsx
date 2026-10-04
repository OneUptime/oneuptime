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
 *
 * A card can also draw read-only lines under its switch (getDetails), from
 * the record and from where the switch is now; such a card reads the record
 * again, quietly, after every save of its column.
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
import { announceModelSwitchSaved } from "../../../UI/Components/ModelSwitch/ModelSwitchEvents";
import Incident from "../../../Models/DatabaseModels/Incident";
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

/*
 * Lines under the switch: an incident's reminders card shows when the next
 * reminder goes out and how many were sent, which the server works out
 * again whenever reminders are switched on or off.
 */
describe("ModelSwitchCard with lines under its switch", () => {
  const LATER: Date = new Date("2031-01-01T10:00:00.000Z");

  // What the server holds for the incident, read by every getItem.
  let incidentStored: Record<string, unknown> = {};

  beforeEach(() => {
    incidentStored = {};

    getItemMock.mockImplementation(async (): Promise<unknown> => {
      const incident: Incident = new Incident();
      incident._id = RECORD_ID;
      Object.assign(incident, incidentStored);
      return incident;
    });

    // Saving turns reminders on or off, and the server works the rest out.
    updateByIdMock.mockImplementation(
      async (options: unknown): Promise<unknown> => {
        const data: Record<string, unknown> = (
          options as { data: Record<string, unknown> }
        ).data;

        Object.assign(incidentStored, data);
        incidentStored["nextReminderNotificationAt"] =
          data["enableReminders"] === false ? null : LATER;

        return {};
      },
    );
  });

  function remindersCard(
    props?: Partial<ComponentProps<Incident>>,
  ): ReactElement {
    return cardFor<Incident>({
      modelType: Incident,
      column: "enableReminders",
      cardTitle: "Reminders",
      cardDescription: "Remind this incident's owners while it is still open.",
      title: "Send reminders",
      select: {
        nextReminderNotificationAt: true,
        reminderNotificationSentCount: true,
      },
      getDetails: (item: Incident, isOn: boolean): ReactElement => {
        return (
          <dl>
            <dt>Switch</dt>
            <dd data-testid="detail-switch">{isOn ? "on" : "off"}</dd>
            <dt>Next</dt>
            <dd data-testid="detail-next">
              {item.nextReminderNotificationAt
                ? new Date(item.nextReminderNotificationAt).toISOString()
                : "none"}
            </dd>
            <dt>Sent</dt>
            <dd data-testid="detail-sent">
              {String(item.reminderNotificationSentCount ?? 0)}
            </dd>
          </dl>
        );
      },
      ...props,
    });
  }

  function detailsText(id: string): string {
    return screen.getByTestId(id).textContent || "";
  }

  function getItemSelects(): Array<Record<string, unknown>> {
    return getItemMock.mock.calls.map((call: Array<unknown>) => {
      return (call[0] as GetItemCall).select;
    });
  }

  test("the lines are drawn under the switch, from the record it read with them", async () => {
    incidentStored = {
      enableReminders: true,
      nextReminderNotificationAt: LATER,
      reminderNotificationSentCount: 3,
    };

    render(remindersCard());

    const control: HTMLElement = await loaded();
    const details: HTMLElement = screen.getByTestId(`${TEST_ID}-details`);

    expect(getItemSelects()).toEqual([
      {
        nextReminderNotificationAt: true,
        reminderNotificationSentCount: true,
        enableReminders: true,
      },
    ]);

    // Inside the card, after the switch's own row.
    expect(screen.getByTestId(`${TEST_ID}-card`)).toContainElement(details);
    expect(
      screen.getByTestId(`${TEST_ID}-row`).compareDocumentPosition(details) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(details).not.toContainElement(control);

    expect(detailsText("detail-switch")).toBe("on");
    expect(detailsText("detail-next")).toBe(LATER.toISOString());
    expect(detailsText("detail-sent")).toBe("3");
  });

  test("a card without lines draws no row for them", async () => {
    stored = { enableMcpServer: true };

    render(mcpCard());
    await loaded();

    expect(screen.queryByTestId(`${TEST_ID}-details`)).toBeNull();
  });

  test("the lines follow the switch the moment it moves, before its save is back", async () => {
    incidentStored = { enableReminders: true };

    let finishSave: () => void = (): void => {};
    updateByIdMock.mockImplementation((): Promise<unknown> => {
      return new Promise<unknown>((resolve: (value: unknown) => void) => {
        finishSave = (): void => {
          resolve({});
        };
      });
    });

    render(remindersCard());

    fireEvent.click(await loaded());

    expect(detailsText("detail-switch")).toBe("off");
    expect(updateByIdMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishSave();
    });
  });

  test("after it saves, the record is read again, quietly, and the lines show what the server worked out", async () => {
    incidentStored = {
      enableReminders: false,
      nextReminderNotificationAt: null,
      reminderNotificationSentCount: 2,
    };

    render(remindersCard());

    const control: HTMLElement = await loaded();
    expect(detailsText("detail-next")).toBe("none");

    fireEvent.click(control);

    await waitFor(() => {
      expect(getItemMock).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      expect(detailsText("detail-next")).toBe(LATER.toISOString());
    });

    expect(updateByIdMock.mock.calls[0]![0]).toEqual(
      expect.objectContaining({ data: { enableReminders: true } }),
    );
    // Read with the same columns, and the switch never left the screen.
    expect(getItemSelects()[1]).toEqual(getItemSelects()[0]);
    expect(screen.getByTestId(TEST_ID)).toBe(control);
    expect(control).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId(`${TEST_ID}-status`)).toHaveTextContent("Saved");
    expect(detailsText("detail-sent")).toBe("2");
  });

  test("onLoaded hears the quiet read as well", async () => {
    incidentStored = { enableReminders: true };
    const onLoaded: MockFunction = getJestMockFunction();

    render(remindersCard({ onLoaded }));

    fireEvent.click(await loaded());

    await waitFor(() => {
      expect(onLoaded).toHaveBeenCalledTimes(2);
    });
    expect((onLoaded.mock.calls[1]![0] as Incident).enableReminders).toBe(
      false,
    );
  });

  test("while the quiet read is out, no loader replaces the switch", async () => {
    incidentStored = { enableReminders: true };

    render(remindersCard());
    const control: HTMLElement = await loaded();

    let answer: (value: unknown) => void = (): void => {};
    getItemMock.mockImplementation((): Promise<unknown> => {
      return new Promise<unknown>((resolve: (value: unknown) => void) => {
        answer = resolve;
      });
    });

    fireEvent.click(control);

    await waitFor(() => {
      expect(getItemMock).toHaveBeenCalledTimes(2);
    });

    expect(screen.getByTestId(TEST_ID)).toBe(control);
    expect(screen.getByTestId(`${TEST_ID}-details`)).toBeInTheDocument();

    await act(async () => {
      const incident: Incident = new Incident();
      incident.enableReminders = false;
      incident.reminderNotificationSentCount = 7;
      answer(incident);
    });

    expect(detailsText("detail-sent")).toBe("7");
  });

  test("a quiet read that fails leaves the card as it was, with no error over it", async () => {
    incidentStored = {
      enableReminders: true,
      reminderNotificationSentCount: 4,
    };

    render(remindersCard());
    const control: HTMLElement = await loaded();

    getItemMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error("The incident could not be read.");
    });

    fireEvent.click(control);

    await waitFor(() => {
      expect(getItemMock).toHaveBeenCalledTimes(2);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByText("The incident could not be read.")).toBeNull();
    expect(screen.getByTestId(TEST_ID)).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(detailsText("detail-sent")).toBe("4");
    expect(detailsText("detail-switch")).toBe("off");
  });

  test("a refused save moves the lines back with the switch, and reads nothing again", async () => {
    incidentStored = {
      enableReminders: true,
      nextReminderNotificationAt: LATER,
    };
    updateByIdMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error("You do not have permission to edit this incident.");
    });

    render(remindersCard());

    fireEvent.click(await loaded());

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "You do not have permission to edit this incident.",
      );
    });

    expect(detailsText("detail-switch")).toBe("on");
    expect(getItemMock).toHaveBeenCalledTimes(1);
  });

  test("a save of the column elsewhere on the screen is read again too", async () => {
    incidentStored = { enableReminders: true };

    render(remindersCard());
    await loaded();

    incidentStored = {
      enableReminders: false,
      reminderNotificationSentCount: 9,
    };

    await act(async () => {
      announceModelSwitchSaved({
        modelType: Incident,
        modelId: new ObjectID(RECORD_ID),
        column: "enableReminders",
        value: false,
      });
    });

    await waitFor(() => {
      expect(detailsText("detail-sent")).toBe("9");
    });
    // The switch heard it as well.
    expect(screen.getByTestId(TEST_ID)).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(detailsText("detail-switch")).toBe("off");
  });

  test("another record's, another column's or another table's save reads nothing", async () => {
    incidentStored = { enableReminders: true };

    render(remindersCard());
    await loaded();

    await act(async () => {
      announceModelSwitchSaved({
        modelType: Incident,
        modelId: new ObjectID(OTHER_ID),
        column: "enableReminders",
        value: false,
      });
      announceModelSwitchSaved({
        modelType: Incident,
        modelId: new ObjectID(RECORD_ID),
        column: "isPrivate",
        value: true,
      });
      announceModelSwitchSaved({
        modelType: StatusPage,
        modelId: new ObjectID(RECORD_ID),
        column: "enableReminders",
        value: false,
      });
    });

    expect(getItemMock).toHaveBeenCalledTimes(1);
  });

  test("a card without lines never reads again after a save", async () => {
    stored = { enableMcpServer: true };

    render(mcpCard());
    fireEvent.click(await loaded());

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(getItemMock).toHaveBeenCalledTimes(1);
  });

  test("of two quiet reads, the later one wins", async () => {
    incidentStored = { enableReminders: true };

    render(remindersCard());
    const control: HTMLElement = await loaded();

    const answers: Array<(value: unknown) => void> = [];
    getItemMock.mockImplementation((): Promise<unknown> => {
      return new Promise<unknown>((resolve: (value: unknown) => void) => {
        answers.push(resolve);
      });
    });

    fireEvent.click(control);
    await waitFor(() => {
      expect(answers).toHaveLength(1);
    });

    fireEvent.click(control);
    await waitFor(() => {
      expect(answers).toHaveLength(2);
    });

    await act(async () => {
      const second: Incident = new Incident();
      second.reminderNotificationSentCount = 2;
      answers[1]!(second);
    });

    await act(async () => {
      const first: Incident = new Incident();
      first.reminderNotificationSentCount = 1;
      answers[0]!(first);
    });

    expect(detailsText("detail-sent")).toBe("2");
  });

  test("once it is gone it no longer reads", async () => {
    incidentStored = { enableReminders: true };

    const view: RenderResult = render(remindersCard());
    await loaded();
    view.unmount();

    await act(async () => {
      announceModelSwitchSaved({
        modelType: Incident,
        modelId: new ObjectID(RECORD_ID),
        column: "enableReminders",
        value: false,
      });
    });

    expect(getItemMock).toHaveBeenCalledTimes(1);
  });
});
