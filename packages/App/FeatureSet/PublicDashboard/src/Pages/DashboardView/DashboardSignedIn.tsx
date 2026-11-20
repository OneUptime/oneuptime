import { SIGN_IN_COPY, SIGN_OUT_BUTTON_TEST_ID } from "../SignIn/SignInCopy";
import IconProp from "Common/Types/Icon/IconProp";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * Who is signed in to a dashboard that asks its visitors to sign in
 * (#10250), and the way out: Sign Out in the dashboard's toolbar, its words
 * kept from a tablet up and its icon alone on a phone, with who is signed
 * in on its tooltip. It ends the session on the server - not only in this
 * browser - and opens the sign-in page.
 */
export interface DashboardSignedInVisitor {
  email: string;
  onSignOut: () => Promise<void>;
}

export interface ComponentProps {
  signedIn: DashboardSignedInVisitor;
}

const DashboardSignOutButton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isSigningOut, setIsSigningOut] = useState<boolean>(false);

  return (
    <Button
      icon={IconProp.Logout}
      title={SIGN_IN_COPY.signOut}
      buttonStyle={ButtonStyleType.HOVER_PRIMARY_OUTLINE}
      isTitleHiddenOnPhone={true}
      isLoading={isSigningOut}
      disabled={isSigningOut}
      tooltip={translator.translateTemplate(SIGN_IN_COPY.signedInAs, {
        email: props.signedIn.email,
      })}
      dataTestId={SIGN_OUT_BUTTON_TEST_ID}
      onClick={() => {
        setIsSigningOut(true);
        void props.signedIn.onSignOut();
      }}
    />
  );
};

export default DashboardSignOutButton;
