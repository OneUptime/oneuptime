import {
  ADD_EVENTS_BUTTON,
  ADD_TO_CASE_DESCRIPTION,
  ADD_TO_CASE_TITLE,
  CASES_NOT_LOADED,
  HUNTS_TEST_IDS,
  NO_MATCHING_CASES,
  NO_OPEN_CASES,
  SEARCH_CASES_PLACEHOLDER,
} from "./HuntsCopy";
import {
  ADD_TO_CASE_LIST_LIMIT,
  CasePickerItem,
  getOpenCasesQuery,
  toCasePickerItem,
} from "./AddToCaseModel";
import EpisodePickerList from "../../EpisodeMembers/EpisodePickerList";
import {
  SecurityCaseValueLists,
  getSecurityCaseValues,
} from "../../SecurityCase/SecurityCaseValues";
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

// How long typing pauses before the cases are searched.
export const ADD_TO_CASE_SEARCH_DEBOUNCE_MS: number = 300;

// The case the events go onto, as the dialog hands it over.
export interface PickedCase {
  id: string;
  number: string;
}

export interface ComponentProps {
  // How many events are being added.
  eventCount: number;
  onClose: () => void;
  onPick: (securityCase: PickedCase) => void;
}

/*
 * "Add to Case": pick the open case the events go onto. The project's open
 * cases are listed, the one with the latest detection first; typing
 * searches them by number or title. Each row shows its number and title,
 * its status and priority, and when it last saw a detection - the case
 * queue's own words for it. Picking is all this does: the caller keeps the
 * events (one request) and says what happened to each.
 */
const AddToCaseModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;

  const [searchText, setSearchText] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [items, setItems] = useState<Array<CasePickerItem>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [reloadToken, setReloadToken] = useState<number>(0);
  const [selectedId, setSelectedId] = useState<string>("");

  // Only the latest request may write the list.
  const requestIdRef: MutableRefObject<number> = useRef<number>(0);

  useEffect(() => {
    const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
      setDebouncedSearch(searchText);
    }, ADD_TO_CASE_SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timeout);
    };
  }, [searchText]);

  useEffect(() => {
    const requestId: number = ++requestIdRef.current;

    setIsLoading(true);
    setError("");

    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        const values: SecurityCaseValueLists =
          await getSecurityCaseValues(projectId);
        const result: ListResult<SecurityCase> =
          await ModelAPI.getList<SecurityCase>({
            modelType: SecurityCase,
            query: getOpenCasesQuery({
              projectId,
              statuses: values.statuses,
              searchText: debouncedSearch,
            }),
            limit: ADD_TO_CASE_LIST_LIMIT,
            skip: 0,
            select: {
              _id: true,
              caseNumberWithPrefix: true,
              title: true,
              securityCasePriorityId: true,
              securityCaseStatusId: true,
              lastDetectedAt: true,
              createdAt: true,
            },
            sort: { lastDetectedAt: SortOrder.Descending },
          });

        if (requestId !== requestIdRef.current) {
          return;
        }

        setItems(
          result.data
            .map((securityCase: SecurityCase): CasePickerItem => {
              return toCasePickerItem({
                securityCase,
                priorities: values.priorities,
                statuses: values.statuses,
              });
            })
            .filter((item: CasePickerItem): boolean => {
              return Boolean(item.id);
            }),
        );
      } catch (err) {
        if (requestId !== requestIdRef.current) {
          return;
        }

        setItems([]);
        setError(
          API.getFriendlyMessage(err) ||
            translator.translateText(CASES_NOT_LOADED) ||
            CASES_NOT_LOADED,
        );
      }

      if (requestId === requestIdRef.current) {
        setIsLoading(false);
      }
    };

    void load();
  }, [debouncedSearch, reloadToken, projectId.toString()]);

  const selected: CasePickerItem | undefined = items.find(
    (item: CasePickerItem): boolean => {
      return item.id === selectedId;
    },
  );

  return (
    <Modal
      title={ADD_TO_CASE_TITLE}
      description={ADD_TO_CASE_DESCRIPTION}
      modalWidth={ModalWidth.Medium}
      onClose={props.onClose}
      submitButtonText={translator.translatePlural(
        ADD_EVENTS_BUTTON,
        props.eventCount,
      )}
      disableSubmitButton={!selected}
      onSubmit={() => {
        if (selected) {
          props.onPick({ id: selected.id, number: selected.number || "" });
        }
      }}
    >
      <div data-testid={HUNTS_TEST_IDS.caseList}>
        <EpisodePickerList
          testId={HUNTS_TEST_IDS.caseRow}
          selectionMode="single"
          sections={[{ key: "open", items }]}
          selectedIds={selectedId ? [selectedId] : []}
          onToggle={(id: string) => {
            setSelectedId(id);
          }}
          searchText={searchText}
          onSearchTextChange={setSearchText}
          searchPlaceholder={
            translator.translateText(SEARCH_CASES_PLACEHOLDER) ||
            SEARCH_CASES_PLACEHOLDER
          }
          isLoading={isLoading}
          error={error}
          onRetry={() => {
            setReloadToken((token: number): number => {
              return token + 1;
            });
          }}
          emptyState={
            <p className="text-center text-sm text-gray-600">
              {translator.translateText(NO_OPEN_CASES) || NO_OPEN_CASES}
            </p>
          }
          noMatchText={
            translator.translateText(NO_MATCHING_CASES) || NO_MATCHING_CASES
          }
        />
      </div>
    </Modal>
  );
};

export default AddToCaseModal;
