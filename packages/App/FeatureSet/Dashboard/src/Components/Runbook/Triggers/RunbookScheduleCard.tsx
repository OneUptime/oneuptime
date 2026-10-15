import Runbook from "Common/Models/DatabaseModels/Runbook";
import RunbookExecution from "Common/Models/DatabaseModels/RunbookExecution";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  Blue500,
  Gray500,
  Green500,
  Red500,
  Yellow500,
} from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import RunbookExecutionStatus from "Common/Types/Runbook/RunbookExecutionStatus";
import {
  DEFAULT_RUNBOOK_SCHEDULE_CHOICE,
  DEFAULT_RUNBOOK_SCHEDULE_MISSED_RUN_POLICY,
  DEFAULT_RUNBOOK_SCHEDULE_OVERLAP_POLICY,
  DEFAULT_RUNBOOK_SCHEDULE_TIMEZONE,
  RunbookScheduleChoice,
  RunbookScheduleMissedRunPolicy,
  RunbookScheduleOverlapPolicy,
  getRunbookScheduleChoice,
  RunbookScheduleProblem,
  getRunbookScheduleChoiceProblem,
  getRunbookScheduleCron,
  isValidRunbookScheduleTimezone,
} from "Common/Types/Runbook/RunbookSchedule";
import RunbookTriggerType from "Common/Types/Runbook/RunbookTriggerType";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import { useCardRuledBodyClassName } from "Common/UI/Components/Card/CardSurface";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import {
  CustomElementProps,
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import Icon from "Common/UI/Components/Icon/Icon";
import ModelSwitchRow from "Common/UI/Components/ModelSwitch/ModelSwitchRow";
import Pill from "Common/UI/Components/Pill/Pill";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import TimezoneUtil from "Common/UI/Utils/Timezone";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
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
import AppLink from "../../AppLink/AppLink";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  getRunbookRunGate,
  getRunbookRunLockedReason,
} from "../RunbookRunGate";
import RunbookScheduleField from "./RunbookScheduleField";
import RunbookSchedulePreview, { NextRuns } from "./RunbookSchedulePreview";
import RunbookTriggerNote from "./RunbookTriggerNote";
import {
  MISSED_RUN_LABELS,
  MISSED_RUN_SUMMARIES,
  OVERLAP_LABELS,
  OVERLAP_SUMMARIES,
  RunTimeText,
  RunbookTriggersCopy,
  RunbookTriggersDocs,
  RunbookTriggersTestIds,
  formatRunTime,
  getScheduleProblemText,
  getScheduleSentence,
  translateCopy,
} from "./RunbookTriggersCopy";

// The small label over each part of the card, as the webhook card's.
const SECTION_LABEL_CLASS_NAME: string =
  "mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500";

/*
 * "Schedule", on a runbook's Triggers page.
 *
 * Without a schedule yet: what one does, and Set Up Schedule. With one: a
 * switch, "Run on this schedule", that saves the moment it is flipped, the
 * schedule in a sentence under it, and - while it is on - the next runs on
 * the schedule's clock, what it does when a run is still going or a time
 * was missed, and the last run it started. Edit Schedule, at the card's top
 * right, opens the same dialog Set Up Schedule does.
 *
 * Setting a schedule up starts runs with nobody there, so it takes
 * permission to run the runbook as well as to edit it (the server refuses
 * it otherwise: RunbookTriggerAccess); turning one off takes only the edit.
 */

export interface ComponentProps {
  runbookId: ObjectID;
}

// What the schedule dialog holds.
export interface ScheduleFormValues {
  schedule: RunbookScheduleChoice;
  scheduleTimezone: string;
  scheduleOverlapPolicy: RunbookScheduleOverlapPolicy;
  scheduleMissedRunPolicy: RunbookScheduleMissedRunPolicy;
}

/*
 * The dialog's folded More fields: what happens when a run is still going
 * and when OneUptime missed a time. Right for most people as they start, so
 * folded, saying in a sentence each what they are set to - default or not,
 * so no field is drawn as a chip as well.
 */
const MORE_OPTIONS: FormFieldCollapsibleSection<ScheduleFormValues> =
  getAdvancedFormSection<ScheduleFormValues>({
    isConfigured: (): boolean => {
      return false;
    },
    getSummary: (values: FormValues<ScheduleFormValues>): Array<string> => {
      return [
        OVERLAP_SUMMARIES[
          (values.scheduleOverlapPolicy as RunbookScheduleOverlapPolicy) ||
            DEFAULT_RUNBOOK_SCHEDULE_OVERLAP_POLICY
        ],
        MISSED_RUN_SUMMARIES[
          (values.scheduleMissedRunPolicy as RunbookScheduleMissedRunPolicy) ||
            DEFAULT_RUNBOOK_SCHEDULE_MISSED_RUN_POLICY
        ],
      ];
    },
  });

// What the card reads of the runbook.
export const SCHEDULE_CARD_SELECT: {
  _id: true;
  isEnabled: true;
  steps: true;
  isScheduleEnabled: true;
  scheduleCron: true;
  scheduleTimezone: true;
  scheduleOverlapPolicy: true;
  scheduleMissedRunPolicy: true;
  scheduleNextRunAt: true;
  scheduleQueuedRunAt: true;
} = {
  _id: true,
  isEnabled: true,
  steps: true,
  isScheduleEnabled: true,
  scheduleCron: true,
  scheduleTimezone: true,
  scheduleOverlapPolicy: true,
  scheduleMissedRunPolicy: true,
  scheduleNextRunAt: true,
  scheduleQueuedRunAt: true,
};

// What the dialog starts with: the saved schedule, or every weekday at 09:00 here.
export function getScheduleFormValues(runbook: Runbook): ScheduleFormValues {
  return {
    schedule: runbook.scheduleCron
      ? getRunbookScheduleChoice(runbook.scheduleCron)
      : {
          ...DEFAULT_RUNBOOK_SCHEDULE_CHOICE,
          days: [...DEFAULT_RUNBOOK_SCHEDULE_CHOICE.days],
        },
    scheduleTimezone: isValidRunbookScheduleTimezone(runbook.scheduleTimezone)
      ? runbook.scheduleTimezone!
      : (OneUptimeDate.getCurrentTimezone() as unknown as string) ||
        DEFAULT_RUNBOOK_SCHEDULE_TIMEZONE,
    scheduleOverlapPolicy:
      runbook.scheduleOverlapPolicy || DEFAULT_RUNBOOK_SCHEDULE_OVERLAP_POLICY,
    scheduleMissedRunPolicy:
      runbook.scheduleMissedRunPolicy ||
      DEFAULT_RUNBOOK_SCHEDULE_MISSED_RUN_POLICY,
  };
}

/*
 * What a save of the dialog writes. The first time - no schedule yet - it
 * turns the schedule on too: that is what Set Up Schedule is for.
 */
export function getScheduleWrite(data: {
  values: ScheduleFormValues;
  isFirstSchedule: boolean;
}): JSONObject {
  return {
    scheduleCron: getRunbookScheduleCron(data.values.schedule),
    scheduleTimezone: data.values.scheduleTimezone,
    scheduleOverlapPolicy: data.values.scheduleOverlapPolicy,
    scheduleMissedRunPolicy: data.values.scheduleMissedRunPolicy,
    ...(data.isFirstSchedule ? { isScheduleEnabled: true } : {}),
  };
}

const RunbookScheduleCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const ruledBodyClassName: string = useCardRuledBodyClassName();

  const [runbook, setRunbook] = useState<Runbook | null>(null);
  const [lastRun, setLastRun] = useState<RunbookExecution | null>(null);
  const [isOn, setIsOn] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [showDialog, setShowDialog] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string>("");

  const readRef: MutableRefObject<number> = useRef<number>(0);

  const fetchRunbook: (options?: {
    isQuiet?: boolean;
  }) => Promise<void> = async (options?: {
    isQuiet?: boolean;
  }): Promise<void> => {
    const read: number = readRef.current + 1;
    readRef.current = read;

    if (!options?.isQuiet) {
      setIsLoading(true);
      setError("");
    }

    try {
      const item: Runbook | null = await ModelAPI.getItem<Runbook>({
        modelType: Runbook,
        id: props.runbookId,
        select: SCHEDULE_CARD_SELECT,
      });

      if (read !== readRef.current) {
        return;
      }

      if (!item) {
        if (!options?.isQuiet) {
          setError("Item not found");
        }
      } else {
        setRunbook(item);

        if (!options?.isQuiet) {
          setIsOn(item.isScheduleEnabled === true);
        }
      }
    } catch (err) {
      if (read !== readRef.current || options?.isQuiet) {
        return;
      }

      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);

    /*
     * The last run the schedule started. Someone who may read the
     * runbook but not its runs just does not see it.
     */
    try {
      const runs: ListResult<RunbookExecution> =
        await ModelAPI.getList<RunbookExecution>({
          modelType: RunbookExecution,
          query: {
            runbookId: props.runbookId,
            triggerType: RunbookTriggerType.Schedule,
          },
          limit: 1,
          skip: 0,
          select: {
            _id: true,
            status: true,
            createdAt: true,
            triggerDetails: true,
          },
          sort: { createdAt: SortOrder.Descending },
        });

      if (read === readRef.current) {
        setLastRun(runs.data[0] || null);
      }
    } catch {
      // Nothing to say: the runs are on the Executions page.
    }
  };

  const runbookIdString: string = props.runbookId.toString();

  useEffect(() => {
    void fetchRunbook();

    return () => {
      readRef.current += 1;
    };
  }, [runbookIdString]);

  /*
   * Read on every render, as a switch's lock is: the permissions arrive
   * after the first paint of a fresh sign-in.
   */
  const runbookModel: Runbook = useMemo((): Runbook => {
    return new Runbook();
  }, []);

  const editGate: PermissionGateResult = PermissionGate.checkColumnUpdate(
    runbookModel,
    "scheduleCron",
  );
  const runLockedReason: string | undefined =
    getRunbookRunLockedReason(getRunbookRunGate());

  // Setting a schedule up takes both: say so where it is offered.
  const setUpLockedReason: string | undefined = !editGate.isAllowed
    ? editGate.disabledReason || undefined
    : runLockedReason
      ? `${translator.translateText(RunbookTriggersCopy.scheduleLocked)} ${runLockedReason}`
      : undefined;

  const hasSchedule: boolean = Boolean(runbook?.scheduleCron);

  const buttons: Array<CardButtonSchema> =
    runbook && hasSchedule
      ? [
          {
            title: RunbookTriggersCopy.editScheduleButton,
            buttonStyle: ButtonStyleType.NORMAL,
            icon: IconProp.Edit,
            disabled: Boolean(setUpLockedReason),
            tooltip: setUpLockedReason,
            /*
             * Button keeps an outline button's colours when it is disabled,
             * so a locked Edit Schedule would look like one that opens. The
             * tooltip says why it is locked.
             */
            className: setUpLockedReason ? "opacity-50" : undefined,
            onClick: () => {
              if (setUpLockedReason) {
                return;
              }

              setSaveError("");
              setShowDialog(true);
            },
          },
        ]
      : [];

  const saveSchedule: (values: ScheduleFormValues) => Promise<void> = async (
    values: ScheduleFormValues,
  ): Promise<void> => {
    setIsSaving(true);
    setSaveError("");

    try {
      await ModelAPI.updateById<Runbook>({
        modelType: Runbook,
        id: props.runbookId,
        data: getScheduleWrite({
          values,
          isFirstSchedule: !hasSchedule,
        }),
      });

      setShowDialog(false);

      if (!hasSchedule) {
        setIsOn(true);
      }

      await fetchRunbook({ isQuiet: true });
    } catch (err) {
      setSaveError(API.getFriendlyMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const getEmptyState: () => ReactElement = (): ReactElement => {
    return (
      <div
        className="flex flex-col items-start gap-4 px-5 py-6 sm:flex-row sm:items-center sm:justify-between md:px-6"
        data-testid={RunbookTriggersTestIds.scheduleEmpty}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
            <Icon icon={IconProp.Clock} className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">
              {translator.translateText(RunbookTriggersCopy.scheduleEmptyTitle)}
            </p>
            <p className="mt-0.5 text-sm text-gray-500">
              {translator.translateText(
                RunbookTriggersCopy.scheduleEmptyDescription,
              )}{" "}
              <a
                className="font-medium text-indigo-600 hover:text-indigo-500"
                href={RunbookTriggersDocs.schedule}
                target="_blank"
                rel="noopener noreferrer"
              >
                {translator.translateText(
                  RunbookTriggersCopy.learnMoreSchedule,
                )}
              </a>
            </p>
          </div>
        </div>
        <Button
          title={RunbookTriggersCopy.setUpScheduleButton}
          icon={IconProp.Clock}
          buttonStyle={ButtonStyleType.PRIMARY}
          buttonSize={ButtonSize.Small}
          className="shrink-0"
          dataTestId={`${RunbookTriggersTestIds.scheduleCard}-set-up`}
          disabled={Boolean(setUpLockedReason)}
          tooltip={setUpLockedReason}
          onClick={() => {
            if (setUpLockedReason) {
              return;
            }

            setSaveError("");
            setShowDialog(true);
          }}
        />
      </div>
    );
  };

  // Whether the schedule's times start anything: the runbook is on, with steps.
  const canStartRuns: (item: Runbook) => boolean = (item: Runbook): boolean => {
    return (
      item.isEnabled !== false &&
      Array.isArray(item.steps) &&
      item.steps.length > 0
    );
  };

  const getNotes: (item: Runbook) => ReactElement = (
    item: Runbook,
  ): ReactElement => {
    const notes: Array<ReactElement> = [];

    if (item.isEnabled === false) {
      notes.push(
        <RunbookTriggerNote
          key="off"
          tone="warning"
          text={RunbookTriggersCopy.runbookOffSchedule}
          runbookId={props.runbookId}
        />,
      );
    } else if (!Array.isArray(item.steps) || item.steps.length === 0) {
      notes.push(
        <RunbookTriggerNote
          key="steps"
          tone="warning"
          text={RunbookTriggersCopy.noStepsSchedule}
          runbookId={props.runbookId}
        />,
      );
    }

    if (item.scheduleQueuedRunAt) {
      notes.push(
        <RunbookTriggerNote
          key="waiting"
          tone="info"
          text={RunbookTriggersCopy.waitingRun}
        />,
      );
    }

    if (notes.length === 0) {
      return <></>;
    }

    return <div className="space-y-2">{notes}</div>;
  };

  /*
   * The last run the schedule started: its status, as the Executions list
   * draws it, when it was - on the schedule's clock, as every time on this
   * card is, so a 06:00 schedule's run reads 06:00 - and a link to it.
   */
  const getLastRun: (timezone: string) => ReactElement = (
    timezone: string,
  ): ReactElement => {
    if (!lastRun?._id) {
      return (
        <p className="text-sm text-gray-500">
          {translator.translateText(RunbookTriggersCopy.noScheduledRunYet)}
        </p>
      );
    }

    const when: Date | undefined = lastRun.createdAt
      ? OneUptimeDate.fromString(lastRun.createdAt)
      : undefined;
    const time: RunTimeText | null = when
      ? formatRunTime({
          date: when,
          timezone,
          language: translator.language,
          now: OneUptimeDate.getCurrentDate(),
        })
      : null;
    const status: RunbookExecutionStatus =
      lastRun.status as RunbookExecutionStatus;

    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <Pill
          text={getRunStatusLabel(status)}
          color={getRunStatusColor(status)}
          isMinimal={true}
        />
        {time ? (
          <time
            className="tabular-nums text-gray-900"
            dateTime={when!.toISOString()}
            title={time.relative}
          >
            {time.when}
          </time>
        ) : (
          <></>
        )}
        <AppLink
          className="font-medium text-indigo-600 hover:text-indigo-500"
          to={RouteUtil.populateRouteParams(
            RouteMap[PageMap.RUNBOOK_VIEW_EXECUTION] as Route,
            {
              modelId: props.runbookId,
              subModelId: new ObjectID(lastRun._id.toString()),
            },
          )}
        >
          {translateCopy(translator, RunbookTriggersCopy.viewRun)}
        </AppLink>
      </div>
    );
  };

  /*
   * Under the switch: why nothing starts, if that is so; the next runs (or
   * that it is paused) beside the last run it started; and, quieter, what
   * it does when a run is still going or a time was missed.
   */
  const getDetails: (item: Runbook) => ReactElement = (
    item: Runbook,
  ): ReactElement => {
    const timezone: string =
      item.scheduleTimezone || DEFAULT_RUNBOOK_SCHEDULE_TIMEZONE;
    const overlap: RunbookScheduleOverlapPolicy =
      item.scheduleOverlapPolicy || DEFAULT_RUNBOOK_SCHEDULE_OVERLAP_POLICY;
    const missed: RunbookScheduleMissedRunPolicy =
      item.scheduleMissedRunPolicy ||
      DEFAULT_RUNBOOK_SCHEDULE_MISSED_RUN_POLICY;

    /*
     * While the runbook is off or has no steps, its times start nothing:
     * the note says why, and no time is listed as if it would run.
     */
    const getNextRuns: () => ReactElement = (): ReactElement => {
      if (!isOn) {
        return (
          <p
            className="text-sm text-gray-500"
            data-testid={`${RunbookTriggersTestIds.scheduleDetails}-paused`}
          >
            {translator.translateText(RunbookTriggersCopy.scheduleSwitchOff)}
          </p>
        );
      }

      return <NextRuns cron={item.scheduleCron || ""} timezone={timezone} />;
    };

    const showsNextRuns: boolean = !isOn || canStartRuns(item);

    return (
      <div
        className="space-y-4 border-t border-gray-200 px-5 py-4 md:px-6"
        data-testid={RunbookTriggersTestIds.scheduleDetails}
      >
        {getNotes(item)}
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          {showsNextRuns ? (
            <div>
              <p className={SECTION_LABEL_CLASS_NAME}>
                {translator.translateText(RunbookTriggersCopy.nextRunsTitle)}
              </p>
              {getNextRuns()}
            </div>
          ) : (
            <></>
          )}
          <div
            data-testid={`${RunbookTriggersTestIds.scheduleDetails}-last-run`}
          >
            <p className={SECTION_LABEL_CLASS_NAME}>
              {translator.translateText(
                RunbookTriggersCopy.lastScheduledRunTitle,
              )}
            </p>
            {getLastRun(timezone)}
          </div>
        </div>
        <dl
          className="grid grid-cols-1 gap-x-4 border-t border-gray-100 pt-3 text-sm sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-y-1"
          data-testid={`${RunbookTriggersTestIds.scheduleDetails}-policies`}
        >
          <dt className="text-gray-500">
            {translator.translateText(RunbookTriggersCopy.overlapTitle)}
          </dt>
          <dd className="mb-2 text-gray-900 sm:mb-0">
            {translator.translateText(OVERLAP_LABELS[overlap])}
          </dd>
          <dt className="text-gray-500">
            {translator.translateText(RunbookTriggersCopy.missedRunsTitle)}
          </dt>
          <dd className="text-gray-900">
            {translator.translateText(MISSED_RUN_LABELS[missed])}
          </dd>
        </dl>
      </div>
    );
  };

  const getBody: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return <ComponentLoader />;
    }

    if (error || !runbook) {
      return (
        <ErrorMessage
          message={error || "Item not found"}
          onRefreshClick={() => {
            void fetchRunbook();
          }}
        />
      );
    }

    if (!hasSchedule) {
      return <div className={ruledBodyClassName}>{getEmptyState()}</div>;
    }

    const sentence: string = getScheduleSentence(
      translator,
      getRunbookScheduleChoice(runbook.scheduleCron || ""),
    );

    return (
      <div className={ruledBodyClassName}>
        <div className="px-5 py-4 md:px-6">
          <ModelSwitchRow<Runbook>
            key={runbookIdString}
            modelType={Runbook}
            modelId={props.runbookId}
            column="isScheduleEnabled"
            initialValue={runbook.isScheduleEnabled === true}
            title={RunbookTriggersCopy.scheduleSwitchTitle}
            /*
             * What the schedule is, on or off: a paused schedule keeps its
             * times, and the card still says them. "Paused" is said where
             * the next runs would be.
             */
            getDescription={(): string => {
              return `${sentence} · ${runbook.scheduleTimezone || DEFAULT_RUNBOOK_SCHEDULE_TIMEZONE}`;
            }}
            // Turning a schedule on runs the runbook; turning it off does not.
            lockedReason={
              !isOn && runLockedReason ? runLockedReason : undefined
            }
            onChange={(switchIsOn: boolean): void => {
              setIsOn(switchIsOn);
            }}
            onSaved={(): void => {
              // The server works the next run out: read it.
              void fetchRunbook({ isQuiet: true });
            }}
            dataTestId={RunbookTriggersTestIds.scheduleSwitch}
          />
        </div>
        {getDetails(runbook)}
      </div>
    );
  };

  return (
    <>
      <Card
        title={RunbookTriggersCopy.scheduleCardTitle}
        description={RunbookTriggersCopy.scheduleCardDescription}
        buttons={buttons}
      >
        <div data-testid={RunbookTriggersTestIds.scheduleCard}>{getBody()}</div>
      </Card>

      {showDialog && runbook ? (
        <BasicFormModal<ScheduleFormValues>
          title={
            hasSchedule
              ? RunbookTriggersCopy.dialogEditTitle
              : RunbookTriggersCopy.dialogSetUpTitle
          }
          name="Runbook > Triggers > Schedule"
          description={RunbookTriggersCopy.dialogDescription}
          submitButtonText={RunbookTriggersCopy.dialogSubmit}
          isLoading={isSaving}
          error={saveError || undefined}
          onClose={() => {
            setShowDialog(false);
            setSaveError("");
          }}
          onSubmit={(values: ScheduleFormValues) => {
            void saveSchedule(values);
          }}
          formProps={{
            id: "runbook-schedule-form",
            name: "Runbook > Triggers > Schedule",
            initialValues: getScheduleFormValues(
              runbook,
            ) as unknown as FormValues<ScheduleFormValues>,
            fields: [
              {
                field: { schedule: true },
                title: RunbookTriggersCopy.whenItRunsTitle,
                fieldType: FormFieldSchemaType.CustomComponent,
                required: true,
                customValidation: (
                  values: FormValues<ScheduleFormValues>,
                ): string | null => {
                  const problem: RunbookScheduleProblem | null = values.schedule
                    ? getRunbookScheduleChoiceProblem(
                        values.schedule as RunbookScheduleChoice,
                      )
                    : null;

                  return problem
                    ? getScheduleProblemText(translator, problem)
                    : null;
                },
                getCustomElement: (
                  values: FormValues<ScheduleFormValues>,
                  elementProps: CustomElementProps,
                ): ReactElement => {
                  return (
                    <RunbookScheduleField
                      value={
                        (values.schedule as RunbookScheduleChoice) ||
                        DEFAULT_RUNBOOK_SCHEDULE_CHOICE
                      }
                      onChange={(choice: RunbookScheduleChoice) => {
                        elementProps.onChange?.(choice);
                      }}
                    />
                  );
                },
                // What is wrong with it, right under it.
                getFooterElement: (
                  values: FormValues<ScheduleFormValues>,
                ): ReactElement => {
                  return (
                    <RunbookSchedulePreview
                      part="problem"
                      choice={
                        (values.schedule as RunbookScheduleChoice) ||
                        DEFAULT_RUNBOOK_SCHEDULE_CHOICE
                      }
                      timezone={values.scheduleTimezone as string | undefined}
                    />
                  );
                },
              },
              {
                field: { scheduleTimezone: true },
                title: RunbookTriggersCopy.timezoneTitle,
                fieldType: FormFieldSchemaType.Dropdown,
                dropdownOptions: TimezoneUtil.getTimezoneDropdownOptions(),
                required: true,
                /*
                 * The schedule in a sentence and its next runs, once both
                 * it and the zone its times are read in are picked.
                 */
                getFooterElement: (
                  values: FormValues<ScheduleFormValues>,
                ): ReactElement => {
                  return (
                    <RunbookSchedulePreview
                      part="runs"
                      choice={
                        (values.schedule as RunbookScheduleChoice) ||
                        DEFAULT_RUNBOOK_SCHEDULE_CHOICE
                      }
                      timezone={values.scheduleTimezone as string | undefined}
                    />
                  );
                },
              },
              {
                field: { scheduleOverlapPolicy: true },
                title: RunbookTriggersCopy.overlapTitle,
                description: RunbookTriggersCopy.overlapFieldDescription,
                fieldType: FormFieldSchemaType.Dropdown,
                dropdownOptions: Object.values(
                  RunbookScheduleOverlapPolicy,
                ).map((policy: RunbookScheduleOverlapPolicy) => {
                  return { value: policy, label: OVERLAP_LABELS[policy] };
                }),
                required: true,
                collapsibleSection: MORE_OPTIONS,
              },
              {
                field: { scheduleMissedRunPolicy: true },
                title: RunbookTriggersCopy.missedRunsTitle,
                description: RunbookTriggersCopy.missedFieldDescription,
                fieldType: FormFieldSchemaType.Dropdown,
                dropdownOptions: Object.values(
                  RunbookScheduleMissedRunPolicy,
                ).map((policy: RunbookScheduleMissedRunPolicy) => {
                  return { value: policy, label: MISSED_RUN_LABELS[policy] };
                }),
                required: true,
                collapsibleSection: MORE_OPTIONS,
              },
            ],
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

// A run's status in a word, for "Last scheduled run".
export function getRunStatusLabel(status: RunbookExecutionStatus): string {
  switch (status) {
    case RunbookExecutionStatus.Completed:
      return translationKey("Completed");
    case RunbookExecutionStatus.Failed:
      return translationKey("Failed");
    case RunbookExecutionStatus.Running:
      return translationKey("Running");
    case RunbookExecutionStatus.WaitingForManualStep:
      return translationKey("Waiting");
    case RunbookExecutionStatus.Cancelled:
      return translationKey("Cancelled");
    case RunbookExecutionStatus.Scheduled:
    default:
      return translationKey("Scheduled");
  }
}

// Its pill's colour, as the Executions lists colour it.
export function getRunStatusColor(status: RunbookExecutionStatus): Color {
  switch (status) {
    case RunbookExecutionStatus.Completed:
      return Green500;
    case RunbookExecutionStatus.Failed:
      return Red500;
    case RunbookExecutionStatus.Running:
      return Blue500;
    case RunbookExecutionStatus.WaitingForManualStep:
      return Yellow500;
    case RunbookExecutionStatus.Cancelled:
    case RunbookExecutionStatus.Scheduled:
    default:
      return Gray500;
  }
}

export default RunbookScheduleCard;
