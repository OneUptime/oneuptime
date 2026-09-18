/**
 * The X-Robots-Tag half of the status page indexing opt-out.
 *
 * The meta tag in index.ejs only covers the HTML. This header is what carries
 * the same instruction on the responses that have no <head> to put a tag in -
 * the RSS feed and llms.txt - so it is tested on its own.
 */

import applyStatusPageRobotsHeader from "../../../Server/Utils/StatusPageSearchEngineIndexing";
import { ExpressResponse } from "../../../Server/Utils/Express";
import { describe, expect, jest, test } from "@jest/globals";

type FakeResponse = {
  set: ReturnType<typeof jest.fn>;
  headersSent: boolean;
};

function fakeResponse(headersSent: boolean = false): FakeResponse {
  return {
    set: jest.fn(),
    headersSent,
  };
}

describe("applyStatusPageRobotsHeader", () => {
  test("sends noindex, nofollow when the owner turned indexing off", () => {
    const res: FakeResponse = fakeResponse();

    applyStatusPageRobotsHeader(res as unknown as ExpressResponse, false);

    expect(res.set).toHaveBeenCalledTimes(1);
    expect(res.set).toHaveBeenCalledWith("X-Robots-Tag", "noindex, nofollow");
  });

  test("sends no header at all when indexing is on", () => {
    /*
     * Not "sends index, follow". Emitting the default explicitly would
     * overwrite a noindex that an operator set in front of OneUptime - a CDN
     * rule or an ingress annotation - because the last writer of a header
     * wins. Silence leaves those in place.
     */
    const res: FakeResponse = fakeResponse();

    applyStatusPageRobotsHeader(res as unknown as ExpressResponse, true);

    expect(res.set).not.toHaveBeenCalled();
  });

  test("does not touch a response that has already been flushed", () => {
    /*
     * Node drops headers set after the response has gone out, and logs
     * nothing. Guarding here keeps a late caller from thinking it succeeded.
     */
    const res: FakeResponse = fakeResponse(true);

    applyStatusPageRobotsHeader(res as unknown as ExpressResponse, false);

    expect(res.set).not.toHaveBeenCalled();
  });
});
