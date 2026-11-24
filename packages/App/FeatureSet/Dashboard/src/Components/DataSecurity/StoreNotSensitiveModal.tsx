import DataStoreFinding from "Common/Models/DatabaseModels/DataStoreFinding";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * "This is not sensitive": a person marks a finding as wrong - a column of
 * test emails, a field that only looks like a card number - and says why.
 * The finding stays on the store's page, marked, and no longer counts
 * toward the store's sensitivity or its checks; the reason is kept with it
 * for whoever looks next, and is the team's precedent for OneUptime AI's
 * verdicts on findings like it (#10372).
 *
 * Where OneUptime AI's verdict was Not sensitive, the reason starts from
 * its draft - the person may change every word, and what they save is
 * their own: OneUptime AI never marks a finding not sensitive itself.
 */

export interface ComponentProps {
  findingId: ObjectID;
  // OneUptime AI's draft of a reason, when its verdict was Not sensitive.
  initialReason?: string | undefined;
  onClose: () => void;
  // Called once the finding is marked.
  onDone: () => void;
}

const StoreNotSensitiveModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const draft: string = (props.initialReason || "").trim();

  return (
    <BasicFormModal<JSONObject>
      title="Mark as Not Sensitive"
      description="It will no longer count toward this store's sensitivity or its checks. You can mark it sensitive again at any time."
      submitButtonText="Mark as Not Sensitive"
      modalWidth={ModalWidth.Medium}
      isSubmitting={isSubmitting}
      error={error}
      onClose={props.onClose}
      formProps={{
        name: "data-store-finding-not-sensitive",
        ...(draft ? { initialValues: { reason: draft } } : {}),
        fields: [
          {
            field: { reason: true },
            title: "Why is it not sensitive?",
            description: draft
              ? "OneUptime AI drafted this from your team's decisions. Change it as you need: it is kept as your reason."
              : "Kept with the finding, for whoever looks at it next.",
            fieldType: FormFieldSchemaType.LongText,
            required: true,
            placeholder:
              "e.g. These are test accounts made by our seed script.",
          },
        ],
      }}
      onSubmit={async (values: FormValues<JSONObject>) => {
        setIsSubmitting(true);
        setError("");

        try {
          const reason: string =
            typeof values["reason"] === "string"
              ? (values["reason"] as string).trim()
              : "";

          await ModelAPI.updateById<DataStoreFinding>({
            modelType: DataStoreFinding,
            id: props.findingId,
            data: {
              isSuppressed: true,
              suppressedReason: reason,
            },
          });

          setIsSubmitting(false);
          props.onDone();
        } catch (err) {
          setError(API.getFriendlyMessage(err));
          setIsSubmitting(false);
        }
      }}
    />
  );
};

export default StoreNotSensitiveModal;
