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
 * On-call policies as a kind of pick: a workflow's Page an On-Call Policy
 * step picks the policies it starts the way every form picks people. A
 * policy is not a person - it is drawn as a phone and tagged "Policy" - and
 * a pick runs its escalation rules.
 *
 * One thing is its own. An archived policy pages no one, so the search
 * list does not offer it; one picked before it was archived is still named,
 * and says it is archived, so it can be seen and taken out.
 *
 * Every plan can read its on-call policies, so - unlike schedules - no plan
 * is asked about before they are listed. A refusal from the server for the
 * plan (402) still reads as none to pick, not as a list that fails.
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

import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
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
const CRITICAL: string = "0000000d-0000-4000-8000-000000000001";
const DATABASE: string = "0000000d-0000-4000-8000-000000000002";
const OLD_ROTA: string = "0000000d-0000-4000-8000-000000000003";

// The plans test-setup.sh gives CI: Free < Growth < Scale < Enterprise.
const PLAN_ENV: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC:
    "Free,price_1M4niQANuQdJ93r7AVjhnik5,price_1M4niQANuQdJ93r7l1Wz1dkm,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH:
    "Growth,price_1M4nhZANuQdJ93r7yfQ1MePQ,price_1M4r3OANuQdJ93r7g8NyoCBq,22,20,2,14",
  SUBSCRIPTION_PLAN_SCALE:
    "Scale,price_1MKidGANuQdJ93r7FoaZ1dOb,price_1MKidRANuQdJ93r7LVOc0BUy,99,84,3,14",
};

const POLICIES: PeoplePickerKindDefinition = getPeoplePickerKindDefinition(
  PeoplePickerKind.OnCallPolicy,
);

function makePolicy(
  id: string,
  name?: string,
  isArchived?: boolean,
): OnCallDutyPolicy {
  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
  policy._id = id;

  if (name) {
    policy.name = name;
  }

  if (isArchived !== undefined) {
    policy.isArchived = isArchived;
  }

  return policy;
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

describe("the on-call policy kind", () => {
  test("is a kind of its own, defined once", () => {
    expect(PeoplePickerKind.OnCallPolicy).toBe("onCallPolicy");
    expect(PEOPLE_PICKER_KIND_DEFINITIONS[PeoplePickerKind.OnCallPolicy]).toBe(
      POLICIES,
    );
    expect(POLICIES.kind).toBe(PeoplePickerKind.OnCallPolicy);
  });

  test("is listed under On-call policies and tagged Policy", () => {
    expect(POLICIES.groupTitle).toBe("On-call policies");
    expect(POLICIES.tag).toBe("Policy");
    expect(POLICIES.unknownName).toBe("Unknown policy");
  });

  test("is drawn as a phone, never as a person, a group or a schedule's calendar", () => {
    expect(POLICIES.avatar).toEqual({ type: "icon", icon: IconProp.Call });

    for (const kind of Object.values(PeoplePickerKind)) {
      if (kind !== PeoplePickerKind.OnCallPolicy) {
        expect(getPeoplePickerKindDefinition(kind).avatar).not.toEqual(
          POLICIES.avatar,
        );
      }
    }
  });

  test("reads a policy's id and name off a related row", () => {
    expect(POLICIES.relationSelect).toEqual({ _id: true, name: true });
    expect(POLICIES.fromModel(makePolicy(CRITICAL, "Critical"))).toEqual({
      kind: PeoplePickerKind.OnCallPolicy,
      id: CRITICAL,
      name: "Critical",
    });
  });

  test("an archived policy says so beside its name", () => {
    expect(
      POLICIES.fromModel(makePolicy(OLD_ROTA, "Old rota", true))?.name,
    ).toBe("Old rota (archived)");
    // One read without the flag, or with it off, is the policy as it is.
    expect(
      POLICIES.fromModel(makePolicy(OLD_ROTA, "Old rota", false))?.name,
    ).toBe("Old rota");
    expect(POLICIES.fromModel(makePolicy(OLD_ROTA, "Old rota"))?.name).toBe(
      "Old rota",
    );
  });

  test("a row without a name is still a pick, named as unknown", () => {
    expect(POLICIES.fromModel(makePolicy(CRITICAL))?.name).toBe(
      "Unknown policy",
    );
    expect(
      POLICIES.fromModel(makePolicy(CRITICAL, undefined, true))?.name,
    ).toBe("Unknown policy");
  });

  test("a row without an id is not a pick", () => {
    expect(POLICIES.fromModel(new OnCallDutyPolicy())).toBeNull();
  });

  test("related rows become options", () => {
    const options: Array<PeoplePickerOption> = getPeoplePickerOptionsFromModels(
      [
        {
          kind: PeoplePickerKind.OnCallPolicy,
          models: [
            makePolicy(CRITICAL, "Critical"),
            makePolicy(CRITICAL, "Critical"),
            makePolicy(DATABASE, "Database"),
          ],
        },
      ],
    );

    expect(
      options.map((option: PeoplePickerOption): string => {
        return `${option.kind}:${option.name}`;
      }),
    ).toEqual(["onCallPolicy:Critical", "onCallPolicy:Database"]);
  });
});

describe("searching on-call policies", () => {
  test("lists the project's policies that are not archived, by name", async () => {
    getListMock.mockResolvedValue(
      listResult([
        makePolicy(CRITICAL, "Critical", false),
        makePolicy(DATABASE, "Database", false),
      ]) as never,
    );

    const options: Array<PeoplePickerOption> = await POLICIES.search({
      projectId: PROJECT_ID,
      searchText: "",
      limit: PEOPLE_PICKER_SEARCH_LIMIT,
    });

    expect(
      options.map((option: PeoplePickerOption): string => {
        return option.name;
      }),
    ).toEqual(["Critical", "Database"]);

    const request: any = getListMock.mock.calls[0]![0];

    expect(request.modelType).toBe(OnCallDutyPolicy);
    // The policies the On-Call Policies page lists: an archived one pages no one.
    expect(request.query).toEqual({ projectId: PROJECT_ID, isArchived: false });
    expect(request.select).toEqual({ _id: true, name: true, isArchived: true });
    expect(request.sort).toEqual({ name: SortOrder.Ascending });
    expect(request.limit).toBe(PEOPLE_PICKER_SEARCH_LIMIT);
  });

  test("matches what is typed against the name, still leaving archived ones out", async () => {
    getListMock.mockResolvedValue(listResult([]) as never);

    await POLICIES.search({
      projectId: PROJECT_ID,
      searchText: "  crit ",
      limit: PEOPLE_PICKER_SEARCH_LIMIT,
    });

    const request: any = getListMock.mock.calls[0]![0];

    expect(request.query.name).toBeInstanceOf(Search);
    expect((request.query.name as Search<string>).toString()).toBe("crit");
    expect(request.query.isArchived).toBe(false);
  });

  test("looks picks up by id in one request - archived or not, so an old pick is still named", async () => {
    getListMock.mockResolvedValue(
      listResult([
        makePolicy(CRITICAL, "Critical", false),
        makePolicy(OLD_ROTA, "Old rota", true),
      ]) as never,
    );

    const options: Array<PeoplePickerOption> = await POLICIES.getByIds({
      projectId: PROJECT_ID,
      ids: [CRITICAL, OLD_ROTA],
    });

    expect(options).toEqual([
      { kind: PeoplePickerKind.OnCallPolicy, id: CRITICAL, name: "Critical" },
      {
        kind: PeoplePickerKind.OnCallPolicy,
        id: OLD_ROTA,
        name: "Old rota (archived)",
      },
    ]);
    expect(getListMock).toHaveBeenCalledTimes(1);

    const request: any = getListMock.mock.calls[0]![0];

    expect(request.query.projectId).toBe(PROJECT_ID);
    expect(request.query._id).toBeInstanceOf(Includes);
    expect((request.query._id as Includes).values).toEqual([
      CRITICAL,
      OLD_ROTA,
    ]);
    expect("isArchived" in request.query).toBe(false);
    expect(request.limit).toBe(LIMIT_PER_PROJECT);
  });

  test("no ids, no request", async () => {
    await expect(
      POLICIES.getByIds({ projectId: PROJECT_ID, ids: [] }),
    ).resolves.toEqual([]);
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("a failure that is not about the plan is reported, not hidden", async () => {
    getListMock.mockImplementation(async (): Promise<never> => {
      throw new Error("network down");
    });

    await expect(
      POLICIES.search({
        projectId: PROJECT_ID,
        searchText: "",
        limit: PEOPLE_PICKER_SEARCH_LIMIT,
      }),
    ).rejects.toThrow("network down");
  });
});

describe("on-call policies and the project's plan", () => {
  test("every plan lists its policies: the Free plan is asked of the server like any other", async () => {
    setBillingEnabled(true);
    getListMock.mockResolvedValue(
      listResult([makePolicy(CRITICAL, "Critical", false)]) as never,
    );

    for (const plan of [PlanType.Free, PlanType.Growth, PlanType.Scale]) {
      getListMock.mockClear();
      jest.spyOn(ProjectUtil, "getCurrentPlan").mockReturnValue(plan);

      await expect(
        POLICIES.search({
          projectId: PROJECT_ID,
          searchText: "",
          limit: PEOPLE_PICKER_SEARCH_LIMIT,
        }),
      ).resolves.toHaveLength(1);
      expect(getListMock).toHaveBeenCalledTimes(1);
    }
  });

  test("the policy model names no plan for reading it - if it ever does, the list has to ask first, as schedules do", () => {
    expect(new OnCallDutyPolicy().getReadBillingPlan()).toBeFalsy();
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
      POLICIES.search({
        projectId: PROJECT_ID,
        searchText: "",
        limit: PEOPLE_PICKER_SEARCH_LIMIT,
      }),
    ).resolves.toEqual([]);
    await expect(
      POLICIES.getByIds({ projectId: PROJECT_ID, ids: [CRITICAL] }),
    ).resolves.toEqual([]);
  });
});
