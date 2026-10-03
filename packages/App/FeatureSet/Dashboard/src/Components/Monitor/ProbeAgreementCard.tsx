import ProbesAndIntervalCopy, {
  getProbeAgreementSentenceCount,
  getProbeAgreementText,
  parseProbeAgreement,
  PROBE_AGREEMENT_SENTENCE,
  PROBE_AGREEMENT_TEST_ID,
  ProbeAgreementParseResult,
} from "./ProbesAndIntervalCopy";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import SaveStatus, {
  SaveState,
} from "Common/UI/Components/SaveStatus/SaveStatus";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  ReactNode,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  monitorId: ObjectID;
  /*
   * Monitor.minimumProbeAgreement when the card first draws: how many probes
   * must agree, or null (or undefined) for all of them.
   */
  initialValue: number | null | undefined;
  // Told after a new number is saved; null is all probes.
  onSaved?: ((value: number | null) => void) | undefined;
}

/*
 * How many of a monitor's probes must see the same result before its status
 * changes, on its Probes & Interval page, under the probes it counts. It was
 * a "Probe Agreement Settings" card on the monitor's Settings page, whose
 * Edit dialog held a "Minimum Probe Agreement" number, and it read "All
 * probes must agree" while empty.
 *
 * It is one sentence with the number typed into it: "Change this monitor's
 * status when [ ] probes agree". The empty box reads "all", which is what an
 * empty column means to the server (MonitorResourceUtil.checkProbeAgreement:
 * every probe that is on and connected, and never more than that).
 *
 * Like the Monitoring Interval card above it, it has no Edit button and no
 * dialog. The number is saved when the box is left or Enter is pressed, and
 * only when it changed; Escape puts back what the monitor has. The box says
 * "Saved" once it is; a number the server refuses goes back to the one the
 * monitor has, with the reason under it. Something that is not a number of
 * probes is not sent: it stays in the box with what to type instead.
 * Someone who may not change it sees the box locked, with the permission
 * that is missing.
 */
const ProbeAgreementCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const id: string = useId();
  const errorId: string = `probe-agreement-error-${id}`;
  const noteId: string = `probe-agreement-note-${id}`;

  const initialValue: number | null =
    typeof props.initialValue === "number" ? props.initialValue : null;

  // What the monitor has, as last read or saved. Null is all probes.
  const [savedValue, setSavedValue] = useState<number | null>(initialValue);
  // What is in the box, which may not be a number yet.
  const [text, setText] = useState<string>(getProbeAgreementText(initialValue));
  const [saveState, setSaveState] = useState<SaveState>(SaveState.Idle);
  const [error, setError] = useState<string>("");

  /*
   * Enter saves and leaves the caret in the box; leaving the box next would
   * save again before the first save's state has drawn. This is set at once.
   */
  const isSavingRef: MutableRefObject<boolean> = useRef<boolean>(false);

  const monitor: Monitor = useMemo((): Monitor => {
    return new Monitor();
  }, []);

  /*
   * Read on every render, as a settings switch does: the permissions arrive
   * after the first paint of a fresh sign-in, and a gate kept from then would
   * leave the box locked for someone who may change it.
   */
  const updateGate: PermissionGateResult = PermissionGate.checkColumnUpdate(
    monitor,
    "minimumProbeAgreement",
  );

  const isSaving: boolean = saveState === SaveState.Saving;

  const save: () => Promise<void> = async (): Promise<void> => {
    if (isSavingRef.current || !updateGate.isAllowed) {
      return;
    }

    /*
     * Untouched, the box holds what the monitor has: nothing to save, and
     * nothing to complain about either, even a number the dashboard would
     * not write itself (a 0 set through the API).
     */
    if (text === getProbeAgreementText(savedValue)) {
      setError("");
      return;
    }

    const parsed: ProbeAgreementParseResult = parseProbeAgreement(text);

    if (!parsed.isValid) {
      setSaveState(SaveState.Idle);
      setError(translator.translateText(parsed.error) || parsed.error);
      return;
    }

    if (parsed.value === savedValue) {
      // " 2" or "02" is the number the monitor already has.
      setText(getProbeAgreementText(savedValue));
      setError("");
      return;
    }

    isSavingRef.current = true;
    setSaveState(SaveState.Saving);
    setError("");

    try {
      await ModelAPI.updateById<Monitor>({
        modelType: Monitor,
        id: props.monitorId,
        data: {
          // Null clears the column: all probes.
          minimumProbeAgreement: parsed.value,
        },
      });

      setSavedValue(parsed.value);
      setText(getProbeAgreementText(parsed.value));
      setSaveState(SaveState.Saved);
      props.onSaved?.(parsed.value);
    } catch (err) {
      // Back to the number the monitor still has, with the reason.
      setText(getProbeAgreementText(savedValue));
      setSaveState(SaveState.Idle);
      setError(API.getFriendlyMessage(err));
    }

    isSavingRef.current = false;
  };

  // The number the sentence's words agree with: "1 probe agrees".
  const parsedText: ProbeAgreementParseResult = parseProbeAgreement(text);
  const count: number = getProbeAgreementSentenceCount(
    parsedText.isValid ? parsedText.value : savedValue,
  );

  const box: ReactElement = (
    <span className="inline-flex">
      <Input
        type={InputType.NUMBER}
        value={text}
        placeholder={ProbesAndIntervalCopy.agreementBoxPlaceholder}
        ariaLabel={translator.translateText(
          ProbesAndIntervalCopy.agreementBoxLabel,
        )}
        ariaInvalid={Boolean(error)}
        ariaDescribedby={[noteId, error ? errorId : undefined]
          .filter(Boolean)
          .join(" ")}
        disabled={isSaving || !updateGate.isAllowed}
        dataTestId={PROBE_AGREEMENT_TEST_ID}
        outerDivClassName="relative w-24 rounded-md shadow-sm"
        onChange={(value: string): void => {
          setText(value);
          setSaveState(SaveState.Idle);
          setError("");
        }}
        onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>): void => {
          if (event.key === "Escape" && !isSavingRef.current) {
            setText(getProbeAgreementText(savedValue));
            setSaveState(SaveState.Idle);
            setError("");
          }
        }}
        onEnterPress={(): void => {
          void save();
        }}
        onBlur={(): void => {
          void save();
        }}
      />
    </span>
  );

  return (
    <Card
      title={ProbesAndIntervalCopy.agreementCardTitle}
      description={ProbesAndIntervalCopy.agreementCardDescription}
    >
      {/*
       * A full-bleed row, ruled like the card's own header rule, as on the
       * Monitoring Interval card.
       */}
      <div
        className="-mx-5 -mb-6 border-t border-gray-200 md:-mx-6"
        data-testid={`${PROBE_AGREEMENT_TEST_ID}-card`}
      >
        <div className="px-5 py-4 md:px-6">
          <div
            className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-700"
            data-testid={`${PROBE_AGREEMENT_TEST_ID}-row`}
          >
            <TranslatedSentence
              template={PROBE_AGREEMENT_SENTENCE}
              count={count}
              slots={{
                count: updateGate.isAllowed ? (
                  box
                ) : (
                  <Tooltip text={updateGate.disabledReason}>{box}</Tooltip>
                ),
              }}
              /*
               * Each piece in a span of its own, as a flex item: the row's
               * gap spaces them, and the spaces at their ends, which the line
               * drops, keep the words apart for anything that reads the text.
               */
              renderText={(piece: string): ReactNode => {
                return piece.trim() ? <span>{piece}</span> : null;
              }}
            />
            <SaveStatus
              state={saveState}
              dataTestId={`${PROBE_AGREEMENT_TEST_ID}-status`}
            />
          </div>
          {error ? (
            <p
              id={errorId}
              className="mt-2 text-sm text-red-600"
              role="alert"
              data-testid={`${PROBE_AGREEMENT_TEST_ID}-error`}
            >
              {error}
            </p>
          ) : (
            <></>
          )}
          <p
            id={noteId}
            className="mt-2 text-sm text-gray-500"
            data-testid={`${PROBE_AGREEMENT_TEST_ID}-note`}
          >
            {translator.translateText(ProbesAndIntervalCopy.agreementNote)}
          </p>
        </div>
      </div>
    </Card>
  );
};

export default ProbeAgreementCard;
