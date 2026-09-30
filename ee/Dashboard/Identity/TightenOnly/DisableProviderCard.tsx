import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * "Disable this provider" on a provider's own page (the Admin Dashboard's
 * global SSO / OIDC provider view), for when the Enterprise license makes the
 * provider's configuration read-only and its edit form is gone. The page
 * decides when to show it - read-only configuration, provider enabled - and
 * what the button does (UseDisableProviderAction).
 *
 * Plain English strings: Card and Button translate them through the locale
 * entry under the same English key.
 */

export const DISABLE_PROVIDER_CARD_TITLE: string = "Disable this provider";

export const DISABLE_PROVIDER_CARD_DESCRIPTION: string =
  "Sign-in through this provider is off while the Enterprise license is missing or expired, and resumes as soon as a license is activated. Disable the provider to keep it off. Its configuration stays as it is, and it can be turned back on once the Enterprise license is valid again.";

export const DISABLE_PROVIDER_BUTTON_TITLE: string = "Disable Provider";

export const DISABLE_PROVIDER_CARD_TEST_ID: string = "disable-provider-card";

export interface ComponentProps {
  onDisable: () => void;
}

const DisableProviderCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div data-testid={DISABLE_PROVIDER_CARD_TEST_ID}>
      <Card
        title={DISABLE_PROVIDER_CARD_TITLE}
        description={DISABLE_PROVIDER_CARD_DESCRIPTION}
        buttons={[
          {
            title: DISABLE_PROVIDER_BUTTON_TITLE,
            buttonStyle: ButtonStyleType.DANGER_OUTLINE,
            icon: IconProp.StopCircle,
            onClick: () => {
              props.onDisable();
            },
          },
        ]}
      />
    </div>
  );
};

export default DisableProviderCard;
