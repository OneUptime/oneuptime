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
        "hidden",
        "input",
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

    /*
     * rrweb keys the table on tag names as well as input types
     * (maskInputValue: `maskInputOptions[tagName] || maskInputOptions[type]`).
     * The `input` entry is what reaches type="hidden" and every type rrweb
     * has never heard of.
     */
    it("routes every input by tag name, and names hidden explicitly", (): void => {
      expect(Masking.getMaskInputOptions().input).toBe(true);
      expect(Masking.getMaskInputOptions().hidden).toBe(true);
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
     * FALSE in every mode, and the option table is what routes inputs.
     *
     * rrweb's record() discards the maskInputOptions it was handed whenever
     * maskAllInputs is true and substitutes its own type-keyed table
     * (rrweb.js:14279), which has no entry for type="hidden" or for the tag
     * name. With `true`, hidden inputs never reached maskInputFn and their
     * values - CSRF tokens, user ids, pre-filled emails - went out verbatim
     * in every mode, MaskAllText included. With `false`, rrweb uses the
     * table as given, whose `input` key matches every <input> by tag name,
     * so every input still reaches maskInput and the sticky per-node policy
     * still applies.
     */
    for (const mode of [
      SessionReplayMaskingMode.MaskInputsOnly,
      SessionReplayMaskingMode.MaskSensitiveInputsOnly,
      SessionReplayMaskingMode.MaskAllText,
    ]) {
      it(`is false in ${mode} mode, with the full option table alongside`, (): void => {
        const masking: Masking = new Masking(mode, []);

        expect(masking.getRrwebMaskingOptions().maskAllInputs).toBe(false);
        expect(masking.getRrwebMaskingOptions().maskInputOptions).toBe(
          Masking.getMaskInputOptions(),
        );
      });
    }
  });

  describe("hidden inputs", (): void => {
    for (const mode of [
      SessionReplayMaskingMode.MaskInputsOnly,
      SessionReplayMaskingMode.MaskSensitiveInputsOnly,
      SessionReplayMaskingMode.MaskAllText,
    ]) {
      it(`masks a hidden input's value in ${mode} mode`, (): void => {
        const masking: Masking = new Masking(mode, []);
        const input: HTMLInputElement = document.createElement("input");
        input.setAttribute("type", "hidden");

        expect(masking.maskInput("csrf-9f8e7d6c", input)).not.toContain(
          "9f8e7d6c",
        );
      });
    }

    /* A hidden field later revealed must not start leaking what it held. */
    it("is sticky: a hidden field mutated to text stays masked", (): void => {
      const masking: Masking = new Masking(
        SessionReplayMaskingMode.MaskSensitiveInputsOnly,
        [],
      );
      const input: HTMLInputElement = document.createElement("input");
      input.setAttribute("type", "hidden");

      expect(masking.markIfSensitive(input)).toBe(true);

      input.setAttribute("type", "text");

      expect(masking.isSticky(input)).toBe(true);
      expect(masking.maskInput("user-42@example.com", input)).not.toContain(
        "example.com",
      );
      expect(
        masking.sanitiseAttributeMutation(input, { value: "leaked" }),
      ).toBeNull();
    });

    it("pre-marks hidden fields in the document", (): void => {
      document.body.innerHTML = `
        <input type="hidden" name="csrf" value="tok" />
        <input type="text" id="plain" />
      `;

      const masking: Masking = maskAll();

      expect(masking.markSensitiveFieldsIn(document)).toBe(1);
    });
  });

  /*
   * rrweb's maskTextFn sees text NODES only; attributes were serialised
   * verbatim, so alt, title, aria-label, placeholder and mailto: hrefs all
   * survived a MaskAllText recording.
   */
  describe("attribute masking under MaskAllText", (): void => {
    it("masks the text-like attributes and leaves the structural ones", (): void => {
      const masking: Masking = maskAll();

      const masked: Record<string, unknown> = masking.maskAttributes("img", {
        alt: "Alice Hartwell",
        title: "alice@example.com",
        src: "https://cdn.example.com/a.png?sig=abc",
        class: "avatar",
        "aria-label": "Profile photo of Alice",
      });

      expect(masked["alt"]).not.toContain("Alice");
      expect(masked["title"]).not.toContain("alice");
      expect(masked["aria-label"]).not.toContain("Alice");
      expect(masked["src"]).toBe("https://cdn.example.com/a.png?sig=abc");
      expect(masked["class"]).toBe("avatar");
    });

    it("masks a placeholder", (): void => {
      expect(
        Masking.maskAttributeValue("input", "placeholder", "Enter your SSN"),
      ).not.toContain("SSN");
    });

    it("masks the value of an option but not of a progress bar", (): void => {
      expect(
        Masking.maskAttributeValue("option", "value", "alice@example.com"),
      ).not.toContain("alice");
      expect(Masking.maskAttributeValue("progress", "value", "70")).toBeNull();
      expect(Masking.maskAttributeValue("input", "value", "x")).toBeNull();
    });

    /*
     * REGRESSION (privacy-2). rrweb-snapshot skips maskInputValue for submit
     * and button inputs (their value is the button's LABEL, not typed
     * input), so `<input type="submit" value="Continue as alice@...">`
     * reached neither maskInput nor this table and survived MaskAllText.
     */
    it("masks a submit or button input's value, but leaves a typed one to maskInput", (): void => {
      for (const type of ["submit", "button", "reset"]) {
        expect(
          Masking.maskAttributeValue("input", "value", "Continue as alice", {
            type: type,
          }),
        ).not.toContain("alice");
      }

      expect(
        Masking.maskAttributeValue("input", "value", "typed", {
          type: "text",
        }),
      ).toBeNull();
      expect(Masking.maskAttributeValue("input", "value", "typed", {})).toBe(
        null,
      );
    });

    /*
     * A meta tag has no text node, so maskTextFn never sees it - and
     * slimDOMOptions keeps description/keywords and every custom meta, which
     * is where a server-rendered app puts the signed-in person.
     */
    it("masks a meta tag's content", (): void => {
      expect(
        Masking.maskAttributeValue(
          "meta",
          "content",
          "Invoices for Alice Hartwell",
        ),
      ).not.toContain("Hartwell");
      expect(
        Masking.maskAttributeValue("", "content", "alice@example.com"),
      ).not.toContain("alice");

      /* Not every element's content attribute; a div's is not page text. */
      expect(
        Masking.maskAttributeValue("div", "content", "structural"),
      ).toBeNull();
    });

    it("keeps short data-* tokens that drive CSS and masks free text", (): void => {
      expect(
        Masking.maskAttributeValue("div", "data-state", "open"),
      ).toBeNull();
      expect(
        Masking.maskAttributeValue("div", "data-id", "u_12345"),
      ).toBeNull();
      expect(
        Masking.maskAttributeValue("div", "data-email", "alice@example.com"),
      ).not.toContain("alice");
      expect(
        Masking.maskAttributeValue("div", "data-note", "Mum's maiden name"),
      ).not.toContain("maiden");
    });

    it("redacts contact hrefs and scrubs navigational ones on links only", (): void => {
      expect(
        Masking.maskAttributeValue("a", "href", "mailto:alice@example.com"),
      ).toBe("mailto:[redacted]");
      expect(Masking.maskAttributeValue("a", "href", "tel:+15551234567")).toBe(
        "tel:[redacted]",
      );
      expect(
        Masking.maskAttributeValue(
          "a",
          "href",
          "https://shop.example.com/users/alice@example.com?token=abc",
        ),
      ).toBe("https://shop.example.com/users/[redacted]");
      expect(Masking.maskAttributeValue("a", "href", "#top")).toBeNull();
      /* A stylesheet link is structural: the player needs it. */
      expect(
        Masking.maskAttributeValue(
          "link",
          "href",
          "https://cdn.example.com/app.css?v=1",
        ),
      ).toBeNull();
    });

    it("blanks an inline srcdoc document", (): void => {
      expect(
        Masking.maskAttributeValue("iframe", "srcdoc", "<p>secret</p>"),
      ).toBe("");
    });

    it("returns the same object when nothing needed masking", (): void => {
      const masking: Masking = maskAll();
      const attributes: Record<string, unknown> = { class: "a", id: "b" };

      expect(masking.maskAttributes("div", attributes)).toBe(attributes);
    });

    it("does nothing in the other two modes", (): void => {
      for (const mode of [
        SessionReplayMaskingMode.MaskInputsOnly,
        SessionReplayMaskingMode.MaskSensitiveInputsOnly,
      ]) {
        const masking: Masking = new Masking(mode, []);
        const attributes: Record<string, unknown> = { alt: "Alice" };

        expect(masking.maskAttributes("img", attributes)).toBe(attributes);
        expect(
          masking.sanitiseEventData({ node: { type: 2, attributes } }),
        ).toBe(0);
      }
    });

    it("applies to attribute mutations on any node, sticky or not", (): void => {
      const masking: Masking = maskAll();
      const image: HTMLImageElement = document.createElement("img");

      const sanitised: Record<string, unknown> | null =
        masking.sanitiseAttributeMutation(image, {
          alt: "Alice Hartwell",
          src: "/a.png",
        });

      expect(sanitised?.["alt"]).not.toContain("Alice");
      expect(sanitised?.["src"]).toBe("/a.png");
    });

    it("walks a serialised snapshot tree and the adds of a mutation", (): void => {
      const masking: Masking = maskAll();

      const snapshot: Record<string, unknown> = {
        type: 0,
        childNodes: [
          {
            type: 2,
            tagName: "html",
            attributes: {},
            childNodes: [
              {
                type: 2,
                tagName: "img",
                attributes: { alt: "Alice Hartwell", src: "/a.png" },
                childNodes: [],
              },
              {
                type: 2,
                tagName: "a",
                attributes: {
                  href: "mailto:alice@example.com",
                  title: "Alice",
                },
                childNodes: [{ type: 3, textContent: "masked elsewhere" }],
              },
            ],
          },
        ],
      };

      expect(masking.sanitiseEventData({ node: snapshot })).toBe(3);
      expect(JSON.stringify(snapshot)).not.toContain("Alice");
      expect(JSON.stringify(snapshot)).not.toContain("alice@example.com");
      expect(JSON.stringify(snapshot)).toContain("/a.png");

      const mutation: Record<string, unknown> = {
        source: 0,
        adds: [
          {
            parentId: 1,
            nextId: null,
            node: {
              type: 2,
              tagName: "input",
              attributes: { placeholder: "Enter your SSN", type: "text" },
              childNodes: [],
            },
          },
        ],
      };

      expect(masking.sanitiseEventData(mutation)).toBe(1);
      expect(JSON.stringify(mutation)).not.toContain("SSN");
      expect(JSON.stringify(mutation)).toContain('"type":"text"');
    });
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
