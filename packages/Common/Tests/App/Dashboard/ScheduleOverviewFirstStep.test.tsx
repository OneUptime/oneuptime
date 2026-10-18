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
  configure,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A schedule's Overview, for real.
 *
 * It used to open with a banner of its own about "the roster" - "Bob Rivera
 * is currently on the roster for this schedule. This user has been on the
 * roster since ..." - above the Final Schedule, whose first two tiles say
 * who is on call now and next, overrides included: two answers to one
 * question. A schedule nobody took turns on yet said it in red ("every
 * alert that escalates to this schedule will go unanswered. Check the layers
 * below"), under two calendar cards offering links to shifts nobody had,
 * and at the bottom "No Layers in this On Call Schedule. Please go to layers
 * tab to add one." with no way to get there.
 *
 * Now the Final Schedule says who is on call, a schedule without layers
 * shows one step - Go to Layers - and the calendar and chat cards wait until
 * there are shifts to follow. Its Edit button names it as every menu does.
 *
 * The page, its details card, FinalPreview and the edit dialog are the real
 * ones. The Final Schedule's calendar (LayersPreview) and the calendar and
 * chat cards, which have suites of their own, are markers; the network and
 * the permission snapshot are stubbed.
 */

configure({ asyncUtilTimeout: 15000 });

const PROJECT_ID: string = "5b1f0a0e-1111-4c1e-9a1e-000000000001";
const SCHEDULE_ID: string = "3a000000-0000-4000-8000-0000000000a1";
const LAYER_ID: string = "3b000000-0000-4000-8000-0000000000b1";

let layers: Array<JSONObject> = [];

const navigateMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayersPreview",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return <div data-testid="layers-preview" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/ScheduleSubscribeCard",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return <div data-testid="schedule-subscribe-card" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/UserGroups/ScheduleUserGroupsCard",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return <div data-testid="schedule-user-groups-card" />;
      },
    };
  },
);

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (data: {
        modelType: { new (): unknown };
      }): Promise<unknown> => {
        return Object.assign(
          new data.modelType() as Record<string, unknown>,
          {
            _id: SCHEDULE_ID,
            name: "Platform primary",
            description: "Weekly rotation of the platform team.",
            timezone: "Europe/London",
          },
        );
      },
      getList: async (data: {
        modelType: { new (): unknown };
      }): Promise<unknown> => {
        const tableName: string = String(
          (new data.modelType() as Record<string, unknown>)["tableName"],
        );
        const rows: Array<JSONObject> =
          tableName === "OnCallDutyPolicyScheduleLayer" ? layers : [];

        return { data: rows, count: rows.length, skip: 0, limit: 10 };
      },
      count: async (): Promise<number> => {
        return 0;
      },
      getCommonHeaders: (): JSONObject => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return [Permission.ProjectOwner, Permission.User, Permission.Public];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return {
          globalPermissions: [
            Permission.ProjectOwner,
            Permission.User,
            Permission.Public,
          ],
        };
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

import ScheduleOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/OnCallDutySchedule/Index";
import {
  SCHEDULE_EDIT_BUTTON_TEXT,
  SCHEDULE_NO_LAYERS_TEST_ID,
  ScheduleNoLayersCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/ScheduleOverviewCopy";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import { getJestSpyOn } from "../../Spy";

beforeEach(() => {
  layers = [];
  navigateMock.mockReset();
  getJestSpyOn(Navigation, "navigate").mockImplementation(
    (...args: Array<unknown>): void => {
      navigateMock(...args);
    },
  );
  window.history.pushState(
    {},
    "",
    `/dashboard/${PROJECT_ID}/on-call-duty/schedules/${SCHEDULE_ID}`,
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    for (let i: number = 0; i < 5; i++) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    }
  });
}

async function renderOverview(): Promise<void> {
  const props: PageComponentProps = {
    pageRoute: new Route("/dashboard/:projectId/on-call-duty/schedules/:id"),
  } as unknown as PageComponentProps;

  render(
    <MemoryRouter>
      <ScheduleOverview {...props} />
    </MemoryRouter>,
  );
  await settle();
}

function aLayer(): JSONObject {
  return {
    _id: LAYER_ID,
    name: "Layer 1",
    order: 1,
    onCallDutyPolicyScheduleId: SCHEDULE_ID,
  };
}

describe("a schedule nobody takes turns on yet", () => {
  test("shows one step: Go to Layers, which opens its Layers page", async () => {
    await renderOverview();

    const empty: HTMLElement = await screen.findByTestId(
      SCHEDULE_NO_LAYERS_TEST_ID,
    );

    expect(empty).toHaveTextContent(ScheduleNoLayersCopy.title);
    expect(empty).toHaveTextContent(ScheduleNoLayersCopy.description);

    const go: HTMLElement = within(empty).getByRole("button", {
      name: ScheduleNoLayersCopy.button,
    });

    await act(async () => {
      fireEvent.click(go);
    });

    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(String(navigateMock.mock.calls[0]![0])).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_LAYERS] as Route,
        { modelId: new ObjectID(SCHEDULE_ID) },
      ).toString(),
    );
  });

  test("offers no calendar links or chat groups for shifts nobody has", async () => {
    await renderOverview();
    await screen.findByTestId(SCHEDULE_NO_LAYERS_TEST_ID);

    expect(
      screen.queryByTestId("schedule-subscribe-card"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("schedule-user-groups-card"),
    ).not.toBeInTheDocument();
  });

  test("is not a red alarm about the roster, and never sends you 'below' to layers that are elsewhere", async () => {
    await renderOverview();
    await screen.findByTestId(SCHEDULE_NO_LAYERS_TEST_ID);

    expect(document.body).not.toHaveTextContent("roster");
    expect(document.body).not.toHaveTextContent("Check the layers below");
    expect(document.body).not.toHaveTextContent("Please go to layers tab");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("a schedule with layers", () => {
  test("says who is on call in its Final Schedule, then offers the calendar links", async () => {
    layers = [aLayer()];

    await renderOverview();

    expect(await screen.findByTestId("layers-preview")).toBeInTheDocument();
    expect(screen.getByText("Final Schedule")).toBeInTheDocument();
    expect(
      screen.queryByTestId(SCHEDULE_NO_LAYERS_TEST_ID),
    ).not.toBeInTheDocument();

    const preview: HTMLElement = screen.getByTestId("layers-preview");
    const subscribe: HTMLElement = screen.getByTestId(
      "schedule-subscribe-card",
    );

    expect(screen.getByTestId("schedule-user-groups-card")).toBeInTheDocument();
    // The calendar card follows the Final Schedule: who is on call comes first.
    expect(
      preview.compareDocumentPosition(subscribe) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("has no roster banner saying it a second time", async () => {
    layers = [aLayer()];

    await renderOverview();
    await screen.findByTestId("layers-preview");

    expect(document.body).not.toHaveTextContent("roster");
  });
});

describe("the details card", () => {
  test("is edited as an On-Call Schedule, as every menu names it", async () => {
    await renderOverview();

    expect(SCHEDULE_EDIT_BUTTON_TEXT).toBe("Edit On-Call Schedule");

    const edit: HTMLElement = await screen.findByRole("button", {
      name: SCHEDULE_EDIT_BUTTON_TEXT,
    });

    expect(document.body).not.toHaveTextContent("On-Call Policy Schedule");

    await act(async () => {
      fireEvent.click(edit);
    });
    await settle();

    const dialog: HTMLElement = await screen.findByTestId("modal");

    expect(within(dialog).getByTestId("modal-title")).toHaveTextContent(
      SCHEDULE_EDIT_BUTTON_TEXT,
    );
    // The Name field says no more than its title: no "Any friendly name of this object".
    expect(dialog).not.toHaveTextContent("Any friendly name");
    expect(dialog).not.toHaveTextContent("Friendly description");
  });
});
