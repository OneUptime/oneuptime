import PageComponentProps from "../../PageComponentProps";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ModelForm, { FormType } from "Common/UI/Components/Forms/ModelForm";
import { getNewPasswordFields } from "Common/UI/Components/PasswordRequirements/NewPasswordFields";
import UserUtil from "Common/UI/Utils/User";
import User from "Common/Models/DatabaseModels/User";
import React, { FunctionComponent, ReactElement, useId, useState } from "react";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { LocalSignInSettings } from "../../../Components/UserProfile/SignInManagement";

class UserWithConfirmPassword extends User {
  public confirmPassword: string = "";
}

const Home: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [hasPasswordChanged, setHasPasswordChanged] = useState<boolean>(false);
  const passwordRequirementsId: string = useId();

  /*
   * Somebody whose sign-in their organization manages sets no password in
   * OneUptime (#9688): the page says who manages it instead.
   */
  return (
    <LocalSignInSettings>
      <Card
        title={"Update Password"}
        description={"You can set a new password here if you wish to do so."}
      >
        {!hasPasswordChanged ? (
          <ModelForm<UserWithConfirmPassword>
            modelType={UserWithConfirmPassword}
            name="Change Password Form"
            onSuccess={() => {
              setHasPasswordChanged(true);
            }}
            submitButtonStyleType={ButtonStyleType.PRIMARY}
            id="change-password-form"
            showAsColumns={1}
            doNotFetchExistingModel={true}
            modelIdToEdit={UserUtil.getUserId()}
            maxPrimaryButtonWidth={true}
            initialValues={{
              password: "",
              confirmPassword: "",
            }}
            fields={getNewPasswordFields<UserWithConfirmPassword>({
              translator: translator,
              requirementsId: passwordRequirementsId,
              passwordTitle: translator.translateText("New Password")!,
              confirmPasswordTitle:
                translator.translateText("Confirm Password")!,
            })}
            formType={FormType.Update}
            submitButtonText={"Update Password"}
          />
        ) : (
          <p>{translator.translateText("Your password has been updated.")}</p>
        )}
      </Card>
    </LocalSignInSettings>
  );
};

export default Home;
