import { Lexer, Links, Tokenizer, Tokens } from "marked";

/*
 * WHAT MARKED READS OF A TEXT'S LINK REFERENCE DEFINITIONS, AND WHAT ITS
 * REFERENCES LOOK UP.
 *
 * marked 12 renders an email: the definitions it reads, by label, and the
 * labels its references look up are what the email renderer's own reading
 * of definitions (Utils/Markdown/LinkReferenceDefinitions) and an email
 * field cut to fit (Markdown.cutEmailMarkdown, #6963) are held to.
 *
 *   const read: MarkedReferences = readMarkedReferences(text);
 *
 *   read.links;    // the definitions marked reads, by label
 *   read.lookedUp; // every label a reference looked up, defined or not
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

// What marked reads: its definitions, by label.
export const markedLinks: (text: string) => Links = (text: string): Links => {
  return new Lexer({ gfm: true }).lex(text).links;
};

/*
 * A tokenizer that notes every label marked looks a reference up by
 * (`reflink`): what a text's references need of its definitions.
 */
class LookUpNotingTokenizer extends Tokenizer {
  public readonly lookedUp: Set<string> = new Set<string>();

  public override reflink(
    src: string,
    links: Links,
  ): Tokens.Link | Tokens.Image | Tokens.Text | undefined {
    const noting: Links = new Proxy(links, {
      get: (target: Links, key: string | symbol, receiver: unknown) => {
        if (typeof key === "string") {
          this.lookedUp.add(key);
        }

        return Reflect.get(target, key, receiver);
      },
    });

    return super.reflink(src, noting);
  }
}

export interface MarkedReferences {
  // The definitions marked reads, by label.
  links: Links;
  // Every label a reference looked up, in the order looked up.
  lookedUp: Array<string>;
}

// What marked reads of `text`: its definitions, and what its references look up.
export const readMarkedReferences: (text: string) => MarkedReferences = (
  text: string,
): MarkedReferences => {
  const tokenizer: LookUpNotingTokenizer = new LookUpNotingTokenizer();
  const links: Links = new Lexer({ gfm: true, tokenizer: tokenizer }).lex(
    text,
  ).links;

  return { links: links, lookedUp: Array.from(tokenizer.lookedUp) };
};

// Whether marked reads a definition of `label` in `links`.
export const isDefined: (links: Links, label: string) => boolean = (
  links: Links,
  label: string,
): boolean => {
  return Object.prototype.hasOwnProperty.call(links, label);
};
