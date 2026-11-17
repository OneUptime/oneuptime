jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

jest.mock("../../../Server/Utils/Logger");

import CommonAPI from "../../../Server/API/CommonAPI";
import WorkspaceNotificationRuleAPI from "../../../Server/API/WorkspaceNotificationRuleAPI";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import BaseNotificationRule from "../../../Types/Workspace/NotificationRules/BaseNotificationRule";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleUpdates, {
  NotificationRuleUpdateKind,
  NotificationRuleUpdatesChoice,
} from "../../../Types/Workspace/NotificationRules/NotificationRuleUpdates";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { mockRouter } from "../API/Helpers";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * A NEW ON-CALL RULE STARTS ON THE KEY UPDATES, HOWEVER IT IS MADE (#7971).
 *
 * The Dashboard's form starts a new on-call policy rule on Key updates only
 * - who is on call now, and when nobody is - and nothing else did: a rule
 * created through the API, or with the Terraform provider's
 * oneuptime_workspace_notification_rule, without updatesToPost posted every
 * hand-off, who is next, overrides, policy changes and owners.
 *
 * Here the rules go through the API's own create and update
 * (WorkspaceNotificationRuleAPI's createItem and updateItem), the hooks and
 * DatabaseService, with the table in memory, sent the JSON bodies the
 * Terraform provider sends: the configuration's notification_rule, as
 * written. The server gives a new on-call rule the key updates when its JSON
 * leaves updatesToPost out, keeps a list or a null the caller sent, and an
 * edit that leaves updatesToPost out keeps the updates the rule posts - so a
 * rule Terraform made does not turn to every update at its first change.
 * Every other kind of rule is stored as it is sent, as before.
 */

const { OnCallNow, OnCallNext, NobodyOnCall, Overrides, PublicNotes } =
  NotificationRuleUpdateKind;

const KEY_UPDATES: Array<NotificationRuleUpdateKind> = [
  OnCallNow,
  NobodyOnCall,
];

const PROJECT_ID: ObjectID = new ObjectID(
  "79710000-0000-4000-8000-000000000001",
);

const ROOT: DatabaseCommonInteractionProps = { isRoot: true };

// The rule's JSON as a Terraform configuration writes it: no updatesToPost.
function terraformRule(extra?: JSONObject | undefined): JSONObject {
  return {
    _type: "OnCallDutyPolicyNotificationRule",
    filterCondition: FilterCondition.All,
    filters: [],
    shouldPostToExistingChannel: true,
    existingChannelNames: "oncall",
    ...(extra || {}),
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * THROUGH THE API, AS TERRAFORM AND A SCRIPT CALL IT.
 */
describe("a rule created and edited through the API", () => {
  let table: InMemoryTable;
  let api: WorkspaceNotificationRuleAPI;

  beforeEach(() => {
    table = useInMemoryTable(WorkspaceNotificationRuleService, []);
    api = new WorkspaceNotificationRuleAPI();

    jest.spyOn(api, "assertProductIsOn").mockResolvedValue(undefined);
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(ROOT);
  });

  async function createRule(data: {
    eventType: NotificationRuleEventType;
    notificationRule: JSONObject;
  }): Promise<StoredRow> {
    await api.createItem(
      {
        body: {
          data: {
            name: "Rule from Terraform",
            projectId: PROJECT_ID.toString(),
            workspaceType: WorkspaceType.Slack,
            eventType: data.eventType,
            notificationRule: data.notificationRule,
          },
        },
        params: {},
        headers: {},
      } as unknown as ExpressRequest,
      {} as ExpressResponse,
    );

    expect(table.inserts).toHaveLength(1);

    return table.inserts[0]!;
  }

  async function editRule(data: {
    id: string;
    fields: JSONObject;
  }): Promise<void> {
    await api.updateItem(
      {
        body: { data: data.fields },
        params: { id: data.id },
        headers: {},
      } as unknown as ExpressRequest,
      {} as ExpressResponse,
    );
  }

  function storedRule(id: string): BaseNotificationRule {
    return table.get(id)!["notificationRule"] as BaseNotificationRule;
  }

  // A rule as stored, as the rows below start.
  function storedRow(data: {
    eventType: NotificationRuleEventType;
    notificationRule: JSONObject;
  }): StoredRow {
    return {
      _id: ObjectID.generate().toString(),
      projectId: PROJECT_ID.toString(),
      name: "Stored rule",
      workspaceType: WorkspaceType.Slack,
      eventType: data.eventType,
      notificationRule: data.notificationRule,
    };
  }

  test("REGRESSION: an on-call rule created without updatesToPost starts on Key updates only, as the Dashboard's does", async () => {
    const row: StoredRow = await createRule({
      eventType: NotificationRuleEventType.OnCallDutyPolicy,
      notificationRule: terraformRule(),
    });

    const rule: BaseNotificationRule = row[
      "notificationRule"
    ] as BaseNotificationRule;

    expect(rule.updatesToPost).toEqual(KEY_UPDATES);
    expect(rule.updatesToPost).toEqual(
      NotificationRuleUpdates.getNewRuleUpdatesToPost(
        NotificationRuleEventType.OnCallDutyPolicy,
      ),
    );
    expect(
      NotificationRuleUpdates.getChoice({
        rule: rule,
        eventType: NotificationRuleEventType.OnCallDutyPolicy,
      }),
    ).toBe(NotificationRuleUpdatesChoice.KeyUpdates);

    // ...so a hand-off is posted, and an override is not.
    expect(
      NotificationRuleUpdates.wantsUpdate({
        rule: rule,
        updateKinds: [OnCallNow],
      }),
    ).toBe(true);
    expect(
      NotificationRuleUpdates.wantsUpdate({
        rule: rule,
        updateKinds: [Overrides],
      }),
    ).toBe(false);
  });

  test("what Terraform sent is all still there, as sent: the provider's plan sees no change", async () => {
    const sent: JSONObject = terraformRule({
      filters: [
        {
          checkOn: "On-Call Policy",
          conditionType: "Contains Any",
          value: [ObjectID.generate().toString()],
        },
      ],
    });

    const row: StoredRow = await createRule({
      eventType: NotificationRuleEventType.OnCallDutyPolicy,
      notificationRule: sent,
    });

    /*
     * The provider's JSONSubsetType reads a rule's JSON as unchanged when
     * every value its configuration wrote comes back as written, and the
     * server may add keys of its own (Scripts/TerraformProvider/StaticFiles
     * /jsonsubset.go): updatesToPost is the one key added.
     */
    expect(isJsonSubset(sent, row["notificationRule"] as JSONValue)).toBe(true);
    expect(
      Object.keys(row["notificationRule"] as JSONObject).filter(
        (key: string): boolean => {
          return !(key in sent);
        },
      ),
    ).toEqual(["updatesToPost"]);
  });

  test("a list sent with the rule is kept, an empty one too", async () => {
    for (const updatesToPost of [
      [OnCallNext, Overrides],
      [] as Array<NotificationRuleUpdateKind>,
    ]) {
      table = useInMemoryTable(WorkspaceNotificationRuleService, []);

      const row: StoredRow = await createRule({
        eventType: NotificationRuleEventType.OnCallDutyPolicy,
        notificationRule: terraformRule({ updatesToPost }),
      });

      expect(
        (row["notificationRule"] as BaseNotificationRule).updatesToPost,
      ).toEqual(updatesToPost);
    }
  });

  test("null asks for every update: it is stored as sent, so Terraform reads back what it wrote", async () => {
    const sent: JSONObject = terraformRule({ updatesToPost: null });

    const row: StoredRow = await createRule({
      eventType: NotificationRuleEventType.OnCallDutyPolicy,
      notificationRule: sent,
    });

    const rule: BaseNotificationRule = row[
      "notificationRule"
    ] as BaseNotificationRule;

    expect(rule.updatesToPost).toBeNull();
    expect(isJsonSubset(sent, rule as unknown as JSONValue)).toBe(true);
    expect(
      NotificationRuleUpdates.getChoice({
        rule: rule,
        eventType: NotificationRuleEventType.OnCallDutyPolicy,
      }),
    ).toBe(NotificationRuleUpdatesChoice.EveryUpdate);
  });

  test("an incident rule created without updatesToPost posts every update, as before", async () => {
    const row: StoredRow = await createRule({
      eventType: NotificationRuleEventType.Incident,
      notificationRule: terraformRule({ _type: "IncidentNotificationRule" }),
    });

    expect(row["notificationRule"]).not.toHaveProperty("updatesToPost");
  });

  test("REGRESSION: an edit that leaves updatesToPost out keeps the key updates of a rule Terraform made", async () => {
    const row: StoredRow = await createRule({
      eventType: NotificationRuleEventType.OnCallDutyPolicy,
      notificationRule: terraformRule(),
    });
    const id: string = String(row["_id"]);

    // The configuration changed its channel: the provider sends its JSON.
    await editRule({
      id: id,
      fields: {
        notificationRule: terraformRule({ existingChannelNames: "on-call" }),
      },
    });

    expect(storedRule(id).existingChannelNames).toBe("on-call");
    expect(storedRule(id).updatesToPost).toEqual(KEY_UPDATES);
  });

  test("an edit keeps any list the rule posts, and an edit that sends one writes it", async () => {
    const row: StoredRow = storedRow({
      eventType: NotificationRuleEventType.OnCallDutyPolicy,
      notificationRule: terraformRule({ updatesToPost: [OnCallNext] }),
    });
    table = useInMemoryTable(WorkspaceNotificationRuleService, [row]);
    const id: string = String(row["_id"]);

    await editRule({ id: id, fields: { notificationRule: terraformRule() } });
    expect(storedRule(id).updatesToPost).toEqual([OnCallNext]);

    await editRule({
      id: id,
      fields: {
        notificationRule: terraformRule({ updatesToPost: [Overrides] }),
      },
    });
    expect(storedRule(id).updatesToPost).toEqual([Overrides]);
  });

  test("an edit that sends null makes the rule post every update, and keeps it so", async () => {
    const row: StoredRow = storedRow({
      eventType: NotificationRuleEventType.OnCallDutyPolicy,
      notificationRule: terraformRule({ updatesToPost: KEY_UPDATES }),
    });
    table = useInMemoryTable(WorkspaceNotificationRuleService, [row]);
    const id: string = String(row["_id"]);

    await editRule({
      id: id,
      fields: { notificationRule: terraformRule({ updatesToPost: null }) },
    });
    expect(storedRule(id).updatesToPost).toBeNull();

    await editRule({ id: id, fields: { notificationRule: terraformRule() } });
    expect(storedRule(id).updatesToPost).toBeNull();
  });

  test("an on-call rule saved before rules chose their updates is never changed: it goes on posting every update", async () => {
    const row: StoredRow = storedRow({
      eventType: NotificationRuleEventType.OnCallDutyPolicy,
      notificationRule: terraformRule(),
    });
    table = useInMemoryTable(WorkspaceNotificationRuleService, [row]);
    const id: string = String(row["_id"]);

    await editRule({ id: id, fields: { name: "Renamed" } });
    expect(storedRule(id)).not.toHaveProperty("updatesToPost");

    await editRule({
      id: id,
      fields: {
        notificationRule: terraformRule({ existingChannelNames: "x" }),
      },
    });
    expect(storedRule(id)).not.toHaveProperty("updatesToPost");
    expect(
      NotificationRuleUpdates.getChoice({
        rule: storedRule(id),
        eventType: NotificationRuleEventType.OnCallDutyPolicy,
      }),
    ).toBe(NotificationRuleUpdatesChoice.EveryUpdate);
  });

  test("an incident rule's edit is written as it is sent, as before: left out is every update", async () => {
    const row: StoredRow = storedRow({
      eventType: NotificationRuleEventType.Incident,
      notificationRule: terraformRule({
        _type: "IncidentNotificationRule",
        updatesToPost: [PublicNotes],
      }),
    });
    table = useInMemoryTable(WorkspaceNotificationRuleService, [row]);
    const id: string = String(row["_id"]);

    await editRule({
      id: id,
      fields: {
        notificationRule: terraformRule({ _type: "IncidentNotificationRule" }),
      },
    });

    expect(storedRule(id)).not.toHaveProperty("updatesToPost");
  });
});

/*
 * THE HOOKS, FOR WHAT AN EDIT READS AND WHAT IT REFUSES.
 */
type Hooks = {
  onBeforeCreate: (
    createBy: CreateBy<WorkspaceNotificationRule>,
  ) => Promise<OnCreate<WorkspaceNotificationRule>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<WorkspaceNotificationRule>,
  ) => Promise<OnUpdate<WorkspaceNotificationRule>>;
};

const hooks: Hooks = WorkspaceNotificationRuleService as unknown as Hooks;

describe("what an edit of a rule's JSON reads, and keeps", () => {
  let heldRules: Array<{
    eventType: NotificationRuleEventType;
    notificationRule: JSONObject;
  }>;
  let heldRowsRead: SpyInstance<
    typeof WorkspaceNotificationRuleService.findRowsAndHoldUpdateToThem
  >;

  beforeEach(() => {
    heldRules = [];

    heldRowsRead = jest
      .spyOn(WorkspaceNotificationRuleService, "findRowsAndHoldUpdateToThem")
      .mockImplementation(
        async (): Promise<Array<WorkspaceNotificationRule>> => {
          return heldRules.map(
            (held: {
              eventType: NotificationRuleEventType;
              notificationRule: JSONObject;
            }): WorkspaceNotificationRule => {
              const rule: WorkspaceNotificationRule =
                new WorkspaceNotificationRule();
              rule.eventType = held.eventType;
              rule.notificationRule =
                held.notificationRule as unknown as BaseNotificationRule;
              return rule;
            },
          );
        },
      );
  });

  async function update(
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const updateBy: UpdateBy<WorkspaceNotificationRule> = {
      query: { _id: ObjectID.generate() },
      data: data,
      props: ROOT,
    } as unknown as UpdateBy<WorkspaceNotificationRule>;

    await hooks.onBeforeUpdate(updateBy);

    return updateBy.data as unknown as Record<string, unknown>;
  }

  test("an edit that says which updates to post is written as sent, without reading the rule's JSON", async () => {
    heldRules = [
      {
        eventType: NotificationRuleEventType.OnCallDutyPolicy,
        notificationRule: terraformRule({ updatesToPost: KEY_UPDATES }),
      },
    ];

    for (const updatesToPost of [[OnCallNext], [], null]) {
      const written: Record<string, unknown> = await update({
        notificationRule: terraformRule({ updatesToPost }),
      });

      expect(
        (written["notificationRule"] as BaseNotificationRule).updatesToPost,
      ).toEqual(updatesToPost);
    }

    // A list is checked against the rule's kind, which is all that is read.
    for (const call of heldRowsRead.mock.calls) {
      expect(call[1]).not.toHaveProperty("notificationRule");
    }
  });

  test("an edit that sends a kind which starts on every update reads nothing, and is written as sent", async () => {
    const written: Record<string, unknown> = await update({
      eventType: NotificationRuleEventType.Incident,
      notificationRule: terraformRule(),
    });

    expect(heldRowsRead).not.toHaveBeenCalled();
    expect(written["notificationRule"]).not.toHaveProperty("updatesToPost");
  });

  test("an edit that writes no JSON reads nothing", async () => {
    await update({ name: "Renamed" });

    expect(heldRowsRead).not.toHaveBeenCalled();
  });

  test("an edit that leaves updatesToPost out reads the rule, and keeps what it posts", async () => {
    heldRules = [
      {
        eventType: NotificationRuleEventType.OnCallDutyPolicy,
        notificationRule: terraformRule({ updatesToPost: KEY_UPDATES }),
      },
    ];

    const written: Record<string, unknown> = await update({
      notificationRule: terraformRule(),
    });

    expect(heldRowsRead).toHaveBeenCalledTimes(1);
    expect(
      (written["notificationRule"] as BaseNotificationRule).updatesToPost,
    ).toEqual(KEY_UPDATES);
  });

  test("an edit that makes an incident rule an on-call rule starts it on the key updates", async () => {
    heldRules = [
      {
        eventType: NotificationRuleEventType.Incident,
        notificationRule: terraformRule({ updatesToPost: [PublicNotes] }),
      },
    ];

    const written: Record<string, unknown> = await update({
      eventType: NotificationRuleEventType.OnCallDutyPolicy,
      notificationRule: terraformRule(),
    });

    expect(
      (written["notificationRule"] as BaseNotificationRule).updatesToPost,
    ).toEqual(KEY_UPDATES);
  });

  test("an edit of several rules that post the same updates keeps them", async () => {
    heldRules = [
      {
        eventType: NotificationRuleEventType.OnCallDutyPolicy,
        notificationRule: terraformRule({
          updatesToPost: [NobodyOnCall, OnCallNow],
        }),
      },
      {
        eventType: NotificationRuleEventType.OnCallDutyPolicy,
        notificationRule: terraformRule({ updatesToPost: KEY_UPDATES }),
      },
    ];

    const written: Record<string, unknown> = await update({
      notificationRule: terraformRule(),
    });

    expect(
      (written["notificationRule"] as BaseNotificationRule).updatesToPost,
    ).toEqual([NobodyOnCall, OnCallNow]);
  });

  test("an edit of several rules that post different updates is refused, with what to send", async () => {
    heldRules = [
      {
        eventType: NotificationRuleEventType.OnCallDutyPolicy,
        notificationRule: terraformRule({ updatesToPost: KEY_UPDATES }),
      },
      {
        eventType: NotificationRuleEventType.OnCallDutyPolicy,
        notificationRule: terraformRule(),
      },
    ];

    await expect(update({ notificationRule: terraformRule() })).rejects.toThrow(
      new BadDataException(
        "This edit writes one notificationRule to on-call policy rules that post different updates, and leaves updatesToPost out. Send updatesToPost with it (null for every update), or edit the rules one at a time.",
      ),
    );
  });

  test("a create is given the key updates by its hook, whoever creates it", async () => {
    const rule: WorkspaceNotificationRule = new WorkspaceNotificationRule();
    rule.projectId = PROJECT_ID;
    rule.eventType = NotificationRuleEventType.OnCallDutyPolicy;
    rule.notificationRule = terraformRule() as unknown as BaseNotificationRule;

    const created: OnCreate<WorkspaceNotificationRule> =
      await hooks.onBeforeCreate({
        data: rule,
        props: ROOT,
      } as CreateBy<WorkspaceNotificationRule>);

    expect(created.createBy.data.notificationRule?.updatesToPost).toEqual(
      KEY_UPDATES,
    );
  });
});

/*
 * The JSON subset the Terraform provider's JSONSubsetType reads as no change
 * (Scripts/TerraformProvider/StaticFiles/jsonsubset.go, jsonIsSubset): every
 * key the plan has is in the actual JSON with a subset value, lists of the
 * same length compared in order, and every other value equal.
 */
function isJsonSubset(plan: JSONValue, actual: JSONValue): boolean {
  if (Array.isArray(plan)) {
    return (
      Array.isArray(actual) &&
      plan.length === actual.length &&
      plan.every((value: JSONValue, index: number): boolean => {
        return isJsonSubset(value, actual[index] as JSONValue);
      })
    );
  }

  if (plan && typeof plan === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) {
      return false;
    }

    return Object.keys(plan).every((key: string): boolean => {
      return (
        key in (actual as JSONObject) &&
        isJsonSubset(
          (plan as JSONObject)[key] as JSONValue,
          (actual as JSONObject)[key] as JSONValue,
        )
      );
    });
  }

  return plan === actual;
}
