/*
 * The texts removeHtmlMarkup (Common/Types/HtmlMarkup) is held to in
 * HtmlMarkup.test.ts, for the suites of the readers that must read markup
 * exactly as it does: the OAuth error excerpt (which reads through it) and
 * the Dynamics 365 note template, whose script runs in the workflow sandbox
 * and so carries its own copy of the walk.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

// A small seeded generator, so the generated cases are the same every run.
export type SeededRandomFunction = (seed: number) => (limit: number) => number;

export const seededRandom: SeededRandomFunction = (
  seed: number,
): ((limit: number) => number) => {
  let state: number = seed;

  return (limit: number): number => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state % limit;
  };
};

// The characters markup is made of, and some that are not.
export const MARKUP_ALPHABET: ReadonlyArray<string> = [
  "<",
  ">",
  "!",
  "-",
  "=",
  '"',
  "'",
  "/",
  "?",
  " ",
  "\n",
  "s",
  "c",
  "r",
  "i",
  "p",
  "t",
  "a",
  "b",
  "é",
  "語",
  "😀",
  "&",
  ";",
];

export type GeneratedTextsFunction = (
  count: number,
  seed: number,
  alphabet?: ReadonlyArray<string>,
) => Array<string>;

// Texts of up to 27 characters drawn from the alphabet.
export const generatedTexts: GeneratedTextsFunction = (
  count: number,
  seed: number,
  alphabet: ReadonlyArray<string> = MARKUP_ALPHABET,
): Array<string> => {
  const random: (limit: number) => number = seededRandom(seed);
  const texts: Array<string> = [];

  for (let index: number = 0; index < count; index++) {
    let text: string = "";
    const length: number = random(28);

    for (let position: number = 0; position < length; position++) {
      text += alphabet[random(alphabet.length)];
    }

    texts.push(text);
  }

  return texts;
};

/*
 * Markup a single pass of /<[^>]*>/ leaves behind, or ends in the wrong
 * place: a tag inside a tag's name, overlapping and unclosed comments and
 * tags, a quoted attribute value holding ">" or a whole tag, tags that only
 * join once one between them is out.
 */
export const SINGLE_PASS_LEFTOVERS: ReadonlyArray<string> = [
  "<scr<script>ipt>",
  "<!<!---->--",
  "<<script>script>alert(1)",
  "<script<script>>alert(1)",
  "hello <script",
  "<b>bold</b> then <img src=x onerror=alert(1)",
  "<<<<",
  "a < b <c",
  "a<!-- x > <script>y</script> -->b",
  "a<!-- never closed",
  '<img alt="<script>" src=x>after',
  "<scr<!-- -->ipt>x",
  '<a title="a > b">link</a> after',
  "<img alt='1 > 0'>after",
  "<a title = \"x>y\" class='p>q'>z</a>",
  `<a title="it's > 1">x</a>`,
  '<a title="<b>">x</a>',
  "<a title=a>b>c",
  '<a b"c>d"',
  '<a title="x>y and more',
  '<a title="x>y and <b>bold</b> <i>it</i>',
  '<p>text <img src="x <!-- note --> <b>b</b>',
  "<b>a</b><c d=\"e>f <b>g</b> <h i='j>k'>l",
];

/*
 * Well-formed markup, as a renderer, an editor or a chat client writes it:
 * tags, attributes, comments, declarations - read the same by any walk.
 */
export const WELL_FORMED_MARKUP: ReadonlyArray<string> = [
  "",
  "Restarted the primary DB",
  "p99 > 2 s pages someone; a --> b",
  "Tom &amp; Jerry &lt;b&gt; &#39;quoted&#39; &nbsp;",
  "<p>Restarted the primary DB</p>",
  "<p>Do <strong><em>this</em></strong> first.</p>",
  "<b>a</b><i>b</i>one<br>two<br/>three<hr />",
  "<></>",
  "<P>Upper</P><BR>",
  '<a\n  href="/docs/a_b"\n  class="x">link</a>',
  '<a class="docs-link" href="/docs/a_b" data-x=\'1\'>guide</a>',
  '<div><at id="0">Jane</at> <span style="color:red">Sev 1</span></div>',
  '<?xml version="1.0"?><!DOCTYPE html>text',
  "a<!-- a note -->b",
  "a<!--\n<b>x</b>\n-->b",
  "a<!-->b<!--->c<!---->d",
  " <b> a </b> ",
  "<p>one</p>\n<p>two  words</p>\n",
  "<p>use &lt;script&gt; &amp; &quot;quotes&quot;</p>",
];
