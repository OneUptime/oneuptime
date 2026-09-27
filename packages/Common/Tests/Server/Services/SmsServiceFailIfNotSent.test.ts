import SmsService from "../../../Server/Services/SmsService";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import API from "../../../Utils/API";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Common's SmsService posts every SMS to the Notification service's
 * /api/notification/sms/send. failIfNotSent asks that route to answer with an
 * error, not success, for an SMS it deliberately does not send (SMS turned
 * off, too little balance); the status page subscriber jobs set it so such an
 * SMS counts as failed. It is sent only when asked for, so every other
 * caller's request is unchanged.
 */

describe("SmsService.sendSms and failIfNotSent", () => {
  let post: MockFunction;

  beforeEach(() => {
    post = getJestMockFunction();
    post.mockResolvedValue({} as never);
    jest.spyOn(API, "post").mockImplementation(post as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function postedBody(): JSONObject {
    return (post.mock.calls[0]![0] as { data: JSONObject }).data;
  }

  test("sends failIfNotSent when the caller asks", async () => {
    await SmsService.sendSms(
      { to: new Phone("+15555550123"), message: "Hello" },
      { projectId: ObjectID.generate(), failIfNotSent: true },
    );

    expect(postedBody()["failIfNotSent"]).toBe(true);
  });

  test("leaves it out otherwise, so other callers' requests are unchanged", async () => {
    await SmsService.sendSms(
      { to: new Phone("+15555550123"), message: "Hello" },
      { projectId: ObjectID.generate() },
    );
    await SmsService.sendSms(
      { to: new Phone("+15555550123"), message: "Hello" },
      { projectId: ObjectID.generate(), failIfNotSent: false },
    );

    for (const call of post.mock.calls) {
      expect("failIfNotSent" in (call[0] as { data: JSONObject }).data).toBe(
        false,
      );
    }
  });
});
