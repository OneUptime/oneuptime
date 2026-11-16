import {
  EMPTY_ERROR_PHRASES,
  isEmptyErrorPhrase,
  isErrorPage,
  isErrorSentence,
  isTooLargePhrase,
  meetsErrorMessageRule,
  TOO_LARGE_PHRASES,
} from "../../../Types/Exception/ErrorMessageRule";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
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

  /*
   * #7536: a letter was a character whose upper and lower case differ, so
   * a message in a script with no capitals had no letters, read as empty,
   * and was replaced with the English sentence for a failure nobody
   * explained. A database set to Japanese, an AI provider's answer, a
   * webhook's response body: each says something.
   */
  test.each([
    ["Persian", "این قاعده را نمی‌توان به یک بررسی تبدیل کرد."],
    ["Arabic", "تعذر الاتصال بقاعدة البيانات."],
    ["Hebrew", "החיבור למסד הנתונים נכשל."],
    ["Japanese", "接続が拒否されました"],
    ["Chinese", "数据库连接失败。"],
    ["Korean", "연결이 거부되었습니다."],
    ["Hindi", "डेटाबेस से कनेक्शन अस्वीकार कर दिया गया।"],
    ["Thai", "การเชื่อมต่อถูกปฏิเสธ"],
    ["Georgian", "კავშირი უარყოფილია."],
    ["Amharic", "ግንኙነቱ ተቀባይነት አላገኘም።"],
    ["Tamil", "இணைப்பு மறுக்கப்பட்டது."],
    ["a CJK letter outside the Basic Multilingual Plane", "𠀀"],
    ["Arabic-Indic digits", "٤٠٤"],
    ["Devanagari digits", "५०३"],
    ["full-width digits", "５０３"],
    ["ASCII digits and symbols", "429 — 60/min"],
    ["a German message", "Die Verbindung zur Datenbank wurde abgelehnt."],
    ["a Russian message", "Соединение отклонено."],
  ])("a message in %s says something", (_script: string, message: string) => {
    expect(isEmptyErrorPhrase(message)).toBe(false);
  });

  test.each([
    // Punctuation and symbols alone, in any script, say nothing.
    "...",
    "—",
    "؟",
    "。",
    "❌",
    "!!! ???",
    "<>",
    // The English empty phrases still are, with marks from other scripts around them.
    "«Server Error»",
    "Server Error。",
    "「Internal Server Error」",
  ])("%j still says nothing", (message: string) => {
    expect(isEmptyErrorPhrase(message)).toBe(true);
  });

  test("an empty phrase with words in another script after it says something", () => {
    expect(isEmptyErrorPhrase("Server Error: 接続が拒否されました")).toBe(
      false,
    );
    expect(isEmptyErrorPhrase("Internal Server Error. Please try again")).toBe(
      true,
    );
  });

  test("a word whose vowel signs are marks is read whole, not cut at each mark", () => {
    // "error" in Hindi is a word, not the English empty phrase "error".
    expect(isEmptyErrorPhrase("त्रुटि")).toBe(false);
    expect(isEmptyErrorPhrase("ข้อผิดพลาด")).toBe(false);
  });

  test("a long message in any script is read in linear time", () => {
    const long: string = "接続が拒否されました。".repeat(20_000);
    const read: FastestRun<boolean> = fastestRun({
      run: (): boolean => {
        return isEmptyErrorPhrase(long);
      },
      limitInMs: 2_000,
    });

    expect(read.result).toBe(false);
    expect(read.inMs).toBeLessThan(2_000);
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

  /*
   * A letter of a script with no capitals starts a sentence as a capital
   * does (#7536), and each script's own full stop or question mark ends it.
   */
  test.each([
    "این قاعده را نمی‌توان به یک بررسی تبدیل کرد.",
    "آیا مطمئن هستید؟",
    "تعذر الاتصال بقاعدة البيانات.",
    "هل أنت متأكد؟",
    "接続が拒否されました。",
    "「接続」が拒否されました。",
    "数据库连接失败。",
    "数据库连接失败！",
    "연결이 거부되었습니다.",
    "डेटाबेस से कनेक्शन अस्वीकार कर दिया गया।",
    "کنکشن مسترد کر دیا گیا۔",
    "החיבור למסד הנתונים נכשל.",
    "٤٠٤ الصفحة غير موجودة.",
    "５０３番のエラーです。",
    "𠀀が見つかりません。",
    "„Nightly Backup“ existiert bereits.",
  ])("%j is a sentence", (message: string) => {
    expect(isErrorSentence(message)).toBe(true);
  });

  test.each([
    // A sentence in a script with no capitals still has to end like one.
    "接続が拒否されました",
    "تعذر الاتصال بقاعدة البيانات",
    // A lower-case Latin letter is still not a capital.
    "ßtraße is not a word.",
    "über is not a capital.",
  ])("%j is not a sentence", (message: string) => {
    expect(isErrorSentence(message)).toBe(false);
  });
});

describe("isErrorPage", () => {
  test.each([
    [
      "nginx's 502",
      "<html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<body>\r\n<center><h1>502 Bad Gateway</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n",
    ],
    [
      "nginx's 413",
      "<html>\n<head><title>413 Request Entity Too Large</title></head>\n<body>\n<center><h1>413 Request Entity Too Large</h1></center>\n</body>\n</html>",
    ],
    [
      "a load balancer's 503",
      "<html><body><h1>503 Service Temporarily Unavailable</h1></body></html>",
    ],
    [
      "a CDN's page with a doctype",
      '<!DOCTYPE html>\n<html lang="en-US"><head><title>Origin is unreachable</title></head><body></body></html>',
    ],
    [
      "Express's default error page",
      '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Error</title>\n</head>\n<body>\n<pre>Cannot POST /api/x</pre>\n</body>\n</html>\n',
    ],
    ["the app's own index.html", '<!doctype html><div id="root"></div>'],
    [
      "an XML error",
      '<?xml version="1.0" encoding="UTF-8"?><Error><Code>AccessDenied</Code></Error>',
    ],
    ["a fragment", "<center><h1>503 Service Unavailable</h1></center>"],
    [
      "a page in another language",
      "<html><body><h1>خطای سرور</h1></body></html>",
    ],
  ])("%s is a page", (_page: string, body: string) => {
    expect(isErrorPage(body)).toBe(true);
  });

  test.each([
    "<script> is not allowed in a name.",
    "The name cannot hold < or >.",
    "1 < 2 > 0",
    "< 5 minutes>",
    "A project with the same name already exists.",
    "接続が拒否されました",
    "",
    "   ",
  ])("%j is not a page", (message: string) => {
    expect(isErrorPage(message)).toBe(false);
  });

  test("nothing at all is not a page", () => {
    expect(isErrorPage(undefined)).toBe(false);
    expect(isErrorPage(null)).toBe(false);
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

  test("a sentence in a script with no capitals meets it", () => {
    expect(meetsErrorMessageRule("数据库连接失败。")).toBe(true);
    expect(meetsErrorMessageRule("آیا مطمئن هستید؟")).toBe(true);
  });
});

/*
 * What a proxy says on its own for a 413 (#8278): its status, which says
 * only that what was sent was too large. API.getFriendlyMessage reads a
 * 413 that says no more than this as the sentence for what was too large;
 * a 413 OneUptime explained in a sentence of its own is not one.
 */
describe("isTooLargePhrase", () => {
  test.each([
    "Request Entity Too Large",
    "request entity too large",
    "REQUEST ENTITY TOO LARGE",
    "Request Entity Too Large.",
    "  Request Entity Too Large\n",
    "413 Request Entity Too Large",
    "413: Request Entity Too Large",
    "Error 413: Payload Too Large",
    "error 413 - payload too large.",
    "HTTP 413 Request Entity Too Large",
    "Status 413: Content Too Large",
    "Payload Too Large",
    "Content Too Large",
    "Entity Too Large",
    "Request Too Large",
    "Request Too Long",
    "Request body too large",
    "http: request body too large",
    "Body too large",
    "Request size limit exceeded",
    "Request body size limit exceeded",
    "Request content length exceeded",
    '"Payload Too Large"',
    "[Request Entity Too Large]",
  ])("%j is only a 413's status", (message: string) => {
    expect(isTooLargePhrase(message)).toBe(true);
  });

  test.each([
    // Said nothing at all: an empty phrase, not a 413's status.
    "",
    "   ",
    "413",
    "Error 413",
    // A sentence of OneUptime's own, with the limit in it.
    "Request body too large. The compressed body of a gzip-encoded request may not exceed 4194304 bytes.",
    "Multipart request rejected: LIMIT_FILE_SIZE.",
    "This file is larger than 10 MB. Choose a smaller file.",
    "Request entity too large: the monitor's steps are larger than 2 MB.",
    // Another status, and words about something else.
    "Too Many Requests",
    "Request Timeout",
    "Server Error",
    "Not too large",
    "Request entity is not too large",
    "414 URI Too Long",
    "Request Header Fields Too Large",
    // In another script: the server's own words.
    "درخواست بیش از حد بزرگ است.",
    "リクエストが大きすぎます。",
    // A page is a page, read by isErrorPage.
    "<html><head><title>413 Request Entity Too Large</title></head></html>",
  ])("%j is not only a 413's status", (message: string) => {
    expect(isTooLargePhrase(message)).toBe(false);
  });

  test("nothing at all is not one", () => {
    expect(isTooLargePhrase(undefined)).toBe(false);
    expect(isTooLargePhrase(null)).toBe(false);
  });

  test("every phrase on the list is in the lower-case words it is compared as", () => {
    for (const phrase of TOO_LARGE_PHRASES) {
      expect(phrase).toBe(phrase.toLowerCase().trim());
      expect(phrase).not.toMatch(/[^a-z ]/);
      expect(isTooLargePhrase(phrase)).toBe(true);
      expect(isTooLargePhrase(`413 ${phrase}`)).toBe(true);
    }
  });

  test("none of them is an empty phrase: each is read only for a 413", () => {
    for (const phrase of TOO_LARGE_PHRASES) {
      expect(isEmptyErrorPhrase(phrase)).toBe(false);
    }
  });

  test("a long message is read in linear time", () => {
    const long: string = "Request Entity Too Large ".repeat(40_000);
    const read: FastestRun<boolean> = fastestRun({
      run: (): boolean => {
        return isTooLargePhrase(long);
      },
      limitInMs: 2_000,
    });

    expect(read.result).toBe(false);
    expect(read.inMs).toBeLessThan(2_000);
  });
});
