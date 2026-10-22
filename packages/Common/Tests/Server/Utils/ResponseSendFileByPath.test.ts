import { describe, expect, jest, test } from "@jest/globals";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import ResponseUtil from "../../../Server/Utils/Response";

/*
 * sendFileByPath sends a file from disk. Without a callback, Express hands a
 * file it cannot send - a missing one too - to the server's error handler,
 * which answers 500; the blog's file route (Home/API/BlogAPI.ts) passes one
 * to answer a missing file with its 404 page instead.
 */

interface SentFile {
  headers: Record<string, string>;
  calls: Array<Array<unknown>>;
}

const fakeResponse: () => { res: ExpressResponse; sent: SentFile } = (): {
  res: ExpressResponse;
  sent: SentFile;
} => {
  const sent: SentFile = { headers: {}, calls: [] };

  const res: unknown = {
    setHeader: (name: string, value: string): void => {
      sent.headers[name] = value;
    },
    sendFile: (...args: Array<unknown>): void => {
      sent.calls.push(args);
    },
  };

  return { res: res as ExpressResponse, sent: sent };
};

describe("Response.sendFileByPath", () => {
  test("hands the file to Express alone when given no callback", () => {
    const { res, sent } = fakeResponse();

    ResponseUtil.sendFileByPath({} as ExpressRequest, res, "/srv/file.png");

    expect(sent.calls).toEqual([["/srv/file.png"]]);
    expect(sent.headers["Cache-Control"]).toBe(
      "no-store, no-cache, must-revalidate",
    );
  });

  test("hands the file and the callback to Express when given one", () => {
    const { res, sent } = fakeResponse();
    const onSent: (err?: Error) => void = jest.fn();

    ResponseUtil.sendFileByPath(
      {} as ExpressRequest,
      res,
      "/srv/file.png",
      onSent,
    );

    expect(sent.calls).toEqual([["/srv/file.png", onSent]]);
    expect(sent.headers["Cache-Control"]).toBe(
      "no-store, no-cache, must-revalidate",
    );
  });
});
