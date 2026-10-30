import {
  ADD_TO_CASE,
  ADDED_TO_CASE_NUMBER,
  ALREADY_ON_CASE_NUMBER,
  HUNTS_TEST_IDS,
} from "./HuntsCopy";
import { CaseEventReference, getCaseEventReferences } from "./AddToCaseModel";
import AddToCaseModal, { PickedCase } from "./AddToCaseModal";
import { getAddToCaseGate, getCaseEvidenceRoute } from "./useAddEventsToCase";
import SecurityCaseApi from "../../SecurityCase/SecurityCaseApi";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  SECURITY_CASE_EVENTS_ADD_REASONS,
  SecurityCaseEventsAddResult,
} from "Common/Types/SecurityCase/SecurityCaseEventEvidence";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import API from "Common/UI/Utils/API/API";
import { PermissionGateResult } from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  securityEvent: SecurityEvent;
  // The hunt the event was found by, when the list is a hunt's.
  huntId?: ObjectID | undefined;
}

// What the last Add to Case said.
interface AddOutcome {
  kind: "added" | "already" | "failed";
  securityCase?: PickedCase | undefined;
  message?: string | undefined;
}

/*
 * "Add to Case" in an event's panel: the event kept on the open case
 * picked, as evidence, and a line under the button that says so - the
 * case's number a link to its Evidence page - or why it was not.
 */
const AddEventToCaseButton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isPicking, setIsPicking] = useState<boolean>(false);
  const [isAdding, setIsAdding] = useState<boolean>(false);
  const [outcome, setOutcome] = useState<AddOutcome | null>(null);

  const gate: PermissionGateResult = getAddToCaseGate();
  const references: Array<CaseEventReference> = getCaseEventReferences([
    props.securityEvent,
  ]);

  const add: (picked: PickedCase) => Promise<void> = async (
    picked: PickedCase,
  ): Promise<void> => {
    setIsPicking(false);
    setIsAdding(true);
    setOutcome(null);

    try {
      const result: SecurityCaseEventsAddResult =
        await SecurityCaseApi.addEventsToCase({
          caseId: new ObjectID(picked.id),
          events: references,
          huntId: props.huntId,
        });

      if (result.added.length > 0) {
        setOutcome({ kind: "added", securityCase: picked });
      } else if (result.alreadyOnCase.length > 0) {
        setOutcome({ kind: "already", securityCase: picked });
      } else {
        setOutcome({
          kind: "failed",
          message: SECURITY_CASE_EVENTS_ADD_REASONS.notFound.message,
        });
      }
    } catch (err) {
      setOutcome({ kind: "failed", message: API.getFriendlyMessage(err) });
    }

    setIsAdding(false);
  };

  const caseLink: (picked: PickedCase) => ReactElement = (
    picked: PickedCase,
  ): ReactElement => {
    return (
      <Link
        to={getCaseEvidenceRoute(picked.id)}
        className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
      >
        {picked.number || picked.id}
      </Link>
    );
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        title={ADD_TO_CASE}
        icon={IconProp.PaperClip}
        buttonStyle={ButtonStyleType.OUTLINE}
        buttonSize={ButtonSize.Small}
        isLoading={isAdding}
        disabled={!gate.isAllowed || isAdding || references.length === 0}
        tooltip={gate.isAllowed ? undefined : gate.disabledReason}
        dataTestId={HUNTS_TEST_IDS.addToCase}
        onClick={() => {
          setIsPicking(true);
        }}
      />
      {outcome &&
      (outcome.kind === "added" || outcome.kind === "already") &&
      outcome.securityCase ? (
        /*
         * Kept now: a green check before it, as a step done reads. Kept
         * already: the same line, plain - nothing changed.
         */
        <div
          className="flex items-center gap-1 text-xs text-gray-600"
          role="status"
          data-testid={HUNTS_TEST_IDS.addToCaseResult}
          data-outcome={outcome.kind}
        >
          {outcome.kind === "added" ? (
            <Icon
              icon={IconProp.CheckCircle}
              className="h-3.5 w-3.5 shrink-0 text-green-600"
            />
          ) : (
            <></>
          )}
          <span>
            <TranslatedSentence
              template={
                outcome.kind === "added"
                  ? ADDED_TO_CASE_NUMBER
                  : ALREADY_ON_CASE_NUMBER
              }
              slots={{ case: caseLink(outcome.securityCase) }}
            />
          </span>
        </div>
      ) : (
        <></>
      )}
      {outcome?.kind === "failed" ? (
        <p
          className="text-xs text-red-600"
          role="alert"
          data-testid={HUNTS_TEST_IDS.addToCaseResult}
        >
          {translator.translateText(outcome.message) || outcome.message}
        </p>
      ) : (
        <></>
      )}
      {isPicking ? (
        <AddToCaseModal
          eventCount={1}
          onClose={() => {
            setIsPicking(false);
          }}
          onPick={(picked: PickedCase) => {
            void add(picked);
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default AddEventToCaseButton;
