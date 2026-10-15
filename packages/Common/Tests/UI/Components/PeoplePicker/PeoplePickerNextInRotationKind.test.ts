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
 * "NEXT IN ROTATION" AS A KIND OF PICK.
 *
 * An escalation rule's Notify picker offers each on-call schedule twice: as
 * itself (whoever is on call) and as its "Next in rotation" - the person
 * after whoever is on call, the backup from the same rotation. The second is
 * a kind of its own, so the picker keeps the two picks apart (one schedule
 * can be picked both ways), heads it "Next in rotation", tags each row and
 * chip with it, and draws it with a fast-forward mark rather than a
 * calendar. It lists the same schedules, read the same way - including on a
 * plan without on-call schedules, where it offers none.
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
import IconProp from "../../../../Types/Icon/IconProp";
import ObjectID from "../../../../Types/ObjectID";
import {
  getPeoplePickerKindDefinition,
  getPeoplePickerOptionsFromModels,
  NEXT_IN_ROTATION_GROUP_TITLE,
  NEXT_IN_ROTATION_TAG,
  PEOPLE_PICKER_KIND_DEFINITIONS,
  PEOPLE_PICKER_SEARCH_LIMIT,
  PeoplePickerKindDefinition,
} from "../../../../UI/Components/PeoplePicker/PeoplePickerKinds";
import {
  addToPeoplePickerValue,
  getPeoplePickerOptionKey,
  PeoplePickerKind,
  PeoplePickerOption,
  PeoplePickerValue,
  toPeoplePickerFormValues,
} from "../../../../UI/Components/PeoplePicker/PeoplePickerTypes";
import { RECORD_LIST_COPY } from "../../../../UI/Components/Workflow/RecordList/RecordListField";
import * as UIConfig from "../../../../UI/Config";
import ProjectUtil from "../../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PRIMARY: string = "0000000c-0000-4000-8000-000000000001";
const NIGHTS: string = "0000000c-0000-4000-8000-000000000002";

const PLAN_ENV: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC:
    "Free,price_1M4niQANuQdJ93r7AVjhnik5,price_1M4niQANuQdJ93r7l1Wz1dkm,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH:
    "Growth,price_1M4nhZANuQdJ93r7yfQ1MePQ,price_1M4r3OANuQdJ93r7g8NyoCBq,22,20,2,14",
  SUBSCRIPTION_PLAN_SCALE:
    "Scale,price_1MKidGANuQdJ93r7FoaZ1dOb,price_1MKidRANuQdJ93r7LVOc0BUy,99,84,3,14",
};

const NEXT: PeoplePickerKindDefinition = getPeoplePickerKindDefinition(
  PeoplePickerKind.OnCallScheduleNextInRotation,
);
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
  config["BILLING_ENABLED"] = false;
});

afterEach(() => {
  config["BILLING_ENABLED"] = originalBillingEnabled;
  jest.restoreAllMocks();
});

describe("the next-in-rotation kind", () => {
  test("is a kind of its own, defined once", () => {
    expect(PeoplePickerKind.OnCallScheduleNextInRotation).toBe(
      "onCallScheduleNextInRotation",
    );
    expect(
      PEOPLE_PICKER_KIND_DEFINITIONS[
        PeoplePickerKind.OnCallScheduleNextInRotation
      ],
    ).toBe(NEXT);
    expect(NEXT.kind).toBe(PeoplePickerKind.OnCallScheduleNextInRotation);
  });

  test("is listed under Next in rotation, tagged Next in rotation", () => {
    expect(NEXT.groupTitle).toBe("Next in rotation");
    expect(NEXT_IN_ROTATION_GROUP_TITLE).toBe("Next in rotation");
    expect(NEXT.tag).toBe("Next in rotation");
    expect(NEXT_IN_ROTATION_TAG).toBe("Next in rotation");
    // A schedule no longer found is named as one.
    expect(NEXT.unknownName).toBe("Unknown schedule");
  });

  test("is drawn with a fast-forward mark - never as the schedule's calendar, a person or a group", () => {
    expect(NEXT.avatar).toEqual({ type: "icon", icon: IconProp.Forward });
    expect(NEXT.avatar).not.toEqual(SCHEDULES.avatar);
  });

  test("reads a schedule's id and name off a related row, as this kind", () => {
    expect(NEXT.relationSelect).toEqual({ _id: true, name: true });
    expect(NEXT.fromModel(makeSchedule(PRIMARY, "Primary"))).toEqual({
      kind: PeoplePickerKind.OnCallScheduleNextInRotation,
      id: PRIMARY,
      name: "Primary",
    });
    expect(NEXT.fromModel(makeSchedule(PRIMARY))?.name).toBe(
      "Unknown schedule",
    );
    expect(NEXT.fromModel(new OnCallDutyPolicySchedule())).toBeNull();
  });

  test("the schedule kind still reads its rows as itself", () => {
    expect(SCHEDULES.fromModel(makeSchedule(PRIMARY, "Primary"))?.kind).toBe(
      PeoplePickerKind.OnCallSchedule,
    );
  });

  test("one schedule picked both ways is two picks, kept in two form values", () => {
    let value: PeoplePickerValue = {};
    value = addToPeoplePickerValue(
      value,
      PeoplePickerKind.OnCallSchedule,
      PRIMARY,
    );
    value = addToPeoplePickerValue(
      value,
      PeoplePickerKind.OnCallScheduleNextInRotation,
      PRIMARY,
    );

    expect(
      getPeoplePickerOptionKey(PeoplePickerKind.OnCallSchedule, PRIMARY),
    ).not.toBe(
      getPeoplePickerOptionKey(
        PeoplePickerKind.OnCallScheduleNextInRotation,
        PRIMARY,
      ),
    );

    expect(
      toPeoplePickerFormValues(
        {
          kinds: [
            {
              kind: PeoplePickerKind.OnCallSchedule,
              valueKey: "onCallSchedules",
            },
            {
              kind: PeoplePickerKind.OnCallScheduleNextInRotation,
              valueKey: "nextInRotationSchedules",
            },
          ],
        },
        value,
      ),
    ).toEqual({
      onCallSchedules: [PRIMARY],
      nextInRotationSchedules: [PRIMARY],
    });
  });

  test("related rows become options of this kind, after the schedules", () => {
    const options: Array<PeoplePickerOption> = getPeoplePickerOptionsFromModels(
      [
        {
          kind: PeoplePickerKind.OnCallSchedule,
          models: [makeSchedule(PRIMARY, "Primary")],
        },
        {
          kind: PeoplePickerKind.OnCallScheduleNextInRotation,
          models: [makeSchedule(PRIMARY, "Primary")],
        },
      ],
    );

    expect(
      options.map((option: PeoplePickerOption): string => {
        return `${option.kind}:${option.name}`;
      }),
    ).toEqual(["onCallSchedule:Primary", "onCallScheduleNextInRotation:Primary"]);
  });

  test("as a workflow's list of records it has words of its own", () => {
    expect(
      RECORD_LIST_COPY[PeoplePickerKind.OnCallScheduleNextInRotation],
    ).toEqual({
      addButtonText: "Add next in rotation",
      searchPlaceholder: "Search on-call schedules by name",
      emptyText:
        "This project has no on-call schedules yet. Create one under On-Call Duty.",
    });
  });
});

describe("searching the next person in each rotation", () => {
  test("lists the project's schedules by name, as this kind", async () => {
    getListMock.mockResolvedValue(
      listResult([
        makeSchedule(PRIMARY, "Primary"),
        makeSchedule(NIGHTS, "Nights"),
      ]) as never,
    );

    const options: Array<PeoplePickerOption> = await NEXT.search({
      projectId: PROJECT_ID,
      searchText: "",
      limit: PEOPLE_PICKER_SEARCH_LIMIT,
    });

    expect(options).toEqual([
      {
        kind: PeoplePickerKind.OnCallScheduleNextInRotation,
        id: PRIMARY,
        name: "Primary",
      },
      {
        kind: PeoplePickerKind.OnCallScheduleNextInRotation,
        id: NIGHTS,
        name: "Nights",
      },
    ]);

    const request: any = getListMock.mock.calls[0]![0];

    expect(request.modelType).toBe(OnCallDutyPolicySchedule);
    expect(request.query).toEqual({ projectId: PROJECT_ID });
    expect(request.select).toEqual({ _id: true, name: true });
    expect(request.sort).toEqual({ name: SortOrder.Ascending });
    expect(request.limit).toBe(PEOPLE_PICKER_SEARCH_LIMIT);
  });

  test("matches what is typed against the schedule's name", async () => {
    getListMock.mockResolvedValue(listResult([]) as never);

    await NEXT.search({
      projectId: PROJECT_ID,
      searchText: "  prim ",
      limit: PEOPLE_PICKER_SEARCH_LIMIT,
    });

    const request: any = getListMock.mock.calls[0]![0];

    expect(request.query.name).toBeInstanceOf(Search);
    expect((request.query.name as Search<string>).toString()).toBe("prim");
  });

  test("looks picks up by id, in one request, as this kind", async () => {
    getListMock.mockResolvedValue(
      listResult([makeSchedule(PRIMARY, "Primary")]) as never,
    );

    const options: Array<PeoplePickerOption> = await NEXT.getByIds({
      projectId: PROJECT_ID,
      ids: [PRIMARY, NIGHTS],
    });

    expect(options).toEqual([
      {
        kind: PeoplePickerKind.OnCallScheduleNextInRotation,
        id: PRIMARY,
        name: "Primary",
      },
    ]);
    expect(getListMock).toHaveBeenCalledTimes(1);

    const request: any = getListMock.mock.calls[0]![0];

    expect(request.query._id).toBeInstanceOf(Includes);
    expect((request.query._id as Includes).values).toEqual([PRIMARY, NIGHTS]);
    expect(request.limit).toBe(LIMIT_PER_PROJECT);
  });

  test("no ids, no request", async () => {
    await expect(
      NEXT.getByIds({ projectId: PROJECT_ID, ids: [] }),
    ).resolves.toEqual([]);
    expect(getListMock).not.toHaveBeenCalled();
  });
});

describe("on a plan without on-call schedules", () => {
  test("a Free plan is offered none, and nothing is asked of the server", async () => {
    config["BILLING_ENABLED"] = true;
    jest.spyOn(ProjectUtil, "getCurrentPlan").mockReturnValue(PlanType.Free);

    await expect(
      NEXT.search({
        projectId: PROJECT_ID,
        searchText: "",
        limit: PEOPLE_PICKER_SEARCH_LIMIT,
      }),
    ).resolves.toEqual([]);
    await expect(
      NEXT.getByIds({ projectId: PROJECT_ID, ids: [PRIMARY] }),
    ).resolves.toEqual([]);
    expect(getListMock).not.toHaveBeenCalled();
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
      NEXT.search({
        projectId: PROJECT_ID,
        searchText: "",
        limit: PEOPLE_PICKER_SEARCH_LIMIT,
      }),
    ).resolves.toEqual([]);
  });

  test("any other failure is reported, not hidden", async () => {
    getListMock.mockImplementation(async (): Promise<never> => {
      throw new Error("network down");
    });

    await expect(
      NEXT.getByIds({ projectId: PROJECT_ID, ids: [PRIMARY] }),
    ).rejects.toThrow("network down");
  });
});
