import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import ObjectID from "Common/Types/ObjectID";
import StatusPageTheme from "Common/Types/StatusPage/StatusPageTheme";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledBodyClassName } from "Common/UI/Components/Card/CardSurface";
import ChoiceRows, {
  ChoiceRowOption,
} from "Common/UI/Components/ChoiceRows/ChoiceRows";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import SaveStatus from "Common/UI/Components/SaveStatus/SaveStatus";
import useSaveOnChange, {
  SaveOnChange,
} from "Common/UI/Components/SaveStatus/useSaveOnChange";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import StatusPageThemeCopy, {
  STATUS_PAGE_THEME_CARD_TEST_ID,
  STATUS_PAGE_THEME_CHOICES,
  STATUS_PAGE_THEME_CUSTOM_CODE_NOTE_TEST_ID,
  STATUS_PAGE_THEME_ERROR_TEST_ID,
  StatusPageThemeChoice,
  getShownStatusPageTheme,
  getStatusPageThemeChoiceTestId,
  hasStatusPageCustomCode,
} from "./StatusPageThemeCopy";

/*
 * Theme, on a status page's Branding page: Light, Dark, or as each
 * visitor's device is set - one choice of three (StatusPageThemeCopy).
 *
 * - Picking one saves it at once and says "Saved" beside it; there is no
 *   Edit button and no dialog for a single pick. A pick the server refuses
 *   goes back to what the page has, with the reason under the choices.
 * - Only the theme is sent: the column is free on every plan, so nothing a
 *   project's plan does not include can refuse the write.
 * - Someone who may not edit the status page sees the choices locked, with
 *   the permission that is missing.
 * - A page with custom CSS or header / footer HTML is told, under the
 *   choices, that its code applies in both themes and how to style the dark
 *   one: the code was written for the light page.
 */

export interface ComponentProps {
  statusPageId: ObjectID;
}

interface LoadedPage {
  theme: StatusPageTheme;
  hasCustomCode: boolean;
}

interface ThemeSettingProps {
  statusPageId: ObjectID;
  loaded: LoadedPage;
}

// The choices, once the page is read: what it has, saved the moment it changes.
const ThemeSetting: FunctionComponent<ThemeSettingProps> = (
  props: ThemeSettingProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const ruledBodyClassName: string = useCardRuledBodyClassName();

  const setting: SaveOnChange<StatusPageTheme> =
    useSaveOnChange<StatusPageTheme>({
      initialValue: props.loaded.theme,
      save: async (theme: StatusPageTheme): Promise<void> => {
        await ModelAPI.updateById<StatusPage>({
          modelType: StatusPage,
          id: props.statusPageId,
          data: { theme },
        });
      },
    });

  /*
   * Read on every render, as a settings switch does: the permissions arrive
   * after the first paint of a fresh sign-in.
   */
  const statusPage: StatusPage = useMemo((): StatusPage => {
    return new StatusPage();
  }, []);

  const updateGate: PermissionGateResult = PermissionGate.checkColumnUpdate(
    statusPage,
    "theme",
  );

  const options: Array<ChoiceRowOption<StatusPageTheme>> =
    STATUS_PAGE_THEME_CHOICES.map(
      (choice: StatusPageThemeChoice): ChoiceRowOption<StatusPageTheme> => {
        return {
          value: choice.value,
          title: choice.title,
          description: choice.description,
          dataTestId: getStatusPageThemeChoiceTestId(choice.value),
        };
      },
    );

  return (
    <div className={ruledBodyClassName}>
      <ChoiceRows<StatusPageTheme>
        value={setting.value}
        options={options}
        onPick={(theme: StatusPageTheme): void => {
          setting.change(theme);
        }}
        lockedReason={
          updateGate.isAllowed ? undefined : updateGate.disabledReason
        }
        status={<SaveStatus state={setting.saveState} />}
        ariaLabel={StatusPageThemeCopy.ariaLabel}
        dataTestId={`${STATUS_PAGE_THEME_CARD_TEST_ID}-choices`}
      />
      {setting.error ? (
        <p
          className="border-t border-gray-200 px-5 py-3 text-sm text-red-600 md:px-6"
          role="alert"
          data-testid={STATUS_PAGE_THEME_ERROR_TEST_ID}
        >
          {setting.error}
        </p>
      ) : (
        <></>
      )}
      {props.loaded.hasCustomCode ? (
        <p
          className="border-t border-gray-200 px-5 py-3 text-sm text-gray-500 md:px-6"
          data-testid={STATUS_PAGE_THEME_CUSTOM_CODE_NOTE_TEST_ID}
        >
          {translator.translateText(StatusPageThemeCopy.customCodeNote)}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

const StatusPageThemeCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [loaded, setLoaded] = useState<LoadedPage | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchStatusPage: () => Promise<void> = async (): Promise<void> => {
    setIsLoading(true);
    setError("");

    try {
      const item: StatusPage | null = await ModelAPI.getItem<StatusPage>({
        modelType: StatusPage,
        id: props.statusPageId,
        select: {
          theme: true,
          customCSS: true,
          headerHTML: true,
          footerHTML: true,
        },
      });

      if (item) {
        setLoaded({
          theme: getShownStatusPageTheme(item.theme),
          hasCustomCode: hasStatusPageCustomCode(item),
        });
      } else {
        setError(
          translator.translateText(StatusPageThemeCopy.notFound) ||
            StatusPageThemeCopy.notFound,
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

  const getBody: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return <ComponentLoader />;
    }

    if (error || !loaded) {
      return (
        <ErrorMessage
          message={error}
          onRefreshClick={() => {
            void fetchStatusPage();
          }}
        />
      );
    }

    return <ThemeSetting statusPageId={props.statusPageId} loaded={loaded} />;
  };

  return (
    <Card
      title={StatusPageThemeCopy.title}
      description={StatusPageThemeCopy.description}
    >
      <div data-testid={STATUS_PAGE_THEME_CARD_TEST_ID}>{getBody()}</div>
    </Card>
  );
};

export default StatusPageThemeCard;
