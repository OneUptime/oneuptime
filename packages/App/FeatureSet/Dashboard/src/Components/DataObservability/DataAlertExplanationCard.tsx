import DataObservabilityApi from "./DataObservabilityApi";
import {
  DataAlertExplanation,
  DataAlertFeedback,
  DataAlertImpactItem,
  DataAlertLikelyCause,
} from "Common/Types/DataObservability/DataAlertFeedback";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * Why a data alert most likely happened, what it reaches, and what the person
 * handling it makes of it. "Expected" and "Not an Issue" close the alert, and
 * "Not an Issue" retunes what raised it. Nothing for any other alert.
 */

export interface ComponentProps {
  alertId: ObjectID;
}

const FEEDBACK_BUTTONS: ReadonlyArray<{
  feedback: DataAlertFeedback;
  style: ButtonStyleType;
}> = [
  { feedback: DataAlertFeedback.Useful, style: ButtonStyleType.NORMAL },
  { feedback: DataAlertFeedback.Expected, style: ButtonStyleType.NORMAL },
  { feedback: DataAlertFeedback.NotAnIssue, style: ButtonStyleType.NORMAL },
];

const ImpactLine: FunctionComponent<{
  label: string;
  names: Array<string>;
}> = (props: { label: string; names: Array<string> }): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.names.length === 0) {
    return <Fragment />;
  }

  return (
    <div className="text-sm text-gray-700">
      <span className="font-medium text-gray-900">
        {translator.translateText(props.label)}:
      </span>{" "}
      {props.names.join(", ")}
    </div>
  );
};

const DataAlertExplanationCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [explanation, setExplanation] = useState<DataAlertExplanation | null>(
    null,
  );
  const [error, setError] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);

  useEffect(() => {
    let isCurrent: boolean = true;

    DataObservabilityApi.getAlertExplanation(props.alertId)
      .then((answer: DataAlertExplanation | null) => {
        if (isCurrent) {
          setExplanation(answer);
        }
      })
      .catch(() => {
        // Extra to the alert: a page that cannot read it shows the rest.
      });

    return () => {
      isCurrent = false;
    };
  }, [props.alertId.toString()]);

  if (!explanation) {
    return <Fragment />;
  }

  const save: (data: {
    feedback?: DataAlertFeedback;
    isCauseConfirmed?: boolean;
  }) => Promise<void> = async (data: {
    feedback?: DataAlertFeedback;
    isCauseConfirmed?: boolean;
  }): Promise<void> => {
    setIsSaving(true);
    setError("");

    try {
      await DataObservabilityApi.sendAlertFeedback(props.alertId, data);
      setExplanation({
        ...explanation,
        ...(data.feedback ? { feedback: data.feedback } : {}),
        ...(data.isCauseConfirmed !== undefined
          ? { isCauseConfirmed: data.isCauseConfirmed }
          : {}),
      });
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsSaving(false);
  };

  const impactCount: number =
    explanation.impact.tables.length +
    explanation.impact.dashboards.length +
    explanation.impact.services.length +
    explanation.impact.people.length;

  return (
    <Card
      title="Why This Happened"
      description="What the facts around this alert say, most telling first, what depends on what it is about, and what you make of it."
    >
      <div className="space-y-5">
        {error ? <ErrorMessage message={error} /> : <></>}

        {explanation.causes.length === 0 ? (
          <p className="text-sm text-gray-500">
            {translator.translateText(
              "Nothing around this alert explains it: no alert upstream, failed run, deploy, failing write, schema change or database failure.",
            )}
          </p>
        ) : (
          <ol className="space-y-2">
            {explanation.causes.map(
              (cause: DataAlertLikelyCause, index: number): ReactElement => {
                return (
                  <li
                    key={`${cause.kind}:${cause.title}:${index}`}
                    className="text-sm"
                  >
                    <span className="font-medium text-gray-900">
                      {translator.translateText(cause.kind)}
                    </span>
                    <span className="text-gray-700"> · {cause.title}</span>
                    {cause.at ? (
                      <span className="text-gray-500">
                        {" "}
                        ·{" "}
                        {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                          OneUptimeDate.fromString(cause.at),
                        )}
                      </span>
                    ) : (
                      <></>
                    )}
                    {cause.detail ? (
                      <div className="mt-0.5 text-xs text-gray-500">
                        {cause.detail}
                      </div>
                    ) : (
                      <></>
                    )}
                  </li>
                );
              },
            )}
          </ol>
        )}

        {impactCount > 0 ? (
          <div className="space-y-1">
            <ImpactLine
              label="Tables"
              names={explanation.impact.tables.map(
                (table: DataAlertImpactItem): string => {
                  return table.dependents > 0
                    ? `${table.name} (${table.dependents})`
                    : table.name;
                },
              )}
            />
            <ImpactLine
              label="Dashboards"
              names={explanation.impact.dashboards}
            />
            <ImpactLine label="Services" names={explanation.impact.services} />
            <ImpactLine label="Owners" names={explanation.impact.people} />
          </div>
        ) : (
          <></>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-gray-700">
            {translator.translateText("Was this alert useful?")}
          </span>
          {FEEDBACK_BUTTONS.map(
            (button: {
              feedback: DataAlertFeedback;
              style: ButtonStyleType;
            }): ReactElement => {
              return (
                <Button
                  key={button.feedback}
                  title={button.feedback}
                  buttonStyle={
                    explanation.feedback === button.feedback
                      ? ButtonStyleType.PRIMARY
                      : button.style
                  }
                  disabled={isSaving}
                  onClick={() => {
                    void save({ feedback: button.feedback });
                  }}
                />
              );
            },
          )}
        </div>

        {explanation.causes.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-gray-700">
              {translator.translateText("Was the first of these the cause?")}
            </span>
            <Button
              title="Yes"
              buttonStyle={
                explanation.isCauseConfirmed === true
                  ? ButtonStyleType.PRIMARY
                  : ButtonStyleType.NORMAL
              }
              disabled={isSaving}
              onClick={() => {
                void save({ isCauseConfirmed: true });
              }}
            />
            <Button
              title="No"
              buttonStyle={
                explanation.isCauseConfirmed === false
                  ? ButtonStyleType.PRIMARY
                  : ButtonStyleType.NORMAL
              }
              disabled={isSaving}
              onClick={() => {
                void save({ isCauseConfirmed: false });
              }}
            />
          </div>
        ) : (
          <></>
        )}
      </div>
    </Card>
  );
};

export default DataAlertExplanationCard;
