import {
  SECURITY_CASE_AI_AREA_COPY,
  SECURITY_CASE_AI_LIMITS_TEST_ID,
  SECURITY_CASE_AI_MODE_LABELS,
  SecurityCaseAiLimitsCopy,
  getSecurityCaseAiLimitRowTestId,
  getSecurityCaseAiModeMeaning,
} from "./SecurityCaseAiLimitsCopy";
import Project from "Common/Models/DatabaseModels/Project";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import {
  SECURITY_CASE_AI_AREAS,
  SECURITY_CASE_AI_MODES,
  SECURITY_CASE_AI_MODE_COLUMNS,
  SECURITY_CASE_AI_STAMPS_COLUMN,
  SecurityCaseAiArea,
  SecurityCaseAiMode,
  SecurityCaseAiOnItsOwnStamp,
  SecurityCaseAiOnItsOwnStamps,
  readSecurityCaseAiMode,
  readSecurityCaseAiOnItsOwnStamps,
} from "Common/Types/SecurityCase/SecurityCaseAi";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { ErrorInSentence } from "Common/UI/Components/ErrorMessage/ErrorSentence";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import SaveStatus from "Common/UI/Components/SaveStatus/SaveStatus";
import useSaveOnChange, {
  SaveOnChange,
} from "Common/UI/Components/SaveStatus/useSaveOnChange";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
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
 * SECURITY EVENTS -> AI -> SETTINGS: WHAT ONEUPTIME AI MAY DO ON A CASE
 * (#10352). One row per kind of action - work the case, block addresses,
 * contain accounts, contain hosts, fix the code, close the case - each
 * Off, Ask first or On its own, saved the moment it is picked (as the
 * switches above it are): "Saving…" and "Saved" beside it, a pick the
 * server refuses goes back with the reason under it, and whoever may not
 * change it sees it locked and why. Under each row: what the kind covers,
 * and what the choice in force means for it.
 *
 * Block addresses' On its own is a Security Admin's confirmation (the
 * dialog before it saves), which the server stamps with who and when
 * (ProjectService.stampSecurityCaseAiOnItsOwn): the row says when it was
 * given, or that none has been yet, so OneUptime AI asks until it is. The
 * Scanners policy's finished trial (#10350) clears it too, on the server
 * (SecurityCaseAiEdgeTrial).
 *
 * The rows are the project's own columns (Project.securityCaseAi*Mode);
 * they take effect only while Work cases end to end is on, which the card
 * says while it is off - the switch itself is in the card above.
 */

export interface ComponentProps {
  /*
   * Where Work cases end to end is, as the switches card above read it:
   * null until it is read.
   */
  isWorkingCases: boolean | null;
  // A row was saved: the page's other cards read what changed (#10353).
  onSaved?: (() => void) | undefined;
}

type ProjectColumns = Record<string, unknown>;

const SecurityCaseAiLimitsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const ruledListClassName: string = useCardRuledListClassName();

  const [modes, setModes] = useState<Record<
    SecurityCaseAiArea,
    SecurityCaseAiMode
  > | null>(null);
  const [stamps, setStamps] = useState<SecurityCaseAiOnItsOwnStamps>({});
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
      [SECURITY_CASE_AI_STAMPS_COLUMN]: true,
    };

    for (const area of SECURITY_CASE_AI_AREAS) {
      select[SECURITY_CASE_AI_MODE_COLUMNS[area]] = true;
    }

    try {
      const project: Project | null = await ModelAPI.getItem<Project>({
        modelType: Project,
        id: projectId,
        select: select as never,
      });

      if (readNumber !== readRef.current) {
        return;
      }

      if (!project) {
        if (data.isFirstRead) {
          setError("Item not found");
        }
      } else {
        const columns: ProjectColumns = project as unknown as ProjectColumns;

        // The rows keep their own pick once drawn: only the first read sets them.
        if (data.isFirstRead) {
          const readModes: Record<SecurityCaseAiArea, SecurityCaseAiMode> =
            {} as Record<SecurityCaseAiArea, SecurityCaseAiMode>;

          for (const area of SECURITY_CASE_AI_AREAS) {
            readModes[area] = readSecurityCaseAiMode(
              columns[SECURITY_CASE_AI_MODE_COLUMNS[area]],
            );
          }

          setModes(readModes);
        }

        setStamps(
          readSecurityCaseAiOnItsOwnStamps(
            columns[SECURITY_CASE_AI_STAMPS_COLUMN],
          ),
        );
      }
    } catch (err) {
      if (readNumber !== readRef.current) {
        return;
      }

      // A later read that fails leaves the rows as they are.
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

  const getBody: () => ReactElement = (): ReactElement => {
    if (!projectId) {
      return <></>;
    }

    if (isLoading) {
      return <DetailListSkeleton fields={6} columns={1} />;
    }

    if (error || !modes) {
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
      <div className={ruledListClassName}>
        {props.isWorkingCases === false ? (
          <p
            className="px-5 py-4 text-sm text-gray-700 md:px-6"
            data-testid={`${SECURITY_CASE_AI_LIMITS_TEST_ID}-off`}
          >
            {translator.translateText(SecurityCaseAiLimitsCopy.offLine)}
          </p>
        ) : (
          <></>
        )}
        {SECURITY_CASE_AI_AREAS.map(
          (area: SecurityCaseAiArea): ReactElement => {
            return (
              <div
                key={`${projectId.toString()}-${area}`}
                className="px-5 py-4 md:px-6"
              >
                <SecurityCaseAiLimitRow
                  projectId={projectId}
                  area={area}
                  initialMode={modes[area]}
                  stamp={stamps[area]}
                  onSaved={() => {
                    // The server stamps (or unstamps) On its own: read who and when.
                    void read({ isFirstRead: false });
                    props.onSaved?.();
                  }}
                />
              </div>
            );
          },
        )}
        <p
          className="px-5 py-4 text-sm text-gray-500 md:px-6"
          data-testid={`${SECURITY_CASE_AI_LIMITS_TEST_ID}-limits`}
        >
          {translator.translateText(SecurityCaseAiLimitsCopy.limitsLine)}
        </p>
      </div>
    );
  };

  return (
    <Card
      title={SecurityCaseAiLimitsCopy.cardTitle}
      description={SecurityCaseAiLimitsCopy.cardDescription}
    >
      <div data-testid={SECURITY_CASE_AI_LIMITS_TEST_ID}>{getBody()}</div>
    </Card>
  );
};

interface RowProps {
  projectId: ObjectID;
  area: SecurityCaseAiArea;
  initialMode: SecurityCaseAiMode;
  // Who confirmed On its own, and when (Block addresses, Contain accounts, Contain hosts).
  stamp: SecurityCaseAiOnItsOwnStamp | undefined;
  onSaved: () => void;
}

const SecurityCaseAiLimitRow: FunctionComponent<RowProps> = (
  props: RowProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const uniqueId: string = useId();
  const labelId: string = `security-case-ai-limit-label-${uniqueId}`;
  const descriptionId: string = `security-case-ai-limit-description-${uniqueId}`;
  const testId: string = getSecurityCaseAiLimitRowTestId(props.area);
  const column: string = SECURITY_CASE_AI_MODE_COLUMNS[props.area];
  const isEdge: boolean = props.area === SecurityCaseAiArea.Edge;

  // Block addresses' On its own, waiting on its dialog.
  const [isConfirming, setIsConfirming] = useState<boolean>(false);
  // Moves on when the dialog is closed, so the picker draws the choice in force again.
  const [pickRevision, setPickRevision] = useState<number>(0);
  const [isConfirmingNow, setIsConfirmingNow] = useState<boolean>(false);
  const [confirmError, setConfirmError] = useState<string>("");

  const setting: SaveOnChange<SecurityCaseAiMode> =
    useSaveOnChange<SecurityCaseAiMode>({
      initialValue: props.initialMode,
      save: async (mode: SecurityCaseAiMode): Promise<void> => {
        await ModelAPI.updateById<Project>({
          modelType: Project,
          id: props.projectId,
          data: { [column]: mode } as never,
        });
      },
      onSaved: (): void => {
        props.onSaved();
      },
    });

  /*
   * Read on every render: the permissions arrive after the first paint of a
   * fresh sign-in, and a gate kept from then would leave it locked.
   */
  const model: Project = useMemo((): Project => {
    return new Project();
  }, []);
  const gate: PermissionGateResult = PermissionGate.checkColumnUpdate(
    model,
    column,
  );

  const copy: (typeof SECURITY_CASE_AI_AREA_COPY)[SecurityCaseAiArea] =
    SECURITY_CASE_AI_AREA_COPY[props.area];

  const options: Array<DropdownOption> = SECURITY_CASE_AI_MODES.map(
    (mode: SecurityCaseAiMode): DropdownOption => {
      return {
        value: mode,
        label: SECURITY_CASE_AI_MODE_LABELS[mode],
        description: getSecurityCaseAiModeMeaning(props.area, mode),
      };
    },
  );

  const selected: DropdownOption | undefined = options.find(
    (option: DropdownOption): boolean => {
      return option.value === setting.value;
    },
  );

  // Sends On its own again, as it is stored: the server stamps it now.
  const confirmNow: () => Promise<void> = async (): Promise<void> => {
    setIsConfirmingNow(true);
    setConfirmError("");

    try {
      await ModelAPI.updateById<Project>({
        modelType: Project,
        id: props.projectId,
        data: { [column]: SecurityCaseAiMode.OnItsOwn } as never,
      });
      props.onSaved();
    } catch (err) {
      setConfirmError(API.getFriendlyMessage(err));
    }

    setIsConfirmingNow(false);
  };

  const picker: ReactElement = (
    <div className="w-full sm:w-[12rem]" data-testid={`${testId}-picker`}>
      <Dropdown
        key={`${setting.revision}-${pickRevision}`}
        options={options}
        value={selected}
        initialValue={selected}
        ariaLabelledby={labelId}
        ariaDescribedby={descriptionId}
        isClearable={false}
        disabled={!gate.isAllowed}
        className="relative w-full overflow-visible rounded-md"
        onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
          if (typeof value !== "string" || !gate.isAllowed) {
            return;
          }

          const mode: SecurityCaseAiMode = readSecurityCaseAiMode(value);

          // Blocking without asking is a Security Admin's to confirm first.
          if (
            isEdge &&
            mode === SecurityCaseAiMode.OnItsOwn &&
            setting.value !== SecurityCaseAiMode.OnItsOwn
          ) {
            setIsConfirming(true);
            return;
          }

          setting.change(mode);
        }}
      />
    </div>
  );

  // Block addresses on its own: when it was confirmed, or that it waits for that.
  const getConfirmationLine: () => ReactElement = (): ReactElement => {
    if (
      !isEdge ||
      setting.savedValue !== SecurityCaseAiMode.OnItsOwn ||
      setting.value !== SecurityCaseAiMode.OnItsOwn
    ) {
      return <></>;
    }

    if (props.stamp) {
      return (
        <p
          className="mt-1 text-sm text-gray-500"
          data-testid={`${testId}-confirmed`}
        >
          {translator.translateTemplate(
            SecurityCaseAiLimitsCopy.edgeConfirmedOn,
            {
              date: OneUptimeDate.getDateAsLocalFormattedString(
                props.stamp.at,
                true,
              ),
            },
          )}
        </p>
      );
    }

    return (
      <div
        className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-700"
        data-testid={`${testId}-not-confirmed`}
      >
        <span>
          {translator.translateText(SecurityCaseAiLimitsCopy.edgeNotConfirmed)}
        </span>
        {gate.isAllowed ? (
          <Button
            title={SecurityCaseAiLimitsCopy.edgeConfirmNowButton}
            buttonStyle={ButtonStyleType.OUTLINE}
            buttonSize={ButtonSize.Small}
            isLoading={isConfirmingNow}
            disabled={isConfirmingNow}
            onClick={() => {
              setIsConfirming(true);
            }}
            dataTestId={`${testId}-confirm-now`}
          />
        ) : (
          <></>
        )}
      </div>
    );
  };

  return (
    <div data-testid={testId}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span
          id={labelId}
          className="min-w-0 flex-1 text-sm font-medium text-gray-900"
        >
          {translator.translateText(copy.title)}
        </span>
        {gate.isAllowed ? (
          picker
        ) : (
          <Tooltip text={gate.disabledReason} isTextTranslated={true}>
            {picker}
          </Tooltip>
        )}
        <SaveStatus state={setting.saveState} dataTestId={`${testId}-status`} />
      </div>
      <p
        id={descriptionId}
        className="mt-1 text-sm text-gray-500"
        data-testid={`${testId}-description`}
      >
        {translator.translateText(copy.description)}
      </p>
      <p
        className="mt-1 text-sm text-gray-700"
        data-testid={`${testId}-meaning`}
      >
        {translator.translateText(
          getSecurityCaseAiModeMeaning(props.area, setting.value),
        )}
      </p>
      {getConfirmationLine()}
      {setting.error || confirmError ? (
        <p
          className="mt-1 text-sm text-red-600"
          role="alert"
          data-testid={`${testId}-error`}
        >
          <ErrorInSentence
            message={setting.error || confirmError}
            showWhereToLook={true}
          />
        </p>
      ) : (
        <></>
      )}
      {isConfirming ? (
        <ConfirmModal
          title={SecurityCaseAiLimitsCopy.edgeConfirmTitle}
          description={SecurityCaseAiLimitsCopy.edgeConfirmDescription}
          submitButtonText={SecurityCaseAiLimitsCopy.edgeConfirmButton}
          submitButtonType={ButtonStyleType.PRIMARY}
          onClose={() => {
            setIsConfirming(false);
            setPickRevision((revision: number): number => {
              return revision + 1;
            });
          }}
          onSubmit={() => {
            setIsConfirming(false);

            if (setting.savedValue === SecurityCaseAiMode.OnItsOwn) {
              // On its own already, with nobody's confirmation: send it again.
              void confirmNow();
              return;
            }

            setting.change(SecurityCaseAiMode.OnItsOwn);
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default SecurityCaseAiLimitsCard;
