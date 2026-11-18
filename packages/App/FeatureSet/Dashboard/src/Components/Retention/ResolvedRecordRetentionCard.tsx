import ResolvedRecordRetentionCopy, {
  KEEP_COMPLETED_POSTMORTEMS_COLUMN,
  KEEP_COMPLETED_POSTMORTEMS_TEST_ID,
  KEPT_POSTMORTEM_STATUSES_COLUMN,
  KEPT_POSTMORTEM_STATUSES_TEST_ID,
  RESOLVED_RECORD_RETENTION_CARD_TEST_ID,
  RESOLVED_RECORD_RETENTION_COUNT_TEST_ID,
  RESOLVED_RECORD_RETENTION_MAXIMUM_TEST_ID,
  RESOLVED_RECORD_RETENTION_SETTING_TEST_ID,
  ResolvedRecordRetentionKindCopy,
  getKeepCompletedPostmortemsDescription,
  getResolvedRecordRetentionChoices,
  getResolvedRecordRetentionConfirmation,
  getResolvedRecordRetentionCountText,
  getResolvedRecordRetentionDescription,
  getResolvedRecordRetentionServerMaximumText,
  getResolvedRecordRetentionText,
} from "./ResolvedRecordRetentionCopy";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import ResolvedRecordRetentionAPI from "./ResolvedRecordRetentionAPI";
import { POSTMORTEM_STATUS_SELECT } from "../Postmortem/usePostmortemStatuses";
import {
  PostmortemStatusChoice,
  toPostmortemStatusChoices,
} from "../Postmortem/PostmortemStatusChoices";
import IncidentPostmortemStatus from "Common/Models/DatabaseModels/IncidentPostmortemStatus";
import Project from "Common/Models/DatabaseModels/Project";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Color from "Common/Types/Color";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import {
  DEFAULT_KEEP_INCIDENTS_WITH_COMPLETED_POSTMORTEM,
  DEFAULT_RESOLVED_RECORD_RETENTION_IN_DAYS,
  ResolvedRecordKind,
  doesResolvedRecordRetentionDeleteMore,
  getEffectiveResolvedRecordRetentionInDays,
  isResolvedRecordRetentionOn,
  isResolvedRecordRetentionWithinMaximum,
  readKeptPostmortemStatusIds,
  readResolvedRecordRetentionInDays,
} from "Common/Types/Retention/ResolvedRecordRetention";
import ResolvedRecordRetentionAnswers, {
  DueRecordsCountAnswer,
  DueRecordsCountRequest,
  ResolvedRecordRetentionLimitsAnswer,
} from "Common/Types/Retention/ResolvedRecordRetentionAnswers";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { ErrorInSentence } from "Common/UI/Components/ErrorMessage/ErrorSentence";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelSwitchRow from "Common/UI/Components/ModelSwitch/ModelSwitchRow";
import SaveStatus from "Common/UI/Components/SaveStatus/SaveStatus";
import useSaveOnChange, {
  SaveOnChange,
} from "Common/UI/Components/SaveStatus/useSaveOnChange";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { isRecordNameAsWritten } from "Common/Utils/DefaultRecordNames";
import PostmortemStatusUtil from "Common/Utils/Incident/PostmortemStatus";
import { StateListType } from "Common/Utils/StateOrder";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";

/*
 * Resolved Incidents (Incidents -> Settings -> Data Retention) and Resolved
 * Alerts (Alerts -> Settings -> Data Retention), issue #6903: "Delete after",
 * one pick that saves the moment it is made (see ResolvedRecordRetentionCopy).
 *
 * - "Saving…" and then "Saved" show beside it; a pick the server refuses
 *   goes back to what the project has, with the reason under it.
 * - A pick that deletes more than the project deletes now - turning it on,
 *   or a shorter length - asks first, in a dialog that says what goes, that
 *   it can't be brought back, and how many it deletes now (issue #6943),
 *   counted by the server as the purge counts them. Cancelled, the pick goes
 *   back. A count that fails leaves the question as it was.
 * - The sentence under it says what the pick means: with a length, that it
 *   is checked every hour from when each was resolved; with Never, that
 *   every resolved one stays.
 * - While the server holds every project to a maximum (issue #6941), the
 *   pick shows the length the project really keeps them for, Never and the
 *   longer lengths are locked, and a line says the server's maximum.
 * - Incidents only, while a length is picked: "Keep incidents with a
 *   completed postmortem", a switch that saves on flip and asks before it
 *   is turned off - with how many that deletes - and under it, while it is
 *   on, the postmortem statuses that keep an incident (issue #6945):
 *   Completed unless others are chosen. Taking one out asks first.
 * - Someone who may not change it (anyone but a Project Owner or Admin) sees
 *   it locked, with the permission that is missing.
 */

export interface ComponentProps {
  copy: ResolvedRecordRetentionKindCopy;
  projectId: ObjectID;
}

// A count for a question: on its way, or its answer (null: it could not be counted).
interface CountState {
  isLoading: boolean;
  answer: DueRecordsCountAnswer | null;
}

const NO_COUNT: CountState = { isLoading: false, answer: null };

// What a change would be saved as, for its count.
type CountDue = (
  change: Omit<DueRecordsCountRequest, "kind">,
) => Promise<DueRecordsCountAnswer | null>;

/*
 * Counts what a change deletes once `change` is set, for the question it
 * opens; the answer of an older change is dropped.
 */
const useChangeCount: (data: {
  change: Omit<DueRecordsCountRequest, "kind"> | null;
  countDue: CountDue;
}) => CountState = (data: {
  change: Omit<DueRecordsCountRequest, "kind"> | null;
  countDue: CountDue;
}): CountState => {
  const [state, setState] = useState<CountState>(NO_COUNT);
  const key: string = data.change ? JSON.stringify(data.change) : "";

  useEffect(() => {
    if (!data.change) {
      setState(NO_COUNT);
      return;
    }

    let isCurrent: boolean = true;
    setState({ isLoading: true, answer: null });

    data
      .countDue(data.change)
      .then((answer: DueRecordsCountAnswer | null) => {
        if (isCurrent) {
          setState({ isLoading: false, answer: answer });
        }
      })
      .catch(() => {
        if (isCurrent) {
          setState(NO_COUNT);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [key]);

  return state;
};

// The line a question says how many it deletes with, or nothing.
const CountLine: FunctionComponent<{
  copy: ResolvedRecordRetentionKindCopy;
  state: CountState;
}> = (props: {
  copy: ResolvedRecordRetentionKindCopy;
  state: CountState;
}): ReactElement => {
  const translator: Translator = useTranslator();

  const text: string | null = props.state.isLoading
    ? translator.translateText(props.copy.counting) || props.copy.counting
    : getResolvedRecordRetentionCountText(
        props.copy,
        props.state.answer,
        translator,
      );

  if (!text) {
    return <></>;
  }

  return (
    <p
      className={`mt-3 text-sm ${props.state.isLoading ? "text-gray-500" : "font-medium text-gray-900"}`}
      data-testid={RESOLVED_RECORD_RETENTION_COUNT_TEST_ID}
      role="status"
    >
      {text}
    </p>
  );
};

interface SettingProps {
  copy: ResolvedRecordRetentionKindCopy;
  projectId: ObjectID;
  initialRetentionInDays: number;
  // The server's maximum for the kind; undefined for none.
  maximumInDays?: number | undefined;
  countDue: CountDue;
  onSaved: (retentionInDays: number) => void;
}

const RetentionSetting: FunctionComponent<SettingProps> = (
  props: SettingProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const labelId: string = `resolved-record-retention-label-${useId()}`;

  // A pick that deletes more, waiting for its question to be answered.
  const [pendingRetentionInDays, setPendingRetentionInDays] = useState<
    number | null
  >(null);

  /*
   * The pick keeps a copy of what it shows: a cancelled question draws it
   * again, from what the setting holds. A new revision hands the Dropdown
   * its options anew, which it follows in place; remounting it instead would
   * drop the keyboard focus the question hands back.
   */
  const [dropdownRevision, setDropdownRevision] = useState<number>(0);

  const setting: SaveOnChange<number> = useSaveOnChange<number>({
    initialValue: props.initialRetentionInDays,
    save: async (retentionInDays: number): Promise<void> => {
      await ModelAPI.updateById<Project>({
        modelType: Project,
        id: props.projectId,
        data: {
          [props.copy.column]: retentionInDays,
        },
      });
    },
    onSaved: (retentionInDays: number): void => {
      props.onSaved(retentionInDays);
    },
  });

  // How long the project really keeps them: its pick, held to the server's maximum.
  const effective: (retentionInDays: number) => number = (
    retentionInDays: number,
  ): number => {
    return getEffectiveResolvedRecordRetentionInDays({
      projectRetentionInDays: retentionInDays,
      maximumInDays: props.maximumInDays,
    });
  };

  const count: CountState = useChangeCount({
    change:
      pendingRetentionInDays === null
        ? null
        : { retentionInDays: pendingRetentionInDays },
    countDue: props.countDue,
  });

  /*
   * Read on every render: the permissions arrive after the first paint of a
   * fresh sign-in, and a gate kept from then would leave the pick locked for
   * someone who may change it.
   */
  const project: Project = useMemo((): Project => {
    return new Project();
  }, []);

  const updateGate: PermissionGateResult = PermissionGate.checkColumnUpdate(
    project,
    props.copy.column,
  );

  const options: Array<DropdownOption> = useMemo((): Array<DropdownOption> => {
    return getResolvedRecordRetentionChoices().map(
      (retentionInDays: number): DropdownOption => {
        return {
          value: retentionInDays,
          label: getResolvedRecordRetentionText(retentionInDays, translator),
          // Never and the longer lengths read as the server's maximum.
          isDisabled: !isResolvedRecordRetentionWithinMaximum({
            retentionInDays: retentionInDays,
            maximumInDays: props.maximumInDays,
          }),
        };
      },
    );
    // The revision draws them anew after a cancelled question.
  }, [translator, props.maximumInDays, dropdownRevision]);

  const selectedOption: DropdownOption | undefined = options.find(
    (option: DropdownOption): boolean => {
      return option.value === effective(setting.value);
    },
  );

  const pick: (retentionInDays: number) => void = (
    retentionInDays: number,
  ): void => {
    if (
      doesResolvedRecordRetentionDeleteMore({
        from: effective(setting.value),
        to: effective(retentionInDays),
      })
    ) {
      setPendingRetentionInDays(retentionInDays);
      return;
    }

    setting.change(retentionInDays);
  };

  const maximumText: string | null =
    getResolvedRecordRetentionServerMaximumText(
      props.copy,
      props.maximumInDays,
      translator,
    );

  const dropdown: ReactElement = (
    <div
      className="w-40"
      data-testid={RESOLVED_RECORD_RETENTION_SETTING_TEST_ID}
    >
      <Dropdown
        options={options}
        value={selectedOption}
        ariaLabelledby={labelId}
        isClearable={false}
        disabled={!updateGate.isAllowed}
        className="relative w-full overflow-visible rounded-md"
        onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
          if (typeof value !== "number" || !updateGate.isAllowed) {
            return;
          }

          pick(value);
        }}
      />
    </div>
  );

  return (
    <div data-testid={`${RESOLVED_RECORD_RETENTION_SETTING_TEST_ID}-row`}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <span id={labelId} className="text-sm font-medium text-gray-900">
          {translator.translateText(ResolvedRecordRetentionCopy.label)}
        </span>
        {updateGate.isAllowed ? (
          dropdown
        ) : (
          <Tooltip text={updateGate.disabledReason} isTextTranslated={true}>
            {dropdown}
          </Tooltip>
        )}
        <SaveStatus
          state={setting.saveState}
          dataTestId={`${RESOLVED_RECORD_RETENTION_SETTING_TEST_ID}-status`}
        />
      </div>
      <p
        className="mt-1 text-sm text-gray-500"
        data-testid={`${RESOLVED_RECORD_RETENTION_SETTING_TEST_ID}-description`}
      >
        {translator.translateText(
          getResolvedRecordRetentionDescription(
            props.copy,
            effective(setting.value),
          ),
        )}
      </p>
      {maximumText ? (
        <p
          className="mt-1 text-sm text-gray-500"
          data-testid={RESOLVED_RECORD_RETENTION_MAXIMUM_TEST_ID}
        >
          {maximumText}
        </p>
      ) : (
        <></>
      )}
      {setting.error ? (
        <p
          className="mt-1 text-sm text-red-600"
          role="alert"
          data-testid={`${RESOLVED_RECORD_RETENTION_SETTING_TEST_ID}-error`}
        >
          <ErrorInSentence message={setting.error} showWhereToLook={true} />
        </p>
      ) : (
        <></>
      )}
      {pendingRetentionInDays !== null ? (
        <ConfirmModal
          title={props.copy.confirmTitle}
          description={getResolvedRecordRetentionConfirmation(
            props.copy,
            effective(pendingRetentionInDays),
            translator,
          )}
          submitButtonText={props.copy.confirmButton}
          submitButtonType={ButtonStyleType.DANGER}
          onSubmit={() => {
            setting.change(pendingRetentionInDays);
            setPendingRetentionInDays(null);
          }}
          onClose={() => {
            setPendingRetentionInDays(null);
            setDropdownRevision((current: number): number => {
              return current + 1;
            });
          }}
        >
          <CountLine copy={props.copy} state={count} />
        </ConfirmModal>
      ) : (
        <></>
      )}
    </div>
  );
};

// The project's postmortem statuses, and the one flagged Completed.
interface PostmortemStatuses {
  choices: Array<PostmortemStatusChoice>;
  completedStatusId: string | null;
}

const loadPostmortemStatuses: (
  projectId: ObjectID,
) => Promise<PostmortemStatuses> = async (
  projectId: ObjectID,
): Promise<PostmortemStatuses> => {
  const result: ListResult<IncidentPostmortemStatus> =
    await ModelAPI.getList<IncidentPostmortemStatus>({
      modelType: IncidentPostmortemStatus,
      query: {
        projectId: projectId,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: POSTMORTEM_STATUS_SELECT,
      sort: {
        order: SortOrder.Ascending,
      },
    });

  const completed: IncidentPostmortemStatus | null =
    PostmortemStatusUtil.getCompletedStatus(result.data);

  return {
    choices: toPostmortemStatusChoices(result.data),
    completedStatusId: completed?.id?.toString().toLowerCase() || null,
  };
};

interface KeptStatusesProps {
  copy: ResolvedRecordRetentionKindCopy;
  projectId: ObjectID;
  // The project's choice; undefined for its Completed status.
  initialStatusIds: Array<string> | undefined;
  statuses: PostmortemStatuses;
  countDue: CountDue;
  onSaved: (statusIds: Array<string>) => void;
}

/*
 * Which postmortem statuses keep an incident (issue #6945): the project's
 * choice, or its Completed status. Adding one keeps more and saves at once;
 * taking one out deletes the incidents in it, so it asks first, saying how
 * many. The last one cannot be taken out: the switch above turns keeping
 * off.
 */
const KeptPostmortemStatuses: FunctionComponent<KeptStatusesProps> = (
  props: KeptStatusesProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const labelId: string = `resolved-record-retention-statuses-${useId()}`;

  const initial: Array<string> =
    props.initialStatusIds ||
    (props.statuses.completedStatusId
      ? [props.statuses.completedStatusId]
      : []);

  const [pendingStatusIds, setPendingStatusIds] =
    useState<Array<string> | null>(null);
  const [problem, setProblem] = useState<string>("");

  /*
   * Bumped to draw the pick again from what the setting holds, after a
   * cancelled question or a refused pick, even when nothing else changed.
   * Each render hands the Dropdown its options anew, which it follows in
   * place; remounting it instead would drop the keyboard focus.
   */
  const [, setDropdownRevision] = useState<number>(0);

  const setting: SaveOnChange<Array<string>> = useSaveOnChange<Array<string>>({
    initialValue: initial,
    save: async (statusIds: Array<string>): Promise<void> => {
      await ModelAPI.updateById<Project>({
        modelType: Project,
        id: props.projectId,
        data: {
          [KEPT_POSTMORTEM_STATUSES_COLUMN]: statusIds,
        },
      });
    },
    // The same statuses in another order are the same setting.
    isSame: (first: Array<string>, second: Array<string>): boolean => {
      return (
        first.length === second.length &&
        first.every((id: string): boolean => {
          return second.includes(id);
        })
      );
    },
    onSaved: (statusIds: Array<string>): void => {
      props.onSaved(statusIds);
    },
  });

  const count: CountState = useChangeCount({
    change: pendingStatusIds
      ? {
          retentionInDays: -1,
          keepIncidentsInPostmortemStatusIds: pendingStatusIds,
        }
      : null,
    countDue: props.countDue,
  });

  const project: Project = useMemo((): Project => {
    return new Project();
  }, []);

  const updateGate: PermissionGateResult = PermissionGate.checkColumnUpdate(
    project,
    KEPT_POSTMORTEM_STATUSES_COLUMN,
  );

  const selected: Set<string> = new Set<string>(setting.value);

  // Every status that is not archived, and any archived one still chosen.
  const options: Array<DropdownOption> = props.statuses.choices
    .filter((choice: PostmortemStatusChoice): boolean => {
      return !choice.isArchived || selected.has(choice.id.toLowerCase());
    })
    .map((choice: PostmortemStatusChoice): DropdownOption => {
      return {
        value: choice.id.toLowerCase(),
        label: choice.name,
        isUserContent: isRecordNameAsWritten(
          StateListType.IncidentPostmortemStatus,
          choice.name,
        ),
        color: new Color(choice.color),
        isArchived: choice.isArchived,
      };
    });

  const selectedOptions: Array<DropdownOption> = options.filter(
    (option: DropdownOption): boolean => {
      return selected.has(String(option.value));
    },
  );

  const change: (statusIds: Array<string>) => void = (
    statusIds: Array<string>,
  ): void => {
    setProblem("");

    if (statusIds.length === 0) {
      setProblem(
        translator.translateText(
          ResolvedRecordRetentionCopy.keptStatusesKeepOne,
        ) || ResolvedRecordRetentionCopy.keptStatusesKeepOne,
      );
      setDropdownRevision((current: number): number => {
        return current + 1;
      });
      return;
    }

    const takesOneOut: boolean = setting.value.some((id: string): boolean => {
      return !statusIds.includes(id);
    });

    if (takesOneOut) {
      setPendingStatusIds(statusIds);
      return;
    }

    setting.change(statusIds);
  };

  const dropdown: ReactElement = (
    <div
      className="w-full max-w-md"
      data-testid={KEPT_POSTMORTEM_STATUSES_TEST_ID}
    >
      <Dropdown
        options={options}
        value={selectedOptions}
        isMultiSelect={true}
        ariaLabelledby={labelId}
        isClearable={false}
        disabled={!updateGate.isAllowed}
        placeholder={ResolvedRecordRetentionCopy.keptStatusesPlaceholder}
        className="relative w-full overflow-visible rounded-md"
        onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
          if (!updateGate.isAllowed) {
            return;
          }

          const values: Array<DropdownValue> = Array.isArray(value)
            ? value
            : value === null || value === undefined
              ? []
              : [value];

          change(
            readKeptPostmortemStatusIds(
              values.map((item: DropdownValue): string => {
                return String(item);
              }),
            ) || [],
          );
        }}
      />
    </div>
  );

  return (
    <div
      className="mt-4"
      data-testid={`${KEPT_POSTMORTEM_STATUSES_TEST_ID}-row`}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <span id={labelId} className="text-sm font-medium text-gray-900">
          {translator.translateText(
            ResolvedRecordRetentionCopy.keptStatusesLabel,
          )}
        </span>
        <SaveStatus
          state={setting.saveState}
          dataTestId={`${KEPT_POSTMORTEM_STATUSES_TEST_ID}-status`}
        />
      </div>
      <div className="mt-2">
        {updateGate.isAllowed ? (
          dropdown
        ) : (
          <Tooltip text={updateGate.disabledReason} isTextTranslated={true}>
            {dropdown}
          </Tooltip>
        )}
      </div>
      <p className="mt-1 text-sm text-gray-500">
        {translator.translateText(
          ResolvedRecordRetentionCopy.keptStatusesDescription,
        )}
      </p>
      {problem ? (
        <p
          className="mt-1 text-sm text-red-600"
          role="alert"
          data-testid={`${KEPT_POSTMORTEM_STATUSES_TEST_ID}-problem`}
        >
          {problem}
        </p>
      ) : (
        <></>
      )}
      {setting.error ? (
        <p
          className="mt-1 text-sm text-red-600"
          role="alert"
          data-testid={`${KEPT_POSTMORTEM_STATUSES_TEST_ID}-error`}
        >
          <ErrorInSentence message={setting.error} showWhereToLook={true} />
        </p>
      ) : (
        <></>
      )}
      {pendingStatusIds ? (
        <ConfirmModal
          title={ResolvedRecordRetentionCopy.keptStatusesConfirmTitle}
          description={
            translator.translateText(
              ResolvedRecordRetentionCopy.keptStatusesConfirmDescription,
            ) || ResolvedRecordRetentionCopy.keptStatusesConfirmDescription
          }
          submitButtonText={
            ResolvedRecordRetentionCopy.keepPostmortemsOffConfirmButton
          }
          submitButtonType={ButtonStyleType.DANGER}
          onSubmit={() => {
            setting.change(pendingStatusIds);
            setPendingStatusIds(null);
          }}
          onClose={() => {
            setPendingStatusIds(null);
            setDropdownRevision((current: number): number => {
              return current + 1;
            });
          }}
        >
          <CountLine copy={props.copy} state={count} />
        </ConfirmModal>
      ) : (
        <></>
      )}
    </div>
  );
};

const ResolvedRecordRetentionCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const ruledListClassName: string = useCardRuledListClassName();
  const translator: Translator = useTranslator();
  const [retentionInDays, setRetentionInDays] = useState<number>(
    DEFAULT_RESOLVED_RECORD_RETENTION_IN_DAYS,
  );
  const [keepCompletedPostmortems, setKeepCompletedPostmortems] =
    useState<boolean>(DEFAULT_KEEP_INCIDENTS_WITH_COMPLETED_POSTMORTEM);
  const [keptStatusIds, setKeptStatusIds] = useState<Array<string> | undefined>(
    undefined,
  );
  const [statuses, setStatuses] = useState<PostmortemStatuses | null>(null);
  const [maximumInDays, setMaximumInDays] = useState<number | undefined>(
    undefined,
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  // The postmortem switch's question, with how many turning it off deletes.
  const [switchOffCount, setSwitchOffCount] =
    useState<DueRecordsCountAnswer | null>(null);

  const fetchProject: () => Promise<void> = async (): Promise<void> => {
    setIsLoading(true);
    setError("");

    try {
      const item: Project | null = await ModelAPI.getItem<Project>({
        modelType: Project,
        id: props.projectId,
        select: {
          [props.copy.column]: true,
          ...(props.copy.offersPostmortemKeep
            ? {
                [KEEP_COMPLETED_POSTMORTEMS_COLUMN]: true,
                [KEPT_POSTMORTEM_STATUSES_COLUMN]: true,
              }
            : {}),
        },
      });

      if (item) {
        // A project read before the columns existed holds the defaults.
        setRetentionInDays(
          readResolvedRecordRetentionInDays(item[props.copy.column]) ??
            DEFAULT_RESOLVED_RECORD_RETENTION_IN_DAYS,
        );

        const keep: unknown = item[KEEP_COMPLETED_POSTMORTEMS_COLUMN];

        setKeepCompletedPostmortems(
          typeof keep === "boolean"
            ? keep
            : DEFAULT_KEEP_INCIDENTS_WITH_COMPLETED_POSTMORTEM,
        );

        setKeptStatusIds(
          readKeptPostmortemStatusIds(item[KEPT_POSTMORTEM_STATUSES_COLUMN]),
        );
      } else {
        setError(
          translator.translateText("Project not found.") ||
            "Project not found.",
        );
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    /*
     * The server's maximum, and the project's postmortem statuses: best
     * effort. Without the first the choices stay open (the server holds
     * them to the maximum anyway); without the second the statuses are not
     * offered.
     */
    try {
      const limits: ResolvedRecordRetentionLimitsAnswer =
        await ResolvedRecordRetentionAPI.getLimits(props.projectId);

      setMaximumInDays(
        ResolvedRecordRetentionAnswers.getMaximumInDays(
          limits,
          props.copy.kind,
        ),
      );
    } catch {
      setMaximumInDays(undefined);
    }

    if (props.copy.offersPostmortemKeep) {
      try {
        setStatuses(await loadPostmortemStatuses(props.projectId));
      } catch {
        setStatuses(null);
      }
    }

    setIsLoading(false);
  };

  useEffect(() => {
    void fetchProject();
  }, [props.projectId.toString(), props.copy.column]);

  /*
   * What a change deletes, counted as it would be saved: the card's other
   * settings as they are now, and the change's own. A change that names no
   * length (-1) keeps the one picked.
   */
  const countDue: CountDue = async (
    change: Omit<DueRecordsCountRequest, "kind">,
  ): Promise<DueRecordsCountAnswer | null> => {
    return await ResolvedRecordRetentionAPI.countDue(props.projectId, {
      kind: props.copy.kind,
      retentionInDays:
        change.retentionInDays === -1
          ? retentionInDays
          : change.retentionInDays,
      ...(props.copy.kind === ResolvedRecordKind.Incident
        ? {
            keepIncidentsWithCompletedPostmortem:
              change.keepIncidentsWithCompletedPostmortem ??
              keepCompletedPostmortems,
            keepIncidentsInPostmortemStatusIds:
              change.keepIncidentsInPostmortemStatusIds ?? keptStatusIds,
          }
        : {}),
    });
  };

  const isOn: boolean = isResolvedRecordRetentionOn(
    getEffectiveResolvedRecordRetentionInDays({
      projectRetentionInDays: retentionInDays,
      maximumInDays: maximumInDays,
    }),
  );

  const switchGate: PermissionGateResult = PermissionGate.checkColumnUpdate(
    new Project(),
    KEEP_COMPLETED_POSTMORTEMS_COLUMN,
  );

  /*
   * How many turning the postmortem switch off deletes, read before it is
   * flipped - its question is asked the moment it is - while it is on and
   * the person may flip it.
   */
  useEffect(() => {
    setSwitchOffCount(null);

    if (
      isLoading ||
      !props.copy.offersPostmortemKeep ||
      !isOn ||
      !keepCompletedPostmortems ||
      !switchGate.isAllowed
    ) {
      return;
    }

    let isCurrent: boolean = true;

    void countDue({
      retentionInDays: -1,
      keepIncidentsWithCompletedPostmortem: false,
    }).then((answer: DueRecordsCountAnswer | null) => {
      if (isCurrent) {
        setSwitchOffCount(answer);
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [
    isLoading,
    isOn,
    retentionInDays,
    maximumInDays,
    keepCompletedPostmortems,
    switchGate.isAllowed,
  ]);

  const getBody: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return <DetailListSkeleton fields={3} columns={1} />;
    }

    if (error) {
      return (
        <ErrorMessage
          message={error}
          onRefreshClick={() => {
            void fetchProject();
          }}
        />
      );
    }

    return (
      /*
       * Full-bleed rows, ruled like the card's own header rule: the body
       * reaches the card's edges and each row brings its own padding back.
       */
      <div className={ruledListClassName}>
        <div className="px-5 py-4 md:px-6">
          <RetentionSetting
            copy={props.copy}
            projectId={props.projectId}
            initialRetentionInDays={retentionInDays}
            maximumInDays={maximumInDays}
            countDue={countDue}
            onSaved={setRetentionInDays}
          />
        </div>
        {props.copy.offersPostmortemKeep && isOn ? (
          <div className="px-5 py-4 md:px-6">
            <ModelSwitchRow<Project>
              modelType={Project}
              modelId={props.projectId}
              column={KEEP_COMPLETED_POSTMORTEMS_COLUMN}
              initialValue={keepCompletedPostmortems}
              title={ResolvedRecordRetentionCopy.keepPostmortemsTitle}
              getDescription={getKeepCompletedPostmortemsDescription}
              getConfirmation={(isTurningOn: boolean) => {
                // Turning it off deletes more: asked first, with how many.
                return isTurningOn
                  ? undefined
                  : {
                      title:
                        ResolvedRecordRetentionCopy.keepPostmortemsOffConfirmTitle,
                      description:
                        ResolvedRecordRetentionCopy.keepPostmortemsOffConfirmDescription,
                      submitButtonText:
                        ResolvedRecordRetentionCopy.keepPostmortemsOffConfirmButton,
                      submitButtonType: ButtonStyleType.DANGER,
                      warning:
                        getResolvedRecordRetentionCountText(
                          props.copy,
                          switchOffCount,
                          translator,
                        ) || undefined,
                    };
              }}
              onSaved={setKeepCompletedPostmortems}
              dataTestId={KEEP_COMPLETED_POSTMORTEMS_TEST_ID}
            />
            {keepCompletedPostmortems && statuses ? (
              <KeptPostmortemStatuses
                copy={props.copy}
                projectId={props.projectId}
                initialStatusIds={keptStatusIds}
                statuses={statuses}
                countDue={countDue}
                onSaved={setKeptStatusIds}
              />
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}
      </div>
    );
  };

  return (
    <Card title={props.copy.cardTitle} description={props.copy.cardDescription}>
      <div
        data-testid={`${RESOLVED_RECORD_RETENTION_CARD_TEST_ID}-${props.copy.kind.toLowerCase()}`}
      >
        {getBody()}
      </div>
    </Card>
  );
};

export default ResolvedRecordRetentionCard;
