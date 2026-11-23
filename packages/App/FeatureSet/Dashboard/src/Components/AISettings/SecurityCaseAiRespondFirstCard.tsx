import {
  SECURITY_CASE_AI_RESPOND_FIRST_TEST_ID,
  SecurityCaseAiRespondFirstCopy,
} from "./SecurityCaseAiRespondFirstCopy";
import { getSecurityCaseValues } from "../SecurityCase/SecurityCaseValues";
import Project from "Common/Models/DatabaseModels/Project";
import SecurityCasePriority from "Common/Models/DatabaseModels/SecurityCasePriority";
import ObjectID from "Common/Types/ObjectID";
import {
  SECURITY_CASE_AI_CONTAINMENT_AREAS,
  SECURITY_CASE_AI_MODE_COLUMNS,
  SECURITY_CASE_AI_STAMPS_COLUMN,
  SecurityCaseAiArea,
  SecurityCaseAiEdgeClearance,
  SecurityCaseAiMode,
  getEdgeOnItsOwnClearance,
  readSecurityCaseAiMode,
  readSecurityCaseAiOnItsOwnStamps,
} from "Common/Types/SecurityCase/SecurityCaseAi";
import {
  SECURITY_CASE_AI_HOLD_MINUTES_CHOICES,
  getSecurityCaseAiHoldMinutes,
} from "Common/Types/SecurityCase/SecurityCaseAiHold";
import { StateListType } from "Common/Utils/StateOrder";
import { translateRecordName } from "Common/Utils/DefaultRecordNames";
import {
  getSecurityCaseAiHoldThreshold,
  getSecurityCaseAiHoldThresholdChoices,
  getSecurityCasePriorityId,
  getSecurityCasePrioritiesHeldBelow,
} from "Common/Utils/SecurityCase/SecurityCaseAiHoldPriorities";
import SecurityCasePriorities from "Common/Utils/SecurityCase/SecurityCasePriorities";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { ErrorInSentence } from "Common/UI/Components/ErrorMessage/ErrorSentence";
import SaveStatus from "Common/UI/Components/SaveStatus/SaveStatus";
import useSaveOnChange, {
  SaveOnChange,
} from "Common/UI/Components/SaveStatus/useSaveOnChange";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

/*
 * SECURITY EVENTS -> AI -> SETTINGS: LET ONEUPTIME AI RESPOND FIRST (#10353).
 *
 * One switch, saved the moment it is flipped, and - once it is on - the two
 * things it holds by, each saved the moment it is picked: the priority it
 * holds cases below (High unless picked), with the priorities that choice
 * holds and alerts at once written under it, and how long at most a case
 * waits (10 minutes unless picked). Under them, what is never held.
 *
 * It is offered only while OneUptime AI may work cases at all - Triage new
 * cases and Work cases end to end, in the card above (the page hands their
 * state down): until then the switch is locked and says what to turn on.
 * One already on can always be turned off. While no kind of containment
 * runs on its own, the card says that most cases reach people as soon as
 * OneUptime AI asks, and what changes that: the rows of the card above it,
 * read again whenever one is saved (limitsRevision).
 *
 * The columns are the project's (Project.enableSecurityCaseAiRespondsFirst,
 * securityCaseAiHoldBelowPriorityId, securityCaseAiHoldMinutes): whoever
 * may not change them sees them locked and why, as every AI setting is.
 */

export interface ComponentProps {
  // Where the switches of the card above are, as it read them: null until read.
  isTriaging: boolean | null;
  isWorkingCases: boolean | null;
  // Moves on whenever a row of "What OneUptime AI may do on a case" is saved.
  limitsRevision: number;
}

const SWITCH_COLUMN: string = "enableSecurityCaseAiRespondsFirst";
const THRESHOLD_COLUMN: string = "securityCaseAiHoldBelowPriorityId";
const MINUTES_COLUMN: string = "securityCaseAiHoldMinutes";

// What the card reads of the project.
interface RespondFirstSettings {
  isOn: boolean;
  pickedPriorityId: string;
  minutes: number;
  // Some kind of containment runs on its own: a case can be contained unasked.
  isAnyContainmentOnItsOwn: boolean;
}

type ProjectColumns = Record<string, unknown>;

/*
 * Whether OneUptime AI contains any kind of threat without asking: an
 * address only once a Security Admin confirmed it (or #10350's trial, which
 * the server reads - the card cannot), a user or a host as soon as it is
 * set so.
 */
export function isAnySecurityCaseContainmentOnItsOwn(
  columns: ProjectColumns,
): boolean {
  const stamps: ReturnType<typeof readSecurityCaseAiOnItsOwnStamps> =
    readSecurityCaseAiOnItsOwnStamps(columns[SECURITY_CASE_AI_STAMPS_COLUMN]);

  return SECURITY_CASE_AI_CONTAINMENT_AREAS.some(
    (area: SecurityCaseAiArea): boolean => {
      if (
        readSecurityCaseAiMode(columns[SECURITY_CASE_AI_MODE_COLUMNS[area]]) !==
        SecurityCaseAiMode.OnItsOwn
      ) {
        return false;
      }

      return (
        area !== SecurityCaseAiArea.Edge ||
        getEdgeOnItsOwnClearance({ stamps }) !==
          SecurityCaseAiEdgeClearance.NotCleared
      );
    },
  );
}

const SecurityCaseAiRespondFirstCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const ruledListClassName: string = useCardRuledListClassName();

  const [settings, setSettings] = useState<RespondFirstSettings | null>(null);
  const [priorities, setPriorities] = useState<Array<SecurityCasePriority>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  // The read the card is on, so an older read finishing late is dropped.
  const readRef: MutableRefObject<number> = useRef<number>(0);

  const read: (data: { isFirstRead: boolean }) => Promise<void> = async (data: {
    isFirstRead: boolean;
  }): Promise<void> => {
    if (!projectId) {
      return;
    }

    const readNumber: number = readRef.current + 1;
    readRef.current = readNumber;

    if (data.isFirstRead) {
      setIsLoading(true);
      setError("");
    }

    const select: Record<string, boolean> = {
      [SWITCH_COLUMN]: true,
      [THRESHOLD_COLUMN]: true,
      [MINUTES_COLUMN]: true,
      [SECURITY_CASE_AI_STAMPS_COLUMN]: true,
    };

    for (const area of SECURITY_CASE_AI_CONTAINMENT_AREAS) {
      select[SECURITY_CASE_AI_MODE_COLUMNS[area]] = true;
    }

    try {
      const [project, values]: [
        Project | null,
        Awaited<ReturnType<typeof getSecurityCaseValues>>,
      ] = await Promise.all([
        ModelAPI.getItem<Project>({
          modelType: Project,
          id: projectId,
          select: select as never,
        }),
        getSecurityCaseValues(projectId),
      ]);

      if (readNumber !== readRef.current) {
        return;
      }

      if (!project) {
        if (data.isFirstRead) {
          setError("Item not found");
        }
      } else {
        const columns: ProjectColumns = project as unknown as ProjectColumns;
        const read: RespondFirstSettings = {
          isOn: columns[SWITCH_COLUMN] === true,
          pickedPriorityId: columns[THRESHOLD_COLUMN]
            ? String(columns[THRESHOLD_COLUMN])
            : "",
          minutes: getSecurityCaseAiHoldMinutes(
            typeof columns[MINUTES_COLUMN] === "number"
              ? (columns[MINUTES_COLUMN] as number)
              : null,
          ),
          isAnyContainmentOnItsOwn:
            isAnySecurityCaseContainmentOnItsOwn(columns),
        };

        setPriorities(values.priorities);

        // The controls keep their own pick once drawn: a later read refreshes only the hint.
        setSettings((current: RespondFirstSettings | null) => {
          return data.isFirstRead || !current
            ? read
            : {
                ...current,
                isAnyContainmentOnItsOwn: read.isAnyContainmentOnItsOwn,
              };
        });
      }
    } catch (err) {
      if (readNumber !== readRef.current) {
        return;
      }

      if (data.isFirstRead) {
        setError(API.getFriendlyMessage(err));
      }
    }

    if (data.isFirstRead) {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void read({ isFirstRead: true });

    return () => {
      readRef.current += 1;
    };
  }, [projectId?.toString()]);

  // A row of the card above was saved: whether anything contains on its own may have changed.
  useEffect(() => {
    if (props.limitsRevision > 0) {
      void read({ isFirstRead: false });
    }
  }, [props.limitsRevision]);

  const getBody: () => ReactElement = (): ReactElement => {
    if (!projectId) {
      return <></>;
    }

    if (isLoading) {
      return <DetailListSkeleton fields={3} columns={1} />;
    }

    if (error || !settings) {
      return (
        <ErrorMessage
          message={error || "Item not found"}
          onRefreshClick={() => {
            void read({ isFirstRead: true });
          }}
        />
      );
    }

    return (
      <RespondFirstSettingsRows
        projectId={projectId}
        settings={settings}
        priorities={priorities}
        isTriaging={props.isTriaging}
        isWorkingCases={props.isWorkingCases}
        ruledListClassName={ruledListClassName}
        translator={translator}
      />
    );
  };

  return (
    <Card
      title={SecurityCaseAiRespondFirstCopy.cardTitle}
      description={SecurityCaseAiRespondFirstCopy.cardDescription}
    >
      <div data-testid={SECURITY_CASE_AI_RESPOND_FIRST_TEST_ID}>
        {getBody()}
      </div>
    </Card>
  );
};

interface RowsProps {
  projectId: ObjectID;
  settings: RespondFirstSettings;
  priorities: Array<SecurityCasePriority>;
  isTriaging: boolean | null;
  isWorkingCases: boolean | null;
  ruledListClassName: string;
  translator: Translator;
}

const RespondFirstSettingsRows: FunctionComponent<RowsProps> = (
  props: RowsProps,
): ReactElement => {
  const { translator } = props;
  const uniqueId: string = useId();
  const testId: string = SECURITY_CASE_AI_RESPOND_FIRST_TEST_ID;

  // Read on every render: the permissions arrive after a fresh sign-in's first paint.
  const model: Project = useMemo((): Project => {
    return new Project();
  }, []);
  const switchGate: PermissionGateResult = PermissionGate.checkColumnUpdate(
    model,
    SWITCH_COLUMN,
  );
  const thresholdGate: PermissionGateResult = PermissionGate.checkColumnUpdate(
    model,
    THRESHOLD_COLUMN,
  );
  const minutesGate: PermissionGateResult = PermissionGate.checkColumnUpdate(
    model,
    MINUTES_COLUMN,
  );

  const save: (column: string, value: unknown) => Promise<void> = async (
    column: string,
    value: unknown,
  ): Promise<void> => {
    await ModelAPI.updateById<Project>({
      modelType: Project,
      id: props.projectId,
      data: { [column]: value } as never,
    });
  };

  const switchSetting: SaveOnChange<boolean> = useSaveOnChange<boolean>({
    initialValue: props.settings.isOn,
    save: async (isOn: boolean): Promise<void> => {
      await save(SWITCH_COLUMN, isOn);
    },
  });

  // The priority picked, or the one it falls back to: what the picker shows.
  const threshold: SecurityCasePriority | null = getSecurityCaseAiHoldThreshold(
    {
      priorities: props.priorities,
      pickedPriorityId: props.settings.pickedPriorityId || null,
    },
  );
  const thresholdSetting: SaveOnChange<string> = useSaveOnChange<string>({
    initialValue: threshold ? getSecurityCasePriorityId(threshold) : "",
    save: async (priorityId: string): Promise<void> => {
      await save(THRESHOLD_COLUMN, priorityId || null);
    },
  });

  const minutesSetting: SaveOnChange<number> = useSaveOnChange<number>({
    initialValue: props.settings.minutes,
    save: async (minutes: number): Promise<void> => {
      await save(MINUTES_COLUMN, minutes);
    },
  });

  // Offered only while OneUptime AI may work cases at all; one already on can still go off.
  const isResponderOff: boolean =
    props.isTriaging === false || props.isWorkingCases === false;
  const isSwitchLocked: boolean =
    !switchGate.isAllowed || (isResponderOff && !switchSetting.value);

  const priorityName: (priority: SecurityCasePriority) => string = (
    priority: SecurityCasePriority,
  ): string => {
    return translateRecordName(
      translator,
      StateListType.SecurityCasePriority,
      priority.name || "",
    );
  };

  const thresholdOptions: Array<DropdownOption> =
    getSecurityCaseAiHoldThresholdChoices(props.priorities).map(
      (priority: SecurityCasePriority): DropdownOption => {
        return {
          value: getSecurityCasePriorityId(priority),
          label: priorityName(priority),
          isUserContent: true,
          ...(priority.color ? { color: priority.color } : {}),
        } as DropdownOption;
      },
    );

  const minuteChoices: Array<number> = Array.from(
    new Set<number>([
      ...SECURITY_CASE_AI_HOLD_MINUTES_CHOICES,
      minutesSetting.savedValue,
    ]),
  ).sort((a: number, b: number): number => {
    return a - b;
  });
  const minutesOptions: Array<DropdownOption> = minuteChoices.map(
    (minutes: number): DropdownOption => {
      return {
        value: minutes,
        label: translator.translatePlural(
          SecurityCaseAiRespondFirstCopy.holdMinutes,
          minutes,
          { count: translator.formatNumber(minutes) },
        ),
        isUserContent: true,
      } as DropdownOption;
    },
  );

  // What the threshold picked holds, and what alerts people at once.
  const held: Array<SecurityCasePriority> = getSecurityCasePrioritiesHeldBelow({
    priorities: props.priorities,
    thresholdId: thresholdSetting.value || null,
  });
  const alerted: Array<SecurityCasePriority> = SecurityCasePriorities.sort(
    props.priorities,
  ).filter((priority: SecurityCasePriority): boolean => {
    return (
      priority.isArchived !== true &&
      !held.some((one: SecurityCasePriority): boolean => {
        return (
          getSecurityCasePriorityId(one) === getSecurityCasePriorityId(priority)
        );
      })
    );
  });
  const listOf: (list: Array<SecurityCasePriority>) => string = (
    list: Array<SecurityCasePriority>,
  ): string => {
    return list.map(priorityName).join(", ");
  };

  const errorLine: (message: string, rowTestId: string) => ReactElement = (
    message: string,
    rowTestId: string,
  ): ReactElement => {
    return message ? (
      <p
        className="mt-1 text-sm text-red-600"
        role="alert"
        data-testid={`${rowTestId}-error`}
      >
        <ErrorInSentence message={message} showWhereToLook={true} />
      </p>
    ) : (
      <></>
    );
  };

  const withLock: (
    gate: PermissionGateResult,
    control: ReactElement,
  ) => ReactElement = (
    gate: PermissionGateResult,
    control: ReactElement,
  ): ReactElement => {
    return gate.isAllowed ? (
      control
    ) : (
      <Tooltip text={gate.disabledReason} isTextTranslated={true}>
        {control}
      </Tooltip>
    );
  };

  const thresholdLabelId: string = `respond-first-threshold-${uniqueId}`;
  const minutesLabelId: string = `respond-first-minutes-${uniqueId}`;

  return (
    <div className={props.ruledListClassName}>
      <div className="px-5 py-4 md:px-6" data-testid={`${testId}-switch-row`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1">
            <Toggle
              title={SecurityCaseAiRespondFirstCopy.switchTitle}
              description={SecurityCaseAiRespondFirstCopy.switchDescription}
              value={switchSetting.value}
              disabled={isSwitchLocked}
              tooltip={
                !switchGate.isAllowed ? switchGate.disabledReason : undefined
              }
              isTooltipTranslated={true}
              dataTestId={`${testId}-switch`}
              onChange={(isOn: boolean) => {
                if (isSwitchLocked) {
                  return;
                }

                switchSetting.change(isOn);
              }}
            />
          </div>
          <SaveStatus
            state={switchSetting.saveState}
            dataTestId={`${testId}-switch-status`}
          />
        </div>
        {isResponderOff && !switchSetting.value ? (
          <p
            className="mt-2 text-sm text-gray-700"
            data-testid={`${testId}-needs-responder`}
          >
            {translator.translateText(
              SecurityCaseAiRespondFirstCopy.needsResponder,
            )}
          </p>
        ) : (
          <></>
        )}
        {errorLine(switchSetting.error, `${testId}-switch`)}
      </div>

      {switchSetting.value ? (
        <>
          <div
            className="px-5 py-4 md:px-6"
            data-testid={`${testId}-threshold-row`}
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span
                id={thresholdLabelId}
                className="min-w-0 flex-1 text-sm font-medium text-gray-900"
              >
                {translator.translateText(
                  SecurityCaseAiRespondFirstCopy.thresholdTitle,
                )}
              </span>
              {withLock(
                thresholdGate,
                <div
                  className="w-full sm:w-[12rem]"
                  data-testid={`${testId}-threshold-picker`}
                >
                  <Dropdown
                    key={`threshold-${thresholdSetting.revision}`}
                    options={thresholdOptions}
                    value={thresholdOptions.find(
                      (option: DropdownOption): boolean => {
                        return option.value === thresholdSetting.value;
                      },
                    )}
                    ariaLabelledby={thresholdLabelId}
                    isClearable={false}
                    disabled={!thresholdGate.isAllowed}
                    className="relative w-full overflow-visible rounded-md"
                    onChange={(
                      value: DropdownValue | Array<DropdownValue> | null,
                    ) => {
                      if (
                        typeof value === "string" &&
                        thresholdGate.isAllowed
                      ) {
                        thresholdSetting.change(value);
                      }
                    }}
                  />
                </div>,
              )}
              <SaveStatus
                state={thresholdSetting.saveState}
                dataTestId={`${testId}-threshold-status`}
              />
            </div>
            <p className="mt-1 text-sm text-gray-500">
              {translator.translateText(
                SecurityCaseAiRespondFirstCopy.thresholdDescription,
              )}
            </p>
            <p
              className="mt-1 text-sm text-gray-700"
              data-testid={`${testId}-threshold-holds`}
            >
              {held.length > 0
                ? translator.translateTemplate(
                    SecurityCaseAiRespondFirstCopy.thresholdHolds,
                    { held: listOf(held), alerted: listOf(alerted) },
                  )
                : translator.translateText(
                    SecurityCaseAiRespondFirstCopy.thresholdNothingHeld,
                  )}
            </p>
            {errorLine(thresholdSetting.error, `${testId}-threshold`)}
          </div>

          <div
            className="px-5 py-4 md:px-6"
            data-testid={`${testId}-minutes-row`}
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span
                id={minutesLabelId}
                className="min-w-0 flex-1 text-sm font-medium text-gray-900"
              >
                {translator.translateText(
                  SecurityCaseAiRespondFirstCopy.holdTitle,
                )}
              </span>
              {withLock(
                minutesGate,
                <div
                  className="w-full sm:w-[12rem]"
                  data-testid={`${testId}-minutes-picker`}
                >
                  <Dropdown
                    key={`minutes-${minutesSetting.revision}`}
                    options={minutesOptions}
                    value={minutesOptions.find(
                      (option: DropdownOption): boolean => {
                        return option.value === minutesSetting.value;
                      },
                    )}
                    ariaLabelledby={minutesLabelId}
                    isClearable={false}
                    disabled={!minutesGate.isAllowed}
                    className="relative w-full overflow-visible rounded-md"
                    onChange={(
                      value: DropdownValue | Array<DropdownValue> | null,
                    ) => {
                      if (typeof value === "number" && minutesGate.isAllowed) {
                        minutesSetting.change(value);
                      }
                    }}
                  />
                </div>,
              )}
              <SaveStatus
                state={minutesSetting.saveState}
                dataTestId={`${testId}-minutes-status`}
              />
            </div>
            <p className="mt-1 text-sm text-gray-500">
              {translator.translateText(
                SecurityCaseAiRespondFirstCopy.holdDescription,
              )}
            </p>
            {errorLine(minutesSetting.error, `${testId}-minutes`)}
          </div>

          {!props.settings.isAnyContainmentOnItsOwn ? (
            <p
              className="px-5 py-4 text-sm text-gray-700 md:px-6"
              data-testid={`${testId}-asks-first`}
            >
              {translator.translateText(
                SecurityCaseAiRespondFirstCopy.asksFirstHint,
              )}
            </p>
          ) : (
            <></>
          )}
        </>
      ) : (
        <></>
      )}

      <p
        className="px-5 py-4 text-sm text-gray-500 md:px-6"
        data-testid={`${testId}-never-held`}
      >
        {translator.translateText(SecurityCaseAiRespondFirstCopy.neverHeld)}
      </p>
    </div>
  );
};

export default SecurityCaseAiRespondFirstCard;
