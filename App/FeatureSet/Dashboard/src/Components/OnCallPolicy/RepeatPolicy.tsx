import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Icon from "Common/UI/Components/Icon/Icon";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import useAsyncEffect from "use-async-effect";

export interface ComponentProps {
  onCallDutyPolicyId: ObjectID;
}

const RepeatPolicy: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isEnabled, setIsEnabled] = useState<boolean>(false);
  const [repeatCount, setRepeatCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [showEditModal, setShowEditModal] = useState<boolean>(false);

  const loadData: () => Promise<void> = async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError("");

      const policy: OnCallDutyPolicy | null =
        await ModelAPI.getItem<OnCallDutyPolicy>({
          modelType: OnCallDutyPolicy,
          id: props.onCallDutyPolicyId,
          select: {
            repeatPolicyIfNoOneAcknowledges: true,
            repeatPolicyIfNoOneAcknowledgesNoOfTimes: true,
          },
        });

      setIsEnabled(Boolean(policy?.repeatPolicyIfNoOneAcknowledges));
      setRepeatCount(policy?.repeatPolicyIfNoOneAcknowledgesNoOfTimes || 0);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useAsyncEffect(async () => {
    await loadData();
  }, []);

  const getBody: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return (
        <div className="flex w-full justify-center py-10">
          <ComponentLoader />
        </div>
      );
    }

    if (error) {
      return <ErrorMessage message={error} onRefreshClick={loadData} />;
    }

    const enabledAndHasCount: boolean = isEnabled && repeatCount > 0;

    return (
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
              isEnabled
                ? "bg-indigo-50 text-indigo-700 ring-indigo-200"
                : "bg-gray-50 text-gray-600 ring-gray-200"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                isEnabled ? "bg-indigo-500" : "bg-gray-400"
              }`}
            />
            {isEnabled ? "Repeat enabled" : "Repeat disabled"}
          </span>
          <p className="max-w-xl text-sm leading-relaxed text-gray-600">
            {isEnabled ? (
              enabledAndHasCount ? (
                <>
                  If no one acknowledges after the final escalation level, this
                  policy runs again from the top — up to{" "}
                  <span className="font-semibold text-gray-900">
                    {repeatCount} more {repeatCount === 1 ? "time" : "times"}
                  </span>{" "}
                  before it stops.
                </>
              ) : (
                <>
                  Repeating is on, but the number of repeats is set to{" "}
                  <span className="font-semibold text-gray-900">0</span>, so the
                  policy still runs only once. Set a repeat count to have it try
                  again.
                </>
              )
            ) : (
              <>
                The policy runs once through all escalation levels. If no one
                acknowledges, escalation stops here.
              </>
            )}
          </p>
        </div>

        {enabledAndHasCount ? (
          <div className="flex shrink-0 items-center gap-3 self-start rounded-xl bg-gray-50 px-4 py-3 ring-1 ring-inset ring-gray-200 sm:self-auto">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100">
              <Icon
                icon={IconProp.Reload}
                className="h-4 w-4 text-indigo-600"
              />
            </div>
            <div className="leading-tight">
              <div className="text-2xl font-semibold tabular-nums text-gray-900">
                {repeatCount}
              </div>
              <div className="text-xs text-gray-500">
                {repeatCount === 1 ? "repeat" : "repeats"}
              </div>
            </div>
          </div>
        ) : (
          <></>
        )}
      </div>
    );
  };

  return (
    <Fragment>
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        {/* Header */}
        <div className="flex flex-col gap-4 border-b border-gray-100 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 ring-1 ring-inset ring-indigo-200">
              <Icon
                icon={IconProp.Reload}
                className="h-5 w-5 text-indigo-600"
              />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Repeat Policy
              </h2>
              <p className="mt-0.5 text-sm text-gray-500">
                What happens after every escalation level has been exhausted.
              </p>
            </div>
          </div>
          {!isLoading && !error ? (
            <div className="sm:shrink-0">
              <Button
                title="Edit"
                icon={IconProp.Edit}
                buttonStyle={ButtonStyleType.OUTLINE}
                buttonSize={ButtonSize.Small}
                onClick={() => {
                  return setShowEditModal(true);
                }}
              />
            </div>
          ) : (
            <></>
          )}
        </div>

        {/* Body */}
        <div className="p-6">{getBody()}</div>
      </div>

      {/* Edit modal */}
      {showEditModal ? (
        <ModelFormModal<OnCallDutyPolicy>
          title="Edit Repeat Policy"
          name="Edit Repeat Policy"
          description="Decide whether to run the whole on-call policy again if the incident is still unacknowledged."
          modelType={OnCallDutyPolicy}
          modelIdToEdit={props.onCallDutyPolicyId}
          submitButtonText="Save Changes"
          onClose={() => {
            return setShowEditModal(false);
          }}
          onSuccess={() => {
            setShowEditModal(false);
            loadData().catch(() => {});
          }}
          formProps={{
            name: "Edit Repeat Policy",
            modelType: OnCallDutyPolicy,
            id: "edit-repeat-policy-form",
            formType: FormType.Update,
            fields: [
              {
                field: {
                  repeatPolicyIfNoOneAcknowledges: true,
                },
                title: "Repeat if no one acknowledges",
                fieldType: FormFieldSchemaType.Toggle,
                required: false,
                description:
                  "If enabled, the on-call policy restarts from the first escalation rule when no one acknowledges the incident.",
              },
              {
                field: {
                  repeatPolicyIfNoOneAcknowledgesNoOfTimes: true,
                },
                title: "Number of times to repeat",
                fieldType: FormFieldSchemaType.Number,
                required: false,
                placeholder: "3",
                description:
                  "How many times to repeat the on-call policy if no one acknowledges the incident.",
              },
            ],
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default RepeatPolicy;
