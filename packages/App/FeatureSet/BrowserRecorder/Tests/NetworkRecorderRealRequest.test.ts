/**
 * @jest-environment node
 */

import UrlScrubber from "Common/Utils/Rum/UrlScrubber";
import NetworkRecorder, { RecordedRequest } from "../src/NetworkRecorder";

/*
 * The platform's own Request, which jsdom does not ship: this file runs in
 * Node, whose fetch primitives implement the Fetch spec's constructor.
 * Tests/NetworkRecorderSameOrigin.test.ts models the same rules with a
 * stand-in; this pins them against the real thing.
 *
 * A same-origin Request is annotated by rebuilding it as
 * new Request(request, init). The spec resets the copy's referrer to the
 * client and its referrer policy to "" whenever init is non-empty, so a
 * page's `referrerPolicy: "no-referrer"` used to go out under the document
 * default - the full page URL, query string included, as Referer.
 */

const PAGE_ORIGIN: string = "https://shop.example.com";
const SESSION_ID: string = "0123456789abcdef0123456789abcdef";

interface Page {
  windowRef: Window;
  sent: Array<Request>;
  completed: Array<RecordedRequest>;
  recorder: NetworkRecorder;
}

function openPage(): Page {
  const sent: Array<Request> = [];
  const completed: Array<RecordedRequest> = [];

  const windowRef: Window = {
    location: {
      href: `${PAGE_ORIGIN}/checkout`,
      origin: PAGE_ORIGIN,
    },
    origin: PAGE_ORIGIN,
    document: { baseURI: `${PAGE_ORIGIN}/checkout` },
    Request: Request,
    fetch: (input: RequestInfo | URL): Promise<Response> => {
      sent.push(input as Request);

      return Promise.resolve(new Response(null, { status: 204 }));
    },
  } as unknown as Window;

  const recorder: NetworkRecorder = new NetworkRecorder({
    emitCustomEvent: (): void => {},
    onRequestComplete: (_atUnixMs: number, request: RecordedRequest): void => {
      completed.push(request);
    },
    onActivity: (): void => {},
    scrubUrl: (url: string): string => {
      return UrlScrubber.scrub(url);
    },
    isSelfRequest: (): boolean => {
      return false;
    },
    sameOriginTracePropagation: true,
    getSessionIdForPropagation: (): string | null => {
      return SESSION_ID;
    },
  });

  recorder.start(windowRef);

  return { windowRef, sent, completed, recorder };
}

describe("rebuilding a same-origin Request with the platform's Request", (): void => {
  const choices: Array<{ label: string; init: RequestInit }> = [
    { label: "no-referrer policy", init: { referrerPolicy: "no-referrer" } },
    { label: 'referrer ""', init: { referrer: "" } },
    {
      label: 'referrer "" with unsafe-url',
      init: { referrer: "", referrerPolicy: "unsafe-url" },
    },
    {
      label: "custom same-origin referrer",
      init: {
        referrer: `${PAGE_ORIGIN}/landing?campaign=spring`,
        referrerPolicy: "same-origin",
      },
    },
    { label: "defaults", init: {} },
  ];

  for (const choice of choices) {
    it(`keeps the page's referrer and referrerPolicy: ${choice.label}`, async (): Promise<void> => {
      const page: Page = openPage();

      try {
        const request: Request = new Request(`${PAGE_ORIGIN}/api/redeem`, {
          ...choice.init,
          method: "POST",
          body: "code=SPRING",
          headers: { "content-type": "application/x-www-form-urlencoded" },
        });

        await page.windowRef.fetch(request);

        const sent: Request | undefined = page.sent[0];

        expect(sent).toBeInstanceOf(Request);
        expect(sent).not.toBe(request);

        /* It really was annotated... */
        expect(sent?.headers.get("tracestate")).toContain(
          `sid:${SESSION_ID};p:`,
        );
        expect(sent?.headers.get("traceparent")).toMatch(/^00-/);

        /* ...and the page's choices, method, headers and body survived. */
        expect([sent?.referrer, sent?.referrerPolicy]).toEqual([
          request.referrer,
          request.referrerPolicy,
        ]);
        expect(sent?.method).toBe("POST");
        expect(sent?.headers.get("content-type")).toBe(
          "application/x-www-form-urlencoded",
        );
        expect(await sent?.text()).toBe("code=SPRING");
        expect(page.completed).toHaveLength(1);
      } finally {
        page.recorder.stop(page.windowRef);
      }
    });
  }
});
