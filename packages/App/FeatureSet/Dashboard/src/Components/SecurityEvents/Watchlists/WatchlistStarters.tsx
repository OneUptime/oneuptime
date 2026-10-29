import {
  STARTERS_DESCRIPTION,
  STARTERS_TITLE,
  STARTER_ADD,
  STARTER_ADDED,
  WATCHLISTS_TEST_IDS,
} from "./WatchlistsCopy";
import {
  WATCHLIST_STARTERS,
  WatchlistStarter,
  getAvailableWatchlistStarters,
  getWatchlistHoldsLabel,
} from "./WatchlistsModel";
import SecurityWatchlist from "Common/Models/DatabaseModels/SecurityWatchlist";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { SecurityWatchlistSource } from "Common/Types/SecurityEvent/SecurityWatchlist";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

// A starter as the list it creates: empty, kept by hand, described in the reader's words.
export function buildWatchlistFromStarter(data: {
  starter: WatchlistStarter;
  projectId: ObjectID;
  translator: Translator;
}): SecurityWatchlist {
  const watchlist: SecurityWatchlist = new SecurityWatchlist();
  watchlist.projectId = data.projectId;
  watchlist.name = data.starter.name;
  watchlist.entityType = data.starter.entityType;
  watchlist.source = SecurityWatchlistSource.Values;
  watchlist.description =
    data.translator.translateText(data.starter.description) ||
    data.starter.description;
  return watchlist;
}

/*
 * The tiles sit two to a row once their card is wide enough for two to
 * read on a line each - the title, what rules call the list, what it is
 * for - and one to a row below that: beside the side menu at 768 the card
 * is about 430px wide, where two tiles squeezed every line onto two. Four
 * in a row at 1280 did the same (about 210px a tile), so the card's own
 * width decides, not the screen's.
 */
export const WATCHLIST_STARTERS_CLASS_NAME: string =
  "space-y-4 [container-type:inline-size]";
export const WATCHLIST_STARTER_GRID_CLASS_NAME: string =
  "grid grid-cols-1 gap-4 [@container(min-width:36rem)]:grid-cols-2";

export interface ComponentProps {
  projectId: ObjectID;
  /*
   * Changes whenever the lists table changes - a list created or deleted
   * there - so the tiles read which starters the project has again.
   */
  refreshToggle?: string | undefined;
  onAdded: () => void;
}

/*
 * The lists most teams keep, one click each - VIP users, critical hosts,
 * known-bad file hashes, allowed admin addresses - as Threat Intel offers
 * its free lists: each tile says what the list is for and what rules call
 * it, and adding one creates it empty, kept by hand, for its values. A
 * starter the project has already (by name) is not offered; one added here
 * a moment ago says Added rather than vanishing under the click. The card
 * shows once the project's lists are read, and only while a starter is left.
 */
const WatchlistStarters: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  // The names of the project's lists, once read; null while they are read.
  const [existingNames, setExistingNames] = useState<Array<string> | null>(
    null,
  );
  const [addedHere, setAddedHere] = useState<Array<string>>([]);
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [error, setError] = useState<string>("");

  const createGate: PermissionGateResult = PermissionGate.check(
    new SecurityWatchlist(),
    ModelAction.Create,
  );

  useEffect(() => {
    let isCurrent: boolean = true;

    const read: () => Promise<void> = async (): Promise<void> => {
      try {
        const result: ListResult<SecurityWatchlist> =
          await ModelAPI.getList<SecurityWatchlist>({
            modelType: SecurityWatchlist,
            query: { projectId: props.projectId },
            select: { _id: true, name: true },
            sort: {},
            skip: 0,
            limit: LIMIT_PER_PROJECT,
          });

        if (isCurrent) {
          setExistingNames(
            result.data.map((watchlist: SecurityWatchlist): string => {
              return watchlist.name || "";
            }),
          );
        }
      } catch {
        // The lists could not be read: offer nothing rather than a list it may have.
        if (isCurrent) {
          setExistingNames(
            WATCHLIST_STARTERS.map((starter: WatchlistStarter): string => {
              return starter.name;
            }),
          );
        }
      }
    };

    void read();

    return () => {
      isCurrent = false;
    };
  }, [props.projectId.toString(), props.refreshToggle]);

  if (existingNames === null) {
    return <></>;
  }

  const available: Array<WatchlistStarter> =
    getAvailableWatchlistStarters(existingNames);

  // The starters to draw: those still to add, and those added from here.
  const shown: Array<WatchlistStarter> = WATCHLIST_STARTERS.filter(
    (starter: WatchlistStarter): boolean => {
      return available.includes(starter) || addedHere.includes(starter.key);
    },
  );

  if (
    shown.length === 0 ||
    (available.length === 0 && addedHere.length === 0)
  ) {
    return <></>;
  }

  const add: (starter: WatchlistStarter) => Promise<void> = async (
    starter: WatchlistStarter,
  ): Promise<void> => {
    setError("");
    setAddingKey(starter.key);

    try {
      await ModelAPI.create<SecurityWatchlist>({
        model: buildWatchlistFromStarter({
          starter,
          projectId: props.projectId,
          translator,
        }),
        modelType: SecurityWatchlist,
      });

      setAddedHere((current: Array<string>): Array<string> => {
        return [...current, starter.key];
      });
      props.onAdded();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setAddingKey(null);
  };

  return (
    <Card title={STARTERS_TITLE} description={STARTERS_DESCRIPTION}>
      <div
        className={WATCHLIST_STARTERS_CLASS_NAME}
        data-testid={WATCHLISTS_TEST_IDS.starters}
      >
        {/*
         * Why an Add failed, as an alert over the tiles - not the quiet
         * centred line of an empty list - closed with its x or by the next
         * Add; the tile stays to try again.
         */}
        {error ? (
          <Alert
            type={AlertType.DANGER}
            title={error}
            dataTestId={WATCHLISTS_TEST_IDS.startersError}
            onClose={() => {
              setError("");
            }}
          />
        ) : (
          <></>
        )}

        <ul className={WATCHLIST_STARTER_GRID_CLASS_NAME}>
          {shown.map((starter: WatchlistStarter): ReactElement => {
            const isAdded: boolean = addedHere.includes(starter.key);

            return (
              <li
                key={starter.key}
                className="flex min-w-0 flex-col rounded-lg border border-gray-200 bg-white p-4"
                data-testid={`${WATCHLISTS_TEST_IDS.starter}-${starter.key}`}
              >
                <div className="flex min-w-0 items-start gap-2.5">
                  <div
                    aria-hidden="true"
                    className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-500"
                  >
                    <Icon icon={starter.icon} className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900">
                      {translator.translateText(starter.title)}
                    </p>
                    {/* What rules call it, as written, and what it holds. */}
                    <p className="text-xs text-gray-500">
                      <bdi dir="ltr" className="font-mono">
                        {starter.name}
                      </bdi>
                      {" · "}
                      {getWatchlistHoldsLabel(translator, starter.entityType)}
                    </p>
                  </div>
                </div>
                <p className="mt-2 flex-1 text-sm text-gray-600">
                  {translator.translateText(starter.description)}
                </p>
                <div className="mt-4 flex min-h-[2rem] flex-wrap items-center justify-end gap-2">
                  {isAdded ? (
                    <div
                      className="mr-auto inline-flex items-center gap-1 text-sm font-medium text-emerald-700"
                      data-testid={`${WATCHLISTS_TEST_IDS.starter}-added-${starter.key}`}
                    >
                      <Icon icon={IconProp.Check} className="h-4 w-4" />
                      {translator.translateText(STARTER_ADDED)}
                    </div>
                  ) : (
                    <Button
                      title={STARTER_ADD}
                      icon={IconProp.Add}
                      buttonStyle={ButtonStyleType.NORMAL}
                      buttonSize={ButtonSize.Small}
                      isLoading={addingKey === starter.key}
                      disabled={!createGate.isAllowed || addingKey !== null}
                      tooltip={
                        createGate.isAllowed
                          ? undefined
                          : createGate.disabledReason
                      }
                      dataTestId={`${WATCHLISTS_TEST_IDS.starter}-add-${starter.key}`}
                      onClick={() => {
                        void add(starter);
                      }}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
};

export default WatchlistStarters;
