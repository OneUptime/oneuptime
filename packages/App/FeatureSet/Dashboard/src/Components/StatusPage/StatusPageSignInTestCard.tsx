import {
  STATUS_PAGE_SIGN_IN_TEST_CARD_TEST_ID,
  StatusPageSignInCopy,
} from "./StatusPageSignInCopy";
import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { STATUS_PAGE_URL } from "Common/UI/Config";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Test Sign-In, under a status page's SSO or OIDC providers: the page's
 * sign-in link, to try a provider before Require SSO for Login is turned
 * on. Drawn only while the page has a provider to try.
 */

export interface ComponentProps {
  statusPageId: ObjectID;
}

// Where a status page's readers pick an SSO or OIDC provider.
export const getStatusPageSignInTestUrl: (statusPageId: ObjectID) => string = (
  statusPageId: ObjectID,
): string => {
  return `${STATUS_PAGE_URL.toString()}/${statusPageId.toString()}/sso`;
};

const StatusPageSignInTestCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const testUrl: string = getStatusPageSignInTestUrl(props.statusPageId);

  /*
   * The sentence is the card's body, not its description: a card's
   * description is hidden on a phone, and the link is what the card is for.
   */
  return (
    <Card title={StatusPageSignInCopy.testTitle}>
      <p
        className="text-sm text-gray-600"
        data-testid={STATUS_PAGE_SIGN_IN_TEST_CARD_TEST_ID}
      >
        <TranslatedSentence
          template={StatusPageSignInCopy.testSentence}
          slots={{
            link: (
              <Link
                openInNewTab={true}
                to={URL.fromString(testUrl)}
                className="break-all text-indigo-600 underline underline-offset-2 hover:text-indigo-800"
              >
                {/*
                 * On its own span: Link wraps a bare string in a span the
                 * page's font rule would draw in Inter.
                 */}
                <span className="font-mono">{testUrl}</span>
              </Link>
            ),
          }}
        />
      </p>
    </Card>
  );
};

export default StatusPageSignInTestCard;
