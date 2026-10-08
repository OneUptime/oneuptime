import {
  getUserOverrideFormFields,
  prepareUserOverrideForCreate,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/UserOverrides/UserOverrideForm";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OnCallDutyPolicyUserOverride from "../../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import OnCallDutyPolicyEscalationRuleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyFeedService from "../../../Server/Services/OnCallDutyPolicyFeedService";
import OnCallDutyPolicyScheduleService, {
  CurrentOnCallInSchedule,
} from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import OnCallDutyPolicyUserOverrideService from "../../../Server/Services/OnCallDutyPolicyUserOverrideService";
import UserService from "../../../Server/Services/UserService";
import logger from "../../../Server/Utils/Logger";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import OneUptimeDate from "../../../Types/Date";
import EventInterval from "../../../Types/Events/EventInterval";
import BadDataException from "../../../Types/Exception/BadDataException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import Field from "../../../UI/Components/Forms/Types/Field";
import {
  at,
  rotation,
} from "../../Types/OnCallDutyPolicy/CalendarFeedTestFixtures";
import {
  FakeDb,
  emptyDb,
  installFakeDb,
  makeLayer,
  makeLayerUser,
  makeSchedule,
  oid,
} from "../Utils/OnCall/OnCallResolverTestHarness";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

import FeedMarkdown from "../../../Utils/Markdown/FeedMarkdown";
/*
 * The records these tests name are their project's own: the services check
 * every reference against the project (ProjectReferencesService).
 */
beforeEach(() => {
  stubProjectDirectory({});
});

/*
 * AN OVERRIDE MADE WITH THE ADD USER OVERRIDE FORM PAGES THE PERSON WHO
 * COVERS, NEVER THE PERSON WHO IS AWAY.
 *
 * The form used to label the column paging reads as "the person whose pages
 * are rerouted" (overrideUserId) "Override User - Select the user who will
 * override the on-call duty", the opposite of what it does, so someone
 * covering a colleague could set it up backwards and the colleague on leave
 * kept being paged. The form now asks "Who is away?" and "Who covers?".
 *
 * These tests fill the real form in by its questions - the fields
 * getUserOverrideFormFields builds, the defaults it starts with, the checks
 * it runs, the model ModelForm builds from its values and the page's own
 * onBeforeCreate - send that across the wire as the dashboard does, save it
 * through the real OnCallDutyPolicyUserOverrideService.create (its hooks,
 * permission and plan checks; only the database is in memory), and then ask
 * the real paging code who gets paged:
 *
 *   - an escalation rule that names the person who is away pages whoever
 *     covers (OnCallDutyPolicyEscalationRuleService.getRouteAlertToUserId),
 *     and one that names the person covering still pages them;
 *   - a schedule with the person who is away on call pages whoever covers
 *     (OnCallDutyPolicyScheduleService.getCurrentUserIdInSchedule), and
 *     names the person away as the one covered - whom paging falls back to
 *     when whoever covers is no longer a member of the project
 *     (getCurrentOnCallInSchedule);
 *   - a policy's own override covers that policy only, a global one every
 *     policy;
 *   - before it starts and after it ends, the person who is away is paged.
 *
 * On OneUptime Cloud user overrides are on the Growth plan, so this file
 * pins billing on, with the plans CI configures (packages/Common/
 * test-setup.sh), rather than following the environment it runs in.
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    IsBillingEnabled: true,
    getAllEnvVars: () => {
      return {
        SUBSCRIPTION_PLAN_BASIC:
          "Free,price_basic_monthly,price_basic_yearly,0,0,1,0",
        SUBSCRIPTION_PLAN_GROWTH:
          "Growth,price_growth_monthly,price_growth_yearly,22,20,2,14",
        SUBSCRIPTION_PLAN_SCALE:
          "Scale,price_scale_monthly,price_scale_yearly,99,84,3,14",
        SUBSCRIPTION_PLAN_ENTERPRISE:
          "Enterprise,price_enterprise_monthly,price_enterprise_yearly,-1,-1,4,14",
      };
    },
  };
});

const PROJECT: string = "0d200000-0000-4000-8000-000000000001";
const POLICY: string = "0d200000-0000-4000-8000-000000000002";
const OTHER_POLICY: string = "0d200000-0000-4000-8000-000000000003";
const SCHEDULE: string = "0d200000-0000-4000-8000-000000000004";
const LAYER: string = "0d200000-0000-4000-8000-000000000005";

// Alex is on call and going on leave; Sam covers.
const ALEX: string = "0d200000-0000-4000-8000-0000000000a1";
const SAM: string = "0d200000-0000-4000-8000-0000000000b1";

const NOW: Date = at("2026-03-03T12:00:00Z");
const NEXT_WEEK: Date = at("2026-03-10T12:00:00Z");

let db: FakeDb;
let savedCount: number;

function callerProps(
  callerId: string,
  plan: PlanType = PlanType.Growth,
): DatabaseCommonInteractionProps {
  return {
    userId: new ObjectID(callerId),
    tenantId: new ObjectID(PROJECT),
    currentPlan: plan,
    userTenantAccessPermission: {
      [PROJECT]: {
        _type: "UserTenantAccessPermission",
        projectId: new ObjectID(PROJECT),
        permissions: [
          {
            _type: "UserPermission",
            permission: Permission.OnCallMember,
            labelIds: [],
            scope: PermissionScope.All,
            isBlockPermission: false,
          },
        ],
      },
    },
  };
}

interface Answers {
  // Who is signed in: "Who is away?" starts as them.
  signedInAs: string;
  // Left out: the form's own answer is kept.
  whoIsAway?: string | undefined;
  whoCovers: string;
  starts?: Date | undefined;
  ends: Date;
}

// The value key a people picker field writes its one pick to.
function pickerValueKey(field: Field<OnCallDutyPolicyUserOverride>): string {
  const valueKey: string | undefined = field.peoplePicker?.kinds[0]?.valueKey;

  if (!valueKey) {
    throw new Error(`${field.title} is not a people picker.`);
  }

  return valueKey;
}

function fieldKey(field: Field<OnCallDutyPolicyUserOverride>): string {
  return Object.keys(field.field || {})[0] as string;
}

/*
 * The Add User Override form, filled in by its questions, as the dashboard
 * sends it: the values the form starts with and the answers given, every
 * field's own check, the model ModelForm builds, the page's onBeforeCreate,
 * then the JSON on the wire as the API reads it.
 */
function fillInAddUserOverrideForm(
  answers: Answers,
  scope: { onCallDutyPolicyId?: string | undefined } = {},
): OnCallDutyPolicyUserOverride {
  const fields: Array<Field<OnCallDutyPolicyUserOverride>> =
    getUserOverrideFormFields<OnCallDutyPolicyUserOverride>({
      currentUserId: answers.signedInAs,
    });

  const byQuestion: (title: string) => Field<OnCallDutyPolicyUserOverride> = (
    title: string,
  ): Field<OnCallDutyPolicyUserOverride> => {
    const field: Field<OnCallDutyPolicyUserOverride> | undefined = fields.find(
      (candidate: Field<OnCallDutyPolicyUserOverride>): boolean => {
        return candidate.title === title;
      },
    );

    if (!field) {
      throw new Error(`The form does not ask "${title}".`);
    }

    return field;
  };

  const values: JSONObject = {};

  // What the form starts with, as BasicForm fills it in.
  for (const field of fields) {
    if (field.defaultValue !== undefined) {
      values[fieldKey(field)] = field.defaultValue as string;
    }

    if (field.getDefaultValue && values[fieldKey(field)] === undefined) {
      values[fieldKey(field)] = field.getDefaultValue(values) as string;
    }
  }

  if (answers.whoIsAway) {
    values[pickerValueKey(byQuestion("Who is away?"))] = answers.whoIsAway;
  }

  values[pickerValueKey(byQuestion("Who covers?"))] = answers.whoCovers;

  if (answers.starts) {
    values[fieldKey(byQuestion("Starts"))] = OneUptimeDate.toString(
      answers.starts,
    );
  }

  values[fieldKey(byQuestion("Ends"))] = OneUptimeDate.toString(answers.ends);

  // Every field's own check lets it through.
  for (const field of fields) {
    expect(field.customValidation?.(values) ?? null).toBeNull();
  }

  const model: OnCallDutyPolicyUserOverride = BaseModel.fromJSON(
    values,
    OnCallDutyPolicyUserOverride,
  ) as OnCallDutyPolicyUserOverride;

  const prepared: OnCallDutyPolicyUserOverride = prepareUserOverrideForCreate(
    model,
    {
      projectId: new ObjectID(PROJECT),
      onCallDutyPolicyId: scope.onCallDutyPolicyId
        ? new ObjectID(scope.onCallDutyPolicyId)
        : undefined,
    },
  );

  return BaseModel.fromJSON(
    BaseModel.toJSON(prepared, OnCallDutyPolicyUserOverride),
    OnCallDutyPolicyUserOverride,
  ) as OnCallDutyPolicyUserOverride;
}

async function addOverride(
  answers: Answers,
  scope: { onCallDutyPolicyId?: string | undefined } = {},
): Promise<OnCallDutyPolicyUserOverride> {
  return OnCallDutyPolicyUserOverrideService.create({
    data: fillInAddUserOverrideForm(answers, scope),
    props: callerProps(answers.signedInAs),
  });
}

// Who an escalation rule naming this person pages, through the policy.
async function pagedFor(
  userId: string,
  policyId: string = POLICY,
): Promise<string> {
  const routed: ObjectID | null =
    await OnCallDutyPolicyEscalationRuleService.getRouteAlertToUserId({
      userId: new ObjectID(userId),
      onCallDutyPolicyId: new ObjectID(policyId),
      projectId: new ObjectID(PROJECT),
    });

  return (routed || new ObjectID(userId)).toString();
}

// Who the schedule pages right now, and whom an override has them cover.
async function onCallInSchedule(policyId: string = POLICY): Promise<{
  userId: string;
  coveredUserId: string | null;
} | null> {
  const onCall: CurrentOnCallInSchedule | null =
    await OnCallDutyPolicyScheduleService.getCurrentOnCallInSchedule(
      oid(SCHEDULE),
      { onCallDutyPolicyId: oid(policyId) },
    );

  return onCall
    ? {
        userId: onCall.userId.toString(),
        coveredUserId: onCall.coveredUserId
          ? onCall.coveredUserId.toString()
          : null,
      }
    : null;
}

// Who the schedule pages right now, through the policy.
async function pagedBySchedule(policyId: string = POLICY): Promise<string> {
  const onCall: ObjectID | null =
    await OnCallDutyPolicyScheduleService.getCurrentUserIdInSchedule(
      oid(SCHEDULE),
      { onCallDutyPolicyId: oid(policyId) },
    );

  return onCall ? onCall.toString() : "";
}

function setNow(now: Date): void {
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(now);
}

beforeEach(() => {
  db = emptyDb();
  savedCount = 0;

  // A schedule with Alex on call every day.
  db.schedules.push(
    makeSchedule({ id: SCHEDULE, projectId: PROJECT, timezone: "UTC" }),
  );
  db.layers.push(
    makeLayer({
      id: LAYER,
      scheduleId: SCHEDULE,
      projectId: PROJECT,
      startsAt: at("2026-01-01T00:00:00Z"),
      handOffTime: at("2026-01-01T09:00:00Z"),
      rotation: rotation(EventInterval.Day, 1),
    }),
  );
  db.layerUsers.push(
    makeLayerUser({
      id: `${LAYER}-alex`,
      scheduleId: SCHEDULE,
      layerId: LAYER,
      projectId: PROJECT,
      userId: ALEX,
    }),
  );

  installFakeDb(db);
  setNow(NOW);

  // The override's table: what create saves is what paging reads.
  jest
    .spyOn(OnCallDutyPolicyUserOverrideService, "getRepository")
    .mockReturnValue({
      save: async (
        data: OnCallDutyPolicyUserOverride,
      ): Promise<OnCallDutyPolicyUserOverride> => {
        savedCount++;
        data._id = `0d200000-0000-4000-8000-${String(savedCount).padStart(12, "0")}`;
        db.overrides.push(data as unknown as Record<string, unknown>);
        return data;
      },
    } as never);

  // What a saved override sets off: the policy feed and roster refreshes.
  jest
    .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyName")
    .mockResolvedValue("Payments");
  jest
    .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyLinkInDashboard")
    .mockResolvedValue(URL.fromString("https://oneuptime.example/policy"));
  jest.spyOn(UserService, "getTimezoneForUser").mockResolvedValue(null);
  jest
    .spyOn(UserService, "getUserMarkdownString")
    .mockResolvedValue(FeedMarkdown.asMarkdown("a person"));
  jest
    .spyOn(OnCallDutyPolicyFeedService, "createOnCallDutyPolicyFeedItem")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(OnCallDutyPolicyScheduleService, "refreshRostersForUserInProject")
    .mockResolvedValue(undefined);
  jest
    .spyOn(OnCallDutyPolicyScheduleService, "getScheduleIdsForUsersInProject")
    .mockResolvedValue([]);
  jest
    .spyOn(OnCallDutyPolicyScheduleService, "propagateShiftConfigChange")
    .mockResolvedValue(undefined);

  jest.spyOn(logger, "debug").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an override booked from the Add User Override form", () => {
  test("saves the person who is away as overrideUserId and the person who covers as routeAlertsToUserId", async () => {
    const saved: OnCallDutyPolicyUserOverride = await addOverride({
      signedInAs: ALEX,
      whoCovers: SAM,
      ends: NEXT_WEEK,
    });

    // Alex booked their own leave: "Who is away?" started as Alex.
    expect(saved.overrideUserId?.toString()).toBe(ALEX);
    expect(saved.routeAlertsToUserId?.toString()).toBe(SAM);
    expect(saved.projectId?.toString()).toBe(PROJECT);
    // Starting now, until next week.
    expect(OneUptimeDate.fromString(saved.startsAt!).getTime()).toBe(
      NOW.getTime(),
    );
    expect(OneUptimeDate.fromString(saved.endsAt!).getTime()).toBe(
      NEXT_WEEK.getTime(),
    );
    expect(db.overrides).toHaveLength(1);
  });

  test("an escalation rule naming the person who is away pages whoever covers", async () => {
    await addOverride({ signedInAs: ALEX, whoCovers: SAM, ends: NEXT_WEEK });

    expect(await pagedFor(ALEX)).toBe(SAM);
  });

  test("an escalation rule naming the person covering still pages them, not the person away", async () => {
    await addOverride({ signedInAs: ALEX, whoCovers: SAM, ends: NEXT_WEEK });

    expect(await pagedFor(SAM)).toBe(SAM);
  });

  test("a schedule with the person who is away on call pages whoever covers", async () => {
    expect(await pagedBySchedule()).toBe(ALEX);

    await addOverride({ signedInAs: ALEX, whoCovers: SAM, ends: NEXT_WEEK });

    expect(await pagedBySchedule()).toBe(SAM);
  });

  test("while it is in force, the schedule names the person away as the one covered", async () => {
    await expect(onCallInSchedule()).resolves.toEqual({
      userId: ALEX,
      coveredUserId: null,
    });

    await addOverride(
      { signedInAs: ALEX, whoCovers: SAM, ends: NEXT_WEEK },
      { onCallDutyPolicyId: POLICY },
    );

    await expect(onCallInSchedule(POLICY)).resolves.toEqual({
      userId: SAM,
      coveredUserId: ALEX,
    });

    // Another policy's pages: no override, nobody covered.
    await expect(onCallInSchedule(OTHER_POLICY)).resolves.toEqual({
      userId: ALEX,
      coveredUserId: null,
    });

    // Once it has ended, nobody is covered.
    setNow(at("2026-12-31T18:00:00Z"));
    await expect(onCallInSchedule(POLICY)).resolves.toEqual({
      userId: ALEX,
      coveredUserId: null,
    });
  });

  test("booked by someone else for a colleague, it still covers the colleague", async () => {
    // Sam, signed in, books cover for Alex, who is off sick: Sam covers.
    const saved: OnCallDutyPolicyUserOverride = await addOverride({
      signedInAs: SAM,
      whoIsAway: ALEX,
      whoCovers: SAM,
      ends: NEXT_WEEK,
    });

    expect(saved.overrideUserId?.toString()).toBe(ALEX);
    expect(saved.routeAlertsToUserId?.toString()).toBe(SAM);
    expect(await pagedFor(ALEX)).toBe(SAM);
    expect(await pagedBySchedule()).toBe(SAM);
  });

  test("before it starts and once it has ended, the person who is away is paged again", async () => {
    await addOverride({
      signedInAs: ALEX,
      whoCovers: SAM,
      starts: at("2026-03-05T12:00:00Z"),
      ends: at("2026-03-06T12:00:00Z"),
    });

    expect(await pagedFor(ALEX)).toBe(ALEX);
    expect(await pagedBySchedule()).toBe(ALEX);

    setNow(at("2026-03-05T18:00:00Z"));
    expect(await pagedFor(ALEX)).toBe(SAM);
    expect(await pagedBySchedule()).toBe(SAM);

    setNow(at("2026-03-06T18:00:00Z"));
    expect(await pagedFor(ALEX)).toBe(ALEX);
    expect(await pagedBySchedule()).toBe(ALEX);
  });

  test("from a policy's own User Overrides page, it covers that policy only", async () => {
    const saved: OnCallDutyPolicyUserOverride = await addOverride(
      { signedInAs: ALEX, whoCovers: SAM, ends: NEXT_WEEK },
      { onCallDutyPolicyId: POLICY },
    );

    expect(saved.onCallDutyPolicyId?.toString()).toBe(POLICY);

    expect(await pagedFor(ALEX, POLICY)).toBe(SAM);
    expect(await pagedBySchedule(POLICY)).toBe(SAM);

    expect(await pagedFor(ALEX, OTHER_POLICY)).toBe(ALEX);
    expect(await pagedBySchedule(OTHER_POLICY)).toBe(ALEX);
  });

  test("from On-Call Duty > User Overrides, it covers every policy", async () => {
    const saved: OnCallDutyPolicyUserOverride = await addOverride({
      signedInAs: ALEX,
      whoCovers: SAM,
      ends: NEXT_WEEK,
    });

    expect(saved.onCallDutyPolicyId).toBeFalsy();

    for (const policyId of [POLICY, OTHER_POLICY]) {
      expect(await pagedFor(ALEX, policyId)).toBe(SAM);
      expect(await pagedBySchedule(policyId)).toBe(SAM);
    }
  });
});

describe("what the server refuses, whatever the form", () => {
  test("the same person away and covering", async () => {
    const override: OnCallDutyPolicyUserOverride = fillInAddUserOverrideForm({
      signedInAs: ALEX,
      whoCovers: SAM,
      ends: NEXT_WEEK,
    });

    override.routeAlertsToUserId = new ObjectID(ALEX);

    await expect(
      OnCallDutyPolicyUserOverrideService.create({
        data: override,
        props: callerProps(ALEX),
      }),
    ).rejects.toThrow(BadDataException);

    expect(db.overrides).toHaveLength(0);
  });

  test("the same person away and covering, written in another case", async () => {
    const override: OnCallDutyPolicyUserOverride = fillInAddUserOverrideForm({
      signedInAs: ALEX,
      whoCovers: SAM,
      ends: NEXT_WEEK,
    });

    // As an API caller might send it: Postgres reads both as one uuid.
    override.routeAlertsToUserId = new ObjectID(ALEX.toUpperCase());

    await expect(
      OnCallDutyPolicyUserOverrideService.create({
        data: override,
        props: callerProps(ALEX),
      }),
    ).rejects.toThrow(
      "Override user and route alerts to user cannot be the same",
    );

    expect(db.overrides).toHaveLength(0);
  });

  test("an end that is not after the start", async () => {
    const override: OnCallDutyPolicyUserOverride = fillInAddUserOverrideForm({
      signedInAs: ALEX,
      whoCovers: SAM,
      ends: NEXT_WEEK,
    });

    override.endsAt = override.startsAt!;

    await expect(
      OnCallDutyPolicyUserOverrideService.create({
        data: override,
        props: callerProps(ALEX),
      }),
    ).rejects.toThrow("Start time must be before end time");

    expect(db.overrides).toHaveLength(0);
  });

  test("on the Free plan, before anything is saved: overrides are on the Growth plan", async () => {
    await expect(
      OnCallDutyPolicyUserOverrideService.create({
        data: fillInAddUserOverrideForm({
          signedInAs: ALEX,
          whoCovers: SAM,
          ends: NEXT_WEEK,
        }),
        props: callerProps(ALEX, PlanType.Free),
      }),
    ).rejects.toThrow(PaymentRequiredException);

    expect(db.overrides).toHaveLength(0);
    expect(await pagedFor(ALEX)).toBe(ALEX);
  });

  test.each([PlanType.Growth, PlanType.Scale, PlanType.Enterprise])(
    "on the %s plan, it is saved and covers",
    async (plan: PlanType) => {
      await OnCallDutyPolicyUserOverrideService.create({
        data: fillInAddUserOverrideForm({
          signedInAs: ALEX,
          whoCovers: SAM,
          ends: NEXT_WEEK,
        }),
        props: callerProps(ALEX, plan),
      });

      expect(db.overrides).toHaveLength(1);
      expect(await pagedFor(ALEX)).toBe(SAM);
    },
  );
});
