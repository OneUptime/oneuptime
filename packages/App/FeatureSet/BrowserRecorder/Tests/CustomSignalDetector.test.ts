import CustomSignalDetector, {
  CustomSignalHit,
} from "../src/CustomSignalDetector";
import { SessionReplayCustomSignalConfig } from "Common/Types/Rum/SessionReplayFrustrationSignals";
import UrlScrubber from "Common/Utils/Rum/UrlScrubber";

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

    /*
     * #8016: the route was read only after "#/", so on a hashbang app
     * (#!/orders, as AngularJS and many older apps route) a page signal
     * never fired. Which fragment is a route is UrlScrubber.getHashRoute's
     * rule, the one the ingest and User Flows read a page by.
     */
    describe("on a hash-routed app", (): void => {
      const ORDERS: SessionReplayCustomSignalConfig = {
        name: "Orders page",
        trigger: "page",
        match: "/orders",
        isFrustration: false,
      };

      const firesOn: (location: {
        pathname: string;
        hash: string;
      }) => number = (location: { pathname: string; hash: string }): number => {
        detector.stop(document);
        hits = [];
        create([ORDERS]);
        detector.notifyPage(CustomSignalDetector.pagePathsOf(location), 1000);
        return hits.length;
      };

      it("fires a signal scoped to /orders on #!/orders and on #/orders", (): void => {
        expect(firesOn({ pathname: "/", hash: "#!/orders" })).toBe(1);
        expect(firesOn({ pathname: "/", hash: "#/orders" })).toBe(1);
        expect(firesOn({ pathname: "/", hash: "#!/orders?tab=open" })).toBe(1);
        expect(firesOn({ pathname: "/app/", hash: "#!/orders/" })).toBe(1);
        // The page's own path still counts on its own.
        expect(firesOn({ pathname: "/orders", hash: "" })).toBe(1);
      });

      it("does not fire on an anchor, or on another route", (): void => {
        expect(firesOn({ pathname: "/", hash: "#pricing" })).toBe(0);
        expect(firesOn({ pathname: "/", hash: "#orders" })).toBe(0);
        expect(firesOn({ pathname: "/", hash: "#!orders" })).toBe(0);
        expect(firesOn({ pathname: "/", hash: "#!/cart" })).toBe(0);
        expect(firesOn({ pathname: "/", hash: "" })).toBe(0);
      });

      it("reads the route of #!/ as it reads #/", (): void => {
        expect(
          CustomSignalDetector.pagePathsOf({
            pathname: "/",
            hash: "#!/checkout/7/error?retry=1",
          }),
        ).toEqual(["/", "/checkout/7/error"]);
        expect(
          CustomSignalDetector.pagePathsOf({ pathname: "/", hash: "#!/" }),
        ).toEqual(["/"]);
        expect(
          CustomSignalDetector.pagePathsOf({ pathname: "/shop", hash: "#!/" }),
        ).toEqual(["/shop", "/"]);
        expect(
          CustomSignalDetector.pagePathsOf({ pathname: "/a", hash: "#!a" }),
        ).toEqual(["/a"]);
        expect(
          CustomSignalDetector.pagePathsOf({ pathname: "", hash: "" }),
        ).toEqual(["/"]);
      });

      it("reads a route by the same rule as UrlScrubber, for every fragment", (): void => {
        for (const hash of [
          "",
          "#",
          "#/",
          "#!/",
          "#!",
          "#/a/b?c=d",
          "#!/a/b?c=d",
          "#a",
          "#!a",
          "#//a",
          "#!//a",
          "#?x=/a",
        ]) {
          const route: string | null = UrlScrubber.getHashRoute(hash);
          const paths: Array<string> = CustomSignalDetector.pagePathsOf({
            pathname: "/shop",
            hash: hash,
          });

          expect([hash, paths]).toEqual([
            hash,
            route === null ? ["/shop"] : ["/shop", route],
          ]);
        }
      });

      it("fires once for a visit whose path and route both match", (): void => {
        detector.stop(document);
        hits = [];
        create([
          {
            name: "Anything under /orders",
            trigger: "page",
            match: "/orders*",
            isFrustration: false,
          },
        ]);

        detector.notifyPage(
          CustomSignalDetector.pagePathsOf({
            pathname: "/orders/",
            hash: "#!/orders/7",
          }),
          1000,
        );

        expect(hits).toHaveLength(1);
      });
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
