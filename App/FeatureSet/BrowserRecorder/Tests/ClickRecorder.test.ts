import {
  SESSION_REPLAY_MAX_CLICK_EVENTS_PER_CHUNK,
  SESSION_REPLAY_MAX_CLICK_TEXT_LENGTH,
} from "Common/Types/Rum/SessionReplay";
import {
  SessionReplayClickDroppedPayload,
  SessionReplayClickPayload,
  SessionReplayCustomEventTag,
} from "Common/Types/Rum/SessionReplayCustomEvents";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import ClickRecorder from "../src/ClickRecorder";
import Masking from "../src/Masking";

/*
 * The click recorder: structural selectors that never carry an attribute
 * value, labels that go through the active masking, a per-chunk cap with
 * one disclosure at the boundary, and a tap counted exactly once.
 */

interface Emitted {
  tag: string;
  payload: unknown;
}

describe("ClickRecorder", (): void => {
  let emitted: Array<Emitted> = [];
  let clicks: Array<SessionReplayClickPayload> = [];
  let recorder: ClickRecorder | null = null;

  const makeRecorder: (
    mode?: SessionReplayMaskingMode,
    maskSelectors?: Array<string>,
  ) => ClickRecorder = (
    mode?: SessionReplayMaskingMode,
    maskSelectors?: Array<string>,
  ): ClickRecorder => {
    emitted = [];
    clicks = [];

    const instance: ClickRecorder = new ClickRecorder({
      emitCustomEvent: (tag: string, payload: unknown): void => {
        emitted.push({ tag: tag, payload: payload });
      },
      onClick: (_atUnixMs: number, click: SessionReplayClickPayload): void => {
        clicks.push(click);
      },
      masking: new Masking(
        mode === undefined
          ? SessionReplayMaskingMode.MaskSensitiveInputsOnly
          : mode,
        maskSelectors || [],
      ),
    });

    instance.start(document);
    recorder = instance;

    return instance;
  };

  const clickPayloads: () => Array<SessionReplayClickPayload> =
    (): Array<SessionReplayClickPayload> => {
      return emitted
        .filter((event: Emitted): boolean => {
          return event.tag === SessionReplayCustomEventTag.Click;
        })
        .map((event: Emitted): SessionReplayClickPayload => {
          return event.payload as SessionReplayClickPayload;
        });
    };

  const droppedPayloads: () => Array<SessionReplayClickDroppedPayload> =
    (): Array<SessionReplayClickDroppedPayload> => {
      return emitted
        .filter((event: Emitted): boolean => {
          return event.tag === SessionReplayCustomEventTag.ClickDropped;
        })
        .map((event: Emitted): SessionReplayClickDroppedPayload => {
          return event.payload as SessionReplayClickDroppedPayload;
        });
    };

  const click: (target: Element, x?: number, y?: number) => void = (
    target: Element,
    x?: number,
    y?: number,
  ): void => {
    target.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        clientX: x === undefined ? 10 : x,
        clientY: y === undefined ? 20 : y,
      }),
    );
  };

  beforeEach((): void => {
    document.body.innerHTML = `
      <div id="app">
        <form class="checkout primary wide" data-email="alice.hartwell@example.com">
          <button class="btn pay" data-secret="s3cret-token" title="Pay Alice Hartwell">
            Pay   now
          </button>
          <input id="card" type="text" value="4111111111111111" />
          <input id="labelled" type="text" aria-label="Card number field" value="4111111111111111" />
          <a id="contact" href="mailto:alice.hartwell@example.com">Contact us</a>
          <div class="private"><span id="secret-span">Balance 84,220.19 GBP</span></div>
          <p id="long">${"word ".repeat(30)}</p>
        </form>
        <span id="labelled-span" aria-label="Open the menu">☰</span>
      </div>
    `;
  });

  afterEach((): void => {
    if (recorder) {
      recorder.stop(document);
      recorder = null;
    }

    jest.useRealTimers();
  });

  describe("selector", (): void => {
    it("is structural only: tag, id, classes, never an attribute value", (): void => {
      makeRecorder();

      click(document.querySelector("button.pay") as Element);

      const [payload] = clickPayloads();

      expect(payload?.selector).toBe(
        "div#app > form.checkout.primary > button.btn.pay",
      );
      expect(payload?.selector).not.toContain("alice");
      expect(payload?.selector).not.toContain("s3cret");
      expect(payload?.selector).not.toContain("Pay Alice");
      expect(payload?.selector).not.toContain("wide");
    });

    it("stops climbing at an id and truncates long tokens", (): void => {
      document.body.innerHTML = `
        <main><section><div id="${"a".repeat(80)}"><span class="${"b".repeat(80)}">x</span></div></section></main>
      `;

      makeRecorder();

      click(document.querySelector("span") as Element);

      const [payload] = clickPayloads();

      expect(payload?.selector).toBe(
        `div#${"a".repeat(32)} > span.${"b".repeat(32)}`,
      );
      expect(payload?.selector).not.toContain("main");
    });

    it("looks at most three ancestors up", (): void => {
      document.body.innerHTML =
        "<div class='l5'><div class='l4'><div class='l3'><div class='l2'><div class='l1'><b>x</b></div></div></div></div></div>";

      makeRecorder();

      click(document.querySelector("b") as Element);

      expect(clickPayloads()[0]?.selector).toBe("div.l3 > div.l2 > div.l1 > b");
    });

    it("attributes a click on a text node to its parent element", (): void => {
      makeRecorder();

      const text: Node = (document.getElementById("contact") as Element)
        .firstChild as Node;

      const event: Event = new MouseEvent("click", { bubbles: true });
      Object.defineProperty(event, "target", { value: text });

      document.dispatchEvent(event);

      expect(clickPayloads()[0]?.selector).toContain("a#contact");
    });
  });

  describe("label", (): void => {
    it("records collapsed text and coordinates under the default mode", (): void => {
      makeRecorder();

      click(document.querySelector("button.pay") as Element, 33, 44);

      const [payload] = clickPayloads();

      expect(payload?.text).toBe("Pay now");
      expect(payload?.x).toBe(33);
      expect(payload?.y).toBe(44);
      expect(typeof payload?.atUnixMs).toBe("number");
      expect(clicks).toHaveLength(1);
    });

    it("prefers aria-label over the element's text", (): void => {
      makeRecorder();

      click(document.getElementById("labelled-span") as Element);

      expect(clickPayloads()[0]?.text).toBe("Open the menu");
    });

    it("is omitted entirely under MaskAllText", (): void => {
      makeRecorder(SessionReplayMaskingMode.MaskAllText);

      click(document.querySelector("button.pay") as Element);
      click(document.getElementById("labelled-span") as Element);

      const payloads: Array<SessionReplayClickPayload> = clickPayloads();

      expect(payloads).toHaveLength(2);

      for (const payload of payloads) {
        expect(payload.text).toBeUndefined();
        expect(JSON.stringify(payload)).not.toContain("Pay");
        expect(JSON.stringify(payload)).not.toContain("menu");
      }
    });

    it("never uses a form control's value as its label, in any mode", (): void => {
      for (const mode of [
        SessionReplayMaskingMode.MaskSensitiveInputsOnly,
        SessionReplayMaskingMode.MaskInputsOnly,
      ]) {
        if (recorder) {
          recorder.stop(document);
        }

        makeRecorder(mode);

        click(document.getElementById("card") as Element);
        click(document.getElementById("labelled") as Element);

        const payloads: Array<SessionReplayClickPayload> = clickPayloads();

        expect(payloads[0]?.text).toBeUndefined();
        expect(payloads[1]?.text).toBe("Card number field");
        expect(JSON.stringify(emitted)).not.toContain("4111");
      }
    });

    it("masks the label inside a region the policy masks", (): void => {
      makeRecorder(SessionReplayMaskingMode.MaskSensitiveInputsOnly, [
        ".private",
      ]);

      click(document.getElementById("secret-span") as Element);

      const text: string | undefined = clickPayloads()[0]?.text;

      expect(text).toBeDefined();
      expect(text).not.toContain("Balance");
      expect(text).not.toContain("84,220");
      expect(text).toMatch(/^•+$/);
    });

    it("masks the label inside an element carrying rrweb's mask class", (): void => {
      document.body.innerHTML =
        "<div class='oneuptime-mask'><span id='hint'>Password hint: correct-horse</span></div>";

      makeRecorder();

      click(document.getElementById("hint") as Element);

      const [payload] = clickPayloads();

      expect(payload?.text).toMatch(/^•+$/);
      expect(JSON.stringify(emitted)).not.toContain("correct-horse");
    });

    it("caps the label at the shared limit", (): void => {
      makeRecorder();

      click(document.getElementById("long") as Element);

      const text: string | undefined = clickPayloads()[0]?.text;

      expect(text?.length).toBe(SESSION_REPLAY_MAX_CLICK_TEXT_LENGTH);
      expect(SESSION_REPLAY_MAX_CLICK_TEXT_LENGTH).toBe(40);
    });
  });

  describe("per-chunk cap", (): void => {
    it("labels the first hundred and discloses the rest once, at the boundary", (): void => {
      const instance: ClickRecorder = makeRecorder();
      const button: Element = document.querySelector("button.pay") as Element;

      for (
        let i: number = 0;
        i < SESSION_REPLAY_MAX_CLICK_EVENTS_PER_CHUNK + 7;
        i++
      ) {
        click(button);
      }

      expect(clickPayloads()).toHaveLength(
        SESSION_REPLAY_MAX_CLICK_EVENTS_PER_CHUNK,
      );
      expect(clicks).toHaveLength(SESSION_REPLAY_MAX_CLICK_EVENTS_PER_CHUNK);
      expect(droppedPayloads()).toHaveLength(0);
      expect(instance.getDroppedInChunk()).toBe(7);

      instance.startNewChunk();

      expect(droppedPayloads()).toEqual([{ count: 7 }]);
      expect(instance.getDroppedInChunk()).toBe(0);

      /* The next chunk has its own budget. */
      click(button);

      expect(clickPayloads()).toHaveLength(
        SESSION_REPLAY_MAX_CLICK_EVENTS_PER_CHUNK + 1,
      );

      instance.startNewChunk();

      expect(droppedPayloads()).toHaveLength(1);
    });

    it("discloses the open chunk's dropped clicks on stop", (): void => {
      const instance: ClickRecorder = makeRecorder();
      const button: Element = document.querySelector("button.pay") as Element;

      for (
        let i: number = 0;
        i < SESSION_REPLAY_MAX_CLICK_EVENTS_PER_CHUNK + 2;
        i++
      ) {
        click(button);
      }

      instance.stop(document);
      recorder = null;

      expect(droppedPayloads()).toEqual([{ count: 2 }]);

      /* And nothing is recorded after stop. */
      click(button);

      expect(clickPayloads()).toHaveLength(
        SESSION_REPLAY_MAX_CLICK_EVENTS_PER_CHUNK,
      );
    });

    it("starts a rotated session with a clean window and no disclosure", (): void => {
      const instance: ClickRecorder = makeRecorder();
      const button: Element = document.querySelector("button.pay") as Element;

      for (
        let i: number = 0;
        i < SESSION_REPLAY_MAX_CLICK_EVENTS_PER_CHUNK + 2;
        i++
      ) {
        click(button);
      }

      instance.resetForNewSession();
      instance.startNewChunk();

      expect(droppedPayloads()).toHaveLength(0);
    });
  });

  describe("touch", (): void => {
    const touchEnd: (target: Element, x: number, y: number) => void = (
      target: Element,
      x: number,
      y: number,
    ): void => {
      const event: Event = new Event("touchend", { bubbles: true });

      Object.defineProperty(event, "changedTouches", {
        value: [{ clientX: x, clientY: y }],
      });

      target.dispatchEvent(event);
    };

    it("records a tap once when the click follows the touchend", (): void => {
      jest.useFakeTimers();
      makeRecorder();

      const button: Element = document.querySelector("button.pay") as Element;

      touchEnd(button, 5, 6);
      click(button, 5, 6);

      jest.advanceTimersByTime(1000);

      expect(clickPayloads()).toHaveLength(1);
      expect(clicks).toHaveLength(1);
    });

    it("records a touchend on its own when the page swallowed the click", (): void => {
      jest.useFakeTimers();
      makeRecorder();

      const button: Element = document.querySelector("button.pay") as Element;

      touchEnd(button, 7, 8);

      expect(clickPayloads()).toHaveLength(0);

      jest.advanceTimersByTime(1000);

      const [payload] = clickPayloads();

      expect(clickPayloads()).toHaveLength(1);
      expect(payload?.x).toBe(7);
      expect(payload?.y).toBe(8);
      expect(payload?.selector).toContain("button.btn.pay");
    });
  });

  it("listens in the capture phase so a stopped propagation is still seen", (): void => {
    makeRecorder();

    const button: Element = document.querySelector("button.pay") as Element;

    button.addEventListener("click", (event: Event): void => {
      event.stopPropagation();
    });

    click(button);

    expect(clickPayloads()).toHaveLength(1);
  });

  it("stops listening after stop()", (): void => {
    const instance: ClickRecorder = makeRecorder();

    instance.stop(document);
    recorder = null;

    click(document.querySelector("button.pay") as Element);

    expect(clickPayloads()).toHaveLength(0);
  });
});
