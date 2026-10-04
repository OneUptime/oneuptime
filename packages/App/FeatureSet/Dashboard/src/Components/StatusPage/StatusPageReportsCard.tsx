import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import OneUptimeDate from "Common/Types/Date";
import Recurring from "Common/Types/Events/Recurring";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import StatusPageReportPeriodType from "Common/Types/StatusPage/StatusPageReportPeriodType";
import StatusPageReportScheduleUtil, {
  StatusPageReportScheduleWrite,
} from "Common/Utils/StatusPage/ReportSchedule";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Detail from "Common/UI/Components/Detail/Detail";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import FieldType from "Common/UI/Components/Types/FieldType";
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
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import StatusPageSwitchRow from "./StatusPageSwitchRow";
import { getReportScheduleFormFields } from "./StatusPageReportScheduleForm";
import {
  getReportPeriodDates,
  getReportScheduleDraft,
  getReportScheduleFacts,
  getShownReportColumns,
  REPORT_FREQUENCY_COPY,
  REPORT_SCHEDULE_FORM_ID,
  REPORT_SCHEDULE_FORM_NAME,
  REPORT_SWITCH_COLUMN,
  ReportScheduleColumns,
  ReportScheduleFacts,
  ROLLING_DAYS_TEMPLATE,
  STATUS_PAGE_REPORTS_CARD_TEST_ID,
  STATUS_PAGE_REPORTS_SWITCH_TEST_ID,
  STATUS_PAGE_REPORT_SCHEDULE_DETAILS_ID,
  STATUS_PAGE_REPORT_SCHEDULE_TEST_ID,
  StatusPageReportsCopy,
} from "./StatusPageReportsCopy";

/*
 * "Email Reports", on a status page's Advanced -> Reports: one switch, "Send
 * email reports", that saves the moment it is flipped, and while it is on,
 * the schedule in plain words under it - when the next report goes out and
 * the dates it covers, how often, what each one covers and the timezone -
 * with Edit Schedule at the card's top right to change it.
 *
 * Switched on for the first time, the server gives the page the default
 * schedule (every month, on the 1st at 09:00 in the report timezone, each
 * report covering the month before). The lines show it at once, worked out
 * with the server's own rules, and the page is read again once the switch
 * has saved. Switched off, the lines go and the page keeps its schedule for
 * the next time; nothing has to be filled in either way.
 *
 * See StatusPageReportsCopy for what this replaced.
 */

export interface ComponentProps {
  statusPageId: ObjectID;
}

// The columns the card reads.
const REPORT_SELECT: Record<string, true> = {
  isReportEnabled: true,
  reportStartDateTime: true,
  reportRecurringInterval: true,
  reportTimezone: true,
  reportPeriodType: true,
  reportDataInDays: true,
  sendNextReportBy: true,
};

interface ReadOptions {
  /*
   * A read after a save: the card stays on screen while it runs, and a
   * failure leaves it as it was - the switch or the dialog already said
   * whether the save went through.
   */
  isQuiet?: boolean | undefined;
}

// The page's report columns, as the card reads them.
const toColumns: (page: StatusPage) => ReportScheduleColumns = (
  page: StatusPage,
): ReportScheduleColumns => {
  return {
    isReportEnabled: page.isReportEnabled,
    reportStartDateTime: page.reportStartDateTime,
    reportRecurringInterval: page.reportRecurringInterval,
    reportTimezone: page.reportTimezone,
    reportPeriodType: page.reportPeriodType,
    reportDataInDays: page.reportDataInDays,
    sendNextReportBy: page.sendNextReportBy,
  };
};

interface ScheduleLinesProps {
  columns: ReportScheduleColumns;
}

// The schedule, in plain words, under the switch.
const ScheduleLines: FunctionComponent<ScheduleLinesProps> = (
  props: ScheduleLinesProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const facts: ReportScheduleFacts = getReportScheduleFacts({
    columns: props.columns,
  });

  const getHowOften: (recurring: Recurring | undefined) => string = (
    recurring: Recurring | undefined,
  ): string => {
    if (!recurring) {
      return "-";
    }

    const count: number = Math.max(
      1,
      Math.floor(recurring.intervalCount.toNumber()),
    );
    const copy: (typeof REPORT_FREQUENCY_COPY)[keyof typeof REPORT_FREQUENCY_COPY] =
      REPORT_FREQUENCY_COPY[recurring.intervalType];

    if (!copy) {
      return recurring.toString();
    }

    return count === 1
      ? translator.translateText(copy.single) || copy.single
      : translator.translatePlural(copy.several, count);
  };

  return (
    <Detail<ReportScheduleFacts>
      id={STATUS_PAGE_REPORT_SCHEDULE_DETAILS_ID}
      item={facts}
      showDetailsInNumberOfColumns={1}
      fields={[
        {
          key: "nextSendAt",
          title: StatusPageReportsCopy.nextReportTitle,
          fieldType: FieldType.Element,
          getElement: (item: ReportScheduleFacts): ReactElement => {
            if (!item.nextSendAt) {
              return (
                <p className="text-gray-500">
                  {translator.translateText(StatusPageReportsCopy.notScheduled)}
                </p>
              );
            }

            return (
              <div className="space-y-0.5">
                <p className="font-medium text-gray-900">
                  {OneUptimeDate.getDateAsFormattedStringInTimezone({
                    date: item.nextSendAt,
                    timezone: item.timezone,
                    showWeekday: true,
                  })}
                </p>
                {item.period ? (
                  <p className="text-gray-500">
                    {translator.translateTemplate(
                      StatusPageReportsCopy.covering,
                      { dates: getReportPeriodDates(item.period) },
                    )}
                  </p>
                ) : (
                  <></>
                )}
              </div>
            );
          },
        },
        {
          key: "recurring",
          title: StatusPageReportsCopy.howOftenTitle,
          fieldType: FieldType.Element,
          getElement: (item: ReportScheduleFacts): ReactElement => {
            return <span>{getHowOften(item.recurring)}</span>;
          },
        },
        {
          key: "periodType",
          title: StatusPageReportsCopy.coversTitle,
          fieldType: FieldType.Element,
          getElement: (item: ReportScheduleFacts): ReactElement => {
            return (
              <span>
                {item.periodType ===
                StatusPageReportPeriodType.PreviousCalendarPeriod
                  ? translator.translateText(
                      StatusPageReportsCopy.previousCalendarPeriod,
                    )
                  : translator.translatePlural(
                      ROLLING_DAYS_TEMPLATE,
                      item.rollingDays,
                    )}
              </span>
            );
          },
        },
        {
          key: "timezone",
          title: StatusPageReportsCopy.timezoneTitle,
          fieldType: FieldType.Element,
          getElement: (item: ReportScheduleFacts): ReactElement => {
            return <span>{item.timezone.toString()}</span>;
          },
        },
      ]}
    />
  );
};

const StatusPageReportsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [page, setPage] = useState<ReportScheduleColumns | null>(null);
  // Where the switch is now: it moves the moment it is pressed.
  const [isOn, setIsOn] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [showScheduleDialog, setShowScheduleDialog] = useState<boolean>(false);

  /*
   * Bumped by every read: an answer for a read the card has moved on from
   * (another page, a retry, a newer save) is dropped.
   */
  const readRef: MutableRefObject<number> = useRef<number>(0);

  const statusPageIdString: string = props.statusPageId.toString();

  const fetchPage: (options?: ReadOptions) => Promise<void> = async (
    options?: ReadOptions,
  ): Promise<void> => {
    const read: number = readRef.current + 1;
    readRef.current = read;

    const isQuiet: boolean = Boolean(options?.isQuiet);

    if (!isQuiet) {
      setIsLoading(true);
      setError("");
    }

    try {
      const item: StatusPage | null = await ModelAPI.getItem<StatusPage>({
        modelType: StatusPage,
        id: props.statusPageId,
        select: REPORT_SELECT,
      });

      if (read !== readRef.current) {
        return;
      }

      if (!item) {
        if (!isQuiet) {
          setPage(null);
          setError("Item not found");
        }
      } else {
        setPage(toColumns(item));

        // A quiet read follows a save: the switch already shows where it is.
        if (!isQuiet) {
          setIsOn(item.isReportEnabled === true);
        }
      }
    } catch (err) {
      if (read !== readRef.current || isQuiet) {
        return;
      }

      setPage(null);
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    void fetchPage();

    return () => {
      readRef.current += 1;
    };
  }, [statusPageIdString]);

  /*
   * Read on every render, as a switch's lock is: the permissions arrive
   * after the first paint of a fresh sign-in.
   */
  const statusPage: StatusPage = useMemo((): StatusPage => {
    return new StatusPage();
  }, []);

  const scheduleGate: PermissionGateResult = PermissionGate.checkColumnUpdate(
    statusPage,
    "reportRecurringInterval",
  );

  // Only while reports are on: there is no schedule to edit while they are off.
  const buttons: Array<CardButtonSchema> =
    page && isOn && (scheduleGate.isAllowed || scheduleGate.disabledReason)
      ? [
          {
            title: StatusPageReportsCopy.editScheduleButton,
            buttonStyle: ButtonStyleType.NORMAL,
            icon: IconProp.Edit,
            disabled: !scheduleGate.isAllowed,
            tooltip: scheduleGate.disabledReason,
            onClick: () => {
              if (!scheduleGate.isAllowed) {
                return;
              }

              setShowScheduleDialog(true);
            },
          },
        ]
      : [];

  const getBody: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return <ComponentLoader />;
    }

    if (error || !page) {
      return (
        <ErrorMessage
          message={error || "Item not found"}
          onRefreshClick={() => {
            void fetchPage();
          }}
        />
      );
    }

    const hasSchedule: boolean = StatusPageReportScheduleUtil.hasSchedule(page);

    return (
      /*
       * A full-bleed row, ruled like the card's own header rule, as on the
       * status page's other switch cards; the schedule is a row of its own
       * below it.
       */
      <div className="-mx-5 -mb-6 border-t border-gray-200 md:-mx-6">
        <div className="px-5 py-4 md:px-6">
          <StatusPageSwitchRow
            /*
             * Keyed on the page, so a switch read for one page never shows
             * on the next one's card.
             */
            key={statusPageIdString}
            statusPageId={props.statusPageId}
            column={REPORT_SWITCH_COLUMN}
            initialValue={page.isReportEnabled === true}
            title={StatusPageReportsCopy.switchTitle}
            getDescription={(switchIsOn: boolean): string => {
              if (switchIsOn) {
                return StatusPageReportsCopy.switchOnDescription;
              }

              return hasSchedule
                ? StatusPageReportsCopy.switchOffWithScheduleDescription
                : StatusPageReportsCopy.switchOffDescription;
            }}
            onChange={(switchIsOn: boolean): void => {
              setIsOn(switchIsOn);
            }}
            onSaved={(): void => {
              // The server may have added a schedule: read it.
              void fetchPage({ isQuiet: true });
            }}
            dataTestId={STATUS_PAGE_REPORTS_SWITCH_TEST_ID}
          />
        </div>
        {isOn ? (
          <div
            className="border-t border-gray-200 px-5 py-4 md:px-6"
            data-testid={STATUS_PAGE_REPORT_SCHEDULE_TEST_ID}
          >
            <ScheduleLines
              columns={getShownReportColumns({ page: page, isOn: isOn })}
            />
          </div>
        ) : (
          <></>
        )}
      </div>
    );
  };

  // What the dialog starts with for a page on without a whole schedule.
  const draft: StatusPageReportScheduleWrite | null = page
    ? getReportScheduleDraft(page)
    : null;

  return (
    <>
      <Card
        title={StatusPageReportsCopy.cardTitle}
        description={StatusPageReportsCopy.cardDescription}
        buttons={buttons}
      >
        <div data-testid={STATUS_PAGE_REPORTS_CARD_TEST_ID}>{getBody()}</div>
      </Card>

      {showScheduleDialog ? (
        <ModelFormModal<StatusPage>
          title={StatusPageReportsCopy.editScheduleTitle}
          description={StatusPageReportsCopy.editScheduleDescription}
          name={REPORT_SCHEDULE_FORM_NAME}
          modelType={StatusPage}
          modelIdToEdit={props.statusPageId}
          submitButtonText="Save Changes"
          onClose={() => {
            setShowScheduleDialog(false);
          }}
          onSuccess={() => {
            setShowScheduleDialog(false);
            void fetchPage({ isQuiet: true });
          }}
          formProps={{
            id: REPORT_SCHEDULE_FORM_ID,
            name: REPORT_SCHEDULE_FORM_NAME,
            modelType: StatusPage,
            formType: FormType.Update,
            fields: getReportScheduleFormFields(),
            draftValues:
              draft && Object.keys(draft).length > 0
                ? (draft as FormValues<StatusPage>)
                : undefined,
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default StatusPageReportsCard;
