import Exception from "Common/Types/Exception/Exception";
import {
  EpisodeMemberNotAdded,
  EpisodeMembersAddResult,
  MAX_EPISODE_MEMBERS_PER_ADD,
} from "Common/Types/Episode/EpisodeMembersAdd";
import ObjectID from "Common/Types/ObjectID";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import {
  TranslatableTerm,
  translatableTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
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
  EPISODE_MEMBER_PICKER_LIMIT,
  EpisodeLabel,
  EpisodeRecordRow,
  addToEpisode,
  fetchEpisodeLabels,
  fetchEpisodeMemberIds,
  fetchRecordRows,
} from "./EpisodeMembersApi";
import EpisodePickerList, { EpisodePickerItem } from "./EpisodePickerList";

/*
 * An episode's "Add Alerts" (or "Add Incidents"): several at once, picked
 * from a list that searches every one the person can see - by title or by
 * number - shows each with its number, state and severity, leaves out the
 * ones already in this episode, and says when one is in another episode
 * (it stays there too: one can be in several). Adding is one request
 * (EpisodeMembersAdd). Everything added, the dialog closes; anything that
 * could not be added stays listed in it, with why.
 */

// How long typing has to pause before the list is searched.
export const EPISODE_MEMBER_SEARCH_DEBOUNCE_MS: number = 250;

export interface ComponentProps {
  config: EpisodeMemberKindConfig;
  episodeId: ObjectID;
  onClose: () => void;
  // Something was added: the page refreshes what it shows of the episode.
  onAdded: (result: EpisodeMembersAddResult) => void;
}

const AddEpisodeMembersModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const config: EpisodeMemberKindConfig = props.config;
  const episodeIdString: string = props.episodeId.toString().toLowerCase();

  const itemName: TranslatableTerm = translatableTerm(config.singular, {
    inSentence: true,
  });
  const itemsName: TranslatableTerm = translatableTerm(config.plural, {
    inSentence: true,
  });
  const itemTitle: TranslatableTerm = translatableTerm(config.singularTitle);
  const itemsTitle: TranslatableTerm = translatableTerm(config.pluralTitle);

  // What the episode holds already: null until read.
  const [memberIds, setMemberIds] = useState<Array<string> | null>(null);
  const [searchText, setSearchText] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [rows, setRows] = useState<Array<EpisodeRecordRow>>([]);
  const [episodeLabels, setEpisodeLabels] = useState<
    Map<string, EpisodeLabel>
  >(new Map());
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>("");
  const [reloadToken, setReloadToken] = useState<number>(0);

  // What is picked, in the order it was picked, and each row as it was seen.
  const [selectedIds, setSelectedIds] = useState<Array<string>>([]);
  const [selectedRows, setSelectedRows] = useState<
    Map<string, EpisodeRecordRow>
  >(new Map());

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string>("");
  // What the last add could not add, and why.
  const [notAdded, setNotAdded] = useState<Array<EpisodeMemberNotAdded>>([]);

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

  useEffect(() => {
    let isCancelled: boolean = false;

    fetchEpisodeMemberIds({ config: config, episodeId: props.episodeId })
      .then((ids: Array<string>) => {
        if (!isCancelled) {
          setMemberIds(ids);
        }
      })
      .catch((err: unknown) => {
        if (!isCancelled) {
          setLoadError(API.getFriendlyMessage(err as Exception));
          setIsLoading(false);
        }
      });

    return () => {
      isCancelled = true;
      requestIdRef.current += 1;
    };
  }, [episodeIdString, reloadToken]);

  useEffect(() => {
    if (memberIds === null) {
      return;
    }

    const requestId: number = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setIsLoading(true);
    setLoadError("");

    const load: () => Promise<void> = async (): Promise<void> => {
      const loadedRows: Array<EpisodeRecordRow> = await fetchRecordRows({
        config: config,
        searchText: debouncedSearch,
        excludedIds: memberIds,
      });

      // An episode with more members than one read holds: still left out.
      const visibleRows: Array<EpisodeRecordRow> = loadedRows.filter(
        (row: EpisodeRecordRow): boolean => {
          return !memberIds.includes(row.id);
        },
      );

      const otherEpisodeIds: Array<string> = visibleRows
        .map((row: EpisodeRecordRow): string => {
          return row.otherEpisodeId || "";
        })
        .filter((id: string): boolean => {
          return Boolean(id) && id !== episodeIdString;
        });

      let labels: Map<string, EpisodeLabel> = new Map();

      try {
        labels = await fetchEpisodeLabels({
          config: config,
          episodeIds: otherEpisodeIds,
        });
      } catch {
        // The notes then say "another episode" without naming it.
      }

      if (requestId !== requestIdRef.current) {
        return;
      }

      setRows(visibleRows);
      setEpisodeLabels(labels);
      setIsLoading(false);
    };

    load().catch((err: unknown) => {
      if (requestId !== requestIdRef.current) {
        return;
      }

      setLoadError(API.getFriendlyMessage(err as Exception));
      setIsLoading(false);
    });
  }, [memberIds, debouncedSearch]);

  const retry: () => void = (): void => {
    setLoadError("");
    setIsLoading(true);

    if (memberIds === null) {
      setReloadToken((token: number): number => {
        return token + 1;
      });
      return;
    }

    // A new array, so the list is read again.
    setMemberIds([...memberIds]);
  };

  const isAtLimit: boolean = selectedIds.length >= MAX_EPISODE_MEMBERS_PER_ADD;

  const toggle: (id: string) => void = (id: string): void => {
    setSubmitError("");

    if (selectedIds.includes(id)) {
      setSelectedIds(
        selectedIds.filter((selectedId: string): boolean => {
          return selectedId !== id;
        }),
      );
      return;
    }

    if (isAtLimit) {
      return;
    }

    const row: EpisodeRecordRow | undefined = rows.find(
      (candidate: EpisodeRecordRow): boolean => {
        return candidate.id === id;
      },
    );

    setSelectedIds([...selectedIds, id]);

    if (row) {
      const nextRows: Map<string, EpisodeRecordRow> = new Map(selectedRows);
      nextRows.set(id, row);
      setSelectedRows(nextRows);
    }
  };

  // Is in another episode, and so stays there too.
  const isInAnotherEpisode: (row: EpisodeRecordRow) => boolean = (
    row: EpisodeRecordRow,
  ): boolean => {
    return Boolean(row.otherEpisodeId) && row.otherEpisodeId !== episodeIdString;
  };

  const toItem: (row: EpisodeRecordRow) => EpisodePickerItem = (
    row: EpisodeRecordRow,
  ): EpisodePickerItem => {
    const item: EpisodePickerItem = {
      id: row.id,
      number: row.number,
      title: row.title,
      isPrivate: row.isPrivate,
      state: row.state,
      severity: row.severity,
      date: row.date,
    };

    if (isInAnotherEpisode(row)) {
      const label: EpisodeLabel | undefined = episodeLabels.get(
        row.otherEpisodeId || "",
      );

      if (label?.number) {
        item.note = translator.translateTemplate("In episode {{number}}", {
          number: label.number,
        });
        item.noteTooltip = translator.translateTemplate(
          "Adding it here keeps it in episode {{number}} too.",
          { number: label.number },
        );
      } else {
        item.note = translator.translateText("In another episode");
        item.noteTooltip = translator.translateText(
          "Adding it here keeps it in that episode too.",
        );
      }
    }

    return item;
  };

  const selectedInAnotherEpisode: boolean = selectedIds.some(
    (id: string): boolean => {
      const row: EpisodeRecordRow | undefined = selectedRows.get(id);
      return Boolean(row && isInAnotherEpisode(row));
    },
  );

  const submit: () => Promise<void> = async (): Promise<void> => {
    if (selectedIds.length === 0 || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError("");
    setNotAdded([]);

    try {
      const result: EpisodeMembersAddResult = await addToEpisode({
        config: config,
        episodeId: episodeIdString,
        ids: selectedIds,
      });

      if (result.added.length > 0 || result.alreadyInEpisode.length > 0) {
        props.onAdded(result);
      }

      if (result.notAdded.length === 0) {
        props.onClose();
        return;
      }

      // What is in the episode now leaves the list; the rest stays picked.
      const nowMembers: Array<string> = [
        ...result.added,
        ...result.alreadyInEpisode,
      ];

      setSelectedIds(
        selectedIds.filter((id: string): boolean => {
          return !nowMembers.includes(id.toLowerCase());
        }),
      );
      setNotAdded(result.notAdded);
      setMemberIds([...(memberIds || []), ...nowMembers]);
    } catch (err) {
      setSubmitError(API.getFriendlyMessage(err as Exception));
    } finally {
      setIsSubmitting(false);
    }
  };

  // The name a row is listed under in the "not added" box.
  const getName: (id: string) => string = (id: string): string => {
    const row: EpisodeRecordRow | undefined =
      selectedRows.get(id) ||
      rows.find((candidate: EpisodeRecordRow): boolean => {
        return candidate.id === id;
      });

    if (!row) {
      return id;
    }

    if (row.number && row.title && !row.isPrivate) {
      return `${row.number}: ${row.title}`;
    }

    return row.number || row.title || id;
  };

  const hasSearch: boolean = debouncedSearch.trim().length > 0;

  const getFooter: () => ReactElement | undefined = ():
    | ReactElement
    | undefined => {
    const lines: Array<ReactElement> = [];

    if (rows.length >= EPISODE_MEMBER_PICKER_LIMIT) {
      lines.push(
        <p key="limit" data-testid="add-episode-members-shown">
          {hasSearch
            ? translator.translatePlural(
                {
                  one: "Showing the first {{count}} match. Type more to narrow it down.",
                  other:
                    "Showing the first {{count}} matches. Type more to narrow them down.",
                },
                rows.length,
              )
            : translator.translatePlural(
                {
                  one: "Showing the most recent {{itemName}} that is not in this episode. Search to find others.",
                  other:
                    "Showing the {{count}} most recent {{itemsName}} that are not in this episode. Search to find others.",
                },
                rows.length,
                { itemName, itemsName },
              )}
        </p>,
      );
    }

    if (selectedInAnotherEpisode) {
      lines.push(
        <p key="other-episode" data-testid="add-episode-members-other-note">
          {translator.translateTemplate(
            "{{itemsName}} that are in another episode stay there too: one can be in several episodes.",
            { itemsName: itemsTitle },
          )}
        </p>,
      );
    }

    if (isAtLimit) {
      lines.push(
        <p key="max" data-testid="add-episode-members-max">
          {translator.translateTemplate(
            "You can add up to {{count}} {{itemsName}} at a time.",
            {
              count: translator.formatNumber(MAX_EPISODE_MEMBERS_PER_ADD),
              itemsName,
            },
          )}
        </p>,
      );
    }

    if (lines.length === 0) {
      return undefined;
    }

    return <div className="space-y-1">{lines}</div>;
  };

  const emptyState: ReactElement = (
    <div className="text-center">
      <div className="text-sm font-medium text-gray-900">
        {translator.translateTemplate("No {{itemsName}} to add", {
          itemsName,
        })}
      </div>
      <div className="mt-1 text-xs leading-5 text-gray-500">
        {memberIds && memberIds.length > 0
          ? translator.translateTemplate(
              "Every {{itemName}} you can see is in this episode already.",
              { itemName },
            )
          : translator.translateTemplate(
              "There are no {{itemsName}} in this project yet.",
              { itemsName },
            )}
      </div>
    </div>
  );

  const submitButtonText: string =
    selectedIds.length > 0
      ? translator.translatePlural(
          {
            one: "Add {{count}} {{itemName}}",
            other: "Add {{count}} {{itemsName}}",
          },
          selectedIds.length,
          { itemName: itemTitle, itemsName: itemsTitle },
        )
      : translator.translateTemplate("Add {{itemsName}}", {
          itemsName: itemsTitle,
        });

  return (
    <Modal
      title={translator.translateTemplate("Add {{itemsName}} to Episode", {
        itemsName: itemsTitle,
      })}
      description={translator.translateTemplate(
        "Pick the {{itemsName}} that belong to this episode. The ones already in it are not listed.",
        { itemsName },
      )}
      modalWidth={ModalWidth.Medium}
      onClose={props.onClose}
      submitButtonText={submitButtonText}
      disableSubmitButton={selectedIds.length === 0}
      isLoading={isSubmitting}
      error={submitError || undefined}
      onSubmit={() => {
        void submit();
      }}
    >
      <div data-testid="add-episode-members">
        {notAdded.length > 0 && (
          <div
            role="alert"
            data-testid="add-episode-members-not-added"
            className="mb-4 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700 ring-1 ring-inset ring-red-100"
          >
            <div className="font-medium">
              {translator.translatePlural(
                {
                  one: "{{count}} {{itemName}} was not added:",
                  other: "{{count}} {{itemsName}} were not added:",
                },
                notAdded.length,
                { itemName, itemsName },
              )}
            </div>
            <ul className="mt-1 space-y-0.5">
              {notAdded.map((entry: EpisodeMemberNotAdded) => {
                return (
                  <li key={entry.id} className="break-words">
                    {translator.translateTemplate("{{name}}: {{reason}}", {
                      name: getName(entry.id),
                      reason:
                        translator.translateText(entry.reason) || entry.reason,
                    })}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <EpisodePickerList
          testId="add-episode-members-list"
          selectionMode="multiple"
          sections={[
            {
              key: "records",
              items: rows.map(toItem),
            },
          ]}
          selectedIds={selectedIds}
          onToggle={toggle}
          isItemDisabled={() => {
            return isAtLimit;
          }}
          searchText={searchText}
          onSearchTextChange={setSearchText}
          searchPlaceholder={translator.translateTemplate(
            "Search {{itemsName}} by title or number",
            { itemsName },
          )}
          isLoading={isLoading}
          error={loadError}
          onRetry={retry}
          emptyState={emptyState}
          noMatchText={translator.translateTemplate(
            'No {{itemsName}} match "{{search}}".',
            { itemsName, search: debouncedSearch.trim() },
          )}
          footer={getFooter()}
        />
      </div>
    </Modal>
  );
};

export default AddEpisodeMembersModal;
