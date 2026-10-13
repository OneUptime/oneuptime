import { beforeEach, describe, expect, test } from "@jest/globals";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import ResponseUtil from "../../../Server/Utils/Response";

/*
 * sendMarkdownResponse serves the docs' pages as Markdown
 * (/docs/as-markdown/...), for tools and AI assistants. It used to send them
 * as text/html with no charset: a browser, and a search engine, parsed the
 * page source as HTML - a `<project-id>` in it became a tag and an
 * `<a href="...">` in a code sample a link to follow - and read a translated
 * page in the wrong encoding.
 */

interface CapturedResponse {
  statusCode: number | null;
  headers: Record<string, string>;
  body: string | null;
}

describe("Response.sendMarkdownResponse", () => {
  let captured: CapturedResponse;
  let response: ExpressResponse;

  beforeEach(() => {
    captured = { statusCode: null, headers: {}, body: null };

    response = {
      writeHead: (code: number, headers: Record<string, string>): void => {
        captured.statusCode = code;
        captured.headers = { ...captured.headers, ...headers };
      },
      end: (body: string): void => {
        captured.body = body;
      },
    } as unknown as ExpressResponse;
  });

  test("sends Markdown as text/markdown in UTF-8, never as HTML", () => {
    ResponseUtil.sendMarkdownResponse(
      {} as ExpressRequest,
      response,
      "# Webhooks\n\nSend it to `https://oneuptime.com/heartbeat/<key>`.\n",
    );

    expect(captured.statusCode).toBe(200);
    expect(captured.headers["Content-Type"]).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(captured.headers["Content-Type"]).not.toContain("html");
  });

  test("sends the Markdown exactly as it was given", () => {
    const markdown: string =
      '# Webhooks\n\n<a href="/x">kept as written</a> and `<project-id>`\n\n日本語のページ\n';

    ResponseUtil.sendMarkdownResponse({} as ExpressRequest, response, markdown);

    expect(captured.body).toBe(markdown);
  });

  test("keeps what it sent for the request log, as Markdown", () => {
    ResponseUtil.sendMarkdownResponse(
      {} as ExpressRequest,
      response,
      "# Title\n",
    );

    expect(
      (response as unknown as { logBody: Record<string, string> }).logBody,
    ).toEqual({ markdown: "# Title\n" });
  });
});
