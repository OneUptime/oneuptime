import AiCreditsUsedUpOwnerNotice, {
  AiCreditsUsedUpNoticeOutcome,
} from "../../../../Server/Utils/AI/AiCreditsUsedUpOwnerNotice";
import ProjectService from "../../../../Server/Services/ProjectService";
import logger from "../../../../Server/Utils/Logger";
import Project from "../../../../Models/DatabaseModels/Project";
import URL from "../../../../Types/API/URL";
import ObjectID from "../../../../Types/ObjectID";
import SafeHtml from "../../../../Types/SafeHtml";
import {
  getProjectBalanceOwnerSentence,
  PROJECT_AI_AUTO_RECHARGE_COULD_NOT_ADD_OWNER_SENTENCE,
  PROJECT_AI_CREDITS_USED_UP_OWNER_FREQUENCY_SENTENCE,
  PROJECT_AI_CREDITS_USED_UP_OWNER_SENTENCE,
  ProjectBalanceType,
} from "../../../../Utils/Project/ProjectBalance";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The email a project's owners get when its AI credits run out: once each
 * time they run out, decided by one conditional UPDATE of the project row
 * (ProjectService.claimAiCreditsUsedUpNotice), again only after they have
 * been added to. What it says depends on Auto Recharge: off - add credits or
 * turn it on; on but it could not add more - check the payment method. It
 * links to AI Credits, which the owners may use, and never throws.
 */

interface DashboardAddress {
  url: URL | undefined;
}

const address: DashboardAddress = { url: undefined };

(
  globalThis as unknown as { __aiCreditsNoticeAddress: DashboardAddress }
).__aiCreditsNoticeAddress = address;

jest.mock("../../../../Server/EnvironmentConfig", () => {
  const mocked: Record<string, unknown> = {
    ...(jest.requireActual("../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
  };

  Object.defineProperty(mocked, "DashboardClientUrl", {
    get: (): URL | undefined => {
      return (
        globalThis as unknown as {
          __aiCreditsNoticeAddress: DashboardAddress | undefined;
        }
      ).__aiCreditsNoticeAddress?.url;
    },
  });

  return mocked;
});

const PROJECT_ID: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-0000000000d1",
);

const DASHBOARD: string = "https://oneuptime.example.com/dashboard";
const AI_CREDITS_LINK: string = `${DASHBOARD}/${PROJECT_ID.toString()}/settings/ai-credits`;

let claim: jest.SpyInstance;
let findProject: jest.SpyInstance;
let sendEmail: jest.SpyInstance;

function project(values: Record<string, unknown> = {}): Project {
  return {
    _id: PROJECT_ID.toString(),
    name: "Acme Production",
    aiCurrentBalanceInUSDCents: 0,
    enableAutoRechargeAiBalance: false,
    autoAiRechargeByBalanceInUSD: 20,
    autoRechargeAiWhenCurrentBalanceFallsInUSD: 10,
    lowAiBalanceNotificationSentToOwners: false,
    ...values,
  } as unknown as Project;
}

function sentEmail(): { subject: string; body: string } {
  const call: Array<unknown> = sendEmail.mock.calls[0] as Array<unknown>;

  return { subject: call[1] as string, body: call[2] as string };
}

beforeEach(() => {
  address.url = URL.fromString(DASHBOARD);
  claim = jest
    .spyOn(ProjectService, "claimAiCreditsUsedUpNotice")
    .mockResolvedValue(true);
  findProject = jest
    .spyOn(ProjectService, "findOneById")
    .mockResolvedValue(project());
  sendEmail = jest
    .spyOn(ProjectService, "sendEmailToProjectOwners")
    .mockResolvedValue(undefined);
  jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("AiCreditsUsedUpOwnerNotice.notifyIfFirst", () => {
  test("the first caller wins the claim and emails the owners once", async () => {
    expect(
      await AiCreditsUsedUpOwnerNotice.notifyIfFirst({
        projectId: PROJECT_ID,
        isAutoRechargeOn: false,
      }),
    ).toBe(AiCreditsUsedUpNoticeOutcome.Told);

    expect(claim).toHaveBeenCalledWith(PROJECT_ID);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0]![0]).toEqual(PROJECT_ID);
    expect(sentEmail().subject).toBe("AI credits used up for Acme Production");
  });

  test("every other caller loses the claim: no email", async () => {
    claim.mockResolvedValue(false);

    expect(
      await AiCreditsUsedUpOwnerNotice.notifyIfFirst({
        projectId: PROJECT_ID,
        isAutoRechargeOn: false,
      }),
    ).toBe(AiCreditsUsedUpNoticeOutcome.AlreadyTold);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test("a row that says the owners were told costs no claim at all", async () => {
    expect(
      await AiCreditsUsedUpOwnerNotice.notifyIfFirst({
        projectId: PROJECT_ID,
        isAutoRechargeOn: false,
        alreadyTold: true,
      }),
    ).toBe(AiCreditsUsedUpNoticeOutcome.AlreadyTold);
    expect(claim).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test("a claim that cannot be made never throws, and sends nothing", async () => {
    claim.mockRejectedValue(new Error("database unavailable"));

    expect(
      await AiCreditsUsedUpOwnerNotice.notifyIfFirst({
        projectId: PROJECT_ID,
        isAutoRechargeOn: false,
      }),
    ).toBe(AiCreditsUsedUpNoticeOutcome.Failed);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  test("an email that cannot be sent after the claim never throws (and is not sent twice)", async () => {
    sendEmail.mockRejectedValue(new Error("mail down"));

    expect(
      await AiCreditsUsedUpOwnerNotice.notifyIfFirst({
        projectId: PROJECT_ID,
        isAutoRechargeOn: false,
      }),
    ).toBe(AiCreditsUsedUpNoticeOutcome.Failed);
    expect(claim).toHaveBeenCalledTimes(1);
  });

  test("a project without a name still gets a subject", async () => {
    findProject.mockResolvedValue(project({ name: "" }));

    await AiCreditsUsedUpOwnerNotice.notifyIfFirst({
      projectId: PROJECT_ID,
      isAutoRechargeOn: false,
    });

    expect(sentEmail().subject).toBe("AI credits used up for your project");
  });

  test("Auto Recharge off: add credits or turn it on, with the link to AI Credits", async () => {
    await AiCreditsUsedUpOwnerNotice.notifyIfFirst({
      projectId: PROJECT_ID,
      isAutoRechargeOn: false,
    });

    const body: string = sentEmail().body;

    expect(body).toContain(
      SafeHtml.escape(PROJECT_AI_CREDITS_USED_UP_OWNER_SENTENCE),
    );
    expect(body).toContain(
      SafeHtml.escape(getProjectBalanceOwnerSentence(ProjectBalanceType.AI)),
    );
    expect(body).toContain(`<a href="${AI_CREDITS_LINK}">${AI_CREDITS_LINK}</a>`);
    expect(body).toContain(
      SafeHtml.escape(PROJECT_AI_CREDITS_USED_UP_OWNER_FREQUENCY_SENTENCE),
    );
  });

  test("Auto Recharge on but it could not add more: check the payment method - not 'turn on Auto Recharge'", async () => {
    await AiCreditsUsedUpOwnerNotice.notifyIfFirst({
      projectId: PROJECT_ID,
      isAutoRechargeOn: true,
    });

    const body: string = sentEmail().body;

    expect(body).toContain(
      SafeHtml.escape(PROJECT_AI_AUTO_RECHARGE_COULD_NOT_ADD_OWNER_SENTENCE),
    );
    expect(body).not.toContain("turn on Auto Recharge");
    expect(body).toContain(`<a href="${AI_CREDITS_LINK}">${AI_CREDITS_LINK}</a>`);
  });
});

describe("AiCreditsUsedUpOwnerNotice.getHtml", () => {
  test("what happened, what to do with the link, and how often - in that order, as escaped HTML", () => {
    const html: string = AiCreditsUsedUpOwnerNotice.getHtml({
      projectId: PROJECT_ID,
      isAutoRechargeOn: false,
    });

    expect(html).toBe(
      [
        "This project&#39;s AI credits are used up, so OneUptime AI has stopped: Ask AI, investigations and the other AI features paid from them are refused until credits are added.",
        `Add AI credits in Project Settings → AI Credits, or turn on Auto Recharge there so they do not run out. <br/> <br/> <a href="${AI_CREDITS_LINK}">${AI_CREDITS_LINK}</a>`,
        "Project owners get this email once each time the AI credits run out.",
      ].join(" <br/> <br/> "),
    );
  });

  test("the one link is AI Credits", () => {
    const html: string = AiCreditsUsedUpOwnerNotice.getHtml({
      projectId: PROJECT_ID,
      isAutoRechargeOn: true,
    });

    expect(html.match(/<a href=/g)).toHaveLength(1);
    expect(html).not.toContain("Project Settings > Billing");
    expect(html).toContain("Project Settings &gt; Billing");
  });

  test("without the dashboard's address, no link - the sentences still say where", () => {
    address.url = undefined;

    const html: string = AiCreditsUsedUpOwnerNotice.getHtml({
      projectId: PROJECT_ID,
      isAutoRechargeOn: false,
    });

    expect(html).not.toContain("<a href=");
    expect(html).toContain("Project Settings → AI Credits");
  });

  test("names no one else: it goes to the owners, who may add credits", () => {
    for (const isAutoRechargeOn of [true, false]) {
      const html: string = AiCreditsUsedUpOwnerNotice.getHtml({
        projectId: PROJECT_ID,
        isAutoRechargeOn,
      });

      expect(html).not.toContain("A project owner or someone with");
      expect(html).not.toMatch(/please/i);
    }
  });
});

describe("AiCreditsUsedUpOwnerNotice.notifyIfUsedUp", () => {
  test("credits left: nothing to tell, no claim", async () => {
    findProject.mockResolvedValue(project({ aiCurrentBalanceInUSDCents: 1 }));

    expect(
      await AiCreditsUsedUpOwnerNotice.notifyIfUsedUp({ projectId: PROJECT_ID }),
    ).toBe(AiCreditsUsedUpNoticeOutcome.NotUsedUp);
    expect(claim).not.toHaveBeenCalled();
  });

  test("used up: the owners are told, from what the row says", async () => {
    findProject.mockResolvedValue(project({ aiCurrentBalanceInUSDCents: -3 }));

    expect(
      await AiCreditsUsedUpOwnerNotice.notifyIfUsedUp({ projectId: PROJECT_ID }),
    ).toBe(AiCreditsUsedUpNoticeOutcome.Told);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  test("it reads the balance, Auto Recharge and the flag in one read, as root", async () => {
    await AiCreditsUsedUpOwnerNotice.notifyIfUsedUp({ projectId: PROJECT_ID });

    expect(findProject.mock.calls[0]![0]).toEqual({
      id: PROJECT_ID,
      select: {
        aiCurrentBalanceInUSDCents: true,
        enableAutoRechargeAiBalance: true,
        autoAiRechargeByBalanceInUSD: true,
        autoRechargeAiWhenCurrentBalanceFallsInUSD: true,
        lowAiBalanceNotificationSentToOwners: true,
      },
      props: { isRoot: true },
    });
  });

  test("Auto Recharge on (it could not refill them): the payment method sentence", async () => {
    findProject.mockResolvedValue(project({ enableAutoRechargeAiBalance: true }));

    await AiCreditsUsedUpOwnerNotice.notifyIfUsedUp({ projectId: PROJECT_ID });

    expect(sentEmail().body).toContain(
      SafeHtml.escape(PROJECT_AI_AUTO_RECHARGE_COULD_NOT_ADD_OWNER_SENTENCE),
    );
  });

  test("the row says the owners were told: no claim", async () => {
    findProject.mockResolvedValue(
      project({ lowAiBalanceNotificationSentToOwners: true }),
    );

    expect(
      await AiCreditsUsedUpOwnerNotice.notifyIfUsedUp({ projectId: PROJECT_ID }),
    ).toBe(AiCreditsUsedUpNoticeOutcome.AlreadyTold);
    expect(claim).not.toHaveBeenCalled();
  });

  test("a project that is gone: nothing to tell", async () => {
    findProject.mockResolvedValue(null);

    expect(
      await AiCreditsUsedUpOwnerNotice.notifyIfUsedUp({ projectId: PROJECT_ID }),
    ).toBe(AiCreditsUsedUpNoticeOutcome.NotUsedUp);
  });

  test("a row that cannot be read never throws", async () => {
    findProject.mockRejectedValue(new Error("database unavailable"));

    expect(
      await AiCreditsUsedUpOwnerNotice.notifyIfUsedUp({ projectId: PROJECT_ID }),
    ).toBe(AiCreditsUsedUpNoticeOutcome.Failed);
  });
});

describe("ProjectService.claimAiCreditsUsedUpNotice", () => {
  test("is one compare-and-set of the flag, from not told to told, that leaves updatedAt alone", async () => {
    claim.mockRestore();
    const compareAndSet: jest.SpyInstance = jest
      .spyOn(ProjectService, "compareAndSetColumnsByIdWithoutHooks")
      .mockResolvedValue(true);

    expect(await ProjectService.claimAiCreditsUsedUpNotice(PROJECT_ID)).toBe(
      true,
    );
    expect(compareAndSet).toHaveBeenCalledWith({
      id: PROJECT_ID,
      data: { lowAiBalanceNotificationSentToOwners: true },
      expectedData: { lowAiBalanceNotificationSentToOwners: false },
      skipUpdateDateColumn: true,
    });
  });

  test("answers false when somebody already set it", async () => {
    claim.mockRestore();
    jest
      .spyOn(ProjectService, "compareAndSetColumnsByIdWithoutHooks")
      .mockResolvedValue(false);

    expect(await ProjectService.claimAiCreditsUsedUpNotice(PROJECT_ID)).toBe(
      false,
    );
  });
});
