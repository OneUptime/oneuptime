import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useState,
} from "react";
import StatusPageDisplaySettingsCopy, {
  DISPLAY_SECTIONS,
  DISPLAY_STATUSES,
  DISPLAY_VALUE_COLUMNS,
  DisplayChoiceDefinition,
  DisplayDaysDefinition,
  DisplayOptionDefinition,
  DisplaySectionDefinition,
  DisplaySectionId,
  DisplayStatusesDefinition,
  DisplaySwitchColumn,
  DisplaySwitchDefinition,
  DisplayValueColumn,
  getDisplayChoiceTestId,
  getDisplayDaysTestId,
  getDisplaySectionTestId,
  getDisplaySettingDefault,
  getDisplaySettingsSelect,
  getDisplayStatusesTestId,
  getDisplaySwitchDescription,
  getDisplaySwitchTestId,
} from "./StatusPageDisplaySettingsCopy";
import StatusPageChoiceSetting from "./StatusPageChoiceSetting";
import StatusPageDaysSetting from "./StatusPageDaysSetting";
import StatusPageDowntimeStatusesSetting from "./StatusPageDowntimeStatusesSetting";
import StatusPageSwitchRow from "./StatusPageSwitchRow";

/*
 * "What your status page shows", on Advanced -> Advanced Settings: one row
 * per thing the page can show (incidents, episodes, announcements,
 * scheduled maintenance, its uptime, the "Powered by OneUptime" line), each
 * with its switch, how far back it goes and its labels switch - and for the
 * uptime, the overall uptime percentage with its precision, and which
 * monitor statuses count as downtime. Every control saves its own column at
 * once; see StatusPageDisplaySettingsCopy for what each one does and why it
 * is drawn this way.
 *
 * The page is read once, for the card's columns only. While a list is
 * switched off its history and labels are not offered (they change nothing
 * then), and while the overall uptime percentage is off, neither is its
 * precision. When they are switched on again those come back as last saved:
 * the card keeps what each control saved, rather than what it first read.
 */

export interface ComponentProps {
  statusPageId: ObjectID;
}

export const STATUS_PAGE_DISPLAY_SETTINGS_CARD_TEST_ID: string =
  "status-page-display-settings";

type StoredValue = boolean | number | string;

// One empty list for every render, so a row given it sees no change.
const NO_STATUSES: Array<MonitorStatus> = [];

type StoredValues = Partial<Record<DisplayValueColumn, StoredValue>>;

// The column as the page holds it, its default when it holds nothing.
const getStoredValue: (
  values: StoredValues,
  column: DisplayValueColumn,
) => StoredValue = (
  values: StoredValues,
  column: DisplayValueColumn,
): StoredValue => {
  const value: StoredValue | undefined = values[column];

  if (value === undefined || value === null || value === "") {
    return getDisplaySettingDefault(column);
  }

  return value;
};

// Whether a switch is on: whether visitors see what it is for.
const isSwitchOn: (
  values: StoredValues,
  definition: DisplaySwitchDefinition,
) => boolean = (
  values: StoredValues,
  definition: DisplaySwitchDefinition,
): boolean => {
  const stored: boolean = Boolean(getStoredValue(values, definition.column));

  return definition.isInverted ? !stored : stored;
};

const StatusPageDisplaySettingsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const descriptionIdPrefix: string = `display-section-${useId()}`;
  const [values, setValues] = useState<StoredValues | null>(null);
  // The statuses each list of statuses holds, with their names and colours.
  const [statuses, setStatuses] = useState<
    Partial<Record<string, Array<MonitorStatus>>>
  >({});
  // Which sections' switches are on right now, as they are pressed.
  const [shownSections, setShownSections] = useState<
    Partial<Record<DisplaySectionId, boolean>>
  >({});
  // Which switches with a pick under them are on right now, as they are pressed.
  const [shownChoices, setShownChoices] = useState<
    Partial<Record<DisplaySwitchColumn, boolean>>
  >({});
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchStatusPage: () => Promise<void> = async (): Promise<void> => {
    setIsLoading(true);
    setError("");

    try {
      const item: StatusPage | null = await ModelAPI.getItem<StatusPage>({
        modelType: StatusPage,
        id: props.statusPageId,
        select: getDisplaySettingsSelect(),
      });

      if (item) {
        const record: Record<string, unknown> = item as unknown as Record<
          string,
          unknown
        >;

        const read: StoredValues = {};

        for (const column of DISPLAY_VALUE_COLUMNS) {
          const value: unknown = record[column];

          if (
            typeof value === "boolean" ||
            typeof value === "number" ||
            typeof value === "string"
          ) {
            read[column] = value;
          }
        }

        const readStatuses: Partial<Record<string, Array<MonitorStatus>>> = {};

        for (const definition of DISPLAY_STATUSES) {
          const value: unknown = record[definition.column];

          readStatuses[definition.column] = Array.isArray(value)
            ? (value as Array<MonitorStatus>)
            : [];
        }

        setValues(read);
        setStatuses(readStatuses);
        setShownSections({});
        setShownChoices({});
      } else {
        setError(
          translator.translateText(StatusPageDisplaySettingsCopy.notFound) ||
            StatusPageDisplaySettingsCopy.notFound,
        );
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    void fetchStatusPage();
  }, [props.statusPageId.toString()]);

  const remember: (column: DisplayValueColumn, value: StoredValue) => void = (
    column: DisplayValueColumn,
    value: StoredValue,
  ): void => {
    setValues((current: StoredValues | null): StoredValues => {
      return { ...(current || {}), [column]: value };
    });
  };

  const renderSwitch: (
    stored: StoredValues,
    definition: DisplaySwitchDefinition,
    onChange?: (isOn: boolean) => void,
  ) => ReactElement = (
    stored: StoredValues,
    definition: DisplaySwitchDefinition,
    onChange?: (isOn: boolean) => void,
  ): ReactElement => {
    return (
      <StatusPageSwitchRow
        statusPageId={props.statusPageId}
        column={definition.column}
        initialValue={isSwitchOn(stored, definition)}
        title={definition.title}
        getDescription={(isOn: boolean): string | undefined => {
          return getDisplaySwitchDescription(definition, isOn);
        }}
        isInverted={definition.isInverted}
        onChange={onChange}
        onSaved={(isOn: boolean): void => {
          remember(definition.column, definition.isInverted ? !isOn : isOn);
        }}
        dataTestId={getDisplaySwitchTestId(definition.column)}
      />
    );
  };

  const renderDays: (
    stored: StoredValues,
    definition: DisplayDaysDefinition,
    describedById: string | undefined,
  ) => ReactElement = (
    stored: StoredValues,
    definition: DisplayDaysDefinition,
    describedById: string | undefined,
  ): ReactElement => {
    return (
      <StatusPageDaysSetting
        statusPageId={props.statusPageId}
        column={definition.column}
        initialValue={Number(getStoredValue(stored, definition.column))}
        label={definition.label}
        maxDays={definition.maxDays}
        ariaDescribedby={describedById}
        onSaved={(days: number): void => {
          remember(definition.column, days);
        }}
        dataTestId={getDisplayDaysTestId(definition.column)}
      />
    );
  };

  const renderChoice: (
    stored: StoredValues,
    definition: DisplayChoiceDefinition,
  ) => ReactElement = (
    stored: StoredValues,
    definition: DisplayChoiceDefinition,
  ): ReactElement => {
    return (
      <StatusPageChoiceSetting
        statusPageId={props.statusPageId}
        definition={definition}
        initialValue={String(getStoredValue(stored, definition.column))}
        onSaved={(value: string): void => {
          remember(definition.column, value);
        }}
        dataTestId={getDisplayChoiceTestId(definition.column)}
      />
    );
  };

  const renderStatuses: (
    definition: DisplayStatusesDefinition,
  ) => ReactElement = (definition: DisplayStatusesDefinition): ReactElement => {
    return (
      <StatusPageDowntimeStatusesSetting
        statusPageId={props.statusPageId}
        definition={definition}
        initialStatuses={statuses[definition.column] || NO_STATUSES}
        onSaved={(saved: Array<MonitorStatus>): void => {
          setStatuses(
            (
              current: Partial<Record<string, Array<MonitorStatus>>>,
            ): Partial<Record<string, Array<MonitorStatus>>> => {
              return { ...current, [definition.column]: saved };
            },
          );
        }}
        dataTestId={getDisplayStatusesTestId(definition.column)}
      />
    );
  };

  const renderOption: (
    stored: StoredValues,
    option: DisplayOptionDefinition,
  ) => ReactElement = (
    stored: StoredValues,
    option: DisplayOptionDefinition,
  ): ReactElement => {
    const choice: DisplayChoiceDefinition | undefined = option.choiceWhileOn;

    if (!choice) {
      return renderSwitch(stored, option);
    }

    const isOn: boolean =
      shownChoices[option.column] ?? isSwitchOn(stored, option);

    return (
      <>
        {renderSwitch(stored, option, (nowOn: boolean): void => {
          setShownChoices(
            (
              current: Partial<Record<DisplaySwitchColumn, boolean>>,
            ): Partial<Record<DisplaySwitchColumn, boolean>> => {
              return { ...current, [option.column]: nowOn };
            },
          );
        })}
        {isOn ? (
          // Under the switch's name: a switch is 44px wide, 12px from it.
          <div className="mt-2 pl-14">{renderChoice(stored, choice)}</div>
        ) : (
          <></>
        )}
      </>
    );
  };

  const renderSection: (
    stored: StoredValues,
    section: DisplaySectionDefinition,
  ) => ReactElement = (
    stored: StoredValues,
    section: DisplaySectionDefinition,
  ): ReactElement => {
    const show: DisplaySwitchDefinition | undefined = section.show;

    // A section without a switch is always shown.
    const isShown: boolean = show
      ? shownSections[section.id] ?? isSwitchOn(stored, show)
      : true;

    const options: Array<DisplayOptionDefinition> = section.options.filter(
      (option: DisplayOptionDefinition): boolean => {
        return isShown || !option.isOnlyWhileShown;
      },
    );

    // The line under a section's own name, which its number box is about.
    const descriptionId: string | undefined =
      !show && section.description
        ? `${descriptionIdPrefix}-${section.id}`
        : undefined;

    return (
      <div
        className="px-5 py-4 md:px-6"
        key={section.id}
        data-testid={getDisplaySectionTestId(section.id)}
      >
        {show ? (
          renderSwitch(stored, show, (isOn: boolean): void => {
            setShownSections(
              (
                current: Partial<Record<DisplaySectionId, boolean>>,
              ): Partial<Record<DisplaySectionId, boolean>> => {
                return { ...current, [section.id]: isOn };
              },
            );
          })
        ) : (
          /*
           * In line with the switches' names: a switch is 44px wide and
           * 12px from its name (pl-14).
           */
          <div className="pl-14">
            <div className="text-sm font-medium leading-6 text-gray-900">
              {translator.translateText(section.title)}
            </div>
            {section.description ? (
              <p id={descriptionId} className="text-sm text-gray-500">
                {translator.translateTemplate(section.description, {
                  max: section.days?.maxDays ?? "",
                })}
              </p>
            ) : (
              <></>
            )}
          </div>
        )}

        {section.days && isShown ? (
          <div className="mt-3 pl-14">
            {renderDays(stored, section.days, descriptionId)}
          </div>
        ) : (
          <></>
        )}

        {options.map((option: DisplayOptionDefinition): ReactElement => {
          return (
            <div className="mt-3 pl-14" key={option.column}>
              {renderOption(stored, option)}
            </div>
          );
        })}

        {section.statuses && isShown ? (
          <div className="mt-4 pl-14">{renderStatuses(section.statuses)}</div>
        ) : (
          <></>
        )}
      </div>
    );
  };

  const getBody: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return <ComponentLoader />;
    }

    if (error || !values) {
      return (
        <ErrorMessage
          message={error}
          onRefreshClick={() => {
            void fetchStatusPage();
          }}
        />
      );
    }

    return (
      /*
       * Full-bleed rows, ruled like the card's own header rule, as on the
       * Channels card: the body reaches the card's edges and each row brings
       * its own padding back.
       */
      <div className="-mx-5 -mb-6 divide-y divide-gray-200 border-t border-gray-200 md:-mx-6">
        {DISPLAY_SECTIONS.map(
          (section: DisplaySectionDefinition): ReactElement => {
            return renderSection(values, section);
          },
        )}
      </div>
    );
  };

  return (
    <Card
      title={StatusPageDisplaySettingsCopy.cardTitle}
      description={StatusPageDisplaySettingsCopy.cardDescription}
    >
      <div data-testid={STATUS_PAGE_DISPLAY_SETTINGS_CARD_TEST_ID}>
        {getBody()}
      </div>
    </Card>
  );
};

export default StatusPageDisplaySettingsCard;
