/*
 * What one run of a detection rule or a threat-intel feed does with the
 * groups it matched (a rule's group values, a feed's indicator values),
 * highest count first:
 *
 *  - the first `openLimit` open alerts, incidents and cases of their own;
 *  - the first `recordLimit` are recorded as Detection Findings, when the
 *    source writes findings;
 *  - the rest of those recorded are the run's OVERFLOW: they open one case
 *    about the source instead of one each, and the source's last error says
 *    how many there were - so a noisy rule floods neither the queue nor
 *    on-call, and no group goes unseen.
 *
 * The match query asks for one row more than `recordLimit`, so a run can
 * tell "exactly the limit" from "more than it reads".
 */

export interface DetectionGroupSplit<T> {
  // The groups alerts, incidents and cases are opened for.
  opened: Array<T>;
  // The groups recorded as Detection Findings.
  recorded: Array<T>;
  // The recorded groups past `opened`.
  overflow: Array<T>;
  // There were more groups than the run reads: `recorded` is a floor.
  moreThanRead: boolean;
}

export function splitDetectionGroups<T>(
  groups: Array<T>,
  limits: { openLimit: number; recordLimit: number },
): DetectionGroupSplit<T> {
  const recorded: Array<T> = groups.slice(0, limits.recordLimit);

  return {
    opened: recorded.slice(0, limits.openLimit),
    recorded,
    overflow: recorded.slice(limits.openLimit),
    moreThanRead: groups.length > limits.recordLimit,
  };
}

export interface DetectionOverflow {
  // "rule": a detection rule's groups. "feed": a threat-intel feed's indicator values.
  kind: "rule" | "feed";
  // Groups the run read (at most recordLimit; a floor when moreThanRead).
  matched: number;
  moreThanRead: boolean;
  // Groups alerts, incidents and cases were opened for.
  opened: number;
  // Whether the groups were recorded as Detection Findings.
  findingsWritten: boolean;
}

// "2,340" rather than "2340": the number a person reads in Last Error.
function formatCount(count: number): string {
  return count.toLocaleString("en-US");
}

/*
 * The sentence a run that overflowed leaves on its source (the rule's
 * Last Error, the feed's Last Match Error), so whoever looks at the source
 * sees how many groups there were and what to change.
 */
export function describeDetectionOverflow(overflow: DetectionOverflow): string {
  // A rule's evaluation is a run; a feed's, a check (the Threat Intelligence guide's word).
  const pass: string = overflow.kind === "rule" ? "run" : "check";
  const unit: string = overflow.kind === "rule" ? "groups" : "indicator values";
  const matched: string = overflow.moreThanRead
    ? `more than ${formatCount(overflow.matched)}`
    : formatCount(overflow.matched);

  const opened: string = `Alerts, incidents and cases opened for the ${formatCount(
    overflow.opened,
  )} with the most matches`;

  let recorded: string;

  if (!overflow.findingsWritten) {
    recorded =
      overflow.kind === "rule"
        ? "the rest were not recorded, because Write Detection Finding on Match is off"
        : "the rest were not recorded, because Write Detection Finding on Match is off for this feed";
  } else if (overflow.moreThanRead) {
    recorded = `the ${formatCount(
      overflow.matched,
    )} with the most matches are Detection Findings, and the rest were not recorded`;
  } else {
    recorded = `every one of them is a Detection Finding`;
  }

  const advice: string =
    overflow.kind === "rule"
      ? "Raise the Match Count Threshold, or group by a coarser field."
      : "Check the feed for indicators that match everyday values, or raise its Minimum Confidence.";

  return `This ${pass} matched ${matched} ${unit}. ${opened}; ${recorded}. ${advice}`;
}

/*
 * How every sentence a run leaves about its own work opens: the overflow
 * above ("This run matched ...", "This check matched ..."), and any other
 * note a run writes about what it did. A failure is the message of what the
 * run threw, which never opens this way.
 */
const DETECTION_RUN_NOTICE_OPENINGS: Array<string> = [
  "This run ",
  "This check ",
];

/*
 * Whether a rule's Last Error or a feed's Last Match Error is a run's note
 * about its own work, not a failure: the Dashboard shows the first as
 * needing a look, and the second as failing.
 */
export function isDetectionRunNotice(
  message: string | null | undefined,
): boolean {
  if (!message) {
    return false;
  }

  const text: string = message.trimStart();

  return DETECTION_RUN_NOTICE_OPENINGS.some((opening: string): boolean => {
    return text.startsWith(opening);
  });
}
