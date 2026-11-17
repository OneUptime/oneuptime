import InlineSeparator from "Common/UI/Components/InlineSeparator/InlineSeparator";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import AdminModelAPI from "../../../Utils/ModelAPI";
import { createMasterApiKey, fetchMasterApiKeyState } from "./MasterApiKeyApi";
import {
  getMasterApiKeySwitchDescription,
  MASTER_API_KEY_CARD_TEST_ID,
  MASTER_API_KEY_FACTS_TEST_ID,
  MASTER_API_KEY_SHOWN_ONCE_TEST_ID,
  MASTER_API_KEY_STATE_TEST_ID,
  MASTER_API_KEY_SWITCH_TEST_ID,
  MASTER_API_KEY_VALUE_TEST_ID,
  MasterApiKeyCopy,
} from "./MasterApiKeyCopy";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import {
  CreatedMasterApiKey,
  MasterApiKeyState,
} from "Common/Types/MasterApiKey/MasterApiKeyAnswer";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelSwitchRow from "Common/UI/Components/ModelSwitch/ModelSwitchRow";
import ShownOnceSecretModal from "Common/UI/Components/ShownOnceSecret/ShownOnceSecretModal";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * ADMIN DASHBOARD > SETTINGS > API KEY: THE SERVER'S MASTER API KEY (#7901).
 *
 * The key has root access to every project on the server, and it is stored
 * as its hash, so nothing can show it again - not this page, not the API,
 * not a master admin. The card says whether there is one, and:
 *
 *   - with none, offers Create Key;
 *   - with one, says which key it is (#8903) - when it was made, by whom,
 *     how it ends: "Made by Ada Lovelace on Nov 16, 2026 · Ends in 2b34",
 *     the date in the reader's language and time zone, and what is not
 *     known left out - so an admin can match the key they hold against
 *     it; says it was shown once and cannot be shown again, offers Reset
 *     Key - which asks first, since every script that uses the key stops
 *     working - and the Enabled switch, which saves when it is flipped
 *     (the shared ModelSwitchRow, through AdminModelAPI).
 *
 * A key made here is turned on, and shown once, in a dialog whose only way
 * out is Done, so a reflex Escape or a click beside it cannot lose it. Once
 * the dialog is closed the page keeps the key nowhere.
 */

/*
 * Which key is set, as facts the card lists apart with " · ": when it was
 * made and by whom, and how it ends. None for a key nothing is known of.
 */
export const getMasterApiKeyFacts: (
  state: MasterApiKeyState,
  translator: Translator,
) => Array<string> = (
  state: MasterApiKeyState,
  translator: Translator,
): Array<string> => {
  if (!state.isSet) {
    return [];
  }

  const facts: Array<string> = [];

  if (state.createdAt) {
    const date: string =
      OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        state.createdAt,
        true,
      );

    facts.push(
      state.createdByName
        ? translator.translateTemplate(MasterApiKeyCopy.madeByOn, {
            name: state.createdByName,
            date: date,
          })
        : translator.translateTemplate(MasterApiKeyCopy.madeOn, {
            date: date,
          }),
    );
  }

  if (state.hint) {
    facts.push(
      translator.translateTemplate(MasterApiKeyCopy.endsIn, {
        hint: state.hint,
      }),
    );
  }

  return facts;
};

const MasterApiKeyCard: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [state, setState] = useState<MasterApiKeyState | null>(null);
  const [loadError, setLoadError] = useState<string>("");
  const [isMakingKey, setIsMakingKey] = useState<boolean>(false);
  const [makeError, setMakeError] = useState<string>("");
  const [isResetAsked, setIsResetAsked] = useState<boolean>(false);
  // The key just made: shown in its dialog, and forgotten when it closes.
  const [shownKey, setShownKey] = useState<string | null>(null);
  // How many keys were made here: the switch is drawn again for each.
  const [keysMade, setKeysMade] = useState<number>(0);

  const load: () => Promise<void> = async (): Promise<void> => {
    setLoadError("");

    try {
      setState(await fetchMasterApiKeyState());
    } catch (err) {
      setLoadError(API.getFriendlyMessage(err));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const makeKey: () => Promise<void> = async (): Promise<void> => {
    setIsMakingKey(true);
    setMakeError("");

    try {
      const created: CreatedMasterApiKey = await createMasterApiKey();

      setState({
        isSet: created.isSet,
        isEnabled: created.isEnabled,
        createdAt: created.createdAt,
        createdByName: created.createdByName,
        hint: created.hint,
      });
      setKeysMade((made: number): number => {
        return made + 1;
      });
      setIsResetAsked(false);
      setShownKey(created.masterApiKey);
    } catch (err) {
      setMakeError(API.getFriendlyMessage(err));
    }

    setIsMakingKey(false);
  };

  const getButtons: () => Array<CardButtonSchema> =
    (): Array<CardButtonSchema> => {
      if (!state) {
        return [];
      }

      if (!state.isSet) {
        return [
          {
            title: MasterApiKeyCopy.createButton,
            buttonStyle: ButtonStyleType.PRIMARY,
            icon: IconProp.Add,
            isLoading: isMakingKey,
            disabled: isMakingKey,
            onClick: () => {
              void makeKey();
            },
          },
        ];
      }

      return [
        {
          title: MasterApiKeyCopy.resetButton,
          buttonStyle: ButtonStyleType.NORMAL,
          icon: IconProp.Refresh,
          disabled: isMakingKey,
          onClick: () => {
            setMakeError("");
            setIsResetAsked(true);
          },
        },
      ];
    };

  const getBody: () => ReactElement = (): ReactElement => {
    if (loadError) {
      return (
        <ErrorMessage
          message={loadError}
          onRefreshClick={() => {
            void load();
          }}
        />
      );
    }

    if (!state) {
      return <DetailListSkeleton fields={3} columns={1} />;
    }

    const facts: Array<string> = getMasterApiKeyFacts(state, translator);

    return (
      <div className="space-y-4">
        {/* Which key: what an admin matches the key they hold against. */}
        {facts.length > 0 ? (
          <p
            className="text-sm font-medium text-gray-900"
            data-testid={MASTER_API_KEY_FACTS_TEST_ID}
          >
            {facts.map((fact: string, index: number): ReactElement => {
              return (
                <React.Fragment key={index}>
                  {index > 0 ? (
                    <span className="text-gray-400" aria-hidden="true">
                      <InlineSeparator />
                    </span>
                  ) : (
                    <></>
                  )}
                  <span>{fact}</span>
                </React.Fragment>
              );
            })}
          </p>
        ) : (
          <></>
        )}

        <p
          className="text-sm text-gray-600"
          data-testid={MASTER_API_KEY_STATE_TEST_ID}
          data-is-set={state.isSet ? "true" : "false"}
        >
          {translator.translateText(
            state.isSet ? MasterApiKeyCopy.keySet : MasterApiKeyCopy.noKey,
          )}
        </p>

        {/* A failed Create Key: Reset Key's dialog says its own. */}
        {makeError && !isResetAsked ? (
          <ErrorMessage message={makeError} />
        ) : (
          <></>
        )}

        {/*
         * Drawn again for each key made here, which the server turned on,
         * so the switch shows it on.
         */}
        {state.isSet ? (
          <div className="border-t border-gray-200 pt-4">
            <ModelSwitchRow<GlobalConfig>
              key={keysMade}
              modelType={GlobalConfig}
              modelId={ObjectID.getZeroObjectID()}
              column="isMasterApiKeyEnabled"
              initialValue={state.isEnabled}
              title={MasterApiKeyCopy.switchTitle}
              getDescription={getMasterApiKeySwitchDescription}
              modelAPI={AdminModelAPI}
              onSaved={(isOn: boolean) => {
                setState((current: MasterApiKeyState | null) => {
                  return current
                    ? { ...current, isSet: true, isEnabled: isOn }
                    : current;
                });
              }}
              dataTestId={MASTER_API_KEY_SWITCH_TEST_ID}
            />
          </div>
        ) : (
          <></>
        )}
      </div>
    );
  };

  return (
    <div data-testid={MASTER_API_KEY_CARD_TEST_ID}>
      <Card
        title={MasterApiKeyCopy.cardTitle}
        description={MasterApiKeyCopy.cardDescription}
        buttons={getButtons()}
      >
        {getBody()}
      </Card>

      {isResetAsked ? (
        <ConfirmModal
          title={MasterApiKeyCopy.resetConfirmation.title}
          description={MasterApiKeyCopy.resetConfirmation.description}
          submitButtonText={MasterApiKeyCopy.resetConfirmation.submitButtonText}
          submitButtonType={MasterApiKeyCopy.resetConfirmation.submitButtonType}
          isLoading={isMakingKey}
          error={makeError || undefined}
          onSubmit={() => {
            void makeKey();
          }}
          onClose={() => {
            setIsResetAsked(false);
            setMakeError("");
          }}
        />
      ) : (
        <></>
      )}

      {/*
       * SHOWN ONCE. The key is stored as its hash, so this is the one time
       * anyone sees it: Done is the only way out - no Escape, no X, no click
       * beside it - and the focus starts on the dialog, not on Done, so a
       * reflex Enter does not close it either (ShownOnceSecretModal).
       */}
      {shownKey ? (
        <ShownOnceSecretModal
          title={MasterApiKeyCopy.shownOnceTitle}
          description={MasterApiKeyCopy.shownOnceDescription}
          doneButtonText={MasterApiKeyCopy.done}
          secret={shownKey}
          onDone={() => {
            setShownKey(null);
          }}
          dataTestId={MASTER_API_KEY_SHOWN_ONCE_TEST_ID}
          valueTestId={MASTER_API_KEY_VALUE_TEST_ID}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default MasterApiKeyCard;
