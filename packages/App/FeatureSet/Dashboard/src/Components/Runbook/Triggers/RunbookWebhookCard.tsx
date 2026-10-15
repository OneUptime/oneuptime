import Runbook from "Common/Models/DatabaseModels/Runbook";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  RUNBOOK_WEBHOOK_EXAMPLE_BODY,
  RUNBOOK_WEBHOOK_SECRET_MASK,
  getRunbookWebhookCurlExample,
  getRunbookWebhookUrl,
  getRunbookWebhookUrlPrefix,
} from "Common/Types/Runbook/RunbookWebhook";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledBodyClassName } from "Common/UI/Components/Card/CardSurface";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Icon from "Common/UI/Components/Icon/Icon";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelSwitchRow from "Common/UI/Components/ModelSwitch/ModelSwitchRow";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import BreakableCode from "Common/UI/Components/Workflow/BreakableCode";
import { RUNBOOK_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import PlainAPI from "Common/Utils/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import AppLink from "../../AppLink/AppLink";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  getRunbookRunGate,
  getRunbookRunLockedReason,
} from "../RunbookRunGate";
import RunbookTriggerNote from "./RunbookTriggerNote";
import {
  RunbookTriggersCopy,
  RunbookTriggersDocs,
  RunbookTriggersTestIds,
  translateCopy,
} from "./RunbookTriggersCopy";

/*
 * "Webhook", on a runbook's Triggers page.
 *
 * A switch, "Run when this URL is called", that saves the moment it is
 * flipped; the first time it is turned on the server gives the runbook a
 * secret key. While it is on: the URL - masked until asked for, as the
 * workflow webhook's is, with Copy URL - what to send it (an example
 * request, and how the steps read the values sent), Send Test Request, and
 * Reset URL, which replaces the key after a confirmation that says what
 * breaks.
 *
 * The URL holds the key that starts runs, so it is shown only to people who
 * may set up the runbook's triggers AND run it - the server's key routes
 * ask exactly that (RunbookTriggerAccess.assertMayManageWebhook) - and
 * everyone else is told who can see it.
 */

export interface ComponentProps {
  runbookId: ObjectID;
}

// What the test dialog holds.
interface TestFormValues {
  body: string;
}

export const WEBHOOK_CARD_SELECT: {
  _id: true;
  isEnabled: true;
  steps: true;
  isWebhookEnabled: true;
} = {
  _id: true,
  isEnabled: true,
  steps: true,
  isWebhookEnabled: true,
};

// The runbook service, as the browser reaches it.
export function getRunbookServiceUrl(): string {
  return RUNBOOK_URL.toString();
}

// Where the Triggers page reads and resets the key.
export function getSecretKeyUrl(runbookId: ObjectID, reset: boolean): URL {
  return URL.fromString(getRunbookServiceUrl()).addRoute(
    `/webhook-secret/${runbookId.toString()}${reset ? "/reset" : ""}`,
  );
}

// A test body as the object it is sent as, or null when it is not one.
export function parseTestBody(body: string): JSONObject | null {
  if (!body || !body.trim()) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(body);

    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as JSONObject)
      : null;
  } catch {
    return null;
  }
}

const RunbookWebhookCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const translate: (text: string) => string = (text: string): string => {
    return translateCopy(translator, text);
  };
  const ruledBodyClassName: string = useCardRuledBodyClassName();
  const runbookIdString: string = props.runbookId.toString();

  const [runbook, setRunbook] = useState<Runbook | null>(null);
  // Where the switch stands, and where the server has it.
  const [isOn, setIsOn] = useState<boolean>(false);
  const [isSavedOn, setIsSavedOn] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const [secretKey, setSecretKey] = useState<string | null>(null);
  const [isKeyLoading, setIsKeyLoading] = useState<boolean>(false);
  const [keyError, setKeyError] = useState<string>("");
  const [isKeyRefused, setIsKeyRefused] = useState<boolean>(false);

  const [isUrlShown, setIsUrlShown] = useState<boolean>(false);
  const [showResetConfirmation, setShowResetConfirmation] =
    useState<boolean>(false);
  const [isResetting, setIsResetting] = useState<boolean>(false);
  const [resetError, setResetError] = useState<string>("");
  const [hasJustReset, setHasJustReset] = useState<boolean>(false);

  const [showTestDialog, setShowTestDialog] = useState<boolean>(false);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testError, setTestError] = useState<string>("");
  const [testedExecutionId, setTestedExecutionId] = useState<string | null>(
    null,
  );

  const readRef: MutableRefObject<number> = useRef<number>(0);

  const runbookModel: Runbook = useMemo((): Runbook => {
    return new Runbook();
  }, []);

  // Who may see the URL: who may set up the webhook and run the runbook.
  const editGate: PermissionGateResult = PermissionGate.checkColumnUpdate(
    runbookModel,
    "isWebhookEnabled",
  );
  const runLockedReason: string | undefined =
    getRunbookRunLockedReason(getRunbookRunGate());
  const mayManage: boolean = editGate.isAllowed && !runLockedReason;

  const fetchRunbook: () => Promise<void> = async (): Promise<void> => {
    const read: number = readRef.current + 1;
    readRef.current = read;

    setIsLoading(true);
    setError("");

    try {
      const item: Runbook | null = await ModelAPI.getItem<Runbook>({
        modelType: Runbook,
        id: props.runbookId,
        select: WEBHOOK_CARD_SELECT,
      });

      if (read !== readRef.current) {
        return;
      }

      if (!item) {
        setError("Item not found");
      } else {
        setRunbook(item);
        setIsOn(item.isWebhookEnabled === true);
        setIsSavedOn(item.isWebhookEnabled === true);
      }
    } catch (err) {
      if (read === readRef.current) {
        setError(API.getFriendlyMessage(err));
      }
    }

    setIsLoading(false);
  };

  const fetchSecretKey: () => Promise<void> = async (): Promise<void> => {
    setIsKeyLoading(true);
    setKeyError("");
    setIsKeyRefused(false);

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: getSecretKeyUrl(props.runbookId, false),
          data: {},
          headers: ModelAPI.getCommonHeaders({}),
        });

      if (response instanceof HTTPErrorResponse) {
        // Labels or team blocks the dashboard cannot see said no.
        if (response.statusCode === 422 || response.statusCode === 403) {
          setIsKeyRefused(true);
          return;
        }

        throw response;
      }

      const key: unknown = response.data?.["secretKey"];

      if (typeof key === "string" && key) {
        setSecretKey(key);
      } else {
        // Turned off somewhere else since this page read it.
        setSecretKey(null);
        setKeyError(translate(RunbookTriggersCopy.urlLoadFailed));
      }
    } catch (err) {
      setKeyError(API.getFriendlyMessage(err));
    } finally {
      setIsKeyLoading(false);
    }
  };

  useEffect(() => {
    void fetchRunbook();

    return () => {
      readRef.current += 1;
    };
  }, [runbookIdString]);

  /*
   * The URL is read once the server has the webhook on: the first time it
   * is turned on, that is what gives the runbook its key.
   */
  useEffect(() => {
    if (isSavedOn && mayManage) {
      void fetchSecretKey();
    }
  }, [isSavedOn, mayManage, runbookIdString]);

  const resetUrl: () => Promise<boolean> = async (): Promise<boolean> => {
    setIsResetting(true);
    setResetError("");

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: getSecretKeyUrl(props.runbookId, true),
          data: {},
          headers: ModelAPI.getCommonHeaders({}),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      const key: unknown = response.data?.["secretKey"];
      setSecretKey(typeof key === "string" && key ? key : null);
      setHasJustReset(true);

      return true;
    } catch (err) {
      setResetError(API.getFriendlyMessage(err));

      return false;
    } finally {
      setIsResetting(false);
    }
  };

  const sendTest: (values: TestFormValues) => Promise<void> = async (
    values: TestFormValues,
  ): Promise<void> => {
    const body: JSONObject | null = parseTestBody(values.body);

    if (!body || !secretKey) {
      setTestError(translate(RunbookTriggersCopy.testBodyNotJson));
      return;
    }

    setIsTesting(true);
    setTestError("");

    try {
      /*
       * Called as another tool calls it: the URL and a JSON body, with no
       * session - and through the plain client, so a refusal (the runbook
       * is off: 403) is shown here rather than taken for the dashboard's
       * own session being refused.
       */
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await PlainAPI.post<JSONObject>({
          url: URL.fromString(
            getRunbookWebhookUrl({
              runbookServiceUrl: getRunbookServiceUrl(),
              runbookId: runbookIdString,
              secretKey,
            }),
          ),
          data: body,
          headers: {},
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      const executionId: unknown = response.data?.["runbookExecutionId"];
      setTestedExecutionId(typeof executionId === "string" ? executionId : "");
      setShowTestDialog(false);
    } catch (err) {
      setTestError(API.getFriendlyMessage(err));
    } finally {
      setIsTesting(false);
    }
  };

  const getUrlPanel: () => ReactElement = (): ReactElement => {
    if (!mayManage || isKeyRefused) {
      return (
        <div
          className="flex items-start gap-2 text-sm text-gray-600"
          data-testid={RunbookTriggersTestIds.webhookHidden}
        >
          <div className="mt-0.5 shrink-0">
            <Icon icon={IconProp.Lock} className="h-4 w-4 text-gray-400" />
          </div>
          <p>{translate(RunbookTriggersCopy.urlHidden)}</p>
        </div>
      );
    }

    if (keyError && !isKeyLoading) {
      return (
        <ErrorMessage
          message={keyError}
          onRefreshClick={() => {
            void fetchSecretKey();
          }}
        />
      );
    }

    // Saving the switch, then reading the URL.
    if (!secretKey) {
      return (
        <p className="text-sm text-gray-500">
          {translate(RunbookTriggersCopy.urlLoading)}
        </p>
      );
    }

    const webhookUrl: string = getRunbookWebhookUrl({
      runbookServiceUrl: getRunbookServiceUrl(),
      runbookId: runbookIdString,
      secretKey,
    });
    const urlPrefix: string = getRunbookWebhookUrlPrefix({
      runbookServiceUrl: getRunbookServiceUrl(),
      runbookId: runbookIdString,
    });
    const shownUrl: string = isUrlShown
      ? webhookUrl
      : `${urlPrefix}${RUNBOOK_WEBHOOK_SECRET_MASK}`;

    return (
      <div className="space-y-4">
        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
            {translate(RunbookTriggersCopy.webhookUrlTitle)}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <div
              className="min-w-0 flex-1 overflow-x-auto rounded-md border border-gray-200 bg-white px-3 py-2 text-xs leading-5 text-gray-900 sm:text-sm"
              data-testid={RunbookTriggersTestIds.webhookUrl}
              data-url-shown={isUrlShown ? "true" : "false"}
            >
              {isUrlShown ? (
                <BreakableCode text={webhookUrl} breakAfter="/" />
              ) : (
                <>
                  <BreakableCode text={urlPrefix} breakAfter="/" />
                  <span
                    aria-hidden="true"
                    className="whitespace-nowrap font-mono text-gray-500"
                  >
                    {RUNBOOK_WEBHOOK_SECRET_MASK}
                  </span>
                  <span className="sr-only">
                    {` ${translate(RunbookTriggersCopy.maskedForScreenReaders)}`}
                  </span>
                </>
              )}
            </div>
            <div className="flex shrink-0 items-start gap-2">
              <CopyTextButton
                textToBeCopied={webhookUrl}
                label={translate(RunbookTriggersCopy.copyUrl)}
                copiedLabel={translate(RunbookTriggersCopy.copied)}
                size="md"
                variant="soft"
                title={translate(RunbookTriggersCopy.copyUrlTitle)}
              />
              <button
                type="button"
                className="inline-flex cursor-pointer select-none items-center justify-center gap-1 rounded-md border border-gray-200 bg-gray-100 px-2.5 py-1.5 text-sm text-gray-600 transition-colors duration-150 hover:bg-gray-200"
                data-testid={RunbookTriggersTestIds.webhookVisibility}
                title={translate(
                  isUrlShown
                    ? RunbookTriggersCopy.hideTitle
                    : RunbookTriggersCopy.showTitle,
                )}
                aria-label={translate(
                  isUrlShown
                    ? RunbookTriggersCopy.hideTitle
                    : RunbookTriggersCopy.showTitle,
                )}
                onClick={() => {
                  setIsUrlShown(!isUrlShown);
                }}
              >
                <span aria-hidden="true" className="flex items-center">
                  <Icon
                    icon={isUrlShown ? IconProp.EyeSlash : IconProp.Eye}
                    className="h-[1.125rem] w-[1.125rem]"
                  />
                </span>
                <span>
                  {translate(
                    isUrlShown
                      ? RunbookTriggersCopy.hide
                      : RunbookTriggersCopy.show,
                  )}
                </span>
              </button>
            </div>
          </div>
          {hasJustReset ? (
            <div
              className="mt-2 flex items-start gap-1.5 text-xs text-emerald-700"
              role="status"
              data-testid={RunbookTriggersTestIds.webhookResetDone}
            >
              <div className="mt-px shrink-0">
                <Icon
                  icon={IconProp.CheckCircle}
                  className="h-3.5 w-3.5 text-emerald-600"
                />
              </div>
              <p>{translate(RunbookTriggersCopy.resetDone)}</p>
            </div>
          ) : (
            <></>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {translate(RunbookTriggersCopy.tryIt)}
            </p>
            <CopyTextButton
              textToBeCopied={getRunbookWebhookCurlExample(webhookUrl)}
              label={translate(RunbookTriggersCopy.copyExample)}
              copiedLabel={translate(RunbookTriggersCopy.copied)}
              size="sm"
              variant="soft"
              title={translate(RunbookTriggersCopy.copyExampleTitle)}
            />
          </div>
          <pre
            className="mt-1.5 overflow-x-auto rounded-md border border-gray-200 bg-white px-3 py-2 font-mono text-xs leading-5 text-gray-800"
            data-testid={RunbookTriggersTestIds.webhookCurl}
          >
            <code className="font-mono">
              {getRunbookWebhookCurlExample(shownUrl)}
            </code>
          </pre>
        </div>

        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            {translate(RunbookTriggersCopy.inputsTitle)}
          </p>
          <p className="mt-1 text-sm text-gray-600">
            <TranslatedSentence
              template={RunbookTriggersCopy.inputsSentence}
              slots={{
                bash: (
                  <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs text-gray-800">
                    &quot;$ONEUPTIME_INPUT_HOST&quot;
                  </code>
                ),
                javascript: (
                  <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs text-gray-800">
                    args.inputs.host
                  </code>
                ),
              }}
            />{" "}
            <a
              className="font-medium text-indigo-600 hover:text-indigo-500"
              href={RunbookTriggersDocs.webhook}
              target="_blank"
              rel="noopener noreferrer"
            >
              {translate(RunbookTriggersCopy.learnMore)}
            </a>
          </p>
        </div>

        {/* What the last test request started, next to the button that sent it. */}
        {getTestResult()}

        <div className="flex flex-col gap-3 border-t border-gray-200 pt-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-1.5 text-xs text-gray-500">
            <div className="mt-px shrink-0">
              <Icon
                icon={IconProp.Lock}
                className="h-3.5 w-3.5 text-gray-400"
              />
            </div>
            <p>{translate(RunbookTriggersCopy.keepPrivateCanReset)}</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              title={RunbookTriggersCopy.testButton}
              icon={IconProp.Play}
              buttonStyle={ButtonStyleType.NORMAL}
              buttonSize={ButtonSize.Small}
              dataTestId={RunbookTriggersTestIds.webhookTest}
              onClick={() => {
                setTestError("");
                setShowTestDialog(true);
              }}
            />
            <Button
              title={RunbookTriggersCopy.resetUrl}
              icon={IconProp.Refresh}
              buttonStyle={ButtonStyleType.DANGER_OUTLINE}
              buttonSize={ButtonSize.Small}
              dataTestId={RunbookTriggersTestIds.webhookReset}
              onClick={() => {
                setResetError("");
                setShowResetConfirmation(true);
              }}
            />
          </div>
        </div>
      </div>
    );
  };

  const getNotes: (item: Runbook) => ReactElement = (
    item: Runbook,
  ): ReactElement => {
    if (item.isEnabled === false) {
      return (
        <RunbookTriggerNote
          tone="warning"
          text={RunbookTriggersCopy.runbookOffWebhook}
          runbookId={props.runbookId}
        />
      );
    }

    if (!Array.isArray(item.steps) || item.steps.length === 0) {
      return (
        <RunbookTriggerNote
          tone="warning"
          text={RunbookTriggersCopy.noStepsWebhook}
          runbookId={props.runbookId}
        />
      );
    }

    return <></>;
  };

  const getTestResult: () => ReactElement = (): ReactElement => {
    if (testedExecutionId === null) {
      return <></>;
    }

    return (
      <div
        className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
        role="status"
        data-testid={RunbookTriggersTestIds.webhookTestResult}
      >
        <div className="shrink-0">
          <Icon
            icon={IconProp.CheckCircle}
            className="h-4 w-4 text-emerald-600"
          />
        </div>
        <span>{translate(RunbookTriggersCopy.testStarted)}</span>
        {testedExecutionId ? (
          <AppLink
            className="font-medium text-emerald-800 underline hover:text-emerald-900"
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUNBOOK_VIEW_EXECUTION] as Route,
              {
                modelId: props.runbookId,
                subModelId: new ObjectID(testedExecutionId),
              },
            )}
          >
            {translate(RunbookTriggersCopy.testViewRun)}
          </AppLink>
        ) : (
          <></>
        )}
      </div>
    );
  };

  const getBody: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return <ComponentLoader />;
    }

    if (error || !runbook) {
      return (
        <ErrorMessage
          message={error || "Item not found"}
          onRefreshClick={() => {
            void fetchRunbook();
          }}
        />
      );
    }

    return (
      <div className={ruledBodyClassName}>
        <div className="px-5 py-4 md:px-6">
          <ModelSwitchRow<Runbook>
            key={runbookIdString}
            modelType={Runbook}
            modelId={props.runbookId}
            column="isWebhookEnabled"
            initialValue={runbook.isWebhookEnabled === true}
            title={RunbookTriggersCopy.webhookSwitchTitle}
            getDescription={(switchIsOn: boolean): string => {
              return switchIsOn
                ? RunbookTriggersCopy.webhookSwitchOn
                : RunbookTriggersCopy.webhookSwitchOff;
            }}
            // Turning the webhook on runs the runbook; turning it off does not.
            lockedReason={
              !isOn && runLockedReason ? runLockedReason : undefined
            }
            onChange={(switchIsOn: boolean): void => {
              setIsOn(switchIsOn);

              if (!switchIsOn) {
                setTestedExecutionId(null);
              }
            }}
            onSaved={(switchIsOn: boolean): void => {
              setIsSavedOn(switchIsOn);
            }}
            dataTestId={RunbookTriggersTestIds.webhookSwitch}
          />
        </div>
        {isOn ? (
          <div className="space-y-4 border-t border-gray-200 px-5 py-4 md:px-6">
            {getNotes(runbook)}
            {getUrlPanel()}
          </div>
        ) : (
          <></>
        )}
      </div>
    );
  };

  return (
    <>
      <Card
        title={RunbookTriggersCopy.webhookCardTitle}
        description={RunbookTriggersCopy.webhookCardDescription}
      >
        <div data-testid={RunbookTriggersTestIds.webhookCard}>{getBody()}</div>
      </Card>

      {showResetConfirmation ? (
        <ConfirmModal
          title={RunbookTriggersCopy.resetConfirmTitle}
          description={RunbookTriggersCopy.resetConfirmDescription}
          submitButtonText={RunbookTriggersCopy.resetUrl}
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isResetting}
          error={resetError || undefined}
          onClose={() => {
            if (isResetting) {
              return;
            }

            setResetError("");
            setShowResetConfirmation(false);
          }}
          onSubmit={() => {
            void resetUrl().then((isReset: boolean) => {
              if (isReset) {
                setShowResetConfirmation(false);
              }
            });
          }}
        />
      ) : (
        <></>
      )}

      {showTestDialog ? (
        <BasicFormModal<TestFormValues>
          title={RunbookTriggersCopy.testTitle}
          name="Runbook > Triggers > Webhook test"
          description={RunbookTriggersCopy.testDescription}
          submitButtonText={RunbookTriggersCopy.testSubmit}
          isLoading={isTesting}
          error={testError || undefined}
          onClose={() => {
            setShowTestDialog(false);
            setTestError("");
          }}
          onSubmit={(values: TestFormValues) => {
            void sendTest(values);
          }}
          formProps={{
            id: "runbook-webhook-test-form",
            name: "Runbook > Triggers > Webhook test",
            initialValues: {
              body: JSON.stringify(
                JSON.parse(RUNBOOK_WEBHOOK_EXAMPLE_BODY),
                null,
                2,
              ),
            } as FormValues<TestFormValues>,
            fields: [
              {
                field: { body: true },
                title: RunbookTriggersCopy.testBodyTitle,
                fieldType: FormFieldSchemaType.JSON,
                required: false,
                customValidation: (
                  values: FormValues<TestFormValues>,
                ): string | null => {
                  return parseTestBody(String(values.body || ""))
                    ? null
                    : translate(RunbookTriggersCopy.testBodyNotJson);
                },
              },
            ],
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default RunbookWebhookCard;
