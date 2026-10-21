import Exception from "Common/Types/Exception/Exception";
import IconProp from "Common/Types/Icon/IconProp";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import {
  TranslatableTerm,
  translatableTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { RecordForNewEpisode } from "Common/Utils/Episode/EpisodeFromRecords";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import { EpisodeMemberKindConfig } from "./EpisodeMemberKinds";
import {
  EpisodeRow,
  EpisodeRows,
  fetchEpisodeRows,
  fetchIsLimitedToOneEpisode,
  fetchRecordsForNewEpisode,
} from "./EpisodeMembersApi";
import EpisodePickerList, { EpisodePickerItem } from "./EpisodePickerList";
import { EPISODE_MEMBER_SEARCH_DEBOUNCE_MS } from "./AddEpisodeMembersModal";
import { NothingToAddToEpisodeNotice } from "./NothingToAddToEpisode";

/*
 * "Add to Existing Episode" on an alerts or incidents list: pick the one
 * episode the selected ones go into. Open episodes are listed first, newest
 * first, then the most recently resolved; typing searches every episode by
 * title or number. Each shows its number, state, severity and how many it
 * holds. Before adding, it says what will happen to the ones that are in an
 * episode already - left as they are when it is this one, kept there too
 * when it is another - and that adding does not reopen a resolved episode,
 * in a note right above the button that adds them.
 *
 * In a project that allows one in only one episode (EpisodeSingleMembership,
 * read when the dialog opens), the note says instead that those in another
 * episode are not added. When every selected one is in an episode already,
 * there is nothing to pick an episode for: the dialog says so, and why
 * (NothingToAddToEpisodeNotice), with only Close. Until it knows, the list
 * shows its skeleton, so it never flashes up first.
 *
 * Picking is all this does: the list's bulk action adds them, in one
 * request, and reports what happened to each.
 */

export interface ComponentProps {
  config: EpisodeMemberKindConfig;
  // What is being added, by id.
  recordIds: Array<string>;
  onClose: () => void;
  onPick: (episode: EpisodeRow) => void;
  /*
   * "Add to New Episode" instead, offered when there is no episode to add
   * to; left out when the person may not create one.
   */
  onCreateNewEpisodeInstead?: (() => void) | undefined;
}

interface RecordEpisodes {
  // Each selected record's latest episode, by the record's id.
  episodeIdByRecordId: Map<string, string>;
  // The selected records that were read, by id: none until they are.
  readRecordIds: Set<string>;
}

const AddToExistingEpisodeModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const config: EpisodeMemberKindConfig = props.config;
  const count: number = props.recordIds.length;

  const itemName: TranslatableTerm = translatableTerm(config.singularTitle, {
    inSentence: true,
  });
  const itemsName: TranslatableTerm = translatableTerm(config.pluralTitle, {
    inSentence: true,
  });
  const itemTitle: TranslatableTerm = translatableTerm(config.singularTitle);
  const itemsTitle: TranslatableTerm = translatableTerm(config.pluralTitle);

  const [searchText, setSearchText] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [episodes, setEpisodes] = useState<EpisodeRows>({
    open: [],
    resolved: [],
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [reloadToken, setReloadToken] = useState<number>(0);
  const [selectedId, setSelectedId] = useState<string>("");
  const [recordEpisodes, setRecordEpisodes] = useState<RecordEpisodes>({
    episodeIdByRecordId: new Map(),
    readRecordIds: new Set(),
  });
  /*
   * Whether the project allows one in only one episode
   * (EpisodeSingleMembership): false until read, as it is for every project
   * that has not turned it on.
   */
  const [isLimitedToOneEpisode, setIsLimitedToOneEpisode] =
    useState<boolean>(false);
  // Whether the switch, and then the selected ones, have been read.
  const [isSettingRead, setIsSettingRead] = useState<boolean>(false);
  const [areRecordsRead, setAreRecordsRead] = useState<boolean>(false);

  // Only the latest request may write the list.
  const requestIdRef: MutableRefObject<number> = useRef<number>(0);

  useEffect(() => {
    const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
      setDebouncedSearch(searchText);
    }, EPISODE_MEMBER_SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timeout);
    };
  }, [searchText]);

  // Which episode each selected one is in already, for the note below.
  useEffect(() => {
    let isCancelled: boolean = false;

    fetchRecordsForNewEpisode({ config: config, ids: props.recordIds })
      .then(
        (records: Array<RecordForNewEpisode & { otherEpisodeId?: string }>) => {
          if (isCancelled) {
            return;
          }

          const episodeIdByRecordId: Map<string, string> = new Map();
          const readRecordIds: Set<string> = new Set();

          for (const record of records) {
            readRecordIds.add(record.id);

            if (record.otherEpisodeId) {
              episodeIdByRecordId.set(record.id, record.otherEpisodeId);
            }
          }

          setRecordEpisodes({
            episodeIdByRecordId: episodeIdByRecordId,
            readRecordIds: readRecordIds,
          });
          setAreRecordsRead(true);
        },
      )
      .catch(() => {
        // Only the note is lost: the server says what happened anyway.
        if (!isCancelled) {
          setAreRecordsRead(true);
        }
      });

    // Never rejects: a project it cannot read allows several.
    fetchIsLimitedToOneEpisode({ config: config }).then(
      (isLimited: boolean) => {
        if (!isCancelled) {
          setIsLimitedToOneEpisode(isLimited);
          setIsSettingRead(true);
        }
      },
    );

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    const requestId: number = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setIsLoading(true);
    setError("");

    fetchEpisodeRows({ config: config, searchText: debouncedSearch })
      .then((rows: EpisodeRows) => {
        if (requestId !== requestIdRef.current) {
          return;
        }

        setEpisodes(rows);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (requestId !== requestIdRef.current) {
          return;
        }

        setError(API.getFriendlyMessage(err as Exception));
        setIsLoading(false);
      });

    return () => {
      requestIdRef.current += 1;
    };
  }, [debouncedSearch, reloadToken]);

  const allEpisodes: Array<EpisodeRow> = [
    ...episodes.open,
    ...episodes.resolved,
  ];

  const selectedEpisode: EpisodeRow | undefined = allEpisodes.find(
    (episode: EpisodeRow): boolean => {
      return episode.id === selectedId;
    },
  );

  const toItem: (episode: EpisodeRow) => EpisodePickerItem = (
    episode: EpisodeRow,
  ): EpisodePickerItem => {
    return {
      id: episode.id,
      number: episode.number,
      title: episode.title,
      isPrivate: episode.isPrivate,
      state: episode.state,
      severity: episode.severity,
      date: episode.date,
      meta:
        typeof episode.memberCount === "number"
          ? translator.translatePlural(
              {
                one: "{{count}} {{itemName}}",
                other: "{{count}} {{itemsName}}",
              },
              episode.memberCount,
              { itemName, itemsName },
            )
          : undefined,
    };
  };

  /*
   * What adding to the picked episode will do to the selected ones that are
   * in an episode already: left as they are when it is this one, kept in
   * the other one too when it is not.
   */
  const getPickNotes: () => Array<ReactElement> = (): Array<ReactElement> => {
    const notes: Array<ReactElement> = [];

    if (!selectedEpisode) {
      return notes;
    }

    let inThisEpisode: number = 0;
    let inAnotherEpisode: number = 0;

    for (const recordId of props.recordIds) {
      const episodeId: string | undefined =
        recordEpisodes.episodeIdByRecordId.get(recordId.toLowerCase());

      if (!episodeId) {
        continue;
      }

      if (episodeId === selectedEpisode.id) {
        inThisEpisode++;
      } else {
        inAnotherEpisode++;
      }
    }

    if (inThisEpisode > 0) {
      notes.push(
        <p key="in-this" data-testid="add-to-existing-episode-in-this">
          {translator.translatePlural(
            {
              one: "{{count}} of them is in this episode already and is left as it is.",
              other:
                "{{count}} of them are in this episode already and are left as they are.",
            },
            inThisEpisode,
          )}
        </p>,
      );
    }

    if (inAnotherEpisode > 0) {
      notes.push(
        <p key="in-another" data-testid="add-to-existing-episode-in-another">
          {isLimitedToOneEpisode
            ? translator.translatePlural(
                config.singleMembershipCopy.pickNoteInAnotherEpisode,
                inAnotherEpisode,
              )
            : translator.translatePlural(
                {
                  one: "{{count}} of them is already in another episode. It stays there too: {{itemsName}} can be in more than one episode.",
                  other:
                    "{{count}} of them are already in another episode. They stay there too: {{itemsName}} can be in more than one episode.",
                },
                inAnotherEpisode,
                { itemsName },
              )}
        </p>,
      );
    }

    if (selectedEpisode.isResolved) {
      notes.push(
        <p key="resolved" data-testid="add-to-existing-episode-resolved">
          {translator.translateText(
            "This episode is resolved. Adding to it does not reopen it.",
          )}
        </p>,
      );
    }

    return notes;
  };

  const pickNotes: Array<ReactElement> = getPickNotes();

  /*
   * No episode at all: the way forward is a new one, with what is selected
   * in it - offered only to whoever may create one.
   */
  const emptyState: ReactElement = (
    <div className="text-center">
      <div className="text-sm font-medium text-gray-900">
        {translator.translateText("No episodes yet")}
      </div>
      {props.onCreateNewEpisodeInstead && (
        <>
          <div className="mt-1 text-xs leading-5 text-gray-500">
            {translator.translateText("Start one with your selection.")}
          </div>
          <div className="mt-3 flex justify-center">
            <Button
              dataTestId="add-to-existing-episode-create-instead"
              title="Add to New Episode"
              icon={IconProp.PlusCircle}
              buttonStyle={ButtonStyleType.NORMAL}
              onClick={() => {
                props.onCreateNewEpisodeInstead?.();
              }}
            />
          </div>
        </>
      )}
    </div>
  );

  const title: string = translator.translatePlural(
    {
      one: "Add {{count}} {{itemName}} to an Episode",
      other: "Add {{count}} {{itemsName}} to an Episode",
    },
    count,
    { itemName: itemTitle, itemsName: itemsTitle },
  );

  /*
   * Allowed in only one episode, and every selected one is in an episode
   * already - each one read, so nothing is assumed: no episode could take
   * any of them.
   */
  const isEverySelectedOneInAnEpisode: boolean =
    isLimitedToOneEpisode &&
    count > 0 &&
    props.recordIds.every((recordId: string): boolean => {
      const id: string = recordId.toLowerCase();

      return (
        recordEpisodes.readRecordIds.has(id) &&
        recordEpisodes.episodeIdByRecordId.has(id)
      );
    });

  /*
   * Still finding out whether there is anything to add: the switch, and -
   * when it is on - which episodes the selected ones are in.
   */
  const isChecking: boolean =
    !isSettingRead || (isLimitedToOneEpisode && !areRecordsRead);

  if (isEverySelectedOneInAnEpisode) {
    // The same dialog, with nothing to pick: why, and Close.
    return (
      <Modal
        title={title}
        modalWidth={ModalWidth.Medium}
        onClose={props.onClose}
        closeButtonText="Close"
      >
        <NothingToAddToEpisodeNotice
          config={config}
          count={count}
          dataTestId="add-to-existing-episode-nothing-to-add"
        />
      </Modal>
    );
  }

  return (
    <Modal
      title={title}
      description={translator.translateTemplate(
        "Pick the episode to add the selected {{itemsName}} to.",
        { itemsName },
      )}
      modalWidth={ModalWidth.Medium}
      onClose={props.onClose}
      submitButtonText="Add to Episode"
      disableSubmitButton={!selectedEpisode}
      onSubmit={() => {
        if (selectedEpisode) {
          props.onPick(selectedEpisode);
        }
      }}
    >
      <div data-testid="add-to-existing-episode">
        <EpisodePickerList
          testId="add-to-existing-episode-list"
          selectionMode="single"
          sections={[
            {
              key: "open",
              // "Ongoing", not "Open": the adjective, never the verb.
              title: translator.translateText("Ongoing"),
              items: episodes.open.map(toItem),
            },
            {
              key: "resolved",
              title: translator.translateText("Recently Resolved"),
              items: episodes.resolved.map(toItem),
            },
          ]}
          selectedIds={selectedId ? [selectedId] : []}
          onToggle={(id: string) => {
            setSelectedId(id);
          }}
          searchText={searchText}
          onSearchTextChange={setSearchText}
          searchPlaceholder={translator.translateTemplate(
            "Search episodes by title or number",
          )}
          isLoading={isLoading || isChecking}
          error={error}
          onRetry={() => {
            setReloadToken((token: number): number => {
              return token + 1;
            });
          }}
          emptyState={emptyState}
          noMatchText={translator.translateTemplate(
            'No episodes match "{{search}}".',
            { search: debouncedSearch.trim() },
          )}
          footer={
            pickNotes.length > 0 ? (
              // What adding to the one picked will do: read before adding.
              <div
                data-testid="add-to-existing-episode-notes"
                className="flex items-start gap-2 rounded-md bg-gray-50 px-3 py-2 text-gray-600"
              >
                <Icon
                  icon={IconProp.Info}
                  className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
                />
                <div className="min-w-0 space-y-1">{pickNotes}</div>
              </div>
            ) : undefined
          }
        />
      </div>
    </Modal>
  );
};

export default AddToExistingEpisodeModal;
