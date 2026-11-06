import {
  DECLARED_CODE_DIALOG_CHANGE_LABEL,
  DECLARED_CODE_DIALOG_CONNECT,
  DECLARED_CODE_DIALOG_DESCRIPTION,
  DECLARED_CODE_DIALOG_LOADING,
  DECLARED_CODE_DIALOG_MAY_NOT_ASK,
  DECLARED_CODE_DIALOG_NO_REPOSITORY,
  DECLARED_CODE_DIALOG_RAN_NOTE,
  DECLARED_CODE_DIALOG_REPOSITORY_LABEL,
  DECLARED_CODE_DIALOG_SUBMIT,
  DECLARED_CODE_DIALOG_TARGET,
  DECLARED_CODE_DIALOG_TITLE,
  DECLARED_CODE_DIALOG_WAITING_NOTE,
  DECLARED_CODE_REASON_WORDS,
  getStartingRepositoryId,
  hasLiveChangeRun,
} from "./DeclaredCodeChangeWords";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { AiRemediationCommand } from "Common/Types/AutoRemediation/AiRemediationCommandPlan";
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
import Link from "Common/UI/Components/Link/Link";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
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
 * change in plain words, where that kind of code most likely keeps the
 * value, the repositories connected to Code that may hold the code - the
 * likeliest chosen, each with why it is offered - and what becomes of the
 * live change. Nothing is opened until the person presses Open pull
 * request; a repository they may not ask AI to work in cannot be chosen.
 */

export const DECLARED_CODE_DIALOG_TEST_ID: string = "declared-code-dialog";

export interface ComponentProps {
  suggestionId: string;
  command: AiRemediationCommand;
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
          return;
        }

        const read: DeclaredCodeOwnerJSON | null = readDeclaredCodeOwner(
          response.data,
        );

        setOwner(read);
        setRepositoryId(read ? getStartingRepositoryId(read.candidates) : null);
      } catch (error) {
        if (isCurrent) {
          setLoadError(API.getFriendlyMessage(error));
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
  }, [props.suggestionId, props.command.sequence]);

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

  let body: ReactElement;

  if (isLoading) {
    body = (
      <p
        role="status"
        className="text-sm text-gray-500"
        data-testid={`${DECLARED_CODE_DIALOG_TEST_ID}-loading`}
      >
        {translator.translateText(DECLARED_CODE_DIALOG_LOADING)}
      </p>
    );
  } else if (loadError || !owner) {
    body = (
      <p
        role="alert"
        className="text-sm text-amber-700"
        data-testid={`${DECLARED_CODE_DIALOG_TEST_ID}-load-error`}
      >
        {loadError}
      </p>
    );
  } else {
    body = (
      <div className="space-y-5">
        <div
          className="space-y-1"
          data-testid={`${DECLARED_CODE_DIALOG_TEST_ID}-change`}
        >
          <p className="text-xs font-medium text-gray-500">
            {translator.translateText(DECLARED_CODE_DIALOG_CHANGE_LABEL)}
          </p>
          <p dir="auto" className="text-sm font-medium text-gray-900">
            {words?.sentence || owner.sentence}
          </p>
          {owner.target ? (
            <p
              className="text-xs leading-5 text-gray-600"
              data-testid={`${DECLARED_CODE_DIALOG_TEST_ID}-target`}
            >
              {translator.translateTemplate(DECLARED_CODE_DIALOG_TARGET, {
                attribute: owner.target.attribute,
                resourceType: owner.target.resourceType,
              })}
            </p>
          ) : (
            <></>
          )}
        </div>

        <fieldset
          className="space-y-2"
          data-testid={`${DECLARED_CODE_DIALOG_TEST_ID}-repositories`}
        >
          <legend className="text-sm font-medium text-gray-900">
            {translator.translateText(DECLARED_CODE_DIALOG_REPOSITORY_LABEL)}
          </legend>
          {candidates.length === 0 ? (
            <div
              className="space-y-1"
              data-testid={`${DECLARED_CODE_DIALOG_TEST_ID}-no-repository`}
            >
              <p className="text-sm text-amber-700">
                {translator.translateText(DECLARED_CODE_DIALOG_NO_REPOSITORY)}
              </p>
              <Link
                to={RouteUtil.populateRouteParams(
                  RouteMap[PageMap.CODE_REPOSITORIES] as Route,
                )}
                className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
              >
                <>{translator.translateText(DECLARED_CODE_DIALOG_CONNECT)}</>
              </Link>
            </div>
          ) : (
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {candidates.map(
                (candidate: DeclaredCodeOwnerCandidateJSON): ReactElement => {
                  return (
                    <label
                      key={candidate.repositoryId}
                      className={`flex items-start gap-2 rounded-md px-2 py-1.5 text-sm ${
                        candidate.canAsk
                          ? "text-gray-800 hover:bg-gray-50"
                          : "text-gray-400"
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
                        className="mt-0.5 h-4 w-4 flex-shrink-0 border-gray-300 text-indigo-600 accent-indigo-600 focus:ring-indigo-500"
                        onChange={() => {
                          setRepositoryId(candidate.repositoryId);
                        }}
                      />
                      <span className="min-w-0">
                        <span
                          dir="ltr"
                          className="block break-all font-mono text-sm text-gray-900"
                        >
                          {candidate.fullName}
                        </span>
                        <span className="block text-xs text-gray-500">
                          {translator.translateTemplate(
                            DECLARED_CODE_REASON_WORDS[candidate.reason],
                            {
                              code,
                              path: candidate.matchedPaths[0] || "",
                            },
                          )}
                        </span>
                        {candidate.canAsk ? (
                          <></>
                        ) : (
                          <span className="block text-xs text-gray-500">
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

        <p
          className="text-xs leading-5 text-gray-600"
          data-testid={`${DECLARED_CODE_DIALOG_TEST_ID}-live-change`}
        >
          {translator.translateText(
            hasLiveChangeRun(props.command)
              ? DECLARED_CODE_DIALOG_RAN_NOTE
              : DECLARED_CODE_DIALOG_WAITING_NOTE,
          )}
        </p>
      </div>
    );
  }

  return (
    <Modal
      title={DECLARED_CODE_DIALOG_TITLE}
      description={translator.translateTemplate(
        DECLARED_CODE_DIALOG_DESCRIPTION,
        { code },
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
