import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentGroupingRule from "../../../Models/DatabaseModels/IncidentGroupingRule";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import IncidentCustomFieldService from "../../../Server/Services/IncidentCustomFieldService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentGroupingRuleService from "../../../Server/Services/IncidentGroupingRuleService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import IncidentTemplateService from "../../../Server/Services/IncidentTemplateService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import IncidentCreatedRenotify from "../../../Types/StatusPage/IncidentCreatedRenotify";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { evaluateRowWriteSql } from "../TestingUtils/RowWriteSql";
import Dictionary from "../../../Types/Dictionary";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A private incident or incident episode is never shown on a status page
 * (StatusPageVisibility), and every write keeps it so, whoever makes it -
 * the dashboard, the API, Terraform, a workflow, a template, a monitor, a
 * privacy rule:
 *
 *   - a write that makes a record private switches Visible on Status Page
 *     off with it (as the incident's Settings form has always done);
 *   - a write that turns Visible on Status Page on and leaves Private as it
 *     is leaves a private record hidden: the database works the switch out
 *     in each record's own write, from the record as it is then
 *     (getRowWriteSql), so a private one is stored with it off - decided by
 *     that record alone, never by a read made earlier or by the other
 *     records the write reaches;
 *   - both switches are stored as the database stores them, so a
 *     hand-written "true" counts;
 *   - creating a private incident or episode creates it hidden, and tells
 *     nobody it was created.
 *
 * The hooks run as written; the database behind them is stubbed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-1111-4aaa-8bbb-000000000001",
);
const PRIVATE_ID: string = "0193c0de-1111-4aaa-8bbb-0000000000a1";
const PUBLIC_ID: string = "0193c0de-1111-4aaa-8bbb-0000000000a2";
const SEVERITY_ID: string = "0193c0de-1111-4aaa-8bbb-0000000000c1";
const CREATED_STATE_ID: string = "0193c0de-1111-4aaa-8bbb-0000000000d1";
const GROUPING_RULE_ID: string = "0193c0de-1111-4aaa-8bbb-0000000000e1";

const MEMBER: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: new ObjectID("0193c0de-1111-4aaa-8bbb-0000000000f1"),
};

type OnBeforeUpdate<T extends BaseModel> = (
  updateBy: UpdateBy<T>,
) => Promise<OnUpdate<T>>;
type OnBeforeCreate<T extends BaseModel> = (
  createBy: CreateBy<T>,
) => Promise<OnCreate<T>>;
type GetRowWriteSql = (data: unknown) => Dictionary<string>;

/*
 * What the database stores for a row in place of what an update asked for:
 * each column the service writes in SQL (getRowWriteSql), worked out on the
 * row as the write finds it (RowWriteSql), where that differs from the
 * value the update carries.
 */
function storedInPlaceOfWritten(
  rowWriteSql: Dictionary<string>,
  written: Record<string, unknown>,
  row: BaseModel,
): Record<string, unknown> {
  const stored: Record<string, unknown> = {};

  for (const [column, expression] of Object.entries(rowWriteSql)) {
    const value: unknown = evaluateRowWriteSql(
      expression,
      row as unknown as Record<string, unknown>,
    );

    if (value !== written[column]) {
      stored[column] = value;
    }
  }

  return stored;
}

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * ---------------------------------------------------------------- incidents
 */

function storedIncident(id: string, isPrivate: boolean): Incident {
  const incident: Incident = new Incident();
  incident._id = id;
  incident.projectId = PROJECT_ID;
  incident.isVisibleOnStatusPage = false;
  incident.isPrivate = isPrivate;
  incident.subscriberNotificationStatusOnIncidentCreated =
    StatusPageSubscriberNotificationStatus.Skipped;
  incident.subscriberNotificationStatusMessage =
    IncidentCreatedRenotify.hiddenFromStatusPagesMessage;
  incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated = true;
  incident.subscriberNotificationStatusOnPostmortemPublished =
    StatusPageSubscriberNotificationStatus.Success;
  return incident;
}

describe("IncidentService keeps a private incident hidden on update", () => {
  let stored: Array<Incident>;
  let findBy: MockFunction;

  beforeEach(() => {
    stored = [storedIncident(PRIVATE_ID, true)];

    findBy = getJestMockFunction();
    findBy.mockImplementation(() => {
      return Promise.resolve(stored);
    });

    jest.spyOn(IncidentService, "findBy").mockImplementation(findBy as never);
    jest
      .spyOn(
        IncidentService as unknown as {
          validateProjectScopedReferences: () => Promise<void>;
        },
        "validateProjectScopedReferences",
      )
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(CustomFieldMappingService, "applyMappingsToUpdate")
      .mockResolvedValue(undefined as never);
  });

  async function beforeUpdate(
    data: Record<string, unknown>,
    options: {
      query?: Record<string, unknown>;
      miscDataProps?: Record<string, unknown>;
    } = {},
  ): Promise<OnUpdate<Incident>> {
    return await (
      IncidentService as unknown as { onBeforeUpdate: OnBeforeUpdate<Incident> }
    ).onBeforeUpdate({
      query: (options.query || { _id: PRIVATE_ID }) as never,
      data: data as never,
      props: { isRoot: true },
      miscDataProps: options.miscDataProps as never,
      limit: 1,
      skip: 0,
    });
  }

  function writtenBy(onUpdate: OnUpdate<Incident>): Record<string, unknown> {
    return onUpdate.updateBy.data as unknown as Record<string, unknown>;
  }

  // The columns the database works out in each incident's own write.
  function rowWriteSql(onUpdate: OnUpdate<Incident>): Dictionary<string> {
    return (
      IncidentService as unknown as {
        getRowWriteSql: GetRowWriteSql;
      }
    ).getRowWriteSql(onUpdate.updateBy.data);
  }

  function rowColumns(onUpdate: OnUpdate<Incident>): Array<string> {
    return Object.keys(rowWriteSql(onUpdate));
  }

  // What one incident is stored with in place of the update's own values.
  function rowOverrides(
    onUpdate: OnUpdate<Incident>,
    row: Incident,
  ): Record<string, unknown> {
    return storedInPlaceOfWritten(
      rowWriteSql(onUpdate),
      onUpdate.updateBy.data as unknown as Record<string, unknown>,
      row,
    );
  }

  function rowOf(id: string, isPrivate?: boolean): Incident {
    const row: Incident = new Incident();
    row._id = id;
    if (isPrivate !== undefined) {
      row.isPrivate = isPrivate;
    }
    return row;
  }

  test("turning Visible on Status Page on, alone, writes a private incident with it off, in its own write", async () => {
    const onUpdate: OnUpdate<Incident> = await beforeUpdate({
      isVisibleOnStatusPage: true,
    });

    // The database works the switch out in each incident's own write...
    expect(rowColumns(onUpdate)).toEqual(["isVisibleOnStatusPage"]);
    // ...and a private one is written hidden; Private itself is left alone.
    expect(rowOverrides(onUpdate, rowOf(PRIVATE_ID, true))).toEqual({
      isVisibleOnStatusPage: false,
    });
    expect(writtenBy(onUpdate)).not.toHaveProperty("isPrivate");
  });

  test.each([
    ['a hand-written "true"', "true"],
    ['"yes"', "yes"],
    ["the number 1", 1],
  ] as Array<[string, unknown]>)(
    "turning it on as %s does too, and the switch is stored as a boolean",
    async (_label: string, value: unknown) => {
      const onUpdate: OnUpdate<Incident> = await beforeUpdate({
        isVisibleOnStatusPage: value,
      });

      expect(writtenBy(onUpdate)["isVisibleOnStatusPage"]).toBe(true);
      expect(rowOverrides(onUpdate, rowOf(PRIVATE_ID, true))).toEqual({
        isVisibleOnStatusPage: false,
      });
    },
  );

  test("the incident as its own write finds it decides, not a read made before it", async () => {
    // Read as public by the update's hooks, private by the time it is written.
    stored = [storedIncident(PRIVATE_ID, false)];

    const onUpdate: OnUpdate<Incident> = await beforeUpdate({
      isVisibleOnStatusPage: true,
    });

    expect(rowOverrides(onUpdate, rowOf(PRIVATE_ID, true))).toEqual({
      isVisibleOnStatusPage: false,
    });

    // And the other way round: made not private meanwhile, it is shown.
    stored = [storedIncident(PUBLIC_ID, true)];

    const second: OnUpdate<Incident> = await beforeUpdate(
      { isVisibleOnStatusPage: true },
      { query: { _id: PUBLIC_ID } },
    );

    expect(rowOverrides(second, rowOf(PUBLIC_ID, false))).toEqual({});
  });

  test("a public incident turned on is shown", async () => {
    stored = [storedIncident(PUBLIC_ID, false)];

    const onUpdate: OnUpdate<Incident> = await beforeUpdate(
      { isVisibleOnStatusPage: true },
      { query: { _id: PUBLIC_ID } },
    );

    expect(writtenBy(onUpdate)["isVisibleOnStatusPage"]).toBe(true);
    expect(rowOverrides(onUpdate, rowOf(PUBLIC_ID, false))).toEqual({});
  });

  test("turned on and made not private in one write, it is shown", async () => {
    const onUpdate: OnUpdate<Incident> = await beforeUpdate({
      isVisibleOnStatusPage: true,
      isPrivate: false,
    });

    expect(writtenBy(onUpdate)).toEqual(
      expect.objectContaining({
        isVisibleOnStatusPage: true,
        isPrivate: false,
      }),
    );
    // The write decides it, so nothing more is read or written per incident.
    expect(rowColumns(onUpdate)).toEqual([]);
    expect(rowOverrides(onUpdate, rowOf(PRIVATE_ID, true))).toEqual({});
  });

  test.each([
    ["true", true],
    ['a hand-written "true"', "true"],
    ['"on"', "on"],
  ] as Array<[string, unknown]>)(
    "made private as %s, it is switched off with it - the Settings form's save included",
    async (_label: string, value: unknown) => {
      stored = [storedIncident(PUBLIC_ID, false)];

      for (const data of [
        { isPrivate: value },
        { isPrivate: value, isVisibleOnStatusPage: true },
      ]) {
        const onUpdate: OnUpdate<Incident> = await beforeUpdate(data, {
          query: { _id: PUBLIC_ID },
        });

        expect(writtenBy(onUpdate)).toEqual(
          expect.objectContaining({
            isVisibleOnStatusPage: false,
            isPrivate: true,
          }),
        );
        expect(rowColumns(onUpdate)).toEqual([]);
      }
    },
  );

  test("publishing a private incident never queues its 'created' notification", async () => {
    const onUpdate: OnUpdate<Incident> = await beforeUpdate(
      { isVisibleOnStatusPage: true },
      { miscDataProps: IncidentCreatedRenotify.getMiscDataProps() },
    );

    expect(writtenBy(onUpdate)).not.toHaveProperty(
      "subscriberNotificationStatusOnIncidentCreated",
    );
    expect(writtenBy(onUpdate)).not.toHaveProperty(
      "subscriberNotificationStatusMessage",
    );
  });

  test("an update that writes neither switch reads nothing for them and adds neither", async () => {
    const onUpdate: OnUpdate<Incident> = await beforeUpdate({});

    expect(writtenBy(onUpdate)).not.toHaveProperty("isVisibleOnStatusPage");
    expect(writtenBy(onUpdate)).not.toHaveProperty("isPrivate");
    expect(findBy).not.toHaveBeenCalled();
    expect(rowColumns(onUpdate)).toEqual([]);
  });

  describe("one write to many incidents, some private (a workflow's Update Many)", () => {
    beforeEach(() => {
      stored = [
        storedIncident(PRIVATE_ID, true),
        storedIncident(PUBLIC_ID, false),
      ];
    });

    test("each private one is written with Visible on Status Page off, in its own write; the public one as the update has it", async () => {
      const onUpdate: OnUpdate<Incident> = await beforeUpdate(
        { isVisibleOnStatusPage: true },
        { query: { projectId: PROJECT_ID } },
      );

      expect(writtenBy(onUpdate)["isVisibleOnStatusPage"]).toBe(true);
      expect(rowOverrides(onUpdate, rowOf(PRIVATE_ID, true))).toEqual({
        isVisibleOnStatusPage: false,
      });
      expect(rowOverrides(onUpdate, rowOf(PUBLIC_ID, false))).toEqual({});
    });

    test("no incident decides another's write: every one private leaves the update as written, and each is written hidden", async () => {
      stored = [
        storedIncident(PRIVATE_ID, true),
        storedIncident("0193c0de-1111-4aaa-8bbb-0000000000a3", true),
      ];

      const onUpdate: OnUpdate<Incident> = await beforeUpdate(
        { isVisibleOnStatusPage: true },
        { query: { projectId: PROJECT_ID } },
      );

      expect(writtenBy(onUpdate)["isVisibleOnStatusPage"]).toBe(true);
      expect(rowOverrides(onUpdate, rowOf(PRIVATE_ID, true))).toEqual({
        isVisibleOnStatusPage: false,
      });
      // One the update reaches that is not private is shown.
      expect(
        rowOverrides(
          onUpdate,
          rowOf("0193c0de-1111-4aaa-8bbb-0000000000a9", false),
        ),
      ).toEqual({});
    });

    test("an incident whose privacy was not read is written as the update has it", async () => {
      const onUpdate: OnUpdate<Incident> = await beforeUpdate(
        { isVisibleOnStatusPage: true },
        { query: { projectId: PROJECT_ID } },
      );

      expect(rowOverrides(onUpdate, rowOf(PRIVATE_ID))).toEqual({});
    });

    test("an update that does not turn Visible on Status Page on writes every row as it is", async () => {
      for (const data of [
        { isVisibleOnStatusPage: false },
        { isVisibleOnStatusPage: true, isPrivate: false },
        { title: "Checkout errors" },
      ] as Array<Record<string, unknown>>) {
        const onUpdate: OnUpdate<Incident> = await beforeUpdate(data, {
          query: { projectId: PROJECT_ID },
        });

        expect(rowColumns(onUpdate)).toEqual([]);
        expect(rowOverrides(onUpdate, rowOf(PRIVATE_ID, true))).toEqual({});
      }
    });
  });
});

describe("IncidentService.onBeforeCreate creates a private incident hidden", () => {
  beforeEach(() => {
    const createdState: IncidentState = new IncidentState();
    createdState._id = CREATED_STATE_ID;

    jest
      .spyOn(IncidentStateService, "findOneBy")
      .mockResolvedValue(createdState as never);
    jest
      .spyOn(ProjectService, "incrementAndGetIncidentCounter")
      .mockResolvedValue({ counter: 7, prefix: undefined } as never);
    jest
      .spyOn(
        ProjectScopedReferenceValidator,
        "validateReferencesBelongToProject",
      )
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(UserService, "getUserMarkdownString")
      .mockResolvedValue("a teammate" as never);
    jest
      .spyOn(IncidentTemplateService, "findOneBy")
      .mockResolvedValue(null as never);
    jest
      .spyOn(IncidentCustomFieldService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(CustomFieldMappingService, "applyMappingsToCreate")
      .mockResolvedValue(undefined as never);
  });

  async function beforeCreate(
    values: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const incident: Incident = new Incident();
    incident.title = "Checkout errors";
    incident.incidentSeverityId = new ObjectID(SEVERITY_ID);

    for (const [key, value] of Object.entries(values)) {
      (incident as unknown as Record<string, unknown>)[key] = value;
    }

    const onCreate: OnCreate<Incident> = await (
      IncidentService as unknown as { onBeforeCreate: OnBeforeCreate<Incident> }
    ).onBeforeCreate({ data: incident, props: MEMBER });

    return onCreate.createBy.data as unknown as Record<string, unknown>;
  }

  test.each([
    ["true", true],
    ['a hand-written "true"', "true"],
    ['"yes"', "yes"],
    ["the number 1", 1],
  ] as Array<[string, unknown]>)(
    "made private as %s, it is created hidden and announced to nobody",
    async (_label: string, value: unknown) => {
      const written: Record<string, unknown> = await beforeCreate({
        isPrivate: value,
      });

      expect(written["isPrivate"]).toBe(true);
      expect(written["isVisibleOnStatusPage"]).toBe(false);
      expect(
        written["shouldStatusPageSubscribersBeNotifiedOnIncidentCreated"],
      ).toBe(false);
    },
  );

  test("private wins over a Visible on Status Page sent with it", async () => {
    const written: Record<string, unknown> = await beforeCreate({
      isPrivate: true,
      isVisibleOnStatusPage: true,
      shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
    });

    expect(written["isVisibleOnStatusPage"]).toBe(false);
    expect(
      written["shouldStatusPageSubscribersBeNotifiedOnIncidentCreated"],
    ).toBe(false);
  });

  test("a public incident keeps what it was created with", async () => {
    const written: Record<string, unknown> = await beforeCreate({
      isPrivate: false,
      isVisibleOnStatusPage: true,
      shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
    });

    expect(written["isVisibleOnStatusPage"]).toBe(true);
    expect(
      written["shouldStatusPageSubscribersBeNotifiedOnIncidentCreated"],
    ).toBe(true);
  });

  test("an incident created without either switch is left to the column defaults", async () => {
    const written: Record<string, unknown> = await beforeCreate({});

    expect(written["isVisibleOnStatusPage"]).toBeUndefined();
    expect(written["isPrivate"]).toBeUndefined();
  });

  test('a Visible on Status Page sent as "false" is stored as false', async () => {
    const written: Record<string, unknown> = await beforeCreate({
      isVisibleOnStatusPage: "false",
    });

    expect(written["isVisibleOnStatusPage"]).toBe(false);
  });
});

/*
 * ----------------------------------------------------------------- episodes
 */

function storedEpisode(id: string, isPrivate: boolean): IncidentEpisode {
  const episode: IncidentEpisode = new IncidentEpisode();
  episode._id = id;
  episode.projectId = PROJECT_ID;
  episode.isVisibleOnStatusPage = false;
  episode.isPrivate = isPrivate;
  return episode;
}

describe("IncidentEpisodeService keeps a private episode hidden on update", () => {
  let stored: Array<IncidentEpisode>;
  let findBy: MockFunction;

  beforeEach(() => {
    stubProjectDirectory({});

    stored = [storedEpisode(PRIVATE_ID, true)];

    findBy = getJestMockFunction();
    findBy.mockImplementation(() => {
      return Promise.resolve(stored);
    });
    jest
      .spyOn(IncidentEpisodeService, "findBy")
      .mockImplementation(findBy as never);
  });

  async function beforeUpdate(
    data: Record<string, unknown>,
    query: Record<string, unknown> = { _id: PRIVATE_ID },
    props: DatabaseCommonInteractionProps = { isRoot: true },
  ): Promise<OnUpdate<IncidentEpisode>> {
    return await (
      IncidentEpisodeService as unknown as {
        onBeforeUpdate: OnBeforeUpdate<IncidentEpisode>;
      }
    ).onBeforeUpdate({
      query: query as never,
      data: data as never,
      props: props,
      limit: 1,
      skip: 0,
    });
  }

  function writtenBy(
    onUpdate: OnUpdate<IncidentEpisode>,
  ): Record<string, unknown> {
    return onUpdate.updateBy.data as unknown as Record<string, unknown>;
  }

  // The columns the database works out in each episode's own write.
  function rowWriteSql(
    onUpdate: OnUpdate<IncidentEpisode>,
  ): Dictionary<string> {
    return (
      IncidentEpisodeService as unknown as {
        getRowWriteSql: GetRowWriteSql;
      }
    ).getRowWriteSql(onUpdate.updateBy.data);
  }

  function rowColumns(onUpdate: OnUpdate<IncidentEpisode>): Array<string> {
    return Object.keys(rowWriteSql(onUpdate));
  }

  // What one episode is stored with in place of the update's own values.
  function rowOverrides(
    onUpdate: OnUpdate<IncidentEpisode>,
    row: IncidentEpisode,
  ): Record<string, unknown> {
    return storedInPlaceOfWritten(
      rowWriteSql(onUpdate),
      onUpdate.updateBy.data as unknown as Record<string, unknown>,
      row,
    );
  }

  function rowOf(id: string, isPrivate?: boolean): IncidentEpisode {
    const row: IncidentEpisode = new IncidentEpisode();
    row._id = id;
    if (isPrivate !== undefined) {
      row.isPrivate = isPrivate;
    }
    return row;
  }

  test("its Status Pages switch turned on writes a private episode with it off, in its own write", async () => {
    for (const value of [true, "true", "yes"] as Array<unknown>) {
      const onUpdate: OnUpdate<IncidentEpisode> = await beforeUpdate({
        isVisibleOnStatusPage: value,
      });

      expect(writtenBy(onUpdate)["isVisibleOnStatusPage"]).toBe(true);
      expect(rowColumns(onUpdate)).toEqual(["isVisibleOnStatusPage"]);
      expect(rowOverrides(onUpdate, rowOf(PRIVATE_ID, true))).toEqual({
        isVisibleOnStatusPage: false,
      });
    }
  });

  test("nothing is read for it before the write: each episode is decided in its own write", async () => {
    const onUpdate: OnUpdate<IncidentEpisode> = await beforeUpdate(
      { isVisibleOnStatusPage: true },
      { _id: PRIVATE_ID },
      MEMBER,
    );

    expect(findBy).not.toHaveBeenCalled();
    expect(onUpdate.carryForward).toBeNull();
  });

  test("a public episode turned on is shown", async () => {
    const onUpdate: OnUpdate<IncidentEpisode> = await beforeUpdate(
      { isVisibleOnStatusPage: true },
      { _id: PUBLIC_ID },
    );

    expect(writtenBy(onUpdate)["isVisibleOnStatusPage"]).toBe(true);
    expect(rowOverrides(onUpdate, rowOf(PUBLIC_ID, false))).toEqual({});
  });

  test("made private - as a privacy rule does - it is switched off with it, without a read", async () => {
    stored = [storedEpisode(PUBLIC_ID, false)];

    for (const value of [true, "true"] as Array<unknown>) {
      const onUpdate: OnUpdate<IncidentEpisode> = await beforeUpdate(
        { isPrivate: value },
        { _id: PUBLIC_ID },
      );

      expect(writtenBy(onUpdate)).toEqual(
        expect.objectContaining({
          isPrivate: true,
          isVisibleOnStatusPage: false,
        }),
      );
      expect(rowColumns(onUpdate)).toEqual([]);
    }

    expect(findBy).not.toHaveBeenCalled();
  });

  test("turned on and made not private in one write, it is shown", async () => {
    const onUpdate: OnUpdate<IncidentEpisode> = await beforeUpdate({
      isVisibleOnStatusPage: true,
      isPrivate: false,
    });

    expect(writtenBy(onUpdate)["isVisibleOnStatusPage"]).toBe(true);
    expect(rowColumns(onUpdate)).toEqual([]);
    expect(rowOverrides(onUpdate, rowOf(PRIVATE_ID, true))).toEqual({});
    expect(findBy).not.toHaveBeenCalled();
  });

  test("one write to private and public episodes shows the public ones, and writes each private one with the switch off, in its own write", async () => {
    const onUpdate: OnUpdate<IncidentEpisode> = await beforeUpdate(
      { isVisibleOnStatusPage: true },
      { projectId: PROJECT_ID },
    );

    expect(writtenBy(onUpdate)["isVisibleOnStatusPage"]).toBe(true);
    expect(rowOverrides(onUpdate, rowOf(PRIVATE_ID, true))).toEqual({
      isVisibleOnStatusPage: false,
    });
    expect(rowOverrides(onUpdate, rowOf(PUBLIC_ID, false))).toEqual({});
  });

  test("an episode whose privacy was not read is written as the write has it", async () => {
    const onUpdate: OnUpdate<IncidentEpisode> = await beforeUpdate(
      { isVisibleOnStatusPage: true },
      { projectId: PROJECT_ID },
    );

    expect(rowOverrides(onUpdate, rowOf(PRIVATE_ID))).toEqual({});
  });

  test("an update that does not turn the switch on, or that writes Private too, writes every episode as it is", async () => {
    for (const data of [
      { isVisibleOnStatusPage: false },
      { isVisibleOnStatusPage: true, isPrivate: false },
      { title: "Checkout errors" },
    ] as Array<Record<string, unknown>>) {
      const onUpdate: OnUpdate<IncidentEpisode> = await beforeUpdate(data, {
        projectId: PROJECT_ID,
      });

      expect(rowColumns(onUpdate)).toEqual([]);
      expect(rowOverrides(onUpdate, rowOf(PRIVATE_ID, true))).toEqual({});
    }
  });
});

describe("IncidentEpisodeService.onBeforeCreate creates a private episode hidden", () => {
  let groupingRule: IncidentGroupingRule | null;

  beforeEach(() => {
    stubProjectDirectory({});
    groupingRule = null;

    const createdState: IncidentState = new IncidentState();
    createdState._id = CREATED_STATE_ID;
    createdState.isCreatedState = true;
    createdState.order = 1;

    jest
      .spyOn(IncidentStateService, "findOneBy")
      .mockResolvedValue(createdState as never);
    jest
      .spyOn(IncidentStateService, "findBy")
      .mockResolvedValue([createdState] as never);
    jest
      .spyOn(ProjectService, "incrementAndGetIncidentEpisodeCounter")
      .mockResolvedValue({ counter: 3, prefix: undefined } as never);
    jest
      .spyOn(UserService, "getUserMarkdownString")
      .mockResolvedValue("a teammate" as never);
    jest
      .spyOn(IncidentGroupingRuleService, "findOneById")
      .mockImplementation((async () => {
        return groupingRule;
      }) as never);
  });

  async function beforeCreate(
    values: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const episode: IncidentEpisode = new IncidentEpisode();
    episode.title = "Checkout errors";

    for (const [key, value] of Object.entries(values)) {
      (episode as unknown as Record<string, unknown>)[key] = value;
    }

    const onCreate: OnCreate<IncidentEpisode> = await (
      IncidentEpisodeService as unknown as {
        onBeforeCreate: OnBeforeCreate<IncidentEpisode>;
      }
    ).onBeforeCreate({ data: episode, props: MEMBER });

    return onCreate.createBy.data as unknown as Record<string, unknown>;
  }

  test("created private, it is created hidden and announced to nobody", async () => {
    for (const value of [true, "true", "yes"] as Array<unknown>) {
      const written: Record<string, unknown> = await beforeCreate({
        isPrivate: value,
        isVisibleOnStatusPage: true,
        shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated: true,
      });

      expect(written["isPrivate"]).toBe(true);
      expect(written["isVisibleOnStatusPage"]).toBe(false);
      expect(
        written["shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated"],
      ).toBe(false);
    }
  });

  test("a public episode keeps its created notification", async () => {
    for (const isPrivate of [false, undefined]) {
      const written: Record<string, unknown> = await beforeCreate({
        isPrivate: isPrivate,
        isVisibleOnStatusPage: true,
        shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated: true,
      });

      expect(written["isVisibleOnStatusPage"]).toBe(true);
      expect(
        written["shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated"],
      ).toBe(true);
    }
  });

  test("a grouping rule that shows its episodes does not show a private one", async () => {
    groupingRule = new IncidentGroupingRule();
    groupingRule._id = GROUPING_RULE_ID;
    groupingRule.showEpisodeOnStatusPage = true;

    const written: Record<string, unknown> = await beforeCreate({
      isPrivate: true,
      incidentGroupingRuleId: new ObjectID(GROUPING_RULE_ID),
    });

    expect(written["isVisibleOnStatusPage"]).toBe(false);
    expect(
      written["shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated"],
    ).toBe(false);
  });

  test("a public episode keeps what the grouping rule gives it", async () => {
    groupingRule = new IncidentGroupingRule();
    groupingRule._id = GROUPING_RULE_ID;
    groupingRule.showEpisodeOnStatusPage = true;

    const written: Record<string, unknown> = await beforeCreate({
      incidentGroupingRuleId: new ObjectID(GROUPING_RULE_ID),
    });

    expect(written["isVisibleOnStatusPage"]).toBe(true);
  });
});
