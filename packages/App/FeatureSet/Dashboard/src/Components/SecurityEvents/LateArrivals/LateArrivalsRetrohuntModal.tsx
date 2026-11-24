import {
  LATE_ARRIVALS_CHOOSE_RULE,
  LATE_ARRIVALS_NO_RULES,
  LATE_ARRIVALS_RULE_LABEL,
  LATE_ARRIVALS_RUN_DESCRIPTION,
  LATE_ARRIVALS_TEST_IDS,
} from "./LateArrivalsCopy";
import DetectionRuleRetrohuntPanel from "../Retrohunt/DetectionRuleRetrohuntPanel";
import { RUN_ON_PAST_EVENTS } from "../Retrohunt/RetrohuntCopy";
import { buildRetrohuntRequest } from "../Retrohunt/RetrohuntModel";
import DetectionRule from "Common/Models/DatabaseModels/DetectionRule";
import { JSONObject } from "Common/Types/JSON";
import {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import { DropdownChange } from "Common/UI/Components/Dropdown/DropdownChange";
import EntityDropdown from "Common/UI/Components/EntityDropdown/EntityDropdown";
import { ErrorInSentence } from "Common/UI/Components/ErrorMessage/ErrorSentence";
import InlineLoadingLine from "Common/UI/Components/Loader/InlineLoadingLine";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * The rules the dialog offers: the project's, searched on the server as the
 * picker is typed in, 50 by name (EntityDropdown). It read the first 500 by
 * name, so a rule past them could not be run on past events (#10646).
 */
export const LATE_ARRIVALS_RULE_PICKER: {
  modelType: typeof DetectionRule;
  labelField: string;
  valueField: string;
} = {
  modelType: DetectionRule,
  labelField: "name",
  valueField: "_id",
};

export interface ComponentProps {
  // The period Run on Past Events starts on: the one that reaches back to the late events.
  initialPeriodInHours: number;
  onClose: () => void;
}

/*
 * Run on Past Events on the events that arrived too late for the rules
 * (#10491): the person chooses a rule, and it runs, with its exceptions,
 * over the period that reaches back to when they happened - as a rule's own
 * Run on Past Events does. Read only: Close, and nothing to submit.
 */
const LateArrivalsRetrohuntModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  // Whether the project has a rule at all: one read, of one rule.
  const [hasRules, setHasRules] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [chosen, setChosen] = useState<DropdownOption | null>(null);
  const ruleId: string = chosen ? String(chosen.value) : "";

  useEffect(() => {
    let isCurrent: boolean = true;

    ModelAPI.getList<DetectionRule>({
      modelType: DetectionRule,
      query: {
        projectId: ProjectUtil.getCurrentProjectId()!,
      },
      select: {
        _id: true,
      },
      sort: {},
      skip: 0,
      limit: 1,
    })
      .then((result: ListResult<DetectionRule>) => {
        if (!isCurrent) {
          return;
        }

        setHasRules(result.data.length > 0);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (!isCurrent) {
          return;
        }

        setError(API.getFriendlyMessage(err));
        setIsLoading(false);
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  return (
    <Modal
      title={RUN_ON_PAST_EVENTS}
      // English, looked up by the dialog.
      description={LATE_ARRIVALS_RUN_DESCRIPTION}
      modalWidth={ModalWidth.Medium}
      onClose={props.onClose}
      closeButtonText="Close"
    >
      <div className="space-y-4" data-testid={LATE_ARRIVALS_TEST_IDS.modal}>
        {isLoading ? <InlineLoadingLine text="Loading…" /> : <></>}

        {!isLoading && error ? (
          // A div, not a p: the error's sentence may hold a block of its own.
          <div role="alert" className="text-sm text-red-700">
            <ErrorInSentence message={error} showWhereToLook={true} />
          </div>
        ) : (
          <></>
        )}

        {!isLoading && !error && !hasRules ? (
          <p
            className="text-sm text-gray-600"
            data-testid={LATE_ARRIVALS_TEST_IDS.noRules}
          >
            {translator.translateText(LATE_ARRIVALS_NO_RULES)}
          </p>
        ) : (
          <></>
        )}

        {!isLoading && !error && hasRules ? (
          <EntityDropdown
            {...LATE_ARRIVALS_RULE_PICKER}
            className="relative w-full"
            value={chosen || undefined}
            placeholder={LATE_ARRIVALS_CHOOSE_RULE}
            ariaLabel={translator.translateText(LATE_ARRIVALS_RULE_LABEL)}
            isClearable={false}
            dataTestId={LATE_ARRIVALS_TEST_IDS.rule}
            onChange={(
              value: DropdownValue | Array<DropdownValue> | null,
              change: DropdownChange,
            ) => {
              if (typeof value !== "string" || !value) {
                setChosen(null);
                return;
              }

              // A rule's name is a person's: drawn as written.
              setChosen({
                value: value,
                label: change.selectedOptions[0]?.label || value,
                isUserContent: true,
              });
            }}
          />
        ) : (
          <></>
        )}

        {ruleId ? (
          /*
           * A panel of its own for each rule: choosing another runs it, on
           * the period the dialog opened on.
           */
          <DetectionRuleRetrohuntPanel
            key={ruleId}
            initialPeriodInHours={props.initialPeriodInHours}
            getRequest={(periodInHours: number): JSONObject => {
              return buildRetrohuntRequest(
                { detectionRuleId: ruleId },
                periodInHours,
              );
            }}
          />
        ) : (
          <></>
        )}
      </div>
    </Modal>
  );
};

export default LateArrivalsRetrohuntModal;
