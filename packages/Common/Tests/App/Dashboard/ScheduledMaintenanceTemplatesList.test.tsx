import "@testing-library/jest-dom";
import {
  cleanup,
  configure,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

configure({ asyncUtilTimeout: 15000 });

/*
 * The scheduled maintenance templates list, rendered for real - its
 * ModelTable and BaseModelTable, with only the API stubbed.
 *
 * Its Recurring Event column says when a template's next event is created.
 * A template turned off used to keep that time, so the list went on saying
 * "Next event will be scheduled at ..." while the job created no more
 * events. The list now reads the switch beside the time, as the job does,
 * and says No for a template that does not recur whatever time it holds.
 */

jest.mock("../../../UI/Utils/Permission", () => {
  const actualPermission: Record<string, unknown> = jest.requireActual(
    "../../../Types/Permission",
  ) as Record<string, unknown>;
  const PermissionEnum: Record<string, string> = actualPermission[
    "default"
  ] as Record<string, string>;
  const granted: Array<string> = [PermissionEnum["ProjectOwner"]!];

  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return granted;
      },
      getProjectPermissions: (): unknown => {
        return {
          _type: "UserTenantAccessPermission",
          permissions: granted.map((permission: string) => {
            return {
              _type: "UserPermission",
              permission: permission,
              labelIds: [],
              isBlockPermission: false,
            };
          }),
        };
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

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

import ScheduledMaintenanceTemplates from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceTemplates";
import ScheduledMaintenanceTemplate from "../../../Models/DatabaseModels/ScheduledMaintenanceTemplate";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import OneUptimeDate from "../../../Types/Date";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";

const NEXT_EVENT_AT: Date = new Date("2030-06-10T09:00:00.000Z");
const STALE_NEXT_EVENT_AT: Date = new Date("2030-06-17T09:00:00.000Z");

interface TemplateRow {
  _id: string;
  templateName: string;
  isRecurringEvent: boolean;
  scheduleNextEventAt?: Date | undefined;
}

const RECURRING: TemplateRow = {
  _id: "00000000-0000-4000-8000-000000000001",
  templateName: "Weekly database patching",
  isRecurringEvent: true,
  scheduleNextEventAt: NEXT_EVENT_AT,
};

// Turned off before the service cleared the time: off, still holding one.
const TURNED_OFF: TemplateRow = {
  _id: "00000000-0000-4000-8000-000000000002",
  templateName: "Quarterly failover drill",
  isRecurringEvent: false,
  scheduleNextEventAt: STALE_NEXT_EVENT_AT,
};

const BY_HAND: TemplateRow = {
  _id: "00000000-0000-4000-8000-000000000003",
  templateName: "Certificate rotation",
  isRecurringEvent: false,
};

// On, but with no time worked out: the job would create no event either.
const ON_WITHOUT_A_TIME: TemplateRow = {
  _id: "00000000-0000-4000-8000-000000000004",
  templateName: "Cache warm-up",
  isRecurringEvent: true,
};

function toModel(row: TemplateRow): ScheduledMaintenanceTemplate {
  const template: ScheduledMaintenanceTemplate =
    new ScheduledMaintenanceTemplate();

  template._id = row._id;
  template.templateName = row.templateName;
  template.templateDescription = `${row.templateName}, step by step.`;
  template.isRecurringEvent = row.isRecurringEvent;

  if (row.scheduleNextEventAt) {
    template.scheduleNextEventAt = row.scheduleNextEventAt;
  }

  return template;
}

let rows: Array<TemplateRow> = [];
// The template reads of the list - not the saved views' own.
let listCalls: Array<{ select: Record<string, unknown> }> = [];

async function renderList(shown: Array<TemplateRow>): Promise<Array<string>> {
  rows = shown;

  render(
    <ScheduledMaintenanceTemplates
      pageRoute={
        new Route("/dashboard/project/scheduled-maintenance-events/templates")
      }
      currentProject={null}
      hasPaymentMethod={true}
    />,
  );

  await waitFor(() => {
    expect(screen.getAllByTestId("template-recurring-event")).toHaveLength(
      shown.length,
    );
  });

  return recurringEventCells();
}

// The Recurring Event cell of each row, in the list's order.
function recurringEventCells(): Array<string> {
  return screen
    .getAllByTestId("template-recurring-event")
    .map((cell: HTMLElement): string => {
      return cell.textContent || "";
    });
}

function nextEventSentence(date: Date): string {
  return `Next event will be scheduled at ${OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(date)}`;
}

beforeEach(() => {
  rows = [];
  listCalls = [];
  PermissionGate.clearPermissionPropsCache();
  window.history.replaceState(
    window.history.state,
    "",
    "/dashboard/project/scheduled-maintenance-events/templates",
  );
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();

  jest.spyOn(ModelAPI, "getList").mockImplementation((async (args: {
    modelType: unknown;
    select: Record<string, unknown>;
  }) => {
    if (args.modelType !== ScheduledMaintenanceTemplate) {
      return { data: [], count: 0, skip: 0, limit: 50 };
    }

    listCalls.push({ select: args.select });

    return {
      data: rows.map(toModel),
      count: rows.length,
      skip: 0,
      limit: 50,
    } as ListResult<ScheduledMaintenanceTemplate>;
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the templates list's Recurring Event column", () => {
  test("says when a recurring template's next event is scheduled", async () => {
    expect(await renderList([RECURRING])).toEqual([
      nextEventSentence(NEXT_EVENT_AT),
    ]);
  });

  test("says No for a template turned off, though it still holds the time it had", async () => {
    expect(await renderList([TURNED_OFF])).toEqual(["No"]);
    expect(screen.queryByText(/Next event will be scheduled at/)).toBeNull();
    expect(
      screen.queryByText(
        OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
          STALE_NEXT_EVENT_AT,
        ),
        { exact: false },
      ),
    ).toBeNull();
  });

  test("says No for a template that never recurred, and for one with no time worked out", async () => {
    expect(await renderList([BY_HAND, ON_WITHOUT_A_TIME])).toEqual([
      "No",
      "No",
    ]);
  });

  test("tells each template apart in one list", async () => {
    expect(
      await renderList([RECURRING, TURNED_OFF, BY_HAND, ON_WITHOUT_A_TIME]),
    ).toEqual([nextEventSentence(NEXT_EVENT_AT), "No", "No", "No"]);

    const turnedOffRow: HTMLElement = screen
      .getByText(TURNED_OFF.templateName)
      .closest("tr")!;

    expect(
      within(turnedOffRow).getByTestId("template-recurring-event"),
    ).toHaveTextContent("No");
  });

  test("asks for the switch beside the time, so it can read both", async () => {
    await renderList([RECURRING]);

    expect(listCalls.length).toBeGreaterThan(0);

    for (const call of listCalls) {
      expect(call.select).toEqual(
        expect.objectContaining({
          isRecurringEvent: true,
          scheduleNextEventAt: true,
        }),
      );
    }
  });
});
