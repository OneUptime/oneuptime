import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * On-call schedules as a kind of pick: an escalation rule's Notify field
 * offers schedules, teams and people in one list. A schedule pick pages
 * whoever is on call in it, so it is drawn as a calendar, not a person, and
 * named "Schedule" beside its name.
 *
 * Schedules are a paid feature on OneUptime Cloud. A project whose plan
 * cannot read them must still get its people and teams: the schedule kind
 * answers "none" rather than failing the whole search list.
 */

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

import OnCallDutyPolicySchedule from "../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import Includes from "../../../../Types/BaseDatabase/Includes";
import Search from "../../../../Types/BaseDatabase/Search";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { PlanType } from "../../../../Types/Billing/SubscriptionPlan";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";
import IconProp from "../../../../Types/Icon/IconProp";
import ObjectID from "../../../../Types/ObjectID";
import {
  canReadOnCallSchedulesOnCurrentPlan,
  getPeoplePickerKindDefinition,
  getPeoplePickerOptionsFromModels,
  isPaymentRequiredError,
  PEOPLE_PICKER_KIND_DEFINITIONS,
  PEOPLE_PICKER_SEARCH_LIMIT,
  PeoplePickerKindDefinition,
} from "../../../../UI/Components/PeoplePicker/PeoplePickerKinds";
import {
  PeoplePickerKind,
  PeoplePickerOption,
} from "../../../../UI/Components/PeoplePicker/PeoplePickerTypes";
import * as UIConfig from "../../../../UI/Config";
import ProjectUtil from "../../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PRIMARY: string = "0000000c-0000-4000-8000-000000000001";
const NIGHTS: string = "0000000c-0000-4000-8000-000000000002";

// The plans test-setup.sh gives CI: Free < Growth < Scale < Enterprise.
const PLAN_ENV: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC:
    "Free,price_1M4niQANuQdJ93r7AVjhnik5,price_1M4niQANuQdJ93r7l1Wz1dkm,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH:
    "Growth,price_1M4nhZANuQdJ93r7yfQ1MePQ,price_1M4r3OANuQdJ93r7g8NyoCBq,22,20,2,14",
  SUBSCRIPTION_PLAN_SCALE:
    "Scale,price_1MKidGANuQdJ93r7FoaZ1dOb,price_1MKidRANuQdJ93r7LVOc0BUy,99,84,3,14",
};

const SCHEDULES: PeoplePickerKindDefinition = getPeoplePickerKindDefinition(
  PeoplePickerKind.OnCallSchedule,
);

function makeSchedule(id: string, name?: string): OnCallDutyPolicySchedule {
  const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
  schedule._id = id;

  if (name) {
    schedule.name = name;
  }

  return schedule;
}

function listResult(data: Array<unknown>): {
  data: Array<unknown>;
  count: number;
  skip: number;
  limit: number;
} {
  return { data, count: data.length, skip: 0, limit: data.length };
}

const config: Record<string, unknown> = UIConfig as unknown as Record<
  string,
  unknown
>;
const originalBillingEnabled: unknown = config["BILLING_ENABLED"];

function setBillingEnabled(enabled: boolean): void {
  config["BILLING_ENABLED"] = enabled;
}

beforeAll(() => {
  Object.assign(process.env, PLAN_ENV);
});

afterAll(() => {
  for (const key of Object.keys(PLAN_ENV)) {
    delete process.env[key];
  }
});

beforeEach(() => {
  getListMock.mockReset();
  setBillingEnabled(false);
});

afterEach(() => {
  config["BILLING_ENABLED"] = originalBillingEnabled;
  jest.restoreAllMocks();
});

describe("the on-call schedule kind", () => {
  test("is a kind of its own, defined once", () => {
    expect(PeoplePickerKind.OnCallSchedule).toBe("onCallSchedule");
    expect(
      PEOPLE_PICKER_KIND_DEFINITIONS[PeoplePickerKind.OnCallSchedule],
    ).toBe(SCHEDULES);
    expect(SCHEDULES.kind).toBe(PeoplePickerKind.OnCallSchedule);
  });

  test("is listed under On-call schedules and tagged Schedule", () => {
    expect(SCHEDULES.groupTitle).toBe("On-call schedules");
    expect(SCHEDULES.tag).toBe("Schedule");
    expect(SCHEDULES.unknownName).toBe("Unknown schedule");
  });

  test("is drawn as a calendar, never as a person or a group of people", () => {
    expect(SCHEDULES.avatar).toEqual({ type: "icon", icon: IconProp.Calendar });
  });

  test("reads a schedule's id and name off a related row", () => {
    expect(SCHEDULES.relationSelect).toEqual({ _id: true, name: true });
    expect(SCHEDULES.fromModel(makeSchedule(PRIMARY, "Primary"))).toEqual({
      kind: PeoplePickerKind.OnCallSchedule,
      id: PRIMARY,
      name: "Primary",
    });
  });

  test("a row without a name is still a pick, named as unknown", () => {
    expect(SCHEDULES.fromModel(makeSchedule(PRIMARY))?.name).toBe(
      "Unknown schedule",
    );
  });

  test("a row without an id is not a pick", () => {
    expect(SCHEDULES.fromModel(new OnCallDutyPolicySchedule())).toBeNull();
  });

  test("related rows of several kinds become options in the kinds' order", () => {
    const options: Array<PeoplePickerOption> = getPeoplePickerOptionsFromModels(
      [
        {
          kind: PeoplePickerKind.OnCallSchedule,
          models: [makeSchedule(PRIMARY, "Primary")],
        },
      ],
    );

    expect(
      options.map((option: PeoplePickerOption): string => {
        return `${option.kind}:${option.name}`;
      }),
    ).toEqual(["onCallSchedule:Primary"]);
  });
});

describe("searching on-call schedules", () => {
  test("lists the project's schedules by name", async () => {
    getListMock.mockResolvedValue(
      listResult([
        makeSchedule(PRIMARY, "Primary"),
        makeSchedule(NIGHTS, "Nights"),
      ]) as never,
    );

    const options: Array<PeoplePickerOption> = await SCHEDULES.search({
      projectId: PROJECT_ID,
      searchText: "",
      limit: PEOPLE_PICKER_SEARCH_LIMIT,
    });

    expect(
      options.map((option: PeoplePickerOption): string => {
        return option.name;
      }),
    ).toEqual(["Primary", "Nights"]);

    const request: any = getListMock.mock.calls[0]![0];

    expect(request.modelType).toBe(OnCallDutyPolicySchedule);
    expect(request.query).toEqual({ projectId: PROJECT_ID });
    expect(request.select).toEqual({ _id: true, name: true });
    expect(request.sort).toEqual({ name: SortOrder.Ascending });
    expect(request.limit).toBe(PEOPLE_PICKER_SEARCH_LIMIT);
  });

  test("matches what is typed against the name", async () => {
    getListMock.mockResolvedValue(listResult([]) as never);

    await SCHEDULES.search({
      projectId: PROJECT_ID,
      searchText: "  prim ",
      limit: PEOPLE_PICKER_SEARCH_LIMIT,
    });

    const request: any = getListMock.mock.calls[0]![0];

    expect(request.query.name).toBeInstanceOf(Search);
    expect((request.query.name as Search<string>).toString()).toBe("prim");
  });

  test("looks picks up by id, in one request", async () => {
    getListMock.mockResolvedValue(
      listResult([makeSchedule(PRIMARY, "Primary")]) as never,
    );

    const options: Array<PeoplePickerOption> = await SCHEDULES.getByIds({
      projectId: PROJECT_ID,
      ids: [PRIMARY, NIGHTS],
    });

    expect(options).toEqual([
      { kind: PeoplePickerKind.OnCallSchedule, id: PRIMARY, name: "Primary" },
    ]);
    expect(getListMock).toHaveBeenCalledTimes(1);

    const request: any = getListMock.mock.calls[0]![0];

    expect(request.query.projectId).toBe(PROJECT_ID);
    expect(request.query._id).toBeInstanceOf(Includes);
    expect((request.query._id as Includes).values).toEqual([PRIMARY, NIGHTS]);
    expect(request.limit).toBe(LIMIT_PER_PROJECT);
  });

  test("no ids, no request", async () => {
    await expect(
      SCHEDULES.getByIds({ projectId: PROJECT_ID, ids: [] }),
    ).resolves.toEqual([]);
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("a failure that is not about the plan is reported, not hidden", async () => {
    getListMock.mockImplementation(async (): Promise<never> => {
      throw new Error("network down");
    });

    await expect(
      SCHEDULES.search({
        projectId: PROJECT_ID,
        searchText: "",
        limit: PEOPLE_PICKER_SEARCH_LIMIT,
      }),
    ).rejects.toThrow("network down");
  });
});

describe("on a plan without on-call schedules", () => {
  test("a Free plan is offered none, and nothing is asked of the server", async () => {
    setBillingEnabled(true);
    jest.spyOn(ProjectUtil, "getCurrentPlan").mockReturnValue(PlanType.Free);

    expect(canReadOnCallSchedulesOnCurrentPlan()).toBe(false);

    await expect(
      SCHEDULES.search({
        projectId: PROJECT_ID,
        searchText: "",
        limit: PEOPLE_PICKER_SEARCH_LIMIT,
      }),
    ).resolves.toEqual([]);
    await expect(
      SCHEDULES.getByIds({ projectId: PROJECT_ID, ids: [PRIMARY] }),
    ).resolves.toEqual([]);
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("a Growth plan and above can read them", () => {
    setBillingEnabled(true);

    for (const plan of [PlanType.Growth, PlanType.Scale]) {
      jest.spyOn(ProjectUtil, "getCurrentPlan").mockReturnValue(plan);
      expect(canReadOnCallSchedulesOnCurrentPlan()).toBe(true);
    }
  });

  test("without billing (self-hosted) every project can", () => {
    setBillingEnabled(false);
    jest.spyOn(ProjectUtil, "getCurrentPlan").mockReturnValue(PlanType.Free);

    expect(canReadOnCallSchedulesOnCurrentPlan()).toBe(true);
  });

  test("a plan the dashboard cannot read hides nothing: the server decides", () => {
    setBillingEnabled(true);
    jest.spyOn(ProjectUtil, "getCurrentPlan").mockImplementation(() => {
      throw new Error("Plan ID is invalid");
    });

    expect(canReadOnCallSchedulesOnCurrentPlan()).toBe(true);
  });

  test("the server's refusal (402) reads as none, not as a broken list", async () => {
    getListMock.mockImplementation(async (): Promise<never> => {
      throw new HTTPErrorResponse(
        402,
        { message: "Please upgrade your plan." },
        {},
      );
    });

    await expect(
      SCHEDULES.search({
        projectId: PROJECT_ID,
        searchText: "",
        limit: PEOPLE_PICKER_SEARCH_LIMIT,
      }),
    ).resolves.toEqual([]);
  });

  test("a payment-required exception reads the same", async () => {
    getListMock.mockImplementation(async (): Promise<never> => {
      throw new PaymentRequiredException("Upgrade.");
    });

    await expect(
      SCHEDULES.getByIds({ projectId: PROJECT_ID, ids: [PRIMARY] }),
    ).resolves.toEqual([]);
  });
});

describe("telling a plan refusal from any other failure", () => {
  test("a 402 response or exception is one", () => {
    expect(isPaymentRequiredError(new HTTPErrorResponse(402, {}, {}))).toBe(
      true,
    );
    expect(isPaymentRequiredError(new PaymentRequiredException("x"))).toBe(
      true,
    );
  });

  test("anything else is not", () => {
    expect(isPaymentRequiredError(new HTTPErrorResponse(500, {}, {}))).toBe(
      false,
    );
    expect(isPaymentRequiredError(new Error("402"))).toBe(false);
    expect(isPaymentRequiredError(null)).toBe(false);
    expect(isPaymentRequiredError("402")).toBe(false);
  });
});
