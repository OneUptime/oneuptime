import {
  PROJECT_SIGN_IN_TEST_CARD_TEST_ID,
  ProjectSsoCopy,
} from "./ProjectSsoCopy";
import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { DASHBOARD_URL } from "Common/UI/Config";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Test Single Sign On (SSO), under a project's SAML and OIDC providers on
 * Settings > SSO: the project's sign-in page, which lists both kinds
 * (Pages/Onboarding/SSO), to try a provider before Require SSO for Login is
 * turned on. The page draws it only while the project has a provider to
 * try.
 */

export interface ComponentProps {
  projectId: ObjectID;
}

// Where the project's members pick one of its SAML or OIDC providers.
export const getProjectSignInTestUrl: (projectId: ObjectID) => string = (
  projectId: ObjectID,
): string => {
  return `${DASHBOARD_URL.toString()}/${projectId.toString()}/sso`;
};

const ProjectSignInTestCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const testUrl: string = getProjectSignInTestUrl(props.projectId);

  /*
   * The sentence is the card's body, not its description: a card's
   * description is hidden on a phone, and the link is what the card is for.
   * The link is drawn as one, on a line of its own under the sentence that
   * ends with it in every language, so a long address never breaks the
   * sentence's line.
   */
  return (
    <Card title={ProjectSsoCopy.testTitle}>
      <p
        className="text-sm text-gray-600"
        data-testid={PROJECT_SIGN_IN_TEST_CARD_TEST_ID}
      >
        <TranslatedSentence
          template={ProjectSsoCopy.testSentence}
          slots={{
            link: (
              <Link
                openInNewTab={true}
                to={URL.fromString(testUrl)}
                className="mt-1 block break-all text-indigo-600 underline underline-offset-2 hover:text-indigo-800"
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

export default ProjectSignInTestCard;
