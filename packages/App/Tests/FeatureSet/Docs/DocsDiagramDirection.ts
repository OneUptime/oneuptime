import { DocsFence, scanMarkdown } from "./DocsContentSupport";
import { diagramLabelLines } from "./DocsTranslationChecks";

/*
 * Which lines of a page's diagrams a right-to-left reader would meet back to
 * front.
 *
 * The docs lay each line of a diagram's label, and a diagram's title, out in
 * the direction of its first letter: the docs' style.css gives them
 * `unicode-bidi: plaintext` (held by RightToLeftDocsLayout). So a Persian
 * line that opens with a Latin word ("OTLP به", OTLP to) is laid out left to
 * right and read from its last word. A line of Latin words only reads left
 * to right, as it should, and so does an English page.
 *
 * The Cloud pages (docs task 23) found it; the AI tooling and security
 * pages (task 24b) hold their Persian diagrams to it too. A suite imports it
 * from here rather than copying it.
 */

// A letter of a script written right to left: Persian's (Arabic), Hebrew.
const RIGHT_TO_LEFT_LETTER: RegExp = /[\p{Script=Arabic}\p{Script=Hebrew}]/u;
const LETTER: RegExp = /\p{L}/u;
const DIAGRAM_TITLE_TEXT: RegExp = /\btitle="([^"]+)"/;
// A state diagram's transition and its label: "Reporting --> Archived: 7 days".
const STATE_TRANSITION_LABEL: RegExp = /-->\s*[^\s:]+\s*:(.*)$/;
const LABEL_BREAK: string = "<br/>";

/*
 * The lines of a page's diagrams, their titles and state transitions'
 * labels included, that hold right-to-left letters but start with a Latin
 * one.
 */
export function linesLaidOutBackwards(markdown: string): Array<string> {
  return scanMarkdown(markdown)
    .fences.filter((fence: DocsFence): boolean => {
      return fence.lang === "mermaid";
    })
    .flatMap((fence: DocsFence): Array<string> => {
      const title: string | undefined =
        fence.info.match(DIAGRAM_TITLE_TEXT)?.[1];
      const isStateDiagram: boolean = fence.code
        .trimStart()
        .startsWith("stateDiagram");
      const transitions: Array<string> = isStateDiagram
        ? fence.code.split("\n").flatMap((line: string): Array<string> => {
            const label: string | undefined = line.match(
              STATE_TRANSITION_LABEL,
            )?.[1];

            return label === undefined ? [] : label.trim().split(LABEL_BREAK);
          })
        : [];

      return [
        ...(title === undefined ? [] : [title]),
        ...diagramLabelLines(fence.code),
        ...transitions,
      ];
    })
    .filter((line: string): boolean => {
      const first: string | undefined = line.match(LETTER)?.[0];

      return (
        first !== undefined &&
        RIGHT_TO_LEFT_LETTER.test(line) &&
        !RIGHT_TO_LEFT_LETTER.test(first)
      );
    });
}
