/*
 * A card Ask AI leaves under an answer says each fact once.
 *
 * Its heading names the record ("#42 · Payment API down", "ALT-12 · High
 * memory usage on test01") and its subheading a line about it ("Severity:
 * High", "Incident #42"). The facts under them used to say both again:
 * Number #42 under a heading that starts with #42, Severity High under
 * "Severity: High" - lines that told the reader nothing the two lines
 * above had not. A fact the heading or the subheading already says is left
 * out; every other fact stays, in its order.
 *
 * Only exact repeats count: a value is said when it is the whole line, one
 * of its parts ("#42" in "#42 · Payment API down"), or - for the
 * subheading - the fact itself written as a line ("Severity: High",
 * "Incident #42"). Never a word inside a title or a description: an alert
 * titled "Memory is high" does not say its severity is High.
 *
 * Applied where a card is built (WidgetBuilder.resourceCard, for every
 * write tool at once), where it is drawn (ResourceCardWidget, so a card
 * saved in an older conversation reads the same) and where a conversation
 * is exported (ChatWidgetMarkdown).
 */

export interface ResourceCardFact {
  label: string;
  value: string;
}

// The separator a card's heading puts between its parts ("#42 · Title").
const LINE_PART_SEPARATOR: string = " · ";

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

// The line and its parts, each as it is compared.
function getComparableParts(line: string): Array<string> {
  const shownLine: string = normalize(line);

  if (!shownLine) {
    return [];
  }

  return [
    shownLine,
    ...shownLine.split(LINE_PART_SEPARATOR).map((part: string): string => {
      return part.trim();
    }),
  ];
}

/*
 * Whether the heading already says this value: the value is the heading,
 * or one of its parts.
 */
export function isFactSaidByHeading(value: string, heading: string): boolean {
  const shownValue: string = normalize(value);

  return (
    shownValue.length > 0 && getComparableParts(heading).includes(shownValue)
  );
}

/*
 * Whether the subheading already says this fact: its value is the line or
 * one of its parts, or the line is the fact itself ("Severity: High",
 * "Incident #42").
 */
export function isFactSaidBySubheading(
  fact: ResourceCardFact,
  subheading: string,
): boolean {
  const shownValue: string = normalize(fact.value || "");
  const shownLabel: string = normalize(fact.label || "");

  if (!shownValue) {
    return false;
  }

  const parts: Array<string> = getComparableParts(subheading);

  return (
    parts.includes(shownValue) ||
    (shownLabel.length > 0 &&
      (parts.includes(`${shownLabel}: ${shownValue}`) ||
        parts.includes(`${shownLabel} ${shownValue}`)))
  );
}

/*
 * The facts a card draws: those its heading and subheading do not already
 * say.
 */
export function getFactsNotInHeading(card: {
  heading?: string | undefined;
  subheading?: string | undefined;
  fields?: Array<ResourceCardFact> | undefined;
}): Array<ResourceCardFact> {
  return (card.fields || []).filter((field: ResourceCardFact): boolean => {
    return !(
      isFactSaidByHeading(field.value || "", card.heading || "") ||
      isFactSaidBySubheading(field, card.subheading || "")
    );
  });
}
