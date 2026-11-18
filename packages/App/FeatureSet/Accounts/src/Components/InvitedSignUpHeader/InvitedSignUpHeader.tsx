import { SignUpInvitation } from "Common/Types/Accounts/SignUpInvitation";
import React, { ReactElement, ReactNode } from "react";
import { useTranslation } from "react-i18next";

/*
 * THE TOP OF THE SIGN-UP PAGE AN INVITATION OPENS (#7471).
 *
 * The page was the plain sign-up page, "Create your OneUptime account":
 * am I joining Walk Co, or making an account somewhere else? It now says
 * which project, and who invited them - "Join Walk Co" over "Ada Walker
 * invited you to join this project on OneUptime. Create your account to
 * join." - from what the invitation already knows (Utils/SignUpInvitation).
 * Someone a master admin added already is told they were added. The
 * project's and the inviter's names are their own words, each set apart so
 * a Latin name reads the right way inside a Persian or Arabic sentence.
 */

export interface ComponentProps {
  invitation: SignUpInvitation;
}

/*
 * Stands in for a name while the translated sentence is split around it,
 * so the name can be set apart wherever each language puts it, without
 * the locale files carrying any markup.
 */
const NAME_SENTINEL: string = "__ONEUPTIME_NAME__";

export const INVITED_SIGN_UP_TITLE_TEST_ID: string = "register-invited-title";
export const INVITED_SIGN_UP_SUBTITLE_TEST_ID: string = "register-invitation";

const InvitedSignUpHeader: (props: ComponentProps) => ReactElement = (
  props: ComponentProps,
): ReactElement => {
  const { t } = useTranslation();

  /*
   * The sentence of `key` with `name` in its one placeholder, set apart (and
   * drawn by `draw`) wherever the language puts it. A translation that lost
   * or doubled the placeholder still gets the name, as plain text.
   */
  const withName: (
    key: string,
    placeholder: string,
    name: string,
    draw: (name: ReactNode) => ReactNode,
  ) => ReactNode = (
    key: string,
    placeholder: string,
    name: string,
    draw: (name: ReactNode) => ReactNode,
  ): ReactNode => {
    const parts: Array<string> = t(key, {
      [placeholder]: NAME_SENTINEL,
    }).split(NAME_SENTINEL);

    if (parts.length !== 2) {
      return t(key, { [placeholder]: name });
    }

    return (
      <>
        {parts[0]}
        {draw(<bdi>{name}</bdi>)}
        {parts[1]}
      </>
    );
  };

  const { invitation } = props;

  const subtitle: ReactNode = invitation.inviterName
    ? withName(
        invitation.isAccepted ? "register.addedBy" : "register.invitedBy",
        "inviter",
        invitation.inviterName,
        (name: ReactNode): ReactNode => {
          return (
            <strong className="font-semibold text-gray-900 [overflow-wrap:anywhere]">
              {name}
            </strong>
          );
        },
      )
    : t(invitation.isAccepted ? "register.added" : "register.invited");

  return (
    <>
      <h1
        className="mt-5 text-center text-2xl font-semibold tracking-tight text-gray-900 [overflow-wrap:anywhere] sm:mt-6 sm:text-3xl"
        data-testid={INVITED_SIGN_UP_TITLE_TEST_ID}
      >
        {withName(
          "register.invitedTitle",
          "project",
          invitation.projectName,
          (name: ReactNode): ReactNode => {
            return name;
          },
        )}
      </h1>
      <p
        className="mx-auto mt-3 max-w-md text-balance text-center text-sm leading-6 text-gray-600"
        data-testid={INVITED_SIGN_UP_SUBTITLE_TEST_ID}
      >
        {subtitle}
      </p>
    </>
  );
};

export default InvitedSignUpHeader;
