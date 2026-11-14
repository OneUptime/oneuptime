import DataObservabilityApi from "./DataObservabilityApi";
import { getDataCheckAlertConditionSentence } from "./DataCheckAlertConditionWords";
import DataCheck from "Common/Models/DatabaseModels/DataCheck";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import {
  DataCheckType,
  DEFAULT_DATA_CHECK_INTERVAL_IN_MINUTES,
} from "Common/Types/DataObservability/DataCheckType";
import { DataObservabilityCheckSuggestion } from "Common/Types/DataObservability/DataObservabilityApiTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import IsolatedLine from "Common/UI/Components/IsolatedText/IsolatedLine";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  dataAssetId: ObjectID;
  onCheckAdded: () => void;
}

/*
 * A row of the card's buttons: spaced by its gap, and starting where the
 * sentence's box and the suggestion's words start. Button keeps a dialog
 * footer's left margin (md:ml-3), which set Write the Check and Add Check
 * 12px in from everything above them; the row clears it on each button, or
 * on one inside the element it sits in, as a card header's actions do
 * (Card's CARD_HEADER_ACTION_CLASS_NAME).
 */
export const CHECK_FROM_SENTENCE_BUTTONS_CLASS_NAME: string =
  "flex flex-wrap gap-2 [&>button]:ml-0 [&>button]:md:ml-0 [&>*>button]:ml-0 [&>*>button]:md:ml-0";

// The suggestion's last line: when the check it writes alerts.
export const CHECK_FROM_SENTENCE_ALERT_TEST_ID: string =
  "check-from-sentence-alert";

// Why the check could not be written or added: the server's words.
export const CHECK_FROM_SENTENCE_ERROR_TEST_ID: string =
  "check-from-sentence-error";

/*
 * "Orders never have a negative total": a rule the team knows, as a check,
 * without writing SQL. OneUptime AI writes one read-only query that counts
 * the rows breaking the rule, held to everything a Custom SQL check is; it
 * is shown to be read before anything is saved, and Add Check makes it a
 * check of this table - with its alert - as any check is made.
 */
const CheckFromSentence: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [sentence, setSentence] = useState<string>("");
  const [suggestion, setSuggestion] =
    useState<DataObservabilityCheckSuggestion | null>(null);
  const [isWorking, setIsWorking] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const write: () => Promise<void> = async (): Promise<void> => {
    setError("");
    setSuggestion(null);
    setIsWorking(true);

    try {
      // The check's name and explanation come back in the reader's language (#7220).
      setSuggestion(
        await DataObservabilityApi.suggestCheck(
          props.dataAssetId,
          sentence,
          translator.language,
        ),
      );
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsWorking(false);
    }
  };

  const add: () => Promise<void> = async (): Promise<void> => {
    if (!suggestion) {
      return;
    }

    setError("");
    setIsWorking(true);

    try {
      const check: DataCheck = new DataCheck();
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

      if (projectId) {
        check.projectId = projectId;
      }

      check.dataAssetId = props.dataAssetId;
      check.name = suggestion.name.slice(0, 100);
      check.description = suggestion.explanation || sentence.slice(0, 500);
      check.checkType = DataCheckType.CustomSql;
      check.customSql = suggestion.customSql;
      check.intervalInMinutes = DEFAULT_DATA_CHECK_INTERVAL_IN_MINUTES;
      check.alertCondition = suggestion.alertCondition;
      check.alertThreshold = suggestion.alertThreshold;

      const response: HTTPResponse<
        JSONObject | JSONArray | DataCheck | Array<DataCheck>
      > = await ModelAPI.create<DataCheck>({
        model: check,
        modelType: DataCheck,
      });
      const createdId: ObjectID | null =
        (response.data as DataCheck | undefined)?.id || null;

      if (createdId) {
        await DataObservabilityApi.syncCheckAlert(createdId);
      }

      setSuggestion(null);
      setSentence("");
      props.onCheckAdded();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsWorking(false);
    }
  };

  /*
   * When the check alerts, as one whole sentence in the reader's language,
   * with the number where that language puts it (DataCheckAlertConditionWords).
   */
  const alertSentence: string | null = suggestion
    ? getDataCheckAlertConditionSentence({
        translator: translator,
        condition: suggestion.alertCondition,
        threshold: suggestion.alertThreshold,
      })
    : null;

  return (
    <Card
      title="Write a Check from a Sentence"
      description="Say a rule this table should hold to, and OneUptime AI writes the check: one read-only query that counts the rows breaking it. You read it before it is added."
    >
      <div className="space-y-3">
        <textarea
          className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          rows={2}
          maxLength={1000}
          value={sentence}
          placeholder={translator.translateText(
            "Orders never have a negative total",
          )}
          aria-label={translator.translateText("The rule, in a sentence")}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
            setSentence(event.target.value);
          }}
        />
        <div className={CHECK_FROM_SENTENCE_BUTTONS_CLASS_NAME}>
          <Button
            title="Write the Check"
            buttonStyle={ButtonStyleType.NORMAL}
            icon={IconProp.Sparkles}
            disabled={isWorking || sentence.trim().length === 0}
            isLoading={isWorking && !suggestion}
            onClick={() => {
              write().catch(() => {});
            }}
          />
        </div>
        {error ? (
          /*
           * Why the check could not be written or added, in the words the
           * server wrote it in - English, whatever the page's language: a
           * line of its own, read the way its words are, so on an Arabic
           * or Persian page it keeps its full stop at its end, as the
           * suggestion's name and explanation do.
           */
          <IsolatedLine
            as="p"
            text={error}
            className="break-words text-sm text-red-600"
            dataTestId={CHECK_FROM_SENTENCE_ERROR_TEST_ID}
          />
        ) : (
          <></>
        )}
        {suggestion ? (
          <div className="space-y-2 rounded-md border border-gray-200 p-4">
            {/*
             * The check's name and what it counts are OneUptime AI's words,
             * asked for in the reader's language but read in whatever
             * language they came back in: each line reads the way it is
             * written, so an English explanation on an Arabic page keeps
             * its full stop at its end.
             */}
            <IsolatedLine
              as="p"
              text={suggestion.name}
              className="break-words text-sm font-medium text-gray-900"
            />
            {suggestion.explanation ? (
              <IsolatedLine
                as="p"
                text={suggestion.explanation}
                className="break-words text-sm text-gray-600"
              />
            ) : (
              <></>
            )}
            <CodeBlock
              code={suggestion.customSql}
              language="sql"
              showCopyButton={true}
              wrapLongLines={true}
            />
            {alertSentence ? (
              <p
                className="text-sm text-gray-600"
                data-testid={CHECK_FROM_SENTENCE_ALERT_TEST_ID}
              >
                {alertSentence}
              </p>
            ) : (
              <></>
            )}
            <div className={CHECK_FROM_SENTENCE_BUTTONS_CLASS_NAME}>
              <Button
                title="Add Check"
                buttonStyle={ButtonStyleType.PRIMARY}
                icon={IconProp.Add}
                disabled={isWorking}
                isLoading={isWorking}
                onClick={() => {
                  add().catch(() => {});
                }}
              />
              <Button
                title="Discard"
                buttonStyle={ButtonStyleType.OUTLINE}
                disabled={isWorking}
                onClick={() => {
                  setSuggestion(null);
                }}
              />
            </div>
          </div>
        ) : (
          <></>
        )}
      </div>
    </Card>
  );
};

export default CheckFromSentence;
