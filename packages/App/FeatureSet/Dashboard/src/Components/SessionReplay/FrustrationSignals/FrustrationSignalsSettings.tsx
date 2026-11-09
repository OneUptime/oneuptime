import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  SessionReplayCustomSignal,
  SessionReplayFrustrationSettings,
} from "Common/Types/Rum/SessionReplayFrustrationSignals";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import BuiltInSignalRow from "./BuiltInSignalRow";
import CustomSignalModal from "./CustomSignalModal";
import CustomSignalRow from "./CustomSignalRow";
import {
  ADD_SIGNAL_TEXT,
  BUILT_IN_CARD_DESCRIPTION,
  BUILT_IN_CARD_TITLE,
  BUILT_IN_SIGNAL_KEYS,
  BuiltInSignalKey,
  canAddCustomSignal,
  CHANGES_APPLY_COPY,
  CUSTOM_CARD_DESCRIPTION,
  CUSTOM_CARD_TITLE,
  FRUSTRATION_SIGNALS_TITLE,
  LOAD_FAILED_COPY,
  MOBILE_NOTE_COPY,
  NO_CUSTOM_SIGNALS_COPY,
  READ_ONLY_COPY,
  SelectorCheck,
  TOO_MANY_SIGNALS_COPY,
  withCustomSignal,
  withoutCustomSignal,
} from "./FrustrationSignalsCopy";
import useFrustrationSettings, {
  FrustrationSettingsState,
} from "./useFrustrationSettings";

/*
 * The Frustration Signals page of one RUM application (issue #6443): what
 * counts as frustration in its sessions.
 *
 *   - Built-in signals: rage, dead and error clicks and refresh rage, each
 *     with a switch that saves the moment it is flipped, the rule in one
 *     sentence from its own numbers, an example, and "Change the rule"
 *     folded away under it. The defaults are the rules every application
 *     always had.
 *   - Your own signals: up to twenty moments named by the application - a
 *     click on an element, a page, an event from its code or an error -
 *     each counting as frustration or only marking the moment.
 *
 * The recorders read the settings when a page loads, so a change applies
 * to sessions recorded from then on; the page says so once, at the top.
 * Someone who may not edit the application sees the same page with every
 * control locked and why.
 */

export interface ViewProps {
  state: FrustrationSettingsState;
  // A test seam: the browser's own reading of a selector.
  acceptsSelector?: SelectorCheck | undefined;
}

type DialogState =
  | { kind: "closed" }
  | { kind: "add" }
  | { kind: "edit"; signal: SessionReplayCustomSignal };

export const FrustrationSignalsView: FunctionComponent<ViewProps> = (
  props: ViewProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const state: FrustrationSettingsState = props.state;
  const settings: SessionReplayFrustrationSettings | null = state.settings;

  const [dialog, setDialog] = useState<DialogState>({ kind: "closed" });

  if (state.loadError && !settings) {
    return (
      <Card title={FRUSTRATION_SIGNALS_TITLE}>
        <div data-testid="frustration-signals-load-error">
          <ErrorMessage
            message={`${translator.translateText(LOAD_FAILED_COPY)} ${state.loadError}`}
            onRefreshClick={state.reload}
          />
        </div>
      </Card>
    );
  }

  /*
   * Said once the settings are in: the permission snapshot comes with the
   * read, so before it a reader who may edit would be told they may not.
   */
  const lockedLine: ReactElement | null =
    state.canEdit || !settings ? null : (
      <div
        className="mb-5 flex items-start gap-2 text-sm text-gray-500"
        data-testid="frustration-signals-read-only"
      >
        <Icon icon={IconProp.Lock} className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <span>
          {translator.translateText(state.editDisabledReason || READ_ONLY_COPY)}
        </span>
      </div>
    );

  const builtInCard: ReactElement = (
    <Card
      title={BUILT_IN_CARD_TITLE}
      description={
        <span className="block space-y-1">
          <span className="block">
            {translator.translateText(BUILT_IN_CARD_DESCRIPTION)}
          </span>
          <span className="block" data-testid="frustration-signals-applies">
            {translator.translateText(CHANGES_APPLY_COPY)}
          </span>
        </span>
      }
    >
      <div data-testid="frustration-signals-built-in">
        {lockedLine}
        {settings ? (
          <div className="divide-y divide-gray-200">
            {BUILT_IN_SIGNAL_KEYS.map((key: BuiltInSignalKey): ReactElement => {
              return (
                <BuiltInSignalRow
                  key={key}
                  signalKey={key}
                  settings={settings}
                  canEdit={state.canEdit}
                  isSaving={state.isSaving}
                  save={state.save}
                  acceptsSelector={props.acceptsSelector}
                />
              );
            })}
          </div>
        ) : (
          <ComponentLoader />
        )}
      </div>
    </Card>
  );

  const isAtCap: boolean = settings ? !canAddCustomSignal(settings) : false;

  const customSignals: Array<SessionReplayCustomSignal> =
    settings?.customSignals ?? [];

  const customCard: ReactElement = (
    <Card
      title={CUSTOM_CARD_TITLE}
      description={CUSTOM_CARD_DESCRIPTION}
      buttons={
        state.canEdit && settings
          ? [
              {
                title: ADD_SIGNAL_TEXT,
                icon: IconProp.Add,
                buttonStyle: ButtonStyleType.NORMAL,
                disabled: isAtCap || state.isSaving,
                tooltip: isAtCap ? TOO_MANY_SIGNALS_COPY : undefined,
                onClick: (): void => {
                  setDialog({ kind: "add" });
                },
              },
            ]
          : []
      }
    >
      <div data-testid="frustration-signals-custom">
        {!settings ? (
          <ComponentLoader />
        ) : customSignals.length === 0 ? (
          <p
            className="py-6 text-center text-sm text-gray-500"
            data-testid="frustration-signals-custom-empty"
          >
            {translator.translateText(NO_CUSTOM_SIGNALS_COPY)}
          </p>
        ) : (
          <ul className="divide-y divide-gray-200">
            {customSignals.map(
              (signal: SessionReplayCustomSignal): ReactElement => {
                return (
                  <CustomSignalRow
                    key={signal.id}
                    signal={signal}
                    canEdit={state.canEdit}
                    isSaving={state.isSaving}
                    onSwitch={(isEnabled: boolean): Promise<string | null> => {
                      return state.save(
                        withCustomSignal(settings, {
                          ...signal,
                          isEnabled: isEnabled,
                        }),
                      );
                    }}
                    onEdit={(): void => {
                      setDialog({ kind: "edit", signal: signal });
                    }}
                    onDelete={(): Promise<string | null> => {
                      return state.save(
                        withoutCustomSignal(settings, signal.id),
                      );
                    }}
                  />
                );
              },
            )}
          </ul>
        )}
        {settings && (
          <div
            className="mt-5 flex items-start gap-2 border-t border-gray-200 pt-4 text-sm text-gray-500"
            data-testid="frustration-signals-mobile-note"
          >
            <Icon
              icon={IconProp.DevicePhoneMobile}
              className="mt-0.5 h-4 w-4 flex-shrink-0"
            />
            <span>{translator.translateText(MOBILE_NOTE_COPY)}</span>
          </div>
        )}
      </div>
    </Card>
  );

  return (
    <Fragment>
      {builtInCard}
      {customCard}
      {settings && dialog.kind !== "closed" && (
        <CustomSignalModal
          signal={dialog.kind === "edit" ? dialog.signal : null}
          otherNames={customSignals
            .filter((signal: SessionReplayCustomSignal): boolean => {
              return dialog.kind !== "edit" || signal.id !== dialog.signal.id;
            })
            .map((signal: SessionReplayCustomSignal): string => {
              return signal.name;
            })}
          acceptsSelector={props.acceptsSelector}
          onSave={(
            signal: SessionReplayCustomSignal,
          ): Promise<string | null> => {
            return state.save(withCustomSignal(settings, signal));
          }}
          onClose={(): void => {
            setDialog({ kind: "closed" });
          }}
        />
      )}
    </Fragment>
  );
};

export interface ComponentProps {
  rumApplicationId: ObjectID;
}

const FrustrationSignalsSettings: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const state: FrustrationSettingsState = useFrustrationSettings(
    props.rumApplicationId,
  );

  return <FrustrationSignalsView state={state} />;
};

export default FrustrationSignalsSettings;
