/*
 * The editor's DOM and the string it stands for. Drawing a value and reading
 * it back must give the same string; so must reading what a browser leaves
 * behind when it edits the element itself - a <div> per line, a <br>, a
 * <span> it wrapped text in - because that is what was typed.
 */

import {
  CHIP_REFERENCE_ATTRIBUTE,
  createReferenceChipElement,
} from "../../../../../UI/Components/Workflow/ValuePicker/ReferenceChip";
import {
  LINE_END_ATTRIBUTE,
  TemplateSelection,
  chipAncestor,
  chipAtOffset,
  domPointToOffset,
  isTemplateDomTidy,
  offsetToDomPoint,
  readTemplateSelection,
  renderTemplateValue,
  serializeTemplateEditor,
  writeTemplateSelection,
} from "../../../../../UI/Components/Workflow/ValuePicker/TemplateTextDom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

const BODY: string = "{{local.components.webhook-1.returnValues.request-body}}";
const ENV: string = "{{local.variables.DEPLOY_ENV}}";

let root: HTMLDivElement;

type BuildFunction = (reference: string) => HTMLElement;

const build: BuildFunction = (reference: string): HTMLElement => {
  return createReferenceChipElement(document, reference, null);
};

beforeEach(() => {
  root = document.createElement("div");
  root.setAttribute("contenteditable", "true");
  document.body.appendChild(root);
});

afterEach(() => {
  root.remove();
});

describe("drawing a value and reading it back", () => {
  test.each([
    [""],
    ["plain text"],
    [BODY],
    [`Body: ${BODY} in ${ENV}.`],
    [`${BODY}${ENV}`],
    ["line one\nline two"],
    ["ends with a line break\n"],
    ["\n\nblank lines first"],
    ["{{ not a chip }} and {{#each local.variables.items}}{{name}}{{/each}}"],
    ["tab\there, emoji 🚀, spaces   kept  "],
  ])("%j comes back exactly", (value: string) => {
    renderTemplateValue(root, value, build);

    expect(serializeTemplateEditor(root)).toBe(value);
    expect(isTemplateDomTidy(root, value)).toBe(true);
  });

  test("each reference is one chip that carries it; text is text", () => {
    renderTemplateValue(root, `Body: ${BODY} in ${ENV}.`, build);

    const chips: Array<Element> = Array.from(
      root.querySelectorAll(`[${CHIP_REFERENCE_ATTRIBUTE}]`),
    );

    expect(
      chips.map((chip: Element) => {
        return chip.getAttribute(CHIP_REFERENCE_ATTRIBUTE);
      }),
    ).toEqual([BODY, ENV]);
    expect(chips[0]!.getAttribute("contenteditable")).toBe("false");
    expect(root.childNodes).toHaveLength(5);
  });

  test("only a value ending in a line break gets the empty-last-line <br>", () => {
    renderTemplateValue(root, "a\n", build);
    expect(root.lastChild?.nodeName).toBe("BR");
    expect((root.lastChild as HTMLElement).hasAttribute(LINE_END_ATTRIBUTE)).toBe(
      true,
    );

    renderTemplateValue(root, "a", build);
    expect(root.querySelector("br")).toBeNull();
  });

  test("drawing again replaces what was there", () => {
    renderTemplateValue(root, `first ${BODY}`, build);
    renderTemplateValue(root, "second", build);

    expect(root.innerHTML).toBe("second");
  });
});

describe("reading what a browser left behind", () => {
  test("Chromium's Enter: a <div> holding a <br> after the text", () => {
    root.innerHTML = "hi<div><br></div>";

    expect(serializeTemplateEditor(root)).toBe("hi\n");
    expect(isTemplateDomTidy(root, "hi\n")).toBe(false);
  });

  test("Firefox's Enter: every line in a <div>", () => {
    root.innerHTML = "<div>hi</div><div>there</div><div><br></div>";

    expect(serializeTemplateEditor(root)).toBe("hi\nthere\n");
  });

  test("a bare <br> is a line break", () => {
    root.innerHTML = "one<br>two";

    expect(serializeTemplateEditor(root)).toBe("one\ntwo");
  });

  test("text wrapped in a span or a font tag is still just text", () => {
    root.innerHTML = 'a <span style="color: red">b</span> <font>c</font>';

    expect(serializeTemplateEditor(root)).toBe("a b c");
    expect(isTemplateDomTidy(root, "a b c")).toBe(false);
  });

  test("a chip anywhere in it is its reference", () => {
    root.innerHTML = "<div>x</div>";
    root.firstChild!.appendChild(build(ENV));

    expect(serializeTemplateEditor(root)).toBe(`x${ENV}`);
  });

  test("a reference typed out in full is not tidy: it should become a chip", () => {
    root.appendChild(document.createTextNode(`Hello ${ENV}`));

    expect(serializeTemplateEditor(root)).toBe(`Hello ${ENV}`);
    expect(isTemplateDomTidy(root, `Hello ${ENV}`)).toBe(false);
  });

  test("text split over several nodes is tidy, and empty text nodes are ignored", () => {
    root.appendChild(document.createTextNode("Hel"));
    root.appendChild(document.createTextNode(""));
    root.appendChild(document.createTextNode("lo"));

    expect(isTemplateDomTidy(root, "Hello")).toBe(true);
  });

  test("a line break without its <br>, or a <br> it no longer needs, is not tidy", () => {
    root.appendChild(document.createTextNode("a\n"));
    expect(isTemplateDomTidy(root, "a\n")).toBe(false);

    renderTemplateValue(root, "a\n", build);
    (root.firstChild as Text).data = "a";
    expect(isTemplateDomTidy(root, "a")).toBe(false);
  });
});

describe("offsets and the selection", () => {
  const VALUE: string = `Body: ${BODY} end`;

  beforeEach(() => {
    renderTemplateValue(root, VALUE, build);
  });

  test("a point in the text, at the root, and inside a chip", () => {
    const [before, chip, after] = Array.from(root.childNodes);

    expect(domPointToOffset(root, before!, 3)).toBe(3);
    expect(domPointToOffset(root, root, 1)).toBe(6);
    expect(domPointToOffset(root, root, 2)).toBe(6 + BODY.length);
    expect(domPointToOffset(root, after!, 1)).toBe(7 + BODY.length);
    // Inside a chip: its start at offset 0, its end anywhere else.
    expect(domPointToOffset(root, chip!, 0)).toBe(6);
    expect(domPointToOffset(root, chip!.firstChild!, 1)).toBe(6 + BODY.length);
  });

  test("an offset goes to a text node where there is one, never inside a chip", () => {
    expect(offsetToDomPoint(root, 3)).toEqual({
      node: root.childNodes[0],
      offset: 3,
    });
    // The chip's start is the end of the text before it.
    expect(offsetToDomPoint(root, 6)).toEqual({
      node: root.childNodes[0],
      offset: 6,
    });
    // Inside the chip: after it.
    expect(offsetToDomPoint(root, 10)).toEqual({ node: root, offset: 2 });
    expect(offsetToDomPoint(root, VALUE.length)).toEqual({
      node: root.childNodes[2],
      offset: 4,
    });
  });

  test("between two chips, and before a chip that opens the value", () => {
    renderTemplateValue(root, `${BODY}${ENV}`, build);

    expect(offsetToDomPoint(root, 0)).toEqual({ node: root, offset: 0 });
    expect(offsetToDomPoint(root, BODY.length)).toEqual({
      node: root,
      offset: 1,
    });
    expect(offsetToDomPoint(root, BODY.length + ENV.length)).toEqual({
      node: root,
      offset: 2,
    });
  });

  test("written and read back, the selection is the same offsets", () => {
    root.focus();

    for (const selection of [
      { start: 0, end: 0 },
      { start: 2, end: 4 },
      { start: 6, end: 6 + BODY.length },
      { start: 3, end: VALUE.length },
      { start: VALUE.length, end: VALUE.length },
    ] as Array<TemplateSelection>) {
      writeTemplateSelection(root, selection);
      expect(readTemplateSelection(root)).toEqual(selection);
    }
  });

  test("a selection outside the editor is not the editor's", () => {
    const outside: HTMLElement = document.createElement("p");
    outside.textContent = "elsewhere";
    document.body.appendChild(outside);

    const range: Range = document.createRange();
    range.selectNodeContents(outside);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);

    expect(readTemplateSelection(root)).toBeNull();

    outside.remove();
  });

  test("the chip before or after an offset", () => {
    expect(chipAtOffset(root, 6, "after")).toEqual({
      element: root.childNodes[1],
      start: 6,
      end: 6 + BODY.length,
    });
    expect(chipAtOffset(root, 6 + BODY.length, "before")).toEqual({
      element: root.childNodes[1],
      start: 6,
      end: 6 + BODY.length,
    });
    expect(chipAtOffset(root, 3, "after")).toBeNull();
    expect(chipAtOffset(root, 7 + BODY.length, "before")).toBeNull();
  });

  test("chipAncestor finds the chip a node is in", () => {
    const chip: ChildNode = root.childNodes[1]!;

    expect(chipAncestor(root, chip.firstChild!.firstChild)).toBe(chip);
    expect(chipAncestor(root, root.childNodes[0]!)).toBeNull();
    expect(chipAncestor(root, null)).toBeNull();
  });
});
