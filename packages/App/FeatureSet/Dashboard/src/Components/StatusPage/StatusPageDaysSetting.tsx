import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import { Yellow } from "Common/Types/BrandColors";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import Pill from "Common/UI/Components/Pill/Pill";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useId,
  useRef,
  useState,
} from "react";
import StatusPageDisplaySettingsCopy, {
  DaysParseResult,
  DISPLAY_DAYS_SENTENCE,
  DisplayDaysColumn,
  parseDisplayDays,
} from "./StatusPageDisplaySettingsCopy";
import { getPlanNeededToChange } from "./StatusPageSwitchRow";

/*
 * How many days of something a status page shows - its incidents, its
 * announcements, its uptime bars - as one sentence with the number typed
 * into it: "Show the last [14] days".
 *
 * Like the switches beside it (StatusPageSwitchRow) it has no Edit button
 * and no dialog: the number is saved when the box is left or Enter is
 * pressed, and only when it changed; Escape puts back the number the page
 * has. The box is locked while it saves and
 * says "Saved" when it has; a number the server refuses goes back to the
 * one the page has, with the reason under it. A number the column cannot
 * hold (not a whole number, under 1, over the column's limit) is not sent
 * at all: it stays in the box with what to type instead.
 *
 * Someone who may not edit the status page sees the number locked, with the
 * permission that is missing. Where a plan has to be upgraded to change it,
 * the plan's name is beside it, as on the switches.
 */

export interface ComponentProps {
  statusPageId: ObjectID;
  column: DisplayDaysColumn;
  // What the column holds when the row first draws.
  initialValue: number;
  // The box's accessible name (English): the setting's own name.
  label: string;
  // The most days the column may hold. No upper limit when left out.
  maxDays?: number | undefined;
  // The id of a line elsewhere that says what the number is for.
  ariaDescribedby?: string | undefined;
  // Told after a new number is saved.
  onSaved?: ((days: number) => void) | undefined;
  dataTestId: string;
}

enum SaveState {
  Idle = "Idle",
  Saving = "Saving",
  Saved = "Saved",
}

const StatusPageDaysSetting: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const errorId: string = `days-setting-error-${useId()}`;

  // The number the page has, as last read or saved.
  const [savedDays, setSavedDays] = useState<number>(props.initialValue);
  // What is in the box, which may not be a number yet.
  const [text, setText] = useState<string>(String(props.initialValue));
  const [saveState, setSaveState] = useState<SaveState>(SaveState.Idle);
  const [error, setError] = useState<string>("");
  /*
   * Enter saves and leaves the caret in the box; leaving the box next would
   * save again before the first save's state has drawn. This is set at once.
   */
  const isSavingRef: React.MutableRefObject<boolean> = useRef<boolean>(false);

  const updateGate: PermissionGateResult = PermissionGate.check(
    new StatusPage(),
    ModelAction.Update,
  );

  const planNeeded: PlanType | null = getPlanNeededToChange(props.column);
  const isSaving: boolean = saveState === SaveState.Saving;

  const save: () => Promise<void> = async (): Promise<void> => {
    if (isSavingRef.current || !updateGate.isAllowed) {
      return;
    }

    const parsed: DaysParseResult = parseDisplayDays(text, props.maxDays);

    if (!parsed.isValid) {
      setSaveState(SaveState.Idle);
      setError(translator.translateTemplate(parsed.error, parsed.values));
      return;
    }

    if (parsed.days === savedDays) {
      // "014" or " 14" is the number the page already has.
      setText(String(savedDays));
      setError("");
      return;
    }

    isSavingRef.current = true;
    setSaveState(SaveState.Saving);
    setError("");

    try {
      await ModelAPI.updateById<StatusPage>({
        modelType: StatusPage,
        id: props.statusPageId,
        data: { [props.column]: parsed.days } as JSONObject,
      });

      setSavedDays(parsed.days);
      setText(String(parsed.days));
      setSaveState(SaveState.Saved);
      props.onSaved?.(parsed.days);
    } catch (err) {
      // Back to the number the page still has, with the reason.
      setText(String(savedDays));
      setSaveState(SaveState.Idle);
      setError(API.getFriendlyMessage(err));
    }

    isSavingRef.current = false;
  };

  // The number the sentence's words agree with: "1 day", "14 days".
  const parsedText: DaysParseResult = parseDisplayDays(text);
  const count: number = parsedText.isValid ? parsedText.days : savedDays;

  const box: ReactElement = (
    <span className="inline-flex">
      <Input
        type={InputType.NUMBER}
        value={text}
        ariaLabel={translator.translateText(props.label)}
        ariaInvalid={Boolean(error)}
        ariaDescribedby={
          [props.ariaDescribedby, error ? errorId : undefined]
            .filter(Boolean)
            .join(" ") || undefined
        }
        disabled={isSaving || !updateGate.isAllowed}
        dataTestId={props.dataTestId}
        outerDivClassName="relative w-20 rounded-md shadow-sm"
        onChange={(value: string): void => {
          setText(value);
          setSaveState(SaveState.Idle);
          setError("");
        }}
        onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>): void => {
          if (event.key === "Escape" && !isSavingRef.current) {
            setText(String(savedDays));
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

  const getSaveStateElement: () => ReactNode = (): ReactNode => {
    if (saveState === SaveState.Saving) {
      return (
        <span className="text-gray-500">
          {translator.translateText(StatusPageDisplaySettingsCopy.saving)}
        </span>
      );
    }

    if (saveState === SaveState.Saved) {
      return (
        <span className="inline-flex items-center gap-1 text-emerald-700">
          <Icon icon={IconProp.Check} className="h-4 w-4" />
          {translator.translateText(StatusPageDisplaySettingsCopy.saved)}
        </span>
      );
    }

    return null;
  };

  return (
    /*
     * As on a switch's row: the plan's pill sits to the right of the
     * sentence from sm up, and under it on a phone.
     */
    <div
      className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
      data-testid={`${props.dataTestId}-row`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-700">
          <TranslatedSentence
            template={DISPLAY_DAYS_SENTENCE}
            count={count}
            slots={{
              count: updateGate.isAllowed ? (
                box
              ) : (
                <Tooltip text={updateGate.disabledReason}>{box}</Tooltip>
              ),
            }}
            /*
             * Each piece in a span of its own, as a flex item: the row's gap
             * spaces them, and the spaces at their ends, which the line
             * drops, keep the words apart for anything that reads the text.
             */
            renderText={(piece: string): ReactNode => {
              return piece.trim() ? <span>{piece}</span> : null;
            }}
          />
          <span
            role="status"
            className="inline-flex items-center"
            data-testid={`${props.dataTestId}-status`}
          >
            {getSaveStateElement()}
          </span>
        </div>
        {error ? (
          <p
            id={errorId}
            className="mt-1 text-sm text-red-600"
            role="alert"
            data-testid={`${props.dataTestId}-error`}
          >
            {error}
          </p>
        ) : (
          <></>
        )}
      </div>
      {planNeeded ? (
        <div className="flex-shrink-0 sm:pt-0.5">
          <Pill
            text={translator.translateTemplate("{{planName}} Plan", {
              planName: planNeeded,
            })}
            color={Yellow}
          />
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default StatusPageDaysSetting;
