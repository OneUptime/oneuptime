import {
  PROJECT_SSO_SIGN_IN_LINK_CARD_TEST_ID,
  ProjectSsoCopy,
} from "./ProjectSsoCopy";
import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import { getProjectSsoSignInRoute } from "Common/Types/SSO/SignInMethods";
import Card from "Common/UI/Components/Card/Card";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import Link from "Common/UI/Components/Link/Link";
import { ACCOUNTS_URL } from "Common/UI/Config";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * SSO Sign-in Link, under a project's SAML and OIDC providers on Settings >
 * SSO (#9918): the project's SSO sign-in link, an Accounts page that lists
 * the providers signing people in to the project, by the project's id alone
 * (Common/Types/SSO/SignInMethods: /accounts/sso/<project id>).
 *
 * "Sign in with SSO" finds a provider only by an address's verified domain
 * (#9824), so it finds nothing for a contractor on another domain, or while
 * the project has no verified domain. The admin shares this link with them;
 * it asks for no address, so it says nothing about who has an account. It
 * is also where an admin tries a provider before requiring SSO: it was "Test
 * Single Sign On (SSO)", a link to the Dashboard's project sign-in page,
 * which only someone already signed in could open.
 *
 * The sentence is the card's body, not its description: a card's
 * description is hidden on a phone, and the link is what the card is for.
 * The link is on a line of its own under it, to open or copy, so a long
 * address never breaks the sentence's line. The page draws the card only
 * while the project has a provider to sign in with.
 */

export interface ComponentProps {
  projectId: ObjectID;
}

// The project's SSO sign-in link, on this server.
export const getProjectSsoSignInLink: (projectId: ObjectID) => string = (
  projectId: ObjectID,
): string => {
  /*
   * From a copy: addRoute changes the URL it is called on, and ACCOUNTS_URL
   * is shared by the whole app.
   */
  return URL.fromString(ACCOUNTS_URL.toString())
    .addRoute(getProjectSsoSignInRoute(projectId))
    .toString();
};

const ProjectSsoSignInLinkCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const signInLink: string = getProjectSsoSignInLink(props.projectId);

  return (
    <Card title={ProjectSsoCopy.signInLinkTitle}>
      <div data-testid={PROJECT_SSO_SIGN_IN_LINK_CARD_TEST_ID}>
        <p className="text-sm text-gray-600">
          {translator.translateText(ProjectSsoCopy.signInLinkSentence)}
        </p>
        <div className="mt-2 flex min-w-0 items-center gap-2">
          <Link
            openInNewTab={true}
            to={URL.fromString(signInLink)}
            className="min-w-0 break-all text-sm text-indigo-600 underline underline-offset-2 hover:text-indigo-800"
          >
            {/*
             * On its own span: Link wraps a bare string in a span the page's
             * font rule would draw in Inter.
             */}
            <span className="font-mono">{signInLink}</span>
          </Link>
          <CopyTextButton textToBeCopied={signInLink} />
        </div>
      </div>
    </Card>
  );
};

export default ProjectSsoSignInLinkCard;
