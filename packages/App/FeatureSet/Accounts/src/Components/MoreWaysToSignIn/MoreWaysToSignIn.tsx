import { MORE_WAYS_TO_SIGN_IN_OPEN_KEY } from "Common/Types/Accounts/MoreWaysToSignIn";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONValue } from "Common/Types/JSON";
import Icon from "Common/UI/Components/Icon/Icon";
import LocalStorage from "Common/UI/Utils/LocalStorage";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

/*
 * "More ways to sign in": the fold that keeps the sign-in page to one clear
 * way in (#9023). The page used to stack five outlined buttons under the
 * password form - single sign-on, Google, Microsoft, a sign-in link and a
 * passkey - and people did not know which one was theirs. Now the password
 * form comes first, Google and Microsoft (one click, and recognised at a
 * glance) stay under it where this server offers them, and single sign-on,
 * a sign-in link by email and a passkey fold under this one quiet line.
 * The subtitle over the card still names SSO and passkeys, so nobody has
 * to guess that they are here.
 *
 * The fold remembers, in this browser, whether it was left open: somebody
 * who signs in with SSO or a passkey opens it once and finds it open from
 * then on, and somebody who closes it finds it closed. Signing out keeps it
 * (Common/UI/Utils/KeptAfterSignOut), for the sign-in page is where it is
 * read.
 */

export const MORE_WAYS_TO_SIGN_IN_TOGGLE_TEST_ID: string =
  "more-ways-to-sign-in";

export const MORE_WAYS_TO_SIGN_IN_OPTIONS_ID: string =
  "more-ways-to-sign-in-options";

// The browser's memory of the fold, kept after sign-out.
export { MORE_WAYS_TO_SIGN_IN_OPEN_KEY };

// Whether this browser left the fold open. Storage that cannot be read (a private window, say) leaves it closed.
export const readMoreWaysToSignInOpen: () => boolean = (): boolean => {
  try {
    const value: JSONValue = LocalStorage.getItem(
      MORE_WAYS_TO_SIGN_IN_OPEN_KEY,
    );
    return value === true || value === "true";
  } catch {
    return false;
  }
};

export const rememberMoreWaysToSignInOpen: (isOpen: boolean) => void = (
  isOpen: boolean,
): void => {
  try {
    if (isOpen) {
      LocalStorage.setItem(MORE_WAYS_TO_SIGN_IN_OPEN_KEY, "true");
    } else {
      LocalStorage.removeItem(MORE_WAYS_TO_SIGN_IN_OPEN_KEY);
    }
  } catch {
    // Not remembered: the fold still opens and closes on this visit.
  }
};

export interface ComponentProps {
  isOpen: boolean;
  onToggle: (isOpen: boolean) => void;
  className?: string | undefined;
}

const MoreWaysToSignIn: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { t } = useTranslation();

  return (
    <div className={`flex justify-center ${props.className || ""}`}>
      <button
        type="button"
        data-testid={MORE_WAYS_TO_SIGN_IN_TOGGLE_TEST_ID}
        aria-expanded={props.isOpen}
        aria-controls={MORE_WAYS_TO_SIGN_IN_OPTIONS_ID}
        onClick={() => {
          props.onToggle(!props.isOpen);
        }}
        className="inline-flex items-center gap-1 rounded-sm px-1 py-1 text-sm font-medium text-gray-600 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
      >
        {t("login.moreWaysToSignIn")}
        <Icon
          icon={IconProp.ChevronDown}
          className={`h-4 w-4 transition-transform duration-200 motion-reduce:transition-none ${
            props.isOpen ? "-rotate-180" : ""
          }`}
        />
      </button>
    </div>
  );
};

export default MoreWaysToSignIn;
