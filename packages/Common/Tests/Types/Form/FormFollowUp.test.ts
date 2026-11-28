import {
  cleanFormFollowUpName,
  FORM_FOLLOW_UP_ADD_PERSON_ROUTE,
  FORM_FOLLOW_UP_FILES_FIELD_ID,
  FORM_FOLLOW_UP_MAX_PEOPLE,
  FORM_FOLLOW_UP_MESSAGE_FIELD_ID,
  FORM_FOLLOW_UP_MESSAGE_MAX_LENGTH,
  FORM_FOLLOW_UP_NAME_MAX_LENGTH,
  FORM_FOLLOW_UP_NAME_TOO_LONG_MESSAGE,
  FORM_FOLLOW_UP_PARAMETER,
  FORM_FOLLOW_UP_RECORD_ROUTE,
  FORM_FOLLOW_UP_REPLY_ROUTE,
  FORM_FOLLOW_UP_ROUTE,
  FORM_FOLLOW_UP_STOP_ROUTE,
  FORM_FOLLOW_UP_TOKEN_LENGTH,
  FORM_FOLLOW_UP_TOO_MANY_PEOPLE_MESSAGE,
  FORM_MY_REQUESTS_PARAMETER,
  FORM_MY_REQUESTS_ROUTE,
  FORM_REQUEST_PARAMETER,
  formatFormFollowUpCredential,
  getFormFollowUpPersonLabel,
  getFormFollowUpRecordRoute,
  getFormFollowUpReplyFields,
  isWellFormedFormFollowUpToken,
  readFormFollowUpCredential,
  readFormFollowUpEmail,
} from "../../../Types/Form/FormFollowUp";
import { CUSTOM_FIELD_FILE_TYPES } from "../../../Types/CustomField/CustomFieldFile";
import {
  FORM_FILE_MAX_SIZE_IN_BYTES,
  FORM_FILE_QUESTION_MAX_FILES,
} from "../../../Types/Form/FormFileAnswer";
import {
  PublicFormField,
  PublicFormFieldType,
  validateFormAnswer,
} from "../../../Types/Form/FormPublic";
import FormTargetType from "../../../Types/Form/FormTargetType";
import { describe, expect, test } from "@jest/globals";

/*
 * The contract a form's follow-ups share between the server, the form's page
 * and the dashboard (Types/Form/FormFollowUp): its routes and parameters, the
 * credential a link carries, and the checks on what a person types.
 */

const FOLLOWER_ID: string = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const TOKEN: string = "a".repeat(32) + "0123456789abcdef0123456789abcdef";

describe("the routes and parameters", () => {
  test("every public route sits under the follow-up route, apart from each other", () => {
    const routes: Array<string> = [
      FORM_FOLLOW_UP_ROUTE,
      FORM_FOLLOW_UP_REPLY_ROUTE,
      FORM_FOLLOW_UP_ADD_PERSON_ROUTE,
      FORM_FOLLOW_UP_STOP_ROUTE,
      FORM_MY_REQUESTS_ROUTE,
    ];

    expect(new Set(routes).size).toBe(routes.length);

    for (const route of routes) {
      expect(route.startsWith("/follow-up")).toBe(true);
    }
  });

  test("the address parameters are distinct, and none is one the form's page already reads", () => {
    const parameters: Array<string> = [
      FORM_FOLLOW_UP_PARAMETER,
      FORM_REQUEST_PARAMETER,
      FORM_MY_REQUESTS_PARAMETER,
    ];

    expect(new Set(parameters).size).toBe(3);
    expect(parameters).not.toContain("template");
    expect(parameters).not.toContain("loginCode");
    expect(parameters).not.toContain("resetPasswordToken");
  });

  test("a record's dashboard route names its type and id, escaped", () => {
    expect(
      getFormFollowUpRecordRoute({
        recordType: FormTargetType.ScheduledMaintenance,
        recordId: FOLLOWER_ID,
      }),
    ).toBe(`${FORM_FOLLOW_UP_RECORD_ROUTE}/ScheduledMaintenance/${FOLLOWER_ID}`);

    expect(
      getFormFollowUpRecordRoute({
        recordType: FormTargetType.Incident,
        recordId: "../x",
      }),
    ).toBe(`${FORM_FOLLOW_UP_RECORD_ROUTE}/Incident/..%2Fx`);
  });
});

describe("a link's credential", () => {
  test("is the person's id and their token, joined by a hyphen, in lower case", () => {
    expect(
      formatFormFollowUpCredential({
        followerId: FOLLOWER_ID.toUpperCase(),
        token: TOKEN.toUpperCase(),
      }),
    ).toBe(`${FOLLOWER_ID}-${TOKEN}`);
  });

  test("reads back what it was written as", () => {
    expect(
      readFormFollowUpCredential(
        formatFormFollowUpCredential({ followerId: FOLLOWER_ID, token: TOKEN }),
      ),
    ).toEqual({ followerId: FOLLOWER_ID, token: TOKEN });
  });

  test("is read whatever its case and surrounding space", () => {
    expect(
      readFormFollowUpCredential(`  ${FOLLOWER_ID}-${TOKEN}  `.toUpperCase()),
    ).toEqual({ followerId: FOLLOWER_ID, token: TOKEN });
  });

  test.each([
    ["nothing", undefined],
    ["a number", 42],
    ["an object", { followerId: FOLLOWER_ID, token: TOKEN }],
    ["an empty text", ""],
    ["the id alone", FOLLOWER_ID],
    ["the token alone", TOKEN],
    ["a token one character short", `${FOLLOWER_ID}-${TOKEN.slice(1)}`],
    ["a token one character long", `${FOLLOWER_ID}-${TOKEN}0`],
    ["a token that is not hex", `${FOLLOWER_ID}-${"g".repeat(64)}`],
    ["an id that is not a UUID", `${"x".repeat(36)}-${TOKEN}`],
    ["the two the wrong way round", `${TOKEN}-${FOLLOWER_ID}`],
    ["something huge", "a".repeat(100000)],
  ])("is nothing for %s", (_name: string, value: unknown) => {
    expect(readFormFollowUpCredential(value)).toBeNull();
  });

  test("a token is 64 lowercase hex characters", () => {
    expect(FORM_FOLLOW_UP_TOKEN_LENGTH).toBe(64);
    expect(isWellFormedFormFollowUpToken(TOKEN)).toBe(true);
    expect(isWellFormedFormFollowUpToken(TOKEN.toUpperCase())).toBe(false);
    expect(isWellFormedFormFollowUpToken(TOKEN.slice(1))).toBe(false);
    expect(isWellFormedFormFollowUpToken(null)).toBe(false);
    expect(isWellFormedFormFollowUpToken(123)).toBe(false);
  });
});

describe("the address of somebody added", () => {
  test("is one ordinary address, in lower case", () => {
    expect(readFormFollowUpEmail("  Jane.Doe@Example.COM ")).toBe(
      "jane.doe@example.com",
    );
  });

  test.each([
    ["nothing", undefined],
    ["a number", 7],
    ["an empty text", "   "],
    ["no domain", "jane@"],
    ["two addresses", "jane@example.com, bob@example.com"],
    ["a name and an address", "Jane <jane@example.com>"],
    ["an address too long", `${"a".repeat(95)}@example.com`],
  ])("is refused for %s", (_name: string, value: unknown) => {
    expect(readFormFollowUpEmail(value)).toBeNull();
  });
});

describe("the name of somebody added", () => {
  test("is kept on one line, trimmed", () => {
    expect(cleanFormFollowUpName("  Jane \n Doe  ")).toEqual({
      name: "Jane Doe",
    });
  });

  test("is left out when empty or not given", () => {
    expect(cleanFormFollowUpName(undefined)).toEqual({});
    expect(cleanFormFollowUpName(null)).toEqual({});
    expect(cleanFormFollowUpName("   ")).toEqual({});
  });

  test("is refused past its length, or when it is not text", () => {
    expect(
      cleanFormFollowUpName("x".repeat(FORM_FOLLOW_UP_NAME_MAX_LENGTH + 1)),
    ).toEqual({ error: FORM_FOLLOW_UP_NAME_TOO_LONG_MESSAGE });
    expect(
      cleanFormFollowUpName("x".repeat(FORM_FOLLOW_UP_NAME_MAX_LENGTH)),
    ).toEqual({ name: "x".repeat(FORM_FOLLOW_UP_NAME_MAX_LENGTH) });
    expect(cleanFormFollowUpName(["Jane"])).toEqual({
      error: FORM_FOLLOW_UP_NAME_TOO_LONG_MESSAGE,
    });
  });

  test("the refusals say their limits", () => {
    expect(FORM_FOLLOW_UP_NAME_TOO_LONG_MESSAGE).toBe(
      "A name cannot be more than 100 characters.",
    );
    expect(FORM_FOLLOW_UP_TOO_MANY_PEOPLE_MESSAGE).toBe(
      `A request can have at most ${FORM_FOLLOW_UP_MAX_PEOPLE} people following it.`,
    );
  });
});

describe("how a person is named", () => {
  test("by their name, else their address", () => {
    expect(
      getFormFollowUpPersonLabel({ name: " Jane ", email: "jane@x.test" }),
    ).toBe("Jane");
    expect(getFormFollowUpPersonLabel({ name: "", email: "jane@x.test" })).toBe(
      "jane@x.test",
    );
    expect(getFormFollowUpPersonLabel({})).toBe("");
  });
});

describe("the reply box's questions", () => {
  const fields: Array<PublicFormField> = getFormFollowUpReplyFields();
  const message: PublicFormField = fields[0]!;
  const files: PublicFormField = fields[1]!;

  test("are a Markdown message and a Multiple Files question, neither required", () => {
    expect(message.id).toBe(FORM_FOLLOW_UP_MESSAGE_FIELD_ID);
    expect(message.type).toBe(PublicFormFieldType.Markdown);
    expect(message.isRequired).toBe(false);
    expect(message.maxLength).toBe(FORM_FOLLOW_UP_MESSAGE_MAX_LENGTH);

    expect(files.id).toBe(FORM_FOLLOW_UP_FILES_FIELD_ID);
    expect(files.type).toBe(PublicFormFieldType.MultipleFiles);
    expect(files.isRequired).toBe(false);
  });

  test("take files as a form's own file question does", () => {
    expect(files.fileTypes).toEqual([...CUSTOM_FIELD_FILE_TYPES]);
    expect(files.maxFileSizeInBytes).toBe(FORM_FILE_MAX_SIZE_IN_BYTES);
    expect(files.maxFiles).toBe(FORM_FILE_QUESTION_MAX_FILES);
  });

  test("are a fresh copy each time, so nobody changes another's", () => {
    const first: Array<PublicFormField> = getFormFollowUpReplyFields();
    first[1]!.fileTypes!.push("text/x-anything");

    expect(getFormFollowUpReplyFields()[1]!.fileTypes).toEqual([
      ...CUSTOM_FIELD_FILE_TYPES,
    ]);
  });

  test("are checked with a form's own answer check", () => {
    expect(
      validateFormAnswer({ field: message, answer: "Still broken" }),
    ).toEqual({ isValid: true, value: "Still broken" });

    const tooLong: ReturnType<typeof validateFormAnswer> = validateFormAnswer(
      {
        field: message,
        answer: "x".repeat(FORM_FOLLOW_UP_MESSAGE_MAX_LENGTH + 1),
      },
    );

    expect(tooLong.isValid).toBe(false);

    const notFiles: ReturnType<typeof validateFormAnswer> = validateFormAnswer(
      { field: files, answer: [{ name: "x" }] },
    );

    expect(notFiles.isValid).toBe(false);
  });
});
