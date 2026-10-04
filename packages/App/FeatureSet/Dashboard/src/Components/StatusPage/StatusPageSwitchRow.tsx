import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import ObjectID from "Common/Types/ObjectID";
import ModelSwitchRow from "Common/UI/Components/ModelSwitch/ModelSwitchRow";
import { getPlanNeededToChangeColumn } from "Common/UI/Components/ModelSwitch/ModelSwitchUtil";
import React, { FunctionComponent, ReactElement } from "react";
import { SubscriptionSwitchColumn } from "./SubscriberChannelsCopy";
import {
  DisplaySettingColumn,
  DisplaySwitchColumn,
} from "./StatusPageDisplaySettingsCopy";
import { BrandingSwitchColumn } from "./StatusPageBrandingCopy";
import { ReportSwitchColumn } from "./StatusPageReportsCopy";

/*
 * One switch for one of a status page's boolean columns, that saves the
 * moment it is flipped - there is nothing else to fill in, so there is no
 * Edit button and no dialog. The same row is the Channels card's on
 * Subscriber Settings and the panel's at the top of a channel's subscriber
 * list, so a channel reads and behaves the same in both places, every
 * switch on the "What your status page shows" card on Advanced Settings,
 * Search Engine Indexing on the Branding page, and "Send email reports" on
 * the Reports page.
 *
 * It is the shared ModelSwitchRow (Common/UI/Components/ModelSwitch), for a
 * status page: the switch moves at once, is locked while the change is
 * saved and says "Saved"; a change the server refuses moves it back and
 * says why under it; someone who may not edit the status page sees it
 * locked, with the permission that is missing; and where a plan has to be
 * upgraded for the switch to be changed, the plan's name is beside it before
 * anyone tries.
 */

// The status page columns a switch row can write.
export type StatusPageSwitchColumn =
  | SubscriptionSwitchColumn
  | DisplaySwitchColumn
  | BrandingSwitchColumn
  | ReportSwitchColumn;

export interface ComponentProps {
  statusPageId: ObjectID;
  column: StatusPageSwitchColumn;
  // Whether the switch is on when the row first draws.
  initialValue: boolean;
  // The switch's name. It does not change with the switch.
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
   * what it shows: a column that stores what to hide, on a card where every
   * switch reads on = shown.
   */
  isInverted?: boolean | undefined;
  /*
   * Told whenever the switch moves: at once when it is pressed, and back
   * again if the change is refused. With whether it is now on.
   */
  onChange?: ((isOn: boolean) => void) | undefined;
  // Told after a change is saved, with whether the switch is now on.
  onSaved?: ((isOn: boolean) => void) | undefined;
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
 * can (see getPlanNeededToChangeColumn): the number-of-days boxes beside the
 * switches ask it too.
 */
export const getPlanNeededToChange: (
  column: StatusPageSwitchColumn | DisplaySettingColumn,
) => PlanType | null = (
  column: StatusPageSwitchColumn | DisplaySettingColumn,
): PlanType | null => {
  return getPlanNeededToChangeColumn(new StatusPage(), column);
};

const StatusPageSwitchRow: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ModelSwitchRow<StatusPage>
      modelType={StatusPage}
      modelId={props.statusPageId}
      column={props.column}
      initialValue={props.initialValue}
      title={props.title}
      getDescription={props.getDescription}
      note={props.note}
      isInverted={props.isInverted}
      onChange={props.onChange}
      onSaved={props.onSaved}
      dataTestId={props.dataTestId}
    />
  );
};

export default StatusPageSwitchRow;
