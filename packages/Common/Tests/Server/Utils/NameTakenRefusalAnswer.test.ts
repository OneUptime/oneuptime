import LabelService from "../../../Server/Services/LabelService";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import TeamService from "../../../Server/Services/TeamService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ArchivableValueGuard from "../../../Server/Utils/Database/ArchivableValueGuard";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import logger from "../../../Server/Utils/Logger";
import ResponseUtil from "../../../Server/Utils/Response";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "../../../Models/DatabaseModels/Label";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Team from "../../../Models/DatabaseModels/Team";
import {
  AI_RUN_REFUSALS,
  AI_RUN_REFUSAL_CODE_FIELD,
  AiRunRefusalCode,
} from "../../../Types/AI/AiRunRefusal";
import AiRunRefusalException from "../../../Types/Exception/AiRunRefusalException";
import BadDataException from "../../../Types/Exception/BadDataException";
import BadDataExceptionWithDetails, {
  getErrorDetails,
} from "../../../Types/Exception/BadDataExceptionWithDetails";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import NameTakenException, {
  NAME_TAKEN_BY_ARCHIVED_REFUSAL_CODE,
  NAME_TAKEN_REFUSAL_CODE,
  REFUSAL_CODE_FIELD,
} from "../../../Types/Exception/NameTakenException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ValueTakenException, {
  VALUE_TAKEN_BY_ARCHIVED_REFUSAL_CODE,
  VALUE_TAKEN_REFUSAL_CODE,
} from "../../../Types/Exception/ValueTakenException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  ARCHIVABLE_VALUES,
  ArchivableValueType,
} from "../../../Utils/ArchivableValues";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A NAME ANOTHER RECORD HAS IS REFUSED WITH A CODE A PROGRAM CAN READ
 * (#9855).
 *
 * Teams, labels, on-call policies and on-call schedules each have a name of
 * their own in a project. A create or a rename onto a name another one has
 * is refused with 400 and its English sentence, which may be reworded, and
 * now with a code beside it: { refusalCode: "name_taken" }. The Terraform
 * provider asks such a write again while another resource of the same apply
 * gives the name up, and tells the refusal by the code alone
 * (Scripts/TerraformProvider/StaticFiles/client_name_taken_test.go). So:
 *
 *   - the answer carries the code beside the message, whichever way it is
 *     answered: a route's next(err) (the express error handler, which every
 *     create and update of the API reaches), a rejected promise, or
 *     Response.sendErrorResponse - and a detail never replaces the message;
 *   - every kind's refusal of a taken name carries it: a team's, an on-call
 *     policy's (an archived one's too), an on-call schedule's, a label's on
 *     a create and on a rename, and a label named as an archived one. A
 *     name only an archived record has carries "name_taken_by_archived"
 *     (#10065): nothing an apply does to the records in service gives it
 *     up, so the provider answers at once, and never asks it again (the
 *     other kinds: Tests/Server/Services/UniqueNameRefusalCodes.test.ts);
 *   - no other refusal does: one update that would give several records one
 *     name is not a name another record has, and asking it again changes
 *     nothing; a plain bad request carries no code;
 *   - the field is the one the AI run refusals already use, so a client
 *     reads one field whatever refused.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RECORD_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const SECOND_RECORD_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const CLASHING_RECORD_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const USER_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");

const MEMBER_PROPS: Record<string, unknown> = {
  userId: USER_ID,
  tenantId: PROJECT_ID,
};

const TEAM_TAKEN: string =
  "There is already a team called Primary in this project. Pick another name.";

const NAME_TAKEN_DETAILS: JSONObject = {
  [REFUSAL_CODE_FIELD]: NAME_TAKEN_REFUSAL_CODE,
};

const TAKEN_BY_ARCHIVED_DETAILS: JSONObject = {
  [REFUSAL_CODE_FIELD]: NAME_TAKEN_BY_ARCHIVED_REFUSAL_CODE,
};

interface UniqueCheckHooks {
  onBeforeCreateUniqueCheck: (createBy: CreateBy<BaseModel>) => Promise<void>;
  onBeforeUpdateUniqueCheck: (updateBy: UpdateBy<BaseModel>) => Promise<void>;
}

// What a write threw, for the assertions to read.
async function thrownBy(write: Promise<unknown>): Promise<unknown> {
  try {
    await write;
  } catch (error) {
    return error;
  }

  throw new Error("Expected the write to be refused.");
}

function expectNameTaken(
  error: unknown,
  message: string,
  details: JSONObject = NAME_TAKEN_DETAILS,
): void {
  expect(error).toBeInstanceOf(NameTakenException);
  // Still bad data, at 400, for everything that reads it as such.
  expect(error).toBeInstanceOf(BadDataException);
  expect((error as NameTakenException).code).toBe(
    ExceptionCode.BadDataException,
  );
  expect((error as NameTakenException).message).toBe(message);
  expect((error as NameTakenException).details).toEqual(details);
}

function record<TBaseModel extends BaseModel>(
  model: TBaseModel,
  data: { id: ObjectID; name: string; isArchived?: boolean },
): TBaseModel {
  const fields: Record<string, unknown> = model as unknown as Record<
    string,
    unknown
  >;

  model._id = data.id.toString();
  fields["name"] = data.name;
  fields["projectId"] = PROJECT_ID;

  if (data.isArchived !== undefined) {
    fields["isArchived"] = data.isArchived;
  }

  return model;
}

function createWith(
  service: unknown,
  model: BaseModel,
  name: string,
): Promise<void> {
  Object.assign(model, { name: name, projectId: PROJECT_ID });

  return (service as UniqueCheckHooks).onBeforeCreateUniqueCheck({
    data: model,
    props: MEMBER_PROPS,
  } as unknown as CreateBy<BaseModel>);
}

function renameWith(service: unknown, name: string): Promise<void> {
  return (service as UniqueCheckHooks).onBeforeUpdateUniqueCheck({
    query: { _id: RECORD_ID.toString() },
    data: { name: name },
    props: MEMBER_PROPS,
    limit: 1,
    skip: 0,
  } as unknown as UpdateBy<BaseModel>);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the exception", () => {
  test("is bad data, at 400, with the code beside its message", () => {
    const error: NameTakenException = new NameTakenException(TEAM_TAKEN);

    expect(error).toBeInstanceOf(BadDataExceptionWithDetails);
    expectNameTaken(error, TEAM_TAKEN);
  });

  test("puts its code in the field the AI run refusals put theirs", () => {
    expect(REFUSAL_CODE_FIELD).toBe("refusalCode");
    expect(AI_RUN_REFUSAL_CODE_FIELD).toBe(REFUSAL_CODE_FIELD);
    // The values a client matches: part of the API, never reworded.
    expect(NAME_TAKEN_REFUSAL_CODE).toBe("name_taken");
    expect(NAME_TAKEN_BY_ARCHIVED_REFUSAL_CODE).toBe("name_taken_by_archived");
  });

  test("says, in its code, when the record that has the name is archived", () => {
    expectNameTaken(
      new NameTakenException(TEAM_TAKEN, { isArchived: true }),
      TEAM_TAKEN,
      TAKEN_BY_ARCHIVED_DETAILS,
    );
    expectNameTaken(
      new NameTakenException(TEAM_TAKEN, { isArchived: false }),
      TEAM_TAKEN,
    );
  });

  test("getErrorDetails reads an exception's details, and nothing of anything else", () => {
    expect(getErrorDetails(new NameTakenException(TEAM_TAKEN))).toEqual(
      NAME_TAKEN_DETAILS,
    );
    expect(getErrorDetails(new BadDataException(TEAM_TAKEN))).toEqual({});
    expect(getErrorDetails(new Error(TEAM_TAKEN))).toEqual({});
    expect(getErrorDetails(undefined)).toEqual({});
  });
});

describe("the answer", () => {
  let statuses: Array<number>;
  let bodies: Array<JSONObject>;
  let res: ExpressResponse;

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {});
    jest.spyOn(logger, "debug").mockImplementation((): void => {});

    statuses = [];
    bodies = [];

    res = {
      headersSent: false,
      status: (code: number): ExpressResponse => {
        statuses.push(code);
        return res;
      },
      send: (body: JSONObject): ExpressResponse => {
        bodies.push(body);
        return res;
      },
    } as unknown as ExpressResponse;
  });

  function handle(error: unknown): void {
    expressErrorHandler(
      error as Error,
      {
        url: "/api/team/33333333-3333-4333-8333-333333333333",
      } as ExpressRequest,
      res,
      (() => {}) as unknown as NextFunction,
    );
  }

  test("a create or update's next(err) answers 400 with the sentence and the code beside it", () => {
    handle(new NameTakenException(TEAM_TAKEN));

    expect(statuses).toEqual([400]);
    expect(bodies).toEqual([
      { error: TEAM_TAKEN, refusalCode: NAME_TAKEN_REFUSAL_CODE },
    ]);
  });

  test("a rejected promise handed on answers the same", async () => {
    const rejected: Promise<never> = Promise.reject(
      new NameTakenException(TEAM_TAKEN),
    );
    rejected.catch((): void => {});

    handle(rejected);
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 0);
    });

    expect(statuses).toEqual([400]);
    expect(bodies).toEqual([
      { error: TEAM_TAKEN, refusalCode: NAME_TAKEN_REFUSAL_CODE },
    ]);
  });

  test("a name an archived record has answers its own code, the same ways", () => {
    handle(new NameTakenException(TEAM_TAKEN, { isArchived: true }));
    ResponseUtil.sendErrorResponse(
      { headers: {}, socket: {} } as unknown as ExpressRequest,
      res,
      new NameTakenException(TEAM_TAKEN, { isArchived: true }),
    );

    expect(statuses).toEqual([400, 400]);
    expect(bodies).toEqual([
      { error: TEAM_TAKEN, refusalCode: NAME_TAKEN_BY_ARCHIVED_REFUSAL_CODE },
      { message: TEAM_TAKEN, refusalCode: NAME_TAKEN_BY_ARCHIVED_REFUSAL_CODE },
    ]);
  });

  test("Response.sendErrorResponse answers the same, under its own message field", () => {
    ResponseUtil.sendErrorResponse(
      { headers: {}, socket: {} } as unknown as ExpressRequest,
      res,
      new NameTakenException(TEAM_TAKEN),
    );

    expect(statuses).toEqual([400]);
    expect(bodies).toEqual([
      { message: TEAM_TAKEN, refusalCode: NAME_TAKEN_REFUSAL_CODE },
    ]);
  });

  /*
   * A value that is not a name (#10319): its own codes, and the field whose
   * value is taken, beside the sentence, both ways a request is answered.
   */
  test("a taken value answers 400 with value_taken and the field, through next(err) and sendErrorResponse", () => {
    const DOMAIN_TAKEN: string =
      "Status Page Domain with the same fullDomain already exists.";

    handle(new ValueTakenException(DOMAIN_TAKEN, { field: "fullDomain" }));
    ResponseUtil.sendErrorResponse(
      { headers: {}, socket: {} } as unknown as ExpressRequest,
      res,
      new ValueTakenException(DOMAIN_TAKEN, {
        field: "fullDomain",
        isArchived: true,
      }),
    );

    expect(statuses).toEqual([400, 400]);
    expect(bodies).toEqual([
      {
        error: DOMAIN_TAKEN,
        refusalCode: VALUE_TAKEN_REFUSAL_CODE,
        field: "fullDomain",
      },
      {
        message: DOMAIN_TAKEN,
        refusalCode: VALUE_TAKEN_BY_ARCHIVED_REFUSAL_CODE,
        field: "fullDomain",
      },
    ]);
  });

  test("any other bad request answers its message alone, as before", () => {
    handle(new BadDataException("Project ID is required to create a label."));
    handle(new NotFoundException("There is no such team."));

    expect(statuses).toEqual([400, 404]);
    expect(bodies).toEqual([
      { error: "Project ID is required to create a label." },
      { error: "There is no such team." },
    ]);
  });

  test("a detail named as the message never replaces it", () => {
    handle(
      new BadDataExceptionWithDetails("The real reason.", {
        error: "Something else.",
        refusalCode: "other",
      }),
    );

    expect(bodies).toEqual([
      { error: "The real reason.", refusalCode: "other" },
    ]);
  });

  /*
   * An AI insight's actions refuse with a code through next(err) too
   * (AIInsightAPI): the handler dropped it, so the Dashboard could only
   * word the refusal by its English. It now arrives as it does through
   * Response.sendErrorResponse.
   */
  test("an AI run refusal handed to next(err) keeps its code too", () => {
    handle(
      new AiRunRefusalException(AiRunRefusalCode.InsightNotFoundOrNoAccess),
    );

    expect(statuses).toEqual([400]);
    expect(bodies).toEqual([
      {
        error: AI_RUN_REFUSALS[AiRunRefusalCode.InsightNotFoundOrNoAccess],
        refusalCode: AiRunRefusalCode.InsightNotFoundOrNoAccess,
      },
    ]);
  });
});

describe("every kind's refusal of a taken name carries the code", () => {
  test.each([
    [
      "a team",
      TeamService,
      (): BaseModel => {
        return new Team();
      },
      "There is already a team called primary in this project. Pick another name.",
    ],
    [
      "an on-call policy",
      OnCallDutyPolicyService,
      (): BaseModel => {
        return new OnCallDutyPolicy();
      },
      "There is already an on-call policy called primary in this project. Pick another name.",
    ],
    [
      "an on-call schedule",
      OnCallDutyPolicyScheduleService,
      (): BaseModel => {
        return new OnCallDutyPolicySchedule();
      },
      "There is already an on-call schedule called primary in this project. Pick another name.",
    ],
  ])(
    "%s, created and renamed",
    async (
      _kind: string,
      service: unknown,
      makeModel: () => BaseModel,
      sentence: string,
    ) => {
      getJestSpyOn(service, "findOneBy").mockResolvedValue(
        record(makeModel(), { id: CLASHING_RECORD_ID, name: "Primary" }),
      );
      getJestSpyOn(service, "findRowsAndHoldUpdateToThem").mockResolvedValue([
        record(makeModel(), { id: RECORD_ID, name: "Secondary" }),
      ]);

      expectNameTaken(
        await thrownBy(createWith(service, makeModel(), " primary ")),
        sentence,
      );
      expectNameTaken(await thrownBy(renameWith(service, "primary")), sentence);
    },
  );

  test("an archived on-call policy's name, which says where to unarchive it, with the archived code", async () => {
    const findOneBy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      OnCallDutyPolicyService,
      "findOneBy",
    ).mockResolvedValue(
      record(new OnCallDutyPolicy(), {
        id: CLASHING_RECORD_ID,
        name: "Primary",
        isArchived: true,
      }),
    );

    expectNameTaken(
      await thrownBy(
        createWith(OnCallDutyPolicyService, new OnCallDutyPolicy(), "Primary"),
      ),
      "There is already an archived on-call policy called Primary in this project. Unarchive it from On-Call > Advanced > Archived Policies, or pick another name.",
      TAKEN_BY_ARCHIVED_DETAILS,
    );

    // Whether the other record is archived is read with it.
    const select: Record<string, unknown> = (
      findOneBy.mock.calls[0]![0] as { select: Record<string, unknown> }
    ).select;
    expect(select["isArchived"]).toBe(true);
  });

  test("a policy in service with the name answers name_taken, archived or not", async () => {
    getJestSpyOn(OnCallDutyPolicyService, "findOneBy").mockResolvedValue(
      record(new OnCallDutyPolicy(), {
        id: CLASHING_RECORD_ID,
        name: "Primary",
        isArchived: false,
      }),
    );

    expectNameTaken(
      await thrownBy(
        createWith(OnCallDutyPolicyService, new OnCallDutyPolicy(), "Primary"),
      ),
      "There is already an on-call policy called Primary in this project. Pick another name.",
    );
  });

  test("a team or a schedule, which cannot be archived, never asks whether the other is", async () => {
    for (const service of [TeamService, OnCallDutyPolicyScheduleService]) {
      const findOneBy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
        service,
        "findOneBy",
      ).mockResolvedValue(
        record(
          service === TeamService ? new Team() : new OnCallDutyPolicySchedule(),
          {
            id: CLASHING_RECORD_ID,
            name: "Primary",
          },
        ),
      );

      expect(
        getErrorDetails(
          await thrownBy(
            createWith(
              service,
              service === TeamService
                ? new Team()
                : new OnCallDutyPolicySchedule(),
              "Primary",
            ),
          ),
        ),
      ).toEqual(NAME_TAKEN_DETAILS);

      const select: Record<string, unknown> = (
        findOneBy.mock.calls[0]![0] as { select: Record<string, unknown> }
      ).select;
      expect(select["isArchived"]).toBeUndefined();
    }
  });

  test("a label renamed onto another label's name, or an archived label's", async () => {
    getJestSpyOn(LabelService, "findRowsAndHoldUpdateToThem").mockResolvedValue(
      [record(new Label(), { id: RECORD_ID, name: "Staging" })],
    );
    const findOneBy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      LabelService,
      "findOneBy",
    ).mockResolvedValue(
      record(new Label(), {
        id: CLASHING_RECORD_ID,
        name: "Production",
        isArchived: false,
      }),
    );

    expectNameTaken(
      await thrownBy(renameWith(LabelService, "production")),
      "There is already a label called production in this project. Pick another name.",
    );

    findOneBy.mockResolvedValue(
      record(new Label(), {
        id: CLASHING_RECORD_ID,
        name: "Production",
        isArchived: true,
      }),
    );

    expectNameTaken(
      await thrownBy(renameWith(LabelService, "Production")),
      ArchivableValueGuard.getArchivedNamesakeRefusal({
        definition: ARCHIVABLE_VALUES[ArchivableValueType.Label],
        name: "Production",
      }),
      TAKEN_BY_ARCHIVED_DETAILS,
    );
  });

  test("a new label named as another label, or as an archived one", async () => {
    const hooks: {
      onBeforeCreate: (createBy: CreateBy<Label>) => Promise<unknown>;
    } = LabelService as unknown as {
      onBeforeCreate: (createBy: CreateBy<Label>) => Promise<unknown>;
    };

    const create: (name: string) => Promise<unknown> = (
      name: string,
    ): Promise<unknown> => {
      const model: Label = new Label();
      model.name = name;
      model.projectId = PROJECT_ID;

      return hooks.onBeforeCreate({
        data: model,
        props: MEMBER_PROPS,
      } as unknown as CreateBy<Label>);
    };

    // Another label in use has the name: no archived one does.
    const findOneBy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      LabelService,
      "findOneBy",
    ).mockResolvedValue(null);
    getJestSpyOn(LabelService, "countBy").mockResolvedValue(
      new PositiveNumber(1),
    );

    expectNameTaken(
      await thrownBy(create("Production ")),
      "There is already a label called Production in this project. Pick another name.",
    );

    // An archived label has it: the guard answers first, with where to unarchive it.
    findOneBy.mockResolvedValue(
      record(new Label(), {
        id: CLASHING_RECORD_ID,
        name: "Production",
        isArchived: true,
      }),
    );

    expectNameTaken(
      await thrownBy(create("Production")),
      ArchivableValueGuard.getArchivedNamesakeRefusal({
        definition: ARCHIVABLE_VALUES[ArchivableValueType.Label],
        name: "Production",
      }),
      TAKEN_BY_ARCHIVED_DETAILS,
    );
  });
});

describe("no other refusal carries it", () => {
  test.each([
    [
      "teams",
      TeamService,
      (): BaseModel => {
        return new Team();
      },
      "Several teams cannot be given one name. Rename one team at a time.",
    ],
    [
      "labels",
      LabelService,
      (): BaseModel => {
        return new Label();
      },
      "Several labels cannot be given one name. Rename one label at a time.",
    ],
    [
      "on-call policies",
      OnCallDutyPolicyService,
      (): BaseModel => {
        return new OnCallDutyPolicy();
      },
      "Several on-call policies cannot be given one name. Rename one policy at a time.",
    ],
    [
      "on-call schedules",
      OnCallDutyPolicyScheduleService,
      (): BaseModel => {
        return new OnCallDutyPolicySchedule();
      },
      "Several on-call schedules cannot be given one name. Rename one schedule at a time.",
    ],
  ])(
    "one update giving several %s one name: asking it again changes nothing",
    async (
      _kind: string,
      service: unknown,
      makeModel: () => BaseModel,
      sentence: string,
    ) => {
      getJestSpyOn(service, "findRowsAndHoldUpdateToThem").mockResolvedValue([
        record(makeModel(), { id: RECORD_ID, name: "Platform" }),
        record(makeModel(), { id: SECOND_RECORD_ID, name: "Billing" }),
      ]);
      getJestSpyOn(service, "findOneBy").mockResolvedValue(null);

      const error: unknown = await thrownBy(renameWith(service, "Shared"));

      expect(error).toBeInstanceOf(BadDataException);
      expect(error).not.toBeInstanceOf(NameTakenException);
      expect((error as Error).message).toBe(sentence);
      expect(getErrorDetails(error)).toEqual({});
    },
  );
});
