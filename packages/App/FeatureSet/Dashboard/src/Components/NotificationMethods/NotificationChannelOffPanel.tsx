import Project from "Common/Models/DatabaseModels/Project";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import ModelSwitchRow from "Common/UI/Components/ModelSwitch/ModelSwitchRow";
import { BILLING_ENABLED } from "Common/UI/Config";
import PermissionGate, {
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";
import { ProjectChannelState } from "./ProjectNotificationChannels";
import {
  ChannelGatedMethodList,
  ChannelGatedMethodListDefinition,
  getChannelGatedMethodList,
  getProjectNotificationChannel,
  ProjectNotificationChannelDefinition,
} from "./ProjectNotificationChannelsCopy";

/*
 * At the top of a person's own list of SMS, call, WhatsApp or Telegram
 * methods (and their incoming call numbers) while the project has that
 * channel off, in place of the list's Add button.
 *
 * The Add button used to be there whatever the switch said, and every
 * channel but email starts off on a new project - so the first phone number
 * a responder added was refused by the server ("SMS notifications are
 * disabled for this project. Please enable them in Project Settings >
 * Notification Settings"), sending them to a page most of them may not
 * change, where the switch sat behind an Edit button and a two-step dialog.
 *
 * Now the switch is here:
 * - Someone who may change it (a project owner, or anyone who manages
 *   billing - the column's own update permissions) gets the channel's own
 *   switch, which saves the moment it is flipped (ModelSwitchRow): the Add
 *   button appears with it, through ModelSwitchEvents.
 * - Everyone else gets one sentence: what is off, and who can turn it on.
 *
 * Nothing is drawn while the channel is on, while the answer is on its way,
 * or when it could not be read (the list then offers Add, as it always did,
 * and the server decides). Turned on from here, the panel stays until the
 * page is left, saying it is on, so the press shows its result and can be
 * taken back.
 */

export interface ComponentProps {
  list: ChannelGatedMethodList;
  state: ProjectChannelState;
}

export const NOTIFICATION_CHANNEL_OFF_PANEL_TEST_ID: string =
  "notification-channel-off-panel";

export const NOTIFICATION_CHANNEL_OFF_SENTENCE_TEST_ID: string =
  "notification-channel-off-sentence";

// The data-testid of a project channel's switch, wherever it is drawn.
export const getProjectChannelSwitchTestId: (column: string) => string = (
  column: string,
): string => {
  return `project-channel-switch-${column}`;
};

/*
 * Whether the signed-in person may change one of the project's channel
 * switches: the Project's update permissions, then the column's own (owners
 * and billing managers), as the server checks them.
 */
export const canChangeProjectChannel: (
  definition: ProjectNotificationChannelDefinition,
) => boolean = (definition: ProjectNotificationChannelDefinition): boolean => {
  const gate: PermissionGateResult = PermissionGate.checkColumnUpdate(
    new Project(),
    definition.column,
  );

  return gate.isAllowed;
};

const NotificationChannelOffPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isChangedHere, setIsChangedHere] = useState<boolean>(false);

  const list: ChannelGatedMethodListDefinition = getChannelGatedMethodList(
    props.list,
  );
  const channel: ProjectNotificationChannelDefinition =
    getProjectNotificationChannel(list.channel);

  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  /*
   * Read on every render rather than remembered: the permission snapshot
   * arrives on a response header, and may land after the first paint.
   */
  const mayChange: boolean = canChangeProjectChannel(channel);

  if (!projectId) {
    return <></>;
  }

  if (props.state !== ProjectChannelState.Off && !isChangedHere) {
    return <></>;
  }

  if (!mayChange) {
    return (
      <div
        className="mb-5 flex items-start gap-3 rounded-xl border border-gray-200 bg-gray-50 px-5 py-4 md:px-6"
        data-testid={NOTIFICATION_CHANNEL_OFF_PANEL_TEST_ID}
      >
        <Icon
          icon={IconProp.InformationCircle}
          className="mt-0.5 h-5 w-5 flex-shrink-0 text-gray-400"
        />
        <p
          className="text-sm text-gray-700"
          data-testid={NOTIFICATION_CHANNEL_OFF_SENTENCE_TEST_ID}
        >
          {translator.translateText(list.offSentence)}
        </p>
      </div>
    );
  }

  return (
    <div
      className="mb-5 rounded-xl border border-gray-200 bg-gray-50 px-5 py-4 md:px-6"
      data-testid={NOTIFICATION_CHANNEL_OFF_PANEL_TEST_ID}
    >
      <ModelSwitchRow<Project>
        modelType={Project}
        modelId={projectId}
        column={channel.column}
        initialValue={props.state === ProjectChannelState.On}
        title={channel.title}
        getDescription={(isOn: boolean): string => {
          return isOn ? list.switchOnDescription : list.switchOffDescription;
        }}
        note={BILLING_ENABLED ? channel.balanceNote : undefined}
        onChange={() => {
          /*
           * At the press, not after the save: the save is announced
           * (ModelSwitchEvents) before it is reported, and the list's state
           * moving to On must not take the switch away while it is saying
           * "Saved".
           */
          setIsChangedHere(true);
        }}
        dataTestId={getProjectChannelSwitchTestId(channel.column)}
      />
    </div>
  );
};

export default NotificationChannelOffPanel;
