import MaintenanceCalendarModal, {
  MaintenanceCalendarModalMode,
} from "./MaintenanceCalendarModal";
import StatusPageUtil from "../../Utils/StatusPage";
import IconProp from "Common/Types/Icon/IconProp";
import { CalendarSubscriptionLinkSet } from "Common/Types/Calendar/CalendarSubscriptionLinks";
import MaintenanceCalendarLinks, {
  StatusPageCalendarAddress,
} from "Common/Types/ScheduledMaintenance/MaintenanceCalendarLinks";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import React, { Fragment, FunctionComponent, ReactElement, useState } from "react";
import { useTranslation } from "react-i18next";

/*
 * The status page's calendar buttons, beside a page's title.
 *
 * Subscribe to calendar, on the Scheduled Events page, puts the page's
 * maintenance in a calendar app for good. It is not offered on a private
 * page: a calendar app signs in nowhere, so it could only ever read an
 * empty calendar (StatusPageMaintenanceCalendarFeed).
 *
 * Add to calendar, on one event's page, puts that event in a calendar app
 * once. It is offered on every page: Google's add-event page needs nothing
 * from the status page, and the file is downloaded by the reader's own
 * browser, signed in when the page is private.
 */

// Where the page is read: its own origin, and its id when that is in the path.
export const getStatusPageCalendarAddress: () => StatusPageCalendarAddress =
  (): StatusPageCalendarAddress => {
    return {
      origin: window.location.origin,
      statusPageId: StatusPageUtil.getStatusPageId()?.toString() || null,
      isPreview: Boolean(StatusPageUtil.isPreviewPage()),
    };
  };

export const SubscribeToCalendarButton: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState<boolean>(false);

  if (StatusPageUtil.isPrivateStatusPage()) {
    return <></>;
  }

  const links: CalendarSubscriptionLinkSet =
    MaintenanceCalendarLinks.getStatusPageSubscriptionLinks(
      getStatusPageCalendarAddress(),
    );

  return (
    <Fragment>
      <Button
        title={t("scheduledEvents.calendar.subscribe")}
        icon={IconProp.Calendar}
        buttonStyle={ButtonStyleType.NORMAL}
        dataTestId="maintenance-calendar-subscribe"
        onClick={() => {
          setIsOpen(true);
        }}
      />
      {isOpen ? (
        <MaintenanceCalendarModal
          mode={MaintenanceCalendarModalMode.Subscribe}
          googleUrl={links.googleAdd}
          deviceUrl={links.webcal}
          copyUrl={links.https}
          onClose={() => {
            setIsOpen(false);
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export interface AddEventToCalendarButtonProps {
  eventId: string;
  title: string;
  startsAt: Date;
  endsAt?: Date | null | undefined;
}

export const AddEventToCalendarButton: FunctionComponent<
  AddEventToCalendarButtonProps
> = (props: AddEventToCalendarButtonProps): ReactElement => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState<boolean>(false);

  const address: StatusPageCalendarAddress = getStatusPageCalendarAddress();

  // The event's own page, as the reader has it, for Google's details.
  const eventPageUrl: string = `${window.location.origin}${window.location.pathname}`;

  return (
    <Fragment>
      <Button
        title={t("scheduledEvents.calendar.addToCalendar")}
        icon={IconProp.Calendar}
        buttonStyle={ButtonStyleType.NORMAL}
        dataTestId="maintenance-calendar-add-event"
        onClick={() => {
          setIsOpen(true);
        }}
      />
      {isOpen ? (
        <MaintenanceCalendarModal
          mode={MaintenanceCalendarModalMode.Event}
          googleUrl={MaintenanceCalendarLinks.getGoogleCalendarEventUrl({
            title: props.title,
            startsAt: props.startsAt,
            endsAt: props.endsAt,
            details: eventPageUrl,
          })}
          deviceUrl={MaintenanceCalendarLinks.getStatusPageEventFileUrl({
            ...address,
            eventId: props.eventId,
          })}
          onClose={() => {
            setIsOpen(false);
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};
