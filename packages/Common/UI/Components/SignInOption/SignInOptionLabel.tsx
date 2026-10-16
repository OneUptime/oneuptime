import {
  SIGN_IN_OPTION_ICON_SLOT_CLASS,
  SIGN_IN_OPTION_LABEL_CLASS,
} from "./SignInOptionStyle";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

export interface ComponentProps {
  /*
   * What goes before the words: an Icon sized SIGN_IN_OPTION_ICON_CLASS, or
   * a logo of that height. Decorative - the words name the option.
   */
  icon: ReactNode;
  title: string;
}

/*
 * The words of a sign-in option (SignInOptionStyle) with their icon at the
 * start of the first line, rather than beside the words: when a label is too
 * long for one line - Spanish "Iniciar sesión con una clave de acceso" on a
 * phone - it wraps into balanced lines and the icon stays with its words.
 *
 * dir="auto": the label is laid out by its own first letter. The sign-in
 * pages are laid out left to right in every language, and a Persian label
 * that ends in a Latin word - "ورود با SSO" - was read starting from "SSO".
 * In a right-to-left label the icon leads from the right.
 *
 * Divs, because the Icon inside renders one, and a span may not hold a div.
 */
const SignInOptionLabel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div dir="auto" className={SIGN_IN_OPTION_LABEL_CLASS}>
      <div className={SIGN_IN_OPTION_ICON_SLOT_CLASS} aria-hidden="true">
        {props.icon}
      </div>
      {props.title}
    </div>
  );
};

export default SignInOptionLabel;
