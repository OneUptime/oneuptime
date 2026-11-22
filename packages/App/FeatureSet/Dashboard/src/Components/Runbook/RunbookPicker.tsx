import URL from "Common/Types/API/URL";
import CardListSkeleton from "Common/UI/Components/Skeleton/CardListSkeleton";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { RUNBOOK_URL } from "Common/UI/Config";
import ProjectUtil from "Common/UI/Utils/Project";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IsolatedLine from "Common/UI/Components/IsolatedText/IsolatedLine";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  RUNNABLE_RUNBOOKS_PAGE_SIZE,
  getRunnableRunbooksQuery,
} from "Common/Utils/Runbook/RunnableRunbooks";
import React, {
  Fragment,
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

// How long typing pauses before the runbooks are searched.
export const RUNBOOK_PICKER_SEARCH_DEBOUNCE_MS: number = 250;

/*
 * Where each runbook's Run sits: at its own width beside the runbook. A
 * button is as wide as its row below md, which beside the runbook's name
 * left the name no room at all.
 */
export const RUNBOOK_PICKER_RUN_CLASS_NAME: string = "shrink-0";

export interface ComponentProps {
  isOpen: boolean;
  onClose: () => void;
  onStarted?: (() => void) | undefined;
  incidentId?: ObjectID | undefined;
  alertId?: ObjectID | undefined;
  scheduledMaintenanceId?: ObjectID | undefined;
}

const RunbookPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [error, setError] = useState<string>("");
  const [startingRunbookId, setStartingRunbookId] = useState<string | null>(
    null,
  );
  // The page of runbooks the last search found, by name, and how many match.
  const [runbooks, setRunbooks] = useState<Array<Runbook>>([]);
  const [matchCount, setMatchCount] = useState<number>(0);
  /*
   * Whether the project has a runbook to run at all, from the read with
   * nothing typed: a search that finds nothing then says "No matches", and
   * a project with none says "No runbooks yet" whatever is typed.
   */
  const [hasRunbooks, setHasRunbooks] = useState<boolean>(true);
  const [isLoadingRunbooks, setIsLoadingRunbooks] = useState<boolean>(false);
  // What is typed, and the text the list was last searched for.
  const [pickerSearch, setPickerSearch] = useState<string>("");
  const [searchedText, setSearchedText] = useState<string>("");
  // Only the latest search may write the list.
  const searchIdRef: MutableRefObject<number> = useRef<number>(0);

  const linkagePayload: Record<string, string> = {};
  if (props.incidentId) {
    linkagePayload["incidentId"] = props.incidentId.toString();
  }
  if (props.alertId) {
    linkagePayload["alertId"] = props.alertId.toString();
  }
  if (props.scheduledMaintenanceId) {
    linkagePayload["scheduledMaintenanceId"] =
      props.scheduledMaintenanceId.toString();
  }

  /*
   * The project's enabled runbooks whose name holds `searchText`, a page at
   * a time, by name: searched on the server (#10580). The dialog read the
   * first 200 when it opened and searched those in the browser, so a
   * runbook whose name sorted late in a project with more was never
   * offered, and a search for it said "No matches".
   */
  const loadRunbooks: (searchText: string) => Promise<void> = async (
    searchText: string,
  ): Promise<void> => {
    const searchId: number = ++searchIdRef.current;

    setIsLoadingRunbooks(true);

    try {
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

      if (!projectId) {
        setRunbooks([]);
        setMatchCount(0);
        return;
      }

      const result: ListResult<Runbook> = await ModelAPI.getList<Runbook>({
        modelType: Runbook,
        query: getRunnableRunbooksQuery({
          projectId: projectId,
          searchText: searchText,
        }),
        limit: RUNNABLE_RUNBOOKS_PAGE_SIZE,
        skip: 0,
        select: { _id: true, name: true, description: true },
        sort: { name: SortOrder.Ascending },
      });

      if (searchId !== searchIdRef.current) {
        return;
      }

      setRunbooks(result.data);
      setMatchCount(
        typeof result.count === "number" && result.count >= result.data.length
          ? result.count
          : result.data.length,
      );

      if (!searchText) {
        setHasRunbooks(result.data.length > 0);
      }
    } catch (err) {
      if (searchId === searchIdRef.current) {
        setError(API.getFriendlyMessage(err));
      }
    } finally {
      if (searchId === searchIdRef.current) {
        setIsLoadingRunbooks(false);
      }
    }
  };

  // Opened, it starts with nothing typed; closed, it forgets the search.
  useEffect(() => {
    setPickerSearch("");
    setSearchedText("");
  }, [props.isOpen]);

  // What is typed is searched once typing pauses.
  useEffect(() => {
    if (!props.isOpen) {
      return;
    }

    const trimmed: string = pickerSearch.trim();
    const timeout: ReturnType<typeof setTimeout> = setTimeout(
      () => {
        setSearchedText(trimmed);
      },
      trimmed ? RUNBOOK_PICKER_SEARCH_DEBOUNCE_MS : 0,
    );

    return () => {
      clearTimeout(timeout);
    };
  }, [pickerSearch, props.isOpen]);

  useEffect(() => {
    if (props.isOpen) {
      void loadRunbooks(searchedText);
    }
  }, [props.isOpen, searchedText]);

  const startRunbook: (runbookId: string) => Promise<void> = async (
    runbookId: string,
  ): Promise<void> => {
    setStartingRunbookId(runbookId);
    setError("");
    try {
      const result: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post<JSONObject>({
          url: URL.fromString(RUNBOOK_URL.toString()).addRoute(
            "/run/" + runbookId,
          ),
          data: linkagePayload,
          headers: ModelAPI.getCommonHeaders({}),
        });
      if (result instanceof HTTPErrorResponse) {
        throw result;
      }
      props.onClose();
      if (props.onStarted) {
        props.onStarted();
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setStartingRunbookId(null);
    }
  };

  if (!props.isOpen) {
    return error ? (
      <ConfirmModal
        title="Could not start runbook"
        description={error}
        submitButtonText="Close"
        submitButtonType={ButtonStyleType.NORMAL}
        onSubmit={() => {
          setError("");
        }}
      />
    ) : (
      <Fragment />
    );
  }

  return (
    <Fragment>
      <Modal
        title="Run a Runbook"
        description="Pick a runbook to run. It will be attached to this event so you can track it from here."
        isLoading={false}
        modalWidth={ModalWidth.Large}
        onClose={() => {
          props.onClose();
        }}
      >
        <div className="space-y-3">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
              <Icon
                icon={IconProp.Search}
                size={SizeProp.Regular}
                className="text-gray-400"
              />
            </span>
            <input
              data-unsaved-changes-ignore
              type="text"
              placeholder={translator.translateText("Search runbooks...")}
              value={pickerSearch}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setPickerSearch(e.target.value);
              }}
              className="block w-full rounded-md border border-gray-300 bg-white pl-10 pr-3 py-2 text-sm placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {isLoadingRunbooks ? (
            <div className="flex justify-center py-6">
              <CardListSkeleton count={3} lines={1} />
            </div>
          ) : runbooks.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-6 py-8 text-center">
              <div className="mx-auto h-10 w-10 rounded-full bg-white border border-gray-200 flex items-center justify-center mb-3">
                <Icon
                  icon={IconProp.BookOpen}
                  size={SizeProp.Regular}
                  className="text-gray-400"
                />
              </div>
              <p className="text-sm font-medium text-gray-900">
                {translator.translateText(
                  hasRunbooks ? "No matches" : "No runbooks yet",
                )}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {translator.translateText(
                  hasRunbooks
                    ? "Try a different search term."
                    : "Create a runbook first, then come back to attach one.",
                )}
              </p>
            </div>
          ) : (
            <ul className="space-y-2 max-h-96 overflow-y-auto">
              {runbooks.map((rb: Runbook) => {
                const rbId: string = rb._id?.toString() || "";
                const isStarting: boolean = startingRunbookId === rbId;
                return (
                  <li key={rbId}>
                    <div className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 hover:border-indigo-300 hover:shadow-sm transition">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Icon
                            icon={IconProp.BookOpen}
                            size={SizeProp.Regular}
                            className="text-indigo-500 shrink-0"
                          />
                          {/*
                           * The runbook's name and description are the
                           * project's own, read the way they are written
                           * (IsolatedLine): cut short at their own end.
                           */}
                          <IsolatedLine
                            as="span"
                            text={
                              rb.name ||
                              translator.translateText("Untitled runbook") ||
                              ""
                            }
                            className="text-sm font-semibold text-gray-900 truncate"
                            dataTestId="runbook-picker-name"
                          />
                        </div>
                        {rb.description && (
                          <IsolatedLine
                            as="p"
                            text={rb.description}
                            className="text-xs text-gray-500 mt-1 line-clamp-2"
                            dataTestId="runbook-picker-description"
                          />
                        )}
                      </div>
                      {/*
                       * One Run per row, so a plain one: a filled button on
                       * every row is as many "main actions" as there are
                       * runbooks. It keeps its own width: a button is as
                       * wide as its row on a phone, and beside the runbook
                       * it took the whole row, so no runbook showed its
                       * name or what it does.
                       */}
                      <div
                        className={RUNBOOK_PICKER_RUN_CLASS_NAME}
                        data-testid="runbook-picker-run"
                      >
                        <Button
                          title={isStarting ? "Starting..." : "Run"}
                          buttonStyle={ButtonStyleType.NORMAL}
                          buttonSize={ButtonSize.Small}
                          icon={IconProp.Play}
                          onClick={() => {
                            void startRunbook(rbId);
                          }}
                          disabled={startingRunbookId !== null}
                        />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/*
           * More runbooks match than one read lists: how many, and how to
           * find the rest - typing more of a name narrows them.
           */}
          {!isLoadingRunbooks && matchCount > runbooks.length ? (
            <p
              className="text-xs text-gray-500"
              data-testid="runbook-picker-more"
            >
              {translator.translateTemplate(
                "Showing {{shown}} of {{total}}. Type to narrow the list.",
                {
                  shown: translator.formatNumber(runbooks.length),
                  total: translator.formatNumber(matchCount),
                },
              )}
            </p>
          ) : null}
        </div>
      </Modal>

      {error ? (
        <ConfirmModal
          title="Could not start runbook"
          description={error}
          submitButtonText="Close"
          submitButtonType={ButtonStyleType.NORMAL}
          onSubmit={() => {
            setError("");
          }}
        />
      ) : null}
    </Fragment>
  );
};

export default RunbookPicker;
