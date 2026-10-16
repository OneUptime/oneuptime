/*
 * What a pick in the people search came to, said under its list until the
 * next pick. A list whose picks act at once - Add people on a record's
 * channel card invites somebody the moment they are picked - says what each
 * pick did, where the person picking is looking: what it did, what it left
 * as it was (somebody in the channel already), and what went wrong, a
 * sentence each.
 *
 * Imports nothing, so the rules that word these notices can be tested
 * without React.
 */
export enum PeopleSearchNoticeTone {
  Done = "done",
  Unchanged = "unchanged",
  Problem = "problem",
}

export interface PeopleSearchNotice {
  tone: PeopleSearchNoticeTone;
  // Already in the reader's language.
  text: string;
}
