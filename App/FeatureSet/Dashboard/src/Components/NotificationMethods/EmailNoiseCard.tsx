import Card from "Common/UI/Components/Card/Card";
import API from "Common/UI/Utils/API/API";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, {
  FunctionComponent,
  ReactElement,
  useRef,
  useState,
} from "react";

interface ComponentProps {
  onApply: () => Promise<void>;
  disabled?: boolean;
}

const EmailNoiseCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const applying: React.MutableRefObject<boolean> = useRef<boolean>(false);
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [isApplied, setIsApplied] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const apply: () => Promise<void> = async (): Promise<void> => {
    if (applying.current || props.disabled) {
      return;
    }

    applying.current = true;
    setIsBusy(true);
    setIsApplied(false);
    setError("");

    try {
      await props.onApply();
      setIsApplied(true);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      applying.current = false;
      setIsBusy(false);
    }
  };

  return (
    <Card
      title="Fewer routine emails"
      description="Keep the updates that need your attention."
      bodyClassName="mt-5"
    >
      <React.Fragment>
        <p className="max-w-3xl text-sm text-gray-600">
          {translateString(
            "Turn off emails about notes, being added as an owner, new monitors and status pages, items added to episodes, and on-call policy membership changes.",
          )}
        </p>
        <p className="mt-2 max-w-3xl text-sm text-gray-600">
          {translateString(
            "Your choices for incident and alert creation, state changes, reminders, assignments, monitor health, and on-call shifts stay as they are. Other notification channels, paging, account and billing emails are unaffected.",
          )}
        </p>
        <p className="mt-2 text-sm text-gray-600">
          {translateString(
            "Applies to you in this project. You can turn individual emails back on below.",
          )}
        </p>
        <button
          type="button"
          onClick={apply}
          disabled={isBusy || props.disabled}
          className="mt-4 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-60"
        >
          {translateString(
            isBusy ? "Saving email preferences…" : "Reduce routine emails",
          )}
        </button>
        {isApplied ? (
          <p role="status" className="mt-3 text-sm text-emerald-700">
            {translateString(
              "Routine emails turned off. Review or change individual preferences below.",
            )}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}
      </React.Fragment>
    </Card>
  );
};

export default EmailNoiseCard;
