import CommonMasking from "Common/Utils/Rum/Masking";
import UrlScrubber from "Common/Utils/Rum/UrlScrubber";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";

/*
 * The recorder's masking policy: the browser-side half of
 * Common/Utils/Rum/Masking.
 *
 * Common owns the pure string transforms (fixed-length input mask, bucketed
 * text mask, the sensitive-autocomplete token list) so both sides of the
 * wire test them once. This file owns the parts that need a live DOM: the
 * rrweb option object, and STICKY per-node sensitivity.
 *
 * Sticky sensitivity is the load-bearing idea here. A "show password"
 * toggle mutates the input's type from "password" to "text". Any policy
 * keyed on the *current* type therefore stops masking exactly when the user
 * has made their password visible. So:
 *
 *   1. Once a node has ever looked sensitive it is remembered in a WeakSet
 *      and stays masked for the life of the page.
 *   2. The type mutation ITSELF is suppressed from the event stream, so
 *      playback cannot even see that the field became a text input — which
 *      matters because a viewer who sees "type changed to text" alongside a
 *      masked value knows they are looking at a password field.
 *
 * WeakSet rather than a Map keyed on rrweb node id: node ids are recycled
 * when a node is removed and re-added, and a WeakSet lets a detached node
 * be collected instead of leaking on a long-lived SPA.
 */

/*
 * Attribute keys that are dropped from a mutation targeting a sticky
 * sensitive node. "type" is the show-password toggle. "value" is dropped
 * because a page that mirrors a value into the attribute would otherwise
 * leak it despite rrweb masking the input event.
 *
 * "data-rr-is-password" is rrweb's own marker, not the page's: on a `type`
 * mutation away from password, rrweb 2.1.1 writes that attribute onto the
 * LIVE element (node_modules/rrweb/dist/rrweb.js:11918), which its mutation
 * observer then reports as a second attribute mutation on the same node in
 * the same batch. Suppressing only "type" therefore left the reveal
 * observable through the marker - a viewer who sees data-rr-is-password
 * appear next to a masked value knows exactly which field is the password,
 * which is the fact rule 2 above exists to hide.
 */
const SUPPRESSED_STICKY_ATTRIBUTES: Array<string> = [
  "type",
  "value",
  "placeholder",
  "data-rr-is-password",
];

/*
 * The exact rrweb maskInputOptions object, per mode.
 *
 * rrweb keys this table on HTML input *types* AND on tag names
 * (rrweb-snapshot maskInputValue: `maskInputOptions[tagName] ||
 * maskInputOptions[type]`). The `input` key is the tag-name entry and is
 * what routes EVERY input through maskInputFn whatever its type - including
 * type="hidden", which rrweb's own type list omits, and any type it has
 * never heard of. `hidden` is listed too so the intent survives a reader
 * who only checks the type keys.
 *
 * There is NO "creditcard" key in rrweb: card fields are type="text" or
 * live in a cross-origin PSP iframe. Card protection comes from routing
 * every input through maskInputFn plus maskAllText plus the autocomplete
 * heuristic in Common Masking, never from an option that does not exist.
 * Pinned by a snapshot test so a fictional key fails CI.
 */
export interface MaskInputOptionsShape {
  input: boolean;
  hidden: boolean;
  color: boolean;
  date: boolean;
  "datetime-local": boolean;
  email: boolean;
  month: boolean;
  number: boolean;
  range: boolean;
  search: boolean;
  tel: boolean;
  text: boolean;
  time: boolean;
  url: boolean;
  week: boolean;
  textarea: boolean;
  select: boolean;
  password: boolean;
}

const MASK_INPUT_OPTIONS: Readonly<MaskInputOptionsShape> = Object.freeze({
  input: true,
  hidden: true,
  color: true,
  date: true,
  "datetime-local": true,
  email: true,
  month: true,
  number: true,
  range: true,
  search: true,
  tel: true,
  text: true,
  time: true,
  url: true,
  week: true,
  textarea: true,
  select: true,
  password: true,
});

/* Selector for fields whose sensitivity we can decide without an attribute. */
const ALWAYS_SENSITIVE_SELECTOR: string =
  'input[type="password"], input[type="hidden"], input[autocomplete*="password"], input[autocomplete*="cc-"], input[autocomplete*="one-time-code"]';

/*
 * Attribute masking under MaskAllText.
 *
 * rrweb's maskTextFn sees text NODES only; attributes are serialised
 * verbatim, and rrweb 2.1.1 has no maskAttributeFn. So `<img alt="Alice
 * Smith">`, `<a title="alice@example.com">`, `<input placeholder="Enter
 * your SSN">` and `<a href="mailto:...">` all survived a MaskAllText
 * recording and rendered in the player. These are the attributes whose
 * value is TEXT a person could read, masked with the same bucketed
 * transform as a text node.
 */
const TEXT_LIKE_ATTRIBUTES: Array<string> = [
  "alt",
  "title",
  "placeholder",
  "label",
  "aria-label",
  "aria-description",
  "aria-valuetext",
  "aria-placeholder",
  "aria-roledescription",
];

/*
 * `value` is text on these elements. On input / textarea / select it is the
 * field value, which rrweb routes through maskInputFn and the sticky
 * suppression already covers; on progress / meter / li it is a number the
 * player needs to draw the element.
 */
const VALUE_IS_TEXT_TAGS: Array<string> = ["option", "data", "button"];

/*
 * Input types whose `value` is a LABEL a person reads off the page rather
 * than something they typed. rrweb-snapshot skips maskInputValue for
 * submit and button (rrweb.js:1014), so `<input type="submit" value="Continue
 * as alice@example.com">` reached neither maskInput nor this table and
 * survived a MaskAllText recording verbatim. reset is the same shape.
 */
const VALUE_IS_LABEL_INPUT_TYPES: Array<string> = ["submit", "button", "reset"];

/*
 * `<meta name="description" content="Invoices for Alice Hartwell">` is page
 * text by another route, and slimDOMOptions keeps description/keywords and
 * every custom meta (frameworks bootstrap from them). The tag has no text
 * node, so rrweb's maskTextFn never sees it.
 */
const CONTENT_IS_TEXT_TAGS: Array<string> = ["meta"];

/*
 * A data-* value that is a short token, not text. Frameworks drive CSS
 * attribute selectors off these (`[data-state="open"]`, `[data-theme]`),
 * so masking them would break the replay's LAYOUT rather than protect
 * anything; a value with whitespace, an @, or real length is free text and
 * is masked. A short pseudonymous id survives, which URL scrubbing already
 * accepts for path segments under 32 characters.
 */
const DATA_ATTRIBUTE_TOKEN_PATTERN: RegExp = /^[A-Za-z0-9_.:/-]{0,32}$/;

/* Links that carry the contact detail in the URL itself. */
const CONTACT_HREF_PATTERN: RegExp = /^(mailto|tel|sms|callto|facetime):/i;

/* Elements whose href is a navigation the player never follows. */
const LINK_TAGS: Array<string> = ["a", "area"];

const ABSOLUTE_HTTP_URL_PATTERN: RegExp = /^https?:\/\//i;

/* rrweb-snapshot NodeType.Element. */
const SERIALIZED_ELEMENT_NODE: number = 2;

export default class Masking {
  private readonly maskingMode: SessionReplayMaskingMode;
  private readonly maskSelectors: Array<string>;

  /*
   * Nodes that were EVER sensitive. Never removed from: that is the whole
   * point of the word sticky.
   */
  private readonly stickyNodes: WeakSet<Node> = new WeakSet<Node>();

  public constructor(
    maskingMode: SessionReplayMaskingMode,
    maskSelectors: Array<string>,
  ) {
    this.maskingMode = maskingMode;
    this.maskSelectors = maskSelectors;
  }

  public static getMaskInputOptions(): Readonly<MaskInputOptionsShape> {
    return MASK_INPUT_OPTIONS;
  }

  public isMaskAllText(): boolean {
    return this.maskingMode === SessionReplayMaskingMode.MaskAllText;
  }

  /*
   * The one mode that lets an ordinary input value through. Every other
   * mode masks every input, so this is the only place the value argument
   * of maskInput is ever returned.
   */
  public isMaskSensitiveInputsOnly(): boolean {
    return (
      this.maskingMode === SessionReplayMaskingMode.MaskSensitiveInputsOnly
    );
  }

  /*
   * rrweb's maskInputFn. Called with the current value and the element.
   *
   * Every input reaches this function in EVERY mode (the `input` tag key in
   * MASK_INPUT_OPTIONS, see getRrwebMaskingOptions), so it is the single
   * place that decides whether a value survives. Leaving the decision to
   * rrweb's type-keyed table would key it on the input's current type,
   * which a "show password" toggle mutates - the exact bug the sticky
   * WeakSet exists to prevent.
   *
   * When a value is masked the returned mask is constant-width: returning
   * anything derived from the real value, including its length, is the
   * length-oracle bug this module exists to avoid.
   */
  public maskInput = (value: string, element: HTMLElement): string => {
    const isSensitive: boolean = this.markIfSensitive(element);

    const type: string = (element.getAttribute("type") || "").toLowerCase();

    /*
     * File inputs are blanked in every mode, sensitive or not: their DOM
     * value is "C:\fakepath\<real filename>" and filenames are routinely
     * personal ("passport-scan.pdf").
     */
    if (type === "file") {
      return CommonMasking.maskFileInputValue();
    }

    /*
     * Hidden inputs are masked in every mode. Nobody sees them on the page,
     * so nothing is lost from the replay, and what they hold - CSRF tokens,
     * user ids, pre-filled emails, order totals - is exactly what a viewer
     * must not be able to read out of a recording.
     */
    if (type === "hidden") {
      return CommonMasking.maskInputValue();
    }

    if (
      this.isMaskSensitiveInputsOnly() &&
      !isSensitive &&
      !this.matchesMaskSelector(element)
    ) {
      return value;
    }

    return CommonMasking.maskInputValue();
  };

  /*
   * Does this element match one of the application's configured mask
   * selectors?
   *
   * Only consulted in MaskSensitiveInputsOnly. In the two stricter modes
   * every input is masked anyway, and static text is handled by rrweb
   * through getMaskTextSelector. Without this, "Additional mask
   * selectors" would silently do nothing to input VALUES under the
   * default mode, which is exactly where a customer reaches for it.
   */
  /*
   * The application's configured mask selectors. Read by the ClickRecorder,
   * which has to answer a question closest() cannot: does this element
   * CONTAIN a masked one?
   */
  public getMaskSelectors(): Array<string> {
    return this.maskSelectors;
  }

  public matchesMaskSelector(element: Element): boolean {
    if (this.maskSelectors.length === 0) {
      return false;
    }

    for (const selector of this.maskSelectors) {
      if (!selector) {
        continue;
      }

      try {
        if (element.closest(selector)) {
          return true;
        }
      } catch {
        /*
         * A customer-authored selector can be invalid, and closest()
         * throws on a bad one. Skipping it is right: one broken entry
         * must not disable the rest of the list, and it must never throw
         * into the host page from inside rrweb's serializer.
         */
        continue;
      }
    }

    return false;
  }

  /* rrweb's maskTextFn. element is null for detached text nodes. */
  public maskText = (text: string, element: HTMLElement | null): string => {
    if (element) {
      this.markIfSensitive(element);
    }

    return CommonMasking.maskText(text);
  };

  /*
   * Remember a node as sensitive if it looks sensitive right now. Safe to
   * call repeatedly and on any element; non-form elements simply never
   * match.
   */
  public markIfSensitive(element: HTMLElement | Element): boolean {
    if (this.stickyNodes.has(element)) {
      return true;
    }

    if (!Masking.isCurrentlySensitive(element)) {
      return false;
    }

    this.stickyNodes.add(element);

    return true;
  }

  public isSticky(node: Node | null): boolean {
    if (!node) {
      return false;
    }

    return this.stickyNodes.has(node);
  }

  /*
   * Is this element sensitive by its CURRENT attributes? Only ever used to
   * decide whether to ADD to the sticky set - never to decide that a node
   * has stopped being sensitive.
   */
  public static isCurrentlySensitive(element: Element): boolean {
    const tagName: string = element.tagName
      ? element.tagName.toLowerCase()
      : "";

    if (tagName !== "input" && tagName !== "textarea") {
      return false;
    }

    const type: string = (element.getAttribute("type") || "").toLowerCase();

    if (CommonMasking.isAlwaysSensitiveInputType(type)) {
      return true;
    }

    /*
     * Sticky as well as masked: a hidden field later mutated to type="text"
     * (a "show details" toggle, a form builder's debug mode) must not start
     * leaking the value it held while hidden.
     */
    if (type === "hidden") {
      return true;
    }

    const autocomplete: string = element.getAttribute("autocomplete") || "";

    return CommonMasking.isStickySensitiveAutocomplete(autocomplete);
  }

  /*
   * Pre-mark every currently sensitive field in a document.
   *
   * Run at init and after each full snapshot, so a node is already in the
   * sticky set BEFORE a show-password toggle can mutate it. Without this
   * pass we would only learn a field was a password when rrweb happens to
   * call maskInputFn on it, which for an untouched empty field may be
   * after the toggle has already fired.
   */
  public markSensitiveFieldsIn(root: ParentNode): number {
    let marked: number = 0;

    let elements: Array<Element> = [];

    try {
      elements = Array.prototype.slice.call(
        root.querySelectorAll(ALWAYS_SENSITIVE_SELECTOR),
      ) as Array<Element>;
    } catch {
      /*
       * An invalid selector cannot happen for the constant above, but
       * querySelectorAll on a detached or cross-document root can throw.
       * Failing to mark is worse than throwing into the host page, so this
       * degrades quietly and the per-node checks still apply.
       */
      return 0;
    }

    for (const element of elements) {
      if (this.markIfSensitive(element)) {
        marked++;
      }
    }

    return marked;
  }

  /*
   * Strip attributes that would leak a sticky sensitive field's state.
   *
   * Returns a NEW attribute record, or null when nothing survives, so the
   * caller can drop the mutation entry entirely rather than emit an empty
   * one.
   */
  public sanitiseAttributeMutation(
    node: Node | null,
    attributes: Record<string, unknown>,
  ): Record<string, unknown> | null {
    if (node && node instanceof Element) {
      /*
       * Mark before filtering: a node whose type is being mutated TO
       * something sensitive must become sticky on the way in, not only on
       * the way out.
       */
      this.markIfSensitive(node);
    }

    const tagName: string =
      node && node instanceof Element && node.tagName
        ? node.tagName.toLowerCase()
        : "";

    if (!this.isSticky(node)) {
      return this.maskAttributes(tagName, attributes);
    }

    const kept: Record<string, unknown> = {};
    let keptCount: number = 0;

    for (const key of Object.keys(attributes)) {
      if (SUPPRESSED_STICKY_ATTRIBUTES.includes(key.toLowerCase())) {
        continue;
      }

      kept[key] = attributes[key];
      keptCount++;
    }

    return keptCount > 0 ? this.maskAttributes(tagName, kept) : null;
  }

  /*
   * Mask the text-like attributes of one element's attribute record under
   * MaskAllText. Returns the SAME object when nothing changed (so callers
   * can keep an identity check), a copy otherwise. In the other two modes
   * page text is recorded verbatim by policy, and so are these.
   *
   * `tagName` is "" when the caller does not know the element (a mutation
   * whose node the mirror no longer has); the tag-specific rules then err
   * toward masking.
   */
  public maskAttributes(
    tagName: string,
    attributes: Record<string, unknown>,
  ): Record<string, unknown> {
    if (!this.isMaskAllText()) {
      return attributes;
    }

    let masked: Record<string, unknown> | null = null;

    for (const key of Object.keys(attributes)) {
      const value: unknown = attributes[key];

      if (typeof value !== "string" || !value) {
        continue;
      }

      const replacement: string | null = Masking.maskAttributeValue(
        tagName,
        key,
        value,
        attributes,
      );

      if (replacement === null || replacement === value) {
        continue;
      }

      if (!masked) {
        masked = { ...attributes };
      }

      masked[key] = replacement;
    }

    return masked || attributes;
  }

  /*
   * The replacement for one attribute, or null to leave it alone. Pure and
   * static so the rule is testable without a DOM.
   *
   * `attributes` is the element's whole serialised attribute record, when
   * the caller has it: an input's `value` is a label or a typed value
   * depending on its `type`, and that cannot be decided from the one
   * attribute alone.
   */
  public static maskAttributeValue(
    tagName: string,
    name: string,
    value: string,
    attributes?: Record<string, unknown>,
  ): string | null {
    const key: string = name.toLowerCase();
    const tag: string = tagName.toLowerCase();

    if (TEXT_LIKE_ATTRIBUTES.includes(key)) {
      return CommonMasking.maskText(value);
    }

    if (key === "value" && (tag === "" || VALUE_IS_TEXT_TAGS.includes(tag))) {
      return CommonMasking.maskText(value);
    }

    /*
     * A submit or button input's value is the button's LABEL, not something
     * the user typed, which is why rrweb-snapshot skips maskInputValue for
     * those two types (rrweb.js:1014) - and why nothing else masked
     * `<input type="submit" value="Continue as alice@example.com">`. Every
     * other input value is rrweb's maskInputFn to mask, and it does; an
     * absent type is a text input, so it is left alone here.
     */
    if (
      key === "value" &&
      tag === "input" &&
      attributes &&
      typeof attributes["type"] === "string" &&
      VALUE_IS_LABEL_INPUT_TYPES.includes(
        (attributes["type"] as string).toLowerCase(),
      )
    ) {
      return CommonMasking.maskText(value);
    }

    if (
      key === "content" &&
      (tag === "" || CONTENT_IS_TEXT_TAGS.includes(tag))
    ) {
      return CommonMasking.maskText(value);
    }

    if (key.startsWith("data-")) {
      return DATA_ATTRIBUTE_TOKEN_PATTERN.test(value)
        ? null
        : CommonMasking.maskText(value);
    }

    /*
     * An inline document is markup, and markup is text. The player renders
     * an empty frame in its place - which is what it renders for every
     * cross-origin iframe already.
     */
    if (key === "srcdoc") {
      return "";
    }

    if (key === "href" && (tag === "" || LINK_TAGS.includes(tag))) {
      return Masking.maskHref(value);
    }

    /*
     * src, srcset and poster stay: the player needs them to draw the image,
     * and an image URL is a reference rather than readable text. A query
     * string on one can carry a signed token, which is a known limit of the
     * MaskAllText promise and is documented as such.
     */
    return null;
  }

  /*
   * A link's destination is text when it IS the contact detail (mailto:,
   * tel:) and a URL otherwise. URLs go through the same scrubber as every
   * other URL the recorder emits; links are never followed in the player, so
   * nothing structural is lost. Fragment-only and javascript: hrefs are left
   * alone - one is an anchor id, the other is code.
   */
  public static maskHref(value: string): string | null {
    const match: RegExpMatchArray | null = value.match(CONTACT_HREF_PATTERN);

    if (match) {
      return `${(match[1] || "").toLowerCase()}:[redacted]`;
    }

    if (ABSOLUTE_HTTP_URL_PATTERN.test(value) || value.startsWith("/")) {
      return UrlScrubber.scrub(value);
    }

    return null;
  }

  /*
   * Walk a serialised rrweb node tree - a FullSnapshot's `node`, or the
   * `node` of each mutation `adds` entry - and mask the text-like
   * attributes of every element in place. Depth-bounded iteration rather
   * than recursion: a deep document must not blow the stack inside rrweb's
   * emit.
   *
   * Returns how many attributes were rewritten.
   */
  public sanitiseSerializedNode(root: unknown): number {
    if (!this.isMaskAllText() || !root || typeof root !== "object") {
      return 0;
    }

    let rewritten: number = 0;
    const stack: Array<Record<string, unknown>> = [
      root as Record<string, unknown>,
    ];

    while (stack.length > 0) {
      const node: Record<string, unknown> = stack.pop()!;

      if (
        node["type"] === SERIALIZED_ELEMENT_NODE &&
        node["attributes"] &&
        typeof node["attributes"] === "object"
      ) {
        const attributes: Record<string, unknown> = node[
          "attributes"
        ] as Record<string, unknown>;
        const tagName: string =
          typeof node["tagName"] === "string" ? node["tagName"] : "";

        const masked: Record<string, unknown> = this.maskAttributes(
          tagName,
          attributes,
        );

        if (masked !== attributes) {
          for (const key of Object.keys(masked)) {
            if (masked[key] !== attributes[key]) {
              rewritten++;
            }
          }

          node["attributes"] = masked;
        }
      }

      const children: unknown = node["childNodes"];

      if (Array.isArray(children)) {
        for (const child of children) {
          if (child && typeof child === "object") {
            stack.push(child as Record<string, unknown>);
          }
        }
      }
    }

    return rewritten;
  }

  /*
   * The two event shapes the recorder hands over. A FullSnapshot carries
   * `data.node`; a mutation carries `data.adds[]`, each with a `node`.
   * Everything else is left alone. Returns how many attributes were
   * rewritten, for tests and diagnostics.
   */
  public sanitiseEventData(data: Record<string, unknown>): number {
    if (!this.isMaskAllText()) {
      return 0;
    }

    let rewritten: number = 0;

    if (data["node"] && typeof data["node"] === "object") {
      rewritten += this.sanitiseSerializedNode(data["node"]);
    }

    const adds: unknown = data["adds"];

    if (Array.isArray(adds)) {
      for (const add of adds) {
        if (add && typeof add === "object") {
          rewritten += this.sanitiseSerializedNode(
            (add as Record<string, unknown>)["node"],
          );
        }
      }
    }

    return rewritten;
  }

  /*
   * Mask a console argument through the same transform as a text node, so
   * console.error("order for alice@example.com failed") cannot be the hole
   * in an otherwise fully masked recording.
   */
  public maskConsoleArgument(value: string): string {
    if (!this.isMaskAllText()) {
      return value;
    }

    return CommonMasking.maskText(value);
  }

  /*
   * The selector rrweb uses to decide which text nodes to mask.
   *
   * NOTE: rrweb 2.1.1 has NO maskAllText record option, despite what most
   * write-ups (and this feature's own design doc) claim. Text masking is
   * driven entirely by maskTextClass and maskTextSelector, and rrweb resolves
   * the selector with element.closest(), so "*" matches every element and is
   * the supported way to express mask-everything. Passing a non-existent
   * option would have silently recorded every page in plaintext.
   *
   * Returns a possibly-empty string; the caller must omit the rrweb option
   * entirely when it is empty, because an empty selector throws inside
   * querySelector.
   */
  public getMaskTextSelector(): string {
    if (this.isMaskAllText()) {
      return "*";
    }

    return this.maskSelectors.join(",");
  }

  /*
   * The masking half of the rrweb option object. Kept here so the Recorder
   * does not have to know how policy selectors map onto rrweb option names.
   */
  public getRrwebMaskingOptions(): {
    maskAllInputs: boolean;
    maskInputOptions: Readonly<MaskInputOptionsShape>;
    maskTextClass: string;
    maskTextSelector: string;
    ignoreClass: string;
  } {
    return {
      /*
       * FALSE, in every mode - and that is what routes every input through
       * maskInputFn. rrweb's record() DISCARDS the maskInputOptions it was
       * handed whenever maskAllInputs is true and substitutes its own
       * type-keyed table (rrweb.js:14279), which has no entry for
       * type="hidden" or for the tag name: with `true`, hidden inputs never
       * reached maskInput and their values went out verbatim in every mode.
       * With `false`, rrweb uses MASK_INPUT_OPTIONS as given, whose `input`
       * key matches every <input> by tag name. maskInput above is what then
       * decides; see its header.
       */
      maskAllInputs: false,
      maskInputOptions: MASK_INPUT_OPTIONS,
      maskTextClass: "oneuptime-mask",
      maskTextSelector: this.getMaskTextSelector(),
      ignoreClass: "oneuptime-ignore",
    };
  }
}
