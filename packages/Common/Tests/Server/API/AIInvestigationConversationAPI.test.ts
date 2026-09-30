import { mockRouter } from "./Helpers";
import "../../../Server/API/AIInvestigationConversationAPI";
import { parseInvestigationThreadSubject } from "../../../Server/API/AIInvestigationConversationAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import AlertService from "../../../Server/Services/AlertService";
import IncidentService from "../../../Server/Services/IncidentService";
import InvestigationThreadService from "../../../Server/Utils/AI/SRE/InvestigationThreadService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";

/*
 * The four routes behind the investigation box's conversation. Every one
 * must refuse a caller who is not a member of the tenant, a subject the
 * caller cannot read, and a subject from another project — BEFORE the
 * shared thread is touched — and then hand the service exactly the tenant,
 * the caller and the subject it checked.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return { sendJsonObjectResponse: jest.fn() };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "abababab-abab-4bab-8bab-abababababab",
);
const USER_ID: ObjectID = new ObjectID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
const SUBJECT_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const MESSAGE_ID: ObjectID = new ObjectID(
  "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
);
const RUN_ID: ObjectID = new ObjectID("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");

const MEMBER_PROPS: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  tenantId: PROJECT_ID,
  isMultiTenantRequest: true,
  userTenantAccessPermission: {
    [PROJECT_ID.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT_ID,
      permissions: [
        {
          _type: "UserPermission",
          permission: Permission.ProjectMember,
          labelIds: [],
        },
      ],
    },
  },
} as unknown as DatabaseCommonInteractionProps;

// Logged in and naming the tenant, but not a member of it.
const OUTSIDER_PROPS: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  tenantId: PROJECT_ID,
} as unknown as DatabaseCommonInteractionProps;

const ROUTES: Array<string> = [
  "/ai-investigation/conversation",
  "/ai-investigation/conversation/send-message",
  "/ai-investigation/conversation/respond-to-approval",
  "/ai-investigation/conversation/cancel-run",
];

function subject(
  subjectType: "incident" | "alert",
  projectId: ObjectID,
): Incident | Alert {
  const model: Incident | Alert =
    subjectType === "incident"
      ? new Incident(SUBJECT_ID)
      : new Alert(SUBJECT_ID);
  model.projectId = projectId;
  return model;
}

async function call(route: string, body: JSONObject): Promise<jest.Mock> {
  const next: jest.Mock = jest.fn();

  await mockRouter
    .match("post", route)
    .handlerFunction(
      { body } as ExpressRequest,
      {} as ExpressResponse,
      next as NextFunction,
    );

  return next;
}

function payload(): JSONObject {
  return (Response.sendJsonObjectResponse as jest.Mock).mock
    .calls[0]![2] as JSONObject;
}

function bodyFor(route: string, subjectType: "incident" | "alert"): JSONObject {
  const base: JSONObject = {
    subjectType,
    subjectId: SUBJECT_ID.toString(),
  };

  if (route.endsWith("send-message")) {
    return { ...base, content: "Which pods use the most memory?" };
  }

  if (route.endsWith("respond-to-approval")) {
    return { ...base, assistantMessageId: MESSAGE_ID.toString(), approved: true };
  }

  return base;
}

let serviceSpies: Array<jest.SpyInstance> = [];

function installServiceSpies(): void {
  serviceSpies = [
    jest
      .spyOn(InvestigationThreadService, "getView")
      .mockResolvedValue({ conversationId: null, messages: [] } as never),
    jest.spyOn(InvestigationThreadService, "sendMessage").mockResolvedValue({
      conversationId: ObjectID.generate(),
      userMessageId: ObjectID.generate(),
      assistantMessageId: MESSAGE_ID,
      aiRunId: RUN_ID,
    } as never),
    jest
      .spyOn(InvestigationThreadService, "respondToApproval")
      .mockResolvedValue({ aiRunId: RUN_ID } as never),
    jest
      .spyOn(InvestigationThreadService, "cancelRun")
      .mockResolvedValue({ aiRunId: RUN_ID, cancelled: true } as never),
  ];
}

function expectThreadUntouched(): void {
  for (const spy of serviceSpies) {
    expect(spy).not.toHaveBeenCalled();
  }
  expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
}

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("parseInvestigationThreadSubject", () => {
  test("parses an incident or an alert", () => {
    expect(
      parseInvestigationThreadSubject({
        subjectType: "incident",
        subjectId: ` ${SUBJECT_ID.toString()} `,
      }),
    ).toEqual({ type: "incident", id: SUBJECT_ID });
    expect(
      parseInvestigationThreadSubject({
        subjectType: "alert",
        subjectId: SUBJECT_ID.toString(),
      }).type,
    ).toBe("alert");
  });

  test.each([
    [{ subjectType: "monitor", subjectId: SUBJECT_ID.toString() }],
    [{ subjectId: SUBJECT_ID.toString() }],
    [{ subjectType: "incident" }],
    [{ subjectType: "incident", subjectId: 42 }],
    [{ subjectType: "incident", subjectId: "   " }],
    [{ subjectType: "incident", subjectId: "not-a-uuid" }],
  ])("refuses %p", (body: JSONObject) => {
    expect(() => {
      return parseInvestigationThreadSubject(body);
    }).toThrow();
  });
});

describe.each(["incident", "alert"] as const)(
  "%s conversation routes",
  (subjectType: "incident" | "alert") => {
    let subjectRead: jest.SpyInstance;

    beforeEach(() => {
      jest
        .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
        .mockResolvedValue(MEMBER_PROPS);
      subjectRead = jest
        .spyOn(
          subjectType === "incident" ? IncidentService : AlertService,
          "findOneById",
        )
        .mockResolvedValue(subject(subjectType, PROJECT_ID) as never);
      installServiceSpies();
    });

    test.each(ROUTES)(
      "%s refuses a caller who is not a member of the project",
      async (route: string) => {
        (
          CommonAPI.getDatabaseCommonInteractionProps as unknown as jest.SpyInstance
        ).mockResolvedValue(OUTSIDER_PROPS);

        const next: jest.Mock = await call(route, bodyFor(route, subjectType));

        expect(next).toHaveBeenCalledTimes(1);
        expectThreadUntouched();
      },
    );

    test.each(ROUTES)(
      "%s refuses a subject the caller cannot read",
      async (route: string) => {
        subjectRead.mockResolvedValue(null as never);

        const next: jest.Mock = await call(route, bodyFor(route, subjectType));

        expect(next.mock.calls[0]![0]).toBeInstanceOf(BadDataException);
        expectThreadUntouched();
      },
    );

    test.each(ROUTES)(
      "%s refuses a subject from another project",
      async (route: string) => {
        subjectRead.mockResolvedValue(
          subject(subjectType, OTHER_PROJECT_ID) as never,
        );

        const next: jest.Mock = await call(route, bodyFor(route, subjectType));

        expect(next).toHaveBeenCalledTimes(1);
        expectThreadUntouched();
      },
    );

    test.each(ROUTES)(
      "%s checks the subject under the viewer's tenant-pinned props",
      async (route: string) => {
        await call(route, bodyFor(route, subjectType));

        expect(subjectRead).toHaveBeenCalledWith(
          expect.objectContaining({
            id: SUBJECT_ID,
            props: expect.objectContaining({
              userId: USER_ID,
              isMultiTenantRequest: false,
            }),
          }),
        );
      },
    );

    test("reads the thread with the viewer, and says who is viewing", async () => {
      const next: jest.Mock = await call(
        "/ai-investigation/conversation",
        bodyFor("/ai-investigation/conversation", subjectType),
      );

      expect(next).not.toHaveBeenCalled();
      expect(InvestigationThreadService.getView).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        subject: { type: subjectType, id: SUBJECT_ID },
        viewerUserId: USER_ID,
      });
      expect(payload()["viewerUserId"]).toBe(USER_ID.toString());
    });

    test("sends the question with the asker's props and chosen mode", async () => {
      const next: jest.Mock = await call(
        "/ai-investigation/conversation/send-message",
        {
          ...bodyFor("/ai-investigation/conversation/send-message", subjectType),
          permissionMode: "AskForApproval",
        },
      );

      expect(next).not.toHaveBeenCalled();

      const args: JSONObject = (
        InvestigationThreadService.sendMessage as unknown as jest.SpyInstance
      ).mock.calls[0]![0] as JSONObject;

      expect(args["projectId"]).toBe(PROJECT_ID);
      expect(args["userId"]).toBe(USER_ID);
      expect(args["content"]).toBe("Which pods use the most memory?");
      expect(args["permissionMode"]).toBe("AskForApproval");
      expect(args["subject"]).toEqual({ type: subjectType, id: SUBJECT_ID });
      expect((args["props"] as JSONObject)["isMultiTenantRequest"]).toBe(false);
      expect(payload()["assistantMessageId"]).toBe(MESSAGE_ID.toString());
      expect(payload()["aiRunId"]).toBe(RUN_ID.toString());
    });

    test("refuses a question with no content", async () => {
      const next: jest.Mock = await call(
        "/ai-investigation/conversation/send-message",
        bodyFor("/ai-investigation/conversation", subjectType),
      );

      expect(next.mock.calls[0]![0]).toBeInstanceOf(BadDataException);
      expect(InvestigationThreadService.sendMessage).not.toHaveBeenCalled();
    });

    test("passes an approval decision through with the decider", async () => {
      const next: jest.Mock = await call(
        "/ai-investigation/conversation/respond-to-approval",
        {
          subjectType,
          subjectId: SUBJECT_ID.toString(),
          assistantMessageId: MESSAGE_ID.toString(),
          decisions: [{ toolCallId: "call-1", approved: true }],
        },
      );

      expect(next).not.toHaveBeenCalled();

      const args: JSONObject = (
        InvestigationThreadService.respondToApproval as unknown as jest.SpyInstance
      ).mock.calls[0]![0] as JSONObject;

      expect(args["userId"]).toBe(USER_ID);
      expect((args["assistantMessageId"] as ObjectID).toString()).toBe(
        MESSAGE_ID.toString(),
      );
      expect(args["decisions"]).toEqual([
        { toolCallId: "call-1", approved: true },
      ]);
      expect(args["approved"]).toBeUndefined();
    });

    test("refuses an approval without a valid message id", async () => {
      const next: jest.Mock = await call(
        "/ai-investigation/conversation/respond-to-approval",
        {
          subjectType,
          subjectId: SUBJECT_ID.toString(),
          assistantMessageId: "nope",
          approved: true,
        },
      );

      expect(next).toHaveBeenCalledTimes(1);
      expect(InvestigationThreadService.respondToApproval).not.toHaveBeenCalled();
    });

    test("stops the answer in flight", async () => {
      const next: jest.Mock = await call(
        "/ai-investigation/conversation/cancel-run",
        bodyFor("/ai-investigation/conversation/cancel-run", subjectType),
      );

      expect(next).not.toHaveBeenCalled();
      expect(InvestigationThreadService.cancelRun).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        subject: { type: subjectType, id: SUBJECT_ID },
        userId: USER_ID,
      });
      expect(payload()).toEqual({
        aiRunId: RUN_ID.toString(),
        cancelled: true,
      });
    });

    test("a service refusal reaches the caller as an error", async () => {
      (
        InvestigationThreadService.sendMessage as unknown as jest.SpyInstance
      ).mockRejectedValue(
        new BadDataException("OneUptime AI is still answering") as never,
      );

      const next: jest.Mock = await call(
        "/ai-investigation/conversation/send-message",
        bodyFor("/ai-investigation/conversation/send-message", subjectType),
      );

      expect((next.mock.calls[0]![0] as Error).message).toBe(
        "OneUptime AI is still answering",
      );
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    });
  },
);
