import HuntressConnection from "Common/Models/DatabaseModels/HuntressConnection";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import React, { FunctionComponent, ReactElement, useState } from "react";
import { getHuntressSigningSecretProblem } from "./HuntressSigningSecret";

export interface ComponentProps {
  connectionId: ObjectID;
  // Replacing a saved secret, rather than saving the first one.
  isReplacing: boolean;
  onClose: () => void;
  onSaved: () => void;
}

/*
 * Pastes the signing secret Huntress shows for the endpoint. The secret is
 * write-only - encrypted at rest and never sent back to the browser - so it
 * is only ever replaced, never shown or edited. Huntress signs every
 * delivery with it, and requests are refused until it is saved; a delivery
 * refused before is accepted when Huntress sends it again.
 */
const HuntressSigningSecretModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  return (
    <BasicFormModal<JSONObject>
      title={
        props.isReplacing ? "Replace Signing Secret" : "Save Signing Secret"
      }
      name="Huntress > Signing Secret"
      description="In Huntress, open the endpoint's menu (⋯), choose View Signing Secret, and paste it here. It is encrypted, and never shown again."
      isLoading={isLoading}
      error={error || undefined}
      submitButtonText="Save Signing Secret"
      onClose={() => {
        setIsLoading(false);
        setError("");
        props.onClose();
      }}
      onSubmit={async (data: JSONObject) => {
        const secret: string = ((data["signingSecret"] as string) || "").trim();

        try {
          setIsLoading(true);
          setError("");

          await ModelAPI.updateById<HuntressConnection>({
            modelType: HuntressConnection,
            id: props.connectionId,
            data: {
              signingSecret: secret,
            },
          });
        } catch (err) {
          setError(API.getFriendlyMessage(err));
          setIsLoading(false);
          return;
        }

        setIsLoading(false);
        props.onSaved();
      }}
      formProps={{
        initialValues: {
          signingSecret: "",
        },
        fields: [
          {
            field: {
              signingSecret: true,
            },
            title: "Signing Secret",
            fieldType: FormFieldSchemaType.EncryptedText,
            required: true,
            placeholder: "whsec_…",
            disableSpellCheck: true,
            customValidation: (
              values: FormValues<JSONObject>,
            ): string | null => {
              return getHuntressSigningSecretProblem(
                values["signingSecret"] as string | undefined,
              );
            },
          },
        ],
      }}
    />
  );
};

export default HuntressSigningSecretModal;
