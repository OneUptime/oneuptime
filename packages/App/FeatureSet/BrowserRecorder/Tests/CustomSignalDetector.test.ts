import CustomSignalDetector, {
  CustomSignalHit,
} from "../src/CustomSignalDetector";
import { SessionReplayCustomSignalConfig } from "Common/Types/Rum/SessionReplayFrustrationSignals";

/*
 * The application's own signals, detected in the browser: a click on an
 * element, a page, a track() event, an error's text. Each is reported by
 * name, at most once a second, and a click carries where it was.
 */

const SIGNALS: Array<SessionReplayCustomSignalConfig> = [
  {
    name: "Pay clicked",
    trigger: "click",
    match: "#pay",
    isFrustration: false,
  },
  {
    name: "Checkout error page",
    trigger: "page",
    match: "/checkout/*/error",
    isFrustration: true,
  },
  {
    name: "Payment failed",
    trigger: "event",
    match: "payment_failed",
    isFrustration: true,
  },
  {
    name: "Card declined",
    trigger: "error",
    match: "card declined",
    isFrustration: true,
  },
];

describe("CustomSignalDetector", (): void => {
  let hits: Array<CustomSignalHit> = [];
  let detector: CustomSignalDetector;

  const create: (signals: Array<SessionReplayCustomSignalConfig>) => void = (
    signals: Array<SessionReplayCustomSignalConfig>,
  ): void => {
    detector = new CustomSignalDetector({
      signals: signals,
      onSignal: (hit: CustomSignalHit): void => {
        hits.push(hit);
      },
    });
    detector.start(document);
  };

  beforeEach((): void => {
    hits = [];
    document.body.innerHTML = `
      <button id='pay'><span id='pay-label'>Pay</span></button>
      <button id='other'>Other</button>
    `;
    create(SIGNALS);
  });

  afterEach((): void => {
    detector.stop(document);
    jest.restoreAllMocks();
  });

  describe("click", (): void => {
    it("fires on a click on the element or inside it, with where it was", (): void => {
      (document.getElementById("pay-label") as Element).dispatchEvent(
        new MouseEvent("click", { bubbles: true, clientX: 40, clientY: 60 }),
      );

      expect(hits).toHaveLength(1);
      expect(hits[0]).toMatchObject({
        name: "Pay clicked",
        trigger: "click",
        isFrustration: false,
        x: 40,
        y: 60,
      });
    });

    it("ignores clicks anywhere else", (): void => {
      (document.getElementById("other") as Element).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );

      expect(hits).toHaveLength(0);
    });

    it("treats a selector this browser cannot read as matching nothing", (): void => {
      detector.stop(document);
      create([
        {
          name: "Broken",
          trigger: "click",
          match: "button[",
          isFrustration: true,
        },
        { name: "Fine", trigger: "click", match: "#pay", isFrustration: true },
      ]);

      (document.getElementById("pay") as Element).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );

      expect(
        hits.map((hit: CustomSignalHit): string => {
          return hit.name;
        }),
      ).toEqual(["Fine"]);
    });

    it("adds no click listener when no signal is about clicks", (): void => {
      detector.stop(document);

      const addSpy: jest.SpyInstance = jest.spyOn(document, "addEventListener");

      create([SIGNALS[2] as SessionReplayCustomSignalConfig]);

      expect(addSpy).not.toHaveBeenCalled();
    });
  });

  describe("page", (): void => {
    it("fires once for a visit to a matching page", (): void => {
      detector.notifyPage(["/checkout/42/error"], 1000);
      // The same page again (a replaceState that changed the query) is the same visit.
      detector.notifyPage(["/checkout/42/error"], 5000);

      expect(hits).toHaveLength(1);
      expect(hits[0]).toMatchObject({
        name: "Checkout error page",
        trigger: "page",
        isFrustration: true,
        atUnixMs: 1000,
      });
      expect(hits[0]?.x).toBeUndefined();
    });

    it("fires again after the visitor went somewhere else and came back", (): void => {
      detector.notifyPage(["/checkout/42/error"], 1000);
      detector.notifyPage(["/cart"], 3000);
      detector.notifyPage(["/checkout/42/error"], 6000);

      expect(hits).toHaveLength(2);
    });

    it("matches the route of a hash-routed app", (): void => {
      expect(
        CustomSignalDetector.pagePathsOf({
          pathname: "/",
          hash: "#/checkout/7/error?retry=1",
        }),
      ).toEqual(["/", "/checkout/7/error"]);
      expect(
        CustomSignalDetector.pagePathsOf({ pathname: "/shop", hash: "#top" }),
      ).toEqual(["/shop"]);

      detector.notifyPage(
        CustomSignalDetector.pagePathsOf({
          pathname: "/",
          hash: "#/checkout/7/error",
        }),
        1000,
      );

      expect(hits).toHaveLength(1);
    });
  });

  describe("event", (): void => {
    it("fires on the event's name, ignoring case", (): void => {
      detector.notifyEvent("Payment_Failed", 1000);
      detector.notifyEvent("payment_started", 5000);

      expect(hits).toHaveLength(1);
      expect(hits[0]?.name).toBe("Payment failed");
    });
  });

  describe("error", (): void => {
    it("fires on text anywhere in the error, ignoring case", (): void => {
      detector.notifyErrorText("PaymentError: Card Declined (code 51)", 1000);
      detector.notifyErrorText("TypeError: x is undefined", 5000);

      expect(hits).toHaveLength(1);
      expect(hits[0]?.name).toBe("Card declined");
    });
  });

  it("reports the same signal at most once a second", (): void => {
    detector.notifyEvent("payment_failed", 1000);
    detector.notifyEvent("payment_failed", 1500);
    detector.notifyEvent("payment_failed", 1999);
    detector.notifyEvent("payment_failed", 2000);

    expect(
      hits.map((hit: CustomSignalHit): number => {
        return hit.atUnixMs;
      }),
    ).toEqual([1000, 2000]);
  });

  it("keeps each signal's second to itself", (): void => {
    detector.notifyEvent("payment_failed", 1000);
    detector.notifyErrorText("card declined", 1100);

    expect(hits).toHaveLength(2);
  });
});
