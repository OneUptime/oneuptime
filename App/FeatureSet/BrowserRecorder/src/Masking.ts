import CommonMasking from "Common/Utils/Rum/Masking";
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
 * There is NO "creditcard" key in rrweb: it keys on HTML input *types*, and
 * card fields are type="text" or live in a cross-origin PSP iframe. Card
 * protection comes from maskAllInputs plus maskAllText plus the
 * autocomplete heuristic in Common Masking, never from an option that does
 * not exist. Pinned by a snapshot test so a fictional key fails CI.
 */
export interface MaskInputOptionsShape {
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
  'input[type="password"], input[autocomplete*="password"], input[autocomplete*="cc-"], input[autocomplete*="one-time-code"]';

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
   * rrweb's maskInputFn. Called with the current value and the element.
   *
   * The value argument is deliberately ignored: returning anything derived
   * from it, including its length, is the length-oracle bug this whole
   * module exists to avoid. The element is used only to record stickiness
   * and to blank file inputs, whose DOM value is
   * "C:\fakepath\<real filename>".
   */
  public maskInput = (_value: string, element: HTMLElement): string => {
    this.markIfSensitive(element);

    const type: string = (element.getAttribute("type") || "").toLowerCase();

    if (type === "file") {
      return CommonMasking.maskFileInputValue();
    }

    return CommonMasking.maskInputValue();
  };

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

    if (!this.isSticky(node)) {
      return attributes;
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

    return keptCount > 0 ? kept : null;
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
       * Always true, in every mode. MaskInputsOnly relaxes static text, and
       * never input values.
       */
      maskAllInputs: true,
      maskInputOptions: MASK_INPUT_OPTIONS,
      maskTextClass: "oneuptime-mask",
      maskTextSelector: this.getMaskTextSelector(),
      ignoreClass: "oneuptime-ignore",
    };
  }
}
