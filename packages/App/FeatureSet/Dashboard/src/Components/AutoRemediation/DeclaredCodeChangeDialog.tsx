import {
  DECLARED_CODE_DIALOG_CHANGE_LABEL,
  DECLARED_CODE_DIALOG_CONNECT,
  DECLARED_CODE_DIALOG_DESCRIPTION,
  DECLARED_CODE_DIALOG_LOADING,
  DECLARED_CODE_DIALOG_MAY_NOT_ASK,
  DECLARED_CODE_DIALOG_NO_REPOSITORY,
  DECLARED_CODE_DIALOG_REPOSITORY_LABEL,
  DECLARED_CODE_DIALOG_SUBMIT,
  DECLARED_CODE_DIALOG_TARGET,
  DECLARED_CODE_DIALOG_TITLE,
  DECLARED_CODE_DIALOG_TRY_AGAIN,
  DECLARED_CODE_REASON_WORDS,
  getDeclaredCodeLiveChangeNote,
  getStartingRepositoryId,
  isDeclaredCodeReadRetryable,
} from "./DeclaredCodeChangeWords";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { AiRemediationCommand } from "Common/Types/AutoRemediation/AiRemediationCommandPlan";
import AutoRemediationSuggestionStatus from "Common/Types/AutoRemediation/AutoRemediationSuggestionStatus";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import {
  CloudChangeWords,
  describeCloudChange,
} from "Common/Utils/AiRemediation/CloudChangeWords";
import {
  DECLARED_CODE_CHANGE_PATH,
  DECLARED_CODE_OWNER_PATH,
  DeclaredCodeOwnerCandidateJSON,
  DeclaredCodeOwnerJSON,
  DeclaredCodeOwnerReason,
  readDeclaredCode,
} from "Common/Utils/AiRemediation/DeclaredCodeChange";
import BreakableName from "Common/UI/Components/BreakableName/BreakableName";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useState,
} from "react";

/*
 * ASK BEFORE OPENING A PULL REQUEST TO THE CODE THAT DECLARES A RESOURCE.
 *
 * Opened from a step of a fix whose resource is declared as code: the
 * change in plain words with where that kind of code most likely keeps the
 * value, the repositories connected to Code that may hold the code - the
 * likeliest chosen, each with why it is offered, in a list drawn as Code's
 * own repository lists are - and what becomes of the live change. Nothing
 * is opened until the person presses Open pull request; a repository they
 * may not ask AI to work in cannot be chosen.
 */

export const DECLARED_CODE_DIALOG_TEST_ID: string = "declared-code-dialog";

// A section's name, as the dialog's two sections both draw it.
const SECTION_LABEL_CLASS_NAME: string = "text-sm font-medium text-gray-900";

// Code as the code writes it: an attribute, a resource type, a file's path.
const CODE_CLASS_NAME: string =
  "break-words rounded bg-gray-100 px-1 py-px font-mono text-[0.6875rem] text-gray-800";

export interface ComponentProps {
  suggestionId: string;
  command: AiRemediationCommand;
  // Where the fix stands, for what becomes of the live change.
  suggestionStatus?: AutoRemediationSuggestionStatus | undefined;
  onClose: () => void;
  // The task was asked for: the card reads where it stands.
  onAsked: (taskId: string) => void;
}

// The owner route's answer, as the dialog reads it; null when it is not one.
export function readDeclaredCodeOwner(
  value: unknown,
): DeclaredCodeOwnerJSON | null {
  const object: Record<string, unknown> | null =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;

  if (!object || !Array.isArray(object["candidates"])) {
    return null;
  }

  const reasons: Array<string> = Object.values(DeclaredCodeOwnerReason);
  const candidates: Array<DeclaredCodeOwnerCandidateJSON> = [];

  for (const raw of object["candidates"] as Array<unknown>) {
    const row: Record<string, unknown> | null =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : null;

    if (
      !row ||
      typeof row["repositoryId"] !== "string" ||
      !reasons.includes(row["reason"] as string)
    ) {
      continue;
    }

    candidates.push({
      repositoryId: row["repositoryId"],
      name: typeof row["name"] === "string" ? row["name"] : "",
      fullName:
        typeof row["fullName"] === "string"
          ? row["fullName"]
          : typeof row["name"] === "string"
            ? row["name"]
            : "",
      reason: row["reason"] as DeclaredCodeOwnerReason,
      matchedPaths: Array.isArray(row["matchedPaths"])
        ? (row["matchedPaths"] as Array<unknown>).filter(
            (path: unknown): path is string => {
              return typeof path === "string";
            },
          )
        : [],
      isBest: row["isBest"] === true,
      canAsk: row["canAsk"] === true,
    });
  }

  const target: Record<string, unknown> | null =
    object["target"] &&
    typeof object["target"] === "object" &&
    !Array.isArray(object["target"])
      ? (object["target"] as Record<string, unknown>)
      : null;

  return {
    sequence: typeof object["sequence"] === "number" ? object["sequence"] : 0,
    managedAsCode:
      typeof object["managedAsCode"] === "string"
        ? object["managedAsCode"]
        : "",
    codeKind: object["codeKind"] as DeclaredCodeOwnerJSON["codeKind"],
    sentence: typeof object["sentence"] === "string" ? object["sentence"] : "",
    target:
      target &&
      typeof target["resourceType"] === "string" &&
      typeof target["attribute"] === "string"
        ? {
            resourceType: target["resourceType"],
            attribute: target["attribute"],
          }
        : null,
    candidates,
  };
}

const DeclaredCodeChangeDialog: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const groupName: string = `declared-code-repository-${useId()}`;
  const [owner, setOwner] = useState<DeclaredCodeOwnerJSON | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>("");
  // Whether reading again may answer otherwise: a refusal says the same every time.
  const [canRetryLoad, setCanRetryLoad] = useState<boolean>(false);
  // Asked again (Try again): the repositories are read afresh.
  const [loadRequest, setLoadRequest] = useState<number>(0);
  const [repositoryId, setRepositoryId] = useState<string | null>(null);
  const [isAsking, setIsAsking] = useState<boolean>(false);
  const [askError, setAskError] = useState<string>("");

  const code: string =
    readDeclaredCode(props.command.managedAsCode)?.name ||
    props.command.managedAsCode ||
    "";
  // The change in the reader's words, as the step above says it.
  const words: CloudChangeWords | null = describeCloudChange({
    resourceType: props.command.resourceType,
    command: props.command.command,
    translator,
  });

  useEffect(() => {
    let isCurrent: boolean = true;

    setIsLoading(true);
    setLoadError("");
    setCanRetryLoad(false);

    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              DECLARED_CODE_OWNER_PATH,
            ),
            data: {
              suggestionId: props.suggestionId,
              sequence: props.command.sequence,
            },
            headers: ModelAPI.getCommonHeaders(),
          });

        if (!isCurrent) {
          return;
        }

        if (response instanceof HTTPErrorResponse) {
          setLoadError(API.getFriendlyMessage(response));
          setCanRetryLoad(isDeclaredCodeReadRetryable(response.statusCode));
          return;
        }

        const read: DeclaredCodeOwnerJSON | null = readDeclaredCodeOwner(
          response.data,
        );

        // An answer that is not one: the server's usual words, and Try again.
        if (!read) {
          setLoadError(API.getFriendlyMessage(""));
          setCanRetryLoad(true);
          return;
        }

        setOwner(read);
        setRepositoryId(getStartingRepositoryId(read.candidates));
      } catch (error) {
        if (isCurrent) {
          // No answer at all: the network, which may pass.
          setLoadError(API.getFriendlyMessage(error));
          setCanRetryLoad(true);
        }
      } finally {
        if (isCurrent) {
          setIsLoading(false);
        }
      }
    };

    load().catch(() => {
      // handled inside load
    });

    return () => {
      isCurrent = false;
    };
  }, [props.suggestionId, props.command.sequence, loadRequest]);

  const ask: () => Promise<void> = async (): Promise<void> => {
    if (!repositoryId || isAsking) {
      return;
    }

    setIsAsking(true);
    setAskError("");

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            DECLARED_CODE_CHANGE_PATH,
          ),
          data: {
            suggestionId: props.suggestionId,
            sequence: props.command.sequence,
            codeRepositoryId: repositoryId,
          },
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      const taskId: unknown = (response.data || {})["taskId"];

      props.onAsked(typeof taskId === "string" ? taskId : "");
    } catch (error) {
      setAskError(API.getFriendlyMessage(error));
      setIsAsking(false);
    }
  };

  const candidates: Array<DeclaredCodeOwnerCandidateJSON> =
    owner?.candidates || [];
  const chosen: DeclaredCodeOwnerCandidateJSON | undefined = candidates.find(
    (candidate: DeclaredCodeOwnerCandidateJSON): boolean => {
      return candidate.repositoryId === repositoryId;
    },
  );

  // Why a repository is offered: its file's path drawn as code, the rest as words.
  const renderReason: (
    candidate: DeclaredCodeOwnerCandidateJSON,
  ) => ReactElement = (
    candidate: DeclaredCodeOwnerCandidateJSON,
  ): ReactElement => {
    const path: string = candidate.matchedPaths[0] || "";

    if (candidate.reason === DeclaredCodeOwnerReason.HasNamedFile && path) {
      return (
        <TranslatedSentence
          template={DECLARED_CODE_REASON_WORDS[candidate.reason]}
          slots={{
            path: (
              <code
                dir="ltr"
                className={CODE_CLASS_NAME}
                data-testid={`${DECLARED_CODE_DIALOG_TEST_ID}-path`}
              >
                <BreakableName text={path} breaksFromLength={0} />
              </code>
            ),
          }}
          values={{ code }}
        />
      );
    }

    return (
      <>
        {translator.translateTemplate(
          DECLARED_CODE_REASON_WORDS[candidate.reason],
          { code, path },
          { setsValuesApart: true },
        )}
      </>
    );
  };

  let body: ReactElement;

  if (isLoading) {
    body = (
      <p
        role="status"
        className="flex items-center gap-2 text-sm text-gray-500"
        data-testid={`${DECLARED_CODE_DIALOG_TEST_ID}-loading`}
      >
        <span
          aria-hidden="true"
          className="h-3.5 w-3.5 flex-none rounded-full border-2 border-gray-200 border-t-gray-500 motion-safe:animate-spin"
        />
        {translator.translateText(DECLARED_CODE_DIALOG_LOADING)}
      </p>
    );
  } else if (loadError || !owner) {
    // What went wrong, and - for a failure that may pass - a way to ask again.
    body = (
      <div
        role="alert"
        className="space-y-1.5 text-sm"
        data-testid={`${DECLARED_CODE_DIALOG_TEST_ID}-load-error`}
      >
        <p className="text-gray-700">{loadError}</p>
        {canRetryLoad ? (
          <button
            type="button"
            className="rounded font-medium text-indigo-600 hover:text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            data-testid={`${DECLARED_CODE_DIALOG_TEST_ID}-try-again`}
            onClick={() => {
              setLoadRequest((request: number) => {
                return request + 1;
              });
            }}
          >
            {translator.translateText(DECLARED_CODE_DIALOG_TRY_AGAIN)}
          </button>
        ) : (
          <></>
        )}
      </div>
    );
  } else {
    body = (
      <div className="space-y-5">
        <section
          className="space-y-1.5"
          data-testid={`${DECLARED_CODE_DIALOG_TEST_ID}-change`}
        >
          {/* A level under the dialog's own title (an h3). */}
          <h4 className={SECTION_LABEL_CLASS_NAME}>
            {translator.translateText(DECLARED_CODE_DIALOG_CHANGE_LABEL)}
          </h4>
          {/* What the pull request changes, set apart as the thing asked for. */}
          <div className="space-y-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
            <p
              dir="auto"
              className="break-words text-sm font-medium text-gray-900"
              data-testid={`${DECLARED_CODE_DIALOG_TEST_ID}-sentence`}
            >
              {words?.sentence || owner.sentence}
            </p>
            {owner.target ? (
              <p
                className="text-xs leading-5 text-gray-600"
                data-testid={`${DECLARED_CODE_DIALOG_TEST_ID}-target`}
              >
                {/* The attribute and the resource type as the code writes them. */}
                <TranslatedSentence
                  template={DECLARED_CODE_DIALOG_TARGET}
                  slots={{
                    attribute: (
                      <code
                        dir="ltr"
                        className={CODE_CLASS_NAME}
                        data-testid={`${DECLARED_CODE_DIALOG_TEST_ID}-attribute`}
                      >
                        {owner.target.attribute}
                      </code>
                    ),
                    resourceType: (
                      <code
                        dir="ltr"
                        className={CODE_CLASS_NAME}
                        data-testid={`${DECLARED_CODE_DIALOG_TEST_ID}-resource-type`}
                      >
                        {owner.target.resourceType}
                      </code>
                    ),
                  }}
                />
              </p>
            ) : (
              <></>
            )}
          </div>
        </section>

        <fieldset
          className="space-y-1.5"
          data-testid={`${DECLARED_CODE_DIALOG_TEST_ID}-repositories`}
        >
          <legend className={`mb-1.5 ${SECTION_LABEL_CLASS_NAME}`}>
            {translator.translateText(DECLARED_CODE_DIALOG_REPOSITORY_LABEL)}
          </legend>
          {candidates.length === 0 ? (
            <div
              className="space-y-1 rounded-lg border border-dashed border-gray-300 px-3 py-3"
              data-testid={`${DECLARED_CODE_DIALOG_TEST_ID}-no-repository`}
            >
              <p className="text-sm text-gray-700">
                {translator.translateText(DECLARED_CODE_DIALOG_NO_REPOSITORY)}
              </p>
              <Link
                to={RouteUtil.populateRouteParams(
                  RouteMap[PageMap.CODE_REPOSITORIES] as Route,
                )}
                className="rounded text-sm font-medium text-indigo-600 hover:text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <>{translator.translateText(DECLARED_CODE_DIALOG_CONNECT)}</>
              </Link>
            </div>
          ) : (
            /*
             * One list, a row a repository, as Code's own lists of
             * repositories are drawn: a long one scrolls inside its frame.
             */
            <div
              className="max-h-72 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200"
              data-testid={`${DECLARED_CODE_DIALOG_TEST_ID}-repository-list`}
            >
              {candidates.map(
                (candidate: DeclaredCodeOwnerCandidateJSON): ReactElement => {
                  /*
                   * A row that can be chosen answers the pointer; one that
                   * cannot is told by its radio, which keeps a field's own
                   * locked look (HandDrawnButtonLockedLookGuard).
                   */
                  return (
                    <label
                      key={candidate.repositoryId}
                      className={`flex items-start gap-3 px-3 py-2.5 ${
                        candidate.canAsk
                          ? "cursor-pointer hover:bg-gray-50"
                          : ""
                      }`}
                      data-testid={`${DECLARED_CODE_DIALOG_TEST_ID}-repository`}
                      data-repository={candidate.repositoryId}
                      data-reason={candidate.reason}
                    >
                      <input
                        type="radio"
                        name={groupName}
                        value={candidate.repositoryId}
                        checked={repositoryId === candidate.repositoryId}
                        disabled={!candidate.canAsk}
                        className="mt-0.5 h-4 w-4 flex-shrink-0 border-gray-300 text-indigo-600 accent-indigo-600 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                        onChange={() => {
                          setRepositoryId(candidate.repositoryId);
                        }}
                      />
                      <span className="min-w-0 flex-1 space-y-0.5">
                        {/*
                         * The name as Code's pages write a repository's,
                         * breaking after its slash before anywhere else.
                         * The line keeps the page's direction, so every
                         * name starts beside its radio; the name inside is
                         * set apart, so its slash and dashes stay in place.
                         */}
                        <span
                          className={`block break-words text-sm font-medium ${
                            candidate.canAsk ? "text-gray-900" : "text-gray-500"
                          }`}
                          data-testid={`${DECLARED_CODE_DIALOG_TEST_ID}-repository-name`}
                        >
                          <bdi>
                            <BreakableName
                              text={candidate.fullName}
                              breaksFromLength={0}
                            />
                          </bdi>
                        </span>
                        <span className="block break-words text-xs leading-5 text-gray-500">
                          {renderReason(candidate)}
                        </span>
                        {candidate.canAsk ? (
                          <></>
                        ) : (
                          <span
                            className="block text-xs leading-5 text-gray-500"
                            data-testid={`${DECLARED_CODE_DIALOG_TEST_ID}-may-not-ask`}
                          >
                            {translator.translateText(
                              DECLARED_CODE_DIALOG_MAY_NOT_ASK,
                            )}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                },
              )}
            </div>
          )}
        </fieldset>

        {/* What opening it does not do: the live change is decided apart. */}
        <div
          className="flex items-start gap-2 text-xs leading-5 text-gray-600"
          data-testid={`${DECLARED_CODE_DIALOG_TEST_ID}-live-change`}
        >
          <Icon
            icon={IconProp.Info}
            className="mt-0.5 h-4 w-4 flex-none text-gray-400"
          />
          <p className="min-w-0">
            {translator.translateText(
              getDeclaredCodeLiveChangeNote({
                command: props.command,
                suggestionStatus: props.suggestionStatus,
              }),
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <Modal
      title={DECLARED_CODE_DIALOG_TITLE}
      description={translator.translateTemplate(
        DECLARED_CODE_DIALOG_DESCRIPTION,
        { code },
        { setsValuesApart: true },
      )}
      modalWidth={ModalWidth.Medium}
      onClose={props.onClose}
      submitButtonText={DECLARED_CODE_DIALOG_SUBMIT}
      onSubmit={() => {
        ask().catch(() => {
          // handled inside ask
        });
      }}
      isLoading={isAsking}
      disableSubmitButton={!chosen || !chosen.canAsk}
      error={askError || undefined}
    >
      <div data-testid={DECLARED_CODE_DIALOG_TEST_ID}>{body}</div>
    </Modal>
  );
};

export default DeclaredCodeChangeDialog;
