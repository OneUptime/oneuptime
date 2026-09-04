import Project from "../../../Models/DatabaseModels/Project";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import UserTelegram from "../../../Models/DatabaseModels/UserTelegram";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserTelegramService, {
  TelegramVerificationOutcome,
  TelegramVerificationResult,
} from "../../../Server/Services/UserTelegramService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import {
  RESEND_COOLDOWN_SECONDS,
  VERIFICATION_CODE_EXPIRY_MINUTES,
} from "../../../Server/Utils/ChannelVerification";
import TelegramVerificationToken from "../../../Server/Utils/TelegramVerificationToken";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const ITEM_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

type OnBeforeCreateFunction = (
  createBy: CreateBy<UserTelegram>,
) => Promise<OnCreate<UserTelegram>>;

function callOnBeforeCreate(
  createBy: CreateBy<UserTelegram>,
): Promise<OnCreate<UserTelegram>> {
  return (
    UserTelegramService as unknown as {
      onBeforeCreate: OnBeforeCreateFunction;
    }
  ).onBeforeCreate(createBy);
}

function createBy(
  data: Partial<UserTelegram> = {},
  isRoot: boolean = false,
  tenantId: ObjectID | undefined = isRoot ? undefined : PROJECT_ID,
): CreateBy<UserTelegram> {
  const row: UserTelegram = new UserTelegram();
  row.projectId = PROJECT_ID;
  row.userId = USER_ID;
  Object.assign(row, data);

  return {
    data: row,
    props: { isRoot, tenantId },
  } as CreateBy<UserTelegram>;
}

function row(data: Partial<UserTelegram> = {}): UserTelegram {
  const value: UserTelegram = new UserTelegram();
  value.id = ITEM_ID;
  value.userId = USER_ID;
  value.projectId = PROJECT_ID;
  value.isVerified = false;
  Object.assign(value, data);
  return value;
}

interface AtomicClaimMock {
  andWhere: ReturnType<typeof jest.fn>;
  execute: ReturnType<typeof jest.fn>;
  set: ReturnType<typeof jest.fn>;
  where: ReturnType<typeof jest.fn>;
}

function mockAtomicClaim(affected: number): AtomicClaimMock {
  const queryBuilder: Record<string, ReturnType<typeof jest.fn>> = {};

  for (const method of ["update", "set", "where", "andWhere"]) {
    queryBuilder[method] = jest.fn(() => {
      return queryBuilder;
    });
  }

  queryBuilder["execute"] = jest.fn(async (): Promise<{ affected: number }> => {
    return { affected };
  });

  jest.spyOn(UserTelegramService, "getRepository").mockReturnValue({
    createQueryBuilder: jest.fn(() => {
      return queryBuilder;
    }),
  } as never);

  return queryBuilder as unknown as AtomicClaimMock;
}

describe("UserTelegramService verification security", () => {
  beforeEach(() => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      enableTelegramNotifications: true,
      smsOrCallCurrentBalanceInUSDCents: 10_000,
    } as Project as never);
    jest.spyOn(TeamMemberService, "findOneBy").mockResolvedValue({
      _id: "44444444-4444-4444-8444-444444444444",
    } as TeamMember as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("creation", () => {
    test("replaces a caller-selected code with a strong server token", async () => {
      const result: OnCreate<UserTelegram> = await callOnBeforeCreate(
        createBy({ verificationCode: "123456" }),
      );

      expect(result.createBy.data.verificationCode).not.toBe("123456");
      expect(
        TelegramVerificationToken.isValidShape(
          result.createBy.data.verificationCode,
        ),
      ).toBe(true);
    });

    test("mints distinct capabilities for separate rows", async () => {
      const first: OnCreate<UserTelegram> =
        await callOnBeforeCreate(createBy());
      const second: OnCreate<UserTelegram> =
        await callOnBeforeCreate(createBy());

      expect(first.createBy.data.verificationCode).not.toBe(
        second.createBy.data.verificationCode,
      );
    });

    test("still refuses non-root callers that claim the row is verified", async () => {
      await expect(
        callOnBeforeCreate(createBy({ isVerified: true })),
      ).rejects.toThrow("isVerified cannot be set to true");
    });

    test("still refuses a caller-selected Telegram chat id", async () => {
      await expect(
        callOnBeforeCreate(createBy({ telegramChatId: "attacker-chat" })),
      ).rejects.toThrow("telegramChatId cannot be set directly");
    });

    test("overrides even a root caller's supplied pending token", async () => {
      const result: OnCreate<UserTelegram> = await callOnBeforeCreate(
        createBy({ verificationCode: "root-chosen" }, true),
      );

      expect(result.createBy.data.verificationCode).not.toBe("root-chosen");
      expect(
        TelegramVerificationToken.isValidShape(
          result.createBy.data.verificationCode,
        ),
      ).toBe(true);
    });

    test("removes a matching project relation before persistence", async () => {
      const relation: Project = new Project();
      relation.id = PROJECT_ID;

      const result: OnCreate<UserTelegram> = await callOnBeforeCreate(
        createBy({ project: relation }),
      );

      expect(result.createBy.data.projectId).toEqual(PROJECT_ID);
      expect(result.createBy.data.project).toBeUndefined();
      expect(ProjectService.findOneById).toHaveBeenCalledWith(
        expect.objectContaining({ id: PROJECT_ID }),
      );
    });

    test("rejects a conflicting project relation before project policy checks", async () => {
      const relation: Project = new Project();
      relation.id = new ObjectID("55555555-5555-4555-8555-555555555555");

      await expect(
        callOnBeforeCreate(createBy({ project: relation })),
      ).rejects.toThrow("Project relation does not match request tenant");
      expect(ProjectService.findOneById).not.toHaveBeenCalled();
    });

    test("rejects the raw relation shape used by create API payloads", async () => {
      const relation: Project = {
        _id: "66666666-6666-4666-8666-666666666666",
      } as Project;

      await expect(
        callOnBeforeCreate(createBy({ project: relation })),
      ).rejects.toThrow("Project relation does not match request tenant");
      expect(ProjectService.findOneById).not.toHaveBeenCalled();
    });

    test("rejects a body project that differs from the authenticated tenant before lookup", async () => {
      const otherProjectId: ObjectID = new ObjectID(
        "77777777-7777-4777-8777-777777777777",
      );

      await expect(
        callOnBeforeCreate(
          createBy({ projectId: otherProjectId }, false, PROJECT_ID),
        ),
      ).rejects.toThrow("Project ID does not match request tenant");
      expect(ProjectService.findOneById).not.toHaveBeenCalled();
    });

    test("stamps an omitted body project from the authenticated tenant before lookup", async () => {
      const pendingCreate: CreateBy<UserTelegram> = createBy(
        {},
        false,
        PROJECT_ID,
      );
      delete pendingCreate.data.projectId;

      const result: OnCreate<UserTelegram> =
        await callOnBeforeCreate(pendingCreate);

      expect(result.createBy.data.projectId).toEqual(PROJECT_ID);
      expect(ProjectService.findOneById).toHaveBeenCalledWith(
        expect.objectContaining({ id: PROJECT_ID }),
      );
    });

    test("preserves an explicit project for root internal creation without a request tenant", async () => {
      const result: OnCreate<UserTelegram> = await callOnBeforeCreate(
        createBy({}, true, undefined),
      );

      expect(result.createBy.data.projectId).toEqual(PROJECT_ID);
      expect(ProjectService.findOneById).toHaveBeenCalledWith(
        expect.objectContaining({ id: PROJECT_ID }),
      );
    });
  });

  describe("getVerificationCode", () => {
    test("returns an existing live capability without rotating it", async () => {
      const token: string = TelegramVerificationToken.mint();
      jest
        .spyOn(UserTelegramService, "findOneById")
        .mockResolvedValue(row({ verificationCode: token }) as never);
      const rotate: ReturnType<typeof jest.spyOn> = jest.spyOn(
        UserTelegramService,
        "regenerateVerificationCode",
      );

      await expect(
        UserTelegramService.getVerificationCode(ITEM_ID),
      ).resolves.toBe(token);
      expect(rotate).not.toHaveBeenCalled();
    });

    test("rotates a legacy six-digit value on first owner view", async () => {
      jest
        .spyOn(UserTelegramService, "findOneById")
        .mockResolvedValue(row({ verificationCode: "123456" }) as never);
      jest
        .spyOn(UserTelegramService, "regenerateVerificationCode")
        .mockResolvedValue("new-strong-token");

      await expect(
        UserTelegramService.getVerificationCode(ITEM_ID),
      ).resolves.toBe("new-strong-token");
    });

    test("rotates an expired capability on the next owner view", async () => {
      const expired: string = TelegramVerificationToken.mint(
        new Date(
          Date.now() - (VERIFICATION_CODE_EXPIRY_MINUTES * 60 * 1000 + 1_000),
        ),
      );
      jest
        .spyOn(UserTelegramService, "findOneById")
        .mockResolvedValue(row({ verificationCode: expired }) as never);
      const rotate: ReturnType<typeof jest.spyOn> = jest
        .spyOn(UserTelegramService, "regenerateVerificationCode")
        .mockResolvedValue("replacement");

      await expect(
        UserTelegramService.getVerificationCode(ITEM_ID),
      ).resolves.toBe("replacement");
      expect(rotate).toHaveBeenCalledWith(ITEM_ID);
    });

    test("returns no reusable token for an already verified row", async () => {
      jest
        .spyOn(UserTelegramService, "findOneById")
        .mockResolvedValue(row({ isVerified: true }) as never);

      await expect(
        UserTelegramService.getVerificationCode(ITEM_ID),
      ).resolves.toBe("");
    });

    test("refuses a missing row", async () => {
      jest.spyOn(UserTelegramService, "findOneById").mockResolvedValue(null);

      await expect(
        UserTelegramService.getVerificationCode(ITEM_ID),
      ).rejects.toThrow("Item not found");
    });
  });

  describe("rotation", () => {
    test("enforces a cooldown for a live capability", async () => {
      const token: string = TelegramVerificationToken.mint();
      jest
        .spyOn(UserTelegramService, "findOneById")
        .mockResolvedValue(row({ verificationCode: token }) as never);
      const update: ReturnType<typeof jest.spyOn> = jest.spyOn(
        UserTelegramService,
        "updateColumnsByIdWithoutHooks",
      );

      await expect(
        UserTelegramService.regenerateVerificationCode(ITEM_ID),
      ).rejects.toThrow("Please wait");
      expect(update).not.toHaveBeenCalled();
    });

    test("rotates after the cooldown and uses compare-and-set", async () => {
      const token: string = TelegramVerificationToken.mint(
        new Date(Date.now() - (RESEND_COOLDOWN_SECONDS + 1) * 1000),
      );
      const find: ReturnType<typeof jest.spyOn> = jest.spyOn(
        UserTelegramService,
        "findOneById",
      );
      find.mockResolvedValueOnce(row({ verificationCode: token }) as never);
      const update: ReturnType<typeof jest.spyOn> = jest
        .spyOn(UserTelegramService, "updateColumnsByIdWithoutHooks")
        .mockResolvedValue(undefined);
      find.mockImplementationOnce(async () => {
        const newToken: string = update.mock.calls[0]![0].data[
          "verificationCode"
        ] as string;
        return row({ verificationCode: newToken }) as never;
      });

      const rotated: string =
        await UserTelegramService.regenerateVerificationCode(ITEM_ID);

      expect(TelegramVerificationToken.isValidShape(rotated)).toBe(true);
      expect(rotated).not.toBe(token);
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: ITEM_ID,
          expectedData: {
            isVerified: false,
            verificationCode: token,
          },
        }),
      );
    });

    test("allows immediate secure replacement of a legacy value", async () => {
      const find: ReturnType<typeof jest.spyOn> = jest.spyOn(
        UserTelegramService,
        "findOneById",
      );
      find.mockResolvedValueOnce(row({ verificationCode: "123456" }) as never);
      const update: ReturnType<typeof jest.spyOn> = jest
        .spyOn(UserTelegramService, "updateColumnsByIdWithoutHooks")
        .mockResolvedValue(undefined);
      find.mockImplementationOnce(async () => {
        return row({
          verificationCode: update.mock.calls[0]![0].data[
            "verificationCode"
          ] as string,
        }) as never;
      });

      const rotated: string =
        await UserTelegramService.regenerateVerificationCode(ITEM_ID);

      expect(TelegramVerificationToken.isValidShape(rotated)).toBe(true);
    });

    test("detects a concurrent rotation instead of returning a stale token", async () => {
      const oldToken: string = TelegramVerificationToken.mint(
        new Date(Date.now() - (RESEND_COOLDOWN_SECONDS + 1) * 1000),
      );
      jest
        .spyOn(UserTelegramService, "findOneById")
        .mockResolvedValueOnce(row({ verificationCode: oldToken }) as never)
        .mockResolvedValueOnce(
          row({ verificationCode: TelegramVerificationToken.mint() }) as never,
        );
      jest
        .spyOn(UserTelegramService, "updateColumnsByIdWithoutHooks")
        .mockResolvedValue(undefined);

      await expect(
        UserTelegramService.regenerateVerificationCode(ITEM_ID),
      ).rejects.toThrow("changed in another request");
    });

    test("detects verification winning the rotation race", async () => {
      const oldToken: string = TelegramVerificationToken.mint(
        new Date(Date.now() - (RESEND_COOLDOWN_SECONDS + 1) * 1000),
      );
      jest
        .spyOn(UserTelegramService, "findOneById")
        .mockResolvedValueOnce(row({ verificationCode: oldToken }) as never)
        .mockResolvedValueOnce(row({ isVerified: true }) as never);
      jest
        .spyOn(UserTelegramService, "updateColumnsByIdWithoutHooks")
        .mockResolvedValue(undefined);

      await expect(
        UserTelegramService.regenerateVerificationCode(ITEM_ID),
      ).rejects.toThrow("already verified");
    });

    test("refuses rotation after the row owner leaves the project", async () => {
      const oldToken: string = TelegramVerificationToken.mint(
        new Date(Date.now() - (RESEND_COOLDOWN_SECONDS + 1) * 1000),
      );
      jest
        .spyOn(UserTelegramService, "findOneById")
        .mockResolvedValueOnce(row({ verificationCode: oldToken }) as never);
      jest.spyOn(TeamMemberService, "findOneBy").mockResolvedValue(null);
      const update: ReturnType<typeof jest.spyOn> = jest.spyOn(
        UserTelegramService,
        "updateColumnsByIdWithoutHooks",
      );

      await expect(
        UserTelegramService.regenerateVerificationCode(ITEM_ID),
      ).rejects.toThrow("Item not found");
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("claimVerificationCode", () => {
    test("rejects malformed and legacy values before a database lookup", async () => {
      const find: ReturnType<typeof jest.spyOn> = jest.spyOn(
        UserTelegramService,
        "findOneBy",
      );

      await expect(
        UserTelegramService.claimVerificationCode({
          verificationCode: "123456",
          telegramChatId: "chat-a",
        }),
      ).resolves.toEqual({ outcome: TelegramVerificationOutcome.Invalid });
      expect(find).not.toHaveBeenCalled();
    });

    test("uses both token equality and unverified state in its lookup", async () => {
      const token: string = TelegramVerificationToken.mint();
      const find: ReturnType<typeof jest.spyOn> = jest
        .spyOn(UserTelegramService, "findOneBy")
        .mockResolvedValue(null);

      await UserTelegramService.claimVerificationCode({
        verificationCode: token,
        telegramChatId: "chat-a",
      });

      expect(find).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { verificationCode: token, isVerified: false },
        }),
      );
    });

    test("refuses a stale link after the row owner has left its project", async () => {
      const token: string = TelegramVerificationToken.mint();
      jest
        .spyOn(UserTelegramService, "findOneBy")
        .mockResolvedValue(row({ verificationCode: token }) as never);
      jest.spyOn(TeamMemberService, "findOneBy").mockResolvedValue(null);
      const getRepository: ReturnType<typeof jest.spyOn> = jest.spyOn(
        UserTelegramService,
        "getRepository",
      );

      await expect(
        UserTelegramService.claimVerificationCode({
          verificationCode: token,
          telegramChatId: "former-member-chat",
        }),
      ).resolves.toEqual({ outcome: TelegramVerificationOutcome.Invalid });

      expect(TeamMemberService.findOneBy).toHaveBeenCalledWith({
        query: {
          projectId: PROJECT_ID,
          userId: USER_ID,
          hasAcceptedInvitation: true,
        },
        select: { _id: true },
        props: { isRoot: true },
      });
      expect(getRepository).not.toHaveBeenCalled();
    });

    test("rejects an expired token without writing the row", async () => {
      const expired: string = TelegramVerificationToken.mint(
        new Date(
          Date.now() - (VERIFICATION_CODE_EXPIRY_MINUTES * 60 * 1000 + 1_000),
        ),
      );
      const find: ReturnType<typeof jest.spyOn> = jest.spyOn(
        UserTelegramService,
        "findOneBy",
      );
      const getRepository: ReturnType<typeof jest.spyOn> = jest.spyOn(
        UserTelegramService,
        "getRepository",
      );

      await expect(
        UserTelegramService.claimVerificationCode({
          verificationCode: expired,
          telegramChatId: "chat-a",
        }),
      ).resolves.toEqual({ outcome: TelegramVerificationOutcome.Expired });
      expect(find).not.toHaveBeenCalled();
      expect(getRepository).not.toHaveBeenCalled();
    });

    test("atomically binds the winning chat and burns the capability", async () => {
      const token: string = TelegramVerificationToken.mint();
      const pending: UserTelegram = row({ verificationCode: token });
      jest
        .spyOn(UserTelegramService, "findOneBy")
        .mockResolvedValue(pending as never);
      const update: AtomicClaimMock = mockAtomicClaim(1);
      jest.spyOn(UserTelegramService, "findOneById").mockResolvedValue(
        row({
          isVerified: true,
          telegramChatId: "chat-a",
        }) as never,
      );

      const result: TelegramVerificationResult =
        await UserTelegramService.claimVerificationCode({
          verificationCode: token,
          telegramChatId: "chat-a",
        });

      expect(result.outcome).toBe(TelegramVerificationOutcome.Verified);
      expect(result.item?.telegramChatId).toBe("chat-a");
      const updateData: Record<string, unknown> = update.set.mock
        .calls[0]![0] as Record<string, unknown>;
      expect(updateData["isVerified"]).toBe(true);
      expect(updateData["telegramChatId"]).toBe("chat-a");
      expect(
        TelegramVerificationToken.isValidShape(
          updateData["verificationCode"] as string,
        ),
      ).toBe(false);
      expect(update.where).toHaveBeenCalledWith('"_id" = :itemId', {
        itemId: ITEM_ID.toString(),
      });
      expect(update.andWhere).toHaveBeenCalledWith(
        '"isVerified" = :isVerified',
        { isVerified: false },
      );
      expect(update.andWhere).toHaveBeenCalledWith(
        '"verificationCode" = :verificationCode',
        { verificationCode: token },
      );

      const membershipGuardCall: Array<unknown> | undefined =
        update.andWhere.mock.calls.find((call: Array<unknown>): boolean => {
          return String(call[0]).includes('FROM "TeamMember"');
        });

      expect(membershipGuardCall).toBeDefined();
      expect(String(membershipGuardCall![0])).toContain(
        '"hasAcceptedInvitation" = TRUE',
      );
      expect(String(membershipGuardCall![0])).toContain('"deletedAt" IS NULL');
      expect(String(membershipGuardCall![0])).toContain("FOR KEY SHARE");
      expect(membershipGuardCall![1]).toEqual({
        projectId: PROJECT_ID.toString(),
        userId: USER_ID.toString(),
      });
      expect(update.execute).toHaveBeenCalledTimes(1);
    });

    test("treats membership revocation that wins the guarded update as a lost claim", async () => {
      const token: string = TelegramVerificationToken.mint();
      jest
        .spyOn(UserTelegramService, "findOneBy")
        .mockResolvedValue(row({ verificationCode: token }) as never);
      const update: AtomicClaimMock = mockAtomicClaim(0);
      const findClaimed: ReturnType<typeof jest.spyOn> = jest.spyOn(
        UserTelegramService,
        "findOneById",
      );

      await expect(
        UserTelegramService.claimVerificationCode({
          verificationCode: token,
          telegramChatId: "former-member-chat",
        }),
      ).resolves.toEqual({
        outcome: TelegramVerificationOutcome.AlreadyClaimed,
      });

      expect(update.execute).toHaveBeenCalledTimes(1);
      expect(findClaimed).not.toHaveBeenCalled();
    });

    test("refuses the losing chat in a simultaneous claim race", async () => {
      const token: string = TelegramVerificationToken.mint();
      jest
        .spyOn(UserTelegramService, "findOneBy")
        .mockResolvedValue(row({ verificationCode: token }) as never);
      mockAtomicClaim(0);
      const findClaimed: ReturnType<typeof jest.spyOn> = jest
        .spyOn(UserTelegramService, "findOneById")
        .mockResolvedValue(
          row({
            isVerified: true,
            telegramChatId: "winning-chat",
          }) as never,
        );

      await expect(
        UserTelegramService.claimVerificationCode({
          verificationCode: token,
          telegramChatId: "losing-chat",
        }),
      ).resolves.toEqual({
        outcome: TelegramVerificationOutcome.AlreadyClaimed,
      });
      expect(findClaimed).not.toHaveBeenCalled();
    });

    test("does not report a simultaneous replay from the winning chat as another winner", async () => {
      const token: string = TelegramVerificationToken.mint();
      jest
        .spyOn(UserTelegramService, "findOneBy")
        .mockResolvedValue(row({ verificationCode: token }) as never);
      mockAtomicClaim(0);
      const findClaimed: ReturnType<typeof jest.spyOn> = jest
        .spyOn(UserTelegramService, "findOneById")
        .mockResolvedValue(
          row({
            isVerified: true,
            telegramChatId: "same-chat",
          }) as never,
        );

      await expect(
        UserTelegramService.claimVerificationCode({
          verificationCode: token,
          telegramChatId: "same-chat",
        }),
      ).resolves.toEqual({
        outcome: TelegramVerificationOutcome.AlreadyClaimed,
      });
      expect(findClaimed).not.toHaveBeenCalled();
    });

    test("does not mistake a missing post-claim row for success", async () => {
      const token: string = TelegramVerificationToken.mint();
      jest
        .spyOn(UserTelegramService, "findOneBy")
        .mockResolvedValue(row({ verificationCode: token }) as never);
      mockAtomicClaim(1);
      jest.spyOn(UserTelegramService, "findOneById").mockResolvedValue(null);

      await expect(
        UserTelegramService.claimVerificationCode({
          verificationCode: token,
          telegramChatId: "chat-a",
        }),
      ).resolves.toEqual({
        outcome: TelegramVerificationOutcome.AlreadyClaimed,
      });
    });
  });
});
