import moment from "moment-timezone";

/*
 * MOMENT'S CALENDAR ARITHMETIC IN A ZONE THE TEST NAMES.
 *
 * Some behaviour shows only where the server's zone changes its clocks:
 * there a calendar day is 23 or 25 hours long (half an hour either way on
 * Lord Howe Island, two hours on Antarctica/Troll), and in UTC, where CI
 * runs, it never is. A test asks for such a zone in a docblock wherever Jest
 * honours one: Common's tests and ee/Tests/UI, whose environment
 * (Tests/Utils/TimezoneEnvironment.js) sets the worker's real zone before
 * the file loads (see TimezoneDocblockScan). ee's server tests run in Node's
 * own environment, which ignores the docblock, and a fresh Node started in
 * a real zone (TranspileOnlyNode) takes minutes to load the server code.
 *
 * For those, this sets moment's default zone. Every moment made without a
 * zone then reckons in it - so does OneUptimeDate's calendar arithmetic
 * made without one (addRemoveDays, addRemoveMonths, addRemoveYears) - as
 * on a server whose clock is set to that zone, to the same instant.
 *
 * It reaches moment only: Date's own local getters, Intl and any other code
 * still read the machine's zone. So a test that uses it also asserts an
 * instant only that zone gives (a day of 25 hours): if the code it tests
 * stops reckoning through moment, the test then fails in UTC instead of
 * passing there without the zone. Reset it after each test.
 */

// From now on moment reckons in `zone`; a zone moment does not know throws.
export function setMomentDefaultZone(zone: string): void {
  /*
   * moment.tz.setDefault takes a name it does not know as "no zone", and
   * the test would reckon in the machine's zone without a word.
   */
  if (!moment.tz.zone(zone)) {
    throw new Error(`moment-timezone does not know the zone "${zone}".`);
  }

  moment.tz.setDefault(zone);
}

// From now on moment reckons in the machine's zone again.
export function resetMomentDefaultZone(): void {
  moment.tz.setDefault();
}
