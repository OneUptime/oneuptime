import Errors from "../Errors";
import BadDataException from "../../../Types/Exception/BadDataException";

/*
 * A PROJECT WITH NO ROOM FOR ONE MORE PERSON.
 *
 * TeamMemberService refuses a membership that would add someone new to a
 * project past its limits on people - a plan's seats, or the Free plan's
 * one person (getPeopleLimitRefusal) - early, or with the INSERT, with one
 * of these sentences. They are written for whoever invites. Someone who is
 * being added as they sign in through single sign-on is not the one who
 * can do anything about it, so a sign-in asks isRefusal and answers in its
 * own words (Identity's SsoTeamMembership).
 *
 * Kept out of TeamMemberService, so the code that asks - and the suites that
 * stand that service in - reads the same answer.
 */
export default class PeopleLimitRefusal {
  // Every sentence a project refuses one more person with.
  public static readonly REFUSALS: ReadonlyArray<string> = [
    Errors.TeamMemberService.LIMIT_REACHED,
    Errors.TeamMemberService.LIMIT_REACHED_FOR_FREE_PLAN,
  ];

  // Whether `error` is a project refusing one more person.
  public static isRefusal(error: unknown): boolean {
    return (
      error instanceof BadDataException &&
      PeopleLimitRefusal.REFUSALS.includes(error.message)
    );
  }
}
