import Exception from "Common/Types/Exception/Exception";
import IconProp from "Common/Types/Icon/IconProp";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
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
  fetchRecordsForNewEpisode,
} from "./EpisodeMembersApi";
import EpisodePickerList, { EpisodePickerItem } from "./EpisodePickerList";
import { EPISODE_MEMBER_SEARCH_DEBOUNCE_MS } from "./AddEpisodeMembersModal";

/*
 * "Add to Existing Episode" on an alerts or incidents list: pick the one
 * episode the selected ones go into. Open episodes are listed first, newest
 * first, then the most recently resolved; typing searches every episode by
 * title or number. Each shows its number, state, severity and how many it
 * holds. Before adding, it says what will happen to the ones that are in an
 * episode already - left as they are when it is this one, kept there too
 * when it is another - and that adding does not reopen a resolved episode.
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
  });

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

          for (const record of records) {
            if (record.otherEpisodeId) {
              episodeIdByRecordId.set(record.id, record.otherEpisodeId);
            }
          }

          setRecordEpisodes({ episodeIdByRecordId: episodeIdByRecordId });
        },
      )
      .catch(() => {
        // Only the note is lost: the server says what happened anyway.
      });

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
          {translator.translatePlural(
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

  const emptyState: ReactElement = (
    <div className="text-center">
      <div className="text-sm font-medium text-gray-900">
        {translator.translateText("No episodes yet")}
      </div>
      <div className="mt-1 text-xs leading-5 text-gray-500">
        {translator.translateTemplate(
          "There is no episode to add the {{itemsName}} to yet.",
          { itemsName },
        )}
      </div>
      {props.onCreateNewEpisodeInstead && (
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
      )}
    </div>
  );

  return (
    <Modal
      title={translator.translatePlural(
        {
          one: "Add {{count}} {{itemName}} to an Episode",
          other: "Add {{count}} {{itemsName}} to an Episode",
        },
        count,
        { itemName: itemTitle, itemsName: itemsTitle },
      )}
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
          isLoading={isLoading}
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
              <div
                data-testid="add-to-existing-episode-notes"
                className="space-y-1"
              >
                {pickNotes}
              </div>
            ) : undefined
          }
        />
      </div>
    </Modal>
  );
};

export default AddToExistingEpisodeModal;
