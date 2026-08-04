import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import Masking, { MaskInputOptionsShape } from "../src/Masking";

describe("Masking", (): void => {
  const maskAll: () => Masking = (): Masking => {
    return new Masking(SessionReplayMaskingMode.MaskAllText, []);
  };

  describe("maskInputOptions", (): void => {
    /*
     * Pinned so a future edit cannot invent an option rrweb does not have.
     * The classic mistake is a "creditcard" key: rrweb keys on HTML input
     * TYPES, card fields are type="text", and a fictional key would silently
     * do nothing while looking like protection.
     */
    it("matches the exact shipped option set", (): void => {
      const options: Readonly<MaskInputOptionsShape> =
        Masking.getMaskInputOptions();

      expect(Object.keys(options).sort()).toEqual([
        "color",
        "date",
        "datetime-local",
        "email",
        "month",
        "number",
        "password",
        "range",
        "search",
        "select",
        "tel",
        "text",
        "textarea",
        "time",
        "url",
        "week",
      ]);
    });

    it("has no creditcard key", (): void => {
      expect(
        Object.prototype.hasOwnProperty.call(
          Masking.getMaskInputOptions(),
          "creditcard",
        ),
      ).toBe(false);
    });

    it("enables every option, in every mode", (): void => {
      const values: Array<boolean> = Object.values(
        Masking.getMaskInputOptions(),
      );

      expect(
        values.every((value: boolean): boolean => {
          return value === true;
        }),
      ).toBe(true);
    });
  });

  describe("maskAllInputs", (): void => {
    /*
     * True in every mode - including the one that lets ordinary values
     * through. It does not mean "mask every input"; it means "route every
     * input through maskInputFn", which is what lets Masking apply its own
     * sticky per-node policy instead of rrweb's type-keyed one. Setting it
     * false for MaskSensitiveInputsOnly would hand the decision back to
     * rrweb and lose the show-password protection.
     */
    for (const mode of [
      SessionReplayMaskingMode.MaskInputsOnly,
      SessionReplayMaskingMode.MaskSensitiveInputsOnly,
      SessionReplayMaskingMode.MaskAllText,
    ]) {
      it(`is true in ${mode} mode`, (): void => {
        const masking: Masking = new Masking(mode, []);

        expect(masking.getRrwebMaskingOptions().maskAllInputs).toBe(true);
      });
    }
  });

  describe("MaskSensitiveInputsOnly", (): void => {
    const sensitiveOnly: (selectors?: Array<string>) => Masking = (
      selectors: Array<string> = [],
    ): Masking => {
      return new Masking(
        SessionReplayMaskingMode.MaskSensitiveInputsOnly,
        selectors,
      );
    };

    it("passes an ordinary input value through unchanged", (): void => {
      const input: HTMLInputElement = document.createElement("input");
      input.setAttribute("type", "text");

      expect(sensitiveOnly().maskInput("order-8891", input)).toBe("order-8891");
    });

    it("masks a password input", (): void => {
      const input: HTMLInputElement = document.createElement("input");
      input.setAttribute("type", "password");

      expect(sensitiveOnly().maskInput("hunter2", input)).not.toContain(
        "hunter2",
      );
    });

    it("masks a card field that is type=text, keyed on autocomplete", (): void => {
      /*
       * The case that makes an input-type-keyed policy wrong: card fields
       * are type="text" and are only identifiable by their autocomplete
       * token.
       */
      const input: HTMLInputElement = document.createElement("input");
      input.setAttribute("type", "text");
      input.setAttribute("autocomplete", "cc-number");

      expect(
        sensitiveOnly().maskInput("4111111111111111", input),
      ).not.toContain("4111");
    });

    it("keeps masking a password field after a show-password toggle", (): void => {
      const input: HTMLInputElement = document.createElement("input");
      input.setAttribute("type", "password");

      const masking: Masking = sensitiveOnly();

      // Seen once as a password...
      masking.maskInput("hunter2", input);

      // ...then revealed. Stickiness must survive the type change.
      input.setAttribute("type", "text");

      expect(masking.maskInput("hunter2", input)).not.toContain("hunter2");
    });

    it("masks an input matched by a policy mask selector", (): void => {
      const wrapper: HTMLDivElement = document.createElement("div");
      wrapper.className = "pii";
      const input: HTMLInputElement = document.createElement("input");
      input.setAttribute("type", "text");
      wrapper.appendChild(input);

      expect(sensitiveOnly([".pii"]).maskInput("Whitcombe", input)).not.toBe(
        "Whitcombe",
      );
    });

    it("survives an invalid mask selector instead of throwing into the page", (): void => {
      /*
       * These selectors are customer-authored, and closest() throws on a
       * malformed one. Throwing here would throw inside rrweb's
       * serializer, on the customer's page.
       */
      const input: HTMLInputElement = document.createElement("input");
      input.setAttribute("type", "text");

      expect(sensitiveOnly(["))not-a-selector(("]).maskInput("ok", input)).toBe(
        "ok",
      );
    });

    it("still blanks a file input", (): void => {
      /*
       * A file input's DOM value is "C:\fakepath\<real filename>" and
       * filenames are routinely personal. Blanked in every mode, sensitive
       * or not.
       */
      const input: HTMLInputElement = document.createElement("input");
      input.setAttribute("type", "file");

      expect(
        sensitiveOnly().maskInput("C:\\fakepath\\passport-scan.pdf", input),
      ).toBe("");
    });

    it("leaves static page text alone", (): void => {
      expect(sensitiveOnly().getMaskTextSelector()).toBe("");
    });
  });

  describe("getMaskTextSelector", (): void => {
    it('is "*" in MaskAllText mode, because rrweb has no maskAllText option', (): void => {
      expect(maskAll().getMaskTextSelector()).toBe("*");
    });

    it("is only the policy selectors in MaskInputsOnly mode", (): void => {
      const masking: Masking = new Masking(
        SessionReplayMaskingMode.MaskInputsOnly,
        [".pii", "#ssn"],
      );

      expect(masking.getMaskTextSelector()).toBe(".pii,#ssn");
    });

    it("is empty when MaskInputsOnly has no selectors, so the caller omits the option", (): void => {
      const masking: Masking = new Masking(
        SessionReplayMaskingMode.MaskInputsOnly,
        [],
      );

      expect(masking.getMaskTextSelector()).toBe("");
    });
  });

  describe("maskInput", (): void => {
    it("never returns a length-derived mask", (): void => {
      const masking: Masking = maskAll();
      const input: HTMLInputElement = document.createElement("input");

      const short: string = masking.maskInput("ab", input);
      const long: string = masking.maskInput(
        "a-very-long-password-value-indeed",
        input,
      );

      expect(short).toBe(long);
    });

    it("blanks a file input value entirely", (): void => {
      const masking: Masking = maskAll();
      const input: HTMLInputElement = document.createElement("input");

      input.setAttribute("type", "file");

      expect(masking.maskInput("C:\\fakepath\\passport-scan.pdf", input)).toBe(
        "",
      );
    });
  });

  describe("sticky sensitivity", (): void => {
    it("marks a password input and keeps it after the type is toggled", (): void => {
      const masking: Masking = maskAll();
      const input: HTMLInputElement = document.createElement("input");

      input.setAttribute("type", "password");
      document.body.appendChild(input);

      expect(masking.markIfSensitive(input)).toBe(true);

      /* The show-password toggle. */
      input.setAttribute("type", "text");

      expect(Masking.isCurrentlySensitive(input)).toBe(false);
      expect(masking.isSticky(input)).toBe(true);
    });

    it("marks a card field by autocomplete even though its type is text", (): void => {
      const masking: Masking = maskAll();
      const input: HTMLInputElement = document.createElement("input");

      input.setAttribute("type", "text");
      input.setAttribute("autocomplete", "section-payment billing cc-number");

      expect(masking.markIfSensitive(input)).toBe(true);
    });

    it("does not mark an ordinary text input", (): void => {
      const masking: Masking = maskAll();
      const input: HTMLInputElement = document.createElement("input");

      input.setAttribute("type", "text");

      expect(masking.markIfSensitive(input)).toBe(false);
    });

    it("pre-marks every sensitive field in the document", (): void => {
      document.body.innerHTML = `
        <input type="password" id="p" />
        <input type="text" autocomplete="one-time-code" id="otp" />
        <input type="text" autocomplete="cc-csc" id="csc" />
        <input type="text" id="plain" />
      `;

      const masking: Masking = maskAll();

      expect(masking.markSensitiveFieldsIn(document)).toBe(3);
      expect(masking.isSticky(document.getElementById("plain"))).toBe(false);
    });
  });

  describe("sanitiseAttributeMutation", (): void => {
    it("suppresses the type mutation on a sticky node", (): void => {
      const masking: Masking = maskAll();
      const input: HTMLInputElement = document.createElement("input");

      input.setAttribute("type", "password");
      masking.markIfSensitive(input);
      input.setAttribute("type", "text");

      const sanitised: Record<string, unknown> | null =
        masking.sanitiseAttributeMutation(input, {
          type: "text",
          class: "revealed",
        });

      expect(sanitised).toEqual({ class: "revealed" });
    });

    /*
     * rrweb writes data-rr-is-password onto the LIVE element when it sees a
     * type mutation away from password (rrweb.js:11918), and its observer
     * then reports that as a second attribute mutation on the same node.
     * Suppressing "type" alone left the reveal fully observable through
     * rrweb's own marker.
     */
    it("suppresses rrweb's own password marker, not just the type", (): void => {
      const masking: Masking = maskAll();
      const input: HTMLInputElement = document.createElement("input");

      input.setAttribute("type", "password");
      masking.markIfSensitive(input);

      expect(
        masking.sanitiseAttributeMutation(input, {
          "data-rr-is-password": "true",
        }),
      ).toBeNull();

      expect(
        masking.sanitiseAttributeMutation(input, {
          "data-rr-is-password": "true",
          "data-revealed": "true",
        }),
      ).toEqual({ "data-revealed": "true" });
    });

    it("returns null when nothing survives, so the entry can be dropped", (): void => {
      const masking: Masking = maskAll();
      const input: HTMLInputElement = document.createElement("input");

      input.setAttribute("type", "password");
      masking.markIfSensitive(input);

      expect(
        masking.sanitiseAttributeMutation(input, { type: "text" }),
      ).toBeNull();
    });

    it("leaves a non-sensitive node's mutation untouched", (): void => {
      const masking: Masking = maskAll();
      const div: HTMLDivElement = document.createElement("div");

      const attributes: Record<string, unknown> = { class: "a", type: "b" };

      expect(masking.sanitiseAttributeMutation(div, attributes)).toBe(
        attributes,
      );
    });

    /*
     * The inbound direction: a field that BECOMES sensitive must be marked on
     * the way in, not only once it has already leaked.
     */
    it("marks a node whose type mutates into password", (): void => {
      const masking: Masking = maskAll();
      const input: HTMLInputElement = document.createElement("input");

      input.setAttribute("type", "password");

      expect(
        masking.sanitiseAttributeMutation(input, { type: "password" }),
      ).toBeNull();
      expect(masking.isSticky(input)).toBe(true);
    });
  });

  describe("maskConsoleArgument", (): void => {
    it("masks in MaskAllText mode", (): void => {
      expect(maskAll().maskConsoleArgument("alice@example.com")).not.toContain(
        "alice",
      );
    });

    it("passes through in MaskInputsOnly mode", (): void => {
      const masking: Masking = new Masking(
        SessionReplayMaskingMode.MaskInputsOnly,
        [],
      );

      expect(masking.maskConsoleArgument("boot complete")).toBe(
        "boot complete",
      );
    });
  });
});
