import DropFilterImpactApi, {
  DropFilterImpactRule,
  getDropFilterImpactRequest,
} from "./DropFilterImpactApi";
import DropFilterImpactSummary from "./DropFilterImpactSummary";
import {
  CONFIRM_CREATE_BUTTON,
  CONFIRM_CREATE_TITLE,
  CONFIRM_SAVE_BUTTON,
  CONFIRM_SAVE_TITLE,
} from "./DropFilterImpactWords";
import {
  DropFilterImpact,
  DropFilterImpactRequest,
  isDropFilterImpactRead,
} from "Common/Types/Telemetry/DropFilterImpact";
import { TelemetryFieldSignal } from "Common/Types/Telemetry/TelemetryFieldReaders";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FormSubmitCancelled from "Common/UI/Components/Forms/Types/FormSubmitCancelled";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import React, { ReactElement, useRef, useState } from "react";

/*
 * BEFORE A FILTER THAT TAKES WHAT OTHERS READ IS SAVED, ASK (#10436).
 *
 * The form says, as the filter is written, what it would take
 * (DropFilterImpactPreview). When the person saves it and something reads
 * what it takes - Security Events, a monitor, an SLO, a dashboard, a
 * recording rule, a saved view - this asks once more, in a dialog over the
 * form: the one line, every detail open, and Create Filter or Cancel. It
 * never blocks: the answer is the person's. A filter nothing reads saves
 * without a question, and so does one the server could not check (the
 * form said so already), so a slow or failed answer never stands between a
 * person and their save.
 *
 * Used from a form's onBeforeCreate or onBeforeUpdate: `confirmOrCancel`
 * throws FormSubmitCancelled for a "no", which the form takes quietly.
 */

export enum DropFilterSavePurpose {
  Create = "create",
  Save = "save",
}

interface PendingQuestion {
  impact: DropFilterImpact;
  purpose: DropFilterSavePurpose;
  answer: (isConfirmed: boolean) => void;
}

export interface DropFilterImpactConfirmation {
  // Resolves true to go on, false when the person called the save back.
  confirm: (data: {
    signal: TelemetryFieldSignal;
    rule: DropFilterImpactRule;
    purpose: DropFilterSavePurpose;
  }) => Promise<boolean>;
  // The same, for a form's hook: throws FormSubmitCancelled for a "no".
  confirmOrCancel: (data: {
    signal: TelemetryFieldSignal;
    rule: DropFilterImpactRule;
    purpose: DropFilterSavePurpose;
  }) => Promise<void>;
  // The dialog, drawn wherever the page puts it.
  confirmation: ReactElement;
}

/*
 * The impact a save would ask about, or null when it asks nothing: no
 * question to put, nothing reads what the filter takes, or no answer.
 */
export async function getImpactToConfirm(data: {
  signal: TelemetryFieldSignal;
  rule: DropFilterImpactRule;
}): Promise<DropFilterImpact | null> {
  const request: DropFilterImpactRequest | null = getDropFilterImpactRequest(
    data.signal,
    data.rule,
  );

  if (!request) {
    return null;
  }

  try {
    const impact: DropFilterImpact =
      await DropFilterImpactApi.getImpact(request);

    return isDropFilterImpactRead(impact) ? impact : null;
  } catch {
    // The form said it could not check; the save is the person's.
    return null;
  }
}

export default function useDropFilterImpactConfirmation(): DropFilterImpactConfirmation {
  const [pending, setPending] = useState<PendingQuestion | null>(null);
  const pendingRef: React.MutableRefObject<PendingQuestion | null> =
    useRef<PendingQuestion | null>(null);

  const answer: (isConfirmed: boolean) => void = (
    isConfirmed: boolean,
  ): void => {
    const question: PendingQuestion | null = pendingRef.current;

    pendingRef.current = null;
    setPending(null);
    question?.answer(isConfirmed);
  };

  const confirm: DropFilterImpactConfirmation["confirm"] = async (data: {
    signal: TelemetryFieldSignal;
    rule: DropFilterImpactRule;
    purpose: DropFilterSavePurpose;
  }): Promise<boolean> => {
    const impact: DropFilterImpact | null = await getImpactToConfirm(data);

    if (!impact) {
      return true;
    }

    return await new Promise<boolean>(
      (resolve: (isConfirmed: boolean) => void) => {
        // A question still open is answered no: one dialog at a time.
        pendingRef.current?.answer(false);

        const question: PendingQuestion = {
          impact,
          purpose: data.purpose,
          answer: resolve,
        };

        pendingRef.current = question;
        setPending(question);
      },
    );
  };

  const confirmOrCancel: DropFilterImpactConfirmation["confirmOrCancel"] =
    async (data: {
      signal: TelemetryFieldSignal;
      rule: DropFilterImpactRule;
      purpose: DropFilterSavePurpose;
    }): Promise<void> => {
      if (!(await confirm(data))) {
        throw new FormSubmitCancelled();
      }
    };

  const isCreate: boolean = pending?.purpose === DropFilterSavePurpose.Create;

  return {
    confirm,
    confirmOrCancel,
    confirmation: pending ? (
      <ConfirmModal
        title={isCreate ? CONFIRM_CREATE_TITLE : CONFIRM_SAVE_TITLE}
        description={
          <div data-testid="drop-filter-impact-confirmation">
            <DropFilterImpactSummary
              impact={pending.impact}
              isDetailsOpen={true}
              dataTestId="drop-filter-impact-confirmation-summary"
            />
          </div>
        }
        submitButtonText={
          isCreate ? CONFIRM_CREATE_BUTTON : CONFIRM_SAVE_BUTTON
        }
        submitButtonType={ButtonStyleType.PRIMARY}
        onSubmit={() => {
          answer(true);
        }}
        onClose={() => {
          answer(false);
        }}
      />
    ) : (
      <></>
    ),
  };
}
