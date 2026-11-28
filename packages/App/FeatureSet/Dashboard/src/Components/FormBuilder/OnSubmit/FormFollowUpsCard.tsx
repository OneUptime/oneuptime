import FormsCopy from "../FormsCopy";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import Form from "Common/Models/DatabaseModels/Form";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { ErrorInSentence } from "Common/UI/Components/ErrorMessage/ErrorSentence";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import React, { FunctionComponent, ReactElement, useState } from "react";
import useAsyncEffect from "use-async-effect";

/*
 * A form's follow-ups (Common/Types/Form/FormFollowUp), on its On Submit
 * page - what happens after somebody submits - as one switch that saves at
 * once, as Accepting Submissions does: while it is on, the person who
 * submits is emailed a private link to what they sent, where they read its
 * state, write to the team and add others; the team replies from the
 * record's page. Off, nothing is sent to anybody and every link of the
 * form's follow-ups stops working.
 *
 * The switch moves at once and is locked while the change is saved; a
 * refused change moves it back, with the reason. Someone who may not edit
 * the form sees it locked, with the reason.
 */

export interface ComponentProps {
  formId: ObjectID;
}

const FormFollowUpsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isOn, setIsOn] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const updateGate: PermissionGateResult = PermissionGate.check(
    new Form(),
    ModelAction.Update,
  );

  useAsyncEffect(async () => {
    setIsLoading(true);
    setError("");

    try {
      const form: Form | null = await ModelAPI.getItem<Form>({
        modelType: Form,
        id: props.formId,
        select: { enableFollowUps: true },
      });

      if (form) {
        setIsOn(form.enableFollowUps === true);
      } else {
        setError(FormsCopy.formNotFound);
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  }, [props.formId.toString()]);

  const change: (value: boolean) => Promise<void> = async (
    value: boolean,
  ): Promise<void> => {
    if (isSaving || !updateGate.isAllowed) {
      return;
    }

    const previous: boolean | null = isOn;

    // The switch has already moved: the card follows it, and moves it back on a refusal.
    setIsOn(value);
    setIsSaving(true);
    setError("");

    try {
      await ModelAPI.updateById<Form>({
        modelType: Form,
        id: props.formId,
        data: { enableFollowUps: value },
      });
    } catch (err) {
      setIsOn(previous);
      setError(API.getFriendlyMessage(err));
    }

    setIsSaving(false);
  };

  const getBody: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return <DetailListSkeleton fields={1} columns={1} />;
    }

    if (isOn === null) {
      return <ErrorMessage message={error || FormsCopy.formNotFound} />;
    }

    return (
      <div className="space-y-3">
        <Toggle
          title={FormsCopy.followUpsToggle}
          description={isOn ? FormsCopy.followUpsOn : FormsCopy.followUpsOff}
          value={isOn}
          disabled={isSaving || !updateGate.isAllowed}
          tooltip={updateGate.disabledReason}
          // The permission check words its reason in the reader's language.
          isTooltipTranslated={true}
          dataTestId="form-follow-ups"
          onChange={(value: boolean) => {
            void change(value);
          }}
        />
        {error ? (
          <Alert
            type={AlertType.DANGER}
            title={
              <span>
                <ErrorInSentence message={error} showWhereToLook={true} />
              </span>
            }
            dataTestId="form-follow-ups-error"
          />
        ) : (
          <></>
        )}
      </div>
    );
  };

  return (
    <Card
      title={FormsCopy.followUpsCardTitle}
      description={FormsCopy.followUpsCardDescription}
    >
      {getBody()}
    </Card>
  );
};

export default FormFollowUpsCard;
