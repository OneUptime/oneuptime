import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import { Yellow } from "../../../Types/BrandColors";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import API from "../../Utils/API/API";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateResult,
} from "../../Utils/PermissionGate";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import { ButtonStyleType } from "../Button/Button";
import Icon from "../Icon/Icon";
import ConfirmModal from "../Modal/ConfirmModal";
import Pill from "../Pill/Pill";
import Toggle from "../Toggle/Toggle";
import {
  announceModelSwitchSaved,
  subscribeToModelSwitchSaved,
} from "./ModelSwitchEvents";
import {
  getModelSwitchWrite,
  getPlanNeededToChangeColumn,
  getPlanNeededToFlipSwitch,
  getSwitchPlanLeftover,
  MODEL_SWITCH_CHILDREN_CLASS_NAME,
  ModelSwitchChild,
  ModelSwitchColumn,
  SWITCH_PLAN_LEFTOVER_COPY,
  SWITCH_PLAN_LOCKED_COPY,
  SwitchPlanLeftover,
} from "./ModelSwitchUtil";
import React, {
  MutableRefObject,
  ReactElement,
  ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

/*
 * One switch for one boolean column of one record, that saves the moment it
 * is flipped. A setting with nothing else to fill in needs no Edit button
 * and no dialog: a card whose Edit dialog held a single switch took Edit,
 * flip, Save for one yes or no.
 *
 * - The switch moves at once and is locked while the change is saved, then
 *   says "Saved" beside it.
 * - A change the server refuses moves it back and says why under it (a plan
 *   that does not include it, a setting the project has off), so it never
 *   shows a state the record is not in.
 * - Someone who may not change the column sees the switch locked, with the
 *   permission that is missing. That is read from the column's own update
 *   permissions as well as the record's (PermissionGate.checkColumnUpdate):
 *   many columns are narrower than their table, and the server holds the
 *   write to both.
 * - Where a plan has to be upgraded for the switch to be changed, the plan's
 *   name is beside it before anyone tries - the same pill a table shows for
 *   a plan feature.
 * - A paid feature can always be switched off, on any plan: the server takes
 *   the column back to its default whatever the plan (see
 *   PlanGatedColumnDefault). So a switch a trial left on - email reports on
 *   a project now on Free, say - can still be flipped back, and the row says
 *   so under the switch, with the plan it takes to flip it again
 *   (getSwitchPlanLeftover). Flipping it on keeps needing the plan: the pill
 *   says which, and the server's refusal says it again.
 * - A switch whose change can lock people out (requiring SSO, say) asks
 *   first: getConfirmation names the dialog for the way it is being turned.
 *   The switch shows where it is going while the dialog is open, and goes
 *   back if the dialog is cancelled.
 * - An inverted switch is on while its column is false, for a column that
 *   stores what to turn off ("Disable Monitoring") behind a switch that
 *   reads on = happening ("Check this monitor").
 * - Another place on the screen that saves the same column (a banner's
 *   "Turn monitoring on" button) is heard through ModelSwitchEvents, and the
 *   switch follows it; this one announces its own saves the same way.
 * - A switch can have switches of its own under it (childSwitches): they
 *   turn on and off with it, in the same request as its own column, and are
 *   drawn under its name only while it is on (childrenWhileOn) - with it off
 *   they would change nothing. ModelSwitchesCard draws them.
 *
 * ModelSwitchCard reads the column and draws this row in a card. A page
 * that already holds the record draws the row itself.
 */

export interface ModelSwitchConfirmation {
  // English; the dialog translates it.
  title: string;
  description: string;
  submitButtonText: string;
  // PRIMARY when left out. DANGER for a change that can lock people out.
  submitButtonType?: ButtonStyleType | undefined;
}

export interface ComponentProps<TBaseModel extends BaseModel> {
  modelType: { new (): TBaseModel };
  modelId: ObjectID;
  column: ModelSwitchColumn<TBaseModel>;
  // Whether the switch is on when the row first draws.
  initialValue: boolean;
  // The switch's name, in English. It does not change with the switch.
  title: string;
  /*
   * The English sentence under the title, for the way the switch is set, if
   * there is one for it.
   */
  getDescription?: ((isOn: boolean) => string | undefined) | undefined;
  // An English sentence after it, whichever way the switch is set.
  note?: string | undefined;
  /*
   * The switch is on while the column is false, and saves the opposite of
   * what it shows.
   */
  isInverted?: boolean | undefined;
  /*
   * The dialog to show before the switch is turned this way, or nothing to
   * save at once. With whether it is being turned on.
   */
  getConfirmation?:
    | ((isTurningOn: boolean) => ModelSwitchConfirmation | undefined)
    | undefined;
  /*
   * The API to save through: ModelAPI when left out. The admin dashboard
   * passes its own (AdminModelAPI), which sends no project headers.
   */
  modelAPI?: typeof ModelAPI | undefined;
  /*
   * Told whenever the switch moves: at once when it is pressed, back again
   * if the change is refused or its dialog cancelled, and when another place
   * on the screen saved the column. With whether it is now on.
   */
  onChange?: ((isOn: boolean) => void) | undefined;
  // Told after a change is saved here, with whether the switch is now on.
  onSaved?: ((isOn: boolean) => void) | undefined;
  /*
   * The switch's data-testid. The row is `${dataTestId}-row` and the "Saved"
   * status `${dataTestId}-status`.
   */
  dataTestId?: string | undefined;
  /*
   * Lock the switch, saying the plan, whenever flipping it from where it is
   * needs a plan the project does not have - instead of letting the server
   * refuse it. For a switch drawn under a plan's upsell, which is there only
   * so what a trial left on can be switched back off: once it is, it stays.
   */
  locksWhenPlanNeeded?: boolean | undefined;
  /*
   * Lock the switch where it is, saying why (an English sentence, shown as
   * its tooltip): for a switch the record's other settings decide while they
   * hold, such as Visible on Status Page on a private episode. A missing
   * permission's reason comes first.
   */
  lockedReason?: string | undefined;
  /*
   * The switches that belong to this one ("Open a fix pull request when an
   * investigation finds a code change" under "Fix new incidents
   * automatically"). Turning this one on turns every one of them on, and
   * turning it off turns them off, in the same request as its own column:
   * a refused save leaves all of them as they were. Each column saved is
   * announced, and the switch locks for someone who may not change one of
   * them - the server would refuse the whole save.
   */
  childSwitches?: Array<ModelSwitchChild> | undefined;
  /*
   * What to draw under the switch's name while it is on: the rows of its
   * child switches. They come once a change to on is saved - not while it
   * is being saved or asked about, so nothing under it can be flipped while
   * the save that sets them is out - and go at once when it is turned off.
   */
  childrenWhileOn?: ReactNode | undefined;
  /*
   * Lock the switch, saying nothing, while a save it depends on is out: a
   * switch under it being saved (ModelSwitchesCard). Turned off then, that
   * row would go with its save's answer, and the save could land after
   * this switch's own write and undo it.
   */
  isBusy?: boolean | undefined;
  /*
   * Told when a save of the switch goes out (true), and when it is done,
   * saved or refused (false).
   */
  onSavingChange?: ((isSaving: boolean) => void) | undefined;
}

/*
 * Whether the switch may be flipped, and if not, why: the first of the
 * columns it writes - its own, then its child switches' - that may not be
 * changed. The server checks every column of a write, so one of them
 * refuses them all.
 */
const getSwitchUpdateGate: (data: {
  model: BaseModel;
  column: string;
  childSwitches?: Array<ModelSwitchChild> | undefined;
}) => PermissionGateResult = (data: {
  model: BaseModel;
  column: string;
  childSwitches?: Array<ModelSwitchChild> | undefined;
}): PermissionGateResult => {
  const ownGate: PermissionGateResult = PermissionGate.checkColumnUpdate(
    data.model,
    data.column,
  );

  if (!ownGate.isAllowed) {
    return ownGate;
  }

  for (const child of data.childSwitches || []) {
    const childGate: PermissionGateResult = PermissionGate.checkColumnUpdate(
      data.model,
      child.column,
    );

    if (!childGate.isAllowed) {
      return childGate;
    }
  }

  return ownGate;
};

export enum ModelSwitchSaveState {
  Idle = "Idle",
  // Its dialog is open.
  Confirming = "Confirming",
  Saving = "Saving",
  Saved = "Saved",
}

// What the row shows while its dialog is open.
interface PendingChange {
  previous: boolean;
  value: boolean;
  confirmation: ModelSwitchConfirmation;
}

const ModelSwitchRow: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  const translator: Translator = useTranslator();
  const source: string = `model-switch-${useId()}`;
  const [isOn, setIsOn] = useState<boolean>(props.initialValue);
  const [saveState, setSaveState] = useState<ModelSwitchSaveState>(
    ModelSwitchSaveState.Idle,
  );
  const [error, setError] = useState<string>("");
  const [pending, setPending] = useState<PendingChange | null>(null);

  /*
   * Set at once, where the state above lands on the next render: two presses
   * before the switch has drawn itself locked must not save twice.
   */
  const isBusyRef: MutableRefObject<boolean> = useRef<boolean>(false);

  /*
   * The change the dialog is asking about, taken by the first answer: a
   * second press of its button before it closes finds nothing to save.
   */
  const pendingRef: MutableRefObject<PendingChange | null> =
    useRef<PendingChange | null>(null);

  // The callbacks of the latest render, for the subscription below.
  const latestPropsRef: MutableRefObject<ComponentProps<TBaseModel>> =
    useRef<ComponentProps<TBaseModel>>(props);
  latestPropsRef.current = props;

  const model: TBaseModel = useMemo((): TBaseModel => {
    return new props.modelType();
  }, [props.modelType]);

  const modelIdString: string = props.modelId.toString();

  const updateGate: PermissionGateResult = getSwitchUpdateGate({
    model: model,
    column: props.column,
    childSwitches: props.childSwitches,
  });

  /*
   * The plan a change of it needs: its own column's, else the first plan a
   * child switch's column needs - the server refuses a write any of its
   * columns needs a plan for. (A plan leftover, and locksWhenPlanNeeded,
   * read its own column.)
   */
  const planNeeded: PlanType | null = [
    props.column,
    ...(props.childSwitches || []).map((child: ModelSwitchChild): string => {
      return child.column;
    }),
  ].reduce<PlanType | null>(
    (found: PlanType | null, column: string): PlanType | null => {
      return found || getPlanNeededToChangeColumn(model, column);
    },
    null,
  );

  // Locked by the plan: see locksWhenPlanNeeded.
  const planNeededToFlip: PlanType | null = props.locksWhenPlanNeeded
    ? getPlanNeededToFlipSwitch({
        model: model,
        column: props.column,
        isOn: isOn,
        isInverted: props.isInverted,
      })
    : null;

  useEffect(() => {
    return subscribeToModelSwitchSaved({
      modelType: props.modelType,
      modelId: props.modelId,
      column: props.column,
      source: source,
      onSaved: (stored: boolean): void => {
        // A change of its own in flight has the last word.
        if (isBusyRef.current) {
          return;
        }

        const nextIsOn: boolean = latestPropsRef.current.isInverted
          ? !stored
          : stored;

        setIsOn(nextIsOn);
        setError("");
        setSaveState(ModelSwitchSaveState.Idle);
        latestPropsRef.current.onChange?.(nextIsOn);
      },
    });
  }, [props.modelType, modelIdString, props.column, source]);

  const save: (value: boolean, previous: boolean) => Promise<void> = async (
    value: boolean,
    previous: boolean,
  ): Promise<void> => {
    isBusyRef.current = true;
    setSaveState(ModelSwitchSaveState.Saving);
    setError("");
    props.onSavingChange?.(true);

    // Its own column, and its child switches' set the same way.
    const write: Record<string, boolean> = getModelSwitchWrite({
      column: props.column,
      isOn: value,
      isInverted: props.isInverted,
      childSwitches: props.childSwitches,
    });

    const modelAPI: typeof ModelAPI = props.modelAPI || ModelAPI;

    try {
      await modelAPI.updateById<TBaseModel>({
        modelType: props.modelType,
        id: props.modelId,
        data: write as JSONObject,
      });

      isBusyRef.current = false;

      // Its own column first, then each child switch's.
      for (const column of [
        props.column,
        ...(props.childSwitches || []).map((child: ModelSwitchChild) => {
          return child.column;
        }),
      ]) {
        announceModelSwitchSaved({
          modelType: props.modelType,
          modelId: props.modelId,
          column: column,
          value: Boolean(write[column]),
          source: source,
        });
      }

      /*
       * Told before the row draws itself saved: the switches under it are
       * drawn with that, and the page that draws them (ModelSwitchesCard)
       * has heard by then where this save put them.
       */
      props.onSaved?.(value);
      setSaveState(ModelSwitchSaveState.Saved);
      props.onSavingChange?.(false);
    } catch (err) {
      isBusyRef.current = false;
      setIsOn(previous);
      props.onChange?.(previous);
      setSaveState(ModelSwitchSaveState.Idle);
      setError(API.getFriendlyMessage(err));
      props.onSavingChange?.(false);
    }
  };

  const change: (value: boolean) => void = (value: boolean): void => {
    if (
      isBusyRef.current ||
      props.isBusy ||
      !updateGate.isAllowed ||
      planNeededToFlip
    ) {
      return;
    }

    const previous: boolean = isOn;

    /*
     * The switch has already moved (it keeps its own state, and follows
     * `value` only when `value` changes): the row follows it, so that a
     * refusal or a cancelled dialog - which puts `value` back - moves the
     * switch back too.
     */
    setIsOn(value);
    props.onChange?.(value);
    setError("");

    const confirmation: ModelSwitchConfirmation | undefined =
      props.getConfirmation?.(value);

    if (confirmation) {
      isBusyRef.current = true;
      pendingRef.current = { previous, value, confirmation };
      setPending(pendingRef.current);
      setSaveState(ModelSwitchSaveState.Confirming);
      return;
    }

    void save(value, previous);
  };

  const cancelPending: () => void = (): void => {
    const cancelled: PendingChange | null = pendingRef.current;

    if (!cancelled) {
      return;
    }

    pendingRef.current = null;
    isBusyRef.current = false;
    setIsOn(cancelled.previous);
    props.onChange?.(cancelled.previous);
    setPending(null);
    setSaveState(ModelSwitchSaveState.Idle);
  };

  const confirmPending: () => void = (): void => {
    const confirmed: PendingChange | null = pendingRef.current;

    if (!confirmed) {
      return;
    }

    pendingRef.current = null;
    setPending(null);
    void save(confirmed.value, confirmed.previous);
  };

  const descriptionText: string | undefined = props.getDescription?.(isOn);

  /*
   * A plan feature left on by a trial that ended (or a move to a lower
   * plan): the switch can still go back to the column's default - the
   * server allows that on any plan - and the row says so, and what it takes
   * to come back. Only for someone who may change it.
   */
  const leftover: SwitchPlanLeftover | null = updateGate.isAllowed
    ? getSwitchPlanLeftover({
        model: model,
        column: props.column,
        isOn: isOn,
        isInverted: props.isInverted,
      })
    : null;

  const leftoverNote: ReactElement | undefined = leftover ? (
    <span
      className="mt-1 block"
      data-testid={
        props.dataTestId ? `${props.dataTestId}-plan-leftover` : undefined
      }
    >
      {translator.translateTemplate(
        SWITCH_PLAN_LEFTOVER_COPY[leftover.canTurn],
        {
          planName: leftover.planNeeded,
        },
      )}
    </span>
  ) : undefined;

  // Translated here, as one element: the Toggle would look a string up again.
  const description: ReactElement | undefined =
    descriptionText || props.note || leftoverNote ? (
      <>
        {descriptionText ? translator.translateText(descriptionText) : ""}
        {descriptionText && props.note ? " " : ""}
        {props.note ? translator.translateText(props.note) : ""}
        {leftoverNote || ""}
      </>
    ) : undefined;

  const isLocked: boolean =
    saveState === ModelSwitchSaveState.Saving ||
    saveState === ModelSwitchSaveState.Confirming ||
    Boolean(props.isBusy) ||
    !updateGate.isAllowed ||
    Boolean(props.lockedReason) ||
    Boolean(planNeededToFlip);

  /*
   * Why it is locked: the missing permission first, then what the record
   * says (lockedReason), then the plan.
   */
  const lockedReason: string | undefined =
    updateGate.disabledReason ||
    props.lockedReason ||
    (planNeededToFlip
      ? translator.translateTemplate(SWITCH_PLAN_LOCKED_COPY, {
          planName: planNeededToFlip,
        })
      : undefined);

  const getSaveStateElement: () => ReactNode = (): ReactNode => {
    if (saveState === ModelSwitchSaveState.Saving) {
      return (
        <span className="text-gray-500">
          {translator.translateText("Saving…")}
        </span>
      );
    }

    if (saveState === ModelSwitchSaveState.Saved) {
      return (
        <span className="inline-flex items-center gap-1 text-emerald-700">
          <Icon icon={IconProp.Check} className="h-4 w-4" />
          {translator.translateText("Saved")}
        </span>
      );
    }

    return null;
  };

  const hasSaveState: boolean =
    saveState === ModelSwitchSaveState.Saving ||
    saveState === ModelSwitchSaveState.Saved;

  /*
   * The child switches, while the switch is on and no change to it is out:
   * a change to on brings them once it is saved, already on.
   */
  const isShowingChildren: boolean =
    Boolean(props.childrenWhileOn) &&
    isOn &&
    saveState !== ModelSwitchSaveState.Saving &&
    saveState !== ModelSwitchSaveState.Confirming;

  const switchRow: ReactElement = (
    /*
     * The "Saved" status and the plan's pill sit to the right of the
     * switch's text from sm up. On a phone they go under the text, lined up
     * with it (the switch is 44px and 12px from its text: pl-14), so the
     * sentence keeps the width. Each brings its own top margin there, and the
     * column its own left margin from sm up, so a row with neither takes no
     * more room than its switch.
     */
    <div
      className="flex flex-col sm:flex-row sm:items-start sm:justify-between"
      data-testid={props.dataTestId ? `${props.dataTestId}-row` : undefined}
    >
      <div className="min-w-0 flex-1">
        <Toggle
          title={props.title}
          description={description}
          value={isOn}
          disabled={isLocked}
          tooltip={lockedReason}
          error={error || undefined}
          dataTestId={props.dataTestId}
          onChange={(value: boolean) => {
            change(value);
          }}
        />
      </div>
      <div
        className={`flex flex-shrink-0 flex-wrap items-center gap-x-3 pl-14 text-sm sm:pl-0 sm:pt-0.5 ${
          hasSaveState || planNeeded ? "sm:ml-4" : ""
        }`}
      >
        {/*
         * Always in the page, so a screen reader hears "Saved" when it
         * appears: a live region added along with its text is often not
         * announced.
         */}
        <span
          role="status"
          className={hasSaveState ? "mt-2 inline-flex sm:mt-0" : "inline-flex"}
          data-testid={
            props.dataTestId ? `${props.dataTestId}-status` : undefined
          }
        >
          {getSaveStateElement()}
        </span>
        {planNeeded ? (
          <span className="mt-2 inline-flex sm:mt-0">
            <Pill
              text={translator.translateTemplate("{{planName}} Plan", {
                planName: planNeeded,
              })}
              color={Yellow}
            />
          </span>
        ) : (
          <></>
        )}
      </div>
      {pending ? (
        <ConfirmModal
          title={pending.confirmation.title}
          description={pending.confirmation.description}
          submitButtonText={pending.confirmation.submitButtonText}
          submitButtonType={
            pending.confirmation.submitButtonType ?? ButtonStyleType.PRIMARY
          }
          onClose={cancelPending}
          onSubmit={confirmPending}
        />
      ) : (
        <></>
      )}
    </div>
  );

  if (!props.childrenWhileOn) {
    return switchRow;
  }

  return (
    <>
      {switchRow}
      {isShowingChildren ? (
        /*
         * A group named for the switch it belongs to, so a screen reader
         * entering it hears whose switches these are.
         */
        <div
          role="group"
          aria-label={translator.translateText(props.title)}
          className={MODEL_SWITCH_CHILDREN_CLASS_NAME}
          data-testid={
            props.dataTestId ? `${props.dataTestId}-children` : undefined
          }
        >
          {props.childrenWhileOn}
        </div>
      ) : (
        <></>
      )}
    </>
  );
};

export default ModelSwitchRow;
