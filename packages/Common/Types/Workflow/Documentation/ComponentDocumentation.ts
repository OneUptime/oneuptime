/*
 * The help a workflow step's settings dialog shows under "How to use".
 *
 * It replaces one Markdown file per family of steps, fetched from the server
 * and rendered as a manual: a heading and a paragraph per topic, the same text
 * for Create One Incident as for Create One Monitor, with nothing in it about
 * the step that was actually open. The feedback on it was that it should be
 * "made simpler to understand and use", so the shape below is the whole
 * format, and every step's help is written to it:
 *
 *   - summary   one sentence: what the step does.
 *   - steps     how to use it, in order, two to four short lines.
 *   - examples  something concrete to copy, built from this step's own
 *               identifier and the workflow it sits in.
 *   - notes     the gotchas, one or two sentences each, shown as callouts.
 *   - learnMore everything longer, collapsed until asked for.
 *   - links     where the full guide is.
 *
 * Text takes three pieces of inline markup and nothing else (see
 * DocumentationText.ts):
 *
 *   **Name**               a setting, port, value or button, by the name the
 *                          dialog shows. ComponentDocumentation.test.ts checks
 *                          every one of these against the step it is about.
 *   `literal`              something to type or copy exactly.
 *   [label](https://...)   a link out of the product.
 */

export enum ComponentDocumentationNoteType {
  /** Worth knowing; nothing breaks if it is missed. */
  Tip = "Tip",
  /** Something that goes wrong, or cannot be undone, if it is missed. */
  Warning = "Warning",
}

export interface ComponentDocumentationNote {
  type: ComponentDocumentationNoteType;
  text: string;
}

/** One setting of an example that fills in several of them. */
export interface ComponentDocumentationField {
  /** The setting's name, exactly as the form labels it. */
  name: string;
  value: string;
}

export interface ComponentDocumentationExample {
  /** What the example shows, as a short label above it. */
  title: string;
  /** Text to type or paste. The example's Copy button copies exactly this. */
  code?: string | undefined;
  /** The settings to fill in, for an example that is more than one value. */
  fields?: Array<ComponentDocumentationField> | undefined;
  /** One line under the example. */
  description?: string | undefined;
}

/** A topic under "Learn more": the longer explanation of one thing. */
export interface ComponentDocumentationTopic {
  title: string;
  paragraphs: Array<string>;
  example?: ComponentDocumentationExample | undefined;
}

export enum ComponentDocumentationLinkSite {
  /** A page of OneUptime's docs. The path is under /docs. */
  Docs = "Docs",
  /** OneUptime's API reference. The path is under the reference's root. */
  APIReference = "APIReference",
  /** Anywhere else. The path is a full https URL. */
  External = "External",
}

export interface ComponentDocumentationLink {
  title: string;
  site: ComponentDocumentationLinkSite;
  /*
   * "/workflows/triggers#webhook" on the docs, "/incident" on the API
   * reference, "https://api.slack.com/messaging/webhooks" elsewhere.
   */
  path: string;
}

export default interface ComponentDocumentation {
  summary: string;
  steps: Array<string>;
  examples: Array<ComponentDocumentationExample>;
  notes: Array<ComponentDocumentationNote>;
  learnMore: Array<ComponentDocumentationTopic>;
  links: Array<ComponentDocumentationLink>;
}
