import ServerEmailLogUtil, {
  MAX_SERVER_EMAIL_LOG_SKIP,
  SERVER_EMAIL_LOG_FAILED_ONLY_QUERY,
  SERVER_EMAIL_LOG_SKIP_QUERY,
  ServerEmailLogStatus,
} from "../../../Types/Email/ServerEmailLog";
import { describe, expect, test } from "@jest/globals";

/*
 * The server's email log as the Admin Dashboard asks for it and reads it
 * (#6878): the page it asks for, and an answer read strictly - a row it
 * cannot read is left out, and an answer it cannot read is none.
 */

const ENTRY: Record<string, unknown> = {
  id: "68780000-0000-4000-8000-0000000000b1",
  at: "2026-11-17T10:00:00.000Z",
  toEmail: "alice@example.test",
  subject: "Password Reset Request for OneUptime",
  templateName: "ForgotPassword",
  status: "sent",
  statusMessage: "Email sent.",
  projectId: null,
  projectName: null,
};

describe("the page asked for", () => {
  test("every email from the first is the bare route", () => {
    expect(
      ServerEmailLogUtil.toQueryParams({ failedOnly: false, skip: 0 }),
    ).toEqual({});
  });

  test("the failed emails, from the second page", () => {
    expect(
      ServerEmailLogUtil.toQueryParams({ failedOnly: true, skip: 25 }),
    ).toEqual({
      [SERVER_EMAIL_LOG_FAILED_ONLY_QUERY]: "true",
      [SERVER_EMAIL_LOG_SKIP_QUERY]: "25",
    });
  });

  test("is read back as asked", () => {
    expect(
      ServerEmailLogUtil.readQuery({ failedOnly: "true", skip: "25" }),
    ).toEqual({ failedOnly: true, skip: 25 });
  });

  test.each([
    [{}, { failedOnly: false, skip: 0 }],
    [
      { failedOnly: "1", skip: "abc" },
      { failedOnly: false, skip: 0 },
    ],
    [
      { failedOnly: ["true"], skip: "-3" },
      { failedOnly: false, skip: 0 },
    ],
    [{ skip: "2.5" }, { failedOnly: false, skip: 0 }],
    [
      { skip: String(MAX_SERVER_EMAIL_LOG_SKIP * 10) },
      { failedOnly: false, skip: MAX_SERVER_EMAIL_LOG_SKIP },
    ],
  ])(
    "anything else asks for less: %j",
    (query: Record<string, unknown>, expected: Record<string, unknown>) => {
      expect(ServerEmailLogUtil.readQuery(query)).toEqual(expected);
    },
  );
});

describe("the answer", () => {
  test("is read as it was sent", () => {
    expect(
      ServerEmailLogUtil.parseAnswer({
        entries: [ENTRY],
        hasMore: true,
        retentionInDays: 30,
      }),
    ).toEqual({
      entries: [{ ...ENTRY, status: ServerEmailLogStatus.Sent }],
      hasMore: true,
      retentionInDays: 30,
    });
  });

  test("a row with no address, no time or an unknown status is left out", () => {
    const answer: unknown = {
      entries: [
        ENTRY,
        { ...ENTRY, toEmail: "" },
        { ...ENTRY, at: "yesterday" },
        { ...ENTRY, status: "bounced" },
        "not a row",
      ],
      hasMore: false,
      retentionInDays: 30,
    };

    expect(ServerEmailLogUtil.parseAnswer(answer)?.entries).toHaveLength(1);
  });

  test.each([
    [null],
    [[]],
    [{ entries: [], hasMore: "no", retentionInDays: 30 }],
    [{ entries: {}, hasMore: false, retentionInDays: 30 }],
    [{ entries: [], hasMore: false, retentionInDays: 0 }],
    [{ entries: [], hasMore: false }],
  ])("one that is not an answer is none: %j", (value: unknown) => {
    expect(ServerEmailLogUtil.parseAnswer(value)).toBeNull();
  });
});
