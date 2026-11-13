import { SessionReplayConfigResponse } from "Common/Types/Rum/SessionReplay";
import SessionReplayCaptureTrigger from "Common/Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import SessionReplayTriggerReason from "Common/Types/Rum/SessionReplayTriggerReason";
import { RecorderInitOptions } from "../src/Config";
import Masking, { UNMASK_CLASS_NAME } from "../src/Masking";
import {
  MAX_PAGE_BLOCK_SELECTORS,
  MAX_PAGE_BLOCK_SELECTOR_LENGTH,
  PageMaskingOptions,
  applyPageMasking,
  readPageMaskingOptions,
} from "../src/PageMasking";
import Recorder from "../src/Recorder";

declare function require(id: string): unknown;
declare const __dirname: string;

/*
 * What a page may ask of masking on top of the application's policy
 * (issue #6834): MaskAllText whatever the policy says, more blocked
 * elements, and - the one way text gets through MaskAllText - the
 * `oneuptime-unmask` class on the page's own interface words.
 *
 * The last block runs the real recorder with the real rrweb over a page
 * shaped like OneUptime's Dashboard and reads the bytes it posts: the
 * product's button and heading words are readable, and nothing a customer
 * typed or stored is - not a table cell, a card, a code block, a log line,
 * a secret, an image's address or a name inside a revealed heading.
 */

const INIT_GLOBAL: string = "__ONEUPTIME_SESSION_REPLAY__";

const INIT_OPTIONS: RecorderInitOptions = {
  host: "https://oneuptime.com",
  token: "test-token",
  appIdentifier: "app-1",
};

function policy(
  overrides?: Partial<SessionReplayConfigResponse>,
): SessionReplayConfigResponse {
  return {
    enabled: true,
    recorderVersion: "11.7.3",
    maskingMode: SessionReplayMaskingMode.MaskSensitiveInputsOnly,
    captureTrigger: SessionReplayCaptureTrigger.OnErrorOrFrustration,
    consentMode: SessionReplayConsentMode.NotRequired,
    samplePercentage: 100,
    maskSelectors: [],
    blockSelectors: [],
    urlAllowlist: [],
    ignoreErrorPatterns: [],
    recordCanvas: false,
    captureUserIdentity: false,
    respectDoNotTrack: true,
    configEpoch: 1,
    directive: "continue",
    ...overrides,
  };
}

function setInitGlobal(value: unknown): void {
  (window as unknown as Record<string, unknown>)[INIT_GLOBAL] = value;
}

function clearInitGlobal(): void {
  delete (window as unknown as Record<string, unknown>)[INIT_GLOBAL];
}

describe("page masking options (#6834)", (): void => {
  afterEach((): void => {
    clearInitGlobal();
  });

  describe("readPageMaskingOptions", (): void => {
    it("asks for nothing when the page set no init global", (): void => {
      expect(readPageMaskingOptions(window)).toEqual({
        maskAllText: false,
        blockSelectors: [],
      });
      expect(readPageMaskingOptions(null)).toEqual({
        maskAllText: false,
        blockSelectors: [],
      });
    });

    it("forces MaskAllText only for a literal true", (): void => {
      for (const value of ["true", 1, "yes", {}, null]) {
        setInitGlobal({ maskAllText: value });
        expect(readPageMaskingOptions(window).maskAllText).toBe(false);
      }

      setInitGlobal({ maskAllText: true });
      expect(readPageMaskingOptions(window).maskAllText).toBe(true);
    });

    it("keeps the block selectors a browser can parse, trimmed, and drops the rest", (): void => {
      setInitGlobal({
        blockSelectors: [
          " img ",
          "pre",
          "",
          "   ",
          42,
          null,
          "div[",
          "x".repeat(MAX_PAGE_BLOCK_SELECTOR_LENGTH + 1),
          "[data-secret]",
        ],
      });

      expect(readPageMaskingOptions(window).blockSelectors).toEqual([
        "img",
        "pre",
        "[data-secret]",
      ]);
    });

    it("keeps at most MAX_PAGE_BLOCK_SELECTORS", (): void => {
      const many: Array<string> = [];

      for (let i: number = 0; i < MAX_PAGE_BLOCK_SELECTORS + 10; i++) {
        many.push(`.block-${i}`);
      }

      setInitGlobal({ blockSelectors: many });

      expect(readPageMaskingOptions(window).blockSelectors).toHaveLength(
        MAX_PAGE_BLOCK_SELECTORS,
      );
    });

    it("ignores a block list that is not an array", (): void => {
      setInitGlobal({ blockSelectors: "img, pre" });
      expect(readPageMaskingOptions(window).blockSelectors).toEqual([]);
    });
  });

  describe("applyPageMasking", (): void => {
    it("returns the policy untouched when the page asks for nothing", (): void => {
      const config: SessionReplayConfigResponse = policy();

      expect(
        applyPageMasking(config, { maskAllText: false, blockSelectors: [] }),
      ).toBe(config);
    });

    it("forces MaskAllText over every weaker mode", (): void => {
      for (const mode of [
        SessionReplayMaskingMode.MaskSensitiveInputsOnly,
        SessionReplayMaskingMode.MaskInputsOnly,
        SessionReplayMaskingMode.MaskAllText,
      ]) {
        expect(
          applyPageMasking(policy({ maskingMode: mode }), {
            maskAllText: true,
            blockSelectors: [],
          }).maskingMode,
        ).toBe(SessionReplayMaskingMode.MaskAllText);
      }
    });

    it("never weakens the policy's mode", (): void => {
      expect(
        applyPageMasking(
          policy({ maskingMode: SessionReplayMaskingMode.MaskAllText }),
          { maskAllText: false, blockSelectors: ["img"] },
        ).maskingMode,
      ).toBe(SessionReplayMaskingMode.MaskAllText);
    });

    it("adds the page's block selectors after the policy's, once each", (): void => {
      const config: SessionReplayConfigResponse = policy({
        blockSelectors: [".policy-block", "img"],
      });
      const applied: SessionReplayConfigResponse = applyPageMasking(config, {
        maskAllText: false,
        blockSelectors: ["img", "pre"],
      });

      expect(applied.blockSelectors).toEqual([".policy-block", "img", "pre"]);
      // The policy itself is left as it came.
      expect(config.blockSelectors).toEqual([".policy-block", "img"]);
    });
  });

  describe("the unmask class", (): void => {
    const maskAllText: () => Masking = (): Masking => {
      return new Masking(SessionReplayMaskingMode.MaskAllText, []);
    };

    const elementIn: (html: string, id: string) => HTMLElement = (
      html: string,
      id: string,
    ): HTMLElement => {
      document.body.innerHTML = html;
      return document.getElementById(id) as HTMLElement;
    };

    it("is the class the Dashboard's components put on their own words", (): void => {
      expect(UNMASK_CLASS_NAME).toBe("oneuptime-unmask");
    });

    it("records text inside it as written under MaskAllText", (): void => {
      const element: HTMLElement = elementIn(
        `<button class="${UNMASK_CLASS_NAME}"><span id="t">Create Monitor</span></button>`,
        "t",
      );

      expect(maskAllText().maskText("Create Monitor", element)).toBe(
        "Create Monitor",
      );
    });

    it("masks text outside it", (): void => {
      const element: HTMLElement = elementIn(
        `<div><span id="t">Alice Hartwell</span></div>`,
        "t",
      );

      expect(maskAllText().maskText("Alice Hartwell", element)).not.toContain(
        "Alice",
      );
    });

    it("masks again inside a closer .oneuptime-mask", (): void => {
      const element: HTMLElement = elementIn(
        `<h1 class="${UNMASK_CLASS_NAME}">Edit <span class="oneuptime-mask"><b id="t">Payments API</b></span></h1>`,
        "t",
      );

      expect(maskAllText().maskText("Payments API", element)).not.toContain(
        "Payments",
      );
    });

    it("lets a mask on the same element win", (): void => {
      const element: HTMLElement = elementIn(
        `<h1 id="t" class="${UNMASK_CLASS_NAME} oneuptime-mask">Payments API</h1>`,
        "t",
      );

      expect(maskAllText().maskText("Payments API", element)).not.toContain(
        "Payments",
      );
    });

    it("lets a policy mask selector between the two win", (): void => {
      document.body.innerHTML = `<div class="${UNMASK_CLASS_NAME}"><p class="customer"><span id="t">Alice</span></p></div>`;

      const masking: Masking = new Masking(
        SessionReplayMaskingMode.MaskAllText,
        ["div[", ".customer"],
      );

      expect(
        masking.maskText("Alice", document.getElementById("t") as HTMLElement),
      ).not.toContain("Alice");
    });

    it("never reveals the text of a form control", (): void => {
      const option: HTMLElement = elementIn(
        `<label class="${UNMASK_CLASS_NAME}">Account <select><option id="t">Barclays 4417</option></select></label>`,
        "t",
      );

      expect(maskAllText().maskText("Barclays 4417", option)).not.toContain(
        "Barclays",
      );

      const textarea: HTMLElement = elementIn(
        `<div class="${UNMASK_CLASS_NAME}"><textarea id="t">my note</textarea></div>`,
        "t",
      );

      expect(maskAllText().maskText("my note", textarea)).not.toContain("note");

      const editable: HTMLElement = elementIn(
        `<div class="${UNMASK_CLASS_NAME}"><div contenteditable="true"><p id="t">draft</p></div></div>`,
        "t",
      );

      expect(maskAllText().maskText("draft", editable)).not.toContain("draft");
    });

    it("does nothing outside MaskAllText, where only mask selectors mask text and always win", (): void => {
      // A mask further out than the reveal: under MaskAllText the closer reveal wins...
      const element: HTMLElement = elementIn(
        `<div class="oneuptime-mask"><span class="${UNMASK_CLASS_NAME}"><b id="t">Alice</b></span></div>`,
        "t",
      );

      expect(maskAllText().isRevealed(element)).toBe(true);

      // ...but in the other modes the page asked for that mask, and it stands.
      for (const mode of [
        SessionReplayMaskingMode.MaskSensitiveInputsOnly,
        SessionReplayMaskingMode.MaskInputsOnly,
      ]) {
        const masking: Masking = new Masking(mode, []);

        expect(masking.isRevealed(element)).toBe(false);
        expect(masking.maskText("Alice", element)).not.toContain("Alice");
      }
    });

    it("keeps masking a detached text node", (): void => {
      expect(maskAllText().maskText("Alice Hartwell", null)).not.toContain(
        "Alice",
      );
    });
  });

  describe("on the wire", (): void => {
    let fetchMock: jest.Mock;
    let recorder: Recorder | null = null;

    const PRODUCT_WORDS: Array<string> = [
      "Create Monitor",
      "Project Settings",
      "Notification Methods",
      "Monitor Name",
    ];

    const CUSTOMER_DATA: Record<string, string> = {
      tableCell: "Checkout service for Hartwell Ltd",
      card: "Payments API is degraded in eu-west",
      typed: "alice.hartwell@example.com",
      code: "sk_live_51HxQ9secretapikey",
      logLine: "user alice.hartwell logged in from 10.1.2.3",
      secret: "ou-telemetry-key-77a1f9",
      nameInHeading: "Hartwell Production Project",
      avatar: "/avatars/alice-hartwell.png",
    };

    const allPostedBytes: () => string = (): string => {
      return fetchMock.mock.calls
        .map((call: Array<unknown>): string => {
          const init: Record<string, unknown> = call[1] as Record<
            string,
            unknown
          >;

          return new TextDecoder().decode(init["body"] as Uint8Array);
        })
        .join("\n");
    };

    const buildDashboardPage: () => void = (): void => {
      document.body.innerHTML = `
        <nav><a class="${UNMASK_CLASS_NAME}" href="/dashboard/p/settings/">Project Settings</a></nav>
        <h1 class="${UNMASK_CLASS_NAME}">Notification Methods <span class="oneuptime-mask">${CUSTOMER_DATA["nameInHeading"]}</span></h1>
        <img id="avatar" src="${CUSTOMER_DATA["avatar"]}" />
        <table><tr><td>${CUSTOMER_DATA["tableCell"]}</td></tr></table>
        <div class="card"><p>${CUSTOMER_DATA["card"]}</p></div>
        <label class="${UNMASK_CLASS_NAME}" for="name">Monitor Name</label>
        <input id="name" type="text" />
        <pre><code>${CUSTOMER_DATA["code"]}</code></pre>
        <div class="log-line">${CUSTOMER_DATA["logLine"]}</div>
        <div data-secret="true">${CUSTOMER_DATA["secret"]}</div>
        <button class="${UNMASK_CLASS_NAME}" type="button">Create Monitor</button>
      `;

      const input: HTMLInputElement = document.getElementById(
        "name",
      ) as HTMLInputElement;

      input.value = CUSTOMER_DATA["typed"] as string;
      input.setAttribute("value", CUSTOMER_DATA["typed"] as string);
    };

    beforeEach((): void => {
      window.localStorage.clear();
      window.sessionStorage.clear();

      // Identity encoding keeps the bytes greppable.
      delete (globalThis as unknown as Record<string, unknown>)[
        "CompressionStream"
      ];

      fetchMock = jest.fn().mockResolvedValue({
        status: 202,
        headers: {
          get: (): string | null => {
            return null;
          },
        },
        text: async (): Promise<string> => {
          return "";
        },
      });

      (globalThis as unknown as Record<string, unknown>)["fetch"] = fetchMock;
      (window as unknown as Record<string, unknown>)["fetch"] = fetchMock;

      buildDashboardPage();
    });

    afterEach((): void => {
      if (recorder) {
        recorder.stop();
        recorder = null;
      }

      jest.restoreAllMocks();
    });

    const record: (page: PageMaskingOptions | null) => Promise<string> = async (
      page: PageMaskingOptions | null,
    ): Promise<string> => {
      if (page) {
        setInitGlobal({ ...INIT_OPTIONS, ...page });
      }

      const instance: Recorder = new Recorder({
        initOptions: INIT_OPTIONS,
        // A policy somebody left on its least masked mode.
        config: policy(),
      });

      instance.start();
      recorder = instance;

      // Typing after the snapshot, and a mutation adding customer text.
      const input: HTMLInputElement = document.getElementById(
        "name",
      ) as HTMLInputElement;

      input.dispatchEvent(new Event("input", { bubbles: true }));

      const added: HTMLParagraphElement = document.createElement("p");
      added.textContent = CUSTOMER_DATA["card"] as string;
      document.body.appendChild(added);

      instance.trigger(SessionReplayTriggerReason.Manual);

      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, 0);
      });

      const hide: Event = new Event("pagehide");
      Object.defineProperty(hide, "persisted", { value: false });
      window.dispatchEvent(hide);

      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, 0);
      });

      return allPostedBytes();
    };

    it("records the product's words and no customer data with the Dashboard's page options", async (): Promise<void> => {
      const posted: string = await record({
        maskAllText: true,
        blockSelectors: ["img", "pre", "code", ".log-line", "[data-secret]"],
      });

      expect(posted.length).toBeGreaterThan(0);

      for (const words of PRODUCT_WORDS) {
        expect(posted).toContain(words);
      }

      for (const [what, value] of Object.entries(CUSTOMER_DATA)) {
        expect({ what: what, leaked: posted.includes(value) }).toEqual({
          what: what,
          leaked: false,
        });
      }
    });

    it("blocks the page's selectors outright rather than masking them", async (): Promise<void> => {
      const posted: string = await record({
        maskAllText: true,
        blockSelectors: ["img", "pre", ".log-line", "[data-secret]"],
      });

      // rrweb keeps a blocked element as an empty box of its size.
      expect(posted).toContain("rr_width");
      expect(posted).not.toContain("alice-hartwell.png");
    });

    it("leaks the customer's text under the same weak policy without them - the reason the page asks", async (): Promise<void> => {
      const posted: string = await record(null);

      expect(posted).toContain(CUSTOMER_DATA["tableCell"]);
      expect(posted).toContain(CUSTOMER_DATA["logLine"]);
    });
  });

  describe("source", (): void => {
    interface FileSystem {
      readFileSync: (file: string, encoding: string) => string;
    }

    const fs: FileSystem = require("fs") as FileSystem;

    it("keeps PageMasking out of the loader stub, which is under a byte budget", (): void => {
      const loader: string = fs.readFileSync(
        `${__dirname}/../src/Loader.ts`,
        "utf8",
      );
      const config: string = fs.readFileSync(
        `${__dirname}/../src/Config.ts`,
        "utf8",
      );

      expect(loader).not.toContain("PageMasking");
      expect(config).not.toContain("PageMasking");
    });
  });
});
