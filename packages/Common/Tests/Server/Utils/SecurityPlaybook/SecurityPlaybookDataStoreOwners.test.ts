import DataStore from "../../../../Models/DatabaseModels/DataStore";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import { SecurityCaseFeedEventType } from "../../../../Models/DatabaseModels/SecurityCaseFeed";
import User from "../../../../Models/DatabaseModels/User";
import DataStoreService from "../../../../Server/Services/DataStoreService";
import MailService from "../../../../Server/Services/MailService";
import DataSecurityIntegrations from "../../../../Server/Utils/DataSecurity/DataSecurityIntegrations";
import RuleRecordScope from "../../../../Server/Utils/Rules/RuleRecordScope";
import SecurityPlaybookActions, {
  PlaybookStepContext,
  PlaybookStepOutcome,
} from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookActions";
import {
  MAX_NOTIFIED_DATA_STORES,
  buildDataStoreOwnersMessage,
  getCaseDataStoreKeys,
} from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookDataStoreOwners";
import Includes from "../../../../Types/BaseDatabase/Includes";
import DataSensitivity from "../../../../Types/DataSecurity/DataSensitivity";
import Email from "../../../../Types/Email";
import EmailTemplateType from "../../../../Types/Email/EmailTemplateType";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  SecurityEntity,
  SecurityEntityType,
} from "../../../../Types/SecurityCase/SecurityEntity";
import {
  SecurityPlaybookActionType,
  doesActionNeedApprovalByDefault,
  getSecurityPlaybookAction,
} from "../../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import { SecurityPlaybookStepStatus } from "../../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import {
  SecurityPlaybookStep,
  parseSecurityPlaybookSteps,
} from "../../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import { SecurityCaseTemplateValues } from "../../../../Utils/SecurityCase/SecurityCaseMarkdown";
import { getJestSpyOn } from "../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Notify data store owners: for each data store a case names, its owners as
 * Data Security lists them are emailed - each person once, naming the
 * stores of theirs the case is about, its sensitivity and the way to the
 * case, and nothing else of the case. A store without an owner is named in
 * the step's details; a case about no store, or whose stores have no
 * owner, skips the step.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "78787878-7878-4878-8878-787878787878",
);
const CASE_ID: ObjectID = new ObjectID("89898989-8989-4989-8989-898989898989");

const CARDS_KEY: string = "cloud:aws:AWS S3 Bucket:arn:aws:s3:::cards";
const ORDERS_KEY: string = "cloud:aws:AWS S3 Bucket:arn:aws:s3:::orders";
const LOGS_KEY: string = "telemetry:5f0c2a4e:Logs";

const VALUES: SecurityCaseTemplateValues = {
  number: "SEC-12",
  title: "A sensitive bucket was made public",
  priority: "High",
  status: "New",
  assignee: "Unassigned",
  url: "https://oneuptime.example/dashboard/p/security-events/cases/12",
  entities: "data-store:cards, alice, 203.0.113.9",
  detections: "1",
};

function dataStore(
  storeKey: string,
  name: string,
  sensitivity: DataSensitivity,
): DataStore {
  const model: DataStore = new DataStore();
  model._id = ObjectID.generate().toString();
  model.projectId = PROJECT_ID;
  model.storeKey = storeKey;
  model.name = name;
  model.sensitivity = sensitivity;
  return model;
}

function user(name: string): User {
  const model: User = new User();
  model._id = ObjectID.generate().toString();
  model.name = name as never;
  model.email = new Email(`${name}@acme.example`);
  return model;
}

const CARDS: DataStore = dataStore(
  CARDS_KEY,
  "cards",
  DataSensitivity.Restricted,
);
const ORDERS: DataStore = dataStore(
  ORDERS_KEY,
  "orders",
  DataSensitivity.Confidential,
);
const LOGS: DataStore = dataStore(
  LOGS_KEY,
  "checkout logs",
  DataSensitivity.Internal,
);

const ALICE: User = user("alice");
const BOB: User = user("bob");
const MALLORY: User = user("mallory");

function context(
  entities: Array<SecurityEntity>,
  config: JSONObject = {},
): PlaybookStepContext {
  const securityCase: SecurityCase = new SecurityCase();
  securityCase._id = CASE_ID.toString();
  securityCase.projectId = PROJECT_ID;
  securityCase.caseNumberWithPrefix = "SEC-12";
  securityCase.title = VALUES.title;
  securityCase.entities = entities as unknown as JSONArray;

  return {
    projectId: PROJECT_ID,
    runId: ObjectID.generate(),
    playbookName: "Tell the owners",
    stepNumber: 1,
    securityCase,
    step: {
      id: "s1",
      action: SecurityPlaybookActionType.NotifyDataStoreOwners,
      config,
      requiresApproval: false,
      continueOnFailure: false,
      onlyIfThreatIntelMatched: false,
    },
  };
}

function storeEntity(storeKey: string): SecurityEntity {
  return {
    type: SecurityEntityType.DataStore,
    value: `data-store:${storeKey}`,
  };
}

type Spy = ReturnType<typeof getJestSpyOn>;

let owners: Map<string, Array<User>>;
let members: Set<string>;
let sent: Array<{ mail: JSONObject; options: JSONObject }>;
let sendMail: Spy;

beforeEach(() => {
  owners = new Map([
    [CARDS.id!.toString(), [ALICE, BOB]],
    [ORDERS.id!.toString(), [ALICE]],
    [LOGS.id!.toString(), []],
  ]);
  members = new Set([ALICE.id!.toString(), BOB.id!.toString()]);
  sent = [];

  getJestSpyOn(SecurityPlaybookActions, "getTemplateValues").mockResolvedValue(
    VALUES as never,
  );
  getJestSpyOn(DataStoreService, "findBy").mockImplementation((async (args: {
    query: { storeKey?: Includes; _id?: Includes };
  }) => {
    const wanted: Array<string> = (
      (args.query.storeKey || args.query._id)?.values || []
    ).map((value: unknown): string => {
      return String(value);
    });

    return [CARDS, ORDERS, LOGS].filter((store: DataStore): boolean => {
      return args.query.storeKey
        ? wanted.includes(store.storeKey!)
        : wanted.includes(store.id!.toString());
    });
  }) as never);
  getJestSpyOn(DataSecurityIntegrations, "getOwnerUsers").mockImplementation(
    (async (dataStoreId: ObjectID) => {
      return owners.get(dataStoreId.toString()) || [];
    }) as never,
  );
  getJestSpyOn(RuleRecordScope, "keepIdsInProject").mockImplementation(
    (async (data: { ids: Array<string> }) => {
      return data.ids.filter((id: string): boolean => {
        return members.has(id);
      });
    }) as never,
  );
  sendMail = getJestSpyOn(MailService, "sendMail").mockImplementation((async (
    mail: JSONObject,
    options: JSONObject,
  ) => {
    sent.push({ mail, options });
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function run(step: PlaybookStepContext): Promise<PlaybookStepOutcome> {
  return await SecurityPlaybookActions.execute(step);
}

describe("the step", () => {
  test("is a Notify step that cuts nobody off and starts without approval", () => {
    const definition: ReturnType<typeof getSecurityPlaybookAction> =
      getSecurityPlaybookAction(
        SecurityPlaybookActionType.NotifyDataStoreOwners,
      );

    expect(definition).toMatchObject({
      title: "Notify data store owners",
      category: "Notify",
      isDisruptive: false,
    });
    expect(definition?.entityType).toBeUndefined();
    expect(doesActionNeedApprovalByDefault(definition)).toBe(false);
  });

  test("keeps a message of the playbook's own, held to a length, and needs nothing else", () => {
    const [plain, withMessage]: Array<SecurityPlaybookStep> =
      parseSecurityPlaybookSteps([
        {
          action: SecurityPlaybookActionType.NotifyDataStoreOwners,
          config: {},
        },
        {
          action: SecurityPlaybookActionType.NotifyDataStoreOwners,
          config: { message: "  Lock it down.  ", userIds: ["x"] },
        },
      ]);

    expect(plain!.config).toEqual({});
    expect(plain!.requiresApproval).toBe(false);
    expect(withMessage!.config).toEqual({ message: "Lock it down." });
    expect(() => {
      return parseSecurityPlaybookSteps([
        {
          action: SecurityPlaybookActionType.NotifyDataStoreOwners,
          config: { message: "x".repeat(10001) },
        },
      ]);
    }).toThrow(/the message is longer than 10000 characters/);
  });
});

describe("Notify data store owners", () => {
  test("emails each owner once, naming the stores of theirs the case is about", async () => {
    const outcome: PlaybookStepOutcome = await run(
      context([
        storeEntity(CARDS_KEY),
        { type: SecurityEntityType.User, value: "alice" },
        { type: SecurityEntityType.IpAddress, value: "203.0.113.9" },
        storeEntity(ORDERS_KEY),
      ]),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(outcome.summary.toString()).toBe(
      "Emailed 2 owners of 2 data stores.",
    );
    expect(outcome.feedEventType).toBe(SecurityCaseFeedEventType.Notification);
    expect(outcome.detailsInMarkdown).toBeUndefined();

    // One email each: Alice owns both stores, Bob the cards.
    expect(sendMail).toHaveBeenCalledTimes(2);

    const toAlice: { mail: JSONObject; options: JSONObject } = sent.find(
      (entry: { mail: JSONObject }): boolean => {
        return (
          (entry.mail["toEmail"] as Email).toString() === "alice@acme.example"
        );
      },
    )!;

    expect(toAlice.mail).toMatchObject({
      templateType: EmailTemplateType.SimpleMessage,
      subject: "[SEC-12] A sensitive bucket was made public",
      isSubjectLiteral: true,
    });
    expect(toAlice.options).toMatchObject({
      projectId: PROJECT_ID,
      userId: ALICE.id,
    });

    const html: string = String(
      (toAlice.mail["vars"] as JSONObject)["message"],
    );

    expect(html).toContain("cards");
    expect(html).toContain("Restricted data");
    expect(html).toContain("orders");
    expect(html).toContain("Confidential data");
    expect(html).toContain(VALUES.url);
    // Nothing else of the case: its other entities stay on the case.
    expect(html).not.toContain("203.0.113.9");

    const toBob: { mail: JSONObject } = sent.find(
      (entry: { mail: JSONObject }): boolean => {
        return (
          (entry.mail["toEmail"] as Email).toString() === "bob@acme.example"
        );
      },
    )!;
    const bobsHtml: string = String(
      (toBob.mail["vars"] as JSONObject)["message"],
    );

    expect(bobsHtml).toContain("cards");
    expect(bobsHtml).not.toContain("orders");
  });

  test("skips a store without owners, and names it in the details", async () => {
    const outcome: PlaybookStepOutcome = await run(
      context([storeEntity(CARDS_KEY), storeEntity(LOGS_KEY)]),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(outcome.summary.toString()).toBe(
      "Emailed 2 owners of 1 data store.",
    );
    expect(outcome.detailsInMarkdown?.toString()).toBe(
      "- **checkout logs** (Internal data) has no owner.",
    );
    expect(
      sent
        .map((entry: { mail: JSONObject }): string => {
          return String((entry.mail["vars"] as JSONObject)["message"]);
        })
        .some((html: string): boolean => {
          return html.includes("checkout logs");
        }),
    ).toBe(false);
  });

  test("is skipped when no store of the case has an owner", async () => {
    owners.set(CARDS.id!.toString(), []);

    const outcome: PlaybookStepOutcome = await run(
      context([storeEntity(CARDS_KEY), storeEntity(LOGS_KEY)]),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Skipped);
    expect(outcome.summary.toString()).toBe(
      "No owner to email: none of the 2 data stores the case is about has one.",
    );
    expect(sendMail).not.toHaveBeenCalled();
  });

  test("is skipped when the case names no data store, and reads none", async () => {
    const outcome: PlaybookStepOutcome = await run(
      context([{ type: SecurityEntityType.User, value: "alice" }]),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Skipped);
    expect(outcome.summary.toString()).toBe("The case names no data store.");
    expect(DataStoreService.findBy).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  test("is skipped when the stores it names are gone", async () => {
    const outcome: PlaybookStepOutcome = await run(
      context([storeEntity("cloud:aws:AWS S3 Bucket:arn:aws:s3:::deleted")]),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Skipped);
    expect(sendMail).not.toHaveBeenCalled();
  });

  test("never emails an owner who has left the project", async () => {
    owners.set(CARDS.id!.toString(), [ALICE, MALLORY]);

    await run(context([storeEntity(CARDS_KEY)]));

    expect(
      sent.map((entry: { mail: JSONObject }): string => {
        return (entry.mail["toEmail"] as Email).toString();
      }),
    ).toEqual(["alice@acme.example"]);
  });

  test("leads with the playbook's own message, the case put in", async () => {
    await run(
      context([storeEntity(CARDS_KEY)], {
        message: "Please lock your bucket down: {{case.number}}.",
      }),
    );

    const html: string = String(
      (sent[0]!.mail["vars"] as JSONObject)["message"],
    );

    expect(html).toContain("Please lock your bucket down: SEC-12.");
    expect(html).toContain("cards");
  });

  test("fails when no email could be sent, and says why", async () => {
    sendMail.mockRejectedValue(new Error("SMTP is down") as never);

    const outcome: PlaybookStepOutcome = await run(
      context([storeEntity(CARDS_KEY)]),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Failed);
    expect(outcome.error).toContain("SMTP is down");
  });

  test("says who could not be emailed when some could", async () => {
    sendMail.mockImplementation((async (mail: JSONObject) => {
      if ((mail["toEmail"] as Email).toString() === "bob@acme.example") {
        throw new Error("mailbox full");
      }
    }) as never);

    const outcome: PlaybookStepOutcome = await run(
      context([storeEntity(CARDS_KEY)]),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(outcome.summary.toString()).toBe(
      "Emailed 1 owner of 1 data store; 1 could not be emailed.",
    );
    expect(outcome.detailsInMarkdown?.toString()).toContain(
      "bob@acme.example: mailbox full",
    );
  });

  test("finds a store an older case kept as Other, and one named by its id", async () => {
    await run(
      context([
        {
          type: SecurityEntityType.Other,
          value: `data-store:${CARDS_KEY}`,
        },
        {
          type: SecurityEntityType.DataStore,
          value: `data-store:${ORDERS.id!.toString()}`,
        },
      ]),
    );

    // Alice owns both, so one email names both stores.
    expect(sent).toHaveLength(2);

    const toAlice: string = String(
      (
        sent.find((entry: { mail: JSONObject }): boolean => {
          return (
            (entry.mail["toEmail"] as Email).toString() === "alice@acme.example"
          );
        })!.mail["vars"] as JSONObject
      )["message"],
    );

    expect(toAlice).toContain("cards");
    expect(toAlice).toContain("orders");
  });
});

describe("the stores a case names", () => {
  test("each once, in the case's order, at most MAX_NOTIFIED_DATA_STORES", () => {
    const many: Array<SecurityEntity> = [];

    for (let index: number = 0; index < MAX_NOTIFIED_DATA_STORES + 5; index++) {
      many.push(storeEntity(`manual:${index}`));
    }

    expect(
      getCaseDataStoreKeys([
        storeEntity(ORDERS_KEY),
        { type: SecurityEntityType.Host, value: "web-01" },
        storeEntity(CARDS_KEY),
        storeEntity(ORDERS_KEY),
      ]),
    ).toEqual([ORDERS_KEY, CARDS_KEY]);
    expect(getCaseDataStoreKeys(many)).toHaveLength(MAX_NOTIFIED_DATA_STORES);
  });

  test("an email names a store's name and sensitivity, and the case, as text", () => {
    expect(
      buildDataStoreOwnersMessage({
        values: { ...VALUES, title: "*Bold* [link](https://evil.example)" },
        stores: [ORDERS],
      }).toString(),
    ).toBe(
      [
        "Security case **SEC-12**, \\*Bold\\* \\[link\\](https://evil.example), is about a data store you own:",
        "- **orders** (Confidential data)",
        `[Open the case](${VALUES.url})`,
      ].join("\n\n"),
    );
  });
});
