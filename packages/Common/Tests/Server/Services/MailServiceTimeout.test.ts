import MailService from "../../../Server/Services/MailService";
import EmptyResponseData from "../../../Types/API/EmptyResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Email from "../../../Types/Email";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../Utils/API";
import { getJestSpyOn } from "../../Spy";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * MailService.sendMail hands an email to the notification service. A caller
 * that waits for each email in turn - the one-time owner notice, in the
 * migrate Job (ProjectService.sendEmailToOwnersAndWait) - gives it a
 * timeout, so a mail service that hangs never holds the run for longer than
 * that. Every other caller leaves it unbounded, as before.
 */
describe("MailService.sendMail's timeout", () => {
  const mail: Record<string, unknown> = {
    toEmail: new Email("owner@acme.example"),
    templateType: EmailTemplateType.SimpleMessage,
    vars: { subject: "API keys stopped working", message: "m" },
    subject: "API keys stopped working",
    isSubjectLiteral: true,
  };

  const taken: () => HTTPResponse<EmptyResponseData> =
    (): HTTPResponse<EmptyResponseData> => {
      return new HTTPResponse<EmptyResponseData>(200, {}, {});
    };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a timeout given bounds the request to the mail service", async () => {
    const post: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      API,
      "post",
    ).mockResolvedValue(taken());

    await MailService.sendMail(mail as never, {
      projectId: ObjectID.generate(),
      timeoutInMs: 1234,
    });

    expect(post).toHaveBeenCalledTimes(1);

    const request: {
      options?: { timeout?: number };
      data: Record<string, unknown>;
    } = post.mock.calls[0]![0] as {
      options?: { timeout?: number };
      data: Record<string, unknown>;
    };

    expect(request.options).toEqual({ timeout: 1234 });
    // How long to wait is not part of the email.
    expect(request.data["timeoutInMs"]).toBeUndefined();
    expect(request.data["toEmail"]).toBe("owner@acme.example");
  });

  test("no timeout given, none set: as every other email", async () => {
    const post: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      API,
      "post",
    ).mockResolvedValue(taken());

    await MailService.sendMail(mail as never, {
      projectId: ObjectID.generate(),
    });

    expect(
      (post.mock.calls[0]![0] as { options?: unknown }).options,
    ).toBeUndefined();
  });
});
