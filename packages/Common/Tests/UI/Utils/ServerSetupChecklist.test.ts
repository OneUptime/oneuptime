import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import ServerSetupChecklistLoader, {
  sendServerTest,
  SERVER_SETUP_CHECKLIST_ROUTE,
} from "../../../UI/Utils/ServerSetupChecklist";
import ServerSendingStatusLoader from "../../../UI/Utils/ServerSending";
import API from "../../../UI/Utils/API/API";
import User from "../../../UI/Utils/User";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import { ServerSendingChannel } from "../../../Types/ServerSending/ServerSendingStatus";
import ServerSetupChecklistUtil, {
  ServerSetupCheckId,
  ServerSetupChecklistAnswer,
  ServerSetupChoiceKind,
  ServerSetupStatus,
} from "../../../Types/ServerSetup/ServerSetupChecklist";
import {
  ServerTestSendAnswer,
  ServerTestSendResult,
} from "../../../Types/ServerSetup/ServerTestSend";

/*
 * THE SETUP CHECKLIST, AS A MASTER ADMIN'S PAGE READS IT (#6824).
 *
 * One request per page load serves every component that draws the
 * checklist - the Admin Dashboard's landing and Server setup page, the
 * Dashboard's card - and only a master admin's page asks. A read that fails
 * draws nothing and is asked again. A choice or a hide answers the
 * checklist as it now stands, which every component then reads. A test
 * send goes to the Notification service, and makes the checklist and the
 * banner read again: how it went changes what they say.
 */

const ANSWER: JSONObject = {
  checks: [
    { id: "email", status: "untested", tests: ["email"] },
    { id: "https", status: "done" },
    { id: "signups", status: "not-set-up", canChoose: "skipped" },
  ],
  isHiddenForReader: false,
};

function ok(body: JSONObject): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, body, {});
}

let fetch: ReturnType<typeof jest.spyOn>;
let post: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  ServerSetupChecklistLoader.clear();
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(true);
  fetch = jest.spyOn(API, "fetch").mockResolvedValue(ok(ANSWER) as never);
  post = jest.spyOn(API, "post").mockResolvedValue(ok(ANSWER) as never);
});

afterEach(() => {
  ServerSetupChecklistLoader.clear();
  jest.restoreAllMocks();
});

describe("loading the checklist", () => {
  test("a master admin's page asks once, at /global-config/setup-checklist, for every component", async () => {
    const [first, second] = await Promise.all([
      ServerSetupChecklistLoader.load(),
      ServerSetupChecklistLoader.load(),
    ]);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String((fetch.mock.calls[0]![0] as { url: unknown }).url)).toContain(
      SERVER_SETUP_CHECKLIST_ROUTE,
    );
    expect(first).toBe(second);
    expect(first?.openRequired).toEqual([
      ServerSetupCheckId.Email,
      ServerSetupCheckId.Signups,
    ]);
  });

  test("anybody else's page never asks", async () => {
    jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);

    expect(await ServerSetupChecklistLoader.load()).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  test("a refusal or a page that is not an answer draws nothing, and is asked again next time", async () => {
    fetch.mockResolvedValueOnce(
      new HTTPErrorResponse(403, { message: "Forbidden" }, {}) as never,
    );

    expect(await ServerSetupChecklistLoader.load()).toBeNull();

    fetch.mockResolvedValueOnce(ok({ html: "<p>proxy</p>" }) as never);

    expect(await ServerSetupChecklistLoader.load()).toBeNull();

    expect(await ServerSetupChecklistLoader.load()).not.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  test("a request that throws draws nothing", async () => {
    fetch.mockRejectedValueOnce(new Error("offline") as never);

    expect(await ServerSetupChecklistLoader.load()).toBeNull();
  });

  test("clear() asks again", async () => {
    await ServerSetupChecklistLoader.load();
    ServerSetupChecklistLoader.clear();
    await ServerSetupChecklistLoader.load();

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("a choice, and hiding the card", () => {
  test("a choice posts the check and the choice, and what the server answers is what every component then reads", async () => {
    const answered: JSONObject = {
      checks: [{ id: "signups", status: "skipped" }],
    };
    post.mockResolvedValueOnce(ok(answered) as never);

    const answer: ServerSetupChecklistAnswer =
      await ServerSetupChecklistLoader.choose(
        ServerSetupCheckId.Signups,
        ServerSetupChoiceKind.Skipped,
      );

    const call: { url: unknown; data: unknown } = post.mock.calls[0]![0] as {
      url: unknown;
      data: unknown;
    };

    expect(String(call.url)).toContain(
      `${SERVER_SETUP_CHECKLIST_ROUTE}/choice`,
    );
    expect(call.data).toEqual({ check: "signups", choice: "skipped" });
    expect(
      ServerSetupChecklistUtil.getCheck(answer, ServerSetupCheckId.Signups)
        ?.status,
    ).toBe(ServerSetupStatus.Skipped);

    // Read from what the server answered, without asking again.
    expect(await ServerSetupChecklistLoader.load()).toEqual(answer);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("undo posts null", async () => {
    await ServerSetupChecklistLoader.choose(ServerSetupCheckId.Backups, null);

    expect((post.mock.calls[0]![0] as { data: unknown }).data).toEqual({
      check: "backups",
      choice: null,
    });
  });

  test("hide posts to /hide", async () => {
    await ServerSetupChecklistLoader.hide();

    expect(String((post.mock.calls[0]![0] as { url: unknown }).url)).toContain(
      `${SERVER_SETUP_CHECKLIST_ROUTE}/hide`,
    );
  });

  test("a refused choice throws, and keeps what was read", async () => {
    await ServerSetupChecklistLoader.load();
    post.mockResolvedValueOnce(
      new HTTPErrorResponse(400, { message: "No." }, {}) as never,
    );

    await expect(
      ServerSetupChecklistLoader.choose(
        ServerSetupCheckId.Signups,
        ServerSetupChoiceKind.Skipped,
      ),
    ).rejects.toBeDefined();
    expect(await ServerSetupChecklistLoader.load()).not.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("a test send", () => {
  const ACCEPTED: ServerTestSendAnswer = {
    channel: ServerSendingChannel.Email,
    result: ServerTestSendResult.Accepted,
    to: "ada@example.com",
    sentThrough: "smtp.example.com",
    message: null,
  };

  test("an email goes to the Notification service's /server-test/email with the address", async () => {
    post.mockResolvedValueOnce(ok(ACCEPTED as unknown as JSONObject) as never);

    const answer: ServerTestSendAnswer = await sendServerTest({
      channel: ServerSendingChannel.Email,
      to: "ada@example.com",
    });

    const call: { url: unknown; data: unknown } = post.mock.calls[0]![0] as {
      url: unknown;
      data: unknown;
    };

    expect(String(call.url)).toMatch(/\/notification\/server-test\/email$/);
    expect(call.data).toEqual({ toEmail: "ada@example.com" });
    expect(answer).toEqual(ACCEPTED);
  });

  test("SMS and calls go with the number", async () => {
    for (const channel of [
      ServerSendingChannel.SMS,
      ServerSendingChannel.Call,
    ]) {
      post.mockResolvedValueOnce(
        ok({ ...ACCEPTED, channel: channel, to: "+14155550100" }) as never,
      );

      await sendServerTest({ channel: channel, to: "+14155550100" });

      const call: { url: unknown; data: unknown } = post.mock.calls.at(
        -1,
      )![0] as {
        url: unknown;
        data: unknown;
      };

      expect(String(call.url)).toMatch(
        new RegExp(`/notification/server-test/${channel}$`),
      );
      expect(call.data).toEqual({ toPhone: "+14155550100" });
    }
  });

  test("afterwards the checklist and the banner are read again", async () => {
    await ServerSetupChecklistLoader.load();
    const clearBanner: ReturnType<typeof jest.spyOn> = jest.spyOn(
      ServerSendingStatusLoader,
      "clear",
    );
    post.mockResolvedValueOnce(ok(ACCEPTED as unknown as JSONObject) as never);

    await sendServerTest({
      channel: ServerSendingChannel.Email,
      to: "ada@example.com",
    });
    await ServerSetupChecklistLoader.load();

    expect(clearBanner).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("a refused request (an address that is not one) throws; an answer that is not one throws", async () => {
    post.mockResolvedValueOnce(
      new HTTPErrorResponse(
        400,
        { message: "Enter the email address to send the test to." },
        {},
      ) as never,
    );

    await expect(
      sendServerTest({ channel: ServerSendingChannel.Email, to: "nope" }),
    ).rejects.toBeDefined();

    post.mockResolvedValueOnce(ok({ ok: true }) as never);

    await expect(
      sendServerTest({ channel: ServerSendingChannel.Email, to: "a@b.co" }),
    ).rejects.toBeDefined();
  });
});
