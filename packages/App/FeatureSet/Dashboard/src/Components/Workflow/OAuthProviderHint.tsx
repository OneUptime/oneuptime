/*
 * The line of help the identity provider picked on the Create OAuth 2.0
 * Variable form adds under one of its fields - which part of the token URL
 * is the person's own, where the client ID lives, the scope the provider
 * insists on. Nothing at all when no provider is picked (as on a variable's
 * own page, whose settings form has no provider) or the provider has nothing
 * to say about this field.
 */

import React, { FunctionComponent, ReactElement } from "react";
import useTranslateValue from "Common/UI/Utils/Translation";
import {
  OAuthProviderHintField,
  getOAuthProviderHint,
} from "../../Utils/Workflow/OAuthIdentityProviders";

export interface ComponentProps {
  values: Record<string, unknown>;
  field: OAuthProviderHintField;
}

const OAuthProviderHint: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const { translateString } = useTranslateValue();

  const hint: string | null = getOAuthProviderHint({
    values: props.values,
    field: props.field,
  });

  if (!hint) {
    return null;
  }

  return (
    <p
      className="mt-1 text-xs text-gray-500"
      data-testid={`oauth-provider-hint-${props.field}`}
    >
      {translateString(hint) ?? hint}
    </p>
  );
};

export default OAuthProviderHint;
