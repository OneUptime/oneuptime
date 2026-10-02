import FormsCopy from "./FormsCopy";
import Form from "Common/Models/DatabaseModels/Form";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
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
 * Whether the form takes submissions, as one switch: flipping it saves at
 * once (there is nothing else to fill in), and the switch shows the new
 * state only once the server has it. While it is off the link shows a
 * not-available message - the form, its questions and its link are kept.
 *
 * Someone who may not edit the form sees the switch, locked, with the reason.
 */

export interface ComponentProps {
  formId: ObjectID;
  // Told after a change is saved, so the Share Link card can say so too.
  onChange?: ((isEnabled: boolean) => void) | undefined;
}

const FormStatusCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isEnabled, setIsEnabled] = useState<boolean | null>(null);
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
        select: { isEnabled: true },
      });

      if (form) {
        // The column defaults to on, so only an explicit false is off.
        setIsEnabled(form.isEnabled !== false);
      } else {
        setError(FormsCopy.shareLinkNotFound);
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

    setIsSaving(true);
    setError("");

    try {
      await ModelAPI.updateById<Form>({
        modelType: Form,
        id: props.formId,
        data: { isEnabled: value },
      });

      setIsEnabled(value);
      props.onChange?.(value);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsSaving(false);
  };

  const getBody: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return <ComponentLoader />;
    }

    if (isEnabled === null) {
      return <ErrorMessage message={error || FormsCopy.shareLinkNotFound} />;
    }

    return (
      <div className="space-y-3">
        <Toggle
          title={FormsCopy.acceptingSubmissions}
          description={
            isEnabled
              ? FormsCopy.acceptingSubmissionsOn
              : FormsCopy.acceptingSubmissionsOff
          }
          value={isEnabled}
          disabled={isSaving || !updateGate.isAllowed}
          tooltip={updateGate.disabledReason}
          dataTestId="form-accepting-submissions"
          onChange={(value: boolean) => {
            void change(value);
          }}
        />
        {error ? (
          <Alert
            type={AlertType.DANGER}
            title={<span>{error}</span>}
            dataTestId="form-status-error"
          />
        ) : (
          <></>
        )}
      </div>
    );
  };

  return (
    <Card
      title={FormsCopy.statusCardTitle}
      description={FormsCopy.statusCardDescription}
    >
      {getBody()}
    </Card>
  );
};

export default FormStatusCard;
