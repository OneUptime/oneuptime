/*
 * WHAT A PAGE OFFERS FOR ONE SUGGESTION.
 *
 * Every suggestion, AI action and "do this next" prompt in OneUptime shows
 * only when it applies to what is on screen. The rule that decides it lives
 * in this folder, one helper per kind of suggestion (a trace worth a
 * performance fix, an AI action at all, a pull request that improves a
 * service's logging or tracing, ...). A page never writes its own condition:
 * it asks the helper - or the server route that asks the same helper - and
 * draws what the answer says. So the page and the server can never disagree
 * about whether something is offered, and a later page that offers the same
 * kind of thing follows the same rule by importing it.
 *
 * Everything here is pure (no I/O): the server and the Dashboard import it
 * alike, and the tests run it on fixtures.
 */

enum SuggestionOffer {
  /*
   * Nothing to suggest here. The page draws nothing at all: no disabled
   * button, no "not needed" note.
   */
  None = "None",
  // The suggestion applies and can be acted on: the page draws the action.
  Act = "Act",
  /*
   * The suggestion applies, but one setup step stands in the way (a code
   * repository to connect). The page draws a quiet link to that step in
   * place of the action - never a disabled button.
   */
  SetUp = "SetUp",
  /*
   * Somebody already acted on it and the work is still going: the page
   * links to that work instead of offering it a second time.
   */
  InProgress = "InProgress",
  /*
   * Somebody already acted on it and the work is done: the page says how
   * it came out and links to it, instead of offering it a second time.
   */
  Done = "Done",
}

export default SuggestionOffer;

const ALL_OFFERS: ReadonlyArray<string> = Object.values(SuggestionOffer);

/*
 * Reads an offer off the wire. Anything this build does not know - a newer
 * server's value, a missing field, a wrong type - reads as None, so an
 * unknown answer never draws an action.
 */
export function parseSuggestionOffer(value: unknown): SuggestionOffer {
  if (typeof value === "string" && ALL_OFFERS.includes(value)) {
    return value as SuggestionOffer;
  }

  return SuggestionOffer.None;
}
