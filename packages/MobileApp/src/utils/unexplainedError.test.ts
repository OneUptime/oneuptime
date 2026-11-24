import { describe, expect, test } from "@jest/globals";
import {
  EMPTY_ERROR_PHRASES,
  ERROR_REFERENCE_FIELD,
  ERROR_REFERENCE_LENGTH,
  getUnexplainedServerErrorMessage,
  isEmptyErrorPhrase,
  isErrorPage,
  isErrorReference,
  SERVER_DOWN_SENTENCE,
  SERVER_DOWN_WORDS,
  UNEXPLAINED_ERROR_MESSAGES,
} from "./unexplainedError";
import {
  ERROR_REFERENCE_FIELD as SERVER_ERROR_REFERENCE_FIELD,
  ERROR_REFERENCE_LENGTH as SERVER_ERROR_REFERENCE_LENGTH,
  getUnexplainedServerErrorMessage as getServerUnexplainedErrorMessage,
  isErrorReference as isServerErrorReference,
  UNEXPLAINED_ERROR_MESSAGES as SERVER_UNEXPLAINED_ERROR_MESSAGES,
  UnexplainedErrorWords,
} from "../../../Common/Types/Exception/UnexplainedError";
import {
  EMPTY_ERROR_PHRASES as SERVER_EMPTY_ERROR_PHRASES,
  isEmptyErrorPhrase as isServerEmptyErrorPhrase,
  isErrorPage as isServerErrorPage,
} from "../../../Common/Types/Exception/ErrorMessageRule";

/*
 * THE APP'S COPY OF AN ERROR NOBODY EXPLAINED, HELD TO COMMON'S (#7275).
 *
 * The app imports nothing from Common at run time, so it keeps its own copy
 * of the server's sentences for a failure nobody explained, the reference's
 * field and shape, and the empty phrases it never shows. A copy drifts:
 * these hold it to Common's word for word, and its readings to Common's
 * own, so a change on either side fails here.
 */

describe("the app's copy of the sentences", () => {
  test("says the server's sentence for each kind, word for word", () => {
    expect(UNEXPLAINED_ERROR_MESSAGES).toEqual(
      SERVER_UNEXPLAINED_ERROR_MESSAGES,
    );
  });

  test("says a gateway's error as the Dashboard does, in one line", () => {
    expect(SERVER_DOWN_WORDS).toEqual({
      why: UnexplainedErrorWords.serverDownWhy,
      next: UnexplainedErrorWords.serverDownNext,
    });
    expect(SERVER_DOWN_SENTENCE).toBe(
      `${UnexplainedErrorWords.serverDownWhy} ${UnexplainedErrorWords.serverDownNext}`,
    );
  });

  test("fills the reference in as the server does", () => {
    expect(getUnexplainedServerErrorMessage("1f0c9a2b")).toBe(
      getServerUnexplainedErrorMessage("1f0c9a2b"),
    );
    expect(getUnexplainedServerErrorMessage(null)).toBe(
      getServerUnexplainedErrorMessage(null),
    );
    expect(getUnexplainedServerErrorMessage("not one")).toBe(
      getServerUnexplainedErrorMessage("not one"),
    );
  });
});

describe("the app's copy of the reference", () => {
  test("reads the field the server writes, of the length it keeps", () => {
    expect(ERROR_REFERENCE_FIELD).toBe(SERVER_ERROR_REFERENCE_FIELD);
    expect(ERROR_REFERENCE_LENGTH).toBe(SERVER_ERROR_REFERENCE_LENGTH);
  });

  test.each([
    "1f0c9a2b",
    "abcdef01",
    "ABCDEF01",
    "1f0c9a2",
    "1f0c9a2bc",
    "zzzzzzzz",
    "",
    12345678,
    null,
  ])("tells %p a reference as the server does", (value: unknown) => {
    expect(isErrorReference(value)).toBe(isServerErrorReference(value));
  });
});

describe("the app's copy of the empty phrases", () => {
  test("names every phrase Common names, and no other", () => {
    expect([...EMPTY_ERROR_PHRASES]).toEqual([...SERVER_EMPTY_ERROR_PHRASES]);
  });

  test.each([
    "Server Error",
    "Internal Server Error.",
    "Oops, something went wrong! Please try again",
    "Please try again",
    "",
    "Monitor name already exists",
    "The server ran into a problem it could not explain, so this did not finish. Try again in a moment.",
    "Сервер не ответил.",
  ])("reads %p as the Dashboard does", (message: string) => {
    expect(isEmptyErrorPhrase(message)).toBe(isServerEmptyErrorPhrase(message));
  });

  test.each([
    "<html><head><title>502 Bad Gateway</title></head></html>",
    "<!DOCTYPE html><html></html>",
    "<script> is not allowed in a name.",
    "Bad Gateway",
  ])("tells %p a page as the Dashboard does", (message: string) => {
    expect(isErrorPage(message)).toBe(isServerErrorPage(message));
  });
});
