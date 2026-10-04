import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * CREATE ON-CALL SCHEDULE: A NEW SCHEDULE PUTS SOMEONE ON CALL FROM THE
 * START - on the real On-Call Schedules page, with only the network stubbed.
 *
 * The form used to ask for a name, a timezone and a description, and the
 * schedule it made covered nobody until a layer had been added on its Layers
 * page and people added to it one at a time. Now:
 *
 *   - it asks Name and "Who takes turns?" (the people picker, people only),
 *     optional, with how long each turn lasts, the timezone, the description
 *     and the labels folded under Advanced - three rows, no steps;
 *   - the people go with the create request as misc data, in the order they
 *     were picked, with how long each turn lasts, and the server makes them
 *     the schedule's first layer;
 *   - nobody picked sends nothing of the kind;
 *   - a user who may not add layers is not asked;
 *   - the new schedule opens on its Layers page.
 */

let permissionsForTest: Array<string> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: [...permissionsForTest] };
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
const createOrUpdateMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * consts, so they are dereferenced at call time.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return {};
      },
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getItem: async (): Promise<null> => {
        return null;
      },
      count: async (): Promise<number> => {
        return 0;
      },
      deleteItem: async (): Promise<void> => {
        return undefined;
      },
      updateById: async (): Promise<void> => {
        return undefined;
      },
      createOrUpdate: (...args: Array<any>) => {
        return createOrUpdateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): { toString: () => string } => {
        return {
          toString: (): string => {
            return "0e200000-0000-4000-8000-000000000001";
          },
        };
      },
      getCurrentProject: (): null => {
        return null;
      },
      getCurrentPlan: (): null => {
        return null;
      },
    },
  };
});

import OnCallDutySchedulesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/OnCallDutySchedules";
import { LABELS_FORM_FIELD_DESCRIPTION } from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/LabelsFormField";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";
import OneUptimeDate from "../../../Types/Date";
import Email from "../../../Types/Email";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import { readScheduleFirstLayer } from "../../../Types/OnCallDutyPolicy/ScheduleFirstLayer";
import Permission from "../../../Types/Permission";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import TimezoneUtil from "../../../UI/Utils/Timezone";
import { getJestSpyOn } from "../../Spy";
import {
  getByTextOutsideFoldedHeaders,
  hasSetChip,
  listedNames,
  setChips,
} from "../../UI/Components/FoldedSection/FoldedSectionQueries";

jest.setTimeout(30000);

const PROJECT_ID: string = "0e200000-0000-4000-8000-000000000001";
const NEW_SCHEDULE_ID: string = "0e200000-0000-4000-8000-000000000002";

const USER_ALEX: string = "0e200000-0000-4000-8000-0000000000c1";
const USER_SAM: string = "0e200000-0000-4000-8000-0000000000c2";

const FIELD_TITLE: string = "Who takes turns?";
const FIELD_DESCRIPTION: string =
  "On call one at a time, in the order you add them, starting now.";
const TURN_LENGTH_TITLE: string = "Each turn lasts";
const DEFAULT_SUMMARY: string =
  "Each person is on call for a week, then the next one takes over.";

const pageProps: PageComponentProps = {
  pageRoute: RouteMap[PageMap.ON_CALL_DUTY_SCHEDULES] as Route,
  hasPaymentMethod: true,
  currentProject: null,
} as unknown as PageComponentProps;

let navigateCalls: Array<string> = [];

function list(data: Array<unknown>): JSONObject {
  return { data, count: data.length, skip: 0, limit: 50 } as JSONObject;
}

// The ids an Includes query asks for, or every id when it asks for none.
function wanted(value: unknown, id: string): boolean {
  if (!(value instanceof Includes)) {
    return true;
  }

  return (value.values as Array<unknown>).some(
    (candidate: unknown): boolean => {
      return String(candidate) === id;
    },
  );
}

function member(id: string, name: string, email: string): TeamMember {
  const user: User = new User();
  user._id = id;
  user.name = new Name(name);
  user.email = new Email(email);

  const teamMember: TeamMember = new TeamMember();
  teamMember.user = user;
  return teamMember;
}

beforeEach(() => {
  permissionsForTest = [Permission.ProjectAdmin];
  navigateCalls = [];
  PermissionGate.clearPermissionPropsCache();
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
  window.history.replaceState(
    window.history.state,
    "",
    `/dashboard/${PROJECT_ID}/on-call-duty/schedules`,
  );

  getJestSpyOn(Navigation, "navigate").mockImplementation(
    (route: unknown): void => {
      navigateCalls.push(String(route));
    },
  );

  getListMock.mockImplementation(async (params: any): Promise<any> => {
    const query: Record<string, unknown> = params.query || {};

    // The people picker's search list, and its look-ups by id.
    if (params.modelType === TeamMember) {
      if (query["teamId"]) {
        return list([]);
      }

      return list(
        [
          member(USER_ALEX, "Alex Chen", "alex@example.com"),
          member(USER_SAM, "Sam Rivera", "sam@example.com"),
        ].filter((candidate: TeamMember): boolean => {
          return wanted(query["userId"], candidate.user!._id!.toString());
        }),
      );
    }

    // An empty project otherwise: no schedules, no labels.
    return list([]);
  });

  // The server answers a create with the new schedule.
  createOrUpdateMock.mockImplementation(async (data: any): Promise<any> => {
    return {
      data: {
        _id: NEW_SCHEDULE_ID,
        name: data.model.name,
      },
    };
  });
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  createOrUpdateMock.mockReset();
  jest.restoreAllMocks();
});

async function openCreateForm(): Promise<HTMLElement> {
  render(<OnCallDutySchedulesPage {...pageProps} />);

  await screen.findByText(
    "No on-call schedules yet",
    { exact: false },
    { timeout: 10000 },
  );

  const createButton: HTMLElement = await waitFor((): HTMLElement => {
    const button: HTMLElement | undefined = screen
      .getAllByTestId("card-button")
      .find((candidate: HTMLElement): boolean => {
        return (candidate.textContent || "").includes(
          "Create On-Call Schedule",
        );
      });

    if (!button) {
      throw new Error("No Create On-Call Schedule button yet");
    }

    return button;
  });

  fireEvent.click(createButton);

  const modal: HTMLElement = await screen.findByTestId("modal");

  await within(modal).findByPlaceholderText("Schedule Name");

  /*
   * BasicForm fills in the fields' defaults in an effect of its own, once
   * its field list has arrived, and never over a value the user typed: a
   * test that types at once would race it. Wait until the timezone shows
   * the user's own - the defaults are in.
   */
  await within(modal).findByText(currentTimezoneLabel());

  return modal;
}

// What the timezone dropdown shows for the user's own timezone.
function currentTimezoneLabel(): string {
  const timezone: string = OneUptimeDate.getCurrentTimezone().toString();

  const option: DropdownOption | undefined =
    TimezoneUtil.getTimezoneDropdownOptions().find(
      (candidate: DropdownOption): boolean => {
        return candidate.value === timezone;
      },
    );

  if (!option) {
    throw new Error(`No timezone option for ${timezone}`);
  }

  return option.label;
}

function typeName(modal: HTMLElement, name: string): void {
  fireEvent.change(within(modal).getByPlaceholderText("Schedule Name"), {
    target: { value: name },
  });
}

async function pick(name: string): Promise<void> {
  const button: HTMLElement = await screen.findByRole("button", {
    name: "Add user",
  });

  if (button.getAttribute("aria-expanded") !== "true") {
    fireEvent.click(button);
  }

  const popup: HTMLElement = await screen.findByRole("dialog", {
    name: "Add user",
  });

  const option: HTMLElement = await waitFor((): HTMLElement => {
    const found: HTMLElement | undefined = within(popup)
      .getAllByRole("option")
      .find((candidate: HTMLElement): boolean => {
        return candidate.textContent?.includes(name) || false;
      });

    if (!found) {
      throw new Error(`No option ${name} yet`);
    }

    return found;
  });

  fireEvent.click(option);
}

async function submit(modal: HTMLElement): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(
      within(modal).getByRole("button", { name: "Create On-Call Schedule" }),
    );
  });
}

function advancedHeader(modal: HTMLElement): HTMLElement {
  return within(modal).getByRole("button", { name: "More fields" });
}

function chipIds(): Array<string | null> {
  return screen
    .queryAllByTestId("people-chip")
    .map((chip: HTMLElement): string | null => {
      return chip.getAttribute("data-id");
    });
}

function layersRoute(scheduleId: string): string {
  return (RouteMap[PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_LAYERS] as Route)
    .toString()
    .replace(":projectId", PROJECT_ID)
    .replace(":id", scheduleId);
}

function sentRequest(): any {
  return createOrUpdateMock.mock.calls[0]![0];
}

function describeRotation(rotation: Recurring): string {
  return `${rotation.intervalCount.toNumber()} ${rotation.intervalType}`;
}

// react-select opens on a click; its options are portalled to the body.
async function pickOption(
  user: UserEvent,
  combobox: HTMLElement,
  optionText: string,
): Promise<void> {
  await user.click(combobox);
  const options: Array<HTMLElement> = await screen.findAllByText(optionText, {
    exact: true,
  });
  await user.click(options[options.length - 1]!);
}

describe("the Create On-Call Schedule form", () => {
  test("asks for a name and who takes turns, in one step", async () => {
    const modal: HTMLElement = await openCreateForm();

    expect(within(modal).getByText("Name")).toBeInTheDocument();
    expect(within(modal).getByText(FIELD_TITLE)).toBeInTheDocument();
    expect(within(modal).getByText(FIELD_DESCRIPTION)).toBeInTheDocument();

    // Optional: the schedule can still be made without anyone in it.
    expect(
      within(modal).getByText(FIELD_TITLE).closest("label")?.textContent,
    ).toContain("(Optional)");

    expect(
      within(modal).getByRole("button", { name: "Add user" }),
    ).toBeInTheDocument();

    // No wizard.
    expect(
      within(modal).queryByRole("navigation", { name: "Progress" }),
    ).toBeNull();
    expect(within(modal).queryByRole("button", { name: "Next" })).toBeNull();
    expect(
      within(modal).getByRole("button", { name: "Create On-Call Schedule" }),
    ).toBeEnabled();
  });

  test("folds the timezone, the description and the labels under Advanced", async () => {
    const modal: HTMLElement = await openCreateForm();

    expect(advancedHeader(modal)).toHaveAttribute("aria-expanded", "false");
    expect(setChips(advancedHeader(modal))).toEqual([]);
    // Nothing to sum up with nobody picked.
    expect(within(modal).queryByText(DEFAULT_SUMMARY)).toBeNull();

    // Folded, the header names them; the fields themselves are hidden.
    expect(listedNames(advancedHeader(modal))).toEqual([
      "Timezone",
      "Description",
      "Labels",
    ]);
    expect(getByTextOutsideFoldedHeaders(modal, "Timezone")).not.toBeVisible();
    expect(within(modal).getByPlaceholderText("Description")).not.toBeVisible();
    expect(
      within(modal).getByText(LABELS_FORM_FIELD_DESCRIPTION),
    ).not.toBeVisible();

    // With nobody to take turns, how long a turn lasts is not asked.
    expect(within(modal).queryByText(TURN_LENGTH_TITLE)).toBeNull();

    fireEvent.click(advancedHeader(modal));

    expect(advancedHeader(modal)).toHaveAttribute("aria-expanded", "true");
    expect(within(modal).getByText("Timezone")).toBeVisible();
    expect(within(modal).getByPlaceholderText("Description")).toBeVisible();
    expect(
      within(modal).getByText(LABELS_FORM_FIELD_DESCRIPTION),
    ).toBeVisible();
    expect(within(modal).queryByText(TURN_LENGTH_TITLE)).toBeNull();
  });

  test("the picker offers the project's people, in the order they are picked", async () => {
    await openCreateForm();

    await pick("Sam Rivera");
    await pick("Alex Chen");

    await waitFor(() => {
      expect(chipIds()).toEqual([USER_SAM, USER_ALEX]);
    });
  });

  test("once somebody takes turns, Advanced says each turn lasts a week, and asks it", async () => {
    const modal: HTMLElement = await openCreateForm();

    await pick("Alex Chen");

    // Folded, the section says what the default will do.
    expect(await within(modal).findByText(DEFAULT_SUMMARY)).toBeVisible();
    expect(setChips(advancedHeader(modal))).toEqual([]);

    fireEvent.click(advancedHeader(modal));

    expect(await within(modal).findByText(TURN_LENGTH_TITLE)).toBeVisible();
    expect(
      within(modal).getByText("Then the next person takes over."),
    ).toBeVisible();
    expect(
      within(modal).getByRole("combobox", { name: TURN_LENGTH_TITLE }),
    ).toBeInTheDocument();
    expect(within(modal).getByText("1 week")).toBeVisible();
  });
});

describe("creating the schedule", () => {
  test("sends the people in pick order, and a week's turns, as misc data", async () => {
    const modal: HTMLElement = await openCreateForm();

    typeName(modal, "Payments primary");
    await pick("Sam Rivera");
    await pick("Alex Chen");

    await submit(modal);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const request: any = sentRequest();

    expect(request.formType).toBe(FormType.Create);
    expect(request.modelType).toBe(OnCallDutyPolicySchedule);
    expect(Object.keys(request.miscDataProps).sort()).toEqual([
      "firstLayerRotation",
      "firstLayerUsers",
    ]);
    expect(request.miscDataProps.firstLayerUsers).toEqual([
      USER_SAM,
      USER_ALEX,
    ]);

    // Exactly what the server reads, as the request carries it.
    const sent: JSONObject = JSON.parse(JSON.stringify(request.miscDataProps));
    const firstLayer: ReturnType<typeof readScheduleFirstLayer> =
      readScheduleFirstLayer(sent);

    expect(firstLayer!.userIds).toEqual([USER_SAM, USER_ALEX]);
    expect(describeRotation(firstLayer!.rotation)).toBe(
      `1 ${EventInterval.Week}`,
    );

    const model: OnCallDutyPolicySchedule = request.model;

    expect(model.name).toBe("Payments primary");
    // The picker's own key, the people and the turn length are not columns.
    for (const key of [
      "whoTakesTurns",
      "firstLayerUsers",
      "turnLength",
      "firstLayerRotation",
    ]) {
      expect(
        (model as unknown as Record<string, unknown>)[key],
      ).toBeUndefined();
    }
    expect(request.miscDataProps).not.toHaveProperty("whoTakesTurns");
    expect(request.miscDataProps).not.toHaveProperty("turnLength");
  });

  test("sends the turn length picked under Advanced", async () => {
    const modal: HTMLElement = await openCreateForm();
    const user: UserEvent = userEvent.setup({ delay: null });

    typeName(modal, "Payments primary");
    await pick("Alex Chen");

    await user.click(advancedHeader(modal));
    await pickOption(
      user,
      await within(modal).findByRole("combobox", { name: TURN_LENGTH_TITLE }),
      "2 weeks",
    );

    // No longer the default: the header says so.
    await user.click(advancedHeader(modal));
    expect(hasSetChip(advancedHeader(modal))).toBe(true);
    expect(within(modal).queryByText(DEFAULT_SUMMARY)).toBeNull();

    await submit(modal);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    expect(
      describeRotation(
        readScheduleFirstLayer(
          JSON.parse(JSON.stringify(sentRequest().miscDataProps)),
        )!.rotation,
      ),
    ).toBe(`2 ${EventInterval.Week}`);
  });

  test("with nobody picked, sends nothing of the kind and creates the schedule as before", async () => {
    const modal: HTMLElement = await openCreateForm();

    typeName(modal, "Payments primary");

    await submit(modal);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const request: any = sentRequest();

    expect(request.miscDataProps).toEqual({});
    expect(request.model.name).toBe("Payments primary");
    // The timezone is still saved with the schedule, the user's own.
    expect(JSON.parse(JSON.stringify(request.model))["timezone"]).toBe(
      OneUptimeDate.getCurrentTimezone().toString(),
    );
  });

  test("a pick taken back is sent as nobody", async () => {
    const modal: HTMLElement = await openCreateForm();

    typeName(modal, "Payments primary");
    await pick("Alex Chen");

    await waitFor(() => {
      expect(chipIds()).toEqual([USER_ALEX]);
    });

    fireEvent.click(
      within(screen.getAllByTestId("people-chip")[0]!).getByRole("button"),
    );

    await waitFor(() => {
      expect(chipIds()).toEqual([]);
    });

    await submit(modal);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const miscDataProps: JSONObject = sentRequest().miscDataProps;

    expect(
      (miscDataProps["firstLayerUsers"] as Array<string> | undefined) || [],
    ).toEqual([]);
    expect(miscDataProps).not.toHaveProperty("firstLayerRotation");
    expect(readScheduleFirstLayer(miscDataProps)).toBeNull();
  });

  test("the description typed under Advanced is saved with the schedule", async () => {
    const modal: HTMLElement = await openCreateForm();

    typeName(modal, "Payments primary");
    fireEvent.click(advancedHeader(modal));
    fireEvent.change(within(modal).getByPlaceholderText("Description"), {
      target: { value: "Weekly rotation of the payments team." },
    });

    await submit(modal);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    expect(sentRequest().model.description).toBe(
      "Weekly rotation of the payments team.",
    );
  });

  test("opens the new schedule on its Layers page", async () => {
    const modal: HTMLElement = await openCreateForm();

    typeName(modal, "Payments primary");
    await pick("Alex Chen");

    await submit(modal);

    await waitFor(() => {
      expect(navigateCalls).toEqual([layersRoute(NEW_SCHEDULE_ID)]);
    });

    expect(navigateCalls[0]).toBe(
      `/dashboard/${PROJECT_ID}/on-call-duty/schedules/${NEW_SCHEDULE_ID}/layers`,
    );
  });

  test("opens it there with nobody picked too: building the rotation is the next step", async () => {
    const modal: HTMLElement = await openCreateForm();

    typeName(modal, "Payments primary");

    await submit(modal);

    await waitFor(() => {
      expect(navigateCalls).toEqual([layersRoute(NEW_SCHEDULE_ID)]);
    });
  });

  test("a create that fails stays on the form and goes nowhere", async () => {
    createOrUpdateMock.mockImplementation(async (): Promise<never> => {
      throw new Error(
        "Some of the people picked to take turns are not members of this project.",
      );
    });

    const modal: HTMLElement = await openCreateForm();

    typeName(modal, "Payments primary");
    await pick("Alex Chen");

    await submit(modal);

    expect(
      await within(modal).findByText(
        "Some of the people picked to take turns are not members of this project.",
      ),
    ).toBeInTheDocument();
    expect(navigateCalls).toEqual([]);
  });
});

describe("a user who may create schedules but not layers", () => {
  test("is not asked who takes turns", async () => {
    permissionsForTest = [
      Permission.CreateProjectOnCallDutyPolicySchedule,
      Permission.ReadProjectOnCallDutyPolicySchedule,
    ];

    const modal: HTMLElement = await openCreateForm();

    expect(within(modal).queryByText(FIELD_TITLE)).toBeNull();
    expect(
      within(modal).queryByRole("button", { name: "Add user" }),
    ).toBeNull();

    // The rest of the form is as for everyone.
    expect(within(modal).getByText("Name")).toBeInTheDocument();
    expect(advancedHeader(modal)).toBeInTheDocument();

    typeName(modal, "Payments primary");
    await submit(modal);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    expect(sentRequest().miscDataProps).toEqual({});
  });
});
