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
 *     is leaves a private record hidden: the write is made with it off when
 *     every record it writes is private, and each private record is written
 *     with it off, in its own write, when only some are
 *     (getRowWriteOverrides);
 *   - both switches are stored as the database stores them, so a
 *     hand-written "true" counts;
 *   - creating a private incident creates it hidden, and tells nobody it
 *     was created.
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
type GetRowWriteOverrides<T extends BaseModel> = (data: {
  row: T;
  data: unknown;
  carryForward: unknown;
}) => unknown;

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

describe("IncidentService.onBeforeUpdate keeps a private incident hidden", () => {
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

  test("turning Visible on Status Page on, alone, leaves a private incident hidden", async () => {
    const onUpdate: OnUpdate<Incident> = await beforeUpdate({
      isVisibleOnStatusPage: true,
    });

    expect(writtenBy(onUpdate)["isVisibleOnStatusPage"]).toBe(false);
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

      expect(writtenBy(onUpdate)["isVisibleOnStatusPage"]).toBe(false);
    },
  );

  test("reads whether it is private in the one stored read, as root", async () => {
    await beforeUpdate({ isVisibleOnStatusPage: true });

    const reads: Array<Record<string, unknown>> = findBy.mock.calls.map(
      (call: Array<unknown>): Record<string, unknown> => {
        return call[0] as Record<string, unknown>;
      },
    );

    const privacyReads: Array<Record<string, unknown>> = reads.filter(
      (read: Record<string, unknown>): boolean => {
        return Boolean(
          (read["select"] as Record<string, unknown> | undefined)?.[
            "isPrivate"
          ],
        );
      },
    );

    expect(privacyReads).toHaveLength(1);
    expect(privacyReads[0]!["props"]).toEqual({ isRoot: true });
  });

  test("a public incident turned on is shown", async () => {
    stored = [storedIncident(PUBLIC_ID, false)];

    const onUpdate: OnUpdate<Incident> = await beforeUpdate(
      { isVisibleOnStatusPage: true },
      { query: { _id: PUBLIC_ID } },
    );

    expect(writtenBy(onUpdate)["isVisibleOnStatusPage"]).toBe(true);
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
    expect(writtenBy(onUpdate)["isVisibleOnStatusPage"]).toBe(false);
  });

  test("an update that writes neither switch reads nothing for them and adds neither", async () => {
    const onUpdate: OnUpdate<Incident> = await beforeUpdate({});

    expect(writtenBy(onUpdate)).not.toHaveProperty("isVisibleOnStatusPage");
    expect(writtenBy(onUpdate)).not.toHaveProperty("isPrivate");
    expect(findBy).not.toHaveBeenCalled();
  });

  describe("one write to many incidents, some private (a workflow's Update Many)", () => {
    beforeEach(() => {
      stored = [
        storedIncident(PRIVATE_ID, true),
        storedIncident(PUBLIC_ID, false),
      ];
    });

    function rowOverrides(
      onUpdate: OnUpdate<Incident>,
      row: Incident,
    ): Record<string, unknown> {
      return (
        IncidentService as unknown as {
          getRowWriteOverrides: GetRowWriteOverrides<Incident>;
        }
      ).getRowWriteOverrides({
        row: row,
        data: onUpdate.updateBy.data,
        carryForward: onUpdate.carryForward,
      }) as Record<string, unknown>;
    }

    function rowOf(id: string, isPrivate?: boolean): Incident {
      const row: Incident = new Incident();
      row._id = id;
      if (isPrivate !== undefined) {
        row.isPrivate = isPrivate;
      }
      return row;
    }

    test("the update shows the public ones, and records each one's privacy from the one stored read", async () => {
      const onUpdate: OnUpdate<Incident> = await beforeUpdate(
        { isVisibleOnStatusPage: true },
        { query: { projectId: PROJECT_ID } },
      );

      expect(writtenBy(onUpdate)["isVisibleOnStatusPage"]).toBe(true);

      const carryForward: Record<string, { isPrivateBeforeUpdate?: boolean }> =
        onUpdate.carryForward as never;

      expect(carryForward[PRIVATE_ID]?.isPrivateBeforeUpdate).toBe(true);
      expect(carryForward[PUBLIC_ID]?.isPrivateBeforeUpdate).toBe(false);
    });

    test("each private one is written with Visible on Status Page off, in its own write; the public one as the update has it", async () => {
      const onUpdate: OnUpdate<Incident> = await beforeUpdate(
        { isVisibleOnStatusPage: true },
        { query: { projectId: PROJECT_ID } },
      );

      expect(rowOverrides(onUpdate, rowOf(PRIVATE_ID))).toEqual({
        isVisibleOnStatusPage: false,
      });
      expect(rowOverrides(onUpdate, rowOf(PUBLIC_ID))).toEqual({});
    });

    test("an incident the stored read did not see is decided by the privacy the update loaded with it", async () => {
      const onUpdate: OnUpdate<Incident> = await beforeUpdate(
        { isVisibleOnStatusPage: true },
        { query: { projectId: PROJECT_ID } },
      );

      const unseenId: string = "0193c0de-1111-4aaa-8bbb-0000000000a9";

      expect(rowOverrides(onUpdate, rowOf(unseenId, true))).toEqual({
        isVisibleOnStatusPage: false,
      });
      expect(rowOverrides(onUpdate, rowOf(unseenId, false))).toEqual({});
      // Privacy not loaded either: left to the read rule.
      expect(rowOverrides(onUpdate, rowOf(unseenId))).toEqual({});
    });

    test("when every incident it writes is private, the update itself is written hidden, and no row needs more", async () => {
      stored = [
        storedIncident(PRIVATE_ID, true),
        storedIncident("0193c0de-1111-4aaa-8bbb-0000000000a3", true),
      ];

      const onUpdate: OnUpdate<Incident> = await beforeUpdate(
        { isVisibleOnStatusPage: true },
        { query: { projectId: PROJECT_ID } },
      );

      expect(writtenBy(onUpdate)["isVisibleOnStatusPage"]).toBe(false);
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

describe("IncidentEpisodeService.onBeforeUpdate keeps a private episode hidden", () => {
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

  test("its Status Pages switch turned on leaves a private episode hidden", async () => {
    const onUpdate: OnUpdate<IncidentEpisode> = await beforeUpdate({
      isVisibleOnStatusPage: true,
    });

    expect(writtenBy(onUpdate)["isVisibleOnStatusPage"]).toBe(false);
    expect(onUpdate.carryForward).toEqual({
      isPrivateBeforeUpdate: { [PRIVATE_ID]: true },
    });
  });

  test("reads the episode's privacy as root, within the caller's project", async () => {
    await beforeUpdate(
      { isVisibleOnStatusPage: true },
      { _id: PRIVATE_ID },
      MEMBER,
    );

    expect(findBy).toHaveBeenCalledTimes(1);

    const read: Record<string, unknown> = findBy.mock.calls[0]![0] as Record<
      string,
      unknown
    >;

    expect(read["props"]).toEqual({ isRoot: true });
    expect(read["select"]).toEqual({ _id: true, isPrivate: true });
    expect((read["query"] as Record<string, unknown>)["projectId"]).toEqual(
      PROJECT_ID,
    );
  });

  test("a public episode turned on is shown", async () => {
    stored = [storedEpisode(PUBLIC_ID, false)];

    const onUpdate: OnUpdate<IncidentEpisode> = await beforeUpdate(
      { isVisibleOnStatusPage: true },
      { _id: PUBLIC_ID },
    );

    expect(writtenBy(onUpdate)["isVisibleOnStatusPage"]).toBe(true);
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
    }

    expect(findBy).not.toHaveBeenCalled();
  });

  test("turned on and made not private in one write, it is shown", async () => {
    const onUpdate: OnUpdate<IncidentEpisode> = await beforeUpdate({
      isVisibleOnStatusPage: true,
      isPrivate: false,
    });

    expect(writtenBy(onUpdate)["isVisibleOnStatusPage"]).toBe(true);
    expect(findBy).not.toHaveBeenCalled();
  });

  function rowOverrides(
    onUpdate: OnUpdate<IncidentEpisode>,
    row: IncidentEpisode,
  ): Record<string, unknown> {
    return (
      IncidentEpisodeService as unknown as {
        getRowWriteOverrides: GetRowWriteOverrides<IncidentEpisode>;
      }
    ).getRowWriteOverrides({
      row: row,
      data: onUpdate.updateBy.data,
      carryForward: onUpdate.carryForward,
    }) as Record<string, unknown>;
  }

  function rowOf(id: string, isPrivate?: boolean): IncidentEpisode {
    const row: IncidentEpisode = new IncidentEpisode();
    row._id = id;
    if (isPrivate !== undefined) {
      row.isPrivate = isPrivate;
    }
    return row;
  }

  test("one write to private and public episodes shows the public ones, and writes each private one with the switch off, in its own write", async () => {
    stored = [storedEpisode(PRIVATE_ID, true), storedEpisode(PUBLIC_ID, false)];

    const onUpdate: OnUpdate<IncidentEpisode> = await beforeUpdate(
      { isVisibleOnStatusPage: true },
      { projectId: PROJECT_ID },
    );

    expect(writtenBy(onUpdate)["isVisibleOnStatusPage"]).toBe(true);
    expect(onUpdate.carryForward).toEqual({
      isPrivateBeforeUpdate: { [PRIVATE_ID]: true, [PUBLIC_ID]: false },
    });

    expect(rowOverrides(onUpdate, rowOf(PRIVATE_ID))).toEqual({
      isVisibleOnStatusPage: false,
    });
    expect(rowOverrides(onUpdate, rowOf(PUBLIC_ID))).toEqual({});
  });

  test("an episode the read did not see is decided by the privacy the update loaded with it", async () => {
    stored = [storedEpisode(PUBLIC_ID, false)];

    const onUpdate: OnUpdate<IncidentEpisode> = await beforeUpdate(
      { isVisibleOnStatusPage: true },
      { projectId: PROJECT_ID },
    );

    const unseenId: string = "0193c0de-1111-4aaa-8bbb-0000000000a9";

    expect(rowOverrides(onUpdate, rowOf(unseenId, true))).toEqual({
      isVisibleOnStatusPage: false,
    });
    expect(rowOverrides(onUpdate, rowOf(unseenId, false))).toEqual({});
    expect(rowOverrides(onUpdate, rowOf(unseenId))).toEqual({});
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

  test("created private, it is created hidden", async () => {
    for (const value of [true, "true", "yes"] as Array<unknown>) {
      const written: Record<string, unknown> = await beforeCreate({
        isPrivate: value,
        isVisibleOnStatusPage: true,
      });

      expect(written["isPrivate"]).toBe(true);
      expect(written["isVisibleOnStatusPage"]).toBe(false);
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
