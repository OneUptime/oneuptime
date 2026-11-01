import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageSubscriberService from "../../../Server/Services/StatusPageSubscriberService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { ExpressRequest } from "../../../Server/Utils/Express";
import PublicMessageRateLimit from "../../../Server/Utils/RateLimit/PublicMessageRateLimit";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

/*
 * THE LANGUAGE A VISITOR SUBSCRIBES IN.
 *
 * The status page sends the language it is read in as each request's
 * Accept-Language (StatusPage/src/Utils/API.ts). A sign-up keeps it as the
 * subscriber's language when it is not the page's default - so their
 * notifications are written in it - and keeps none when it is, so the
 * subscriber follows the page. A header that names no language OneUptime
 * writes in keeps none either.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000000002",
);

function statusPage(defaultLanguage: string | undefined): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = STATUS_PAGE_ID.toString();
  page.projectId = PROJECT_ID;
  page.name = "Acme";
  page.isPublicStatusPage = true;
  page.showSubscriberPageOnStatusPage = true;
  page.enableEmailSubscribers = true;
  page.enableSmsSubscribers = true;
  page.enableSlackSubscribers = true;
  page.enableMicrosoftTeamsSubscribers = true;
  page.enableWebhookSubscribers = true;

  if (defaultLanguage) {
    page.defaultLanguage = defaultLanguage;
  }

  return page;
}

function signUpRequest(acceptLanguage: string | undefined): ExpressRequest {
  return {
    params: { statusPageId: STATUS_PAGE_ID.toString() },
    body: {
      data: {
        subscriberWebhook: "https://hooks.example.com/in",
        isSubscribedToAllResources: true,
        isSubscribedToAllEventTypes: true,
      },
    },
    query: {},
    cookies: {},
    headers: acceptLanguage ? { "accept-language": acceptLanguage } : {},
    socket: {},
    ips: [],
  } as unknown as ExpressRequest;
}

let created: Array<StatusPageSubscriber> = [];

describe("a visitor's sign-up keeps the language they read the page in", () => {
  let api: StatusPageAPI;

  beforeAll(() => {
    api = new StatusPageAPI();
  });

  beforeEach(() => {
    created = [];

    jest
      .spyOn(PublicMessageRateLimit, "assertMaySend")
      .mockResolvedValue({ giveBack: async (): Promise<void> => {} });
    jest
      .spyOn(StatusPageService, "hasReadAccess")
      .mockResolvedValue({ hasReadAccess: true });
    jest
      .spyOn(StatusPageSubscriberService, "create")
      .mockImplementation(
        async (
          createBy: CreateBy<StatusPageSubscriber>,
        ): Promise<StatusPageSubscriber> => {
          created.push(createBy.data);
          return createBy.data;
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function signUp(data: {
    pageLanguage?: string;
    acceptLanguage?: string;
  }): Promise<StatusPageSubscriber> {
    jest
      .spyOn(StatusPageService, "findOneBy")
      .mockResolvedValue(statusPage(data.pageLanguage));

    await api.subscribeToStatusPage(signUpRequest(data.acceptLanguage));

    expect(created).toHaveLength(1);

    return created[0]!;
  }

  test("a French reader of a German page is written French", async () => {
    const subscriber: StatusPageSubscriber = await signUp({
      pageLanguage: "de",
      acceptLanguage: "fr-FR,fr;q=0.9,en;q=0.5",
    });

    expect(subscriber.language).toBe("fr");
  });

  test("a reader of the page's default language follows the page", async () => {
    const subscriber: StatusPageSubscriber = await signUp({
      pageLanguage: "de",
      acceptLanguage: "de",
    });

    expect(subscriber.language).toBeUndefined();
  });

  test("an English reader of an English page follows the page", async () => {
    expect(
      (await signUp({ acceptLanguage: "en-US,en;q=0.9" })).language,
    ).toBeUndefined();
  });

  test("a request that names no language OneUptime writes in keeps none", async () => {
    expect(
      (await signUp({ pageLanguage: "ja", acceptLanguage: "xx, yy;q=0.4" }))
        .language,
    ).toBeUndefined();
    created = [];
    expect((await signUp({ pageLanguage: "ja" })).language).toBeUndefined();
  });

  test("the page is read with its default language", async () => {
    await signUp({ pageLanguage: "ko", acceptLanguage: "ko" });

    const select: JSONObject = (
      jest.mocked(StatusPageService.findOneBy).mock.calls[0]![0] as {
        select: JSONObject;
      }
    ).select;

    expect(select["defaultLanguage"]).toBe(true);
  });
});

/*
 * A subscriber who opens their manage link and changes their subscription
 * keeps the language they read the page in now: their notifications are
 * written in it from then on. A request that names no language OneUptime
 * writes in leaves their language as it was.
 */
describe("a subscriber's change keeps the language they read the page in now", () => {
  const SUBSCRIBER_ID: ObjectID = new ObjectID(
    "30000000-0000-4000-8000-000000000003",
  );

  let api: StatusPageAPI;
  let changes: Array<JSONObject> = [];

  beforeAll(() => {
    api = new StatusPageAPI();
  });

  beforeEach(() => {
    changes = [];

    jest
      .spyOn(StatusPageService, "hasReadAccess")
      .mockResolvedValue({ hasReadAccess: true });
    jest
      .spyOn(StatusPageSubscriberService, "updateFromManageSubscriptionPage")
      .mockImplementation(
        async (data: {
          subscriberId: ObjectID;
          data: unknown;
        }): Promise<number> => {
          changes.push(data.data as JSONObject);
          return 1;
        },
      );

    const existing: StatusPageSubscriber = new StatusPageSubscriber();
    existing._id = SUBSCRIBER_ID.toString();
    existing.statusPageId = STATUS_PAGE_ID;
    existing.projectId = PROJECT_ID;
    existing.language = "it";

    jest
      .spyOn(
        api as unknown as {
          findSubscriberForManageLink: () => Promise<StatusPageSubscriber>;
        },
        "findSubscriberForManageLink",
      )
      .mockResolvedValue(existing);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function change(data: {
    pageLanguage?: string;
    acceptLanguage?: string;
  }): Promise<JSONObject> {
    jest
      .spyOn(StatusPageService, "findOneBy")
      .mockResolvedValue(statusPage(data.pageLanguage));

    const request: ExpressRequest = signUpRequest(data.acceptLanguage);
    (request.params as JSONObject)["subscriberId"] = SUBSCRIBER_ID.toString();
    request.body = {
      data: {
        isSubscribedToAllResources: true,
        isSubscribedToAllEventTypes: true,
      },
    };

    await api.subscribeToStatusPage(request);

    expect(changes).toHaveLength(1);

    return changes[0]!;
  }

  test("an Italian subscriber who now reads the page in Korean is written Korean", async () => {
    expect(
      (await change({ pageLanguage: "de", acceptLanguage: "ko" }))["language"],
    ).toBe("ko");
  });

  test("one who now reads it in the page's default follows the page again", async () => {
    const changed: JSONObject = await change({
      pageLanguage: "de",
      acceptLanguage: "de-DE,de;q=0.9",
    });

    expect(Object.keys(changed)).toContain("language");
    expect(changed["language"]).toBeNull();
  });

  test("a request that names no language OneUptime writes in leaves it as it was", async () => {
    expect(
      Object.keys(await change({ pageLanguage: "de", acceptLanguage: "xx" })),
    ).not.toContain("language");
    changes = [];
    expect(Object.keys(await change({ pageLanguage: "de" }))).not.toContain(
      "language",
    );
  });
});
