/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it, and DatabaseService imports it.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import MessageQueueLabelRuleEngineService from "../../../Server/Services/MessageQueueLabelRuleEngineService";
import MessageQueueLabelRuleService from "../../../Server/Services/MessageQueueLabelRuleService";
import MessageQueueOwnerRuleEngineService from "../../../Server/Services/MessageQueueOwnerRuleEngineService";
import MessageQueueOwnerRuleService from "../../../Server/Services/MessageQueueOwnerRuleService";
import MessageQueueOwnerTeamService from "../../../Server/Services/MessageQueueOwnerTeamService";
import MessageQueueOwnerUserService from "../../../Server/Services/MessageQueueOwnerUserService";
import MessageQueueService from "../../../Server/Services/MessageQueueService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import logger from "../../../Server/Utils/Logger";
import {
  RuleApplicationResult,
  RuleApplicationResultUtil,
} from "../../../Server/Utils/Rules/RuleRun/RuleApplication";
import Label from "../../../Models/DatabaseModels/Label";
import MessageQueue from "../../../Models/DatabaseModels/MessageQueue";
import MessageQueueLabelRule from "../../../Models/DatabaseModels/MessageQueueLabelRule";
import MessageQueueOwnerRule from "../../../Models/DatabaseModels/MessageQueueOwnerRule";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import ObjectID from "../../../Types/ObjectID";
import RuleCriteria, {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../../Utils/Rules/RuleEngineLimits";
import { getJestSpyOn } from "../../Spy";

/*
 * The queue label and owner rule engines.
 *
 * Mechanical copies of the Databases engines, pinned on their own so the
 * Queues-specific parts cannot drift:
 *   - the criteria fields are messageQueueLabels / messageQueueNamePattern /
 *     messageQueueDescriptionPattern / messageQueueSystemPattern, both as
 *     legacy columns and as configurable criteria;
 *   - a queue's name is its destination and says nothing about the broker,
 *     so the SYSTEM pattern is how a person says "every Kafka topic" - and it
 *     matches the canonical messaging.system value and the display name
 *     alike;
 *   - "Run now" (applyRulesToExistingResource) reports what it did and never
 *     throws; the create hook never throws either;
 *   - what a rule adds is recorded as automatic, so it never keeps a stale
 *     discovered queue from being archived.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const QUEUE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const RULE_ID: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");
const LABEL_A: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const LABEL_B: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const USER_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const TEAM_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");

function ref<T>(id: ObjectID): T {
  return { id: id, _id: id.toString() } as unknown as T;
}

// The queue as a run (or the create hook) hands it over: ids only.
function target(): MessageQueue {
  return {
    id: QUEUE_ID,
    _id: QUEUE_ID.toString(),
    projectId: PROJECT_ID,
  } as unknown as MessageQueue;
}

// The row the engines re-read to match on.
function details(
  overrides: {
    name?: string;
    description?: string;
    messagingSystem?: string;
    labels?: Array<ObjectID>;
  } = {},
): MessageQueue {
  return {
    id: QUEUE_ID,
    _id: QUEUE_ID.toString(),
    projectId: PROJECT_ID,
    name: overrides.name ?? "orders.created",
    description: overrides.description ?? "Order events from checkout",
    messagingSystem: overrides.messagingSystem ?? "kafka",
    labels: (overrides.labels || []).map((id: ObjectID) => {
      return ref<Label>(id);
    }),
  } as unknown as MessageQueue;
}

function criteria(
  field: string,
  operator: RuleCriteriaOperator,
  value: any,
): RuleCriteria {
  return {
    schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
    filterCondition: FilterCondition.All,
    filters: [{ field: field, operator: operator, value: value }],
  };
}

function labelRule(
  data: {
    namePattern?: string;
    descriptionPattern?: string;
    systemPattern?: string;
    matchLabels?: Array<ObjectID>;
    labelsToAdd?: Array<ObjectID>;
    criteria?: RuleCriteria;
  } = {},
): MessageQueueLabelRule {
  return {
    id: RULE_ID,
    _id: RULE_ID.toString(),
    name: "Tag every Kafka topic",
    criteria: data.criteria,
    messageQueueNamePattern: data.namePattern,
    messageQueueDescriptionPattern: data.descriptionPattern,
    messageQueueSystemPattern: data.systemPattern,
    messageQueueLabels: (data.matchLabels || []).map((id: ObjectID) => {
      return ref<Label>(id);
    }),
    labelsToAdd: (data.labelsToAdd || [LABEL_A]).map((id: ObjectID) => {
      return ref<Label>(id);
    }),
  } as unknown as MessageQueueLabelRule;
}

function ownerRule(
  data: {
    namePattern?: string;
    systemPattern?: string;
    notifyOwners?: boolean;
    criteria?: RuleCriteria;
  } = {},
): MessageQueueOwnerRule {
  return {
    id: RULE_ID,
    _id: RULE_ID.toString(),
    projectId: PROJECT_ID,
    name: "Kafka owners",
    criteria: data.criteria,
    notifyOwners: data.notifyOwners,
    messageQueueNamePattern: data.namePattern,
    messageQueueSystemPattern: data.systemPattern ?? "^kafka$",
    ownerUsers: [ref(USER_ID)],
    ownerTeams: [ref(TEAM_ID)],
  } as unknown as MessageQueueOwnerRule;
}

let errorSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;
let record: jest.SpyInstance;

beforeEach(() => {
  errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
  warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {
    return undefined as never;
  });
  jest.spyOn(logger, "debug").mockImplementation(() => {
    return undefined as never;
  });
  record = getJestSpyOn(
    MessageQueueService,
    "recordAutomaticAssignments",
  ).mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("MessageQueueLabelRuleEngineService", () => {
  let findDetails: jest.SpyInstance;
  let findRules: jest.SpyInstance;
  let writes: Array<{
    entity: unknown;
    relation: string;
    of: string;
    ids: Array<string>;
  }>;

  function arrange(
    data: {
      details?: MessageQueue | null;
      rules?: Array<MessageQueueLabelRule>;
      failWrite?: boolean;
    } = {},
  ): void {
    writes = [];
    let entity: unknown = null;
    let relation: string = "";
    let of: string = "";
    const builder: any = {
      createQueryBuilder: () => {
        return builder;
      },
      relation: (target: unknown, name: string) => {
        entity = target;
        relation = name;
        return builder;
      },
      of: (id: string) => {
        of = id;
        return builder;
      },
      add: async (ids: Array<string>) => {
        if (data.failWrite) {
          throw new Error("duplicate key value violates unique constraint");
        }
        writes.push({
          entity: entity,
          relation: relation,
          of: of,
          ids: [...ids],
        });
      },
    };
    getJestSpyOn(MessageQueueService, "getRepository").mockReturnValue(builder);
    findDetails = getJestSpyOn(
      MessageQueueService,
      "findOneById",
    ).mockResolvedValue(data.details === undefined ? details() : data.details);
    findRules = getJestSpyOn(
      MessageQueueLabelRuleService,
      "findBy",
    ).mockResolvedValue(data.rules || []);
  }

  function run(
    rules: Array<MessageQueueLabelRule>,
  ): Promise<RuleApplicationResult> {
    return MessageQueueLabelRuleEngineService.applyRulesToExistingResource({
      resource: target(),
      rules: rules,
      allowOwnerNotification: false,
    });
  }

  test("reads the queue criteria fields - criteria included", () => {
    expect(MessageQueueLabelRuleEngineService.ruleSelect).toEqual({
      _id: true,
      name: true,
      criteria: true,
      messageQueueLabels: { _id: true },
      messageQueueNamePattern: true,
      messageQueueDescriptionPattern: true,
      messageQueueSystemPattern: true,
      labelsToAdd: { _id: true },
    });
    expect(MessageQueueLabelRuleEngineService.resourceSelectForRuleRun).toEqual(
      { _id: true, projectId: true },
    );
  });

  test("on create: reads the project's enabled rules, capped, and applies them", async () => {
    arrange({ rules: [labelRule({ systemPattern: "^kafka$" })] });
    const resource: MessageQueue = target();

    await MessageQueueLabelRuleEngineService.applyRulesToMessageQueue(resource);

    const findBy: any = findRules.mock.calls[0]![0];
    expect(findBy.query.projectId).toBe(PROJECT_ID);
    expect(findBy.query.isEnabled).toBe(true);
    expect(findBy.limit).toBe(MAX_RULES_EVALUATED_PER_PROJECT);
    expect(findBy.skip).toBe(0);
    expect(findBy.select).toBe(MessageQueueLabelRuleEngineService.ruleSelect);
    expect(findBy.props.isRoot).toBe(true);

    expect(writes).toEqual([
      {
        entity: MessageQueue,
        relation: "labels",
        of: QUEUE_ID.toString(),
        ids: [LABEL_A.toString()],
      },
    ]);
    // Synced in memory, so the owner engine that runs next can match on it.
    expect(
      (resource.labels || []).map((label: Label) => {
        return label.id!.toString();
      }),
    ).toEqual([LABEL_A.toString()]);
  });

  test("re-reads exactly the columns evaluation matches on", async () => {
    arrange();

    await run([labelRule({ systemPattern: "kafka" })]);

    const reRead: any = findDetails.mock.calls[0]![0];
    expect(reRead.id).toBe(QUEUE_ID);
    expect(reRead.select).toEqual({
      name: true,
      description: true,
      messagingSystem: true,
      labels: { _id: true },
    });
    expect(reRead.props).toEqual({ isRoot: true });
  });

  test("on create with no rules: no re-read, no write", async () => {
    arrange({ rules: [] });

    await MessageQueueLabelRuleEngineService.applyRulesToMessageQueue(target());

    expect(findDetails).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  test("a queue without an id or project is never evaluated", async () => {
    arrange({ rules: [labelRule()] });

    await MessageQueueLabelRuleEngineService.applyRulesToMessageQueue({
      projectId: PROJECT_ID,
    } as unknown as MessageQueue);

    expect(findRules).not.toHaveBeenCalled();
    await expect(
      MessageQueueLabelRuleEngineService.applyRulesToExistingResource({
        resource: { id: QUEUE_ID } as unknown as MessageQueue,
        rules: [labelRule()],
        allowOwnerNotification: false,
      }),
    ).resolves.toEqual(RuleApplicationResultUtil.noMatch());
  });

  describe("the messaging system pattern", () => {
    test.each([
      ["^kafka$", "kafka", true],
      ["Kafka", "kafka", true],
      ["^Apache Kafka$", "kafka", true],
      ["amazon", "aws_sqs", true],
      ["^aws_sqs$", "aws_sqs", true],
      ["^kafka$", "rabbitmq", false],
      ["Service Bus", "servicebus", true],
      ["^servicebus$", "eventhubs", false],
      // A refined ActiveMQ queue is matched as ActiveMQ, not by its JMS family.
      ["activemq", "activemq", true],
      ["^jms$", "activemq", false],
      // A long-tail system is matched as stored.
      ["^ibmmq$", "ibmmq", true],
    ])(
      "%p against a %p queue matches: %p",
      async (pattern: string, system: string, matches: boolean) => {
        arrange({ details: details({ messagingSystem: system }) });

        const result: RuleApplicationResult = await run([
          labelRule({ systemPattern: pattern }),
        ]);

        expect(result).toEqual(
          matches
            ? RuleApplicationResultUtil.updated(1)
            : RuleApplicationResultUtil.noMatch(),
        );
      },
    );

    test("configurable criteria on the system field: Equals by value or by display name", async () => {
      arrange({ details: details({ messagingSystem: "rabbitmq" }) });

      await expect(
        run([
          labelRule({
            criteria: criteria(
              "messageQueueSystemPattern",
              RuleCriteriaOperator.Equals,
              "rabbitmq",
            ),
          }),
        ]),
      ).resolves.toEqual(RuleApplicationResultUtil.updated(1));

      arrange({ details: details({ messagingSystem: "rabbitmq" }) });
      await expect(
        run([
          labelRule({
            criteria: criteria(
              "messageQueueSystemPattern",
              RuleCriteriaOperator.Equals,
              "RabbitMQ",
            ),
          }),
        ]),
      ).resolves.toEqual(RuleApplicationResultUtil.updated(1));
    });

    test("configurable criteria: NotEquals excludes the system under either spelling", async () => {
      for (const value of ["kafka", "Apache Kafka"]) {
        arrange({ details: details({ messagingSystem: "kafka" }) });

        await expect(
          run([
            labelRule({
              criteria: criteria(
                "messageQueueSystemPattern",
                RuleCriteriaOperator.NotEquals,
                value,
              ),
            }),
          ]),
        ).resolves.toEqual(RuleApplicationResultUtil.noMatch());
      }

      arrange({ details: details({ messagingSystem: "rabbitmq" }) });
      await expect(
        run([
          labelRule({
            criteria: criteria(
              "messageQueueSystemPattern",
              RuleCriteriaOperator.NotEquals,
              "kafka",
            ),
          }),
        ]),
      ).resolves.toEqual(RuleApplicationResultUtil.updated(1));
    });

    test("a system pattern combines with a name pattern - both must match", async () => {
      arrange();

      await expect(
        run([
          labelRule({ systemPattern: "^kafka$", namePattern: "^payments" }),
        ]),
      ).resolves.toEqual(RuleApplicationResultUtil.noMatch());

      arrange();
      await expect(
        run([
          labelRule({ systemPattern: "^kafka$", namePattern: "^orders\\." }),
        ]),
      ).resolves.toEqual(RuleApplicationResultUtil.updated(1));
    });

    test("an invalid system regex never matches and never throws", async () => {
      arrange();

      await expect(run([labelRule({ systemPattern: "([" })])).resolves.toEqual(
        RuleApplicationResultUtil.noMatch(),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Invalid regex in queue label rule"),
      );
    });
  });

  test("a name pattern matches the destination-named queue", async () => {
    arrange();

    await expect(
      run([labelRule({ namePattern: "^orders\\." })]),
    ).resolves.toEqual(RuleApplicationResultUtil.updated(1));

    arrange({ details: details({ name: "payments.settled" }) });
    await expect(
      run([labelRule({ namePattern: "^orders\\." })]),
    ).resolves.toEqual(RuleApplicationResultUtil.noMatch());
  });

  test("matches on labels and description too", async () => {
    arrange({ details: details({ labels: [LABEL_B] }) });

    const result: RuleApplicationResult = await run([
      labelRule({
        matchLabels: [LABEL_B],
        descriptionPattern: "checkout",
        labelsToAdd: [LABEL_A],
      }),
    ]);

    expect(result).toEqual(RuleApplicationResultUtil.updated(1));
  });

  test("a description pattern never matches a queue without a description", async () => {
    arrange({ details: details({ description: "" }) });

    await expect(
      run([labelRule({ descriptionPattern: ".*" })]),
    ).resolves.toEqual(RuleApplicationResultUtil.noMatch());
  });

  test("a label prerequisite the queue lacks is no match", async () => {
    arrange({ details: details({ labels: [LABEL_A] }) });

    await expect(
      run([labelRule({ matchLabels: [LABEL_B], labelsToAdd: [LABEL_B] })]),
    ).resolves.toEqual(RuleApplicationResultUtil.noMatch());
  });

  test("configurable criteria take over from stale legacy columns", async () => {
    arrange();

    const result: RuleApplicationResult = await run([
      labelRule({
        systemPattern: "^rabbitmq$",
        criteria: criteria(
          "messageQueueNamePattern",
          RuleCriteriaOperator.Contains,
          "orders",
        ),
      }),
    ]);

    expect(result).toEqual(RuleApplicationResultUtil.updated(1));
  });

  test("criteria on a field the queue rules do not have never match", async () => {
    arrange();

    await expect(
      run([
        labelRule({
          criteria: criteria(
            "databaseServerNamePattern",
            RuleCriteriaOperator.Contains,
            "orders",
          ),
        }),
      ]),
    ).resolves.toEqual(RuleApplicationResultUtil.noMatch());
  });

  test("only missing labels are added, and they are recorded as automatic", async () => {
    arrange({ details: details({ labels: [LABEL_A] }) });

    const result: RuleApplicationResult = await run([
      labelRule({ systemPattern: "kafka", labelsToAdd: [LABEL_A, LABEL_B] }),
    ]);

    expect(result).toEqual(RuleApplicationResultUtil.updated(1));
    expect(writes[0]!.ids).toEqual([LABEL_B.toString()]);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({
      messageQueueId: QUEUE_ID,
      kind: "labelIds",
      ids: [LABEL_B.toString()],
    });
  });

  test("the union of every matching rule's labels lands in one write", async () => {
    arrange({
      rules: [
        labelRule({ systemPattern: "kafka", labelsToAdd: [LABEL_A] }),
        labelRule({ namePattern: "orders", labelsToAdd: [LABEL_A, LABEL_B] }),
        labelRule({ systemPattern: "^rabbitmq$", labelsToAdd: [LABEL_B] }),
      ],
    });

    await MessageQueueLabelRuleEngineService.applyRulesToMessageQueue(target());

    expect(writes).toHaveLength(1);
    expect(writes[0]!.ids).toEqual([LABEL_A.toString(), LABEL_B.toString()]);
  });

  test("a failed label write records nothing as automatic", async () => {
    arrange({ failWrite: true });

    await run([labelRule({ systemPattern: "kafka" })]);

    expect(record).not.toHaveBeenCalled();
  });

  test("every label already present: matched, nothing written", async () => {
    arrange({ details: details({ labels: [LABEL_A] }) });

    await expect(run([labelRule({ systemPattern: "kafka" })])).resolves.toEqual(
      RuleApplicationResultUtil.alreadyApplied(),
    );
    expect(writes).toHaveLength(0);
    expect(record).not.toHaveBeenCalled();
  });

  test("a matching rule that adds no labels is already applied", async () => {
    arrange();

    await expect(
      run([labelRule({ systemPattern: "kafka", labelsToAdd: [] })]),
    ).resolves.toEqual(RuleApplicationResultUtil.alreadyApplied());
  });

  test("a queue deleted before its turn is no match", async () => {
    arrange({ details: null });

    await expect(run([labelRule({ systemPattern: "kafka" })])).resolves.toEqual(
      RuleApplicationResultUtil.noMatch(),
    );
  });

  test("a failed write is reported as failed, not thrown", async () => {
    arrange({ failWrite: true });

    await expect(run([labelRule({ systemPattern: "kafka" })])).resolves.toEqual(
      RuleApplicationResultUtil.failed(),
    );
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  test("the create hook swallows failures - a label never breaks a create", async () => {
    arrange({
      rules: [labelRule({ systemPattern: "kafka" })],
      failWrite: true,
    });

    await expect(
      MessageQueueLabelRuleEngineService.applyRulesToMessageQueue(target()),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});

describe("MessageQueueOwnerRuleEngineService", () => {
  let findRules: jest.SpyInstance;
  let createOwnerUser: jest.SpyInstance;
  let createOwnerTeam: jest.SpyInstance;
  let ownerUserRead: jest.SpyInstance;

  function arrange(
    data: {
      rules?: Array<MessageQueueOwnerRule>;
      details?: MessageQueue | null;
      assignedUserIds?: Array<ObjectID>;
    } = {},
  ): void {
    findRules = getJestSpyOn(
      MessageQueueOwnerRuleService,
      "findBy",
    ).mockResolvedValue(data.rules || []);
    getJestSpyOn(MessageQueueService, "findOneById").mockResolvedValue(
      data.details === undefined ? details() : data.details,
    );
    ownerUserRead = getJestSpyOn(
      MessageQueueOwnerUserService,
      "findBy",
    ).mockResolvedValue(
      (data.assignedUserIds || []).map((id: ObjectID) => {
        return {
          getColumnValue: (key: string) => {
            return key === "userId" ? id : undefined;
          },
        };
      }),
    );
    getJestSpyOn(MessageQueueOwnerTeamService, "findBy").mockResolvedValue([]);
    createOwnerUser = getJestSpyOn(
      MessageQueueOwnerUserService,
      "create",
    ).mockResolvedValue({});
    createOwnerTeam = getJestSpyOn(
      MessageQueueOwnerTeamService,
      "create",
    ).mockResolvedValue({});
    getJestSpyOn(TeamMemberService, "isUserMemberOfProject").mockResolvedValue(
      true,
    );
  }

  test("reads the queue criteria fields and the owners to add", () => {
    expect(MessageQueueOwnerRuleEngineService.ruleSelect).toEqual({
      _id: true,
      name: true,
      criteria: true,
      notifyOwners: true,
      messageQueueLabels: { _id: true },
      messageQueueNamePattern: true,
      messageQueueDescriptionPattern: true,
      messageQueueSystemPattern: true,
      ownerUsers: { _id: true },
      ownerTeams: { _id: true },
    });
    expect(MessageQueueOwnerRuleEngineService.resourceSelectForRuleRun).toEqual(
      { _id: true, projectId: true },
    );
  });

  test("on create: adds the matching rule's owners to this queue, to be notified", async () => {
    arrange({ rules: [ownerRule()] });

    await MessageQueueOwnerRuleEngineService.applyRulesToMessageQueue(target());

    const findBy: any = findRules.mock.calls[0]![0];
    expect(findBy.query.isEnabled).toBe(true);
    expect(findBy.limit).toBe(MAX_RULES_EVALUATED_PER_PROJECT);
    expect(findBy.select).toBe(MessageQueueOwnerRuleEngineService.ruleSelect);

    const user: any = createOwnerUser.mock.calls[0]![0];
    expect(user.data.messageQueueId).toBe(QUEUE_ID);
    expect(user.data.projectId).toBe(PROJECT_ID);
    expect(user.data.userId.toString()).toBe(USER_ID.toString());
    // Not yet notified - the notifier picks it up.
    expect(user.data.isOwnerNotified).toBe(false);
    expect(user.props).toEqual({ isRoot: true });

    const team: any = createOwnerTeam.mock.calls[0]![0];
    expect(team.data.messageQueueId).toBe(QUEUE_ID);
    expect(team.data.teamId.toString()).toBe(TEAM_ID.toString());
  });

  test("looks up existing owners by messageQueueId and never duplicates one", async () => {
    arrange({ assignedUserIds: [USER_ID] });

    const result: RuleApplicationResult =
      await MessageQueueOwnerRuleEngineService.applyRulesToExistingResource({
        resource: target(),
        rules: [ownerRule()],
        allowOwnerNotification: true,
      });

    expect(ownerUserRead.mock.calls[0]![0].query.messageQueueId).toBe(QUEUE_ID);
    expect(createOwnerUser).not.toHaveBeenCalled();
    expect(createOwnerTeam).toHaveBeenCalledTimes(1);
    expect(result).toEqual(RuleApplicationResultUtil.updated(1));
  });

  test("the owners a rule adds are recorded as automatic - users and teams", async () => {
    arrange({ rules: [ownerRule()] });

    await MessageQueueOwnerRuleEngineService.applyRulesToMessageQueue(target());

    expect(record).toHaveBeenCalledWith({
      messageQueueId: QUEUE_ID,
      kind: "ownerUserIds",
      ids: [USER_ID.toString()],
    });
    expect(record).toHaveBeenCalledWith({
      messageQueueId: QUEUE_ID,
      kind: "ownerTeamIds",
      ids: [TEAM_ID.toString()],
    });
  });

  test("an owner who was already there - maybe added by a person - is not recorded as automatic", async () => {
    arrange({ assignedUserIds: [USER_ID] });

    await MessageQueueOwnerRuleEngineService.applyRulesToExistingResource({
      resource: target(),
      rules: [ownerRule()],
      allowOwnerNotification: true,
    });

    const userCall: any = record.mock.calls.find((call: any) => {
      return call[0].kind === "ownerUserIds";
    });
    expect(userCall[0].ids).toEqual([]);
    const teamCall: any = record.mock.calls.find((call: any) => {
      return call[0].kind === "ownerTeamIds";
    });
    expect(teamCall[0].ids).toEqual([TEAM_ID.toString()]);
  });

  test("an owner insert that did not happen is not recorded", async () => {
    arrange({ rules: [ownerRule()] });
    createOwnerUser.mockRejectedValue(
      Object.assign(new Error("duplicate key value"), { code: "23505" }),
    );

    await MessageQueueOwnerRuleEngineService.applyRulesToMessageQueue(target());

    const userCall: any = record.mock.calls.find((call: any) => {
      return call[0].kind === "ownerUserIds";
    });
    expect(userCall[0].ids).toEqual([]);
  });

  test("a run that does not allow notifications adds owners silently", async () => {
    arrange();

    await MessageQueueOwnerRuleEngineService.applyRulesToExistingResource({
      resource: target(),
      rules: [ownerRule({ notifyOwners: true })],
      allowOwnerNotification: false,
    });

    expect(createOwnerUser.mock.calls[0]![0].data.isOwnerNotified).toBe(true);
    expect(createOwnerTeam.mock.calls[0]![0].data.isOwnerNotified).toBe(true);
  });

  test("a rule with notifications off adds owners silently even when the run allows them", async () => {
    arrange();

    await MessageQueueOwnerRuleEngineService.applyRulesToExistingResource({
      resource: target(),
      rules: [ownerRule({ notifyOwners: false })],
      allowOwnerNotification: true,
    });

    expect(createOwnerUser.mock.calls[0]![0].data.isOwnerNotified).toBe(true);
  });

  test("a system pattern that names another broker adds nobody", async () => {
    arrange({ details: details({ messagingSystem: "rabbitmq" }) });

    await expect(
      MessageQueueOwnerRuleEngineService.applyRulesToExistingResource({
        resource: target(),
        rules: [ownerRule()],
        allowOwnerNotification: true,
      }),
    ).resolves.toEqual(RuleApplicationResultUtil.noMatch());
    expect(createOwnerUser).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  test("the system pattern also matches the display name", async () => {
    arrange({ details: details({ messagingSystem: "aws_sqs" }) });

    await expect(
      MessageQueueOwnerRuleEngineService.applyRulesToExistingResource({
        resource: target(),
        rules: [ownerRule({ systemPattern: "^Amazon SQS$" })],
        allowOwnerNotification: true,
      }),
    ).resolves.toEqual(RuleApplicationResultUtil.updated(2));
  });

  test("label criteria see rule-added labels", async () => {
    arrange({ details: details({ labels: [LABEL_A] }) });

    await expect(
      MessageQueueOwnerRuleEngineService.applyRulesToExistingResource({
        resource: target(),
        rules: [
          ownerRule({
            systemPattern: "",
            criteria: criteria(
              "messageQueueLabels",
              RuleCriteriaOperator.HasAllOf,
              [LABEL_A.toString()],
            ),
          }),
        ],
        allowOwnerNotification: true,
      }),
    ).resolves.toEqual(RuleApplicationResultUtil.updated(2));
  });

  test("a matching rule with no owners is already applied", async () => {
    arrange();
    const rule: MessageQueueOwnerRule = ownerRule();
    rule.ownerUsers = [];
    rule.ownerTeams = [];

    await expect(
      MessageQueueOwnerRuleEngineService.applyRulesToExistingResource({
        resource: target(),
        rules: [rule],
        allowOwnerNotification: true,
      }),
    ).resolves.toEqual(RuleApplicationResultUtil.alreadyApplied());
    expect(createOwnerUser).not.toHaveBeenCalled();
  });

  test("a failing re-read is reported as failed, never thrown", async () => {
    arrange();
    getJestSpyOn(MessageQueueService, "findOneById").mockRejectedValue(
      new Error("database is down"),
    );

    await expect(
      MessageQueueOwnerRuleEngineService.applyRulesToExistingResource({
        resource: target(),
        rules: [ownerRule()],
        allowOwnerNotification: true,
      }),
    ).resolves.toEqual(RuleApplicationResultUtil.failed());
  });

  test("the create hook never throws", async () => {
    arrange({ rules: [ownerRule()] });
    createOwnerTeam.mockRejectedValue(new Error("connection terminated"));

    await expect(
      MessageQueueOwnerRuleEngineService.applyRulesToMessageQueue(target()),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });
});
