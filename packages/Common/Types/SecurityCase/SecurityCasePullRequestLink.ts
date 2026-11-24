import { RefusalWithValues } from "../Exception/RefusalWithValues";
import { translationKey } from "../Translator";

/*
 * LINKING A PERSON'S OWN PULL REQUEST TO A CASE'S FIX STEP (#10604): the
 * most a case holds, and why a link is refused. The server refuses in
 * English; the Link Pull Request dialog says each refusal in the reader's
 * language, a refusal with values in it read back out of the English
 * (RefusalWithValues, Common/UI/Utils/ErrorInSentence).
 *
 * {{repository}} is the repository as its host names it ("acme/search"),
 * {{pullRequest}} the pull request ("acme/search#482").
 */

// The most pull requests one case holds: a fix is one or two, never a list.
export const SECURITY_CASE_PULL_REQUESTS_MAX: number = 10;

export const PULL_REQUEST_LINK_NOT_AN_ADDRESS: string = translationKey(
  "Paste the address of a pull request as its page shows it, like https://github.com/acme/search/pull/482.",
);

export const PULL_REQUEST_LINK_TOO_MANY: string = translationKey(
  "This case has 10 pull requests linked already. Take one off before you link another.",
);

export const PULL_REQUEST_LINK_CASE_NOT_FOUND: string = translationKey(
  "This security case does not exist, or you cannot read it.",
);

export const PULL_REQUEST_LINK_NOT_CONNECTED: RefusalWithValues = {
  template: translationKey(
    "{{repository}} is not connected to this project. Connect it under Code, so OneUptime can follow its pull requests to their deploy.",
  ),
  terms: [],
};

export const PULL_REQUEST_LINK_REPOSITORY_NOT_READABLE: RefusalWithValues = {
  template: translationKey(
    "You cannot read {{repository}} in OneUptime, so you cannot link its pull requests. Ask someone who can.",
  ),
  terms: [],
};

export const PULL_REQUEST_LINK_NOT_FOLLOWED: RefusalWithValues = {
  template: translationKey(
    "OneUptime cannot read the pull requests of {{repository}}: it has no pull requests of its own there, or its connection is not working. Check it under Code.",
  ),
  terms: [],
};

export const PULL_REQUEST_LINK_NOT_FOUND: RefusalWithValues = {
  template: translationKey(
    "{{pullRequest}} does not exist, or the repository's connection cannot see it.",
  ),
  terms: [],
};

export const PULL_REQUEST_LINK_CLOSED: RefusalWithValues = {
  template: translationKey(
    "{{pullRequest}} was closed without merging, so it is no fix to follow.",
  ),
  terms: [],
};

export const PULL_REQUEST_LINK_ALREADY_LINKED: RefusalWithValues = {
  template: translationKey("{{pullRequest}} is linked to this case already."),
  terms: [],
};

export const PULL_REQUEST_LINK_READ_FAILED: RefusalWithValues = {
  template: translationKey(
    "OneUptime could not read {{pullRequest}} just now. Try again in a minute.",
  ),
  terms: [],
};

// Every refusal with values: the Dashboard reads each back out of the English it gets.
export const PULL_REQUEST_LINK_REFUSALS: ReadonlyArray<RefusalWithValues> = [
  PULL_REQUEST_LINK_NOT_CONNECTED,
  PULL_REQUEST_LINK_REPOSITORY_NOT_READABLE,
  PULL_REQUEST_LINK_NOT_FOLLOWED,
  PULL_REQUEST_LINK_NOT_FOUND,
  PULL_REQUEST_LINK_CLOSED,
  PULL_REQUEST_LINK_ALREADY_LINKED,
  PULL_REQUEST_LINK_READ_FAILED,
];
