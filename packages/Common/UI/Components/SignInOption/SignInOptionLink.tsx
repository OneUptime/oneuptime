import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import IconProp from "../../../Types/Icon/IconProp";
import Icon from "../Icon/Icon";
import Link from "../Link/Link";
import SignInOptionLabel from "./SignInOptionLabel";
import {
  getSignInOptionClassName,
  SIGN_IN_OPTION_ICON_CLASS,
} from "./SignInOptionStyle";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  title: string;
  to: Route | URL;
  icon: IconProp;
  id?: string | undefined;
  dataTestId?: string | undefined;
}

/*
 * Another way to sign in that is a page of its own - single sign-on, or the
 * password form from the single sign-on page - drawn as the sign-in pages
 * draw every other way in (SignInOptionStyle): a full-width outlined button
 * with an icon before its words. Still a link: it goes somewhere, so it
 * opens in a new tab on a middle or Cmd/Ctrl click, like any link.
 */
const SignInOptionLink: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Link
      to={props.to}
      id={props.id}
      dataTestId={props.dataTestId}
      className={getSignInOptionClassName("ready")}
    >
      <SignInOptionLabel
        icon={<Icon icon={props.icon} className={SIGN_IN_OPTION_ICON_CLASS} />}
        title={props.title}
      />
    </Link>
  );
};

export default SignInOptionLink;
