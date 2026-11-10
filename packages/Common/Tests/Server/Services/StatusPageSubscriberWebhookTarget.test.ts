import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import ProjectService from "../../../Server/Services/ProjectService";
import StatusPagePrivateUserService from "../../../Server/Services/StatusPagePrivateUserService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageSubscriberService from "../../../Server/Services/StatusPageSubscriberService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ProjectReferenceCheck from "../../../Server/Utils/Database/ProjectReferenceCheck";
import {
  SIGN_UP_PRIVATE_NETWORK_HINT,
  SIGNED_UP_SUBSCRIBER_PRIVATE_NETWORK_HINT,
} from "../../../Server/Utils/StatusPageSubscriberWebhook";
import { WEBHOOK_PRIVATE_NETWORK_HINT } from "../../../Server/Utils/SSRFProtection";
import URL from "../../../Types/API/URL";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { stubRowsCallerMayWrite } from "../TestingUtils/RowsCallerMayWrite";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import dns from "dns";

jest.mock("../../../Server/Utils/Logger");

/*
 * A STATUS PAGE WEBHOOK SUBSCRIBER'S URL, CHECKED WHEN IT IS WRITTEN, BY WHO
 * WROTE IT (issue #6589).
 *
 * StatusPageSubscriberService checks the webhook of every new subscriber and
 * of every change to one, with the rule StatusPageSubscriberWebhookUtil gives
 * it - the same rule each send is held to:
 *
 *   - a visitor signing up on the status page (createFromStatusPageSignUp)
 *     gets public addresses only, however the instance is configured, and is
 *     told to use a public URL - never about the instance's settings, nor
 *     what DNS answered for a host name;
 *   - the team adding a subscriber (the dashboard, an API key, a workflow;
 *     an anonymous create is refused before the hook) may reach private
 *     addresses once the operator allows them, and is told which settings
 *     would when they do not;
 *   - a change of a subscriber's webhook is held to that subscriber's rule,
 *     whoever makes it: a sign-up's webhook stays public. Before this a
 *     change was not checked at all, and every send to it failed later.
 *
 * The real SSRFProtection runs; DNS and the database are stood in for.
 */

const ALLOW_ENV: string = "ALLOW_PRIVATE_NETWORK_WEBHOOKS";
const ALLOWLIST_ENV: string = "PRIVATE_NETWORK_WEBHOOK_ALLOWLIST";
const EGRESS_ENV: Array<string> = [
  ALLOW_ENV,
  ALLOWLIST_ENV,
  "BILLING_ENABLED",
  "DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES",
];

const PROJECT_ID: ObjectID = new ObjectID(
  "5e000000-0000-4000-8000-000000000001",
);
const PAGE_ID: ObjectID = new ObjectID("5e000000-0000-4000-8000-000000000002");
const OTHER_PAGE_ID: ObjectID = new ObjectID(
  "5e000000-0000-4000-8000-000000000003",
);
const SUBSCRIBER_ID: ObjectID = new ObjectID(
  "5e000000-0000-4000-8000-000000000004",
);
const OTHER_SUBSCRIBER_ID: ObjectID = new ObjectID(
  "5e000000-0000-4000-8000-000000000005",
);

const PRIVATE_REFUSAL: string =
  "Webhook URL points to a private network address and is not allowed.";
const PRIVATE_RESOLVED_REFUSAL: string =
  "Webhook URL resolves to a private network address and is not allowed.";
const FORBIDDEN_REFUSAL: string =
  "Webhook URL points to a private, loopback, or link-local address and is not allowed.";

type BeforeCreate = (
  createBy: CreateBy<StatusPageSubscriber>,
) => Promise<OnCreate<StatusPageSubscriber>>;

type BeforeUpdate = (
  updateBy: UpdateBy<StatusPageSubscriber>,
) => Promise<OnUpdate<StatusPageSubscriber>>;

const hooks: { onBeforeCreate: BeforeCreate; onBeforeUpdate: BeforeUpdate } =
  StatusPageSubscriberService as unknown as {
    onBeforeCreate: BeforeCreate;
    onBeforeUpdate: BeforeUpdate;
  };

function page(id: ObjectID = PAGE_ID): StatusPage {
  const statusPage: StatusPage = new StatusPage();
  statusPage._id = id.toString();
  statusPage.projectId = PROJECT_ID;
  statusPage.name = "Acme Status";
  statusPage.limitSubscribersToPrivateUsers = false;
  return statusPage;
}

function webhookSubscriber(url: string): StatusPageSubscriber {
  const row: StatusPageSubscriber = new StatusPageSubscriber();
  row.projectId = PROJECT_ID;
  row.statusPageId = PAGE_ID;
  row.subscriberWebhook = URL.fromString(url);
  return row;
}

// What DNS answers, by host. A host not named here does not resolve.
const DNS_ANSWERS: Record<string, string> = {
  "hooks.example.com": "93.184.216.34",
  "hooks.corp.example": "10.20.30.40",
  "loopback.example": "127.0.0.1",
};

// The rows an update writes, as the database has them.
let subscriberRows: Array<StatusPageSubscriber> = [];
let lookupSpy: jest.SpiedFunction<typeof dns.promises.lookup>;
const savedEnv: Record<string, string | undefined> = {};

function setInstance(settings: {
  allowPrivateNetwork?: boolean;
  allowlist?: string;
}): void {
  if (settings.allowPrivateNetwork) {
    process.env[ALLOW_ENV] = "true";
  } else {
    delete process.env[ALLOW_ENV];
  }

  if (settings.allowlist) {
    process.env[ALLOWLIST_ENV] = settings.allowlist;
  } else {
    delete process.env[ALLOWLIST_ENV];
  }
}

async function refusalOf(action: Promise<unknown>): Promise<string | null> {
  try {
    await action;
    return null;
  } catch (err) {
    expect(err).toBeInstanceOf(BadDataException);
    return (err as Error).message;
  }
}

beforeEach(() => {
  for (const name of EGRESS_ENV) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }

  subscriberRows = [];
  stubProjectDirectory({});

  lookupSpy = jest.spyOn(dns.promises, "lookup").mockImplementation((async (
    hostname: string,
  ) => {
    const address: string | undefined = DNS_ANSWERS[hostname];

    if (!address) {
      const error: NodeJS.ErrnoException = new Error(
        `getaddrinfo ENOTFOUND ${hostname}`,
      );
      error.code = "ENOTFOUND";
      throw error;
    }

    return [{ address: address, family: 4 }];
  }) as never) as unknown as jest.SpiedFunction<typeof dns.promises.lookup>;

  getJestSpyOn(
    StatusPagePrivateUserService,
    "isPrivateUserEmail",
  ).mockResolvedValue(false);

  // The contact's subscriptions on the page, and the rows an update writes.
  getJestSpyOn(StatusPageSubscriberService, "findBy").mockImplementation(
    async (): Promise<Array<StatusPageSubscriber>> => {
      return subscriberRows;
    },
  );
  stubRowsCallerMayWrite(
    StatusPageSubscriberService,
    async (): Promise<Array<unknown>> => {
      return subscriberRows;
    },
  );

  getJestSpyOn(
    StatusPageSubscriberService,
    "getStatusPagesToSendNotification",
  ).mockImplementation(async (): Promise<Array<StatusPage>> => {
    return [page()];
  });

  getJestSpyOn(StatusPageService, "findBy").mockImplementation(
    async (): Promise<Array<StatusPage>> => {
      return [page(), page(OTHER_PAGE_ID)];
    },
  );

  getJestSpyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
    plan: null,
    isSubscriptionUnpaid: false,
  } as never);
  getJestSpyOn(ProjectService, "isSMSNotificationsEnabled").mockResolvedValue(
    true,
  );
  getJestSpyOn(ProjectReferenceCheck, "validateUpdate").mockResolvedValue(
    undefined,
  );

  /*
   * The visitor's sign-up runs the real create hook: create() is stood in
   * for by the hook alone, with the very row the sign-up hands it.
   */
  getJestSpyOn(StatusPageSubscriberService, "create").mockImplementation(
    async (
      createBy: CreateBy<StatusPageSubscriber>,
    ): Promise<StatusPageSubscriber> => {
      await hooks.onBeforeCreate(createBy);
      return createBy.data;
    },
  );
});

afterEach(() => {
  jest.restoreAllMocks();

  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

// The team adding a subscriber: the create hook, as every non-sign-up runs it.
async function teamAdds(url: string): Promise<string | null> {
  return await refusalOf(
    hooks.onBeforeCreate({
      data: webhookSubscriber(url),
      props: { isRoot: true },
    }),
  );
}

async function visitorSignsUp(url: string): Promise<string | null> {
  return await refusalOf(
    StatusPageSubscriberService.createFromStatusPageSignUp(
      webhookSubscriber(url),
    ),
  );
}

describe("a new webhook subscriber", () => {
  describe("added by the team", () => {
    test("at a private address, on an instance that allows private networks: added, and marked as the team's", async () => {
      setInstance({ allowPrivateNetwork: true });

      const row: StatusPageSubscriber = webhookSubscriber(
        "http://10.0.0.5/hook",
      );

      await hooks.onBeforeCreate({ data: row, props: { isRoot: true } });

      expect(row.isAddedByTeam).toBe(true);
    });

    // The issue's case: a URL whose host name resolves to a private address.
    test("at a host name that resolves into the private network, on that instance: added", async () => {
      setInstance({ allowPrivateNetwork: true });

      expect(await teamAdds("http://hooks.corp.example/hook")).toBeNull();
    });

    test("at a host the allowlist names: added, without the blanket switch", async () => {
      setInstance({ allowlist: "hooks.corp.example" });

      expect(await teamAdds("http://hooks.corp.example/hook")).toBeNull();
      expect(await teamAdds("http://10.0.0.5/hook")).toBe(
        `${PRIVATE_REFUSAL}${WEBHOOK_PRIVATE_NETWORK_HINT}`,
      );
    });

    test("at a private address, on an instance that allows nothing: refused, naming the settings that would allow it", async () => {
      expect(await teamAdds("http://10.0.0.5/hook")).toBe(
        `${PRIVATE_REFUSAL} Self-hosted instances can allow this by setting ALLOW_PRIVATE_NETWORK_WEBHOOKS or PRIVATE_NETWORK_WEBHOOK_ALLOWLIST.`,
      );
      expect(await teamAdds("http://hooks.corp.example/hook")).toBe(
        `${PRIVATE_RESOLVED_REFUSAL}${WEBHOOK_PRIVATE_NETWORK_HINT}`,
      );
    });

    test.each([
      "http://127.0.0.1/hook",
      "http://localhost/hook",
      "http://169.254.169.254/latest/meta-data/",
    ])(
      "at %s: refused even on an instance that allows private networks",
      async (url: string) => {
        setInstance({ allowPrivateNetwork: true });

        expect(await teamAdds(url)).toBe(FORBIDDEN_REFUSAL);
      },
    );

    test("at a public address: added on any instance", async () => {
      expect(await teamAdds("https://hooks.example.com/hook")).toBeNull();
    });
  });

  describe("signed up for by a visitor on the status page", () => {
    test.each([
      ["nothing", {}],
      [
        "private networks and an allowlist naming the target",
        { allowPrivateNetwork: true, allowlist: "10.0.0.0/8" },
      ],
    ])(
      "at a private address, on an instance that allows %s: refused, told to use a public URL",
      async (
        _name: string,
        settings: { allowPrivateNetwork?: boolean; allowlist?: string },
      ) => {
        setInstance(settings);

        const message: string | null = await visitorSignsUp(
          "http://10.0.0.5/hook",
        );

        expect(message).toBe(
          `${PRIVATE_REFUSAL} Use a webhook URL on the public internet.`,
        );
        expect(message).toBe(
          `${PRIVATE_REFUSAL}${SIGN_UP_PRIVATE_NETWORK_HINT}`,
        );
        expect(message).not.toContain("ALLOW_PRIVATE_NETWORK_WEBHOOKS");
        expect(message).not.toContain("PRIVATE_NETWORK_WEBHOOK_ALLOWLIST");
      },
    );

    test("at a host name that resolves privately: told only that it could not be reached, as for one that does not exist", async () => {
      setInstance({ allowPrivateNetwork: true });

      expect(await visitorSignsUp("http://hooks.corp.example/hook")).toBe(
        "Webhook URL could not be reached.",
      );
      expect(await visitorSignsUp("http://no-such-host.example/hook")).toBe(
        "Webhook URL could not be reached.",
      );
    });

    test("at loopback or the metadata endpoint: refused", async () => {
      setInstance({ allowPrivateNetwork: true, allowlist: "127.0.0.1" });

      expect(await visitorSignsUp("http://127.0.0.1/hook")).toBe(
        FORBIDDEN_REFUSAL,
      );
      expect(
        await visitorSignsUp("http://169.254.169.254/latest/meta-data/"),
      ).toBe(FORBIDDEN_REFUSAL);
    });

    test("at a public address: signed up, and not marked as the team's", async () => {
      const row: StatusPageSubscriber = webhookSubscriber(
        "https://hooks.example.com/hook",
      );

      await StatusPageSubscriberService.createFromStatusPageSignUp(row);

      expect(row.isAddedByTeam).toBe(false);
    });

    /*
     * The same row, once the sign-up has ended, is no longer one: the mark
     * is held only for the length of the visitor's create.
     */
    test("the very row, created again by the team after the sign-up ended, is the team's", async () => {
      setInstance({ allowPrivateNetwork: true });

      const row: StatusPageSubscriber = webhookSubscriber(
        "http://10.0.0.5/hook",
      );

      expect(
        await refusalOf(
          StatusPageSubscriberService.createFromStatusPageSignUp(row),
        ),
      ).toBe(`${PRIVATE_REFUSAL}${SIGN_UP_PRIVATE_NETWORK_HINT}`);

      expect(
        await refusalOf(
          hooks.onBeforeCreate({ data: row, props: { isRoot: true } }),
        ),
      ).toBeNull();
      expect(row.isAddedByTeam).toBe(true);
    });
  });

  test("a subscriber with no webhook asks DNS nothing", async () => {
    const row: StatusPageSubscriber = new StatusPageSubscriber();
    row.projectId = PROJECT_ID;
    row.statusPageId = PAGE_ID;
    row.slackIncomingWebhookUrl = URL.fromString(
      "https://hooks.slack.com/services/T/B/x",
    );

    await hooks.onBeforeCreate({ data: row, props: { isRoot: true } });

    expect(lookupSpy).not.toHaveBeenCalled();
  });
});

describe("a change of a webhook subscriber's URL", () => {
  /*
   * The subscribers an update writes. Two of them are on two pages: a page
   * takes each webhook once, so an update giving two subscribers of one
   * page the same URL is refused by that rule before this one is asked.
   */
  function existing(
    rows: Array<{ id: ObjectID; isAddedByTeam: boolean | undefined }>,
  ): void {
    subscriberRows = rows.map(
      (
        entry: {
          id: ObjectID;
          isAddedByTeam: boolean | undefined;
        },
        index: number,
      ): StatusPageSubscriber => {
        const row: StatusPageSubscriber = webhookSubscriber(
          "https://hooks.example.com/old",
        );
        row._id = entry.id.toString();
        row.statusPageId = index === 0 ? PAGE_ID : OTHER_PAGE_ID;
        if (entry.isAddedByTeam !== undefined) {
          row.isAddedByTeam = entry.isAddedByTeam;
        }
        return row;
      },
    );
  }

  function change(
    data: JSONObject,
    query: JSONObject = { _id: SUBSCRIBER_ID.toString() },
  ): UpdateBy<StatusPageSubscriber> {
    return {
      query: query,
      data: data as unknown as StatusPageSubscriber,
      props: { isRoot: true },
    } as unknown as UpdateBy<StatusPageSubscriber>;
  }

  async function changeTo(url: string): Promise<string | null> {
    return await refusalOf(
      hooks.onBeforeUpdate(change({ subscriberWebhook: url })),
    );
  }

  describe("of a subscriber the team added", () => {
    beforeEach(() => {
      existing([{ id: SUBSCRIBER_ID, isAddedByTeam: true }]);
    });

    test("to a private address, on an instance that allows private networks: let through", async () => {
      setInstance({ allowPrivateNetwork: true });

      expect(await changeTo("http://10.0.0.5/hook")).toBeNull();
      expect(await changeTo("http://hooks.corp.example/hook")).toBeNull();
    });

    test("to a private address, on an instance that allows nothing: refused, naming the settings - it used to be saved, and every send to it failed", async () => {
      expect(await changeTo("http://10.0.0.5/hook")).toBe(
        `${PRIVATE_REFUSAL}${WEBHOOK_PRIVATE_NETWORK_HINT}`,
      );
    });

    test("to loopback or the metadata endpoint: refused on any instance", async () => {
      setInstance({ allowPrivateNetwork: true });

      expect(await changeTo("http://127.0.0.1/hook")).toBe(FORBIDDEN_REFUSAL);
      expect(await changeTo("http://169.254.169.254/")).toBe(FORBIDDEN_REFUSAL);
      expect(await changeTo("http://loopback.example/hook")).toBe(
        "Webhook URL resolves to a private, loopback, or link-local address and is not allowed.",
      );
    });

    test("to something that is not an http address: refused", async () => {
      expect(await changeTo("file:///etc/passwd")).toBe(
        "Webhook URL must use http or https protocol.",
      );
    });

    test("to a public address: let through", async () => {
      expect(await changeTo("https://hooks.example.com/new")).toBeNull();
    });
  });

  describe("of a subscriber that signed up on the status page", () => {
    test.each([
      ["false", false],
      ["not set, as on a row from before the column", undefined],
    ])(
      "(Is Added By Team %s) to a private address: refused, saying why the instance's setting does not apply, even when a teammate makes the change",
      async (_name: string, isAddedByTeam: boolean | undefined) => {
        existing([{ id: SUBSCRIBER_ID, isAddedByTeam: isAddedByTeam }]);
        setInstance({ allowPrivateNetwork: true, allowlist: "10.0.0.0/8" });

        const message: string | null = await changeTo("http://10.0.0.5/hook");

        expect(message).toBe(
          `${PRIVATE_REFUSAL} This subscriber signed up on the status page, so its webhook must be on the public internet.`,
        );
        expect(message).toBe(
          `${PRIVATE_REFUSAL}${SIGNED_UP_SUBSCRIBER_PRIVATE_NETWORK_HINT}`,
        );
      },
    );

    test("to a public address: let through", async () => {
      existing([{ id: SUBSCRIBER_ID, isAddedByTeam: false }]);

      expect(await changeTo("https://hooks.example.com/new")).toBeNull();
    });
  });

  test("an update over a sign-up and a subscriber the team added is refused for both, with the sign-up's reason", async () => {
    existing([
      { id: SUBSCRIBER_ID, isAddedByTeam: true },
      { id: OTHER_SUBSCRIBER_ID, isAddedByTeam: false },
    ]);
    setInstance({ allowPrivateNetwork: true });

    expect(
      await refusalOf(
        hooks.onBeforeUpdate(
          change(
            { subscriberWebhook: "http://10.0.0.5/hook" },
            { projectId: PROJECT_ID.toString() },
          ),
        ),
      ),
    ).toBe(`${PRIVATE_REFUSAL}${SIGNED_UP_SUBSCRIBER_PRIVATE_NETWORK_HINT}`);
  });

  /*
   * On an instance that allows nothing, both rules refuse: the sign-up's
   * reason is the one given, since the settings the team's names would not
   * let the update through.
   */
  test("on an instance that allows nothing, such an update is refused with the sign-up's reason too, not with settings that would not help", async () => {
    existing([
      { id: SUBSCRIBER_ID, isAddedByTeam: true },
      { id: OTHER_SUBSCRIBER_ID, isAddedByTeam: false },
    ]);

    expect(
      await refusalOf(
        hooks.onBeforeUpdate(
          change(
            { subscriberWebhook: "http://10.0.0.5/hook" },
            { projectId: PROJECT_ID.toString() },
          ),
        ),
      ),
    ).toBe(`${PRIVATE_REFUSAL}${SIGNED_UP_SUBSCRIBER_PRIVATE_NETWORK_HINT}`);
  });

  test("an update over subscribers the team added alone is let through", async () => {
    existing([
      { id: SUBSCRIBER_ID, isAddedByTeam: true },
      { id: OTHER_SUBSCRIBER_ID, isAddedByTeam: true },
    ]);
    setInstance({ allowPrivateNetwork: true });

    expect(
      await refusalOf(
        hooks.onBeforeUpdate(
          change(
            { subscriberWebhook: "http://10.0.0.5/hook" },
            { projectId: PROJECT_ID.toString() },
          ),
        ),
      ),
    ).toBeNull();
  });

  test("the rows checked are read with Is Added By Team, and the update is held to them", async () => {
    existing([{ id: SUBSCRIBER_ID, isAddedByTeam: true }]);
    setInstance({ allowPrivateNetwork: true });

    const holdSpy: jest.SpyInstance<any, any> = getJestSpyOn(
      StatusPageSubscriberService,
      "findRowsAndHoldUpdateToThem",
    );

    await hooks.onBeforeUpdate(
      change({ subscriberWebhook: "http://10.0.0.5/hook" }),
    );

    const selects: Array<JSONObject> = holdSpy.mock.calls.map(
      (call: Array<unknown>): JSONObject => {
        return call[1] as JSONObject;
      },
    );

    expect(selects).toContainEqual({ _id: true, isAddedByTeam: true });
  });

  test("an update that leaves the webhook alone, or clears it, asks DNS nothing", async () => {
    existing([{ id: SUBSCRIBER_ID, isAddedByTeam: false }]);

    for (const data of [
      { isSubscribedToAllEventTypes: true },
      { subscriberWebhook: null },
      { subscriberWebhook: "" },
    ]) {
      expect(
        await refusalOf(hooks.onBeforeUpdate(change(data as JSONObject))),
      ).toBeNull();
    }

    expect(lookupSpy).not.toHaveBeenCalled();
  });

  test("an update that matches no subscriber the caller may write checks nothing", async () => {
    existing([]);

    expect(await changeTo("http://10.0.0.5/hook")).toBeNull();
    expect(lookupSpy).not.toHaveBeenCalled();
  });
});
