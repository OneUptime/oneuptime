import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import ColumnBillingAccessControl from "Common/Types/BaseDatabase/ColumnBillingAccessControl";
import SubscriptionPlan, { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import { Yellow } from "Common/Types/BrandColors";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Pill from "Common/UI/Components/Pill/Pill";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import { getAllEnvVars } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";
import { SubscriptionSwitchColumn } from "./SubscriberChannelsCopy";

/*
 * One switch for one of a status page's subscription columns, that saves the
 * moment it is flipped - there is nothing else to fill in, so there is no
 * Edit button and no dialog. The same row is the Channels card's on
 * Subscriber Settings and the panel's at the top of a channel's subscriber
 * list, so a channel reads and behaves the same in both places.
 *
 * The switch moves at once and is locked while the change is saved; a change
 * the server refuses moves it back and says why under it (a plan that does
 * not include the channel, a project without SMS turned on), so it never
 * shows a state the page is not in. Someone who may not edit the status page
 * sees it locked, with the permission that is missing. Where a plan has to
 * be upgraded for the switch to be changed, the plan's name is beside it
 * before anyone tries - the same pill a table shows for a plan feature.
 */

export interface ComponentProps {
  statusPageId: ObjectID;
  column: SubscriptionSwitchColumn;
  // What the column holds when the row first draws.
  initialValue: boolean;
  // The switch's name. It does not change with the switch.
  title: string;
  // The English sentence under the title, for the way the switch is set.
  getDescription: (isOn: boolean) => string;
  // An English sentence after it, whichever way the switch is set.
  note?: string | undefined;
  // Told after a change is saved.
  onSaved?: ((value: boolean) => void) | undefined;
  dataTestId?: string | undefined;
}

// The data-testid of the switch for a column, wherever it is drawn.
export const getSubscriptionSwitchTestId: (
  column: SubscriptionSwitchColumn,
) => string = (column: SubscriptionSwitchColumn): string => {
  return `subscription-switch-${column}`;
};

/*
 * The plan this project would need to change the column, or null when it
 * can. Fails open, like the dashboard's other plan notes: with billing off
 * (getCurrentPlan is null on every self-hosted install), or a plan it cannot
 * tell, it says nothing, and the server - which refuses the change below
 * the plan anyway - has the last word.
 */
export const getPlanNeededToChange: (
  column: SubscriptionSwitchColumn,
) => PlanType | null = (column: SubscriptionSwitchColumn): PlanType | null => {
  const currentPlan: PlanType | null = ProjectUtil.getCurrentPlan();

  if (!currentPlan) {
    return null;
  }

  const billing: ColumnBillingAccessControl | undefined =
    new StatusPage().getColumnBillingAccessControl(column);

  if (!billing || !billing.update) {
    return null;
  }

  try {
    return SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(
      billing.update,
      currentPlan,
      getAllEnvVars(),
    )
      ? null
      : billing.update;
  } catch {
    // A plan this dashboard cannot read is no reason to say anything.
    return null;
  }
};

const StatusPageSwitchRow: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isOn, setIsOn] = useState<boolean>(props.initialValue);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const updateGate: PermissionGateResult = PermissionGate.check(
    new StatusPage(),
    ModelAction.Update,
  );

  const planNeeded: PlanType | null = getPlanNeededToChange(props.column);

  const change: (value: boolean) => Promise<void> = async (
    value: boolean,
  ): Promise<void> => {
    if (isSaving || !updateGate.isAllowed) {
      return;
    }

    const previous: boolean = isOn;

    /*
     * The switch has already moved (it keeps its own state, and follows
     * `value` only when `value` changes): the row follows it, so that a
     * refusal below - which puts `value` back - moves the switch back too.
     */
    setIsOn(value);
    setIsSaving(true);
    setError("");

    try {
      await ModelAPI.updateById<StatusPage>({
        modelType: StatusPage,
        id: props.statusPageId,
        data: { [props.column]: value } as JSONObject,
      });

      props.onSaved?.(value);
    } catch (err) {
      setIsOn(previous);
      setError(API.getFriendlyMessage(err));
    }

    setIsSaving(false);
  };

  // Translated here, as one element: the Toggle would look a string up again.
  const description: ReactElement = (
    <>
      {translator.translateText(props.getDescription(isOn))}
      {props.note ? ` ${translator.translateText(props.note)}` : ""}
    </>
  );

  return (
    <div
      className="flex items-start justify-between gap-4"
      data-testid={props.dataTestId ? `${props.dataTestId}-row` : undefined}
    >
      <div className="min-w-0 flex-1">
        <Toggle
          title={props.title}
          description={description}
          value={isOn}
          disabled={isSaving || !updateGate.isAllowed}
          tooltip={updateGate.disabledReason}
          error={error || undefined}
          dataTestId={props.dataTestId}
          onChange={(value: boolean) => {
            void change(value);
          }}
        />
      </div>
      {planNeeded ? (
        <div className="flex-shrink-0 pt-0.5">
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

export default StatusPageSwitchRow;
