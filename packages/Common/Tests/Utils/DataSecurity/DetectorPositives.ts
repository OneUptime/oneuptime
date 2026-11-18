import { DataTypeDetector } from "../../../Utils/DataSecurity/Detector";
import { expandBackReferences } from "../../../Utils/DataSecurity/DetectorPrefilter";
import CharacterSet from "../../../Utils/LinearRegExp/CharacterSet";
import { parsePattern } from "../../../Utils/LinearRegExp/Parser";
import { SyntaxNode } from "../../../Utils/LinearRegExp/Syntax";
import { SeededRandom } from "../../Helpers/SeededRandom";

/*
 * TEXTS A DETECTOR'S OWN PATTERN FINDS A CANDIDATE IN.
 *
 * For holding the database prefilters (DetectorPrefilter) to the detectors
 * they stand for, in JavaScript and in a real ClickHouse: texts drawn at
 * random from a detector's pattern - its back-references copied, its
 * look-aheads and look-behinds drawn where they ask for text - put in a few
 * contexts, and kept only where the pattern itself matches.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

const PREFERRED: string =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

const CONTEXTS: ReadonlyArray<[string, string]> = [
  ["", ""],
  ["user=", " status=ok"],
  ["The value is ", "."],
  ['{"field":"', '"}'],
  ["token: ", "\n"],
];

function charactersOf(
  set: CharacterSet,
  negate: boolean,
  random: SeededRandom,
): Array<string> {
  const has: (code: number) => boolean = (code: number): boolean => {
    return set.has(code) !== negate;
  };
  const preferred: Array<string> = PREFERRED.split("").filter(
    (character: string): boolean => {
      return has(character.charCodeAt(0));
    },
  );

  if (preferred.length > 0 && random(4) > 0) {
    return preferred;
  }

  const printable: Array<string> = [];

  for (let code: number = 0x20; code < 0x7f; code++) {
    if (has(code)) {
      printable.push(String.fromCharCode(code));
    }
  }

  // A space JavaScript's \s knows and RE2's does not, now and then.
  for (const code of [0xa0, 0x2003, 0x3000]) {
    if (has(code)) {
      printable.push(String.fromCharCode(code));
    }
  }

  return printable.length > 0 ? printable : preferred;
}

// A text the node could match: each choice drawn at random.
export function drawFrom(node: SyntaxNode, random: SeededRandom): string {
  switch (node.kind) {
    case "Character":
      return String.fromCharCode(node.codeUnit);
    case "Set": {
      const characters: Array<string> = charactersOf(
        node.set,
        node.negate,
        random,
      );

      return characters.length > 0
        ? characters[random(characters.length)]!
        : "";
    }
    case "Group":
      return drawFrom(node.body, random);
    case "Repeat": {
      const most: number = Number.isFinite(node.max)
        ? Math.min(node.max, node.min + 6)
        : node.min + 6;
      const times: number = node.min + random(most - node.min + 1);
      let text: string = "";

      for (let index: number = 0; index < times; index++) {
        text += drawFrom(node.body, random);
      }

      return text;
    }
    case "Alternation":
      return drawFrom(node.options[random(node.options.length)]!, random);
    case "Sequence":
      return node.items
        .map((item: SyntaxNode): string => {
          return drawFrom(item, random);
        })
        .join("");
    case "Lookaround":
      /*
       * What must come before or after - a card code's "cvv: ", a private
       * key's body after its header - is drawn too.
       */
      return node.negate ? "" : drawFrom(node.body, random);
    default:
      return "";
  }
}

export function positivesOf(
  detector: DataTypeDetector,
  count: number,
  random: SeededRandom,
): Array<string> {
  const pattern: RegExp = new RegExp(
    detector.pattern.source,
    detector.pattern.flags.replace("g", ""),
  );
  const root: SyntaxNode = parsePattern(
    expandBackReferences(detector.pattern.source),
    {
      ignoreCase: detector.pattern.flags.includes("i"),
      multiline: detector.pattern.flags.includes("m"),
      dotAll: detector.pattern.flags.includes("s"),
    },
  ).root;
  const texts: Array<string> = [];

  for (let attempt: number = 0; attempt < count * 8; attempt++) {
    if (texts.length >= count) {
      break;
    }

    const [before, after] = CONTEXTS[attempt % CONTEXTS.length]!;
    const text: string = before + drawFrom(root, random) + after;

    if (pattern.test(text)) {
      texts.push(text);
    }
  }

  return texts;
}
