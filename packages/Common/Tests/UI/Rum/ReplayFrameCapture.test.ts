import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
  REPLAY_FRAME_BROKEN_IMAGE,
  REPLAY_FRAME_DEFAULT_BACKGROUND,
  REPLAY_FRAME_FREEZE_CSS,
  REPLAY_FRAME_IMAGE_PLACEHOLDER,
  REPLAY_FRAME_LINK_PROPERTIES,
  REPLAY_FRAME_MAX_CANVAS_PIXELS,
  REPLAY_FRAME_MAX_FRAME_DEPTH,
  REPLAY_FRAME_MAX_PIXEL_RATIO,
  REPLAY_FRAME_ROOT_SELECTOR,
  REPLAY_FRAME_TRANSPARENT_IMAGE,
  ReplayFrameCaptureError,
  ReplayFrameCaptureFailure,
  ReplayFramePointer,
  ReplayFrameRasterDeps,
  ReplayFrameSerialization,
  ReplayFrameViewport,
  buildReplayFrameSvg,
  captureReplayFrame,
  computeScrollSnapMargin,
  drawReplayFramePointer,
  encodeReplayFrameCanvas,
  escapeXmlAttribute,
  isTransparentColor,
  isXmlSafeName,
  rasterizeReplayFrame,
  readStyleSheetText,
  resolveReplayFramePixelRatio,
  rewriteReplayCss,
  serializeReplayFrame,
  stripInvalidXmlCharacters,
  toCssPropertyName,
  toReplayFrameCaptureError,
  toSvgDataUrl,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayFrameCapture";
import {
  REPLAY_SHADOW_TEXT_SELECTION_STYLE_ATTRIBUTE,
  REPLAY_TEXT_SELECTION_ATTRIBUTE,
  REPLAY_TEXT_SELECTION_STYLE_ATTRIBUTE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayStage";

/*
 * The paused-frame screenshot, from the replay document to the PNG.
 *
 * The frame is re-drawn rather than read back: the replay document is
 * cloned into XHTML, wrapped in an SVG <foreignObject> and painted onto a
 * canvas. What is pinned here is everything that clone has to carry across
 * that a naive serialiser loses - the CSSOM-only rules, form state held in
 * properties, scroll offsets put back with scroll snapping, flattened
 * shadow trees, frozen animations, the top layer, link colours and the
 * root's overflow and background - and the promises it makes: the output
 * is always well-formed XML, it never points outside the frame, and the
 * LIVE replay document is never written to. The clone is taken the moment
 * the capture starts, so pressing Play mid-encode changes nothing.
 *
 * jsdom has no layout, no canvas and no image decoding. Boxes, scroll
 * offsets and client rects are stubbed per element; the rasteriser runs
 * against injected fake deps (a recording 2D context, a loadImage that
 * keeps every URL it was handed, a nextFrame that resolves at once), so
 * the exact SVG each canvas was painted from can be decoded and read.
 * Two further jsdom gaps are bridged in the seams below: its CSSOM hands
 * out cssRules as a plain Array (a browser's CSSRuleList has item()), and
 * getComputedStyle(element, pseudo) is not implemented at all.
 */

const XHTML_NAMESPACE: string = "http://www.w3.org/1999/xhtml";
const SVG_NAMESPACE: string = "http://www.w3.org/2000/svg";
const XLINK_NAMESPACE: string = "http://www.w3.org/1999/xlink";
const SVG_DATA_URL_PREFIX: string = "data:image/svg+xml;base64,";
const EMPTY_URL: string = `url("${REPLAY_FRAME_BROKEN_IMAGE}")`;
const VIEWPORT: ReplayFrameViewport = { width: 800, height: 600 };

/* ---- jsdom seams. ---- */

const mountedIframes: Array<HTMLIFrameElement> = [];
const pseudoStyles: WeakMap<
  Element,
  Map<string, Record<string, string> | Error>
> = new WeakMap<Element, Map<string, Record<string, string> | Error>>();
const computedOverrides: WeakMap<Element, Record<string, string>> = new WeakMap<
  Element,
  Record<string, string>
>();

afterEach(() => {
  for (const iframe of mountedIframes.splice(0)) {
    iframe.remove();
  }

  jest.restoreAllMocks();
});

/* A computed style carrying exactly these declarations, in this order. */
function makeStyle(declarations: Record<string, string>): CSSStyleDeclaration {
  const names: Array<string> = Object.keys(declarations);
  const style: Pick<
    CSSStyleDeclaration,
    "length" | "item" | "getPropertyValue"
  > = {
    length: names.length,
    item: (index: number): string => {
      return names[index] ?? "";
    },
    getPropertyValue: (name: string): string => {
      return declarations[name] ?? "";
    },
  };

  return style as CSSStyleDeclaration;
}

/*
 * jsdom answers getComputedStyle(element, pseudo) with a "not implemented"
 * error on the virtual console. Pseudo-element styles come from
 * setPseudoStyle instead (an element without one has `content: none`),
 * and overrideComputedStyle layers browser-like values over what jsdom
 * computed from the element's declarations.
 */
function installComputedStyleSeam(view: Window): void {
  const original: Window["getComputedStyle"] = view.getComputedStyle.bind(view);

  Object.defineProperty(view, "getComputedStyle", {
    configurable: true,
    writable: true,
    value: (element: Element, pseudo?: string | null): CSSStyleDeclaration => {
      if (pseudo) {
        const entry: Record<string, string> | Error | undefined = pseudoStyles
          .get(element)
          ?.get(pseudo);

        if (entry instanceof Error) {
          throw entry;
        }

        return makeStyle(entry ?? { content: "none" });
      }

      const computed: CSSStyleDeclaration = original(element);
      const override: Record<string, string> | undefined =
        computedOverrides.get(element);

      if (!override) {
        return computed;
      }

      const merged: Record<string, string> = {};

      for (let index: number = 0; index < computed.length; index++) {
        const name: string = computed.item(index);
        merged[name] = computed.getPropertyValue(name);
      }

      return makeStyle({ ...merged, ...override });
    },
  });
}

function setPseudoStyle(
  element: Element,
  pseudo: string,
  declarations: Record<string, string> | Error,
): void {
  let entries: Map<string, Record<string, string> | Error> | undefined =
    pseudoStyles.get(element);

  if (!entries) {
    entries = new Map<string, Record<string, string> | Error>();
    pseudoStyles.set(element, entries);
  }

  entries.set(pseudo, declarations);
}

function overrideComputedStyle(
  element: Element,
  declarations: Record<string, string>,
): void {
  computedOverrides.set(element, declarations);
}

/* jsdom's cssRules is a plain Array; a browser's CSSRuleList has item(). */
function giveRuleListItem(sheet: CSSStyleSheet | null | undefined): void {
  if (!sheet) {
    return;
  }

  const rules: CSSRuleList = sheet.cssRules;

  if (typeof rules.item === "function") {
    return;
  }

  Object.defineProperty(rules, "item", {
    configurable: true,
    value: (index: number): CSSRule | null => {
      return rules[index] ?? null;
    },
  });
}

function prepareRuleLists(replayDocument: Document): void {
  for (
    let index: number = 0;
    index < replayDocument.styleSheets.length;
    index++
  ) {
    giveRuleListItem(replayDocument.styleSheets[index] as CSSStyleSheet);
  }

  replayDocument
    .querySelectorAll("iframe")
    .forEach((frame: HTMLIFrameElement): void => {
      let child: Document | null = null;

      try {
        child = frame.contentDocument;
      } catch {
        child = null;
      }

      if (child) {
        prepareRuleLists(child);
      }
    });
}

interface ReplayDocumentOptions {
  head?: string;
  htmlAttributes?: string;
  quirks?: boolean;
}

function writeReplayDocument(
  target: Document,
  body: string,
  options?: ReplayDocumentOptions,
): Document {
  const doctype: string = options?.quirks ? "" : "<!DOCTYPE html>";
  const attributes: string = options?.htmlAttributes
    ? ` ${options.htmlAttributes}`
    : "";

  target.open();
  target.write(
    `${doctype}<html${attributes}><head>${options?.head ?? ""}</head><body>${body}</body></html>`,
  );
  target.close();
  installComputedStyleSeam(target.defaultView as Window);

  return target;
}

/* A replay document the way the stage has one: in a same-origin iframe. */
function makeReplayDocument(
  body: string,
  options?: ReplayDocumentOptions,
): Document {
  const iframe: HTMLIFrameElement = document.createElement("iframe");
  document.body.appendChild(iframe);
  mountedIframes.push(iframe);

  return writeReplayDocument(iframe.contentDocument as Document, body, options);
}

function liveById(replayDocument: Document, id: string): HTMLElement {
  const element: HTMLElement | null = replayDocument.getElementById(id);

  if (!element) {
    throw new Error(`The live document has no #${id}`);
  }

  return element;
}

interface BoxStub {
  scrollTop?: number;
  scrollLeft?: number;
  clientTop?: number;
  clientLeft?: number;
  clientWidth?: number;
  clientHeight?: number;
  offsetWidth?: number;
  offsetHeight?: number;
  rect?: { top: number; left: number; width?: number; height?: number };
  clientRectCount?: number;
}

const BOX_METRICS: Array<
  | "scrollTop"
  | "scrollLeft"
  | "clientTop"
  | "clientLeft"
  | "clientWidth"
  | "clientHeight"
  | "offsetWidth"
  | "offsetHeight"
> = [
  "scrollTop",
  "scrollLeft",
  "clientTop",
  "clientLeft",
  "clientWidth",
  "clientHeight",
  "offsetWidth",
  "offsetHeight",
];

function makeRect(box: {
  top: number;
  left: number;
  width?: number;
  height?: number;
}): DOMRect {
  const width: number = box.width ?? 0;
  const height: number = box.height ?? 0;

  return {
    x: box.left,
    y: box.top,
    top: box.top,
    left: box.left,
    width: width,
    height: height,
    right: box.left + width,
    bottom: box.top + height,
    toJSON: (): string => {
      return "";
    },
  } as DOMRect;
}

/* Layout jsdom does not have, stubbed on the one element. */
function stubBox(element: Element, box: BoxStub): void {
  for (const metric of BOX_METRICS) {
    const value: number | undefined = box[metric];

    if (typeof value === "number") {
      Object.defineProperty(element, metric, {
        configurable: true,
        get: (): number => {
          return value;
        },
      });
    }
  }

  const rect: BoxStub["rect"] = box.rect;

  if (rect) {
    Object.defineProperty(element, "getBoundingClientRect", {
      configurable: true,
      value: (): DOMRect => {
        return makeRect(rect);
      },
    });
  }

  const clientRectCount: number | undefined = box.clientRectCount;

  if (typeof clientRectCount === "number") {
    Object.defineProperty(element, "getClientRects", {
      configurable: true,
      value: (): DOMRectList => {
        return {
          length: clientRectCount,
          item: (): DOMRect | null => {
            return null;
          },
        } as unknown as DOMRectList;
      },
    });
  }
}

/* A same-origin child frame of the given client size, with its own page. */
function mountChildFrame(
  parent: Document,
  id: string,
  body: string,
  size: ReplayFrameViewport,
): Document {
  const frame: HTMLIFrameElement = liveById(parent, id) as HTMLIFrameElement;
  stubBox(frame, { clientWidth: size.width, clientHeight: size.height });

  return writeReplayDocument(frame.contentDocument as Document, body);
}

function attachShadow(host: Element, html: string): ShadowRoot {
  const root: ShadowRoot = host.attachShadow({ mode: "open" });
  root.innerHTML = html;

  return root;
}

/* jsdom's nwsapi does not know :modal; a real modal dialog matches it. */
function makeModal(dialog: Element): void {
  const original: (selectors: string) => boolean = dialog.matches.bind(dialog);

  Object.defineProperty(dialog, "matches", {
    configurable: true,
    value: (selectors: string): boolean => {
      return selectors === ":modal" ? true : original(selectors);
    },
  });
}

function markImageLoaded(
  image: Element,
  natural: { width: number; height: number },
): void {
  Object.defineProperty(image, "complete", {
    configurable: true,
    get: (): boolean => {
      return true;
    },
  });
  Object.defineProperty(image, "naturalWidth", {
    configurable: true,
    get: (): number => {
      return natural.width;
    },
  });
  Object.defineProperty(image, "naturalHeight", {
    configurable: true,
    get: (): number => {
      return natural.height;
    },
  });
}

interface ImageCanvasMock {
  draws: Array<Array<unknown>>;
}

/* The canvas the serialiser copies a decoded <img> through. */
function mockImageCanvas(behaviour: {
  hasContext: boolean;
  dataUrl?: string;
  isTainted?: boolean;
}): ImageCanvasMock {
  const draws: Array<Array<unknown>> = [];
  const context: { drawImage: (...args: Array<unknown>) => void } = {
    drawImage: (...args: Array<unknown>): void => {
      draws.push(args);
    },
  };

  jest
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockImplementation((): any => {
      return behaviour.hasContext ? context : null;
    });
  jest
    .spyOn(HTMLCanvasElement.prototype, "toDataURL")
    .mockImplementation((): string => {
      if (behaviour.isTainted) {
        throw new DOMException(
          "Tainted canvases may not be exported.",
          "SecurityError",
        );
      }

      return behaviour.dataUrl ?? "data:,";
    });

  return { draws: draws };
}

interface FakeAnimationInput {
  target: unknown;
  keyframes?: Array<Record<string, unknown>>;
  pseudoElement?: string | null;
}

function fakeAnimation(input: FakeAnimationInput): unknown {
  return {
    effect: {
      target: input.target,
      pseudoElement: input.pseudoElement ?? null,
      getKeyframes: (): Array<Record<string, unknown>> => {
        return input.keyframes ?? [];
      },
    },
  };
}

function defineAnimations(
  replayDocument: Document,
  getAnimations: () => Array<unknown>,
): void {
  Object.defineProperty(replayDocument, "getAnimations", {
    configurable: true,
    value: getAnimations,
  });
}

/* ---- Reading the output. ---- */

function serialize(
  replayDocument: Document,
  viewport?: ReplayFrameViewport,
): ReplayFrameSerialization {
  prepareRuleLists(replayDocument);

  return serializeReplayFrame(replayDocument, viewport ?? VIEWPORT);
}

/* Parses as the SVG image loader will: any malformed XML fails the test. */
function parseSvg(svg: string): Document {
  const parsed: Document = new DOMParser().parseFromString(
    svg,
    "image/svg+xml",
  );

  expect(parsed.getElementsByTagName("parsererror")).toHaveLength(0);

  return parsed;
}

function childNamed(parent: Element, name: string): Element {
  for (let index: number = 0; index < parent.children.length; index++) {
    const child: Element | null = parent.children.item(index);

    if (child && child.localName === name) {
      return child;
    }
  }

  throw new Error(`<${parent.localName}> has no <${name}> child`);
}

function byId(root: Document | Element, id: string): Element {
  const element: Element | null = root.querySelector(`[id="${id}"]`);

  if (!element) {
    throw new Error(`The output has no #${id}`);
  }

  return element;
}

function styleOf(element: Element): string {
  return element.getAttribute("style") ?? "";
}

interface CapturedFrame {
  serialization: ReplayFrameSerialization;
  svg: Document;
  foreignObject: Element;
  /* The viewport <div>: the snap container the page scrolls in. */
  frame: Element;
  /* The frame's last child: the snap target at the root scroll offset. */
  marker: Element;
  html: Element;
  head: Element;
  body: Element;
}

function readFrame(serialization: ReplayFrameSerialization): CapturedFrame {
  const svg: Document = parseSvg(serialization.svg);
  const foreignObject: Element = childNamed(
    svg.documentElement,
    "foreignObject",
  );
  const frame: Element = foreignObject.firstElementChild as Element;
  const html: Element = childNamed(frame, "html");

  return {
    serialization: serialization,
    svg: svg,
    foreignObject: foreignObject,
    frame: frame,
    marker: frame.lastElementChild as Element,
    html: html,
    head: childNamed(html, "head"),
    body: childNamed(html, "body"),
  };
}

function capture(
  replayDocument: Document,
  viewport?: ReplayFrameViewport,
): CapturedFrame {
  return readFrame(serialize(replayDocument, viewport));
}

function headStyleTexts(captured: CapturedFrame): Array<string> {
  return Array.from(captured.head.children)
    .filter((child: Element): boolean => {
      return child.localName === "style";
    })
    .map((child: Element): string => {
      return child.textContent ?? "";
    });
}

function decodeSvgDataUrl(url: string): string {
  expect(url.startsWith(SVG_DATA_URL_PREFIX)).toBe(true);

  const binary: string = atob(url.slice(SVG_DATA_URL_PREFIX.length));
  const bytes: Uint8Array = new Uint8Array(binary.length);

  for (let index: number = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new TextDecoder().decode(bytes);
}

function expectCaptureError(
  error: unknown,
  reason: ReplayFrameCaptureFailure,
): void {
  expect(error).toBeInstanceOf(ReplayFrameCaptureError);
  expect((error as ReplayFrameCaptureError).reason).toBe(reason);
  expect((error as ReplayFrameCaptureError).name).toBe(
    "ReplayFrameCaptureError",
  );
}

function catchError(run: () => unknown): unknown {
  try {
    run();
  } catch (error: unknown) {
    return error;
  }

  throw new Error("Expected the call to throw");
}

async function catchRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }

  throw new Error("Expected the promise to reject");
}

/* ---- Rasteriser fakes. ---- */

interface FakeImage {
  label: string;
  url: string;
}

/* Records every call, on its own list and on the harness timeline. */
class FakeContext2D {
  public readonly calls: Array<string> = [];
  public readonly arcs: Array<Array<number>> = [];
  public fillStyle: string = "";
  public strokeStyle: string = "";
  public lineWidth: number = 1;
  private readonly name: string;
  private readonly timeline: Array<string>;

  public constructor(name: string, timeline: Array<string>) {
    this.name = name;
    this.timeline = timeline;
  }

  public clearRect(x: number, y: number, width: number, height: number): void {
    this.record(`clearRect ${x} ${y} ${width} ${height}`);
  }

  public fillRect(x: number, y: number, width: number, height: number): void {
    this.record(`fillRect ${this.fillStyle} ${x} ${y} ${width} ${height}`);
  }

  public drawImage(
    image: FakeImage,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    this.record(`drawImage ${image.label} ${x} ${y} ${width} ${height}`);
  }

  public save(): void {
    this.record("save");
  }

  public restore(): void {
    this.record("restore");
  }

  public beginPath(): void {
    this.record("beginPath");
  }

  public arc(
    x: number,
    y: number,
    radius: number,
    start: number,
    end: number,
  ): void {
    this.arcs.push([x, y, radius, start, end]);
    this.record("arc");
  }

  public fill(): void {
    this.record(`fill ${this.fillStyle}`);
  }

  public stroke(): void {
    this.record(`stroke ${this.strokeStyle} ${this.lineWidth}`);
  }

  private record(call: string): void {
    this.calls.push(call);
    this.timeline.push(`${this.name} ${call}`);
  }
}

type FakeBlobBehaviour = "blob" | "null" | "throw";

class FakeCanvas {
  public readonly name: string;
  public readonly width: number;
  public readonly height: number;
  public readonly context: FakeContext2D | null;
  public readonly dataUrl: string;
  public readonly blob: Blob = new Blob(["png"], { type: "image/png" });
  public readonly blobTypes: Array<string | undefined> = [];
  public blobBehaviour: FakeBlobBehaviour = "blob";

  public constructor(input: {
    name: string;
    width: number;
    height: number;
    hasContext: boolean;
    timeline: Array<string>;
  }) {
    this.name = input.name;
    this.width = input.width;
    this.height = input.height;
    this.context = input.hasContext
      ? new FakeContext2D(input.name, input.timeline)
      : null;
    this.dataUrl = `data:image/png;base64,${btoa(input.name)}`;
  }

  public getContext(type: string): FakeContext2D | null {
    return type === "2d" ? this.context : null;
  }

  public toDataURL(): string {
    return this.dataUrl;
  }

  public toBlob(callback: (blob: Blob | null) => void, type?: string): void {
    this.blobTypes.push(type);

    if (this.blobBehaviour === "throw") {
      throw new DOMException(
        "Tainted canvases may not be exported.",
        "SecurityError",
      );
    }

    callback(this.blobBehaviour === "null" ? null : this.blob);
  }

  public asElement(): HTMLCanvasElement {
    return this as unknown as HTMLCanvasElement;
  }
}

interface RasterHarnessOptions {
  /* Canvases, by creation order, that have no 2D context. */
  contextless?: Array<number>;
  /* loadImage calls, by call order, that reject. */
  failingLoads?: Array<number>;
  blobBehaviour?: FakeBlobBehaviour;
  nextFrame?: () => Promise<void>;
}

interface RasterHarness {
  deps: ReplayFrameRasterDeps;
  canvases: Array<FakeCanvas>;
  urls: Array<string>;
  timeline: Array<string>;
}

function makeRasterHarness(options?: RasterHarnessOptions): RasterHarness {
  const canvases: Array<FakeCanvas> = [];
  const urls: Array<string> = [];
  const timeline: Array<string> = [];

  return {
    canvases: canvases,
    urls: urls,
    timeline: timeline,
    deps: {
      createCanvas: (width: number, height: number): HTMLCanvasElement => {
        const index: number = canvases.length;
        const canvas: FakeCanvas = new FakeCanvas({
          name: `canvas-${index}`,
          width: width,
          height: height,
          hasContext: !(options?.contextless ?? []).includes(index),
          timeline: timeline,
        });

        canvas.blobBehaviour = options?.blobBehaviour ?? "blob";
        canvases.push(canvas);
        timeline.push(`createCanvas canvas-${index} ${width}x${height}`);

        return canvas.asElement();
      },
      loadImage: (url: string): Promise<CanvasImageSource> => {
        const index: number = urls.length;
        urls.push(url);
        timeline.push(`loadImage image-${index}`);

        if ((options?.failingLoads ?? []).includes(index)) {
          return Promise.reject(new Error("The SVG image did not decode."));
        }

        const image: FakeImage = { label: `image-${index}`, url: url };

        return Promise.resolve(image as unknown as CanvasImageSource);
      },
      nextFrame: (): Promise<void> => {
        timeline.push("nextFrame");

        return options?.nextFrame ? options.nextFrame() : Promise.resolve();
      },
    },
  };
}

function makeSerialization(
  overrides?: Partial<ReplayFrameSerialization>,
): ReplayFrameSerialization {
  return {
    viewport: { width: 800, height: 600 },
    svg: `<svg xmlns="${SVG_NAMESPACE}"><text>top</text></svg>`,
    backgroundColor: REPLAY_FRAME_DEFAULT_BACKGROUND,
    frames: [],
    ...overrides,
  };
}

function contextOf(canvas: FakeCanvas | undefined): FakeContext2D {
  if (!canvas || !canvas.context) {
    throw new Error("The canvas has no fake 2D context");
  }

  return canvas.context;
}

/* ==== Pure helpers. ==== */

describe("isXmlSafeName", () => {
  it("accepts element and attribute names a page normally uses", () => {
    for (const name of [
      "div",
      "h1",
      "data-state",
      "aria-label",
      "_private",
      "x.y",
      "viewBox",
    ]) {
      expect(isXmlSafeName(name)).toBe(true);
    }
  });

  it("rejects names framework templates and namespace prefixes leave behind", () => {
    for (const name of [
      "",
      "1col",
      "-dash",
      ".dot",
      "@click",
      ":class",
      "x-on:click",
      "v-bind:title",
      "xlink:href",
      "a b",
      "a/b",
      "#id",
    ]) {
      expect(isXmlSafeName(name)).toBe(false);
    }
  });
});

describe("stripInvalidXmlCharacters", () => {
  it("removes C0 control characters", () => {
    expect(
      stripInvalidXmlCharacters(
        "a\u0000b\u0001c\u0007d\u0008e\u000Bf\u000Cg\u001Bh\u001Fi",
      ),
    ).toBe("abcdefghi");
  });

  it("keeps tab, newline and carriage return", () => {
    expect(stripInvalidXmlCharacters("tab\tline\nreturn\r")).toBe(
      "tab\tline\nreturn\r",
    );
  });

  it("removes lone surrogates of either half, and a reversed pair", () => {
    expect(stripInvalidXmlCharacters("a\uD800b\uDBFFc\uDC00d\uDFFFe")).toBe(
      "abcde",
    );
    expect(stripInvalidXmlCharacters("\uDE00\uD83D")).toBe("");
  });

  it("keeps valid astral pairs", () => {
    const astral: string =
      "emoji \uD83D\uDE00 clef \uD834\uDD1E max \uDBFF\uDFFF";

    expect(stripInvalidXmlCharacters(astral)).toBe(astral);
  });

  it("removes the noncharacters U+FFFE and U+FFFF and keeps the rest of the BMP", () => {
    const allowed: string = " ~\u007F\u0085\u00A0\uD7FF\uE000\uFFFD";

    expect(stripInvalidXmlCharacters("a\uFFFEb\uFFFFc")).toBe("abc");
    expect(stripInvalidXmlCharacters(allowed)).toBe(allowed);
  });
});

describe("escapeXmlAttribute", () => {
  it("escapes the characters that end or break a double-quoted attribute", () => {
    expect(escapeXmlAttribute('a & b "c" <d> e')).toBe(
      "a &amp; b &quot;c&quot; &lt;d&gt; e",
    );
  });

  it("escapes each character once", () => {
    expect(escapeXmlAttribute("<")).toBe("&lt;");
    expect(escapeXmlAttribute("&lt;")).toBe("&amp;lt;");
  });

  it("leaves single quotes alone", () => {
    expect(escapeXmlAttribute("font-family: 'Inter'")).toBe(
      "font-family: 'Inter'",
    );
  });

  it("drops characters XML cannot carry at all", () => {
    expect(escapeXmlAttribute("a\u0001b\uFFFFc\uD800d")).toBe("abcd");
  });

  it("round-trips through an XML parser", () => {
    const value: string = `background: url("data:image/svg+xml,<svg>&amp;</svg>") 'q' > x`;
    const parsed: Document = new DOMParser().parseFromString(
      `<x a="${escapeXmlAttribute(value)}"/>`,
      "application/xml",
    );

    expect(parsed.getElementsByTagName("parsererror")).toHaveLength(0);
    expect(parsed.documentElement.getAttribute("a")).toBe(value);
  });
});

describe("toCssPropertyName", () => {
  it("maps the two keyframe keys that are not plain camelCase", () => {
    expect(toCssPropertyName("cssFloat")).toBe("float");
    expect(toCssPropertyName("cssOffset")).toBe("offset");
  });

  it("hyphenates camelCase keyframe keys", () => {
    expect(toCssPropertyName("backgroundColor")).toBe("background-color");
    expect(toCssPropertyName("borderTopLeftRadius")).toBe(
      "border-top-left-radius",
    );
    expect(toCssPropertyName("WebkitTextStroke")).toBe("-webkit-text-stroke");
  });

  it("leaves single-word properties as they are", () => {
    expect(toCssPropertyName("opacity")).toBe("opacity");
    expect(toCssPropertyName("transform")).toBe("transform");
  });

  /*
   * getKeyframes() names a custom property exactly as it was written
   * (Web Animations: "if property follows the <custom-property-name>
   * production, return property"), and custom property names are case
   * sensitive - "--brandColor" is not "--brand-color".
   */
  it("keeps custom property names exactly as written", () => {
    expect(toCssPropertyName("--gap")).toBe("--gap");
    expect(toCssPropertyName("--brandColor")).toBe("--brandColor");
  });
});

describe("isTransparentColor", () => {
  it("treats an empty value and the serialisations of transparent as transparent", () => {
    for (const color of [
      "",
      "   ",
      "transparent",
      " transparent ",
      "rgba(0, 0, 0, 0)",
      "rgba(0,0,0,0)",
      "rgba(0 0 0 / 0)",
    ]) {
      expect(isTransparentColor(color)).toBe(true);
    }
  });

  /*
   * A colour with zero alpha paints nothing whatever its channels are,
   * and the engines decide background propagation on the alpha alone.
   */
  it("treats any colour with zero alpha as transparent", () => {
    expect(isTransparentColor("rgba(255, 255, 255, 0)")).toBe(true);
  });

  it("does not treat a colour that paints as transparent", () => {
    for (const color of [
      "rgb(0, 0, 0)",
      "rgb(255, 255, 255)",
      "rgba(0, 0, 0, 0.5)",
      "rgba(0, 0, 0, 0.01)",
      "white",
    ]) {
      expect(isTransparentColor(color)).toBe(false);
    }
  });
});

describe("rewriteReplayCss", () => {
  describe("url()", () => {
    it("empties an unquoted remote url and keeps what follows", () => {
      expect(
        rewriteReplayCss(
          ".a { background: url(https://cdn.example/a.png) no-repeat; }",
        ),
      ).toBe(`.a { background: ${EMPTY_URL} no-repeat; }`);
    });

    it("empties single- and double-quoted urls", () => {
      expect(
        rewriteReplayCss(`a { b: url('https://x/a.png'), url("/b.png"); }`),
      ).toBe(`a { b: ${EMPTY_URL}, ${EMPTY_URL}; }`);
    });

    it("matches the function name case-insensitively", () => {
      expect(rewriteReplayCss("URL(https://x/a.png) Url('b.png')")).toBe(
        `${EMPTY_URL} ${EMPTY_URL}`,
      );
    });

    it("empties relative, protocol-relative, blob and empty urls", () => {
      expect(
        rewriteReplayCss(
          "url(/a.png) url(//cdn.example/a.png) url(blob:https://x/1) url()",
        ),
      ).toBe([EMPTY_URL, EMPTY_URL, EMPTY_URL, EMPTY_URL].join(" "));
    });

    it("keeps data: urls verbatim, quoted or not", () => {
      const css: string = `a { b: url(data:image/png;base64,AAAA); c: url("data:image/svg+xml;utf8,<svg></svg>"); d: url(  'DATA:image/gif;base64,R0lG'  ); }`;

      expect(rewriteReplayCss(css)).toBe(css);
    });

    it("reads past quoted and escaped parentheses", () => {
      expect(rewriteReplayCss(`a { b: url("a(b).png") red; }`)).toBe(
        `a { b: ${EMPTY_URL} red; }`,
      );
      expect(rewriteReplayCss("a { b: url(a\\).png) red; }")).toBe(
        `a { b: ${EMPTY_URL} red; }`,
      );
    });

    it("rewrites every url in a font-face src list and leaves format() alone", () => {
      expect(
        rewriteReplayCss(
          `@font-face { src: url(a.woff2) format("woff2"), url('b.woff') format("woff"); }`,
        ),
      ).toBe(
        `@font-face { src: ${EMPTY_URL} format("woff2"), ${EMPTY_URL} format("woff"); }`,
      );
    });

    it("empties a url that is never closed", () => {
      expect(rewriteReplayCss("a { b: url(https://x/a.png")).toBe(
        `a { b: ${EMPTY_URL}`,
      );
    });
  });

  describe(":root", () => {
    it("rewrites :root to the frame root selector", () => {
      expect(rewriteReplayCss(":root { --brand: red; }")).toBe(
        `${REPLAY_FRAME_ROOT_SELECTOR} { --brand: red; }`,
      );
    });

    it("keeps compound selectors attached", () => {
      expect(rewriteReplayCss(":root.dark { a: b; }")).toBe(
        `${REPLAY_FRAME_ROOT_SELECTOR}.dark { a: b; }`,
      );
      expect(rewriteReplayCss(`:root[data-theme="dark"] { a: b; }`)).toBe(
        `${REPLAY_FRAME_ROOT_SELECTOR}[data-theme="dark"] { a: b; }`,
      );
      expect(rewriteReplayCss(":root:not(.x) { a: b; }")).toBe(
        `${REPLAY_FRAME_ROOT_SELECTOR}:not(.x) { a: b; }`,
      );
      expect(rewriteReplayCss("p:not(:root) { a: b; }")).toBe(
        `p:not(${REPLAY_FRAME_ROOT_SELECTOR}) { a: b; }`,
      );
    });

    it("matches case-insensitively and at the very end of the text", () => {
      expect(rewriteReplayCss(":ROOT{}")).toBe(
        `${REPLAY_FRAME_ROOT_SELECTOR}{}`,
      );
      expect(rewriteReplayCss("a, :root")).toBe(
        `a, ${REPLAY_FRAME_ROOT_SELECTOR}`,
      );
    });

    it("rewrites :root inside at-rules", () => {
      expect(
        rewriteReplayCss(
          "@media (prefers-color-scheme: dark) { :root { color: white; } }",
        ),
      ).toBe(
        `@media (prefers-color-scheme: dark) { ${REPLAY_FRAME_ROOT_SELECTOR} { color: white; } }`,
      );
    });

    it("leaves names that only start with :root alone", () => {
      const css: string =
        ":root-foo {} :rooted {} :root_x {} .root {} root {} x:root2 {}";

      expect(rewriteReplayCss(css)).toBe(css);
    });

    it("matches <html> at the specificity :root had", () => {
      expect(REPLAY_FRAME_ROOT_SELECTOR).toBe(
        ":is(html, .oneuptime-frame-root)",
      );
    });
  });

  describe("strings and comments", () => {
    it("never touches the inside of a string", () => {
      const css: string = `a::before { content: "url(https://x) :root"; } b::after { content: 'it\\'s :root url(y)'; }`;

      expect(rewriteReplayCss(css)).toBe(css);
    });

    it("never touches the inside of a comment, closed or not", () => {
      const closed: string = "/* url(https://x) :root */ a { color: red; }";
      const open: string = "a {} /* :root url(x)";

      expect(rewriteReplayCss(closed)).toBe(closed);
      expect(rewriteReplayCss(open)).toBe(open);
    });

    it("rewrites the css around strings and comments", () => {
      expect(
        rewriteReplayCss(
          `/* :root */ :root { content: ":root"; b: url(x.png); }`,
        ),
      ).toBe(
        `/* :root */ ${REPLAY_FRAME_ROOT_SELECTOR} { content: ":root"; b: ${EMPTY_URL}; }`,
      );
    });
  });

  it("is idempotent", () => {
    const css: string = `:root.dark { --x: url(https://x/a.png); } /* url(y) */ a { content: ":root"; }`;
    const once: string = rewriteReplayCss(css);

    expect(rewriteReplayCss(once)).toBe(once);
  });

  it("returns an empty string for empty css", () => {
    expect(rewriteReplayCss("")).toBe("");
  });
});

describe("computeScrollSnapMargin", () => {
  it("is the child's offset past the container's padding edge", () => {
    expect(
      computeScrollSnapMargin({
        childStart: 120,
        containerStart: 100,
        containerBorder: 2,
      }),
    ).toBe(18);
  });

  it("goes negative once the child has scrolled up out of view", () => {
    expect(
      computeScrollSnapMargin({
        childStart: -500,
        containerStart: 100,
        containerBorder: 1,
      }),
    ).toBe(-601);
  });

  it("is zero for a child sitting on the padding edge", () => {
    expect(
      computeScrollSnapMargin({
        childStart: 13,
        containerStart: 10,
        containerBorder: 3,
      }),
    ).toBe(0);
  });
});

describe("resolveReplayFramePixelRatio", () => {
  it("falls back to 1 for a missing or unusable ratio", () => {
    for (const requested of [
      undefined,
      null,
      Number.NaN,
      -2,
      0,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      expect(resolveReplayFramePixelRatio(requested, VIEWPORT)).toBe(1);
    }
  });

  it("never goes below 1 for a viewport that fits", () => {
    expect(resolveReplayFramePixelRatio(0.5, VIEWPORT)).toBe(1);
    expect(resolveReplayFramePixelRatio(0.999, VIEWPORT)).toBe(1);
  });

  it("passes a ratio between 1 and the cap through", () => {
    expect(resolveReplayFramePixelRatio(1.25, VIEWPORT)).toBe(1.25);
    expect(resolveReplayFramePixelRatio(1.5, VIEWPORT)).toBe(1.5);
  });

  it("caps the ratio at REPLAY_FRAME_MAX_PIXEL_RATIO", () => {
    expect(REPLAY_FRAME_MAX_PIXEL_RATIO).toBe(2);
    expect(resolveReplayFramePixelRatio(2, VIEWPORT)).toBe(2);
    expect(resolveReplayFramePixelRatio(3, VIEWPORT)).toBe(2);
    expect(resolveReplayFramePixelRatio(4, VIEWPORT)).toBe(2);
  });

  it("drops below 1 so a huge viewport stays inside the canvas budget", () => {
    const viewport: ReplayFrameViewport = { width: 10000, height: 10000 };
    const ratio: number = resolveReplayFramePixelRatio(2, viewport);

    expect(ratio).toBeLessThan(1);
    expect(
      viewport.width * viewport.height * ratio * ratio,
    ).toBeLessThanOrEqual(REPLAY_FRAME_MAX_CANVAS_PIXELS);
    expect(ratio).toBeCloseTo(0.4096, 10);
  });

  it("picks the largest ratio that fits", () => {
    expect(
      resolveReplayFramePixelRatio(2, { width: 4096, height: 2048 }),
    ).toBeCloseTo(Math.SQRT2, 10);
  });

  it("keeps the requested ratio when the canvas fills the budget exactly", () => {
    expect(REPLAY_FRAME_MAX_CANVAS_PIXELS).toBe(4096 * 4096);
    expect(resolveReplayFramePixelRatio(2, { width: 2048, height: 2048 })).toBe(
      2,
    );
  });

  it("ignores the budget for a viewport with no area", () => {
    expect(resolveReplayFramePixelRatio(2, { width: 0, height: 0 })).toBe(2);
  });
});

describe("buildReplayFrameSvg", () => {
  const XHTML: string = `<html xmlns="${XHTML_NAMESPACE}"><body><p>Hello</p></body></html>`;

  function build(
    overrides?: Partial<Parameters<typeof buildReplayFrameSvg>[0]>,
  ): Document {
    return parseSvg(
      buildReplayFrameSvg({
        xhtml: XHTML,
        viewport: { width: 800, height: 600 },
        scroll: { x: 30, y: 1200 },
        ...overrides,
      }),
    );
  }

  function frameOf(svg: Document): Element {
    return childNamed(svg.documentElement, "foreignObject")
      .firstElementChild as Element;
  }

  it("is a well-formed SVG document of the viewport's size", () => {
    const svg: Document = build();
    const root: Element = svg.documentElement;

    expect(root.localName).toBe("svg");
    expect(root.namespaceURI).toBe(SVG_NAMESPACE);
    expect(root.getAttribute("width")).toBe("800");
    expect(root.getAttribute("height")).toBe("600");
    expect(root.getAttribute("viewBox")).toBe("0 0 800 600");
  });

  it("pins the svg box with !important so page rules cannot move it", () => {
    const style: string = styleOf(build().documentElement);

    for (const declaration of [
      "display: block !important",
      "position: static !important",
      "overflow: hidden !important",
      "background: none !important",
      "margin: 0px !important",
      "width: 800px !important",
      "height: 600px !important",
      "max-width: none !important",
      "visibility: visible !important",
      "opacity: 1 !important",
      "transform: none !important",
      "filter: none !important",
      "clip-path: none !important",
    ]) {
      expect(style).toContain(declaration);
    }
  });

  it("places the foreignObject over the whole viewport", () => {
    const foreignObject: Element = childNamed(
      build().documentElement,
      "foreignObject",
    );

    expect(foreignObject.getAttribute("x")).toBe("0");
    expect(foreignObject.getAttribute("y")).toBe("0");
    expect(foreignObject.getAttribute("width")).toBe("800");
    expect(foreignObject.getAttribute("height")).toBe("600");
    expect(styleOf(foreignObject)).toContain("width: 800px !important");
    expect(styleOf(foreignObject)).toContain("height: 600px !important");
    expect(styleOf(foreignObject)).toContain("visibility: visible !important");
  });

  it("makes the frame an XHTML snap container positioned like the viewport", () => {
    const frame: Element = frameOf(build());
    const style: string = styleOf(frame);

    expect(frame.namespaceURI).toBe(XHTML_NAMESPACE);
    expect(frame.localName).toBe("div");

    for (const declaration of [
      "display: block !important",
      "position: relative !important",
      "z-index: 0 !important",
      "box-sizing: content-box !important",
      "scroll-snap-type: both mandatory !important",
      "scroll-padding: 0px !important",
      "scroll-behavior: auto !important",
      "width: 800px !important",
      "height: 600px !important",
      "transform: none !important",
    ]) {
      expect(style).toContain(declaration);
    }
  });

  it("puts the page first and the marker last, at the scroll offset", () => {
    const frame: Element = frameOf(build());
    const marker: Element = frame.lastElementChild as Element;

    expect(frame.firstElementChild?.localName).toBe("html");
    expect(frame.children).toHaveLength(2);
    expect(styleOf(marker)).toContain("position: absolute !important");
    expect(styleOf(marker)).toContain("left: 30px !important");
    expect(styleOf(marker)).toContain("top: 1200px !important");
    expect(styleOf(marker)).toContain("scroll-snap-align: start !important");
    expect(styleOf(marker)).toContain("scroll-margin: 0px !important");
  });

  it("clips the frame when no declarations are given", () => {
    expect(styleOf(frameOf(build()))).toContain("overflow: hidden !important");
  });

  it("uses the given frame declarations instead", () => {
    const style: string = styleOf(
      frameOf(
        build({
          frameDeclarations: [
            "background-color: rgb(1, 2, 3) !important",
            "overflow-x: hidden !important",
            "overflow-y: scroll !important",
          ],
        }),
      ),
    );

    expect(style).toContain("background-color: rgb(1, 2, 3) !important");
    expect(style).toContain("overflow-y: scroll !important");
    expect(style).not.toContain("overflow: hidden !important");
  });

  it("escapes declarations that carry quotes, ampersands and angle brackets", () => {
    const declaration: string = `background-image: url("data:image/svg+xml,<svg>&amp;</svg>") !important`;

    expect(
      styleOf(frameOf(build({ frameDeclarations: [declaration] }))),
    ).toContain(declaration);
  });

  it("carries the root's pixel font-size as the rem base", () => {
    expect(styleOf(build({ rootFontSize: "18px" }).documentElement)).toContain(
      "font-size: 18px !important",
    );
    expect(
      styleOf(build({ rootFontSize: " 18.5px " }).documentElement),
    ).toContain("font-size: 18.5px !important");
  });

  it("leaves the font-size out unless it is a pixel length", () => {
    for (const rootFontSize of [
      undefined,
      "",
      "62.5%",
      "1rem",
      "medium",
      "-2px",
      "calc(1px + 1px)",
    ]) {
      expect(
        styleOf(build({ rootFontSize: rootFontSize }).documentElement),
      ).not.toContain("font-size");
    }
  });
});

describe("toSvgDataUrl", () => {
  it("is a base64 svg data url, never a blob url", () => {
    expect(toSvgDataUrl("<svg/>")).toBe(
      `${SVG_DATA_URL_PREFIX}${btoa("<svg/>")}`,
    );
  });

  it("round-trips non-ASCII text as UTF-8", () => {
    const svg: string = `<svg xmlns="${SVG_NAMESPACE}"><text>caf\u00e9 \u2713 \u4e2d\u6587 \uD83D\uDE00</text></svg>`;

    expect(decodeSvgDataUrl(toSvgDataUrl(svg))).toBe(svg);
  });

  it("round-trips markup longer than one encoding chunk", () => {
    const svg: string = `<svg>${"x".repeat(0x8000 - 3)}\u00e9${"y".repeat(70000)}\uD83D\uDE00</svg>`;

    expect(decodeSvgDataUrl(toSvgDataUrl(svg))).toBe(svg);
  });
});

describe("readStyleSheetText", () => {
  function makeSheet(
    rules: Array<Record<string, unknown> | null>,
  ): CSSStyleSheet {
    return {
      cssRules: {
        length: rules.length,
        item: (index: number): CSSRule | null => {
          return (rules[index] as CSSRule | null | undefined) ?? null;
        },
      },
    } as unknown as CSSStyleSheet;
  }

  function makeUnreadableSheet(): CSSStyleSheet {
    const sheet: Record<string, unknown> = {};

    Object.defineProperty(sheet, "cssRules", {
      get: (): never => {
        throw new DOMException(
          "Cannot access rules of a cross-origin sheet.",
          "SecurityError",
        );
      },
    });

    return sheet as unknown as CSSStyleSheet;
  }

  it("returns null when there is no sheet", () => {
    expect(readStyleSheetText(null)).toBeNull();
    expect(readStyleSheetText(undefined)).toBeNull();
  });

  it("returns null for a sheet the browser will not let us read", () => {
    expect(readStyleSheetText(makeUnreadableSheet())).toBeNull();
  });

  it("serialises the CSSOM, including rules added with insertRule", () => {
    const replayDocument: Document = makeReplayDocument("", {
      head: `<style id="styles">.from-text { color: red; }</style>`,
    });
    const sheet: CSSStyleSheet = (
      liveById(replayDocument, "styles") as HTMLStyleElement
    ).sheet as CSSStyleSheet;

    sheet.insertRule(".from-cssom { color: blue; }", 1);
    giveRuleListItem(sheet);

    const text: string = readStyleSheetText(sheet) as string;
    const lines: Array<string> = text.split("\n");

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain(".from-text");
    expect(lines[1]).toContain(".from-cssom");
    expect(lines[1]).toContain("color: blue");
  });

  it("is empty, not null, for a readable sheet with no rules", () => {
    expect(readStyleSheetText(makeSheet([]))).toBe("");
  });

  it("skips a rule slot the list does not fill", () => {
    expect(readStyleSheetText(makeSheet([{ cssText: "a {}" }, null]))).toBe(
      "a {}",
    );
  });

  it("replaces an @import with the rules it imported", () => {
    expect(
      readStyleSheetText(
        makeSheet([
          {
            cssText: '@import url("base.css");',
            styleSheet: makeSheet([{ cssText: ".imported {}" }]),
            media: { mediaText: "" },
          },
          { cssText: ".own {}" },
        ]),
      ),
    ).toBe(".imported {}\n.own {}");
  });

  it("wraps an imported sheet in its media query", () => {
    expect(
      readStyleSheetText(
        makeSheet([
          {
            cssText: '@import url("print.css") print;',
            styleSheet: makeSheet([{ cssText: ".printed {}" }]),
            media: { mediaText: " print " },
          },
        ]),
      ),
    ).toBe("@media print {\n.printed {}\n}");
  });

  it("follows an @import inside an imported sheet", () => {
    expect(
      readStyleSheetText(
        makeSheet([
          {
            cssText: '@import url("a.css");',
            styleSheet: makeSheet([
              {
                cssText: '@import url("b.css");',
                styleSheet: makeSheet([{ cssText: ".deep {}" }]),
              },
            ]),
          },
        ]),
      ),
    ).toBe(".deep {}");
  });

  it("drops an @import it cannot read, never the @import rule itself", () => {
    expect(
      readStyleSheetText(
        makeSheet([
          { cssText: '@import url("gone.css");', styleSheet: null },
          {
            cssText: '@import url("https://other.example/x.css");',
            styleSheet: makeUnreadableSheet(),
          },
          { cssText: '@import url("empty.css");', styleSheet: makeSheet([]) },
          { cssText: ".own {}" },
        ]),
      ),
    ).toBe(".own {}");
  });
});

/* ==== The serialiser, on real documents. ==== */

describe("serializeReplayFrame", () => {
  describe("what the clone leaves out", () => {
    it("removes elements that never paint", () => {
      const replayDocument: Document = makeReplayDocument(
        `<script type="application/json">{"secret":"script"}</script>` +
          `<noscript>secret-noscript</noscript>` +
          `<template><p>secret-template</p></template>` +
          `<video id="video" poster="https://cdn.example/poster.png"><source src="https://cdn.example/a.mp4"><track src="https://cdn.example/a.vtt"></video>` +
          `<p id="kept">kept</p>`,
        {
          head: `<meta charset="utf-8"><base href="https://cdn.example/"><title>secret-title</title>`,
        },
      );
      const captured: CapturedFrame = capture(replayDocument);

      for (const name of [
        "script",
        "noscript",
        "template",
        "meta",
        "base",
        "title",
        "source",
        "track",
      ]) {
        expect(captured.svg.getElementsByTagName(name)).toHaveLength(0);
      }

      expect(captured.serialization.svg).not.toContain("secret");
      expect(byId(captured.svg, "kept").textContent).toBe("kept");
      expect(byId(captured.svg, "video").localName).toBe("video");
      expect(byId(captured.svg, "video").hasAttribute("poster")).toBe(false);
    });

    it("drops event handler attributes and keeps the others", () => {
      const replayDocument: Document = makeReplayDocument(
        `<button id="pay" type="button" class="primary" onclick="steal()" onmouseover="track()" ONFOCUS="x()">Pay</button>`,
      );
      const button: Element = byId(capture(replayDocument).svg, "pay");

      expect(
        Array.from(button.attributes)
          .map((attribute: Attr): string => {
            return attribute.name;
          })
          .sort(),
      ).toEqual(["class", "id", "type"]);
    });

    it("drops attribute names that are not XML names", () => {
      const replayDocument: Document = makeReplayDocument(
        `<div id="vue" @click="go()" :class="{ on: true }" x-on:click="run()" v-bind:title="t" data-ok="yes" aria-label="Card">Card</div>`,
      );
      const card: Element = byId(capture(replayDocument).svg, "vue");

      expect(
        Array.from(card.attributes)
          .map((attribute: Attr): string => {
            return attribute.name;
          })
          .sort(),
      ).toEqual(["aria-label", "data-ok", "id"]);
    });

    it("renames elements whose names are not XML names", () => {
      const replayDocument: Document = makeReplayDocument(
        `<my:widget id="widget">Widget</my:widget><svg><my:shape id="shape"></my:shape></svg>`,
      );
      const captured: CapturedFrame = capture(replayDocument);

      expect(byId(captured.svg, "widget").localName).toBe("span");
      expect(byId(captured.svg, "widget").namespaceURI).toBe(XHTML_NAMESPACE);
      expect(byId(captured.svg, "widget").textContent).toBe("Widget");
      expect(byId(captured.svg, "shape").localName).toBe("g");
      expect(byId(captured.svg, "shape").namespaceURI).toBe(SVG_NAMESPACE);
    });

    it("drops comments", () => {
      const replayDocument: Document = makeReplayDocument(
        `<!-- secret -- comment --><p>Visible</p>`,
      );

      expect(serialize(replayDocument).svg).not.toContain("secret");
    });

    it("leaves the player's text-selection chrome out", () => {
      const replayDocument: Document = makeReplayDocument(`<p>Body</p>`, {
        htmlAttributes: `${REPLAY_TEXT_SELECTION_ATTRIBUTE}="true" lang="en"`,
        head:
          `<style ${REPLAY_TEXT_SELECTION_STYLE_ATTRIBUTE}="true">.selection-chrome-a { color: red; }</style>` +
          `<style ${REPLAY_SHADOW_TEXT_SELECTION_STYLE_ATTRIBUTE}="true">.selection-chrome-b { color: red; }</style>` +
          `<style>.page-rule { color: green; }</style>`,
      });
      const captured: CapturedFrame = capture(replayDocument);

      expect(captured.html.hasAttribute(REPLAY_TEXT_SELECTION_ATTRIBUTE)).toBe(
        false,
      );
      expect(captured.html.getAttribute("lang")).toBe("en");
      expect(captured.serialization.svg).not.toContain("selection-chrome");
      expect(captured.serialization.svg).not.toContain(
        REPLAY_TEXT_SELECTION_ATTRIBUTE,
      );
      expect(captured.serialization.svg).not.toContain(
        REPLAY_SHADOW_TEXT_SELECTION_STYLE_ATTRIBUTE,
      );
      expect(captured.serialization.svg).toContain(".page-rule");
      expect(
        replayDocument.documentElement.getAttribute(
          REPLAY_TEXT_SELECTION_ATTRIBUTE,
        ),
      ).toBe("true");
    });

    it("leaves no reference to anything outside the frame", () => {
      const replayDocument: Document = makeReplayDocument(
        `<img src="https://cdn.example/photo.png" srcset="https://cdn.example/photo@2x.png 2x">` +
          `<video poster="https://cdn.example/poster.png"><source src="https://cdn.example/clip.mp4"></video>` +
          `<input type="image" src="https://cdn.example/button.png">` +
          `<iframe src="https://cdn.example/embed.html"></iframe>` +
          `<object data="https://cdn.example/doc.pdf"></object><embed src="https://cdn.example/anim.swf">` +
          `<svg><use href="https://cdn.example/sprite.svg#icon"></use><image xlink:href="https://cdn.example/image.png"></image></svg>` +
          `<div style="background-image: url(https://cdn.example/inline.png)">Inline</div>`,
        {
          head:
            `<link rel="stylesheet" href="https://cdn.example/site.css"><link rel="preload" href="https://cdn.example/font.woff2">` +
            `<style>.hero { background: url("https://cdn.example/hero.png"); } @font-face { font-family: x; src: url(https://cdn.example/x.woff2); }</style>`,
        },
      );

      expect(serialize(replayDocument).svg).not.toContain("cdn.example");
    });
  });

  describe("stylesheets", () => {
    it("re-serialises a <style> from the CSSOM, not its text", () => {
      const replayDocument: Document = makeReplayDocument("", {
        head: `<style id="styles">.gone { color: red; } .stay { color: green; }</style>`,
      });
      const sheet: CSSStyleSheet = (
        liveById(replayDocument, "styles") as HTMLStyleElement
      ).sheet as CSSStyleSheet;

      giveRuleListItem(sheet);
      sheet.insertRule(".from-cssom { color: blue; }", sheet.cssRules.length);
      sheet.deleteRule(0);

      const css: string = headStyleTexts(capture(replayDocument)).join("\n");

      expect(css).toContain(".from-cssom");
      expect(css).toContain(".stay");
      expect(css).not.toContain(".gone");
    });

    it("keeps a style element's media attribute", () => {
      const replayDocument: Document = makeReplayDocument("", {
        head: `<style media="print">.printed { color: black; }</style>`,
      });
      const styles: Array<Element> = Array.from(
        capture(replayDocument).head.children,
      );

      expect(
        styles
          .find((style: Element): boolean => {
            return (style.textContent ?? "").includes(".printed");
          })
          ?.getAttribute("media"),
      ).toBe("print");
    });

    it("drops a disabled sheet", () => {
      const replayDocument: Document = makeReplayDocument("", {
        head: `<style id="off">.disabled-rule { color: red; }</style>`,
      });

      (
        (liveById(replayDocument, "off") as HTMLStyleElement)
          .sheet as CSSStyleSheet
      ).disabled = true;

      expect(serialize(replayDocument).svg).not.toContain(".disabled-rule");
    });

    it("drops a <link> without a readable stylesheet", () => {
      const replayDocument: Document = makeReplayDocument("", {
        head:
          `<link rel="stylesheet" href="https://cdn.example/site.css">` +
          `<link rel="icon" href="/favicon.ico"><link rel="preload" href="/font.woff2" as="font">`,
      });
      const captured: CapturedFrame = capture(replayDocument);

      expect(captured.svg.getElementsByTagName("link")).toHaveLength(0);
      expect(headStyleTexts(captured)).toEqual([REPLAY_FRAME_FREEZE_CSS]);
    });

    it("inlines a readable linked stylesheet, rewritten, with its media", () => {
      const source: Document = makeReplayDocument("", {
        head: `<style id="source">.linked { background: url(https://cdn.example/bg.png); } :root { --linked: 1; }</style>`,
      });
      const linkedSheet: CSSStyleSheet = (
        liveById(source, "source") as HTMLStyleElement
      ).sheet as CSSStyleSheet;
      const replayDocument: Document = makeReplayDocument("", {
        head: `<link id="site" rel="Alternate StyleSheet" href="https://cdn.example/site.css" media="screen and (min-width: 600px)">`,
      });

      giveRuleListItem(linkedSheet);
      Object.defineProperty(liveById(replayDocument, "site"), "sheet", {
        configurable: true,
        get: (): CSSStyleSheet => {
          return linkedSheet;
        },
      });

      const captured: CapturedFrame = capture(replayDocument);
      const inlined: Element | undefined = Array.from(
        captured.head.children,
      ).find((style: Element): boolean => {
        return (style.textContent ?? "").includes(".linked");
      });

      expect(inlined?.localName).toBe("style");
      expect(inlined?.getAttribute("media")).toBe(
        "screen and (min-width: 600px)",
      );
      expect(inlined?.textContent).toContain(EMPTY_URL);
      expect(inlined?.textContent).toContain(REPLAY_FRAME_ROOT_SELECTOR);
      expect(captured.serialization.svg).not.toContain("cdn.example");
    });

    it("drops a linked stylesheet that is disabled", () => {
      const source: Document = makeReplayDocument("", {
        head: `<style id="source">.linked-off { color: red; }</style>`,
      });
      const linkedSheet: CSSStyleSheet = (
        liveById(source, "source") as HTMLStyleElement
      ).sheet as CSSStyleSheet;
      const replayDocument: Document = makeReplayDocument("", {
        head: `<link id="site" rel="stylesheet" href="/site.css">`,
      });

      giveRuleListItem(linkedSheet);
      linkedSheet.disabled = true;
      Object.defineProperty(liveById(replayDocument, "site"), "sheet", {
        configurable: true,
        get: (): CSSStyleSheet => {
          return linkedSheet;
        },
      });

      expect(serialize(replayDocument).svg).not.toContain(".linked-off");
    });

    it("rewrites url() and :root in style elements and style attributes", () => {
      const replayDocument: Document = makeReplayDocument(
        `<div id="inline" style="background-image: url('https://cdn.example/a.png'); mask-image: url(data:image/png;base64,AAAA)">Inline</div>`,
        {
          head: `<style>:root { --brand: red; } .hero { background: url(https://cdn.example/hero.png); }</style>`,
        },
      );
      const captured: CapturedFrame = capture(replayDocument);
      const css: string = headStyleTexts(captured).join("\n");
      const inline: string = styleOf(byId(captured.svg, "inline"));

      expect(css).toContain(REPLAY_FRAME_ROOT_SELECTOR);
      expect(css).not.toContain(":root");
      expect(css).toContain(EMPTY_URL);
      expect(inline).toContain(`background-image: ${EMPTY_URL}`);
      expect(inline).toContain("url(data:image/png;base64,AAAA)");
      expect(captured.serialization.svg).not.toContain("cdn.example");
    });

    it("ends the head with the freeze rules", () => {
      const replayDocument: Document = makeReplayDocument("", {
        head: `<style>.page { color: red; }</style>`,
      });
      const styles: Array<string> = headStyleTexts(capture(replayDocument));

      expect(styles[styles.length - 1]).toBe(REPLAY_FRAME_FREEZE_CSS);
    });

    it("adds the document's adopted stylesheets, rewritten, before the freeze rules", () => {
      const source: Document = makeReplayDocument("", {
        head: `<style id="source">.adopted { background: url(https://cdn.example/a.png); }</style>`,
      });
      const adopted: CSSStyleSheet = (
        liveById(source, "source") as HTMLStyleElement
      ).sheet as CSSStyleSheet;
      const replayDocument: Document = makeReplayDocument("");

      giveRuleListItem(adopted);
      Object.defineProperty(replayDocument, "adoptedStyleSheets", {
        configurable: true,
        get: (): Array<CSSStyleSheet> => {
          return [adopted];
        },
      });

      const styles: Array<string> = headStyleTexts(capture(replayDocument));

      expect(styles).toHaveLength(2);
      expect(styles[0]).toContain(".adopted");
      expect(styles[0]).toContain(EMPTY_URL);
      expect(styles[1]).toBe(REPLAY_FRAME_FREEZE_CSS);
    });

    it("adds a head when the document has none", () => {
      const replayDocument: Document = makeReplayDocument(`<p>No head</p>`);

      replayDocument.head.remove();

      const captured: CapturedFrame = capture(replayDocument);

      expect(captured.html.firstElementChild?.localName).toBe("head");
      expect(headStyleTexts(captured)).toEqual([REPLAY_FRAME_FREEZE_CSS]);
    });
  });

  describe("form state", () => {
    it("writes a typed value into the value attribute", () => {
      const replayDocument: Document = makeReplayDocument(
        `<input id="name" value="initial"><input id="email" type="email">`,
      );

      (liveById(replayDocument, "name") as HTMLInputElement).value =
        "typed by the user";
      (liveById(replayDocument, "email") as HTMLInputElement).value =
        "a@b.example";

      const captured: CapturedFrame = capture(replayDocument);

      expect(byId(captured.svg, "name").getAttribute("value")).toBe(
        "typed by the user",
      );
      expect(byId(captured.svg, "email").getAttribute("value")).toBe(
        "a@b.example",
      );
    });

    it("strips characters XML cannot carry from a value", () => {
      const replayDocument: Document = makeReplayDocument(`<input id="name">`);

      (liveById(replayDocument, "name") as HTMLInputElement).value = "a\u0001b";

      expect(
        byId(capture(replayDocument).svg, "name").getAttribute("value"),
      ).toBe("ab");
    });

    it("follows the checked property of checkboxes and radios, both ways", () => {
      const replayDocument: Document = makeReplayDocument(
        `<input id="was-on" type="checkbox" checked><input id="now-on" type="checkbox">` +
          `<input id="radio-off" type="radio" name="plan" checked><input id="radio-on" type="radio" name="plan">`,
      );

      (liveById(replayDocument, "was-on") as HTMLInputElement).checked = false;
      (liveById(replayDocument, "now-on") as HTMLInputElement).checked = true;
      (liveById(replayDocument, "radio-on") as HTMLInputElement).checked = true;

      const captured: CapturedFrame = capture(replayDocument);

      expect(byId(captured.svg, "was-on").hasAttribute("checked")).toBe(false);
      expect(byId(captured.svg, "now-on").getAttribute("checked")).toBe(
        "checked",
      );
      expect(byId(captured.svg, "radio-off").hasAttribute("checked")).toBe(
        false,
      );
      expect(byId(captured.svg, "radio-on").getAttribute("checked")).toBe(
        "checked",
      );
      expect(byId(captured.svg, "now-on").hasAttribute("value")).toBe(false);
    });

    it("follows the selected property of options", () => {
      const replayDocument: Document = makeReplayDocument(
        `<select id="plan"><option id="basic" value="basic" selected>Basic</option><option id="pro" value="pro">Pro</option></select>`,
      );

      (liveById(replayDocument, "plan") as HTMLSelectElement).value = "pro";

      const captured: CapturedFrame = capture(replayDocument);

      expect(byId(captured.svg, "basic").hasAttribute("selected")).toBe(false);
      expect(byId(captured.svg, "pro").getAttribute("selected")).toBe(
        "selected",
      );
    });

    it("writes a textarea's value as its text", () => {
      const replayDocument: Document = makeReplayDocument(
        `<textarea id="notes">initial</textarea>`,
      );

      (liveById(replayDocument, "notes") as HTMLTextAreaElement).value =
        "typed <b> & more\u0001";

      expect(byId(capture(replayDocument).svg, "notes").textContent).toBe(
        "typed <b> & more",
      );
    });

    it("never writes a file input's value", () => {
      const replayDocument: Document = makeReplayDocument(
        `<input id="upload" type="file"><input id="submit-image" type="image" alt="Go">`,
      );

      for (const id of ["upload", "submit-image"]) {
        Object.defineProperty(liveById(replayDocument, id), "value", {
          configurable: true,
          get: (): string => {
            return "C:\\fakepath\\secret.txt";
          },
        });
      }

      const captured: CapturedFrame = capture(replayDocument);

      expect(byId(captured.svg, "upload").hasAttribute("value")).toBe(false);
      expect(byId(captured.svg, "submit-image").hasAttribute("value")).toBe(
        false,
      );
      expect(captured.serialization.svg).not.toContain("fakepath");
    });

    it("keeps a button input's own label", () => {
      const replayDocument: Document = makeReplayDocument(
        `<input id="labelled" type="submit" value="Pay now">`,
      );

      expect(
        byId(capture(replayDocument).svg, "labelled").getAttribute("value"),
      ).toBe("Pay now");
    });

    /*
     * A submit or reset input without a value attribute is labelled by the
     * browser ("Submit", "Reset"); its .value is "". Writing value="" makes
     * the label an empty string, so the button would come out blank. rrweb
     * records no value for these inputs, so a replayed one has none.
     */
    it("does not blank the default label of a submit or reset input", () => {
      const replayDocument: Document = makeReplayDocument(
        `<input id="submit" type="submit"><input id="reset" type="reset">`,
      );
      const captured: CapturedFrame = capture(replayDocument);

      expect(byId(captured.svg, "submit").hasAttribute("value")).toBe(false);
      expect(byId(captured.svg, "reset").hasAttribute("value")).toBe(false);
    });
  });

  describe("images", () => {
    it("keeps a data: source and drops the responsive and loading hints", () => {
      const replayDocument: Document = makeReplayDocument(
        `<img id="logo" src="data:image/png;base64,iVBORw0KGgo=" srcset="a.png 1x, b.png 2x" sizes="100vw" loading="lazy" decoding="async" alt="Logo">`,
      );
      const image: Element = byId(capture(replayDocument).svg, "logo");

      expect(image.getAttribute("src")).toBe(
        "data:image/png;base64,iVBORw0KGgo=",
      );
      expect(image.getAttribute("alt")).toBe("Logo");

      for (const name of ["srcset", "sizes", "loading", "decoding"]) {
        expect(image.hasAttribute(name)).toBe(false);
      }
    });

    it("draws an image the stage never loaded as broken", () => {
      const replayDocument: Document = makeReplayDocument(
        `<img id="pending" src="https://cdn.example/a.png"><img id="empty" src="https://cdn.example/b.png">`,
      );

      markImageLoaded(liveById(replayDocument, "empty"), {
        width: 0,
        height: 0,
      });

      const captured: CapturedFrame = capture(replayDocument);

      expect(byId(captured.svg, "pending").getAttribute("src")).toBe(
        REPLAY_FRAME_BROKEN_IMAGE,
      );
      expect(byId(captured.svg, "empty").getAttribute("src")).toBe(
        REPLAY_FRAME_BROKEN_IMAGE,
      );
    });

    it("copies the pixels of a loaded image the browser lets it read", () => {
      const canvas: ImageCanvasMock = mockImageCanvas({
        hasContext: true,
        dataUrl: "data:image/png;base64,Q09QSUVE",
      });
      const replayDocument: Document = makeReplayDocument(
        `<img id="photo" src="https://cdn.example/photo.jpg">`,
      );
      const photo: HTMLElement = liveById(replayDocument, "photo");

      markImageLoaded(photo, { width: 640, height: 480 });
      stubBox(photo, { rect: { top: 0, left: 0, width: 100, height: 75 } });

      const image: Element = byId(capture(replayDocument).svg, "photo");

      expect(image.getAttribute("src")).toBe("data:image/png;base64,Q09QSUVE");
      expect(styleOf(image)).not.toContain("object-fit");
      /* At most twice the drawn size: 100px wide on the stage -> 200px. */
      expect(canvas.draws).toEqual([[photo, 0, 0, 200, 150]]);
    });

    it("copies at the natural size when that is smaller than twice the drawn size", () => {
      const canvas: ImageCanvasMock = mockImageCanvas({
        hasContext: true,
        dataUrl: "data:image/png;base64,Q09QSUVE",
      });
      const replayDocument: Document = makeReplayDocument(
        `<img id="photo" src="https://cdn.example/photo.jpg">`,
      );
      const photo: HTMLElement = liveById(replayDocument, "photo");

      markImageLoaded(photo, { width: 640, height: 480 });
      stubBox(photo, { rect: { top: 0, left: 0, width: 1000, height: 750 } });
      capture(replayDocument);

      expect(canvas.draws).toEqual([[photo, 0, 0, 640, 480]]);
    });

    it("draws a grey box of the same size for a loaded image it may not read", () => {
      mockImageCanvas({ hasContext: true, isTainted: true });

      const replayDocument: Document = makeReplayDocument(
        `<img id="photo" src="https://cdn.example/photo.jpg" style="width: 320px; height: 240px">`,
      );

      markImageLoaded(liveById(replayDocument, "photo"), {
        width: 640,
        height: 480,
      });

      const image: Element = byId(capture(replayDocument).svg, "photo");

      expect(image.getAttribute("src")).toBe(REPLAY_FRAME_IMAGE_PLACEHOLDER);
      expect(styleOf(image)).toContain("width: 320px !important");
      expect(styleOf(image)).toContain("height: 240px !important");
      expect(styleOf(image)).toContain("object-fit: fill !important");
    });

    it("falls back to the grey box without a 2D canvas or a readable copy", () => {
      const replayDocument: Document = makeReplayDocument(
        `<img id="photo" src="https://cdn.example/photo.jpg">`,
      );

      markImageLoaded(liveById(replayDocument, "photo"), {
        width: 640,
        height: 480,
      });

      mockImageCanvas({ hasContext: false });
      expect(
        byId(capture(replayDocument).svg, "photo").getAttribute("src"),
      ).toBe(REPLAY_FRAME_IMAGE_PLACEHOLDER);

      jest.restoreAllMocks();
      mockImageCanvas({ hasContext: true, dataUrl: "data:," });

      const image: Element = byId(capture(replayDocument).svg, "photo");

      expect(image.getAttribute("src")).toBe(REPLAY_FRAME_IMAGE_PLACEHOLDER);
      expect(styleOf(image)).toBe("object-fit: fill !important");
    });
  });

  describe("svg and canvas", () => {
    it("keeps in-document and data: references and drops the rest, for href and xlink:href", () => {
      const replayDocument: Document = makeReplayDocument(
        `<svg>` +
          `<use id="use-fragment" href="#icon"></use>` +
          `<use id="use-remote" href="https://cdn.example/sprite.svg#icon"></use>` +
          `<use id="use-xlink-fragment" xlink:href="#icon"></use>` +
          `<use id="use-xlink-remote" xlink:href="/sprite.svg#icon"></use>` +
          `<image id="image-data" href="data:image/png;base64,AAAA"></image>` +
          `<image id="image-xlink-remote" xlink:href="https://cdn.example/a.png"></image>` +
          `<image id="image-xlink-data" xlink:href="data:image/png;base64,BBBB"></image>` +
          `</svg>`,
      );
      const svg: Document = capture(replayDocument).svg;

      expect(byId(svg, "use-fragment").getAttribute("href")).toBe("#icon");
      expect(byId(svg, "use-remote").hasAttribute("href")).toBe(false);
      expect(
        byId(svg, "use-xlink-fragment").getAttributeNS(XLINK_NAMESPACE, "href"),
      ).toBe("#icon");
      expect(
        byId(svg, "use-xlink-remote").hasAttributeNS(XLINK_NAMESPACE, "href"),
      ).toBe(false);
      expect(byId(svg, "image-data").getAttribute("href")).toBe(
        "data:image/png;base64,AAAA",
      );
      expect(
        byId(svg, "image-xlink-remote").hasAttributeNS(XLINK_NAMESPACE, "href"),
      ).toBe(false);
      expect(
        byId(svg, "image-xlink-data").getAttributeNS(XLINK_NAMESPACE, "href"),
      ).toBe("data:image/png;base64,BBBB");
      expect(byId(svg, "use-fragment").namespaceURI).toBe(SVG_NAMESPACE);
    });

    it("keeps a canvas as a canvas element", () => {
      const replayDocument: Document = makeReplayDocument(
        `<canvas id="chart" width="300" height="150"></canvas>`,
      );
      const chart: Element = byId(capture(replayDocument).svg, "chart");

      expect(chart.localName).toBe("canvas");
      expect(chart.namespaceURI).toBe(XHTML_NAMESPACE);
      expect(chart.getAttribute("width")).toBe("300");
      expect(chart.getAttribute("height")).toBe("150");
    });
  });

  describe("nested frames", () => {
    it("draws a readable same-origin frame as an image of its own serialization", () => {
      const replayDocument: Document = makeReplayDocument(
        `<iframe id="embed" class="widget" style="width: 320px; height: 180px"></iframe>`,
      );

      mountChildFrame(replayDocument, "embed", `<p>Inside the frame</p>`, {
        width: 320,
        height: 180,
      });

      const captured: CapturedFrame = capture(replayDocument);
      const image: Element = byId(captured.svg, "embed");
      const tokenPattern: RegExp = /^[A-Za-z0-9-]+$/;

      expect(captured.svg.getElementsByTagName("iframe")).toHaveLength(0);
      expect(image.localName).toBe("img");
      expect(image.getAttribute("class")).toBe("widget");
      expect(image.getAttribute("alt")).toBe("");
      expect(styleOf(image)).toContain("width: 320px !important");
      expect(captured.serialization.frames).toHaveLength(1);

      const nested: ReplayFrameSerialization =
        captured.serialization.frames[0]!.serialization;
      const token: string = captured.serialization.frames[0]!.token;

      expect(image.getAttribute("src")).toBe(token);
      expect(tokenPattern.test(token)).toBe(true);
      expect(nested.viewport).toEqual({ width: 320, height: 180 });
      expect(nested.backgroundColor).toBeNull();
      expect(captured.serialization.backgroundColor).toBe(
        REPLAY_FRAME_DEFAULT_BACKGROUND,
      );
      expect(readFrame(nested).body.textContent).toBe("Inside the frame");
      expect(captured.serialization.svg).not.toContain("Inside the frame");
    });

    it("gives every frame its own token", () => {
      const replayDocument: Document = makeReplayDocument(
        `<iframe id="first"></iframe><iframe id="second"></iframe>`,
      );

      mountChildFrame(replayDocument, "first", `<p>One</p>`, {
        width: 100,
        height: 50,
      });
      mountChildFrame(replayDocument, "second", `<p>Two</p>`, {
        width: 100,
        height: 50,
      });

      const captured: CapturedFrame = capture(replayDocument);
      const tokens: Array<string> = captured.serialization.frames.map(
        (frame: { token: string }): string => {
          return frame.token;
        },
      );

      expect(new Set<string>(tokens).size).toBe(2);
      expect(byId(captured.svg, "first").getAttribute("src")).toBe(tokens[0]);
      expect(byId(captured.svg, "second").getAttribute("src")).toBe(tokens[1]);
    });

    it(`stops descending after ${REPLAY_FRAME_MAX_FRAME_DEPTH} levels of frames`, () => {
      const top: Document = makeReplayDocument(
        `<iframe id="level-1"></iframe>`,
      );
      let current: Document = top;

      for (
        let depth: number = 1;
        depth <= REPLAY_FRAME_MAX_FRAME_DEPTH + 1;
        depth++
      ) {
        const inner: string =
          depth <= REPLAY_FRAME_MAX_FRAME_DEPTH
            ? `<iframe id="level-${depth + 1}"></iframe>`
            : "";

        current = mountChildFrame(
          current,
          `level-${depth}`,
          `<p>Level ${depth} text</p>${inner}`,
          { width: 400 - depth * 100, height: 200 },
        );
      }

      let level: ReplayFrameSerialization = serialize(top);

      for (
        let depth: number = 1;
        depth <= REPLAY_FRAME_MAX_FRAME_DEPTH;
        depth++
      ) {
        expect(level.frames).toHaveLength(1);
        level = level.frames[0]!.serialization;
        expect(level.svg).toContain(`Level ${depth} text`);
      }

      expect(level.frames).toHaveLength(0);
      expect(
        byId(
          parseSvg(level.svg),
          `level-${REPLAY_FRAME_MAX_FRAME_DEPTH + 1}`,
        ).getAttribute("src"),
      ).toBe(REPLAY_FRAME_TRANSPARENT_IMAGE);
      expect(level.svg).not.toContain(
        `Level ${REPLAY_FRAME_MAX_FRAME_DEPTH + 1} text`,
      );
    });

    /* A cross-origin frame's contentDocument is null to the embedder. */
    it("leaves a frame it cannot read transparent", () => {
      const replayDocument: Document = makeReplayDocument(
        `<iframe id="blocked"></iframe>`,
      );
      const frame: HTMLElement = liveById(replayDocument, "blocked");

      stubBox(frame, { clientWidth: 300, clientHeight: 150 });
      Object.defineProperty(frame, "contentDocument", {
        configurable: true,
        get: (): null => {
          return null;
        },
      });

      const captured: CapturedFrame = capture(replayDocument);

      expect(byId(captured.svg, "blocked").getAttribute("src")).toBe(
        REPLAY_FRAME_TRANSPARENT_IMAGE,
      );
      expect(captured.serialization.frames).toHaveLength(0);
    });

    it("leaves a frame with no size transparent", () => {
      const replayDocument: Document = makeReplayDocument(
        `<iframe id="collapsed"></iframe>`,
      );
      const captured: CapturedFrame = capture(replayDocument);

      expect(byId(captured.svg, "collapsed").getAttribute("src")).toBe(
        REPLAY_FRAME_TRANSPARENT_IMAGE,
      );
      expect(captured.serialization.frames).toHaveLength(0);
    });

    it("leaves objects and embeds transparent", () => {
      const replayDocument: Document = makeReplayDocument(
        `<object id="pdf" data="https://cdn.example/doc.pdf"></object><embed id="flash" src="https://cdn.example/anim.swf">`,
      );
      const captured: CapturedFrame = capture(replayDocument);

      for (const id of ["pdf", "flash"]) {
        expect(byId(captured.svg, id).localName).toBe("img");
        expect(byId(captured.svg, id).getAttribute("src")).toBe(
          REPLAY_FRAME_TRANSPARENT_IMAGE,
        );
      }
    });
  });

  describe("shadow DOM", () => {
    it("flattens an open shadow root into its host with computed styles inlined", () => {
      const replayDocument: Document = makeReplayDocument(
        `<fancy-card id="card"><span id="light" slot="title" style="font-weight: 700">Light title</span></fancy-card>`,
      );

      attachShadow(
        liveById(replayDocument, "card"),
        `<style>.inner { color: red; }</style><div id="inner" class="inner" style="color: rgb(200, 0, 0); font-style: italic">Shadow text <slot name="title"></slot></div>`,
      );

      const captured: CapturedFrame = capture(replayDocument);
      const card: Element = byId(captured.svg, "card");
      const inner: Element = byId(captured.svg, "inner");

      expect(card.contains(inner)).toBe(true);
      /*
       * The host keeps its look through its computed style too: its
       * :host rules lived in the shadow sheet that is gone.
       */
      expect(styleOf(card)).toContain("all: unset !important");
      expect(styleOf(inner)).toContain("all: unset !important");
      expect(styleOf(inner)).toContain("color: rgb(200, 0, 0) !important");
      expect(styleOf(inner)).toContain("font-style: italic !important");
      expect(captured.serialization.svg).not.toContain("color: red");
    });

    it("composes slotted light DOM into its slot, once, with its style inlined", () => {
      const replayDocument: Document = makeReplayDocument(
        `<fancy-card id="card"><span id="light" slot="title" style="font-weight: 700">Light title</span>Default text</fancy-card>`,
      );

      attachShadow(
        liveById(replayDocument, "card"),
        `<div id="inner"><h2 id="heading"><slot name="title"></slot></h2><p id="body-slot"><slot></slot></p></div>`,
      );

      const captured: CapturedFrame = capture(replayDocument);
      const light: Element = byId(captured.svg, "light");

      expect(byId(captured.svg, "heading").contains(light)).toBe(true);
      expect(captured.svg.querySelectorAll(`[id="light"]`)).toHaveLength(1);
      expect(styleOf(light)).toContain("font-weight: 700 !important");
      expect(byId(captured.svg, "body-slot").textContent).toBe("Default text");
    });

    it("uses a slot's fallback content when nothing is assigned to it", () => {
      const replayDocument: Document = makeReplayDocument(
        `<fancy-card id="card"></fancy-card>`,
      );

      attachShadow(
        liveById(replayDocument, "card"),
        `<slot name="missing"><em id="fallback">Fallback</em></slot>`,
      );

      const captured: CapturedFrame = capture(replayDocument);

      expect(byId(captured.svg, "fallback").textContent).toBe("Fallback");
      expect(
        byId(captured.svg, "card").contains(byId(captured.svg, "fallback")),
      ).toBe(true);
    });

    it("re-creates a shadow element's pseudo-elements as class rules", () => {
      const replayDocument: Document = makeReplayDocument(
        `<fancy-card id="card"></fancy-card>`,
      );
      const root: ShadowRoot = attachShadow(
        liveById(replayDocument, "card"),
        `<span id="badge" class="badge">New</span>`,
      );

      setPseudoStyle(root.getElementById("badge") as Element, "::before", {
        content: '"\u2605"',
        color: "rgb(255, 215, 0)",
        "animation-name": "spin",
        "transition-duration": "1s",
        "background-image": 'url("https://cdn.example/star.png")',
      });
      setPseudoStyle(root.getElementById("badge") as Element, "::after", {
        content: "none",
        color: "red",
      });

      const captured: CapturedFrame = capture(replayDocument);
      const classes: Array<string> = (
        byId(captured.svg, "badge").getAttribute("class") ?? ""
      ).split(" ");
      const pseudoClass: string = classes[1] ?? "";

      expect(classes).toHaveLength(2);
      expect(classes[0]).toBe("badge");
      expect(headStyleTexts(captured).join("\n")).toContain(
        `.${pseudoClass}::before { content: "\u2605" !important; color: rgb(255, 215, 0) !important; background-image: ${EMPTY_URL} !important }`,
      );
      expect(captured.serialization.svg).not.toContain(
        `.${pseudoClass}::after`,
      );
      expect(captured.serialization.svg).not.toContain("animation-name: spin");
    });

    it("skips a pseudo-element whose style cannot be read", () => {
      const replayDocument: Document = makeReplayDocument(
        `<fancy-card id="card"></fancy-card>`,
      );
      const root: ShadowRoot = attachShadow(
        liveById(replayDocument, "card"),
        `<span id="badge" class="badge">New</span>`,
      );

      setPseudoStyle(
        root.getElementById("badge") as Element,
        "::before",
        new Error("No pseudo-element styles here."),
      );

      expect(
        byId(capture(replayDocument).svg, "badge").getAttribute("class"),
      ).toBe("badge");
    });

    it("leaves light DOM pseudo-elements to the page's own rules", () => {
      const replayDocument: Document = makeReplayDocument(
        `<span id="plain" class="plain">Plain</span>`,
      );

      setPseudoStyle(liveById(replayDocument, "plain"), "::before", {
        content: '"x"',
      });

      const captured: CapturedFrame = capture(replayDocument);

      expect(byId(captured.svg, "plain").getAttribute("class")).toBe("plain");
      expect(byId(captured.svg, "plain").getAttribute("style")).toBeNull();
    });
  });

  describe("scroll", () => {
    it("puts the marker at the root scroll offset", () => {
      const replayDocument: Document = makeReplayDocument(`<main>Page</main>`);

      stubBox(replayDocument.documentElement, {
        scrollTop: 1200,
        scrollLeft: 30,
      });

      const captured: CapturedFrame = capture(replayDocument);
      const marker: string = styleOf(captured.marker);

      expect(marker).toContain("left: 30px !important");
      expect(marker).toContain("top: 1200px !important");
      expect(marker).toContain("scroll-snap-align: start !important");
      expect(styleOf(captured.frame)).toContain(
        "scroll-snap-type: both mandatory !important",
      );
    });

    it("reads the root offset from the scrolling element when it is the body", () => {
      const replayDocument: Document = makeReplayDocument(
        `<main>Quirks page</main>`,
        { quirks: true },
      );

      Object.defineProperty(replayDocument, "scrollingElement", {
        configurable: true,
        get: (): Element => {
          return replayDocument.body;
        },
      });
      stubBox(replayDocument.body, { scrollTop: 500, scrollLeft: 0 });

      const captured: CapturedFrame = capture(replayDocument);

      expect(styleOf(captured.marker)).toContain("top: 500px !important");
      expect(styleOf(captured.body)).not.toContain("scroll-snap-type");
    });

    it("snaps a scrolled box to its first child laid out in flow", () => {
      const replayDocument: Document = makeReplayDocument(
        `<div id="scroller" style="overflow-y: auto; height: 200px">` +
          `<style id="scoped">.x { color: red; }</style>` +
          `<header id="sticky" style="position: sticky; top: 0px">Sticky</header>` +
          `<div id="absolute" style="position: absolute">Absolute</div>` +
          `<div id="fixed" style="position: fixed">Fixed</div>` +
          `<div id="moved" style="transform: translateX(10px)">Moved</div>` +
          `<div id="hidden" style="display: none">Hidden</div>` +
          `<div id="contents" style="display: contents">Contents</div>` +
          `<div id="unrendered">No boxes</div>` +
          `<section id="content" style="position: relative">Content</section>` +
          `<section id="after">After</section>` +
          `</div>`,
      );

      stubBox(liveById(replayDocument, "scroller"), {
        scrollTop: 300,
        scrollLeft: 12,
        clientTop: 1,
        clientLeft: 2,
        rect: { top: 100, left: 50 },
      });

      for (const id of [
        "scoped",
        "sticky",
        "absolute",
        "fixed",
        "moved",
        "hidden",
        "contents",
        "after",
      ]) {
        stubBox(liveById(replayDocument, id), {
          clientRectCount: 1,
          rect: { top: 0, left: 0 },
        });
      }

      stubBox(liveById(replayDocument, "content"), {
        clientRectCount: 1,
        rect: { top: -150, left: 40 },
      });

      const captured: CapturedFrame = capture(replayDocument);
      const scroller: string = styleOf(byId(captured.svg, "scroller"));
      const content: string = styleOf(byId(captured.svg, "content"));

      expect(scroller).toContain("scroll-snap-type: both mandatory !important");
      expect(scroller).toContain("scroll-padding: 0px !important");
      expect(scroller).toContain("scroll-behavior: auto !important");
      expect(content).toContain("scroll-snap-align: start !important");
      /* -150 - 100 - 1 and 40 - 50 - 2: where it was drawn, past the border. */
      expect(content).toContain("scroll-margin-top: -251px !important");
      expect(content).toContain("scroll-margin-left: -12px !important");
      expect(content).toContain("scroll-margin-bottom: 0px !important");
      expect(content).toContain("scroll-margin-right: 0px !important");

      for (const id of [
        "sticky",
        "absolute",
        "fixed",
        "moved",
        "hidden",
        "contents",
        "unrendered",
        "after",
      ]) {
        expect(styleOf(byId(captured.svg, id))).not.toContain(
          "scroll-snap-align",
        );
      }

      /* The <style> came first and had boxes, and still was not the anchor. */
      expect(
        byId(captured.svg, "scroller").querySelector("style")?.textContent,
      ).toContain(".x");
    });

    it("leaves a box that is not scrolled alone", () => {
      const replayDocument: Document = makeReplayDocument(
        `<div id="scroller" style="overflow-y: auto"><p id="first">First</p></div>`,
      );

      stubBox(liveById(replayDocument, "first"), {
        clientRectCount: 1,
        rect: { top: 0, left: 0 },
      });

      const captured: CapturedFrame = capture(replayDocument);

      expect(styleOf(byId(captured.svg, "scroller"))).not.toContain(
        "scroll-snap-type",
      );
      expect(byId(captured.svg, "first").getAttribute("style")).toBeNull();
    });

    /*
     * Nothing in it is laid out as a box (the <b> is plain inline), so it
     * gets a marker - and to hold the marker it becomes a containing
     * block, which moves nothing because nothing in it is absolutely
     * placed.
     */
    it("gives an unpositioned box with no child to snap to a marker, positioning it", () => {
      const replayDocument: Document = makeReplayDocument(
        `<pre id="log" style="overflow: auto">line one<b id="bold">bold</b>line two</pre>`,
      );

      stubBox(liveById(replayDocument, "log"), {
        scrollTop: 40,
        scrollLeft: 5,
      });

      const log: Element = byId(capture(replayDocument).svg, "log");
      const marker: Element | undefined = Array.from(log.children).find(
        (child: Element): boolean => {
          return (child.getAttribute("style") ?? "").includes(
            "scroll-snap-align: start",
          );
        },
      );

      expect(styleOf(log)).toContain("position: relative !important");
      expect(styleOf(log)).toContain("scroll-snap-type: both mandatory");
      expect(marker).toBeDefined();
      expect(styleOf(marker as Element)).toContain("left: 5px !important");
      expect(styleOf(marker as Element)).toContain("top: 40px !important");
      expect(log.textContent).toBe("line oneboldline two");
    });

    /*
     * Positioning it would re-anchor an absolutely placed descendant, so
     * its text is moved by the offset instead.
     */
    it("moves the text of an unpositioned box with absolute contents and no child to snap to", () => {
      const replayDocument: Document = makeReplayDocument(
        `<pre id="log" style="overflow: auto">line one<b id="bold">bold</b>line two<i id="tip" style="position: absolute"></i></pre>`,
      );

      stubBox(liveById(replayDocument, "log"), {
        scrollTop: 40,
        scrollLeft: 5,
      });

      const captured: CapturedFrame = capture(replayDocument);
      const log: Element = byId(captured.svg, "log");
      const spans: Array<Element> = Array.from(log.children).filter(
        (child: Element): boolean => {
          return child.localName === "span";
        },
      );

      expect(
        spans.map((span: Element): string | null => {
          return span.textContent;
        }),
      ).toEqual(["line one", "line two"]);

      for (const span of spans) {
        expect(span.getAttribute("style")).toBe(
          "position: relative; left: -5px; top: -40px",
        );
      }

      expect(byId(captured.svg, "bold").children).toHaveLength(0);
      expect(byId(captured.svg, "bold").textContent).toBe("bold");
      expect(log.querySelectorAll("span")).toHaveLength(2);
      expect(styleOf(log)).not.toContain("position: relative");
    });

    it("gives a positioned box with no child to snap to a marker of its own", () => {
      const replayDocument: Document = makeReplayDocument(
        `<div id="panel" style="position: relative; overflow: auto">Only text</div>`,
      );

      stubBox(liveById(replayDocument, "panel"), {
        scrollTop: 64,
        scrollLeft: 8,
      });

      const panel: Element = byId(capture(replayDocument).svg, "panel");
      const marker: Element = panel.lastElementChild as Element;

      expect(panel.firstChild?.nodeType).toBe(3);
      expect(panel.firstChild?.textContent).toBe("Only text");
      expect(panel.children).toHaveLength(1);
      expect(marker.localName).toBe("span");
      expect(styleOf(marker)).toContain("position: absolute !important");
      expect(styleOf(marker)).toContain("left: 8px !important");
      expect(styleOf(marker)).toContain("top: 64px !important");
      expect(styleOf(marker)).toContain("scroll-snap-align: start !important");
      expect(styleOf(panel)).toContain(
        "scroll-snap-type: both mandatory !important",
      );
    });

    it("does not snap form controls or frames, which scroll their own contents", () => {
      const replayDocument: Document = makeReplayDocument(
        `<textarea id="notes">a</textarea><select id="pick" multiple><option>a</option></select><input id="field">`,
      );

      for (const id of ["notes", "pick", "field"]) {
        stubBox(liveById(replayDocument, id), { scrollTop: 50 });
      }

      const captured: CapturedFrame = capture(replayDocument);

      for (const id of ["notes", "pick", "field"]) {
        expect(styleOf(byId(captured.svg, id))).not.toContain("scroll-snap");
      }
    });

    /*
     * A textarea cannot be scrolled inside an image, so a scrolled one is
     * a box with its text moved up - the lines the user was reading.
     */
    it("draws a scrolled textarea as a box with its text moved by the offset", () => {
      const replayDocument: Document = makeReplayDocument(
        `<textarea id="notes" class="note-field">line 1</textarea>`,
      );
      const live: HTMLTextAreaElement = liveById(
        replayDocument,
        "notes",
      ) as HTMLTextAreaElement;

      live.value = "line 1\nline 2\nline 3";
      stubBox(live, { scrollTop: 30, scrollLeft: 4 });

      const box: Element = byId(capture(replayDocument).svg, "notes");
      const text: Element | undefined = box.children[0];

      expect(box.localName).toBe("div");
      expect(box.getAttribute("class")).toBe("note-field");
      expect(styleOf(box)).toContain("overflow: hidden !important");
      expect(styleOf(box)).toContain("white-space: pre-wrap !important");
      expect(text?.getAttribute("style")).toBe(
        "position: relative; left: -4px; top: -30px",
      );
      expect(text?.textContent).toBe("line 1\nline 2\nline 3");
    });

    it("hides the scrollbar of a box whose scrollbar took no room", () => {
      const replayDocument: Document = makeReplayDocument(
        `<div id="overlay" style="overflow-y: auto">A</div>` +
          `<div id="classic" style="overflow-y: scroll; border-left-width: 2px; border-right-width: 2px">B</div>` +
          `<div id="plain">C</div>`,
      );

      stubBox(liveById(replayDocument, "classic"), {
        offsetWidth: 304,
        clientWidth: 285,
        offsetHeight: 100,
        clientHeight: 100,
      });

      const captured: CapturedFrame = capture(replayDocument);

      expect(styleOf(byId(captured.svg, "overlay"))).toContain(
        "scrollbar-width: none !important",
      );
      expect(styleOf(byId(captured.svg, "classic"))).not.toContain(
        "scrollbar-width",
      );
      expect(byId(captured.svg, "plain").getAttribute("style")).toBeNull();
    });

    it("leaves the root's own scrollbar to the frame", () => {
      const replayDocument: Document = makeReplayDocument(`<p>Page</p>`, {
        htmlAttributes: `style="overflow-y: auto"`,
      });

      expect(styleOf(capture(replayDocument).html)).not.toContain(
        "scrollbar-width",
      );
    });

    it("keeps a classic vertical root scrollbar where the page had one", () => {
      const replayDocument: Document = makeReplayDocument(`<p>Page</p>`);

      stubBox(replayDocument.documentElement, {
        clientWidth: 785,
        clientHeight: 600,
      });

      const frame: string = styleOf(capture(replayDocument).frame);

      expect(frame).toContain("overflow-y: scroll !important");
      expect(frame).toContain("overflow-x: hidden !important");
      expect(frame).not.toContain("scrollbar-width");
    });

    it("keeps a classic horizontal root scrollbar where the page had one", () => {
      const replayDocument: Document = makeReplayDocument(`<p>Page</p>`);

      stubBox(replayDocument.documentElement, {
        clientWidth: 800,
        clientHeight: 585,
      });

      const frame: string = styleOf(capture(replayDocument).frame);

      expect(frame).toContain("overflow-x: scroll !important");
      expect(frame).toContain("overflow-y: hidden !important");
    });

    it("hides the root scrollbar when it took no room", () => {
      const frame: string = styleOf(
        capture(makeReplayDocument(`<p>Page</p>`)).frame,
      );

      expect(frame).toContain("overflow-x: hidden !important");
      expect(frame).toContain("overflow-y: hidden !important");
      expect(frame).toContain("scrollbar-width: none !important");
    });
  });

  describe("what the viewport took from the root", () => {
    it("moves the body's overflow to the frame when <html> leaves it visible", () => {
      const replayDocument: Document = makeReplayDocument(`<p>Page</p>`, {
        htmlAttributes: `style="overflow-x: visible; overflow-y: visible"`,
      });
      const captured: CapturedFrame = capture(replayDocument);

      expect(styleOf(captured.body)).toContain("overflow: visible !important");
      expect(styleOf(captured.html)).not.toContain(
        "overflow: visible !important",
      );
    });

    it("moves <html>'s own overflow to the frame otherwise", () => {
      const replayDocument: Document = makeReplayDocument(`<p>Page</p>`, {
        htmlAttributes: `style="overflow-x: hidden; overflow-y: hidden"`,
      });
      const captured: CapturedFrame = capture(replayDocument);

      expect(styleOf(captured.html)).toContain("overflow: visible !important");
      expect(styleOf(captured.body)).not.toContain(
        "overflow: visible !important",
      );
    });

    it("paints <html>'s background on the frame, not on <html>", () => {
      const replayDocument: Document = makeReplayDocument(`<p>Page</p>`, {
        htmlAttributes: `style="background-color: rgb(1, 2, 3)"`,
        head: `<style>body { background-color: rgb(9, 9, 9); background-image: none; }</style>`,
      });
      const captured: CapturedFrame = capture(replayDocument);

      expect(styleOf(captured.frame)).toContain(
        "background-color: rgb(1, 2, 3) !important",
      );
      expect(styleOf(captured.frame)).not.toContain("rgb(9, 9, 9)");
      expect(styleOf(captured.html)).toContain("background: none !important");
      expect(styleOf(captured.body)).not.toContain("background: none");
    });

    it("paints the body's background on the frame when <html> has none", () => {
      const replayDocument: Document = makeReplayDocument(`<p>Page</p>`, {
        htmlAttributes: `style="background-color: transparent; background-image: none"`,
        head: `<style>body { background-color: rgb(9, 9, 9); }</style>`,
      });
      const captured: CapturedFrame = capture(replayDocument);

      expect(styleOf(captured.frame)).toContain(
        "background-color: rgb(9, 9, 9) !important",
      );
      expect(styleOf(captured.body)).toContain("background: none !important");
      expect(styleOf(captured.html)).not.toContain("background: none");
    });

    it("rewrites the url of a propagated background image", () => {
      const replayDocument: Document = makeReplayDocument(`<p>Page</p>`, {
        htmlAttributes: `style="background-image: url(https://cdn.example/bg.png)"`,
      });
      const captured: CapturedFrame = capture(replayDocument);

      expect(styleOf(captured.frame)).toContain(
        `background-image: ${EMPTY_URL} !important`,
      );
      expect(captured.serialization.svg).not.toContain("cdn.example");
    });

    it("moves no background when neither <html> nor the body has one", () => {
      const replayDocument: Document = makeReplayDocument(`<p>Page</p>`, {
        htmlAttributes: `style="background-color: transparent; background-image: none"`,
        head: `<style>body { background-color: rgba(0, 0, 0, 0); background-image: none; }</style>`,
      });
      const captured: CapturedFrame = capture(replayDocument);

      expect(styleOf(captured.frame)).not.toContain("background-color");
      expect(styleOf(captured.frame)).not.toContain("background-image");
      expect(styleOf(captured.html)).not.toContain("background: none");
      expect(styleOf(captured.body)).not.toContain("background: none");
    });

    it("carries the root's font-size to the svg as the rem base", () => {
      const replayDocument: Document = makeReplayDocument(`<p>Page</p>`, {
        htmlAttributes: `style="font-size: 20px"`,
      });

      expect(styleOf(capture(replayDocument).svg.documentElement)).toContain(
        "font-size: 20px !important",
      );
    });
  });

  describe("modal dialogs", () => {
    it("draws a modal dialog on top, over a box painted like its backdrop", () => {
      const replayDocument: Document = makeReplayDocument(
        `<main id="page">Page</main><dialog id="confirm" open style="color: rgb(17, 24, 39)"><p id="question">Delete?</p></dialog>`,
      );
      const dialog: HTMLElement = liveById(replayDocument, "confirm");

      makeModal(dialog);
      setPseudoStyle(dialog, "::backdrop", {
        "background-color": "rgba(0, 0, 0, 0.5)",
      });

      const captured: CapturedFrame = capture(replayDocument);
      const clone: Element = byId(captured.svg, "confirm");
      const backdrop: Element = clone.previousElementSibling as Element;

      expect(styleOf(clone)).toContain("color: rgb(17, 24, 39) !important");
      expect(styleOf(clone)).toContain("z-index: 2147483647 !important");
      expect(backdrop.localName).toBe("div");
      expect(styleOf(backdrop)).toBe(
        "position: fixed !important; inset: 0px !important; z-index: 2147483646 !important; background-color: rgba(0, 0, 0, 0.5) !important",
      );
      expect(byId(captured.svg, "question").textContent).toBe("Delete?");
    });

    it("paints no backdrop box for a transparent or unreadable backdrop", () => {
      const replayDocument: Document = makeReplayDocument(
        `<main id="page">Page</main><dialog id="clear" open>Clear</dialog><dialog id="unknown" open>Unknown</dialog>`,
      );
      const clear: HTMLElement = liveById(replayDocument, "clear");
      const unknown: HTMLElement = liveById(replayDocument, "unknown");

      makeModal(clear);
      makeModal(unknown);
      setPseudoStyle(clear, "::backdrop", {
        "background-color": "rgba(0, 0, 0, 0)",
      });
      setPseudoStyle(
        unknown,
        "::backdrop",
        new Error("No ::backdrop in this engine."),
      );

      const captured: CapturedFrame = capture(replayDocument);

      expect(byId(captured.svg, "clear").previousElementSibling?.id).toBe(
        "page",
      );
      expect(byId(captured.svg, "unknown").previousElementSibling?.id).toBe(
        "clear",
      );
      expect(styleOf(byId(captured.svg, "unknown"))).toContain(
        "z-index: 2147483647 !important",
      );
    });

    it("leaves a dialog that is not modal as it is", () => {
      const replayDocument: Document = makeReplayDocument(
        `<main id="page">Page</main><dialog id="inline" open style="padding: 12px">Inline</dialog>`,
      );
      const clone: Element = byId(capture(replayDocument).svg, "inline");

      expect(clone.getAttribute("style")).toBe("padding: 12px");
      expect(clone.previousElementSibling?.id).toBe("page");
    });
  });

  describe("animations", () => {
    it("pins every animated property to its paused value with !important", () => {
      const replayDocument: Document = makeReplayDocument(
        `<div id="toast" style="opacity: 0.4; background-color: rgb(10, 20, 30); float: left; color: rgb(1, 1, 1)">Saved</div>`,
      );
      const toast: HTMLElement = liveById(replayDocument, "toast");

      defineAnimations(replayDocument, (): Array<unknown> => {
        return [
          fakeAnimation({
            target: toast,
            keyframes: [
              {
                offset: 0,
                computedOffset: 0,
                easing: "ease-in",
                composite: "auto",
                opacity: "0",
              },
              {
                offset: 1,
                computedOffset: 1,
                easing: "linear",
                composite: "replace",
                backgroundColor: "red",
                cssFloat: "none",
              },
            ],
          }),
        ];
      });

      const style: string = styleOf(byId(capture(replayDocument).svg, "toast"));

      expect(style).toContain("opacity: 0.4 !important");
      expect(style).toContain("background-color: rgb(10, 20, 30) !important");
      expect(style).toContain("float: left !important");
      expect(style).not.toContain("color: rgb(1, 1, 1) !important");

      for (const key of ["offset", "easing", "composite"]) {
        expect(style).not.toContain(`${key}:`);
      }
    });

    it("rewrites urls in an animated value", () => {
      const replayDocument: Document = makeReplayDocument(
        `<div id="hero" style="background-image: url(https://cdn.example/hero.png)">Hero</div>`,
      );
      const hero: HTMLElement = liveById(replayDocument, "hero");

      defineAnimations(replayDocument, (): Array<unknown> => {
        return [
          fakeAnimation({
            target: hero,
            keyframes: [{ backgroundImage: "none" }],
          }),
        ];
      });

      const captured: CapturedFrame = capture(replayDocument);

      expect(styleOf(byId(captured.svg, "hero"))).toContain(
        `background-image: ${EMPTY_URL} !important`,
      );
      expect(captured.serialization.svg).not.toContain("cdn.example");
    });

    it("ignores pseudo-element animations", () => {
      const replayDocument: Document = makeReplayDocument(
        `<span id="badge" style="opacity: 0.5">New</span>`,
      );
      const badge: HTMLElement = liveById(replayDocument, "badge");

      defineAnimations(replayDocument, (): Array<unknown> => {
        return [
          fakeAnimation({
            target: badge,
            keyframes: [{ opacity: "0" }],
            pseudoElement: "::before",
          }),
        ];
      });

      expect(styleOf(byId(capture(replayDocument).svg, "badge"))).toBe(
        "opacity: 0.5",
      );
    });

    it("ignores animations it cannot read", () => {
      const replayDocument: Document = makeReplayDocument(
        `<span id="badge" style="opacity: 0.5">New</span>`,
      );
      const badge: HTMLElement = liveById(replayDocument, "badge");

      defineAnimations(replayDocument, (): Array<unknown> => {
        return [
          { effect: null },
          { effect: { target: badge, pseudoElement: null } },
          fakeAnimation({ target: null, keyframes: [{ opacity: "0" }] }),
          fakeAnimation({
            target: badge.firstChild,
            keyframes: [{ opacity: "0" }],
          }),
        ];
      });

      expect(styleOf(byId(capture(replayDocument).svg, "badge"))).toBe(
        "opacity: 0.5",
      );
    });

    it("still captures when getAnimations throws", () => {
      const replayDocument: Document = makeReplayDocument(
        `<span id="badge">New</span>`,
      );

      defineAnimations(replayDocument, (): Array<unknown> => {
        throw new Error("Not supported.");
      });

      expect(byId(capture(replayDocument).svg, "badge").textContent).toBe(
        "New",
      );
    });
  });

  describe("links", () => {
    it("carries a link's computed colour and underline, which an SVG image would lose", () => {
      const replayDocument: Document = makeReplayDocument(
        `<a id="pricing" href="/pricing">Pricing</a>`,
      );
      const values: Record<string, string> = {
        color: "rgb(0, 0, 238)",
        "text-decoration-line": "underline",
        "text-decoration-color": "rgb(0, 0, 238)",
        "text-decoration-style": "solid",
        "text-decoration-thickness": "auto",
        "text-underline-offset": "auto",
      };

      overrideComputedStyle(liveById(replayDocument, "pricing"), values);

      const link: Element = byId(capture(replayDocument).svg, "pricing");

      expect(REPLAY_FRAME_LINK_PROPERTIES).toEqual(Object.keys(values));
      expect(styleOf(link)).toBe(
        REPLAY_FRAME_LINK_PROPERTIES.map((property: string): string => {
          return `${property}: ${values[property]}`;
        }).join("; "),
      );
      expect(link.getAttribute("href")).toBe("/pricing");
    });

    it("adds nothing to an anchor that is not a link", () => {
      const replayDocument: Document = makeReplayDocument(
        `<a id="top" name="top">Top</a>`,
      );

      overrideComputedStyle(liveById(replayDocument, "top"), {
        color: "rgb(0, 0, 0)",
      });

      expect(
        byId(capture(replayDocument).svg, "top").getAttribute("style"),
      ).toBeNull();
    });
  });

  describe("hostile content", () => {
    it("still yields well-formed XML", () => {
      const replayDocument: Document = makeReplayDocument(
        `<p id="text"></p>` +
          `<div id="attrs" @click="go()" :class="{ on: true }" x-on:click="run()" data-ok="yes"></div>` +
          `<div id="inline" style='content: "<&>"; font-family: "A&B"'></div>` +
          `<my:widget id="widget">w</my:widget>` +
          `<!-- a -- comment -->`,
        { head: `<style id="hostile"></style>` },
      );

      liveById(replayDocument, "text").textContent =
        "bell\u0007 esc\u001B cdata ]]> lt < amp & nonchar ￾ lone \uD800 emoji 😀";
      liveById(replayDocument, "attrs").setAttribute(
        "title",
        'quote " lt < amp & ctrl \u0001 end',
      );
      liveById(replayDocument, "hostile").textContent =
        '.a::after { content: "<&>\u0001]]>"; }';

      /* capture() parses the SVG and fails on any parsererror. */
      const captured: CapturedFrame = capture(replayDocument);

      expect(byId(captured.svg, "text").textContent).toBe(
        "bell esc cdata ]]> lt < amp & nonchar  lone  emoji 😀",
      );
      expect(byId(captured.svg, "attrs").getAttribute("title")).toBe(
        'quote " lt < amp & ctrl  end',
      );
      expect(byId(captured.svg, "attrs").getAttribute("data-ok")).toBe("yes");
      expect(styleOf(byId(captured.svg, "inline"))).toBe(
        'content: "<&>"; font-family: "A&B"',
      );
      expect(headStyleTexts(captured).join("\n")).toContain(
        'content: "<&>]]>"',
      );
      expect(captured.serialization.svg).not.toContain("comment");
    });
  });

  describe("the live document", () => {
    it("is never written to", () => {
      const replayDocument: Document = makeReplayDocument(
        `<div id="scroller" style="overflow: auto"><section id="first">First</section></div>` +
          `<pre id="log" style="overflow: auto">log text</pre>` +
          `<input id="name" value="initial"><input id="agree" type="checkbox" checked>` +
          `<select id="plan"><option value="a" selected>A</option><option value="b">B</option></select>` +
          `<textarea id="notes">initial</textarea>` +
          `<img id="photo" src="https://cdn.example/a.png" srcset="a.png 1x" style="width: 10px">` +
          `<a id="link" href="/x">x</a>` +
          `<dialog id="modal" open>Modal</dialog>` +
          `<fancy-card id="card"><span slot="title">Light</span></fancy-card>` +
          `<iframe id="child"></iframe>` +
          `<button onclick="x()">Go</button>`,
        {
          htmlAttributes: `${REPLAY_TEXT_SELECTION_ATTRIBUTE}="true" style="overflow-x: visible; overflow-y: visible; background-color: rgb(1, 2, 3)"`,
          head:
            `<style>:root { --x: url(https://cdn.example/x.png); }</style>` +
            `<style ${REPLAY_TEXT_SELECTION_STYLE_ATTRIBUTE}="true">.x { color: red; }</style>` +
            `<script type="application/json">{}</script>`,
        },
      );
      const view: Window & { MutationObserver: typeof MutationObserver } =
        replayDocument.defaultView as Window & {
          MutationObserver: typeof MutationObserver;
        };
      const root: ShadowRoot = attachShadow(
        liveById(replayDocument, "card"),
        `<div id="inner"><slot name="title"></slot></div>`,
      );
      const child: Document = mountChildFrame(
        replayDocument,
        "child",
        `<p>Child</p>`,
        { width: 200, height: 100 },
      );
      const input: HTMLInputElement = liveById(
        replayDocument,
        "name",
      ) as HTMLInputElement;
      const checkbox: HTMLInputElement = liveById(
        replayDocument,
        "agree",
      ) as HTMLInputElement;
      const notes: HTMLTextAreaElement = liveById(
        replayDocument,
        "notes",
      ) as HTMLTextAreaElement;
      const dialog: HTMLElement = liveById(replayDocument, "modal");

      input.value = "typed";
      checkbox.checked = false;
      notes.value = "typed notes";
      (liveById(replayDocument, "plan") as HTMLSelectElement).value = "b";
      stubBox(replayDocument.documentElement, { scrollTop: 90 });
      stubBox(liveById(replayDocument, "scroller"), { scrollTop: 20 });
      stubBox(liveById(replayDocument, "first"), {
        clientRectCount: 1,
        rect: { top: -20, left: 0 },
      });
      stubBox(liveById(replayDocument, "log"), { scrollTop: 10 });
      markImageLoaded(liveById(replayDocument, "photo"), {
        width: 10,
        height: 10,
      });
      mockImageCanvas({ hasContext: true, isTainted: true });
      makeModal(dialog);
      setPseudoStyle(dialog, "::backdrop", {
        "background-color": "rgba(0, 0, 0, 0.5)",
      });
      defineAnimations(replayDocument, (): Array<unknown> => {
        return [
          fakeAnimation({ target: dialog, keyframes: [{ opacity: "0" }] }),
        ];
      });

      const before: Array<string> = [
        replayDocument.documentElement.outerHTML,
        root.innerHTML,
        child.documentElement.outerHTML,
      ];
      const records: Array<MutationRecord> = [];
      const observers: Array<MutationObserver> = [
        replayDocument,
        root,
        child,
      ].map((target: Node): MutationObserver => {
        const observer: MutationObserver = new view.MutationObserver(
          (batch: Array<MutationRecord>): void => {
            records.push(...batch);
          },
        );

        observer.observe(target, {
          subtree: true,
          attributes: true,
          childList: true,
          characterData: true,
        });

        return observer;
      });

      const serialization: ReplayFrameSerialization = serialize(replayDocument);

      for (const observer of observers) {
        records.push(...observer.takeRecords());
        observer.disconnect();
      }

      expect(serialization.frames).toHaveLength(1);
      expect(records).toHaveLength(0);
      expect([
        replayDocument.documentElement.outerHTML,
        root.innerHTML,
        child.documentElement.outerHTML,
      ]).toEqual(before);
      expect(input.value).toBe("typed");
      expect(checkbox.checked).toBe(false);
      expect(notes.value).toBe("typed notes");
      expect(
        replayDocument.documentElement.getAttribute(
          REPLAY_TEXT_SELECTION_ATTRIBUTE,
        ),
      ).toBe("true");
    });
  });

  describe("errors", () => {
    it("refuses a viewport with no size", () => {
      const replayDocument: Document = makeReplayDocument(`<p>Page</p>`);

      for (const viewport of [
        { width: 0, height: 600 },
        { width: 800, height: 0 },
        { width: -1, height: 600 },
        { width: Number.NaN, height: 600 },
        { width: 800, height: Number.NaN },
        { width: Number.POSITIVE_INFINITY, height: 600 },
      ]) {
        expectCaptureError(
          catchError((): unknown => {
            return serializeReplayFrame(replayDocument, viewport);
          }),
          "empty-viewport",
        );
      }
    });

    it("refuses a document with no window", () => {
      const detached: Document = document.implementation.createHTMLDocument("");

      expectCaptureError(
        catchError((): unknown => {
          return serializeReplayFrame(detached, VIEWPORT);
        }),
        "no-document",
      );
    });

    it("refuses a document with no root element", () => {
      const empty: Document = {
        defaultView: window,
        documentElement: null,
      } as unknown as Document;

      expectCaptureError(
        catchError((): unknown => {
          return serializeReplayFrame(empty, VIEWPORT);
        }),
        "no-document",
      );
    });
  });
});

/* ==== Rasterising, against injected fakes. ==== */

describe("rasterizeReplayFrame", () => {
  describe("the canvas", () => {
    it("is the viewport times the pixel ratio", async () => {
      const harness: RasterHarness = makeRasterHarness();
      const canvas: HTMLCanvasElement = await rasterizeReplayFrame(
        makeSerialization(),
        { pixelRatio: 2, deps: harness.deps },
      );

      expect(harness.canvases).toHaveLength(1);
      expect(canvas).toBe(harness.canvases[0]!.asElement());
      expect([harness.canvases[0]!.width, harness.canvases[0]!.height]).toEqual(
        [1600, 1200],
      );
    });

    it("defaults to a pixel ratio of 1", async () => {
      const harness: RasterHarness = makeRasterHarness();

      await rasterizeReplayFrame(makeSerialization(), { deps: harness.deps });

      expect([harness.canvases[0]!.width, harness.canvases[0]!.height]).toEqual(
        [800, 600],
      );
    });

    /*
     * Floored: rounding both sides up can take a frame the ratio was
     * chosen to fit back over the pixel budget.
     */
    it("floors a fractional size", async () => {
      const harness: RasterHarness = makeRasterHarness();

      await rasterizeReplayFrame(
        makeSerialization({ viewport: { width: 333, height: 201 } }),
        { pixelRatio: 1.5, deps: harness.deps },
      );

      expect([harness.canvases[0]!.width, harness.canvases[0]!.height]).toEqual(
        [499, 301],
      );
    });

    it("stays inside the pixel budget for a huge viewport", async () => {
      const harness: RasterHarness = makeRasterHarness();

      await rasterizeReplayFrame(
        makeSerialization({ viewport: { width: 10000, height: 10000 } }),
        { pixelRatio: 2, deps: harness.deps },
      );

      expect([harness.canvases[0]!.width, harness.canvases[0]!.height]).toEqual(
        [4096, 4096],
      );
    });

    /*
     * The ratio is chosen so width x height x ratio^2 fits the budget, but
     * each side is then ROUNDED: when both round up, the canvas is a few
     * thousand pixels over the 16,777,216 Safari allows.
     */
    it("stays inside the pixel budget after rounding each side", async () => {
      const harness: RasterHarness = makeRasterHarness();

      await rasterizeReplayFrame(
        makeSerialization({ viewport: { width: 3024, height: 1964 } }),
        { pixelRatio: 2, deps: harness.deps },
      );

      expect(
        harness.canvases[0]!.width * harness.canvases[0]!.height,
      ).toBeLessThanOrEqual(REPLAY_FRAME_MAX_CANVAS_PIXELS);
    });
  });

  describe("painting", () => {
    it("loads the serialization's svg as a base64 data url", async () => {
      const harness: RasterHarness = makeRasterHarness();
      const serialization: ReplayFrameSerialization = makeSerialization();

      await rasterizeReplayFrame(serialization, { deps: harness.deps });

      expect(harness.urls).toEqual([toSvgDataUrl(serialization.svg)]);
      expect(decodeSvgDataUrl(harness.urls[0]!)).toBe(serialization.svg);
    });

    it("fills the page with the stage background and paints twice, a frame apart, from a cleared canvas", async () => {
      const harness: RasterHarness = makeRasterHarness();

      await rasterizeReplayFrame(makeSerialization(), {
        pixelRatio: 2,
        deps: harness.deps,
      });

      const pass: Array<string> = [
        "canvas-0 clearRect 0 0 1600 1200",
        `canvas-0 fillRect ${REPLAY_FRAME_DEFAULT_BACKGROUND} 0 0 1600 1200`,
        "canvas-0 drawImage image-0 0 0 1600 1200",
      ];

      expect(harness.timeline).toEqual([
        "createCanvas canvas-0 1600x1200",
        "loadImage image-0",
        ...pass,
        "nextFrame",
        ...pass,
      ]);
    });

    it("does not fill a nested frame, which is transparent where its page paints nothing", async () => {
      const harness: RasterHarness = makeRasterHarness();

      await rasterizeReplayFrame(makeSerialization({ backgroundColor: null }), {
        deps: harness.deps,
      });

      expect(contextOf(harness.canvases[0]).calls).toEqual([
        "clearRect 0 0 800 600",
        "drawImage image-0 0 0 800 600",
        "clearRect 0 0 800 600",
        "drawImage image-0 0 0 800 600",
      ]);
    });
  });

  describe("nested frames", () => {
    const TOKEN: string = "oneuptime-frame-0-0";

    function makeParent(
      child: ReplayFrameSerialization,
    ): ReplayFrameSerialization {
      return makeSerialization({
        svg: `<svg xmlns="${SVG_NAMESPACE}"><image href="${TOKEN}"/><image href="${TOKEN}"/></svg>`,
        frames: [{ token: TOKEN, serialization: child }],
      });
    }

    function makeChild(text: string): ReplayFrameSerialization {
      return makeSerialization({
        viewport: { width: 200, height: 100 },
        svg: `<svg xmlns="${SVG_NAMESPACE}"><text>${text}</text></svg>`,
        backgroundColor: null,
      });
    }

    it("renders a nested frame first and swaps its picture in for every use of its token", async () => {
      const harness: RasterHarness = makeRasterHarness();
      const child: ReplayFrameSerialization = makeChild("child");

      await rasterizeReplayFrame(makeParent(child), {
        pixelRatio: 2,
        deps: harness.deps,
      });

      const childCanvas: FakeCanvas = harness.canvases[0]!;
      const parentSvg: string = decodeSvgDataUrl(harness.urls[1]!);

      expect(
        harness.canvases.map((canvas: FakeCanvas): string => {
          return `${canvas.name} ${canvas.width}x${canvas.height}`;
        }),
      ).toEqual(["canvas-0 400x200", "canvas-1 1600x1200"]);
      expect(decodeSvgDataUrl(harness.urls[0]!)).toBe(child.svg);
      expect(parentSvg).not.toContain(TOKEN);
      expect(parentSvg.split(childCanvas.dataUrl)).toHaveLength(3);
      expect(
        contextOf(childCanvas).calls.some((call: string): boolean => {
          return call.startsWith("fillRect");
        }),
      ).toBe(false);
      /* The child is fully painted, both passes, before the parent loads. */
      expect(harness.timeline.indexOf("loadImage image-1")).toBeGreaterThan(
        harness.timeline.lastIndexOf("canvas-0 drawImage image-0 0 0 400 200"),
      );
    });

    it("renders frames inside frames innermost first", async () => {
      const harness: RasterHarness = makeRasterHarness();
      const grandchild: ReplayFrameSerialization = makeChild("grandchild");
      const child: ReplayFrameSerialization = makeSerialization({
        viewport: { width: 400, height: 300 },
        svg: `<svg xmlns="${SVG_NAMESPACE}"><image href="oneuptime-frame-1-0"/></svg>`,
        backgroundColor: null,
        frames: [{ token: "oneuptime-frame-1-0", serialization: grandchild }],
      });

      await rasterizeReplayFrame(makeParent(child), { deps: harness.deps });

      expect(decodeSvgDataUrl(harness.urls[0]!)).toBe(grandchild.svg);
      expect(decodeSvgDataUrl(harness.urls[1]!)).toContain(
        harness.canvases[0]!.dataUrl,
      );
      expect(decodeSvgDataUrl(harness.urls[2]!)).toContain(
        harness.canvases[1]!.dataUrl,
      );
    });

    it("falls back to a transparent picture when a nested frame fails to load", async () => {
      const harness: RasterHarness = makeRasterHarness({ failingLoads: [0] });

      await rasterizeReplayFrame(makeParent(makeChild("child")), {
        deps: harness.deps,
      });

      const parentSvg: string = decodeSvgDataUrl(harness.urls[1]!);

      expect(parentSvg).not.toContain(TOKEN);
      expect(parentSvg.split(REPLAY_FRAME_TRANSPARENT_IMAGE)).toHaveLength(3);
    });

    it("falls back to a transparent picture when a nested frame has no 2D canvas", async () => {
      const harness: RasterHarness = makeRasterHarness({ contextless: [0] });

      await rasterizeReplayFrame(makeParent(makeChild("child")), {
        deps: harness.deps,
      });

      expect(harness.urls).toHaveLength(1);
      expect(decodeSvgDataUrl(harness.urls[0]!)).toContain(
        REPLAY_FRAME_TRANSPARENT_IMAGE,
      );
    });

    /*
     * Tokens are "<prefix><depth>-<index>", and a plain string replace of
     * frame 1's token also matches the start of frame 10's, so frame 10
     * would be drawn with frame 1's picture (and a stray "0" after it).
     */
    it("swaps each of many sibling frames' pictures into its own image", async () => {
      const count: number = 11;
      const replayDocument: Document = makeReplayDocument(
        Array.from({ length: count }, (_: unknown, index: number): string => {
          return `<iframe id="frame-${index}"></iframe>`;
        }).join(""),
      );

      for (let index: number = 0; index < count; index++) {
        mountChildFrame(replayDocument, `frame-${index}`, `<p>${index}</p>`, {
          width: 100,
          height: 50,
        });
      }

      const harness: RasterHarness = makeRasterHarness();

      await rasterizeReplayFrame(serialize(replayDocument), {
        deps: harness.deps,
      });

      const parent: Document = parseSvg(decodeSvgDataUrl(harness.urls[count]!));

      for (let index: number = 0; index < count; index++) {
        expect(byId(parent, `frame-${index}`).getAttribute("src")).toBe(
          harness.canvases[index]!.dataUrl,
        );
      }
    });
  });

  describe("the pointer", () => {
    it("is drawn last, at the recorded point, scaled by the pixel ratio", async () => {
      const harness: RasterHarness = makeRasterHarness();

      await rasterizeReplayFrame(makeSerialization(), {
        pixelRatio: 2,
        pointer: { x: 100, y: 50 },
        deps: harness.deps,
      });

      const context: FakeContext2D = contextOf(harness.canvases[0]);

      expect(context.arcs).toEqual([[200, 100, 20, 0, Math.PI * 2]]);
      expect(context.calls.slice(-6)).toEqual([
        "save",
        "beginPath",
        "arc",
        "fill rgba(73, 80, 246, 0.35)",
        "stroke rgba(73, 80, 246, 0.9) 4",
        "restore",
      ]);
    });

    it("is drawn on the viewport's edges", async () => {
      for (const pointer of [
        { x: 0, y: 0 },
        { x: 800, y: 600 },
      ]) {
        const harness: RasterHarness = makeRasterHarness();

        await rasterizeReplayFrame(makeSerialization(), {
          pointer: pointer,
          deps: harness.deps,
        });

        expect(contextOf(harness.canvases[0]).arcs).toHaveLength(1);
      }
    });

    it("is left out when it is outside the viewport or not a finite point", async () => {
      const pointers: Array<ReplayFramePointer | null | undefined> = [
        null,
        undefined,
        { x: -1, y: 10 },
        { x: 10, y: -1 },
        { x: 801, y: 10 },
        { x: 10, y: 601 },
        { x: Number.NaN, y: 10 },
        { x: 10, y: Number.POSITIVE_INFINITY },
      ];

      for (const pointer of pointers) {
        const harness: RasterHarness = makeRasterHarness();

        await rasterizeReplayFrame(makeSerialization(), {
          pointer: pointer,
          deps: harness.deps,
        });

        expect(contextOf(harness.canvases[0]).arcs).toHaveLength(0);
      }
    });

    it("uses the capped pixel ratio", async () => {
      const harness: RasterHarness = makeRasterHarness();

      await rasterizeReplayFrame(makeSerialization(), {
        pixelRatio: 3,
        pointer: { x: 10, y: 20 },
        deps: harness.deps,
      });

      expect(contextOf(harness.canvases[0]).arcs).toEqual([
        [20, 40, 20, 0, Math.PI * 2],
      ]);
    });
  });

  it("fails with render-failed when there is no 2D canvas", async () => {
    const harness: RasterHarness = makeRasterHarness({ contextless: [0] });
    const error: unknown = await catchRejection(
      rasterizeReplayFrame(makeSerialization(), { deps: harness.deps }),
    );

    expectCaptureError(error, "render-failed");
    expect(harness.urls).toHaveLength(0);
  });
});

describe("drawReplayFramePointer", () => {
  it("draws the stage's indigo dot and ring around the point", () => {
    const timeline: Array<string> = [];
    const context: FakeContext2D = new FakeContext2D("pointer", timeline);

    drawReplayFramePointer(
      context as unknown as CanvasRenderingContext2D,
      { x: 10, y: 20 },
      1.5,
    );

    expect(context.arcs).toEqual([[15, 30, 15, 0, Math.PI * 2]]);
    expect(context.calls).toEqual([
      "save",
      "beginPath",
      "arc",
      "fill rgba(73, 80, 246, 0.35)",
      "stroke rgba(73, 80, 246, 0.9) 3",
      "restore",
    ]);
  });
});

describe("encodeReplayFrameCanvas", () => {
  function makeCanvas(behaviour: FakeBlobBehaviour): FakeCanvas {
    const canvas: FakeCanvas = new FakeCanvas({
      name: "encode",
      width: 1,
      height: 1,
      hasContext: true,
      timeline: [],
    });

    canvas.blobBehaviour = behaviour;

    return canvas;
  }

  it("resolves with the PNG blob", async () => {
    const canvas: FakeCanvas = makeCanvas("blob");

    await expect(encodeReplayFrameCanvas(canvas.asElement())).resolves.toBe(
      canvas.blob,
    );
    expect(canvas.blobTypes).toEqual(["image/png"]);
  });

  it("fails with encode-failed when the browser hands back no blob", async () => {
    expectCaptureError(
      await catchRejection(
        encodeReplayFrameCanvas(makeCanvas("null").asElement()),
      ),
      "encode-failed",
    );
  });

  it("fails with encode-failed when toBlob throws on a tainted canvas", async () => {
    expectCaptureError(
      await catchRejection(
        encodeReplayFrameCanvas(makeCanvas("throw").asElement()),
      ),
      "encode-failed",
    );
  });
});

describe("toReplayFrameCaptureError", () => {
  it("keeps a capture error as it is", () => {
    const error: ReplayFrameCaptureError = new ReplayFrameCaptureError(
      "encode-failed",
      "Nope.",
    );

    expect(toReplayFrameCaptureError(error)).toBe(error);
  });

  it("turns anything else into render-failed", () => {
    for (const thrown of [new TypeError("x"), "string", undefined, null, 42]) {
      const error: ReplayFrameCaptureError = toReplayFrameCaptureError(thrown);

      expectCaptureError(error, "render-failed");
      expect(error.message).toBe("The browser could not draw this frame.");
    }
  });
});

describe("captureReplayFrame", () => {
  it("captures a replay document into the PNG blob", async () => {
    const replayDocument: Document = makeReplayDocument(
      `<h1 id="title">Checkout</h1>`,
    );
    const harness: RasterHarness = makeRasterHarness();

    prepareRuleLists(replayDocument);

    const blob: Blob = await captureReplayFrame({
      document: replayDocument,
      viewport: VIEWPORT,
      pixelRatio: 2,
      pointer: { x: 10, y: 10 },
      deps: harness.deps,
    });

    expect(blob).toBe(harness.canvases[0]!.blob);
    expect(harness.canvases[0]!.blobTypes).toEqual(["image/png"]);
    expect([harness.canvases[0]!.width, harness.canvases[0]!.height]).toEqual([
      1600, 1200,
    ]);
    expect(
      byId(parseSvg(decodeSvgDataUrl(harness.urls[0]!)), "title").textContent,
    ).toBe("Checkout");
    expect(contextOf(harness.canvases[0]).arcs).toHaveLength(1);
  });

  it("rejects with render-failed for an error that is not its own", async () => {
    const replayDocument: Document = makeReplayDocument(`<p>Page</p>`);
    const failures: Array<Partial<ReplayFrameRasterDeps>> = [
      makeRasterHarness({ failingLoads: [0] }).deps,
      {
        ...makeRasterHarness().deps,
        createCanvas: (): HTMLCanvasElement => {
          throw new TypeError("Canvas is not a constructor.");
        },
      },
      {
        ...makeRasterHarness().deps,
        nextFrame: (): Promise<void> => {
          return Promise.reject(new Error("The tab was hidden."));
        },
      },
    ];

    for (const deps of failures) {
      const error: unknown = await catchRejection(
        captureReplayFrame({
          document: replayDocument,
          viewport: VIEWPORT,
          deps: deps,
        }),
      );

      expectCaptureError(error, "render-failed");
    }
  });

  it("keeps the reason of its own errors", async () => {
    const replayDocument: Document = makeReplayDocument(`<p>Page</p>`);

    for (const [options, reason] of [
      [{ blobBehaviour: "null" }, "encode-failed"],
      [{ blobBehaviour: "throw" }, "encode-failed"],
      [{ contextless: [0] }, "render-failed"],
    ] as Array<[RasterHarnessOptions, ReplayFrameCaptureFailure]>) {
      const error: unknown = await catchRejection(
        captureReplayFrame({
          document: replayDocument,
          viewport: VIEWPORT,
          deps: makeRasterHarness(options).deps,
        }),
      );

      expectCaptureError(error, reason);
    }
  });

  it("rejects, rather than throws, for a document or viewport it cannot use", async () => {
    const replayDocument: Document = makeReplayDocument(`<p>Page</p>`);
    const detached: Document = document.implementation.createHTMLDocument("");

    for (const [input, reason] of [
      [
        { document: replayDocument, viewport: { width: 0, height: 0 } },
        "empty-viewport",
      ],
      [{ document: detached, viewport: VIEWPORT }, "no-document"],
    ] as Array<
      [
        { document: Document; viewport: ReplayFrameViewport },
        ReplayFrameCaptureFailure,
      ]
    >) {
      const harness: RasterHarness = makeRasterHarness();
      let pending: Promise<Blob> | null = null;

      expect((): void => {
        pending = captureReplayFrame({ ...input, deps: harness.deps });
      }).not.toThrow();
      expectCaptureError(
        await catchRejection(pending as unknown as Promise<Blob>),
        reason,
      );
      expect(harness.canvases).toHaveLength(0);
    }
  });

  it("takes the clone the moment it is called, so later changes are not in the picture", async () => {
    const replayDocument: Document = makeReplayDocument(
      `<p id="status">Before</p><input id="field" value="old"><iframe id="child"></iframe>`,
    );
    const child: Document = mountChildFrame(
      replayDocument,
      "child",
      `<p id="inner">Inner before</p>`,
      { width: 200, height: 100 },
    );
    const harness: RasterHarness = makeRasterHarness({
      nextFrame: (): Promise<void> => {
        return new Promise<void>((resolve: () => void): void => {
          setTimeout(resolve, 0);
        });
      },
    });

    prepareRuleLists(replayDocument);

    const pending: Promise<Blob> = captureReplayFrame({
      document: replayDocument,
      viewport: VIEWPORT,
      deps: harness.deps,
    });

    liveById(replayDocument, "status").textContent = "Changed";
    (liveById(replayDocument, "field") as HTMLInputElement).value = "new";
    liveById(child, "inner").textContent = "Inner changed";
    liveById(replayDocument, "child").remove();

    await pending;

    const childSvg: Document = parseSvg(decodeSvgDataUrl(harness.urls[0]!));
    const parentSvg: Document = parseSvg(decodeSvgDataUrl(harness.urls[1]!));

    /* The parent SVG was only handed over after the child's frame wait. */
    expect(harness.timeline.indexOf("loadImage image-1")).toBeGreaterThan(
      harness.timeline.indexOf("nextFrame"),
    );
    expect(byId(childSvg, "inner").textContent).toBe("Inner before");
    expect(byId(parentSvg, "status").textContent).toBe("Before");
    expect(byId(parentSvg, "field").getAttribute("value")).toBe("old");
    expect(byId(parentSvg, "child").getAttribute("src")).toBe(
      harness.canvases[0]!.dataUrl,
    );
  });
});
