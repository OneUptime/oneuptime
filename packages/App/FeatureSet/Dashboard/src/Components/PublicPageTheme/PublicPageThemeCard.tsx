import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "Common/Types/ObjectID";
import Select from "Common/Types/BaseDatabase/Select";
import PublicPageTheme from "Common/Types/Theme/PublicPageTheme";
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
import React, { ReactElement, useEffect, useMemo, useState } from "react";
import {
  PublicPageThemeCardCopy,
  PublicPageThemeChoice,
  getPublicPageThemeChoiceTestId,
  getPublicPageThemeChoicesTestId,
  getPublicPageThemeErrorTestId,
  getShownPublicPageTheme,
} from "./PublicPageThemeCopy";

/*
 * Theme, on the Branding page of a page OneUptime shows to the public - a
 * status page (StatusPageThemeCard) or a public dashboard
 * (DashboardThemeCard): Light, Dark, or as each visitor's device is set -
 * one choice of three, each beside a small picture of the page in it.
 *
 * - Picking one saves it at once and says "Saved" beside it; there is no
 *   Edit button and no dialog for a single pick. A pick the server refuses
 *   goes back to what the page has, with the reason under the choices.
 * - Only the theme is sent: the column is free on every plan, so nothing a
 *   project's plan does not include can refuse the write.
 * - Someone who may not edit the page sees the choices locked, with the
 *   permission that is missing.
 * - What the card says under the choices, if anything, is the page's own
 *   (a status page's note about its custom code).
 *
 * The words, the pictures and the columns read with the theme are each
 * page's own; the rest is here, once.
 */

// The column every public page keeps its theme in.
export const PUBLIC_PAGE_THEME_COLUMN: string = "theme";

export interface ComponentProps<TBaseModel extends BaseModel> {
  modelType: { new (): TBaseModel };
  modelId: ObjectID;
  /*
   * What is read: the theme, and whatever decides the note under the
   * choices (getNote).
   */
  select: Select<TBaseModel>;
  copy: PublicPageThemeCardCopy;
  choices: ReadonlyArray<PublicPageThemeChoice>;
  // The picture beside a choice: the page in that theme.
  renderPreview: (theme: PublicPageTheme, isSelected: boolean) => ReactElement;
  // A note under the choices, from what was read, or nothing.
  getNote?: ((item: TBaseModel) => ReactElement | null) | undefined;
  // The card's data-testid; its parts' are built from it (PublicPageThemeCopy).
  testId: string;
}

interface Loaded<TBaseModel extends BaseModel> {
  theme: PublicPageTheme;
  item: TBaseModel;
}

interface ThemeSettingProps<TBaseModel extends BaseModel> {
  card: ComponentProps<TBaseModel>;
  loaded: Loaded<TBaseModel>;
}

// The choices, once the page is read: what it has, saved the moment it changes.
const ThemeSetting: <TBaseModel extends BaseModel>(
  props: ThemeSettingProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ThemeSettingProps<TBaseModel>,
): ReactElement => {
  const card: ComponentProps<TBaseModel> = props.card;
  const ruledBodyClassName: string = useCardRuledBodyClassName();

  const setting: SaveOnChange<PublicPageTheme> =
    useSaveOnChange<PublicPageTheme>({
      initialValue: props.loaded.theme,
      save: async (theme: PublicPageTheme): Promise<void> => {
        await ModelAPI.updateById<TBaseModel>({
          modelType: card.modelType,
          id: card.modelId,
          data: { [PUBLIC_PAGE_THEME_COLUMN]: theme },
        });
      },
    });

  /*
   * Read on every render, as a settings switch does: the permissions arrive
   * after the first paint of a fresh sign-in.
   */
  const model: TBaseModel = useMemo((): TBaseModel => {
    return new card.modelType();
  }, []);

  const updateGate: PermissionGateResult = PermissionGate.checkColumnUpdate(
    model,
    PUBLIC_PAGE_THEME_COLUMN,
  );

  const options: Array<ChoiceRowOption<PublicPageTheme>> = card.choices.map(
    (choice: PublicPageThemeChoice): ChoiceRowOption<PublicPageTheme> => {
      return {
        value: choice.value,
        title: choice.title,
        description: choice.description,
        visual: card.renderPreview(
          choice.value,
          setting.value === choice.value,
        ),
        dataTestId: getPublicPageThemeChoiceTestId(card.testId, choice.value),
      };
    },
  );

  const note: ReactElement | null = card.getNote
    ? card.getNote(props.loaded.item)
    : null;

  return (
    <div className={ruledBodyClassName}>
      <ChoiceRows<PublicPageTheme>
        value={setting.value}
        options={options}
        onPick={(theme: PublicPageTheme): void => {
          setting.change(theme);
        }}
        lockedReason={
          updateGate.isAllowed ? undefined : updateGate.disabledReason
        }
        status={<SaveStatus state={setting.saveState} />}
        ariaLabel={card.copy.ariaLabel}
        dataTestId={getPublicPageThemeChoicesTestId(card.testId)}
      />
      {setting.error ? (
        <p
          className="border-t border-gray-200 px-5 py-3 text-sm text-red-600 md:px-6"
          role="alert"
          data-testid={getPublicPageThemeErrorTestId(card.testId)}
        >
          {setting.error}
        </p>
      ) : (
        <></>
      )}
      {note || <></>}
    </div>
  );
};

const PublicPageThemeCard: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [loaded, setLoaded] = useState<Loaded<TBaseModel> | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchItem: () => Promise<void> = async (): Promise<void> => {
    setIsLoading(true);
    setError("");

    try {
      const item: TBaseModel | null = await ModelAPI.getItem<TBaseModel>({
        modelType: props.modelType,
        id: props.modelId,
        select: props.select,
      });

      if (item) {
        setLoaded({
          theme: getShownPublicPageTheme(
            item.getColumnValue(PUBLIC_PAGE_THEME_COLUMN),
          ),
          item: item,
        });
      } else {
        setError(
          translator.translateText(props.copy.notFound) || props.copy.notFound,
        );
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    void fetchItem();
  }, [props.modelId.toString()]);

  const getBody: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return <ComponentLoader />;
    }

    if (error || !loaded) {
      return (
        <ErrorMessage
          message={error}
          onRefreshClick={() => {
            void fetchItem();
          }}
        />
      );
    }

    return <ThemeSetting<TBaseModel> card={props} loaded={loaded} />;
  };

  return (
    <Card title={props.copy.title} description={props.copy.description}>
      <div data-testid={props.testId}>{getBody()}</div>
    </Card>
  );
};

export default PublicPageThemeCard;
