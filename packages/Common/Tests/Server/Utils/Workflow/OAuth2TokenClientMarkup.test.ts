import OAuth2TokenClient, {
  OAUTH2_TOKEN_RESPONSE_MAX_BYTES,
  OAuth2TokenHttpResponse,
  OAuth2TokenRequestException,
} from "../../../../Server/Utils/Workflow/OAuth2TokenClient";
import { replaceHtmlMarkup } from "../../../../Types/HtmlMarkup";
import { OAuth2GrantType } from "../../../../Types/Workflow/WorkflowVariableOAuth";
import {
  SINGLE_PASS_LEFTOVERS,
  WELL_FORMED_MARKUP,
  generatedTexts,
} from "../../../Types/HtmlMarkupCases";
import { describe, expect, test } from "@jest/globals";

/*
 * When a token endpoint does not answer with a token, the error message
 * quotes what it did answer - an error page, the OAuth error and its
 * description, or where it redirected to - so the person who set the
 * variable up can see what went wrong. That quote (OAuth2TokenClient's
 * toExcerpt) is what the variable's Access Token card shows, what the API
 * returns from Refresh now, and what the workflow run log and the failed
 * step say.
 *
 * The answer comes from whatever server the Token URL names. The quote took
 * tags out of it with one pass of /<[^>]*>/, which kept an unclosed tag as
 * it came, ended a tag at a ">" inside a quoted attribute value and kept the
 * rest of the value, and ended a comment at its first ">". It now reads tags
 * and comments with replaceHtmlMarkup (Common/Types/HtmlMarkup), the walk
 * the rest of the product reads HTML with - each still becomes a space - so:
 *
 *   - the error pages and error bodies token endpoints really answer with
 *     are quoted exactly as before;
 *   - the markup a single pass left behind comes out whole;
 *   - no message holds a "<" of the answer, whatever the answer;
 *   - an answer of a megabyte, the most a token request reads, is read in
 *     time that grows with its length alone.
 */

const NOW: Date = new Date("2026-10-11T07:00:00.000Z");

const BODY_PREFIX: string = "The token endpoint answered HTTP 502: ";
const BODY_SUFFIX: string = ". Check the Token URL.";
const EMPTY_BODY_MESSAGE: string =
  "The token endpoint answered HTTP 502 with an empty body. Check the Token URL.";

// An error code with no hint of its own, so the message ends with the quote.
const DESCRIPTION_PREFIX: string =
  "The token endpoint refused the request (HTTP 503): temporarily_unavailable - ";

const REDIRECT_PREFIX: string =
  "The token endpoint answered with a redirect (HTTP 302) to ";
const REDIRECT_SUFFIX: string =
  ". OneUptime does not follow redirects on token requests; set the Token URL to the address the token endpoint actually answers on.";

const WHITESPACE_RUN: RegExp = /\s+/g;

// The message an answer that carries no token is refused with.
function refusalOf(response: OAuth2TokenHttpResponse): string {
  try {
    OAuth2TokenClient.parseTokenResponse(response, {
      grantType: OAuth2GrantType.ClientCredentials,
      now: NOW,
    });
  } catch (err) {
    if (err instanceof OAuth2TokenRequestException) {
      return err.message;
    }

    throw err;
  }

  throw new Error("The answer was read as a token.");
}

// The quote between a message's known start and end.
function quoteBetween(message: string, start: string, end: string): string {
  if (!message.startsWith(start) || !message.endsWith(end)) {
    throw new Error(`Not the message expected: ${message}`);
  }

  return message.slice(start.length, message.length - end.length);
}

// What the message quotes of an error page a token endpoint answered with.
function quoteOfPage(body: string): string {
  const message: string = refusalOf({
    statusCode: 502,
    bodyText: body,
    headers: { "content-type": "text/html" },
  });

  return message === EMPTY_BODY_MESSAGE
    ? ""
    : quoteBetween(message, BODY_PREFIX, BODY_SUFFIX);
}

// What the message quotes of the error_description an OAuth error carried.
function quoteOfDescription(description: string): string {
  return quoteBetween(
    refusalOf({
      statusCode: 503,
      bodyText: JSON.stringify({
        error: "temporarily_unavailable",
        error_description: description,
      }),
      headers: { "content-type": "application/json" },
    }),
    DESCRIPTION_PREFIX,
    ".",
  );
}

// What the message quotes of the address a redirect pointed at.
function quoteOfRedirect(location: string): string {
  return quoteBetween(
    refusalOf({
      statusCode: 302,
      bodyText: "",
      headers: { location: location },
    }),
    REDIRECT_PREFIX,
    REDIRECT_SUFFIX,
  );
}

/*
 * Answers token endpoints really send when something is wrong, and what the
 * message quoted of each before this change. It still quotes exactly that.
 */
const REAL_ERROR_PAGES: Array<[string, string, string]> = [
  [
    "nginx's 502 page",
    "<html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<body>\r\n<center><h1>502 Bad Gateway</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n",
    "502 Bad Gateway 502 Bad Gateway nginx",
  ],
  [
    "Apache's 404 page",
    '<!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML 2.0//EN">\n<html><head>\n<title>404 Not Found</title>\n</head><body>\n<h1>Not Found</h1>\n<p>The requested URL was not found on this server.</p>\n<hr>\n<address>Apache/2.4.58 (Ubuntu) Server at login.example.com Port 443</address>\n</body></html>\n',
    "404 Not Found Not Found The requested URL was not found on this server. Apache/2.4.58 (Ubuntu) Server at login.example.com Port 443",
  ],
  [
    "IIS's 404 page, its style rules inside a comment",
    '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">\n<html xmlns="http://www.w3.org/1999/xhtml">\n<head>\n<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1"/>\n<title>404 - File or directory not found.</title>\n<style type="text/css">\n<!--\nbody{margin:0;font-size:.7em;font-family:Verdana, Arial, Helvetica, sans-serif;background:#EEEEEE;}\nfieldset{padding:0 15px 10px 15px;}\n-->\n</style>\n</head>\n<body>\n<div id="header"><h1>Server Error</h1></div>\n<div id="content">\n <div class="content-container"><fieldset>\n  <h2>404 - File or directory not found.</h2>\n  <h3>The resource you are looking for might have been removed, had its name changed, or is temporarily unavailable.</h3>\n </fieldset></div>\n</div>\n</body>\n</html>\n',
    "404 - File or directory not found. Server Error 404 - File or directory not found. The resource you are looking for might have been removed, had its name changed, or is temporarily unavailable.",
  ],
  [
    "a load balancer's 503 page",
    "<html>\r\n<head><title>503 Service Temporarily Unavailable</title></head>\r\n<body>\r\n<center><h1>503 Service Temporarily Unavailable</h1></center>\r\n</body>\r\n</html>\r\n",
    "503 Service Temporarily Unavailable 503 Service Temporarily Unavailable",
  ],
  [
    "a block page with conditional comments, a script and a style",
    '<!DOCTYPE html>\n<!--[if lt IE 7]> <html class="no-js ie6 oldie" lang="en-US"> <![endif]-->\n<!--[if IE 7]>    <html class="no-js ie7 oldie" lang="en-US"> <![endif]-->\n<!--[if gt IE 8]><!--> <html class="no-js" lang="en-US"> <!--<![endif]-->\n<head>\n<title>Attention Required! | Cloudflare</title>\n<meta charset="UTF-8" />\n<style>body{margin:0}</style>\n<script>(function(){window._cf_chl_opt={cvId: "3"};})();</script>\n</head>\n<body>\n<div id="cf-wrapper">\n<h1 data-translate="block_headline">Sorry, you have been blocked</h1>\n<h2 class="cf-subheadline"><span data-translate="unable_to_access">You are unable to access</span> login.example.com</h2>\n<p data-translate="blocked_why_detail">This website is using a security service to protect itself from online attacks.</p>\n</div>\n</body>\n</html>\n',
    "Attention Required! | Cloudflare Sorry, you have been blocked You are unable to access login.example.com This website is using a security service to protect itself from online attacks.",
  ],
  [
    "a sign-in page, which a Token URL set to the authorization endpoint answers",
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Sign in to Example</title><script>window.__CONFIG__ = {"next":"/token?a=1&b=2"};</script><link rel="stylesheet" href="/s.css"></head><body><form method="post" action="/login"><label for="u">Username or email</label><input id="u" name="username" type="text"><button type="submit">Sign In</button></form></body></html>',
    "Sign in to Example Username or email Sign In",
  ],
  [
    "a JSON error that is not an OAuth error",
    '{"message":"Not Found","documentation_url":"https://docs.github.com/rest"}',
    '{"message":"Not Found","documentation_url":"https://docs.github.com/rest"}',
  ],
  [
    "a framework's JSON error",
    '{"timestamp":"2026-10-11T07:00:00.000+00:00","status":405,"path":"/oauth2/v2.0/authorize"}',
    '{"timestamp":"2026-10-11T07:00:00.000+00:00","status":405,"path":"/oauth2/v2.0/authorize"}',
  ],
  ["a plain-text answer", "Bad Request", "Bad Request"],
  [
    "a plain-text answer ending in a line break",
    "Service Unavailable\n",
    "Service Unavailable",
  ],
  [
    "a page of a heading alone",
    "<html><body><h1>Sign in</h1></body></html>",
    "Sign in",
  ],
  ["an empty page", "", ""],
];

const REAL_DESCRIPTIONS: Array<[string, string, string]> = [
  [
    "Microsoft Entra ID's, longer than a quote",
    "AADSTS7000215: Invalid client secret provided. Ensure the secret being sent in the request is the client secret value, not the client secret ID, for a secret added to app '9f2c1d44-7a3b-4c5d-8e6f-0a1b2c3d4e5f'. Trace ID: 0d1e2f3a-4b5c-6d7e-8f90-a1b2c3d4e5f6 Correlation ID: 1a2b3c4d-5e6f-7a8b-9c0d-e1f2a3b4c5d6 Timestamp: 2026-10-11 07:00:00Z",
    "AADSTS7000215: Invalid client secret provided. Ensure the secret being sent in the request is the client secret value, not the client secret ID, for a secret added to app '9f2c1d44-7a3b-4c5d-8e6f-0a1b2c3d4e5f'. Trace ID: 0d1e2f3a-4b5c-6d7e-8f90-a1b2c3d4e5f6 Correlation ID: 1a2b3c4d-5e6f-7a8b-9c0d-e1…",
  ],
  [
    "Okta's",
    "The client secret supplied for a confidential client is invalid.",
    "The client secret supplied for a confidential client is invalid.",
  ],
  [
    "Keycloak's",
    "Invalid client or Invalid client credentials",
    "Invalid client or Invalid client credentials",
  ],
  [
    "GitHub's",
    "The code passed is incorrect or expired.",
    "The code passed is incorrect or expired.",
  ],
  [
    "Google's",
    "Token has been expired or revoked.",
    "Token has been expired or revoked.",
  ],
  ["a comparison with a space after it", "a < b > c", "a c"],
];

/*
 * Markup a single pass of a tag pattern left behind, and the quote of each
 * now: the whole tag or comment is out, and no "<" is left.
 */
const LEFTOVER_PAGES: Array<[string, string, string]> = [
  [
    "a comment holding '>'",
    "<html><!-- build > 42 --><body><h1>Bad Gateway</h1></body></html>",
    "Bad Gateway",
  ],
  [
    "a quoted attribute value holding '>'",
    '<p><a title="a > b" href="/login">Sign in</a> again</p>',
    "Sign in again",
  ],
  [
    "an unclosed tag",
    "<html><body>Error <img src=x onerror=alert(1)",
    "Error img src=x onerror=alert(1)",
  ],
  [
    "a tag inside a tag's name, around a script element",
    "<scr<script>ipt>alert(1)</script>",
    "scr",
  ],
  ["an unclosed end tag", "error <b>bold</b", "error bold/b"],
  ["an overlapping comment", "<!<!---->--", "--"],
  ["a tag before a tag", "<<script>script>alert(1)", "script>alert(1)"],
  [
    "a comment holding a whole tag",
    "a<!-- x > <img src=x> -->b",
    "a b",
  ],
];

describe("an OAuth error message quotes what the token endpoint answered", () => {
  test.each(REAL_ERROR_PAGES)(
    "%s is quoted exactly as before",
    (_case: string, body: string, quote: string) => {
      expect(quoteOfPage(body)).toBe(quote);
    },
  );

  test.each(REAL_DESCRIPTIONS)(
    "%s description is quoted exactly as before",
    (_case: string, description: string, quote: string) => {
      expect(quoteOfDescription(description)).toBe(quote);
    },
  );

  test("a redirect's address is quoted exactly as before", () => {
    expect(quoteOfRedirect("https://login.example.com/v2/token")).toBe(
      "https://login.example.com/v2/token",
    );
  });

  test.each(LEFTOVER_PAGES)(
    "%s comes out whole",
    (_case: string, body: string, quote: string) => {
      expect(quoteOfPage(body)).toBe(quote);
      expect(quoteOfPage(body)).not.toContain("<");
    },
  );

  test("the same markup in a description or a redirect's address comes out whole too", () => {
    for (const [, body, quote] of LEFTOVER_PAGES) {
      expect(quoteOfDescription(body)).toBe(quote);
      expect(quoteOfRedirect(body)).toBe(quote);
    }
  });

  test("entities are quoted as they are, and never read into markup", () => {
    expect(
      quoteOfPage("<p>&lt;img src=x onerror=alert(1)&gt; &amp;lt;b&amp;gt;</p>"),
    ).toBe("&lt;img src=x onerror=alert(1)&gt; &amp;lt;b&amp;gt;");
  });

  test("a '<' that opens nothing that ends is dropped on its own, as the walk drops one everywhere", () => {
    expect(quoteOfDescription("x <= 5 and y < 3")).toBe("x = 5 and y 3");
  });
});

describe("script and style elements", () => {
  test.each([
    [
      "a script element, with a tag in what it holds",
      '<p>a</p><script>var b = "<p>";</script><p>c</p>',
      "a c",
    ],
    [
      "elements in upper case, with attributes",
      '<SCRIPT type="text/javascript">if (a > b) { go(); }</SCRIPT>after',
      "after",
    ],
    ["a style element", "<style>p { color: red }</style>text", "text"],
    [
      "a script then a style, each more than once",
      "<script>1</script>a<style>2</style>b<script>3</script>c<style>4</style>d",
      "a b c d",
    ],
    [
      "a script element that never closes, whose tags the walk takes out",
      "<p>Error</p><script>var a = 1;",
      "Error var a = 1;",
    ],
    [
      "a script that closes, then one that never does",
      "<script>a</script>x<script>b",
      "x b",
    ],
  ])(
    "%s",
    (_case: string, body: string, quote: string) => {
      expect(quoteOfPage(body)).toBe(quote);
    },
  );
});

describe("whatever the answer", () => {
  const generated: Array<string> = generatedTexts(20000, 3141);

  test("no message holds a '<' of it", () => {
    expect(
      generated.some((text: string): boolean => {
        return text.includes("<");
      }),
    ).toBe(true);

    const withAngleBracket: Array<string> = generated.filter(
      (text: string): boolean => {
        return (
          quoteOfPage(text).includes("<") ||
          quoteOfDescription(`x${text}`).includes("<") ||
          quoteOfRedirect(`x${text}`).includes("<")
        );
      },
    );

    expect(withAngleBracket).toEqual([]);
  });

  test("markup is read exactly as replaceHtmlMarkup reads it, each tag and comment a space", () => {
    const differences: Array<[string, string, string]> = [];

    for (const text of [
      ...generated,
      ...SINGLE_PASS_LEFTOVERS,
      ...WELL_FORMED_MARKUP,
    ]) {
      if (text.toLowerCase().includes("</script>")) {
        // A closed script element goes with what it holds; see above.
        continue;
      }

      const quote: string = quoteOfPage(text);
      const walked: string = replaceHtmlMarkup(text, (): string => {
        return " ";
      })
        .replace(WHITESPACE_RUN, " ")
        .trim();

      if (quote !== walked) {
        differences.push([text, quote, walked]);
      }
    }

    expect(differences.slice(0, 5)).toEqual([]);
  });
});

describe("time", () => {
  /*
   * A token answer can be up to a megabyte. The single pass, and the script
   * and style patterns, looked for a tag's end again from every "<" that had
   * none: minutes for a megabyte. Each answer here is read in far less than
   * the limit, which is set high so a slow machine does not fail it.
   */
  const LIMIT_IN_MS: number = 3000;
  const SIZE: number = OAUTH2_TOKEN_RESPONSE_MAX_BYTES;

  const repeatTo: (unit: string) => string = (unit: string): string => {
    return unit.repeat(Math.floor(SIZE / unit.length));
  };

  test.each([
    ["tags that never close", repeatTo("<a")],
    ["a run of '<' before an unclosed value", `${repeatTo("<")}=">`],
    ["values that open and close", `${repeatTo('<a b="')}>`],
    ["script elements that never close", repeatTo("<script")],
    ["style elements that never close", repeatTo("<style")],
    ["comment openings", `${repeatTo("<!--")}>`],
    ["whitespace and control characters", repeatTo(" \t\u0001\n")],
  ])("reads a megabyte of %s in linear time", (_case: string, body: string) => {
    const started: number = Date.now();
    const message: string = refusalOf({
      statusCode: 502,
      bodyText: body,
      headers: { "content-type": "text/html" },
    });

    expect(Date.now() - started).toBeLessThan(LIMIT_IN_MS);
    expect(message).not.toContain("<");
  });
});
