import ColumnLength from "../Database/ColumnLength";

/*
 * How long a detection rule's name may be: the width of DetectionRule.name
 * (a ShortText column). SecurityTemplatesCreatable holds the two together.
 *
 * A rule is named after its Sigma title wherever OneUptime names it - the
 * Rule Library, the rule form as the YAML is typed or drafted, the server
 * when a create names none - and Sigma allows a title of up to 256
 * characters. 100 holds every title of the library and all but two of
 * SigmaHQ's 3,302 (the longest is 103), as Microsoft Sentinel holds a rule's
 * name to 100.
 */
export const DETECTION_RULE_NAME_MAX_LENGTH: number = ColumnLength.ShortText;

const ELLIPSIS: string = "…";

// What a cut name may not end on before its ellipsis.
const TRAILING_SEPARATORS: ReadonlyArray<string> = [
  " ",
  "\t",
  "-",
  "–",
  "—",
  ",",
  ";",
  ":",
];

function trimTrailingSeparators(text: string): string {
  let end: number = text.length;

  while (end > 0 && TRAILING_SEPARATORS.includes(text.charAt(end - 1))) {
    end--;
  }

  return text.slice(0, end);
}

/*
 * A detection rule's name from its Sigma title, as OneUptime fills it in:
 * the title as written when it fits, else cut to fit - at the last space
 * that keeps most of it, ending in an ellipsis - so a title Sigma allows
 * never makes a save fail on a name nobody typed.
 */
export function fitDetectionRuleName(title: string): string {
  const name: string = (title || "").trim();

  if (name.length <= DETECTION_RULE_NAME_MAX_LENGTH) {
    return name;
  }

  // One character is kept for the ellipsis.
  const room: number = DETECTION_RULE_NAME_MAX_LENGTH - ELLIPSIS.length;
  const cut: string = name.slice(0, room);
  const space: number = cut.lastIndexOf(" ");

  // A space far back would throw most of the room away: cut in the word then.
  const kept: string = trimTrailingSeparators(
    space >= Math.floor(room / 2) ? cut.slice(0, space) : cut,
  );

  return `${kept || cut}${ELLIPSIS}`;
}
