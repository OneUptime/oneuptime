import {
  EMPTY_ERROR_PHRASES,
  isEmptyErrorPhrase,
  isErrorSentence,
  meetsErrorMessageRule,
} from "../../../Types/Exception/ErrorMessageRule";
import { describe, expect, test } from "@jest/globals";

/*
 * The part of the error rule (Docs/ux/README.md#errors, #6836) a program
 * can check: a message is a sentence, and more than an empty phrase. The UI
 * reads an empty phrase from the server as a failure nobody explained, and
 * ErrorMessagesGuard holds every thrown message to both checks.
 */

describe("isEmptyErrorPhrase", () => {
  test.each([
    "Server Error",
    "Server Error.",
    "server error",
    "Server Error. Please try again",
    "Server Error. Please try again later.",
    "Internal Server Error",
    "Something went wrong",
    "Something went wrong!",
    "Oops, something went wrong.",
    "Sorry, something went wrong!",
    "Invalid request",
    "Bad request.",
    "An error occurred",
    "An unexpected error has occurred.",
    "Unknown error",
    "Error",
    "Error:",
    "Request failed",
    "Bad Gateway",
    "Please try again.",
    "",
    "   ",
  ])("%j says nothing", (message: string) => {
    expect(isEmptyErrorPhrase(message)).toBe(true);
  });

  test("nothing at all says nothing", () => {
    expect(isEmptyErrorPhrase(undefined)).toBe(true);
    expect(isEmptyErrorPhrase(null)).toBe(true);
  });

  test.each([
    // An empty phrase with what happened after it is a message.
    "Something went wrong while drawing it.",
    "Server Error: the database is not connected.",
    "Invalid request: the monitor's interval must be at least a minute.",
    "A project with the same name already exists. Choose another name.",
    "Promo code is invalid.",
    "Error connecting to server. Please try again in few minutes.",
    // A name that happens to hold the words.
    "Server Errors",
  ])("%j says something", (message: string) => {
    expect(isEmptyErrorPhrase(message)).toBe(false);
  });

  test("every phrase on the list is in the lower-case words it is compared as", () => {
    for (const phrase of EMPTY_ERROR_PHRASES) {
      expect(phrase).toBe(phrase.toLowerCase().trim());
      expect(isEmptyErrorPhrase(phrase)).toBe(true);
    }
  });
});

describe("isErrorSentence", () => {
  test.each([
    "The monitor was not saved.",
    "Are you sure?",
    "Stop!",
    "{{name}} is already taken.",
    "${name} is already taken.",
    "2FA is not set up for this account.",
    '"Nightly Backup" already exists.',
    "Pick a probe (at least one).",
    'The value must be "yes."',
    "Several sentences. The last one ends right.",
  ])("%j is a sentence", (message: string) => {
    expect(isErrorSentence(message)).toBe(true);
  });

  test.each([
    "Project with the same name already exists",
    "projectId is required.",
    "invalid code.",
    "Invalid code",
    'URL scheme "ftp": is not supported:',
    "",
    "   ",
  ])("%j is not a sentence", (message: string) => {
    expect(isErrorSentence(message)).toBe(false);
  });

  test("nothing at all is not a sentence", () => {
    expect(isErrorSentence(undefined)).toBe(false);
    expect(isErrorSentence(null)).toBe(false);
  });
});

describe("meetsErrorMessageRule", () => {
  test("a sentence that says what happened meets it", () => {
    expect(
      meetsErrorMessageRule(
        "This team no longer exists. Reload the page and pick another team.",
      ),
    ).toBe(true);
  });

  test("an empty phrase does not, even written as a sentence", () => {
    expect(meetsErrorMessageRule("Something went wrong.")).toBe(false);
    expect(meetsErrorMessageRule("Server Error.")).toBe(false);
  });

  test("a message that is not a sentence does not", () => {
    expect(meetsErrorMessageRule("Invalid Team ID")).toBe(false);
  });
});
