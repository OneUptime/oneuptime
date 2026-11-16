import {
  OfferedChannel,
  TabSummaryFacts,
  describeTabSummary,
  getTabSummaryFacts,
} from "./NotificationSettingsWords";
import { RowsByEvent } from "./useNotificationSettingRows";
import IconProp from "Common/Types/Icon/IconProp";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What a tab of Notification Settings adds up to, over all its cards: "You
 * hear about 7 of 12 events on this tab, by Email and Slack." Read before
 * the rows, so a tab answers "what reaches me from here?" without going
 * down every switch. It follows each switch as it is flipped.
 */

export const NOTIFICATION_TAB_SUMMARY_TEST_ID: string =
  "notification-tab-summary";

export interface ComponentProps {
  eventTypes: ReadonlyArray<NotificationSettingEventType>;
  rowsByEvent: RowsByEvent;
  channels: ReadonlyArray<OfferedChannel>;
}

const NotificationTabSummary: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const facts: TabSummaryFacts = getTabSummaryFacts({
    eventTypes: props.eventTypes,
    rowsByEvent: props.rowsByEvent,
    channels: props.channels,
  });

  return (
    <div
      className="flex items-center gap-2 text-sm text-gray-600"
      data-testid={NOTIFICATION_TAB_SUMMARY_TEST_ID}
      data-reaching={facts.reaching}
      data-total={facts.total}
    >
      <Icon
        icon={facts.reaching > 0 ? IconProp.Bell : IconProp.BellSlash}
        className={`h-4 w-4 flex-shrink-0 ${
          facts.reaching > 0 ? "text-indigo-500" : "text-gray-400"
        }`}
      />
      <span>{describeTabSummary(facts, translator)}</span>
    </div>
  );
};

export default NotificationTabSummary;
