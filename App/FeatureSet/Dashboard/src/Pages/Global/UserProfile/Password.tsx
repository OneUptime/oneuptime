import PageComponentProps from "../../PageComponentProps";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ModelForm, { FormType } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import UserUtil from "Common/UI/Utils/User";
import User from "Common/Models/DatabaseModels/User";
import React, { FunctionComponent, ReactElement, useState } from "react";

class UserWithConfirmPassword extends User {
  public confirmPassword: string = "";
}

const Home: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const [hasPasswordChanged, setHasPasswordChanged] = useState<boolean>(false);

  return (
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
          fields={[
            {
              field: {
                password: true,
              },
              fieldType: FormFieldSchemaType.Password,
              validation: {
                minLength: 6,
              },
              placeholder: "Password",
              title: "Password",
              required: true,
              showEvenIfPermissionDoesNotExist: true,
              disableSpellCheck: true,
            },
            {
              field: {
                confirmPassword: true,
              },
              validation: {
                minLength: 6,
                toMatchField: "password",
              },
              fieldType: FormFieldSchemaType.Password,
              placeholder: "Confirm Password",
              title: "Confirm Password",
              required: true,
              showEvenIfPermissionDoesNotExist: true,
              disableSpellCheck: true,
            },
          ]}
          formType={FormType.Update}
          submitButtonText={"Update Password"}
        />
      ) : (
        <p>Your password has been updated.</p>
      )}
    </Card>
  );
};

export default Home;
