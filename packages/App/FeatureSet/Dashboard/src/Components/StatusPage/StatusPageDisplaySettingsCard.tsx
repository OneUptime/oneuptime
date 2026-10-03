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
  DisplayDaysDefinition,
  DisplayOptionDefinition,
  DisplaySectionDefinition,
  DisplaySectionId,
  DisplaySettingColumn,
  DisplaySwitchDefinition,
  getDisplayDaysTestId,
  getDisplaySectionTestId,
  getDisplaySettingDefault,
  getDisplaySettingsSelect,
  getDisplaySwitchDescription,
  getDisplaySwitchTestId,
} from "./StatusPageDisplaySettingsCopy";
import StatusPageDaysSetting from "./StatusPageDaysSetting";
import StatusPageSwitchRow from "./StatusPageSwitchRow";

/*
 * "What your status page shows", on Advanced -> Advanced Settings: one row
 * per thing the page can show (incidents, episodes, announcements,
 * scheduled maintenance, uptime history, the "Powered by OneUptime" line),
 * each with its switch, how far back it goes and its labels switch. Every
 * control saves its own column at once; see StatusPageDisplaySettingsCopy
 * for what each one does and why it is drawn this way.
 *
 * The page is read once, for the card's columns only. While a list is
 * switched off its history and labels are not offered (they change nothing
 * then). When it is switched on again they come back as last saved: the
 * card keeps what each control saved, rather than what it first read.
 */

export interface ComponentProps {
  statusPageId: ObjectID;
}

export const STATUS_PAGE_DISPLAY_SETTINGS_CARD_TEST_ID: string =
  "status-page-display-settings";

type StoredValues = Partial<Record<DisplaySettingColumn, boolean | number>>;

// The column as the page holds it, its default when it holds nothing.
const getStoredValue: (
  values: StoredValues,
  column: DisplaySettingColumn,
) => boolean | number = (
  values: StoredValues,
  column: DisplaySettingColumn,
): boolean | number => {
  const value: boolean | number | undefined = values[column];

  if (value === undefined || value === null) {
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
  // Which sections' switches are on right now, as they are pressed.
  const [shownSections, setShownSections] = useState<
    Partial<Record<DisplaySectionId, boolean>>
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
        const read: StoredValues = {};

        for (const section of DISPLAY_SECTIONS) {
          for (const definition of [
            ...(section.show ? [section.show] : []),
            ...section.options,
            ...(section.days ? [section.days] : []),
          ]) {
            const value: unknown = (item as unknown as Record<string, unknown>)[
              definition.column
            ];

            if (typeof value === "boolean" || typeof value === "number") {
              read[definition.column] = value;
            }
          }
        }

        setValues(read);
        setShownSections({});
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

  const remember: (
    column: DisplaySettingColumn,
    value: boolean | number,
  ) => void = (column: DisplaySettingColumn, value: boolean | number): void => {
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
              {renderSwitch(stored, option)}
            </div>
          );
        })}
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
