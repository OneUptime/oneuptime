import IconProp from "../../../Types/Icon/IconProp";
import Icon from "../Icon/Icon";
import SignInOptionLabel from "./SignInOptionLabel";
import {
  getSignInOptionClassName,
  SIGN_IN_OPTION_ICON_CLASS,
  SIGN_IN_OPTION_PRIMARY_CLASS,
} from "./SignInOptionStyle";
import React, { FunctionComponent, ReactElement, useId } from "react";

// One single sign-on provider to sign in with.
export interface SsoProviderOption {
  // Unique in the list: the provider's kind and id.
  key: string;
  // The button's words, already in the visitor's language.
  title: string;
  /*
   * A line under the button, in the admin's words ("Use your Acme email"):
   * only a description somebody wrote, never "Sign in with <name>" again.
   */
  description?: string | undefined;
  onClick: () => void;
  dataTestId?: string | undefined;
}

export interface ComponentProps {
  options: Array<SsoProviderOption>;
  /*
   * The providers are the only way in on the page: one of them is then the
   * page's filled button (SIGN_IN_OPTION_PRIMARY_CLASS). With anything else
   * to do - an email form with its own filled button, a password - every
   * provider is an outlined option, as the other ways in are.
   */
  isOnlyWayIn?: boolean | undefined;
  dataTestId?: string | undefined;
}

/*
 * The single sign-on providers a sign-in page offers, one button each, an
 * icon before the provider's name: the Accounts sign-in pages (while the
 * server requires SSO, the only thing on them) and the page a project that
 * requires SSO sends people to. The look of every other way in
 * (SignInOptionStyle), so they read as choices, not small print - except
 * that a page whose one way in is one provider draws it filled.
 *
 * A provider's description, when its admin wrote one, is a line under its
 * button. Names and descriptions are laid out by their own direction
 * (dir="auto"), like every option's words.
 */
const SsoProviderOptions: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isFilled: boolean =
    Boolean(props.isOnlyWayIn) && props.options.length === 1;

  // Each description is read out with its button (aria-describedby).
  const descriptionIdPrefix: string = useId();

  return (
    <ul className="space-y-3" data-testid={props.dataTestId}>
      {props.options.map(
        (option: SsoProviderOption, index: number): ReactElement => {
          const descriptionId: string | undefined = option.description
            ? `${descriptionIdPrefix}-${index}`
            : undefined;

          return (
            <li key={option.key}>
              <button
                type="button"
                onClick={option.onClick}
                data-testid={option.dataTestId}
                aria-describedby={descriptionId}
                className={
                  isFilled
                    ? SIGN_IN_OPTION_PRIMARY_CLASS
                    : getSignInOptionClassName("ready")
                }
              >
                <SignInOptionLabel
                  icon={
                    <Icon
                      icon={IconProp.ShieldCheck}
                      className={SIGN_IN_OPTION_ICON_CLASS}
                    />
                  }
                  title={option.title}
                />
              </button>
              {option.description ? (
                <p
                  id={descriptionId}
                  dir="auto"
                  className="mt-1.5 break-words text-center text-sm text-gray-500"
                >
                  {option.description}
                </p>
              ) : (
                <></>
              )}
            </li>
          );
        },
      )}
    </ul>
  );
};

export default SsoProviderOptions;
