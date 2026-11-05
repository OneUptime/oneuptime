import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import OpenStackCloud from "../../../Models/DatabaseModels/OpenStackCloud";
import OpenStackProjectNotice from "../../../Models/DatabaseModels/OpenStackProjectNotice";
import OpenStackResource from "../../../Models/DatabaseModels/OpenStackResource";
import OpenStackProjectNoticeAPI from "../../../Server/API/OpenStackProjectNoticeAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import OpenStackCloudService from "../../../Server/Services/OpenStackCloudService";
import OpenStackProjectNoticeService from "../../../Server/Services/OpenStackProjectNoticeService";
import OpenStackResourceService from "../../../Server/Services/OpenStackResourceService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import OpenStackProjectNotices from "../../../Server/Utils/OpenStack/OpenStackProjectNotices";
import OpenStackStatusPages from "../../../Server/Utils/OpenStack/OpenStackStatusPages";
import Response from "../../../Server/Utils/Response";
import SSRFProtection from "../../../Server/Utils/SSRFProtection";
import URL from "../../../Types/API/URL";
import Dictionary from "../../../Types/Dictionary";
import Email from "../../../Types/Email";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { getEmptyOpenStackBlastRadius } from "../../../Types/OpenStack/OpenStackBlastRadius";
import { mockRouter } from "./Helpers";

/*
 * WHAT TURNS A NOTICE ON, AND WHO MAY.
 *
 * Whether a notice is on isn't a column anyone can write: it moves only here, and on takes the token its
 * preview gave. The rows are stood in for: what they do is OpenStackProjectNoticePostgres's.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    sendFileResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

const PROJECT_ID: ObjectID = ObjectID.generate();
const CLOUD_ID: ObjectID = ObjectID.generate();
const NOTICE_ID: ObjectID = ObjectID.generate();
const USER_ID: ObjectID = ObjectID.generate();
const KEYSTONE_ID: string = "aaaabbbbccccdddd";
const TOKEN: string = ObjectID.generate().toString();
const BASE: string = "/openstack-project-notice";

interface Answer {
  payload: JSONObject | null;
  error: Error | null;
  isEmptySuccess: boolean;
}

async function call(data: {
  route: string;
  params: Dictionary<string>;
  body?: JSONObject;
}): Promise<Answer> {
  const req: ExpressRequest = {
    params: data.params,
    body: data.body || {},
    query: {},
    cookies: {},
    headers: {},
    socket: {},
    ips: [],
  } as unknown as ExpressRequest;
  const res: ExpressResponse = {} as ExpressResponse;
  const next: jest.Mock = jest.fn() as unknown as jest.Mock;
  const json: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;
  const empty: jest.Mock =
    Response.sendEmptySuccessResponse as unknown as jest.Mock;
  const jsonBefore: number = json.mock.calls.length;
  const emptyBefore: number = empty.mock.calls.length;

  await mockRouter
    .match("post", `${BASE}/${data.route}`)
    .handlerFunction(req, res, next as unknown as NextFunction);

  return {
    payload: (json.mock.calls[jsonBefore]?.[2] as JSONObject) || null,
    error: (next.mock.calls[0]?.[0] as Error) || null,
    isEmptySuccess: empty.mock.calls.length > emptyBefore,
  };
}

function noticeOf(
  overrides: Partial<OpenStackProjectNotice> = {},
): OpenStackProjectNotice {
  const notice: OpenStackProjectNotice = new OpenStackProjectNotice();
  notice._id = NOTICE_ID.toString();
  notice.id = NOTICE_ID;
  notice.projectId = PROJECT_ID;
  notice.openStackCloudId = CLOUD_ID;
  notice.openStackProjectId = KEYSTONE_ID;
  notice.email = new Email("ops@example.com");
  notice.previewToken = TOKEN;
  Object.assign(notice, overrides);
  return notice;
}

function projectRow(): OpenStackResource {
  const row: OpenStackResource = new OpenStackResource();
  row.externalId = KEYSTONE_ID;
  row.name = "ou-payments";
  return row;
}

describe("OpenStackProjectNoticeAPI", () => {
  let update: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    mockRouter.routes.length = 0;
    new OpenStackProjectNoticeAPI();

    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue({ tenantId: PROJECT_ID, userId: USER_ID } as never);
    jest
      .spyOn(ModelPermission, "checkUpdateQueryPermissions")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(OpenStackProjectNoticeService, "findOneById")
      .mockImplementation((async () => {
        return noticeOf();
      }) as never);
    update = jest
      .spyOn(OpenStackProjectNoticeService, "updateOneById")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(OpenStackResourceService, "findOneBy")
      .mockResolvedValue(projectRow());
    jest
      .spyOn(OpenStackResourceService, "findBy")
      .mockResolvedValue([projectRow()]);
    jest.spyOn(OpenStackResourceService, "countBy").mockResolvedValue({
      toNumber: () => {
        return 3;
      },
    } as never);
    jest
      .spyOn(SSRFProtection, "validateWebhookTargetIsSafe")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("a preview", () => {
    test("says who it tells and what it would say, gives a token, and turns nothing on", async () => {
      const answer: Answer = await call({
        route: "preview/:noticeId",
        params: { noticeId: NOTICE_ID.toString() },
      });

      expect(answer.error).toBeNull();
      expect(answer.payload?.["address"]).toBe("ops@example.com");
      expect(answer.payload?.["projectName"]).toBe("ou-payments");
      expect(answer.payload?.["instanceCount"]).toBe(3);
      expect(answer.payload?.["isProjectInCloud"]).toBe(true);
      expect(JSON.stringify(answer.payload?.["example"])).toContain(
        "ou-payments",
      );

      const token: string = answer.payload?.["previewToken"] as string;
      expect(token).toBeTruthy();
      // The only thing it writes is the token, on the row that holds it.
      expect(update).toHaveBeenCalledTimes(1);
      expect(
        (update.mock.calls[0] as Array<{ data: JSONObject }>)[0]!.data,
      ).toEqual({ previewToken: token });
    });

    test("of a project OneUptime doesn't see says so", async () => {
      jest.spyOn(OpenStackResourceService, "findOneBy").mockResolvedValue(null);

      const answer: Answer = await call({
        route: "preview/:noticeId",
        params: { noticeId: NOTICE_ID.toString() },
      });

      expect(answer.payload?.["isProjectInCloud"]).toBe(false);
    });

    test("needs the right to change the notice, since it writes a token", async () => {
      jest
        .spyOn(ModelPermission, "checkUpdateQueryPermissions")
        .mockRejectedValue(new NotAuthorizedException("No"));

      const answer: Answer = await call({
        route: "preview/:noticeId",
        params: { noticeId: NOTICE_ID.toString() },
      });

      expect(answer.error).toBeInstanceOf(NotAuthorizedException);
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("turning on", () => {
    test("with the token its preview gave, it is on, for who was seen, by who saw it", async () => {
      const answer: Answer = await call({
        route: "turn-on/:noticeId",
        params: { noticeId: NOTICE_ID.toString() },
        body: { previewToken: TOKEN },
      });

      expect(answer.error).toBeNull();
      expect(answer.isEmptySuccess).toBe(true);
      const written: Partial<OpenStackProjectNotice> = (
        update.mock.calls[0] as Array<{ data: Partial<OpenStackProjectNotice> }>
      )[0]!.data;
      expect(written.isEnabled).toBe(true);
      expect(written.previewedRecipient).toBe("email:ops@example.com");
      expect(written.previewSeenAt).toBeInstanceOf(Date);
      expect(written.previewSeenByUserId?.toString()).toBe(USER_ID.toString());
      // A token is good once.
      expect(written.previewToken).toBeNull();
    });

    test.each<[string, JSONObject]>([
      ["no token", {}],
      ["an empty token", { previewToken: "" }],
      ["a token someone made up", { previewToken: "made-up" }],
      ["a token that isn't text", { previewToken: { value: TOKEN } as never }],
    ])(
      "with %s, it is refused and stays off",
      async (_name: string, body: JSONObject) => {
        const answer: Answer = await call({
          route: "turn-on/:noticeId",
          params: { noticeId: NOTICE_ID.toString() },
          body,
        });

        expect(answer.error?.message).toContain("See who this tells first");
        expect(update).not.toHaveBeenCalled();
      },
    );

    test("with no preview ever asked for, even an empty token is refused", async () => {
      jest
        .spyOn(OpenStackProjectNoticeService, "findOneById")
        .mockResolvedValue(noticeOf({ previewToken: undefined }));

      const answer: Answer = await call({
        route: "turn-on/:noticeId",
        params: { noticeId: NOTICE_ID.toString() },
        body: {},
      });

      expect(answer.error?.message).toContain("See who this tells first");
      expect(update).not.toHaveBeenCalled();
    });

    test("for a project OneUptime doesn't see, it is refused, because nothing would be sent", async () => {
      jest.spyOn(OpenStackResourceService, "findBy").mockResolvedValue([]);

      const answer: Answer = await call({
        route: "turn-on/:noticeId",
        params: { noticeId: NOTICE_ID.toString() },
        body: { previewToken: TOKEN },
      });

      expect(answer.error?.message).toContain("does not see this project");
      expect(update).not.toHaveBeenCalled();
    });

    test("a webhook this server may not reach is refused", async () => {
      const notice: OpenStackProjectNotice = noticeOf({
        webhookUrl: URL.fromString("https://example.com/hook"),
      });
      notice.email = undefined;
      jest
        .spyOn(OpenStackProjectNoticeService, "findOneById")
        .mockResolvedValue(notice);
      jest
        .spyOn(SSRFProtection, "validateWebhookTargetIsSafe")
        .mockRejectedValue(new Error("not allowed"));

      const answer: Answer = await call({
        route: "turn-on/:noticeId",
        params: { noticeId: NOTICE_ID.toString() },
        body: { previewToken: TOKEN },
      });

      expect(answer.error?.message).toBe("not allowed");
      expect(update).not.toHaveBeenCalled();
    });

    test("someone who may read it but not change it can't", async () => {
      jest
        .spyOn(ModelPermission, "checkUpdateQueryPermissions")
        .mockRejectedValue(new NotAuthorizedException("No"));

      const answer: Answer = await call({
        route: "turn-on/:noticeId",
        params: { noticeId: NOTICE_ID.toString() },
        body: { previewToken: TOKEN },
      });

      expect(answer.error).toBeInstanceOf(NotAuthorizedException);
      expect(update).not.toHaveBeenCalled();
    });

    test("someone who can't see it is told it isn't there", async () => {
      jest
        .spyOn(OpenStackProjectNoticeService, "findOneById")
        .mockResolvedValue(null);

      const answer: Answer = await call({
        route: "turn-on/:noticeId",
        params: { noticeId: NOTICE_ID.toString() },
        body: { previewToken: TOKEN },
      });

      expect(answer.error?.message).toContain("not in this project");
      expect(update).not.toHaveBeenCalled();
    });

    test("what isn't an ID is refused before anything is read", async () => {
      const read: ReturnType<typeof jest.spyOn> = jest.spyOn(
        OpenStackProjectNoticeService,
        "findOneById",
      );
      read.mockClear();

      const answer: Answer = await call({
        route: "turn-on/:noticeId",
        params: { noticeId: "not-an-id" },
        body: { previewToken: TOKEN },
      });

      expect(answer.error).not.toBeNull();
      expect(read).not.toHaveBeenCalled();
    });
  });

  test("turning off takes no preview, and a later turn on needs a new one", async () => {
    const answer: Answer = await call({
      route: "turn-off/:noticeId",
      params: { noticeId: NOTICE_ID.toString() },
    });

    expect(answer.isEmptySuccess).toBe(true);
    expect(
      (update.mock.calls[0] as Array<{ data: JSONObject }>)[0]!.data,
    ).toEqual({
      isEnabled: false,
      previewedRecipient: null,
      previewToken: null,
    });
  });

  describe("who would be told", () => {
    beforeEach(() => {
      const cloud: OpenStackCloud = new OpenStackCloud();
      cloud.projectId = PROJECT_ID;
      jest.spyOn(OpenStackCloudService, "findOneById").mockResolvedValue(cloud);
      jest
        .spyOn(OpenStackResourceService, "getBlastRadius")
        .mockResolvedValue(getEmptyOpenStackBlastRadius(true));
    });

    test("is the one answer that really sends", async () => {
      const decide: ReturnType<typeof jest.spyOn> = jest
        .spyOn(OpenStackProjectNotices, "decide")
        .mockResolvedValue({
          told: [],
          notTold: [],
          ofNoProject: {},
          isReachKnown: true,
        });

      const answer: Answer = await call({
        route: "who-would-be-told/:cloudId",
        params: { cloudId: CLOUD_ID.toString() },
        body: { kind: "Hypervisor", externalId: "RegionOne/compute-01" },
      });

      expect(answer.error).toBeNull();
      expect(decide).toHaveBeenCalledTimes(1);
      expect(answer.payload?.["isReachKnown"]).toBe(true);
    });

    test("a part of another project's cloud isn't there to ask about", async () => {
      jest.spyOn(OpenStackCloudService, "findOneById").mockResolvedValue(null);

      const answer: Answer = await call({
        route: "who-would-be-told/:cloudId",
        params: { cloudId: CLOUD_ID.toString() },
        body: { kind: "Hypervisor", externalId: "RegionOne/compute-01" },
      });

      expect(answer.error?.message).toContain("OpenStack Cloud not found");
    });

    test("a host named for another cloud is ignored", async () => {
      const answer: Answer = await call({
        route: "who-would-be-told/:cloudId",
        params: { cloudId: CLOUD_ID.toString() },
        body: {
          parts: [
            {
              openStackCloudId: ObjectID.generate().toString(),
              kind: "Hypervisor",
              name: "compute-01",
            },
          ],
        },
      });

      expect(answer.error?.message).toContain("Name a host or a zone");
    });
  });

  describe("making a page", () => {
    beforeEach(() => {
      const cloud: OpenStackCloud = new OpenStackCloud();
      cloud.projectId = PROJECT_ID;
      jest.spyOn(OpenStackCloudService, "findOneById").mockResolvedValue(cloud);
    });

    test("one at a time, and the lock is given back when it fails", async () => {
      const mutex: unknown = { name: "the lock" };
      const lock: ReturnType<typeof jest.spyOn> = jest
        .spyOn(Semaphore, "lock")
        .mockResolvedValue(mutex as never);
      const release: ReturnType<typeof jest.spyOn> = jest
        .spyOn(Semaphore, "release")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(OpenStackStatusPages, "makeStatusPage")
        .mockRejectedValue(new Error("changed since you looked"));

      const answer: Answer = await call({
        route: "make-status-page/:cloudId",
        params: { cloudId: CLOUD_ID.toString() },
        body: { planKey: "x" },
      });

      expect(answer.error?.message).toContain("changed since you looked");
      expect(lock).toHaveBeenCalledTimes(1);
      expect(release).toHaveBeenCalledWith(mutex);
    });

    test("private unless it is asked to be public", async () => {
      jest.spyOn(Semaphore, "lock").mockResolvedValue({} as never);
      jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);
      const make: ReturnType<typeof jest.spyOn> = jest
        .spyOn(OpenStackStatusPages, "makeStatusPage")
        .mockResolvedValue({ statusPageId: "x", monitorsMade: 0 });

      await call({
        route: "make-status-page/:cloudId",
        params: { cloudId: CLOUD_ID.toString() },
        body: { planKey: "x", isPublic: "yes" },
      });

      expect(
        (make.mock.calls[0] as Array<{ isPublic: boolean }>)[0]!.isPublic,
      ).toBe(false);
    });
  });
});
