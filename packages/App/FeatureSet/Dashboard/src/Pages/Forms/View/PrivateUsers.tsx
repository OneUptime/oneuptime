import PageComponentProps from "../../PageComponentProps";
import FormSignInOnlySettings from "../../../Components/FormBuilder/FormSignInOnlySettings";
import { FormSignInOnlyPage } from "../../../Components/FormBuilder/FormSignInCopy";
import PrivateUsersTable from "../../../Components/PrivateAccess/PrivateUsersTable";
import { FORM_PRIVATE_ACCESS } from "../../../Components/PrivateAccess/PrivateAccessKinds";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Forms -> a form -> Private Users (#10249): the people who may sign in to
 * the form's link when only people who sign in can open it. Each is added
 * by their email address and emailed an invitation that sets their first
 * password; Remove ends every session they hold. The same list a
 * dashboard's sign-in has (Components/PrivateAccess/PrivateUsersTable).
 *
 * While the form does not ask its visitors to sign in, the page says first
 * that the list does nothing yet, with the way to the Share page, and folds
 * it under the notice (FormSignInOnlySettings).
 */
const FormPrivateUsers: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <FormSignInOnlySettings
      formId={modelId}
      page={FormSignInOnlyPage.PrivateUsers}
    >
      <PrivateUsersTable kind={FORM_PRIVATE_ACCESS} parentId={modelId} />
    </FormSignInOnlySettings>
  );
};

export default FormPrivateUsers;
