/*
 * A TEMPLATE'S OWN WORDS, READ THE WAY THEY ARE WRITTEN.
 *
 * A template's name, its description and the help of what it asks for are
 * catalog content, written in English whatever the page's language. Laid
 * out right to left on a Persian page, an English sentence put its full
 * stop at its start (".and resolves the incident when the problem
 * recovers"), and a row cut to one line lost its start instead of its end
 * ("…abbix problem when the incident is acknowledged"). So each such text
 * is laid out by its own first letter (dir="auto") - left to right for
 * English, its full stop at its end and a cut line cut at its end - and
 * still lines up where the page's lines start: on the left, or on the
 * right on a Persian page, as a data store's name does
 * (DataSecurity/StoreNameCell).
 */

// Put beside dir="auto" on an element that holds a template's own words.
export const CATALOG_TEXT_ALIGN_CLASS_NAME: string =
  "[text-align:left] rtl:[text-align:right]";
