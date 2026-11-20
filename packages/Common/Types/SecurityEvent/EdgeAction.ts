/*
 * WHAT THE EDGE IN FRONT OF THE APP DID WITH A REQUEST.
 *
 * A firewall at the edge (Cloudflare's WAF, its rate limiting, its bot and
 * DDoS protection) acts on a request before the app sees it: it blocks it,
 * challenges it, logs it and lets it through, or lets it through on a rule
 * of the customer's own. OneUptime holds the other side of the same request,
 * the app's traces and how far they got (SecurityEventRequestOutcome), so a
 * case can say "Cloudflare challenged 400 requests from this address; 12
 * passed the challenge and 3 reached your database".
 *
 * Every edge event OneUptime imports carries one of these in
 * EDGE_ACTION_ATTRIBUTE, in whichever words its product used (Cloudflare's
 * action names: block, managed_challenge, jschallenge_solved ...), so a
 * rule, a case and a search read one vocabulary for every edge product.
 */
enum EdgeAction {
  // Turned away at the edge: blocked, the connection closed, a challenge failed.
  Blocked = "blocked",
  // Answered with a challenge instead of the page: the request went no further.
  Challenged = "challenged",
  // A later request of the same visitor passed the challenge, or had passed one before.
  PassedChallenge = "passed-challenge",
  // Flagged by a rule that only logs, and let through to the app.
  Logged = "logged",
  // Let through on a rule of the customer's own that skips or allows.
  LetThrough = "let-through",
  // Something the edge did that none of the above names.
  Other = "other",
}

// Most to least decisive: the order a summary lists them in.
export const EDGE_ACTIONS_IN_ORDER: ReadonlyArray<EdgeAction> = [
  EdgeAction.Blocked,
  EdgeAction.Challenged,
  EdgeAction.PassedChallenge,
  EdgeAction.Logged,
  EdgeAction.LetThrough,
  EdgeAction.Other,
];

/*
 * The actions after which the request went no further than the edge: the
 * app never saw it. The rest reached the app, or may have.
 */
export const EDGE_ACTIONS_STOPPED_AT_THE_EDGE: ReadonlyArray<EdgeAction> = [
  EdgeAction.Blocked,
  EdgeAction.Challenged,
];

export function isEdgeAction(value: unknown): value is EdgeAction {
  return (
    typeof value === "string" &&
    (EDGE_ACTIONS_IN_ORDER as ReadonlyArray<string>).includes(value)
  );
}

// The attribute every imported edge event carries its action under.
export const EDGE_ACTION_ATTRIBUTE: string = "oneuptime.edge.action";

/*
 * How many requests the event stands for. An edge samples what it reports
 * when it is busy (Cloudflare's adaptive sampling): an event with a sample
 * interval of 10 stands for about 10 requests like it. Absent or 1 means the
 * event is the one request. A count summed from these is an estimate when
 * any of them is above 1, and says "about".
 */
export const EDGE_SAMPLE_INTERVAL_ATTRIBUTE: string =
  "oneuptime.edge.sample_interval";

// A sample interval as stored, as a whole number of requests: 1 for anything unreadable.
export function readEdgeSampleInterval(value: unknown): number {
  const number: number =
    typeof value === "number" ? value : Number(String(value ?? "").trim());

  return Number.isInteger(number) && number >= 1 ? number : 1;
}

export default EdgeAction;
