import PageComponentProps from "../../PageComponentProps";
import FormSignInOnlySettings from "../../../Components/FormBuilder/FormSignInOnlySettings";
import { FormSignInOnlyPage } from "../../../Components/FormBuilder/FormSignInCopy";
import { FORM_PRIVATE_ACCESS } from "../../../Components/PrivateAccess/PrivateAccessKinds";
import SingleSignOnProviders from "../../../Components/PrivateAccess/SingleSignOnProviders";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Forms -> a form -> Single Sign-On (#10249): the SAML and OIDC providers
 * that sign people in to the form's link when only people who sign in can
 * open it, a tab per protocol, and Require SSO to Sign In. The same page a
 * dashboard's sign-in has (Components/PrivateAccess/SingleSignOnProviders);
 * the values each provider gives its identity provider are the form's own
 * (PrivateAccessKinds).
 *
 * While the form does not ask its visitors to sign in, the page says first
 * that its providers do nothing yet, with the way to the Share page, and
 * folds them under the notice (FormSignInOnlySettings).
 */
const FormSingleSignOn: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <FormSignInOnlySettings
      formId={modelId}
      page={FormSignInOnlyPage.SingleSignOn}
    >
      <SingleSignOnProviders kind={FORM_PRIVATE_ACCESS} parentId={modelId} />
    </FormSignInOnlySettings>
  );
};

export default FormSingleSignOn;
