import User from "../../../Models/DatabaseModels/User";
import ObjectID from "../../../Types/ObjectID";
import FeedPersonName, { FEED_NOBODY_NAMED } from "../Feed/FeedPersonName";

/*
 * WHO A PLAYBOOK STEP COULD NOT EMAIL, AS ITS LINE ON THE CASE SAYS IT
 * (#10681).
 *
 * Email people and Notify data store owners list everybody whose email
 * failed, and why, under the step's entry on the case's timeline; when
 * nobody could be emailed, the list is the step's error too, which ends the
 * run and is written on the timeline under it. The timeline is read through
 * the API and workflows, by whoever they hand it to, so each person is named
 * as every feed entry names people (FeedPersonName.readNames, one read of
 * who is only invited for them all): never by their address, which the list
 * led with ("ana@acme.com: timeout of 20000ms exceeded").
 *
 * Why an email failed is the mail service's own words, which can repeat an
 * address - the one stored for the person, refused as no valid address, or
 * a mail server's reply - so every word of it that holds an "@" is said as
 * ADDRESS_LEFT_OUT, as a page's failed send leaves out the addresses it
 * names (OnCallSendFailure).
 */

// One person a step's email failed to reach, and the error it failed on.
export interface NotEmailed {
  user: User;
  reason: string;
}

// What a word of a reason that held an address is said as.
export const ADDRESS_LEFT_OUT: string = "[address]";

// A run of white space, where a reason is broken into words.
const WHITE_SPACE_RUN: RegExp = /\s+/;

/*
 * A reason with every word that holds an "@" - an address, or what is left
 * of a malformed one - said as ADDRESS_LEFT_OUT, on one line.
 */
export function withoutAddresses(reason: string): string {
  return reason
    .split(WHITE_SPACE_RUN)
    .filter((word: string): boolean => {
      return word.length > 0;
    })
    .map((word: string): string => {
      return word.includes("@") ? ADDRESS_LEFT_OUT : word;
    })
    .join(" ");
}

export default class SecurityPlaybookNotEmailed {
  /*
   * "Ana Lee: timeout of 20000ms exceeded", one line for each person, in the
   * order they were tried: plain text, for the step's list and its error.
   */
  public static async describe(data: {
    projectId: ObjectID;
    notEmailed: Array<NotEmailed>;
  }): Promise<Array<string>> {
    if (data.notEmailed.length === 0) {
      return [];
    }

    const names: Map<string, string> = await FeedPersonName.readNames({
      users: data.notEmailed.map((failure: NotEmailed): User => {
        return failure.user;
      }),
      projectId: data.projectId,
    });

    return data.notEmailed.map((failure: NotEmailed): string => {
      const name: string =
        (failure.user.id &&
          names.get(failure.user.id.toString().toLowerCase())) ||
        FEED_NOBODY_NAMED;

      return `${name}: ${withoutAddresses(failure.reason)}`;
    });
  }
}
