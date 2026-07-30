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

    it("enables every option in both modes", (): void => {
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
    it("is true even in MaskInputsOnly mode", (): void => {
      const masking: Masking = new Masking(
        SessionReplayMaskingMode.MaskInputsOnly,
        [],
      );

      expect(masking.getRrwebMaskingOptions().maskAllInputs).toBe(true);
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
