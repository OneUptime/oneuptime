import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Clipboard from "Common/UI/Utils/Clipboard";
import useClipboardCopy, {
  ClipboardCopy,
} from "Common/UI/Utils/UseClipboardCopy";
import React, { FunctionComponent, ReactElement, useRef } from "react";
import { useTranslation } from "react-i18next";

/*
 * The status page's calendar dialog, in its two uses:
 *
 *   - Subscribe to calendar, on the Scheduled Events page: the page's
 *     maintenance calendar in Google Calendar (Google's add-by-URL page),
 *     in the device's calendar app (a webcal:// link: Apple Calendar,
 *     Outlook), or as a link to paste anywhere else.
 *   - Add to calendar, on one event's page: the event in Google Calendar
 *     (Google's add-event page, filled in), or as a file the device's
 *     calendar app opens (the page's calendar with ?event=<id>).
 *
 * Two tiles, each saying what a click does, the way the Dashboard's
 * calendar links read; the addresses are built by the page from its own
 * address (MaintenanceCalendarLinks), never typed. Every word is the page's
 * own translation (scheduledEvents.calendar.*).
 *
 * Copy link says "Copied!" only once the link is on the clipboard (issue
 * #5132). A status page served over plain http - a self-hosted install
 * reached by a LAN hostname - has no navigator.clipboard at all; the copy
 * then goes through the browser's older copy command (Clipboard.ts). When
 * the browser refuses that too, the dialog says so, and the link is left
 * selected in its field, to copy with the keyboard or the browser's menu.
 */
export enum MaintenanceCalendarModalMode {
  Subscribe = "subscribe",
  Event = "event",
}

export interface ComponentProps {
  mode: MaintenanceCalendarModalMode;
  // Google Calendar's page: add-by-URL (Subscribe) or add-event (Event).
  googleUrl: string;
  /*
   * The device's calendar app: the webcal:// link (Subscribe), or the event
   * as a file (Event).
   */
  deviceUrl: string;
  // The https address to copy (Subscribe only).
  copyUrl?: string | undefined;
  onClose: () => void;
}

export const CALENDAR_OPTION_CLASS_NAME: string =
  "group flex min-w-0 items-center gap-3 rounded-lg border border-gray-200 bg-white px-3.5 py-3 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

const MaintenanceCalendarModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { t } = useTranslation();

  /*
   * "Copied!" for a moment; a failure stays until the next try, since it
   * tells the reader what to do.
   */
  const clipboard: ClipboardCopy = useClipboardCopy({ failedForMs: null });
  const linkFieldRef: React.RefObject<HTMLInputElement> =
    useRef<HTMLInputElement>(null);

  const isSubscribe: boolean =
    props.mode === MaintenanceCalendarModalMode.Subscribe;

  const copy: () => Promise<void> = async (): Promise<void> => {
    if (!props.copyUrl) {
      return;
    }

    const hasCopied: boolean = await clipboard.copy(props.copyUrl);

    if (!hasCopied) {
      Clipboard.selectForManualCopy(linkFieldRef.current);
    }
  };

  return (
    <Modal
      title={
        isSubscribe
          ? t("scheduledEvents.calendar.subscribeTitle")
          : t("scheduledEvents.calendar.eventTitle")
      }
      description={
        isSubscribe
          ? t("scheduledEvents.calendar.subscribeDescription")
          : t("scheduledEvents.calendar.eventDescription")
      }
      modalWidth={ModalWidth.Medium}
      onClose={props.onClose}
      closeButtonText={t("scheduledEvents.calendar.done")}
    >
      <div
        className="space-y-6"
        data-testid={`maintenance-calendar-${props.mode}-dialog`}
      >
        <section
          aria-labelledby={
            isSubscribe ? "maintenance-calendar-add-heading" : undefined
          }
        >
          {/*
           * One event's dialog is titled Add to calendar already; the
           * heading is for the subscribe dialog, where the copy-the-link
           * section follows the two options.
           */}
          {isSubscribe ? (
            <h3
              id="maintenance-calendar-add-heading"
              className="mb-3 text-sm font-semibold text-gray-900"
            >
              {t("scheduledEvents.calendar.addHeading")}
            </h3>
          ) : (
            <></>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <a
              href={props.googleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={CALENDAR_OPTION_CLASS_NAME}
              data-testid="maintenance-calendar-google"
            >
              <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                <Icon icon={IconProp.GlobeAlt} className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-gray-900">
                  {t("scheduledEvents.calendar.google")}
                </div>
                <div className="mt-0.5 text-pretty text-xs leading-5 text-gray-500">
                  {t("scheduledEvents.calendar.googleHint")}
                </div>
              </div>
              <Icon
                icon={IconProp.ExternalLink}
                className="h-4 w-4 flex-none text-gray-400 group-hover:text-gray-600"
              />
            </a>
            <a
              href={props.deviceUrl}
              {...(isSubscribe ? {} : { download: "maintenance.ics" })}
              className={CALENDAR_OPTION_CLASS_NAME}
              data-testid="maintenance-calendar-device"
            >
              <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                <Icon icon={IconProp.Calendar} className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-gray-900">
                  {t("scheduledEvents.calendar.device")}
                </div>
                <div className="mt-0.5 text-pretty text-xs leading-5 text-gray-500">
                  {isSubscribe
                    ? t("scheduledEvents.calendar.deviceHint")
                    : t("scheduledEvents.calendar.deviceFileHint")}
                </div>
              </div>
              <Icon
                icon={isSubscribe ? IconProp.ChevronRight : IconProp.Download}
                className="h-4 w-4 flex-none text-gray-400 group-hover:text-gray-600"
              />
            </a>
          </div>
        </section>

        {isSubscribe && props.copyUrl ? (
          <section aria-labelledby="maintenance-calendar-copy-heading">
            <h3
              id="maintenance-calendar-copy-heading"
              className="text-sm font-semibold text-gray-900"
            >
              {t("scheduledEvents.calendar.copyHeading")}
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              {t("scheduledEvents.calendar.copyHint")}
            </p>
            <div className="mt-3 flex min-w-0 rounded-md shadow-sm">
              <input
                ref={linkFieldRef}
                type="text"
                readOnly={true}
                value={props.copyUrl}
                aria-label={t("scheduledEvents.calendar.copyHeading")}
                className="block min-w-0 flex-1 rounded-l-md border border-gray-300 bg-white px-3 py-2 font-mono text-xs text-gray-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                data-testid="maintenance-calendar-url"
                onFocus={(event: React.FocusEvent<HTMLInputElement>) => {
                  event.target.select();
                }}
              />
              <button
                type="button"
                className="-ml-px inline-flex flex-none items-center gap-1.5 rounded-r-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                data-testid="maintenance-calendar-copy"
                onClick={() => {
                  void copy();
                }}
              >
                <Icon
                  icon={clipboard.isCopied ? IconProp.Check : IconProp.Copy}
                  className={`h-4 w-4 ${clipboard.isCopied ? "text-green-600" : "text-gray-400"}`}
                />
                <span aria-live="polite">
                  {clipboard.isCopied
                    ? t("scheduledEvents.calendar.copied")
                    : t("scheduledEvents.calendar.copy")}
                </span>
              </button>
            </div>
            {/*
             * In the page from the start, so a screen reader hears the
             * failure when it is written into it. A div, not a p: the icon
             * is drawn in a div of its own, which a paragraph cannot hold.
             */}
            <div role="status" data-testid="maintenance-calendar-copy-status">
              {clipboard.isFailed ? (
                <div
                  className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-amber-700"
                  data-testid="maintenance-calendar-copy-failed"
                >
                  <Icon
                    icon={IconProp.Alert}
                    className="mt-0.5 h-3.5 w-3.5 flex-none"
                  />
                  <span className="min-w-0 text-pretty">
                    {t("scheduledEvents.calendar.copyFailed")}
                  </span>
                </div>
              ) : (
                <></>
              )}
            </div>
          </section>
        ) : (
          <></>
        )}

        {isSubscribe ? (
          <div className="flex items-start gap-2 text-xs leading-5 text-gray-500">
            <Icon
              icon={IconProp.Info}
              className="mt-0.5 h-3.5 w-3.5 flex-none text-gray-400"
            />
            <span className="min-w-0 text-pretty">
              {t("scheduledEvents.calendar.refreshNote")}
            </span>
          </div>
        ) : (
          <></>
        )}
      </div>
    </Modal>
  );
};

export default MaintenanceCalendarModal;
