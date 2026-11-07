/*
 * A record page's heading by its title and its record's name: "Network
 * Device - sw-core-01". One sentence, so a language could word it its own
 * way; it has no words of its own, so every language takes the reader's
 * title (Translator's letterless templates).
 *
 * ModelPage writes the heading's text with it (the browser tab's fallback),
 * and Page draws it with the name set apart (Page's recordTitle). Kept in a
 * module of its own: tests that stand Page in with a stub still give
 * ModelPage the sentence.
 */
export const PAGE_RECORD_TITLE_SENTENCE: string = "{{title}} - {{name}}";
