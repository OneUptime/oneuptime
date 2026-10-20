/** @timezone UTC */

import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Scheduled Maintenance > Settings > Calendar Settings (issue #5084): the
 * calendars from outside the project drawn on the Maintenance Calendar.
 *
 * ModelTable and BasicFormModal are stubbed and their props recorded: what
 * the page hands them is its contract - a form of a name and a link with the
 * colour and the refresh folded under More fields, the link never read back
 * and checked as the server checks it, a status that says why a calendar is
 * not working, and Read now, Change link and Turn on / off. The offline
 * browser suite (E2E MaintenanceCalendar) drives the same page for real.
 */

const recordedTables: Array<Record<string, unknown>> = [];
const recordedModals: Array<Record<string, unknown>> = [];

const mockState: { isMasterAdmin: boolean } = { isMasterAdmin: true };

const postMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: unknown): string => {
          return (
            (options as { defaultValue?: string } | undefined)?.defaultValue ??
            key
          );
        },
        i18n: { language: "en" },
      };
    },
  };
});

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      recordedTables.push(props);
      return React.createElement("div", { "data-testid": "model-table" });
    },
  };
});

jest.mock("../../../UI/Components/FormModal/BasicFormModal", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      recordedModals.push(props);
      return React.createElement(
        "div",
        { "data-testid": "change-link-modal" },
        String(props["title"]),
      );
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return "11111111-1111-4111-8111-111111111111";
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return mockState.isMasterAdmin;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return [];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown): string => {
        return error instanceof Error ? error.message : String(error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      updateById: (...args: Array<unknown>) => {
        return updateByIdMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

import ScheduledMaintenanceCalendarSettings, {
  MAINTENANCE_CALENDAR_DOCS_ROUTE,
  getCalendarLinkProblem,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceCalendarSettings";
import {
  EXTERNAL_CALENDAR_LINK_PROBLEM_TEXT,
  EXTERNAL_CALENDAR_READ_ERROR_TEXT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ExternalCalendarStatus";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { getReadNowPath } from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ExternalCalendarApi";
import URL from "../../../Types/API/URL";
import { APP_API_URL } from "../../../UI/Config";
import ScheduledMaintenanceExternalCalendar from "../../../Models/DatabaseModels/ScheduledMaintenanceExternalCalendar";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import {
  ExternalCalendarLinkProblem,
  ExternalCalendarReadError,
} from "../../../Types/ScheduledMaintenance/ExternalCalendar";
import ActionButtonSchema, {
  ActionButtonPlacement,
} from "../../../UI/Components/ActionButton/ActionButtonSchema";
import Field from "../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import { MORE_FIELDS_SECTION_TITLE } from "../../../UI/Components/Forms/Utils/AdvancedFormSection";
import { ModalType } from "../../../UI/Components/ModelTable/BaseModelTable";
import Column from "../../../UI/Components/ModelTable/Column";

type Calendar = ScheduledMaintenanceExternalCalendar;

const CALENDAR_ID: string = "5c000000-0000-4000-8000-000000000001";

function calendar(overrides: Partial<Calendar> = {}): Calendar {
  const model: Calendar = new ScheduledMaintenanceExternalCalendar();
  model._id = CALENDAR_ID;
  model.name = "Public holidays";
  model.color = new Color("#0d9488");
  model.calendarHost = "calendar.google.com";
  model.isEnabled = true;
  Object.assign(model, overrides);
  return model;
}

function renderPage(): Record<string, unknown> {
  recordedTables.length = 0;
  render(
    <ScheduledMaintenanceCalendarSettings {...({} as PageComponentProps)} />,
  );
  return recordedTables[recordedTables.length - 1]!;
}

// What the table was last told to read its rows by: a new value reloads it.
function lastRefreshToggle(): unknown {
  return recordedTables[recordedTables.length - 1]!["refreshToggle"];
}

function fields(table: Record<string, unknown>): Array<Field<Calendar>> {
  return table["formFields"] as Array<Field<Calendar>>;
}

function fieldFor(
  table: Record<string, unknown>,
  key: string,
): Field<Calendar> {
  const field: Field<Calendar> | undefined = fields(table).find(
    (item: Field<Calendar>) => {
      return Object.keys(item.field || {})[0] === key;
    },
  );

  if (!field) {
    throw new Error(`No field ${key}`);
  }

  return field;
}

function column(
  table: Record<string, unknown>,
  title: string,
): Column<Calendar> {
  const found: Column<Calendar> | undefined = (
    table["columns"] as Array<Column<Calendar>>
  ).find((item: Column<Calendar>) => {
    return item.title === title;
  });

  if (!found) {
    throw new Error(`No column ${title}`);
  }

  return found;
}

function action(
  table: Record<string, unknown>,
  title: string,
): ActionButtonSchema<Calendar> {
  const found: ActionButtonSchema<Calendar> | undefined = (
    table["actionButtons"] as Array<ActionButtonSchema<Calendar>>
  ).find((item: ActionButtonSchema<Calendar>) => {
    return item.title === title;
  });

  if (!found) {
    throw new Error(`No action ${title}`);
  }

  return found;
}

function renderCell(element: ReactElement): HTMLElement {
  return render(element).container;
}

beforeEach(() => {
  mockState.isMasterAdmin = true;
  postMock.mockReset();
  updateByIdMock.mockReset();
  postMock.mockImplementation(async () => {
    return new HTTPResponse(200, {}, {});
  });
  updateByIdMock.mockImplementation(async () => {
    return new HTTPResponse(200, {}, {});
  });
  recordedModals.length = 0;
});

afterEach(() => {
  cleanup();
});

describe("the table", () => {
  test("lists the calendars by name, with the docs a click away", () => {
    const table: Record<string, unknown> = renderPage();

    expect(table["modelType"]).toBe(ScheduledMaintenanceExternalCalendar);
    expect(table["singularName"]).toBe("External Calendar");
    expect(table["pluralName"]).toBe("External Calendars");
    expect(table["createVerb"]).toBe("Add");
    expect(table["sortBy"]).toBe("name");
    expect(table["isCreateable"]).toBe(true);
    expect(table["isEditable"]).toBe(true);
    expect(table["isDeleteable"]).toBe(true);
    expect(table["isViewable"]).toBe(false);
    expect((table["documentationLink"] as Route).toString()).toBe(
      MAINTENANCE_CALENDAR_DOCS_ROUTE,
    );
    expect(MAINTENANCE_CALENDAR_DOCS_ROUTE).toBe(
      "/docs/scheduled-maintenance/calendar",
    );
    expect(
      (table["cardProps"] as { title: string; description: string }).title,
    ).toBe("External Calendars");
    expect(
      (table["cardProps"] as { title: string; description: string })
        .description,
    ).toContain("never part of this project's own calendar links");
  });

  test("never asks for a calendar's link: the server never answers with one", () => {
    const table: Record<string, unknown> = renderPage();

    expect(Object.keys(table["selectMoreFields"] as object)).not.toContain(
      "calendarUrl",
    );
    expect(Object.keys(table["selectMoreFields"] as object)).toEqual(
      expect.arrayContaining([
        "calendarHost",
        "isEnabled",
        "lastReadAt",
        "lastReadError",
        "eventCount",
        "hasMoreEvents",
      ]),
    );

    for (const item of table["columns"] as Array<Column<Calendar>>) {
      expect(Object.keys(item.field || {})).not.toContain("calendarUrl");
    }
  });
});

describe("the form", () => {
  test("asks for a name and a link; the colour and the refresh are folded under More fields", () => {
    const table: Record<string, unknown> = renderPage();

    expect(
      fields(table).map((field: Field<Calendar>) => {
        return Object.keys(field.field || {})[0];
      }),
    ).toEqual(["name", "calendarUrl", "color", "refreshIntervalInMinutes"]);

    expect(fieldFor(table, "name").collapsibleSection).toBeUndefined();
    expect(fieldFor(table, "calendarUrl").collapsibleSection).toBeUndefined();
    expect(fieldFor(table, "color").collapsibleSection?.title).toBe(
      MORE_FIELDS_SECTION_TITLE,
    );
    // One section, built once, for both.
    expect(fieldFor(table, "refreshIntervalInMinutes").collapsibleSection).toBe(
      fieldFor(table, "color").collapsibleSection,
    );
    expect(table["formSteps"]).toBeUndefined();
  });

  test("the link is a plain text field, asked on create only, that it is a secret is said beside it", () => {
    const table: Record<string, unknown> = renderPage();
    const link: Field<Calendar> = fieldFor(table, "calendarUrl");

    expect(link.fieldType).toBe(FormFieldSchemaType.Text);
    expect(link.required).toBe(true);
    expect(link.doNotShowWhenEditing).toBe(true);
    expect(link.description).toContain("never shown again");
    expect(link.description).toContain("webcal://");
  });

  test("the link is checked as the server checks it, in the reader's words", () => {
    const table: Record<string, unknown> = renderPage();
    const check: (value: unknown) => string | null = (
      value: unknown,
    ): string | null => {
      return fieldFor(table, "calendarUrl").customValidation!({
        calendarUrl: value,
      } as never);
    };

    expect(check("https://calendar.google.com/calendar/ical/x/basic.ics")).toBe(
      null,
    );
    expect(check("webcal://p52-caldav.icloud.com/published/2/abc")).toBe(null);
    expect(check("holidays")).toBe(
      EXTERNAL_CALENDAR_LINK_PROBLEM_TEXT[ExternalCalendarLinkProblem.NotALink],
    );
    expect(check("ftp://calendar.example.com/a.ics")).toBe(
      EXTERNAL_CALENDAR_LINK_PROBLEM_TEXT[ExternalCalendarLinkProblem.NotHttp],
    );
    expect(check("")).toBe(
      EXTERNAL_CALENDAR_LINK_PROBLEM_TEXT[ExternalCalendarLinkProblem.Empty],
    );
    expect(getCalendarLinkProblem(`https://e.com/${"a".repeat(3000)}`)).toBe(
      EXTERNAL_CALENDAR_LINK_PROBLEM_TEXT[ExternalCalendarLinkProblem.TooLong],
    );
  });

  test("the refresh offers five choices, every hour among them, in words", () => {
    const table: Record<string, unknown> = renderPage();
    const refresh: Field<Calendar> = fieldFor(
      table,
      "refreshIntervalInMinutes",
    );

    expect(refresh.fieldType).toBe(FormFieldSchemaType.Dropdown);
    expect(refresh.title).toBe("Refresh");
    expect(refresh.dropdownOptions).toEqual([
      { label: "Every 15 minutes", value: 15 },
      { label: "Every 30 minutes", value: 30 },
      { label: "Every hour", value: 60 },
      { label: "Every 6 hours", value: 360 },
      { label: "Every day", value: 1440 },
    ]);
  });

  test("the colour is required, so the form starts with one picked", () => {
    const table: Record<string, unknown> = renderPage();

    expect(fieldFor(table, "color").fieldType).toBe(FormFieldSchemaType.Color);
    expect(fieldFor(table, "color").required).toBe(true);
  });

  test("a new calendar is read at once; an edited one is not", async () => {
    const table: Record<string, unknown> = renderPage();
    const onCreateSuccess: (
      item: Calendar,
      modalType?: ModalType,
    ) => Promise<Calendar> = table["onCreateSuccess"] as never;

    const created: Calendar = calendar();

    await act(async () => {
      await onCreateSuccess(created, ModalType.Create);
    });

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(
      (
        postMock.mock.calls[0]![0] as { url: { toString: () => string } }
      ).url.toString(),
    ).toBe(
      URL.fromURL(APP_API_URL).addRoute(getReadNowPath(CALENDAR_ID)).toString(),
    );
    expect(getReadNowPath(CALENDAR_ID)).toBe(
      `/scheduled-maintenance-external-calendar/${CALENDAR_ID}/read-now`,
    );

    await act(async () => {
      await onCreateSuccess(created, ModalType.Edit);
    });

    expect(postMock).toHaveBeenCalledTimes(1);
  });

  test("a new calendar whose first read is refused is still added: the Workers read it", async () => {
    postMock.mockImplementation(async () => {
      return new HTTPErrorResponse(400, { message: "Too soon" }, {});
    });

    const table: Record<string, unknown> = renderPage();
    const onCreateSuccess: (
      item: Calendar,
      modalType?: ModalType,
    ) => Promise<Calendar> = table["onCreateSuccess"] as never;
    const created: Calendar = calendar();

    let returned: Calendar | null = null;

    await act(async () => {
      returned = await onCreateSuccess(created, ModalType.Create);
    });

    expect(returned).toBe(created);
  });
});

describe("the columns", () => {
  test("a calendar is its colour, its name and the host its link points at - never the link", () => {
    const table: Record<string, unknown> = renderPage();
    const cell: HTMLElement = renderCell(
      column(table, "Calendar").getElement!(calendar()) as ReactElement,
    );

    expect(cell).toHaveTextContent("Public holidays");
    expect(cell).toHaveTextContent("calendar.google.com");
    expect(
      (cell.querySelector('[aria-hidden="true"]') as HTMLElement).style
        .backgroundColor,
    ).toBe("rgb(13, 148, 136)");
  });

  test.each([
    [
      "working",
      { lastReadAt: new Date("2026-10-15T10:00:00.000Z") },
      "Working",
      false,
    ],
    ["waiting", {}, "Waiting for the first read", false],
    ["off", { isEnabled: false }, "Off", false],
    [
      "not working",
      {
        lastReadAt: new Date("2026-10-14T10:00:00.000Z"),
        lastReadError: ExternalCalendarReadError.NotFound,
        lastReadHttpStatus: 404,
      },
      "Not working",
      true,
    ],
  ])(
    "a calendar that is %s says so",
    (
      _name: string,
      overrides: Partial<Calendar>,
      label: string,
      saysWhy: boolean,
    ) => {
      const table: Record<string, unknown> = renderPage();
      const cell: HTMLElement = renderCell(
        column(table, "Status").getElement!(
          calendar(overrides),
        ) as ReactElement,
      );

      expect(cell).toHaveTextContent(label);
      expect(
        within(cell).queryByTestId("external-calendar-status-reason") !== null,
      ).toBe(saysWhy);

      if (saysWhy) {
        expect(
          within(cell).getByTestId("external-calendar-status-reason"),
        ).toHaveTextContent(
          EXTERNAL_CALENDAR_READ_ERROR_TEXT[ExternalCalendarReadError.NotFound],
        );
      }
    },
  );

  test("a server error says its status", () => {
    const table: Record<string, unknown> = renderPage();
    const cell: HTMLElement = renderCell(
      column(table, "Status").getElement!(
        calendar({
          lastReadError: ExternalCalendarReadError.ServerError,
          lastReadHttpStatus: 503,
        }),
      ) as ReactElement,
    );

    expect(cell).toHaveTextContent(
      "The calendar's server answered with an error (HTTP 503).",
    );
  });

  test("the last read says when and how many events it kept", () => {
    const table: Record<string, unknown> = renderPage();
    const lastRead: Column<Calendar> = column(table, "Last read");

    expect(
      renderCell(lastRead.getElement!(calendar()) as ReactElement),
    ).toHaveTextContent("Not yet");

    expect(
      renderCell(
        lastRead.getElement!(
          calendar({
            lastReadAt: new Date("2026-10-15T10:00:00.000Z"),
            eventCount: 1,
          }),
        ) as ReactElement,
      ),
    ).toHaveTextContent("1 event");

    expect(
      renderCell(
        lastRead.getElement!(
          calendar({
            lastReadAt: new Date("2026-10-15T10:00:00.000Z"),
            eventCount: 24,
          }),
        ) as ReactElement,
      ),
    ).toHaveTextContent("24 events");

    expect(
      renderCell(
        lastRead.getElement!(
          calendar({
            lastReadAt: new Date("2026-10-15T10:00:00.000Z"),
            eventCount: 2000,
            hasMoreEvents: true,
          }),
        ) as ReactElement,
      ),
    ).toHaveTextContent("2000 events kept, the nearest today");
  });
});

describe("the row's actions", () => {
  test("live in the row's ⋯, Edit staying its button", () => {
    const table: Record<string, unknown> = renderPage();

    for (const item of table["actionButtons"] as Array<
      ActionButtonSchema<Calendar>
    >) {
      expect(item.placement).toBe(ActionButtonPlacement.MoreMenu);
    }

    expect(
      (table["actionButtons"] as Array<ActionButtonSchema<Calendar>>).map(
        (item: ActionButtonSchema<Calendar>) => {
          return item.title;
        },
      ),
    ).toEqual(["Read now", "Change link", "Turn on", "Turn off"]);
  });

  test("Read now reads it, then reloads the list; a refusal is shown", async () => {
    const table: Record<string, unknown> = renderPage();
    const readNow: ActionButtonSchema<Calendar> = action(table, "Read now");
    const done: MockFunction = getJestMockFunction();
    const failed: MockFunction = getJestMockFunction();

    expect(readNow.isVisible!(calendar())).toBe(true);
    expect(readNow.isVisible!(calendar({ isEnabled: false }))).toBe(false);

    const before: unknown = lastRefreshToggle();

    await act(async () => {
      await (readNow.onClick(
        calendar(),
        done as never,
        failed as never,
      ) as unknown as Promise<void>);
    });

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();

    // The row's status is read again: the table reloads.
    const afterRead: unknown = lastRefreshToggle();

    expect(afterRead).not.toBe(before);

    postMock.mockImplementation(async () => {
      return new HTTPErrorResponse(
        400,
        { message: "This calendar was read a moment ago." },
        {},
      );
    });

    await act(async () => {
      await (readNow.onClick(
        calendar(),
        done as never,
        failed as never,
      ) as unknown as Promise<void>);
    });

    expect(failed).toHaveBeenCalledTimes(1);
    // A refused read changed nothing: no reload.
    expect(lastRefreshToggle()).toBe(afterRead);
  });

  test("Turn off and Turn on write whether it is enabled, and each shows only when it applies", async () => {
    const table: Record<string, unknown> = renderPage();
    const turnOff: ActionButtonSchema<Calendar> = action(table, "Turn off");
    const turnOn: ActionButtonSchema<Calendar> = action(table, "Turn on");
    const done: MockFunction = getJestMockFunction();

    expect(turnOff.isVisible!(calendar())).toBe(true);
    expect(turnOn.isVisible!(calendar())).toBe(false);
    expect(turnOff.isVisible!(calendar({ isEnabled: false }))).toBe(false);
    expect(turnOn.isVisible!(calendar({ isEnabled: false }))).toBe(true);

    const before: unknown = lastRefreshToggle();

    await act(async () => {
      await (turnOff.onClick(
        calendar(),
        done as never,
        (() => {}) as never,
      ) as unknown as Promise<void>);
    });

    expect(updateByIdMock.mock.calls[0]![0]).toMatchObject({
      modelType: ScheduledMaintenanceExternalCalendar,
      id: new ObjectID(CALENDAR_ID),
      data: { isEnabled: false },
    });

    // The row says Off: the table reloads.
    const afterOff: unknown = lastRefreshToggle();

    expect(afterOff).not.toBe(before);

    await act(async () => {
      await (turnOn.onClick(
        calendar({ isEnabled: false }),
        done as never,
        (() => {}) as never,
      ) as unknown as Promise<void>);
    });

    expect(updateByIdMock.mock.calls[1]![0]).toMatchObject({
      data: { isEnabled: true },
    });
    expect(done).toHaveBeenCalledTimes(2);
    expect(lastRefreshToggle()).not.toBe(afterOff);
  });

  test("a Turn off the server refuses says why, and reloads nothing", async () => {
    updateByIdMock.mockImplementation(async () => {
      throw new Error("You do not have permission to edit this calendar.");
    });

    const table: Record<string, unknown> = renderPage();
    const failed: MockFunction = getJestMockFunction();
    const before: unknown = lastRefreshToggle();

    await act(async () => {
      await (action(table, "Turn off").onClick(
        calendar(),
        (() => {}) as never,
        failed as never,
      ) as unknown as Promise<void>);
    });

    expect(failed).toHaveBeenCalledTimes(1);
    expect((failed.mock.calls[0]![0] as Error).message).toBe(
      "You do not have permission to edit this calendar.",
    );
    expect(lastRefreshToggle()).toBe(before);
  });

  test("Change link asks for the new link alone, saves it, then reads the calendar", async () => {
    const table: Record<string, unknown> = renderPage();
    const changeLink: ActionButtonSchema<Calendar> = action(
      table,
      "Change link",
    );

    act(() => {
      changeLink.onClick(calendar(), (() => {}) as never, (() => {}) as never);
    });

    expect(screen.getByTestId("change-link-modal")).toHaveTextContent(
      "Change the link of Public holidays",
    );

    const modal: Record<string, unknown> =
      recordedModals[recordedModals.length - 1]!;
    const formProps: { fields: Array<Field<Record<string, unknown>>> } = modal[
      "formProps"
    ] as never;

    expect(formProps.fields).toHaveLength(1);
    expect(Object.keys(formProps.fields[0]!.field || {})).toEqual([
      "calendarUrl",
    ]);
    expect(
      formProps.fields[0]!.customValidation!({ calendarUrl: "nope" } as never),
    ).toBe(
      EXTERNAL_CALENDAR_LINK_PROBLEM_TEXT[ExternalCalendarLinkProblem.NotALink],
    );

    await act(async () => {
      await (modal["onSubmit"] as (data: unknown) => Promise<void>)({
        calendarUrl: "webcal://calendar.example.org/new.ics",
      });
    });

    expect(updateByIdMock.mock.calls[0]![0]).toMatchObject({
      id: new ObjectID(CALENDAR_ID),
      data: { calendarUrl: "webcal://calendar.example.org/new.ics" },
    });
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("change-link-modal")).toBeNull();
  });

  test("a refused new link keeps the dialog open, saying why", async () => {
    updateByIdMock.mockImplementation(async () => {
      throw new Error(
        "The link must start with https://, http:// or webcal://.",
      );
    });

    const table: Record<string, unknown> = renderPage();

    act(() => {
      action(table, "Change link").onClick(
        calendar(),
        (() => {}) as never,
        (() => {}) as never,
      );
    });

    await act(async () => {
      await (
        recordedModals[recordedModals.length - 1]!["onSubmit"] as (
          data: unknown,
        ) => Promise<void>
      )({ calendarUrl: "https://calendar.example.org/new.ics" });
    });

    expect(screen.getByTestId("change-link-modal")).toBeInTheDocument();
    expect(recordedModals[recordedModals.length - 1]!["error"]).toBe(
      "The link must start with https://, http:// or webcal://.",
    );
    expect(postMock).not.toHaveBeenCalled();
  });

  test("whoever may not change a calendar sees every change locked, saying why", () => {
    mockState.isMasterAdmin = false;

    const table: Record<string, unknown> = renderPage();

    for (const title of ["Read now", "Change link", "Turn on", "Turn off"]) {
      const item: ActionButtonSchema<Calendar> = action(table, title);

      expect({ title, disabled: item.disabled }).toEqual({
        title,
        disabled: true,
      });
    }
  });
});
