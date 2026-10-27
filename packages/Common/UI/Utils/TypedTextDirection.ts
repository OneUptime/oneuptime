/*
 * TEXT BEING TYPED READS THE WAY IT IS WRITTEN.
 *
 * What someone types into a field is in their language, whatever the
 * page's: on a Persian page an English name or URL, typed into a field
 * laid out from the right, put its full stop, its brackets and its slashes
 * at the wrong end ("Watches the checkout endpoint." came out as
 * ".Watches the checkout endpoint"), and a Persian note did the same on an
 * English page. With unicode-bidi: plaintext each line of a field reads,
 * and starts on the side of, its own first letter, as a browser reads
 * dir="auto" - so the line never turns round mid-word as it is typed.
 *
 * A field showing its placeholder reads the page's way: Firefox laid the
 * placeholder of a right-to-left field with plaintext out from the field's
 * far edge, out of sight.
 *
 * Every text field (Input, TextArea) and the Markdown editor's source
 * carry it; a left-to-right page typing left-to-right text looks as it
 * always did.
 */
export const TYPED_TEXT_READS_ITS_OWN_WAY_CLASS_NAME: string =
  "[unicode-bidi:plaintext] placeholder-shown:[unicode-bidi:normal]";
