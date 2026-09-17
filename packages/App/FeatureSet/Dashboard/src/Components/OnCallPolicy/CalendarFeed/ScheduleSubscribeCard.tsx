import PersonalCalendarFeedCard, {
  PersonalCalendarFeedVariant,
} from "./PersonalCalendarFeedCard";
import SharedCalendarFeedCard, {
  SharedCalendarFeedKind,
} from "./SharedCalendarFeedCard";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * The schedule page's "Subscribe to this schedule" block: the reader's own
 * link narrowed to this schedule, then the shared team link (with its own
 * settings card once published).
 *
 * Two cards rather than one on purpose. The personal half is private and
 * needs no permission; the shared half is a project capability with its own
 * publish / regenerate / disable controls and a settings card. Folding them
 * into one card would put an editor-only button row over a section every
 * reader can use.
 */
export interface ComponentProps {
  scheduleId: ObjectID;
  scheduleTimezone?: string | null | undefined;
  /** Injected by tests; the page passes nothing and gets the real clock. */
  now?: Date | undefined;
}

const ScheduleSubscribeCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Fragment>
      <Card
        title="Subscribe to this schedule"
        description="Put this schedule's shifts in Google Calendar, Outlook, Apple Calendar or any app that can subscribe to a calendar link."
      >
        <PersonalCalendarFeedCard
          variant={PersonalCalendarFeedVariant.Schedule}
          scheduleId={props.scheduleId}
          now={props.now}
        />
      </Card>

      <SharedCalendarFeedCard
        kind={SharedCalendarFeedKind.Schedule}
        scheduleId={props.scheduleId}
        scheduleTimezone={props.scheduleTimezone}
        now={props.now}
      />
    </Fragment>
  );
};

export default ScheduleSubscribeCard;
