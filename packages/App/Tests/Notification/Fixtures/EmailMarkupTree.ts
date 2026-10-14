import { replaceHtmlMarkup } from "Common/Types/HtmlMarkup";

/*
 * A rendered email read as a tree of elements, for the tests that check how
 * an email is laid out rather than what it says: which rows a detail card
 * has, and where a divider sits in the box around it.
 *
 * The markup is found by the walk product code reads markup with
 * (replaceHtmlMarkup, Common/Types/HtmlMarkup), never by a pattern over the
 * HTML: each tag and comment is replaced by a mark no email holds, and the
 * text between two marks is the text between two tags. A tag's name and
 * attributes are read a character at a time. <style> and <script> are read
 * whole, so the CSS in an email's <style> block is never taken for text.
 *
 * Elements close at their end tag. An end tag closes the nearest open
 * element of its name, and an end tag nothing opened is noted rather than
 * guessed at; so are elements the email never closes. The emails' markup is
 * written to close every element itself, so a test can hold it to that.
 */

export interface EmailElement {
  kind: "element";
  // The tag name, in lower case.
  name: string;
  // Attribute names in lower case; values as written, entities included.
  attributes: Record<string, string>;
  children: Array<EmailNode>;
  parent: EmailElement | null;
}

export interface EmailText {
  kind: "text";
  text: string;
  parent: EmailElement;
}

export type EmailNode = EmailElement | EmailText;

export interface EmailMarkupTree {
  // A root element (name "#document") holding everything the email has.
  root: EmailElement;
  // End tags that closed nothing, as written.
  unmatchedEndTags: Array<string>;
  // Elements still open at the end of the email.
  unclosedElements: Array<string>;
}

// What each tag and comment becomes while the walk runs: a private-use mark.
const MARK: string = String.fromCharCode(0xe0ff);

const VOID_ELEMENTS: ReadonlySet<string> = new Set<string>([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

// Elements replaceHtmlMarkup hands over whole: never shown, never text.
const HIDDEN_WHOLE_ELEMENTS: ReadonlySet<string> = new Set<string>([
  "style",
  "script",
  "iframe",
  "noembed",
  "noframes",
]);

type IsNameEndFunction = (character: string) => boolean;

// Where a tag or attribute name ends, as a browser reads one.
const isNameEnd: IsNameEndFunction = (character: string): boolean => {
  return (
    character === " " ||
    character === "\t" ||
    character === "\n" ||
    character === "\r" ||
    character === "\f" ||
    character === "/" ||
    character === ">" ||
    character === "="
  );
};

type IsSpaceFunction = (character: string) => boolean;

const isSpace: IsSpaceFunction = (character: string): boolean => {
  return (
    character === " " ||
    character === "\t" ||
    character === "\n" ||
    character === "\r" ||
    character === "\f"
  );
};

interface StartTag {
  name: string;
  attributes: Record<string, string>;
  selfClosing: boolean;
}

type ReadStartTagFunction = (markup: string) => StartTag;

// A start tag's name and attributes, read a character at a time.
const readStartTag: ReadStartTagFunction = (markup: string): StartTag => {
  let index: number = 1;
  let name: string = "";

  while (index < markup.length && !isNameEnd(markup[index]!)) {
    name += markup[index];
    index++;
  }

  const attributes: Record<string, string> = {};
  // The last character before the closing ">" that is not whitespace.
  let lastIndex: number = markup.length - 2;

  while (lastIndex > index && isSpace(markup[lastIndex]!)) {
    lastIndex--;
  }

  const selfClosing: boolean = markup[lastIndex] === "/";

  while (index < markup.length - 1) {
    const character: string = markup[index]!;

    if (isSpace(character) || character === "/") {
      index++;
      continue;
    }

    let attributeName: string = "";

    while (index < markup.length - 1 && !isNameEnd(markup[index]!)) {
      attributeName += markup[index];
      index++;
    }

    while (index < markup.length - 1 && isSpace(markup[index]!)) {
      index++;
    }

    let value: string = "";

    if (markup[index] === "=") {
      index++;

      while (index < markup.length - 1 && isSpace(markup[index]!)) {
        index++;
      }

      const quote: string = markup[index]!;

      if (quote === '"' || quote === "'") {
        const end: number = markup.indexOf(quote, index + 1);
        const valueEnd: number = end === -1 ? markup.length - 1 : end;

        value = markup.slice(index + 1, valueEnd);
        index = valueEnd + 1;
      } else {
        while (
          index < markup.length - 1 &&
          !isSpace(markup[index]!) &&
          markup[index] !== ">"
        ) {
          value += markup[index];
          index++;
        }
      }
    }

    if (attributeName) {
      attributes[attributeName.toLowerCase()] = value;
    } else {
      // Nothing a name can start with: step past it.
      index++;
    }
  }

  return {
    name: name.toLowerCase(),
    attributes: attributes,
    selfClosing: selfClosing,
  };
};

type EndTagNameFunction = (markup: string) => string;

// An end tag's name, in lower case.
const endTagName: EndTagNameFunction = (markup: string): string => {
  let index: number = 2;
  let name: string = "";

  while (index < markup.length && !isNameEnd(markup[index]!)) {
    name += markup[index];
    index++;
  }

  return name.toLowerCase();
};

type ReadEmailMarkupFunction = (html: string) => EmailMarkupTree;

export const readEmailMarkup: ReadEmailMarkupFunction = (
  html: string,
): EmailMarkupTree => {
  if (html.indexOf(MARK) !== -1) {
    throw new Error("The email already holds the mark its tags are read by");
  }

  const markups: Array<string> = [];
  const texts: Array<string> = replaceHtmlMarkup(
    html,
    (markup: string): string => {
      markups.push(markup);
      return MARK;
    },
    { rawTextElements: true },
  ).split(MARK);

  const root: EmailElement = {
    kind: "element",
    name: "#document",
    attributes: {},
    children: [],
    parent: null,
  };
  const open: Array<EmailElement> = [root];
  const unmatchedEndTags: Array<string> = [];

  const current: () => EmailElement = (): EmailElement => {
    return open[open.length - 1]!;
  };

  const addText: (text: string) => void = (text: string): void => {
    if (text) {
      current().children.push({
        kind: "text",
        text: text,
        parent: current(),
      });
    }
  };

  addText(texts[0] || "");

  markups.forEach((markup: string, index: number): void => {
    if (markup.startsWith("<!") || markup.startsWith("<?")) {
      // A comment, the doctype or a processing instruction.
    } else if (markup.startsWith("</")) {
      const name: string = endTagName(markup);
      let at: number = open.length - 1;

      while (at > 0 && open[at]!.name !== name) {
        at--;
      }

      if (at > 0) {
        open.length = at;
      } else {
        unmatchedEndTags.push(markup);
      }
    } else {
      const tag: StartTag = readStartTag(markup);

      if (!HIDDEN_WHOLE_ELEMENTS.has(tag.name)) {
        const element: EmailElement = {
          kind: "element",
          name: tag.name,
          attributes: tag.attributes,
          children: [],
          parent: current(),
        };

        current().children.push(element);

        if (!tag.selfClosing && !VOID_ELEMENTS.has(tag.name)) {
          open.push(element);
        }
      }
    }

    addText(texts[index + 1] || "");
  });

  return {
    root: root,
    unmatchedEndTags: unmatchedEndTags,
    unclosedElements: open.slice(1).map((element: EmailElement): string => {
      return element.name;
    }),
  };
};

type ElementsFunction = (
  element: EmailElement,
  matches: (candidate: EmailElement) => boolean,
) => Array<EmailElement>;

// Every element under `element`, in document order, that `matches` keeps.
export const findElements: ElementsFunction = (
  element: EmailElement,
  matches: (candidate: EmailElement) => boolean,
): Array<EmailElement> => {
  const found: Array<EmailElement> = [];

  const visit: (node: EmailElement) => void = (node: EmailElement): void => {
    for (const child of node.children) {
      if (child.kind === "element") {
        if (matches(child)) {
          found.push(child);
        }

        visit(child);
      }
    }
  };

  visit(element);

  return found;
};

type ChildElementsFunction = (element: EmailElement) => Array<EmailElement>;

// The element children of `element`, without its text.
export const childElements: ChildElementsFunction = (
  element: EmailElement,
): Array<EmailElement> => {
  return element.children.filter((child: EmailNode): boolean => {
    return child.kind === "element";
  }) as Array<EmailElement>;
};

type HasClassFunction = (element: EmailElement, className: string) => boolean;

// Whether the element's class attribute names `className`.
export const hasClass: HasClassFunction = (
  element: EmailElement,
  className: string,
): boolean => {
  return (element.attributes["class"] || "")
    .split(" ")
    .filter((name: string): boolean => {
      return name.length > 0;
    })
    .includes(className);
};

type InlineStyleFunction = (element: EmailElement) => Map<string, string>;

/*
 * The element's inline style as property -> value, properties in lower
 * case, the last declaration of a property winning as in a browser. Read a
 * declaration at a time; the emails write no ";" inside a value.
 */
export const inlineStyle: InlineStyleFunction = (
  element: EmailElement,
): Map<string, string> => {
  const declarations: Map<string, string> = new Map<string, string>();

  for (const declaration of (element.attributes["style"] || "").split(";")) {
    const colon: number = declaration.indexOf(":");

    if (colon === -1) {
      continue;
    }

    const property: string = declaration.slice(0, colon).trim().toLowerCase();
    const value: string = declaration.slice(colon + 1).trim();

    if (property) {
      declarations.set(property, value);
    }
  }

  return declarations;
};

type TextOfFunction = (element: EmailElement) => string;

// All the text under `element`, as written (entities included).
export const textOf: TextOfFunction = (element: EmailElement): string => {
  return element.children
    .map((child: EmailNode): string => {
      return child.kind === "text" ? child.text : textOf(child);
    })
    .join("");
};
