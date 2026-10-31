import { replaceHtmlMarkup } from "../../Types/HtmlMarkup";
import { decodeHtmlEntities } from "./HtmlText";
import { StartTag, TagAttribute, readStartTag } from "./MarkupReferences";

/*
 * TEXT A SPAM FILTER READS AS HIDDEN BY ITS COLOUR.
 *
 * SpamAssassin scores an email whose text it reads in a colour too close to
 * the background behind it, as spam hides words from the reader that way:
 * HTML_FONT_LOW_CONTRAST, and FONT_INVIS_MSGID beside it. The status page
 * uptime report's inbox preview line was hidden with display:none and, as
 * well, a near-white colour, and scored both - 1.7 points - in every email
 * (#5294). A preview line hidden by display:none alone scores nothing.
 *
 * This is SpamAssassin 4.0's own reading (Mail::SpamAssassin::HTML, 4.0.1:
 * text_style, close_tag, close_table_tag, name_to_rgb,
 * parse_css_background and html_font_invisible), so a guard over every
 * template sees what SpamAssassin sees, which is not what a browser draws:
 *
 *   - only body, font, table, tr, th (read as td), td, big, small,
 *     basefont, marquee, span, p, div and a change the colours; an h1's or a
 *     strong's colour is not read, and the text inside reads in the colours
 *     around it;
 *   - a colour is read from a style's color, background-color and
 *     background (the first colour of its bottom layer) - on table, tr, th,
 *     td, span, p, div and a only - and from body's text and font's color.
 *     A bgcolor attribute is read and then never used, so text on a cell
 *     coloured only by bgcolor reads on the white the email starts with;
 *   - text starts black on white; "transparent" is the colour behind;
 *   - a td or tr closes the font, td and tr still open inside the last one,
 *     and an end tag closes everything up to the element it names;
 *   - every piece of text with anything but whitespace in it is read, the
 *     hidden ones too - display:none hides nothing from this check.
 *
 * Text is too close when SpamAssassin's distance between its colour and
 * the background, the brightness-weighted one, is under 12 - the same
 * colour is 0. Its largest is 191.
 *
 * The markup is read by the walk product code reads markup with
 * (replaceHtmlMarkup) and each tag a character at a time (readStartTag),
 * never by a pattern over the HTML. Comments - Outlook's conditional ones
 * too - and what styles and scripts hold are never text, as in
 * SpamAssassin.
 */

// SpamAssassin's limit: text whose distance from its background is under it.
export const LOW_CONTRAST_DISTANCE: number = 12;

// The colours text starts in (html_start).
export const DEFAULT_TEXT_COLOR: string = "#000000";
export const DEFAULT_BACKGROUND_COLOR: string = "#ffffff";

// What name_to_rgb answers for a colour it cannot read.
export const INVALID_COLOR: string = "invalid";

export interface LowContrastText {
  // The text, its references decoded and its whitespace read as one space.
  text: string;
  // The colours SpamAssassin reads it in: "#rrggbb", or "invalid".
  textColor: string;
  backgroundColor: string;
  // SpamAssassin's distance between the two; 0 for the same colour.
  distance: number;
}

// The elements whose start and end tags change the colours (text_style).
const TEXT_STYLE_ELEMENTS: ReadonlySet<string> = new Set<string>([
  "body",
  "font",
  "table",
  "tr",
  "th",
  "td",
  "big",
  "small",
  "basefont",
  "marquee",
  "span",
  "p",
  "div",
  "a",
]);

// The attributes each of them is read for (ok_attributes); th reads as td.
const READ_ATTRIBUTES: ReadonlyMap<string, ReadonlySet<string>> = new Map<
  string,
  ReadonlySet<string>
>([
  ["basefont", new Set<string>(["color", "face", "size"])],
  [
    "body",
    new Set<string>(["text", "bgcolor", "link", "alink", "vlink", "background"]),
  ],
  ["font", new Set<string>(["color", "face", "size"])],
  ["marquee", new Set<string>(["bgcolor", "background"])],
  ["table", new Set<string>(["bgcolor", "style"])],
  ["td", new Set<string>(["bgcolor", "style"])],
  ["tr", new Set<string>(["bgcolor", "style"])],
  ["span", new Set<string>(["style"])],
  ["p", new Set<string>(["style"])],
  ["div", new Set<string>(["style"])],
  ["a", new Set<string>(["style"])],
]);

// The colour names name_to_rgb knows (%html_color), each as "#rrggbb".
const COLOR_NAMES: ReadonlyMap<string, string> = new Map<string, string>([
  ["aliceblue", "#f0f8ff"],
  ["antiquewhite", "#faebd7"],
  ["aqua", "#00ffff"],
  ["aquamarine", "#7fffd4"],
  ["azure", "#f0ffff"],
  ["beige", "#f5f5dc"],
  ["bisque", "#ffe4c4"],
  ["black", "#000000"],
  ["blanchedalmond", "#ffebcd"],
  ["blue", "#0000ff"],
  ["blueviolet", "#8a2be2"],
  ["brown", "#a52a2a"],
  ["burlywood", "#deb887"],
  ["cadetblue", "#5f9ea0"],
  ["chartreuse", "#7fff00"],
  ["chocolate", "#d2691e"],
  ["coral", "#ff7f50"],
  ["cornflowerblue", "#6495ed"],
  ["cornsilk", "#fff8dc"],
  ["crimson", "#dc143c"],
  ["cyan", "#00ffff"],
  ["darkblue", "#00008b"],
  ["darkcyan", "#008b8b"],
  ["darkgoldenrod", "#b8860b"],
  ["darkgray", "#a9a9a9"],
  ["darkgreen", "#006400"],
  ["darkgrey", "#a9a9a9"],
  ["darkkhaki", "#bdb76b"],
  ["darkmagenta", "#8b008b"],
  ["darkolivegreen", "#556b2f"],
  ["darkorange", "#ff8c00"],
  ["darkorchid", "#9932cc"],
  ["darkred", "#8b0000"],
  ["darksalmon", "#e9967a"],
  ["darkseagreen", "#8fbc8f"],
  ["darkslateblue", "#483d8b"],
  ["darkslategray", "#2f4f4f"],
  ["darkslategrey", "#2f4f4f"],
  ["darkturquoise", "#00ced1"],
  ["darkviolet", "#9400d3"],
  ["deeppink", "#ff1493"],
  ["deepskyblue", "#00bfff"],
  ["dimgray", "#696969"],
  ["dimgrey", "#696969"],
  ["dodgerblue", "#1e90ff"],
  ["firebrick", "#b22222"],
  ["floralwhite", "#fffaf0"],
  ["forestgreen", "#228b22"],
  ["fuchsia", "#ff00ff"],
  ["gainsboro", "#dcdcdc"],
  ["ghostwhite", "#f8f8ff"],
  ["gold", "#ffd700"],
  ["goldenrod", "#daa520"],
  ["gray", "#808080"],
  ["green", "#008000"],
  ["greenyellow", "#adff2f"],
  ["grey", "#808080"],
  ["honeydew", "#f0fff0"],
  ["hotpink", "#ff69b4"],
  ["indianred", "#cd5c5c"],
  ["indigo", "#4b0082"],
  ["ivory", "#fffff0"],
  ["khaki", "#f0e68c"],
  ["lavender", "#e6e6fa"],
  ["lavenderblush", "#fff0f5"],
  ["lawngreen", "#7cfc00"],
  ["lemonchiffon", "#fffacd"],
  ["lightblue", "#add8e6"],
  ["lightcoral", "#f08080"],
  ["lightcyan", "#e0ffff"],
  ["lightgoldenrodyellow", "#fafad2"],
  ["lightgray", "#d3d3d3"],
  ["lightgreen", "#90ee90"],
  ["lightgrey", "#d3d3d3"],
  ["lightpink", "#ffb6c1"],
  ["lightsalmon", "#ffa07a"],
  ["lightseagreen", "#20b2aa"],
  ["lightskyblue", "#87cefa"],
  ["lightslategray", "#778899"],
  ["lightslategrey", "#778899"],
  ["lightsteelblue", "#b0c4de"],
  ["lightyellow", "#ffffe0"],
  ["lime", "#00ff00"],
  ["limegreen", "#32cd32"],
  ["linen", "#faf0e6"],
  ["magenta", "#ff00ff"],
  ["maroon", "#800000"],
  ["mediumaquamarine", "#66cdaa"],
  ["mediumblue", "#0000cd"],
  ["mediumorchid", "#ba55d3"],
  ["mediumpurple", "#9370db"],
  ["mediumseagreen", "#3cb371"],
  ["mediumslateblue", "#7b68ee"],
  ["mediumspringgreen", "#00fa9a"],
  ["mediumturquoise", "#48d1cc"],
  ["mediumvioletred", "#c71585"],
  ["midnightblue", "#191970"],
  ["mintcream", "#f5fffa"],
  ["mistyrose", "#ffe4e1"],
  ["moccasin", "#ffe4b5"],
  ["navajowhite", "#ffdead"],
  ["navy", "#000080"],
  ["oldlace", "#fdf5e6"],
  ["olive", "#808000"],
  ["olivedrab", "#6b8e23"],
  ["orange", "#ffa500"],
  ["orangered", "#ff4500"],
  ["orchid", "#da70d6"],
  ["palegoldenrod", "#eee8aa"],
  ["palegreen", "#98fb98"],
  ["paleturquoise", "#afeeee"],
  ["palevioletred", "#db7093"],
  ["papayawhip", "#ffefd5"],
  ["peachpuff", "#ffdab9"],
  ["peru", "#cd853f"],
  ["pink", "#ffc0cb"],
  ["plum", "#dda0dd"],
  ["powderblue", "#b0e0e6"],
  ["purple", "#800080"],
  ["red", "#ff0000"],
  ["rosybrown", "#bc8f8f"],
  ["royalblue", "#4169e1"],
  ["saddlebrown", "#8b4513"],
  ["salmon", "#fa8072"],
  ["sandybrown", "#f4a460"],
  ["seagreen", "#2e8b57"],
  ["seashell", "#fff5ee"],
  ["sienna", "#a0522d"],
  ["silver", "#c0c0c0"],
  ["skyblue", "#87ceeb"],
  ["slateblue", "#6a5acd"],
  ["slategray", "#708090"],
  ["slategrey", "#708090"],
  ["snow", "#fffafa"],
  ["springgreen", "#00ff7f"],
  ["steelblue", "#4682b4"],
  ["tan", "#d2b48c"],
  ["teal", "#008080"],
  ["thistle", "#d8bfd8"],
  ["tomato", "#ff6347"],
  ["turquoise", "#40e0d0"],
  ["violet", "#ee82ee"],
  ["wheat", "#f5deb3"],
  ["white", "#ffffff"],
  ["whitesmoke", "#f5f5f5"],
  ["yellow", "#ffff00"],
  ["yellowgreen", "#9acd32"],
]);

// What a td's and a tr's start tag close first (close_table_tag).
const TD_CLOSES: ReadonlySet<string> = new Set<string>(["font", "td"]);
const TR_CLOSES: ReadonlySet<string> = new Set<string>(["font", "td", "tr"]);

// What the walk leaves where each tag was: a character no email holds.
const TAG_MARK: string = "\u{0000}";

// Whitespace as SpamAssassin reads it around text (and the no-break space).
const SPACE_CHARACTERS: ReadonlySet<string> = new Set<string>([
  " ",
  "\t",
  "\n",
  "\r",
  "\f",
  "\u{000B}",
  "\u{00A0}",
]);

const WHITESPACE_RUN: RegExp = /\s+/g;

// A basefont size SpamAssassin reads: digits, after any space.
const LEADING_DIGIT: RegExp = /^\s*\d/;

// A colour name_to_rgb reads as hex, or one with rgb() values in it.
const HEX_COLOR_CHARACTERS: RegExp = /^[#a-f0-9]*$/;
const RGB_VALUES: RegExp = /rgb\([\d%, ]*\)/i;
const RGB_PERCENTS: RegExp = /rgb\((\d+)%,\s*(\d+)%,\s*(\d+)%\s*\)/i;
const RGB_NUMBERS: RegExp = /rgb\((\d+),\s*(\d+),\s*(\d+)\s*\)/i;
const NOT_HEX_DIGIT: RegExp = /[^a-f0-9]/gi;
const NOT_DIGIT_OR_COMMA: RegExp = /[^0-9,]/g;

// A colour of three two-digit hex parts, as html_font_invisible compares two.
const RGB_HEX: RegExp = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/;

interface TextStyle {
  tag: string;
  textColor: string;
  backgroundColor: string;
}

// SpamAssassin's dec2hex: two digits at least.
const toHex: (value: number) => string = (value: number): string => {
  return value < 16 ? `0${value.toString(16)}` : value.toString(16);
};

/**
 * A colour as SpamAssassin's name_to_rgb reads it: "#rrggbb", or "invalid".
 */
export const readColor: (value: string) => string = (
  value: string,
): string => {
  let color: string = value.toLowerCase().trim();

  const named: string | undefined = COLOR_NAMES.get(color);

  if (named) {
    return named;
  }

  if (!HEX_COLOR_CHARACTERS.test(color) && !RGB_VALUES.test(color)) {
    return INVALID_COLOR;
  }

  const percents: RegExpExecArray | null = RGB_PERCENTS.exec(color);

  if (percents) {
    color =
      "#" +
      [percents[1], percents[2], percents[3]]
        .map((part: string | undefined): string => {
          return toHex(Math.floor((Number(part) / 100) * 255));
        })
        .join("");
  }

  const numbers: RegExpExecArray | null = RGB_NUMBERS.exec(color);

  if (numbers) {
    color =
      "#" +
      [numbers[1], numbers[2], numbers[3]]
        .map((part: string | undefined): string => {
          return toHex(Number(part));
        })
        .join("");
  }

  if (!color.startsWith("#")) {
    return INVALID_COLOR;
  }

  color = color.replace(NOT_HEX_DIGIT, "");

  if (color.length > 6) {
    color = color.slice(0, 6);
  }

  if (color.length > 3 && color.length < 6) {
    color = color.slice(0, 3);
  }

  if (color.length % 3 !== 0) {
    color += "0".repeat(3 - (color.length % 3));
  }

  if (color.length === 3) {
    color = color[0]! + color[0]! + color[1]! + color[1]! + color[2]! + color[2]!;
  }

  return `#${color}`;
};

// A style's color value with rgb() in it, as text_style reads one.
const readRgbValues: (value: string) => string = (value: string): string => {
  const parts: Array<string> = value
    .replace(NOT_DIGIT_OR_COMMA, "")
    .split(",");

  return (
    "#" +
    [parts[0], parts[1], parts[2]]
      .map((part: string | undefined): string => {
        const number: number = Number(part || 0) || 0;

        return toHex(Math.min(255, number));
      })
      .join("")
  );
};

/**
 * A CSS background value's layers, each its values in order - as
 * SpamAssassin's parse_css_background splits one: at spaces and commas,
 * never inside brackets or quotes.
 */
export const readBackgroundLayers: (
  background: string,
) => Array<Array<string>> = (background: string): Array<Array<string>> => {
  const layers: Array<Array<string>> = [];
  let tokens: Array<string> = [];
  const stack: Array<number> = [];
  let state: number = 0;
  let token: string = "";

  for (const character of background) {
    if (state === 0) {
      if (character === " ") {
        if (token !== "") {
          tokens.push(token);
        }

        token = "";
      } else if (character === "(") {
        token += character;
        stack.push(state);
        state = 1;
      } else if (character === '"') {
        token += character;
        stack.push(state);
        state = 2;
      } else if (character === "'") {
        token += character;
        stack.push(state);
        state = 3;
      } else if (character === ",") {
        if (token !== "") {
          tokens.push(token);
        }

        token = "";
        layers.push(tokens);
        tokens = [];
      } else {
        token += character;
      }
    } else if (state === 1) {
      token += character;

      if (character === ")") {
        tokens.push(token);
        token = "";
        state = stack.pop() || 0;
      } else if (character === '"') {
        stack.push(state);
        state = 2;
      } else if (character === "'") {
        stack.push(state);
        state = 3;
      }
    } else {
      token += character;

      if (character === (state === 2 ? '"' : "'")) {
        state = stack.pop() || 0;
      }
    }
  }

  if (token !== "") {
    tokens.push(token);
  }

  if (tokens.length > 0) {
    layers.push(tokens);
  }

  return layers;
};

// A style value without its "!important", as text_style takes it off.
const withoutImportant: (value: string) => string = (value: string): string => {
  const bang: number = value.lastIndexOf("!");

  if (bang !== -1 && value.slice(bang + 1).trim() === "important") {
    return value.slice(0, bang).trimEnd();
  }

  return value;
};

// The colours a style attribute gives an element (text_style's style part).
const readStyle: (style: string, open: TextStyle, parent: TextStyle) => void = (
  style: string,
  open: TextStyle,
  parent: TextStyle,
): void => {
  for (const part of style.split(";")) {
    const declaration: string = part.trimStart();
    const lower: string = declaration.toLowerCase();

    let property: "textColor" | "backgroundColor" | null = null;
    let rest: string = "";

    if (lower.startsWith("background-color:")) {
      property = "backgroundColor";
      rest = declaration.slice("background-color:".length);
    } else if (lower.startsWith("color:")) {
      property = "textColor";
      rest = declaration.slice("color:".length);
    }

    if (property) {
      const value: string = withoutImportant(rest.trim().toLowerCase());

      if (!value) {
        continue;
      }

      if (value.indexOf("rgb") >= 0) {
        open[property] = readRgbValues(value);
      } else if (value === "inherit") {
        // Read as the colour around it, which it already is.
      } else if (value === "transparent") {
        open[property] = value;
      } else {
        open[property] = readColor(value);
      }

      continue;
    }

    // Written in lower case only: SpamAssassin reads no other.
    if (declaration.startsWith("background:")) {
      const layers: Array<Array<string>> = readBackgroundLayers(
        declaration.slice("background:".length).trim().toLowerCase(),
      );

      for (const value of layers[layers.length - 1] || []) {
        const color: string = readColor(value);

        if (color !== INVALID_COLOR) {
          open.backgroundColor = color;
          break;
        }
      }
    }
  }

  if (open.backgroundColor === "transparent") {
    open.backgroundColor = parent.backgroundColor;
  }

  if (open.textColor === "transparent") {
    open.textColor = open.backgroundColor;
  }
};

/**
 * SpamAssassin's distance between a text colour and its background, the
 * brightness-weighted one: 0 for the same colour, null when either is not a
 * colour of three two-digit hex parts.
 */
export const colorDistance: (
  textColor: string,
  backgroundColor: string,
) => number | null = (
  textColor: string,
  backgroundColor: string,
): number | null => {
  if (textColor.slice(-6) === backgroundColor.slice(-6)) {
    return 0;
  }

  const text: RegExpExecArray | null = RGB_HEX.exec(textColor);
  const background: RegExpExecArray | null = RGB_HEX.exec(backgroundColor);

  if (!text || !background) {
    return null;
  }

  const red: number = parseInt(text[1]!, 16) - parseInt(background[1]!, 16);
  const green: number = parseInt(text[2]!, 16) - parseInt(background[2]!, 16);
  const blue: number = parseInt(text[3]!, 16) - parseInt(background[3]!, 16);

  return Math.sqrt(
    (0.2126 * red) ** 2 + (0.7152 * green) ** 2 + (0.0722 * blue) ** 2,
  );
};

const attributeValue: (
  tag: StartTag,
  name: string,
) => string | undefined = (
  tag: StartTag,
  name: string,
): string | undefined => {
  const attribute: TagAttribute | undefined = tag.attributes.find(
    (candidate: TagAttribute): boolean => {
      return candidate.name === name;
    },
  );

  return attribute === undefined
    ? undefined
    : decodeHtmlEntities(attribute.value);
};

// The name of the end tag `markup` is ("</td >" is "td").
const endTagName: (markup: string) => string = (markup: string): string => {
  let name: string = "";

  for (let index: number = 2; index < markup.length; index++) {
    const character: string = markup[index]!;

    if (character === ">" || character === "/" || character.trim() === "") {
      break;
    }

    name += character;
  }

  return name.toLowerCase();
};

// Whether a piece of text has anything but whitespace in it.
const hasWords: (text: string) => boolean = (text: string): boolean => {
  for (const character of text) {
    if (!SPACE_CHARACTERS.has(character)) {
      return true;
    }
  }

  return false;
};

/**
 * Every piece of `html`'s text that SpamAssassin reads in a colour too
 * close to its background - under LOW_CONTRAST_DISTANCE, the same colour
 * included - in order (see the top of this file). None for an email that
 * scores neither HTML_FONT_LOW_CONTRAST nor FONT_INVIS_MSGID for its text.
 */
export const lowContrastText: (html: string) => Array<LowContrastText> = (
  html: string,
): Array<LowContrastText> => {
  const tags: Array<string> = [];

  const texts: Array<string> = replaceHtmlMarkup(
    html,
    (markup: string): string => {
      tags.push(markup);
      return TAG_MARK;
    },
    { rawTextElements: true },
  ).split(TAG_MARK);

  const styles: Array<TextStyle> = [
    {
      tag: "default",
      textColor: DEFAULT_TEXT_COLOR,
      backgroundColor: DEFAULT_BACKGROUND_COLOR,
    },
  ];
  const found: Array<LowContrastText> = [];

  /*
   * How many elements of each name are open, so that whether one is open
   * is read at once rather than by a walk down the stack: an email of
   * thousands of elements left open is read in time in line with it.
   */
  const openCounts: Map<string, number> = new Map<string, number>([
    ["default", 1],
  ]);

  const current: () => TextStyle = (): TextStyle => {
    return styles[styles.length - 1]!;
  };

  const isOpen: (name: string) => boolean = (name: string): boolean => {
    return (openCounts.get(name) || 0) > 0;
  };

  const push: (style: TextStyle) => void = (style: TextStyle): void => {
    styles.push(style);
    openCounts.set(style.tag, (openCounts.get(style.tag) || 0) + 1);
  };

  const pop: () => TextStyle = (): TextStyle => {
    const closed: TextStyle = styles.pop()!;

    openCounts.set(closed.tag, (openCounts.get(closed.tag) || 1) - 1);

    return closed;
  };

  // close_tag: everything up to and including the last element of the name.
  const close: (name: string) => void = (name: string): void => {
    if (!isOpen(name)) {
      return;
    }

    while (styles.length > 0) {
      if (pop().tag === name) {
        break;
      }
    }
  };

  // close_table_tag: a td or tr closes the font, td and tr open in the last one.
  const closeTableCell: (name: string) => void = (name: string): void => {
    if (!isOpen(name)) {
      return;
    }

    const closes: ReadonlySet<string> =
      name === "td" ? TD_CLOSES : TR_CLOSES;

    while (styles.length > 0 && closes.has(current().tag)) {
      pop();
    }
  };

  for (let index: number = 0; index < texts.length; index++) {
    const text: string = decodeHtmlEntities(texts[index]!);

    if (hasWords(text)) {
      const style: TextStyle = current();
      const distance: number | null = colorDistance(
        style.textColor,
        style.backgroundColor,
      );

      if (distance !== null && distance < LOW_CONTRAST_DISTANCE) {
        found.push({
          text: text.replace(WHITESPACE_RUN, " ").trim(),
          textColor: style.textColor,
          backgroundColor: style.backgroundColor,
          distance: distance,
        });
      }
    }

    const markup: string | undefined = tags[index];

    if (markup === undefined || markup.startsWith("<!")) {
      // The end, a comment, or a doctype: no colour changes.
      continue;
    }

    if (markup.startsWith("</")) {
      const name: string = endTagName(markup);
      const element: string = name === "th" ? "td" : name;

      if (TEXT_STYLE_ELEMENTS.has(name) && element !== "body") {
        close(element);
      }

      continue;
    }

    const tag: StartTag = readStartTag(markup);

    if (!TEXT_STYLE_ELEMENTS.has(tag.name)) {
      continue;
    }

    const element: string = tag.name === "th" ? "td" : tag.name;

    // A basefont with a size changes only the size.
    if (
      element === "basefont" &&
      LEADING_DIGIT.test(attributeValue(tag, "size") || "")
    ) {
      continue;
    }

    if (element === "td" || element === "tr") {
      closeTableCell(element);
    }

    const parent: TextStyle = current();
    const open: TextStyle = {
      tag: element,
      textColor: parent.textColor,
      backgroundColor: parent.backgroundColor,
    };

    if (element !== "big" && element !== "small") {
      const read: ReadonlySet<string> =
        READ_ATTRIBUTES.get(element) || new Set<string>();

      for (const attribute of tag.attributes) {
        if (!read.has(attribute.name)) {
          continue;
        }

        const value: string = decodeHtmlEntities(attribute.value);

        if (attribute.name === "text" || attribute.name === "color") {
          open.textColor = readColor(value);
        } else if (attribute.name === "style") {
          readStyle(value, open, parent);
        }
      }
    }

    push(open);
  }

  return found;
};
