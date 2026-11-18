import ResolvedRecordRetentionLimitsCopy, {
  ProjectsReach,
  RESOLVED_RECORD_RETENTION_DEFAULT_TEST_ID,
  RESOLVED_RECORD_RETENTION_LIMITS_CARD_TEST_ID,
  RESOLVED_RECORD_RETENTION_MAXIMUM_TEST_ID,
  RESOLVED_RECORD_RETENTION_REACH_TEST_ID,
  ResolvedRecordRetentionLimitsKindCopy,
  getDefaultChoiceText,
  getDefaultDescription,
  getLimitChoices,
  getLimitsAfterMaximum,
  getMaximumChoiceText,
  getMaximumConfirmation,
  getMaximumDescription,
  getReachText,
  isLongerThanMaximum,
  toMaximumChoice,
  toMaximumInDays,
  toStoredLength,
} from "./ResolvedRecordRetentionLimitsCopy";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import { countProjectsReached } from "./ResolvedRecordRetentionLimitsApi";
import AdminModelAPI from "../../../Utils/ModelAPI";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import ObjectID from "Common/Types/ObjectID";
import {
  NO_RESOLVED_RECORD_RETENTION_SERVER_LIMITS,
  ResolvedRecordRetentionServerLimits,
  doesResolvedRecordRetentionMaximumDeleteMore,
  readResolvedRecordRetentionServerLimits,
} from "Common/Types/Retention/ResolvedRecordRetention";
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
import SaveStatus from "Common/UI/Components/SaveStatus/SaveStatus";
import useSaveOnChange, {
  SaveOnChange,
} from "Common/UI/Components/SaveStatus/useSaveOnChange";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useEffect,
  useId,
  useState,
} from "react";

/*
 * Admin Dashboard > Settings > Data Retention: "Resolved Incidents" and
 * "Resolved Alerts" (issue #6941), the server's limits on what each project
 * picks on its own Data Retention page (ResolvedRecordRetentionLimitsCopy
 * says what each pick means). Two picks that save the moment they are made,
 * each with "Saving…" and "Saved" beside it; a pick the server refuses goes
 * back to what the server has, with the reason under it.
 *
 *   - "Keep for at most": a pick that deletes more - a limit where there was
 *     none, or a shorter one - asks first, in a dialog that says what goes,
 *     that it can't be brought back, and how many projects it reaches,
 *     counted as it opens. Cancelled, the pick goes back. Once saved, both
 *     picks are read again: the server lowers a new project's length that
 *     is longer than the limit in the same write.
 *   - "New projects delete after": the lengths longer than the limit are
 *     shown, locked, with why. It asks nothing: it changes no project that
 *     exists.
 *
 * GlobalConfig is one row, with the zero id; the Admin Dashboard's settings
 * read and write it through AdminModelAPI.
 */

export interface ComponentProps {
  copy: ResolvedRecordRetentionLimitsKindCopy;
}

// A pick's row: its label, the pick, where its save is, and what it means.
interface SettingRowProps {
  testId: string;
  label: string;
  options: Array<DropdownOption>;
  setting: SaveOnChange<number>;
  onPick: (choice: number) => void;
  // What the pick means, in the reader's language.
  description: string;
  // The question a pick asks, while it is asked.
  children?: ReactNode | undefined;
}

const SettingRow: FunctionComponent<SettingRowProps> = (
  props: SettingRowProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const labelId: string = `${props.testId}-label-${useId()}`;

  const selectedOption: DropdownOption | undefined = props.options.find(
    (option: DropdownOption): boolean => {
      return option.value === props.setting.value;
    },
  );

  return (
    <div data-testid={`${props.testId}-row`}>
      {/*
       * The label and the pick share a line while they fit; on a phone the
       * pick wraps under its label, and the save status after it.
       */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <span id={labelId} className="text-sm font-medium text-gray-900">
          {translator.translateText(props.label) || props.label}
        </span>
        <div className="w-40" data-testid={props.testId}>
          {/*
           * Drawn from what the setting holds on every render (its options
           * are built per render, and the Dropdown follows a new value), so
           * a cancelled or refused pick goes back without remounting it - a
           * remount would drop the keyboard focus the question hands back.
           */}
          <Dropdown
            options={props.options}
            value={selectedOption}
            ariaLabelledby={labelId}
            isClearable={false}
            className="relative w-full overflow-visible rounded-md"
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              if (typeof value !== "number") {
                return;
              }

              props.onPick(value);
            }}
          />
        </div>
        <SaveStatus
          state={props.setting.saveState}
          dataTestId={`${props.testId}-status`}
        />
      </div>
      <p
        className="mt-1 text-sm text-gray-500"
        data-testid={`${props.testId}-description`}
      >
        {props.description}
      </p>
      {props.setting.error ? (
        <p
          className="mt-1 text-sm text-red-600"
          role="alert"
          data-testid={`${props.testId}-error`}
        >
          <ErrorInSentence
            message={props.setting.error}
            showWhereToLook={true}
          />
        </p>
      ) : (
        <></>
      )}
      {props.children}
    </div>
  );
};

// What a pick of the server's settings writes: one column of the one row.
const saveLimit: (data: {
  column: string;
  choice: number;
}) => Promise<void> = async (data: {
  column: string;
  choice: number;
}): Promise<void> => {
  await AdminModelAPI.updateById<GlobalConfig>({
    modelType: GlobalConfig,
    id: ObjectID.getZeroObjectID(),
    data: {
      [data.column]: toStoredLength(data.choice),
    },
  });
};

interface MaximumSettingProps {
  copy: ResolvedRecordRetentionLimitsKindCopy;
  initialChoice: number;
  onSaved: (maximumInDays: number | undefined) => void;
}

// "Keep for at most": No limit, or the longest any project keeps one.
const MaximumSetting: FunctionComponent<MaximumSettingProps> = (
  props: MaximumSettingProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  // A limit that deletes more, waiting for its question to be answered.
  const [pendingChoice, setPendingChoice] = useState<number | null>(null);
  const [reach, setReach] = useState<ProjectsReach>({ isCounting: true });

  const setting: SaveOnChange<number> = useSaveOnChange<number>({
    initialValue: props.initialChoice,
    save: async (choice: number): Promise<void> => {
      await saveLimit({ column: props.copy.maximumColumn, choice });
    },
    onSaved: (choice: number): void => {
      props.onSaved(toMaximumInDays(choice));
    },
  });

  // How many projects the question's limit reaches, counted as it is asked.
  useEffect(() => {
    if (pendingChoice === null) {
      return;
    }

    let isAsked: boolean = true;

    const settle: (count: number | null) => void = (
      count: number | null,
    ): void => {
      if (isAsked) {
        setReach({ isCounting: false, count: count });
      }
    };

    countProjectsReached({
      kind: props.copy.kind,
      maximumInDays: pendingChoice,
    })
      .then(settle)
      .catch(() => {
        // Not counted: the question is asked without it.
        settle(null);
      });

    return () => {
      isAsked = false;
    };
  }, [pendingChoice, props.copy.kind]);

  const options: Array<DropdownOption> = getLimitChoices().map(
    (choice: number): DropdownOption => {
      return {
        value: choice,
        label: getMaximumChoiceText(choice, translator),
        // Worded here, whole: drawn as it is, the page's way.
        isUserContent: true,
        isInPageDirection: true,
      };
    },
  );

  const pick: (choice: number) => void = (choice: number): void => {
    if (
      doesResolvedRecordRetentionMaximumDeleteMore({
        from: toMaximumInDays(setting.value),
        to: toMaximumInDays(choice),
      })
    ) {
      setReach({ isCounting: true });
      setPendingChoice(choice);
      return;
    }

    setting.change(choice);
  };

  const reachText: string | null =
    pendingChoice === null ? null : getReachText(reach, translator);

  return (
    <SettingRow
      testId={RESOLVED_RECORD_RETENTION_MAXIMUM_TEST_ID}
      label={ResolvedRecordRetentionLimitsCopy.maximumLabel}
      options={options}
      setting={setting}
      onPick={pick}
      description={getMaximumDescription(props.copy, setting.value, translator)}
    >
      {pendingChoice !== null ? (
        <ConfirmModal
          title={props.copy.confirmTitle}
          description={
            <>
              <p>
                {getMaximumConfirmation(props.copy, pendingChoice, translator)}
              </p>
              {reachText ? (
                <p
                  className="mt-2"
                  data-testid={RESOLVED_RECORD_RETENTION_REACH_TEST_ID}
                >
                  {reachText}
                </p>
              ) : (
                <></>
              )}
            </>
          }
          submitButtonText={ResolvedRecordRetentionLimitsCopy.confirmButton}
          submitButtonType={ButtonStyleType.DANGER}
          onSubmit={() => {
            setting.change(pendingChoice);
            setPendingChoice(null);
          }}
          onClose={() => {
            // The pick goes back to what the server has: nothing was saved.
            setPendingChoice(null);
          }}
        />
      ) : (
        <></>
      )}
    </SettingRow>
  );
};

interface DefaultSettingProps {
  copy: ResolvedRecordRetentionLimitsKindCopy;
  initialDefaultInDays: number;
  maximumInDays: number | undefined;
  onSaved: (defaultInDays: number) => void;
}

// "New projects delete after": Never, or where a new project starts.
const DefaultSetting: FunctionComponent<DefaultSettingProps> = (
  props: DefaultSettingProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const setting: SaveOnChange<number> = useSaveOnChange<number>({
    initialValue: props.initialDefaultInDays,
    save: async (choice: number): Promise<void> => {
      await saveLimit({ column: props.copy.defaultColumn, choice });
    },
    onSaved: props.onSaved,
  });

  const options: Array<DropdownOption> = getLimitChoices().map(
    (choice: number): DropdownOption => {
      const isLocked: boolean = isLongerThanMaximum(
        choice,
        props.maximumInDays,
      );

      return {
        value: choice,
        label: getDefaultChoiceText(choice, translator),
        isUserContent: true,
        isInPageDirection: true,
        // Shown, never picked: a new project could never keep one this long.
        ...(isLocked
          ? {
              isDisabled: true,
              description: ResolvedRecordRetentionLimitsCopy.longerThanMaximum,
            }
          : {}),
      };
    },
  );

  return (
    <SettingRow
      testId={RESOLVED_RECORD_RETENTION_DEFAULT_TEST_ID}
      label={ResolvedRecordRetentionLimitsCopy.defaultLabel}
      options={options}
      setting={setting}
      onPick={(choice: number) => {
        if (isLongerThanMaximum(choice, props.maximumInDays)) {
          return;
        }

        setting.change(choice);
      }}
      description={getDefaultDescription({
        copy: props.copy,
        defaultInDays: setting.value,
        maximumInDays: props.maximumInDays,
        translator,
      })}
    />
  );
};

const ResolvedRecordRetentionLimitsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const ruledListClassName: string = useCardRuledListClassName();
  const [limits, setLimits] = useState<ResolvedRecordRetentionServerLimits>(
    NO_RESOLVED_RECORD_RETENTION_SERVER_LIMITS,
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  /*
   * "New projects delete after" is drawn again from what the server holds
   * whenever the limit is saved: the server may have lowered it with it.
   */
  const [defaultRevision, setDefaultRevision] = useState<number>(0);

  // The card's two settings, as the server holds them: empty is no limit, and Never.
  const readLimits: () => Promise<ResolvedRecordRetentionServerLimits> =
    async (): Promise<ResolvedRecordRetentionServerLimits> => {
      const item: GlobalConfig | null =
        await AdminModelAPI.getItem<GlobalConfig>({
          modelType: GlobalConfig,
          id: ObjectID.getZeroObjectID(),
          select: {
            [props.copy.maximumColumn]: true,
            [props.copy.defaultColumn]: true,
          },
        });

      return readResolvedRecordRetentionServerLimits({
        maximumInDays: item ? item[props.copy.maximumColumn] : undefined,
        defaultInDays: item ? item[props.copy.defaultColumn] : undefined,
      });
    };

  const fetchLimits: () => Promise<void> = async (): Promise<void> => {
    setIsLoading(true);
    setError("");

    try {
      setLimits(await readLimits());
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    void fetchLimits();
  }, [props.copy.maximumColumn, props.copy.defaultColumn]);

  const onMaximumSaved: (
    maximumInDays: number | undefined,
  ) => Promise<void> = async (
    maximumInDays: number | undefined,
  ): Promise<void> => {
    try {
      const read: ResolvedRecordRetentionServerLimits = await readLimits();

      setLimits(read);
    } catch {
      // Not read back: the server's rule, as it applied it in the write.
      setLimits(
        (
          current: ResolvedRecordRetentionServerLimits,
        ): ResolvedRecordRetentionServerLimits => {
          return getLimitsAfterMaximum(current, maximumInDays);
        },
      );
    }

    setDefaultRevision((current: number): number => {
      return current + 1;
    });
  };

  const getBody: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return <DetailListSkeleton fields={3} columns={1} />;
    }

    if (error) {
      return (
        <ErrorMessage
          message={error}
          onRefreshClick={() => {
            void fetchLimits();
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
          <MaximumSetting
            copy={props.copy}
            initialChoice={toMaximumChoice(limits.maximumInDays)}
            onSaved={(maximumInDays: number | undefined) => {
              void onMaximumSaved(maximumInDays);
            }}
          />
        </div>
        <div className="px-5 py-4 md:px-6">
          <DefaultSetting
            key={defaultRevision}
            copy={props.copy}
            initialDefaultInDays={limits.defaultInDays}
            maximumInDays={limits.maximumInDays}
            onSaved={(defaultInDays: number) => {
              setLimits(
                (
                  current: ResolvedRecordRetentionServerLimits,
                ): ResolvedRecordRetentionServerLimits => {
                  return { ...current, defaultInDays: defaultInDays };
                },
              );
            }}
          />
        </div>
      </div>
    );
  };

  return (
    <Card title={props.copy.cardTitle} description={props.copy.cardDescription}>
      <div
        data-testid={`${RESOLVED_RECORD_RETENTION_LIMITS_CARD_TEST_ID}-${props.copy.kind.toLowerCase()}`}
      >
        {getBody()}
      </div>
    </Card>
  );
};

export default ResolvedRecordRetentionLimitsCard;
