jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import ProjectService from "../../../Server/Services/ProjectService";
import UserCallService from "../../../Server/Services/UserCallService";
import UserEmailService from "../../../Server/Services/UserEmailService";
import UserIncomingCallNumberService from "../../../Server/Services/UserIncomingCallNumberService";
import UserSmsService from "../../../Server/Services/UserSmsService";
import UserWhatsAppService from "../../../Server/Services/UserWhatsAppService";
import ProjectMembership from "../../../Server/Utils/TeamMember/ProjectMembership";
import BadDataException from "../../../Types/Exception/BadDataException";
import Email from "../../../Types/Email";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A NEW CODE GOES OUT ONLY FOR A MEMBER OF THE ROW'S PROJECT, on every
 * channel that has one, whoever asks for it - the person from their verify
 * dialog, or a project administrator for them
 * (UserNotificationMethodAdminService). Each channel's service asks
 * (ChannelVerification.assertOwnerIsProjectMember) before anything else
 * about the row or the project: a row whose owner left the project, or was
 * never in it, is answered as one that does not exist - no code is issued,
 * nothing is sent, the project's SMS setting and balance are not read, and
 * not even whether the row is verified is said.
 *
 * Telegram rotates a link token rather than sending a code, and has asked
 * the same of its owner since it was written
 * (UserTelegramService.hasActiveProjectMembership); the guard at the end
 * holds every service with a resend to one of the two.
 */

const ITEM_ID: ObjectID = new ObjectID("8e000000-0000-4000-8000-000000000001");
const OWNER_ID: ObjectID = new ObjectID("8e000000-0000-4000-8000-000000000002");
const PROJECT_ID: ObjectID = new ObjectID(
  "8e000000-0000-4000-8000-000000000003",
);

type AnyService = Record<string, unknown>;

interface ResendingService {
  name: string;
  service: AnyService;
  row: () => Record<string, unknown>;
}

function rowWith(address: Record<string, unknown>): Record<string, unknown> {
  return {
    _id: ITEM_ID.toString(),
    id: ITEM_ID,
    projectId: PROJECT_ID,
    userId: OWNER_ID,
    isVerified: false,
    // Long past the cooldown, so only membership can stand in the way.
    verificationCodeSentAt: new Date(Date.now() - 60 * 60 * 1000),
    ...address,
  };
}

const SERVICES: Array<ResendingService> = [
  {
    name: "UserEmailService",
    service: UserEmailService as unknown as AnyService,
    row: () => {
      return rowWith({ email: new Email("someone@example.com") });
    },
  },
  {
    name: "UserSmsService",
    service: UserSmsService as unknown as AnyService,
    row: () => {
      return rowWith({ phone: new Phone("+15550100001") });
    },
  },
  {
    name: "UserCallService",
    service: UserCallService as unknown as AnyService,
    row: () => {
      return rowWith({ phone: new Phone("+15550100002") });
    },
  },
  {
    name: "UserWhatsAppService",
    service: UserWhatsAppService as unknown as AnyService,
    row: () => {
      return rowWith({ phone: new Phone("+15550100003") });
    },
  },
  {
    name: "UserIncomingCallNumberService",
    service: UserIncomingCallNumberService as unknown as AnyService,
    row: () => {
      return rowWith({ phone: new Phone("+15550100004") });
    },
  },
];

describe.each(SERVICES)(
  "$name.resendVerificationCode",
  ({ service, row }: ResendingService) => {
    let isMember: ReturnType<typeof jest.spyOn>;
    let issueAndSend: ReturnType<typeof jest.spyOn>;
    let update: ReturnType<typeof jest.spyOn>;
    let readProject: ReturnType<typeof jest.spyOn>;

    const resend: () => Promise<void> = (): Promise<void> => {
      return (
        service["resendVerificationCode"] as (itemId: ObjectID) => Promise<void>
      ).call(service, ITEM_ID);
    };

    beforeEach(() => {
      jest
        .spyOn(service as Record<string, () => unknown>, "findOneById")
        .mockImplementation((async (): Promise<unknown> => {
          return row();
        }) as never);

      isMember = jest
        .spyOn(ProjectMembership, "isMember")
        .mockResolvedValue(false as never);

      // Whatever a send would need, it must never get that far.
      issueAndSend = jest
        .spyOn(
          service as Record<string, () => unknown>,
          "issueAndSendVerificationCode",
        )
        .mockResolvedValue(undefined as never);
      update = jest
        .spyOn(service as Record<string, () => unknown>, "updateOneById")
        .mockResolvedValue(1 as never);
      readProject = jest
        .spyOn(ProjectService, "findOneById")
        .mockResolvedValue({
          enableSmsNotifications: true,
          enableCallNotifications: true,
          enableWhatsAppNotifications: true,
          smsOrCallCurrentBalanceInUSDCents: 100000,
        } as never);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("refuses an owner who is not a member of the row's project as if the row did not exist", async () => {
      await expect(resend()).rejects.toThrow(
        new BadDataException("Item not found"),
      );
    });

    test("issues no code, sends nothing, writes nothing", async () => {
      await expect(resend()).rejects.toThrow();

      expect(issueAndSend).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });

    test("does not ask the project whether it could send", async () => {
      await expect(resend()).rejects.toThrow();

      expect(readProject).not.toHaveBeenCalled();
    });

    test("does not say the row is verified either", async () => {
      jest
        .spyOn(service as Record<string, () => unknown>, "findOneById")
        .mockImplementation((async (): Promise<unknown> => {
          return { ...row(), isVerified: true };
        }) as never);

      await expect(resend()).rejects.toThrow("not found");
    });

    test("asks about the row's own project and owner", async () => {
      await expect(resend()).rejects.toThrow();

      expect(isMember).toHaveBeenCalledTimes(1);

      const asked: { projectId: ObjectID; userId: ObjectID } = isMember.mock
        .calls[0]![0] as { projectId: ObjectID; userId: ObjectID };

      expect(asked.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(asked.userId.toString()).toBe(OWNER_ID.toString());
    });

    test("for a member, goes on to send a new code (the control)", async () => {
      isMember.mockResolvedValue(true as never);

      // The phone channels ask whether the project can send; email does not.
      if (typeof service["getReasonCodeCannotBeSent"] === "function") {
        jest
          .spyOn(
            service as Record<string, () => unknown>,
            "getReasonCodeCannotBeSent",
          )
          .mockResolvedValue(null as never);
      }

      await resend();

      expect(issueAndSend).toHaveBeenCalledTimes(1);
    });
  },
);

/*
 * Every service with a resend asks the membership of the row's project
 * first - a new channel with a resend that forgets fails here.
 */
describe("every resend asks the membership of the row's project", () => {
  const SERVICES_DIR: string = path.resolve(
    __dirname,
    "../../../Server/Services",
  );

  const RESEND_DECLARATION: string = "public async resendVerificationCode(";
  const TELEGRAM_DECLARATION: string =
    "public async regenerateVerificationCode(";

  // The body of the method declared by `declaration`: up to the next member.
  function methodBody(source: string, declaration: string): string {
    const start: number = source.indexOf(declaration);
    const next: number = source.indexOf("\n  @CaptureSpan()", start + 1);
    const nextPublic: number = source.indexOf("\n  public ", start + 1);
    const ends: Array<number> = [next, nextPublic].filter((at: number) => {
      return at !== -1;
    });

    return source.slice(start, ends.length ? Math.min(...ends) : undefined);
  }

  const files: Array<string> = fs
    .readdirSync(SERVICES_DIR)
    .filter((name: string): boolean => {
      return name.endsWith(".ts");
    });

  const resending: Array<[string, string]> = files
    .map((name: string): [string, string] => {
      return [name, fs.readFileSync(path.join(SERVICES_DIR, name), "utf8")];
    })
    .filter(([, source]: [string, string]): boolean => {
      return (
        source.includes(RESEND_DECLARATION) ||
        source.includes(TELEGRAM_DECLARATION)
      );
    });

  test("finds the six services with a resend", () => {
    expect(
      resending
        .map(([name]: [string, string]): string => {
          return name;
        })
        .sort(),
    ).toEqual(
      [
        "UserCallService.ts",
        "UserEmailService.ts",
        "UserIncomingCallNumberService.ts",
        "UserSmsService.ts",
        "UserTelegramService.ts",
        "UserWhatsAppService.ts",
      ].sort(),
    );
  });

  test.each(
    resending.filter(([name]: [string, string]): boolean => {
      return name !== "UserTelegramService.ts";
    }),
  )(
    "%s asks before it reads the project or sends anything",
    (_name: string, source: string) => {
      const body: string = methodBody(source, RESEND_DECLARATION);
      const asks: number = body.indexOf(
        "ChannelVerification.assertOwnerIsProjectMember(",
      );

      expect(asks).toBeGreaterThan(-1);

      for (const later of [
        "getReasonCodeCannotBeSent(",
        "issueAndSendVerificationCode(",
        "item.isVerified",
      ]) {
        const at: number = body.indexOf(later);

        if (at !== -1) {
          expect({ later, before: asks < at }).toEqual({
            later,
            before: true,
          });
        }
      }
    },
  );

  test("UserTelegramService asks the same before it rotates its link", () => {
    const source: string = resending.find(([name]: [string, string]) => {
      return name === "UserTelegramService.ts";
    })![1];

    const body: string = methodBody(source, TELEGRAM_DECLARATION);

    expect(body).toContain("this.hasActiveProjectMembership(");
    expect(body.indexOf("this.hasActiveProjectMembership(")).toBeLessThan(
      body.indexOf("TelegramVerificationToken.mint()"),
    );
  });

  /*
   * The first code too: every channel sends it from its create success
   * hook through ChannelVerification.sendFirstCodeOrRemoveItem, which asks
   * the membership of the row's project before anything is issued or sent
   * and takes the row out when the answer is no.
   */
  test.each(
    resending.filter(([name]: [string, string]): boolean => {
      return name !== "UserTelegramService.ts";
    }),
  )(
    "%s sends the first code only through the check for members",
    (_name: string, source: string) => {
      const body: string = methodBody(
        source,
        "protected override async onCreateSuccess(",
      );
      const guarded: number = body.indexOf(
        "ChannelVerification.sendFirstCodeOrRemoveItem(",
      );
      const sends: number = body.indexOf("this.issueAndSendVerificationCode(");

      expect(guarded).toBeGreaterThan(-1);
      expect(sends).toBeGreaterThan(guarded);
      // The row it asks about is the one just added.
      expect(body.indexOf("item: createdItem", guarded)).toBeGreaterThan(
        guarded,
      );
      expect(body.indexOf("item: createdItem", guarded)).toBeLessThan(sends);
    },
  );
});
