import WebsiteDownApi, {
  FirstCheckState,
  WebsiteDownMonitorRecord,
  WebsiteDownPolicyRecord,
  mayCreateMonitor,
} from "./WebsiteDownApi";
import {
  FirstCheckSentence,
  WEBSITE_DOWN_COPY,
  WEBSITE_DOWN_POLICY_NAME,
  WEBSITE_DOWN_SETUP,
  WEBSITE_DOWN_SETUP_GUIDE_DOCS_PATH,
  WebsiteAddress,
  WebsiteDownProgressFacts,
  WebsiteDownRunValue,
  WebsiteDownStep,
  WebsiteDownSummaryRow,
  WhoIsToldFacts,
  WhoIsToldMode,
  areWhoIsToldCountsKnown,
  describeFirstCheck,
  getIncidentSeverityId,
  getMonitorAddress,
  getWebsiteDownProgress,
  getWebsiteDownSummaryRows,
  getWhoIsToldMode,
  isWebsiteDownFinished,
  parseWebsiteAddress,
} from "./WebsiteDownSetup";
import GuidedSetupFrame, { GuidedSetupFrameStep } from "../GuidedSetupFrame";
import GuidedSetupRunStore, {
  GuidedSetupRun,
  getFirstOpenStepKey,
} from "../GuidedSetupProgress";
import AppLink from "../../AppLink/AppLink";
import OnCallTestPageApi from "../../OnCallTestPage/OnCallTestPageApi";
import SendTestPageButton from "../../OnCallTestPage/SendTestPageButton";
import TestPageResult, {
  getResultSentence,
} from "../../OnCallTestPage/TestPageResult";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  ServerEmail,
  cannotSendEmail,
  getAdminServerSetupUrl,
  useServerEmail,
} from "../../../Utils/ServerEmail";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import {
  OnCallTestPageResult,
  OnCallTestPageStatus,
} from "Common/Types/OnCallDutyPolicy/OnCallTestPage";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ButtonType from "Common/UI/Components/Button/ButtonTypes";
import CheckboxElement from "Common/UI/Components/Checkbox/Checkbox";
import Input from "Common/UI/Components/Input/Input";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import LazyPeoplePicker from "Common/UI/Components/PeoplePicker/LazyPeoplePicker";
import {
  PeoplePickerKind,
  PeoplePickerValue,
} from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import API from "Common/UI/Utils/API/API";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import UserUtil from "Common/UI/Utils/User";
import useTranslator from "Common/UI/Utils/UseTranslator";
import MonitorCheckScheduleUtil from "Common/Utils/Monitor/MonitorCheckScheduleUtil";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

/*
 * GUIDED SETUP: KNOW WHEN MY WEBSITE OR API IS DOWN (issue #6804), drawn
 * in GuidedSetupFrame. The rules and words are WebsiteDownSetup.ts; the
 * records WebsiteDownApi.ts.
 */

// How often the first check is asked for, and for how long.
export const FIRST_CHECK_POLL_INTERVAL_IN_MS: number = 5000;
export const FIRST_CHECK_POLL_LIMIT: number = 36;

export interface ComponentProps {
  // For tests: how often to ask for the first check.
  firstCheckPollIntervalInMs?: number | undefined;
}

interface SummaryExtras {
  incidentSeverityName: string | null;
  isMonitorOwner: boolean;
}

const routeOf: (page: PageMap, modelId?: string | undefined) => Route = (
  page: PageMap,
  modelId?: string | undefined,
): Route => {
  return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
    modelId: modelId,
  });
};

/*
 * Button keeps a dialog footer's margin (md:ml-3); a row of the step's
 * actions takes it back, so they line up with the words above.
 */
const ACTIONS_CLASS_NAME: string =
  "flex flex-wrap items-center gap-y-2 md:-ml-3";

const linkClassName: string =
  "text-sm font-medium text-indigo-600 hover:text-indigo-800 underline-offset-2 hover:underline";

const WebsiteDownGuidedSetup: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const serverEmail: ServerEmail = useServerEmail();
  const canSendEmail: boolean = !cannotSendEmail(serverEmail);
  const userId: string = UserUtil.getUserId()?.toString() || "";

  const store: GuidedSetupRunStore = useMemo(() => {
    return new GuidedSetupRunStore({
      setup: WEBSITE_DOWN_SETUP,
      projectId: ProjectUtil.getCurrentProjectId()?.toString() || "",
      userId: userId,
    });
  }, [userId]);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>("");
  const [run, setRun] = useState<GuidedSetupRun>({});
  const [monitor, setMonitor] = useState<WebsiteDownMonitorRecord | null>(null);
  const [check, setCheck] = useState<FirstCheckState | null>(null);
  const [whoFacts, setWhoFacts] = useState<WhoIsToldFacts | null>(null);
  const [policy, setPolicy] = useState<WebsiteDownPolicyRecord | null>(null);
  const [testResult, setTestResult] = useState<OnCallTestPageResult | null>(
    null,
  );
  const [openStepKey, setOpenStepKey] = useState<string | null>(
    WebsiteDownStep.Check,
  );
  const [summaryExtras, setSummaryExtras] = useState<SummaryExtras | null>(
    null,
  );

  // Step 1's form.
  const [addressText, setAddressText] = useState<string>("");
  const [isApi, setIsApi] = useState<boolean>(false);
  const [addressError, setAddressError] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string>("");
  // The address was one this person's monitor checks already (#7059).
  const [isExistingMonitor, setIsExistingMonitor] = useState<boolean>(false);

  // Step 2's people: you, to start with.
  const [people, setPeople] = useState<PeoplePickerValue>({
    [PeoplePickerKind.User]: userId ? [userId] : [],
  });
  const [peopleError, setPeopleError] = useState<string>("");
  // Save and continue found a policy made meanwhile elsewhere (#7059).
  const [isPolicyMadeElsewhere, setIsPolicyMadeElsewhere] =
    useState<boolean>(false);

  // Step 3.
  const [showNotReceivedHelp, setShowNotReceivedHelp] =
    useState<boolean>(false);

  const executionLogId: string =
    typeof run[WebsiteDownRunValue.TestExecutionLogId] === "string"
      ? (run[WebsiteDownRunValue.TestExecutionLogId] as string)
      : "";

  const facts: WebsiteDownProgressFacts = {
    hasMonitor: Boolean(monitor),
    isWhoIsToldDone:
      Boolean(policy) || run[WebsiteDownRunValue.WhoIsToldConfirmed] === true,
    testStatus: testResult?.status || null,
    isTestSkipped: run[WebsiteDownRunValue.TestSkipped] === true,
  };

  const progress: ReturnType<typeof getWebsiteDownProgress> =
    getWebsiteDownProgress(facts);

  // A policy this run made decides the step; otherwise the project's facts.
  const mode: WhoIsToldMode = policy
    ? WhoIsToldMode.CreatePolicy
    : whoFacts
      ? getWhoIsToldMode(whoFacts)
      : WhoIsToldMode.OwnerEmailOnly;

  const saveRun: (values: Record<string, string | boolean | null>) => void = (
    values: Record<string, string | boolean | null>,
  ): void => {
    setRun(store.save(values));
  };

  // Where a step leads once it is done: the next step not done, or the summary.
  const openNextStep: (doneKey: string) => void = (doneKey: string): void => {
    const next: string | null = getFirstOpenStepKey(
      progress.map((step: { key: string; isDone: boolean }) => {
        return step.key === doneKey ? { ...step, isDone: true } : step;
      }),
    );
    setOpenStepKey(next);
  };

  // Reads the run's records: what exists decides which step opens.
  useEffect(() => {
    let isActive: boolean = true;

    const load: () => Promise<void> = async (): Promise<void> => {
      const stored: GuidedSetupRun = store.read();
      let nextRun: GuidedSetupRun = stored;
      let loadedMonitor: WebsiteDownMonitorRecord | null = null;
      let loadedPolicy: WebsiteDownPolicyRecord | null = null;
      let loadedResult: OnCallTestPageResult | null = null;

      const monitorId: string | boolean | undefined =
        stored[WebsiteDownRunValue.MonitorId];

      if (typeof monitorId === "string") {
        loadedMonitor = await WebsiteDownApi.loadMonitor(monitorId).catch(
          () => {
            return null;
          },
        );

        if (!loadedMonitor) {
          // The monitor is gone: this run starts again.
          store.forget();
          nextRun = {};
        }
      }

      const policyId: string | boolean | undefined =
        nextRun[WebsiteDownRunValue.PolicyId];

      if (loadedMonitor && typeof policyId === "string") {
        loadedPolicy = await WebsiteDownApi.loadPolicy(policyId).catch(() => {
          return null;
        });

        if (!loadedPolicy) {
          nextRun = store.save({ [WebsiteDownRunValue.PolicyId]: null });
        }
      }

      const testId: string | boolean | undefined =
        nextRun[WebsiteDownRunValue.TestExecutionLogId];

      if (loadedMonitor && typeof testId === "string") {
        loadedResult = await OnCallTestPageApi.getResult(testId).catch(() => {
          return null;
        });
      }

      const loadedWhoFacts: WhoIsToldFacts =
        await WebsiteDownApi.loadWhoIsToldFacts();

      if (!isActive) {
        return;
      }

      setRun(nextRun);
      setMonitor(loadedMonitor);
      setPolicy(loadedPolicy);
      setTestResult(loadedResult);
      setWhoFacts(loadedWhoFacts);
      setOpenStepKey(
        getFirstOpenStepKey(
          getWebsiteDownProgress({
            hasMonitor: Boolean(loadedMonitor),
            isWhoIsToldDone:
              Boolean(loadedPolicy) ||
              nextRun[WebsiteDownRunValue.WhoIsToldConfirmed] === true,
            testStatus: loadedResult?.status || null,
            isTestSkipped: nextRun[WebsiteDownRunValue.TestSkipped] === true,
          }),
        ),
      );
      setIsLoading(false);
    };

    load().catch((err: Error) => {
      if (isActive) {
        setLoadError(API.getFriendlyMessage(err));
        setIsLoading(false);
      }
    });

    return () => {
      isActive = false;
    };
  }, [store]);

  // The first check: asked for until a probe answers.
  useEffect(() => {
    if (!monitor) {
      setCheck(null);
      return;
    }

    let isActive: boolean = true;
    let attempts: number = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const read: () => Promise<void> = async (): Promise<void> => {
      attempts++;
      let next: FirstCheckState | null = null;

      try {
        next = await WebsiteDownApi.loadFirstCheck(monitor.id);
      } catch {
        next = null;
      }

      if (!isActive) {
        return;
      }

      if (next) {
        setCheck(next);
      }

      const hasAnswer: boolean = Boolean(next && next.answers.length > 0);

      if (!hasAnswer && attempts < FIRST_CHECK_POLL_LIMIT) {
        timer = setTimeout(
          read,
          props.firstCheckPollIntervalInMs || FIRST_CHECK_POLL_INTERVAL_IN_MS,
        );
      }
    };

    void read();

    return () => {
      isActive = false;

      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [monitor?.id]);

  // The summary's facts, read once every step is done.
  useEffect(() => {
    if (openStepKey !== null || !monitor) {
      return;
    }

    let isActive: boolean = true;

    Promise.all([
      WebsiteDownApi.loadIncidentSeverityName(
        getIncidentSeverityId(monitor.monitorSteps),
      ),
      WebsiteDownApi.isMonitorOwner({ monitorId: monitor.id, userId: userId }),
    ])
      .then(([severityName, isOwner]: [string | null, boolean]) => {
        if (isActive) {
          setSummaryExtras({
            incidentSeverityName: severityName,
            isMonitorOwner: isOwner,
          });
        }
      })
      .catch(() => {
        if (isActive) {
          setSummaryExtras({
            incidentSeverityName: null,
            isMonitorOwner: false,
          });
        }
      });

    return () => {
      isActive = false;
    };
  }, [openStepKey, monitor?.id]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (loadError) {
    return <Alert type={AlertType.DANGER} title={loadError} />;
  }

  if (!monitor && !mayCreateMonitor()) {
    return (
      <div className="max-w-3xl" data-testid="guided-setup-not-allowed">
        <Alert
          type={AlertType.INFO}
          title={
            translator.translateText(WEBSITE_DOWN_COPY.cannotCreateMonitor) ||
            ""
          }
        />
        <div className="mt-4">
          <AppLink to={routeOf(PageMap.MONITORS)} className={linkClassName}>
            {translator.translateText("Go to Monitors") || ""}
          </AppLink>
        </div>
      </div>
    );
  }

  const host: string = monitor
    ? parseWebsiteAddress(getMonitorAddress(monitor.monitorSteps))?.host ||
      monitor.name
    : "";

  const checkSentence: FirstCheckSentence | null = monitor
    ? describeFirstCheck({
        translator: translator,
        host: host,
        locationCount: check?.locationCount ?? 0,
        answers: check?.answers || [],
      })
    : null;

  const emailWarning: ReactElement = canSendEmail ? (
    <></>
  ) : (
    <div className="mt-4" data-testid="guided-setup-no-email">
      <Alert
        type={AlertType.WARNING}
        title={
          translator.translateText(
            serverEmail.isMasterAdmin
              ? WEBSITE_DOWN_COPY.noEmailForAdmin
              : WEBSITE_DOWN_COPY.noEmail,
          ) || ""
        }
      />
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        <AppLink
          to={routeOf(PageMap.USER_SETTINGS_NOTIFICATION_METHODS)}
          className={linkClassName}
        >
          {translator.translateText(WEBSITE_DOWN_COPY.testMethodsLink) || ""}
        </AppLink>
        {serverEmail.isMasterAdmin ? (
          <a
            href={getAdminServerSetupUrl().toString()}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClassName}
            data-testid="guided-setup-set-up-email"
          >
            {translator.translateText(WEBSITE_DOWN_COPY.setUpEmail)}
          </a>
        ) : (
          <></>
        )}
      </div>
    </div>
  );

  /*
   * STEP 1: WHAT SHOULD WE CHECK?
   */
  const startChecking: () => Promise<void> = async (): Promise<void> => {
    const address: WebsiteAddress | null = parseWebsiteAddress(addressText);

    if (!address) {
      setAddressError(
        translator.translateText(WEBSITE_DOWN_COPY.addressError) || "",
      );
      return;
    }

    setAddressError("");
    setSaveError("");
    setIsSaving(true);

    try {
      /*
       * A monitor this person already has for the address is this run's:
       * a run the browser lost (a private window, another device) or a
       * start over makes no second one (#7059).
       */
      const existing: WebsiteDownMonitorRecord | null =
        await WebsiteDownApi.findOwnMonitor({
          address: address,
          userId: userId,
        });

      if (existing) {
        saveRun({ [WebsiteDownRunValue.MonitorId]: existing.id });
        setIsExistingMonitor(true);
        setMonitor(existing);
      } else {
        const monitorId: string = await WebsiteDownApi.createMonitor({
          address: address,
          isApi: isApi,
          translator: translator,
        });
        saveRun({ [WebsiteDownRunValue.MonitorId]: monitorId });
        setMonitor(await WebsiteDownApi.loadMonitor(monitorId));
      }
    } catch (err) {
      setSaveError(API.getFriendlyMessage(err));
    }

    setIsSaving(false);
  };

  /*
   * A monitor found rather than made says so first, then what its check
   * found. A name or host typed as one long word wraps inside the step.
   */
  const checkContent: ReactElement = monitor ? (
    <div className="space-y-4">
      {isExistingMonitor ? (
        <p
          className="break-words text-sm text-gray-500"
          data-testid="guided-setup-existing-monitor"
        >
          {translator.translateTemplate(WEBSITE_DOWN_COPY.existingMonitor, {
            name: monitor.name,
          })}
        </p>
      ) : (
        <></>
      )}
      <p
        className={`break-words text-sm ${
          checkSentence?.isDown ? "text-amber-700" : "text-gray-700"
        }`}
        data-testid="guided-setup-first-check"
        aria-live="polite"
      >
        {checkSentence?.text}
      </p>
      <div className={ACTIONS_CLASS_NAME}>
        <Button
          title={WEBSITE_DOWN_COPY.continueButton}
          buttonStyle={ButtonStyleType.PRIMARY}
          dataTestId="guided-setup-check-continue"
          onClick={() => {
            openNextStep(WebsiteDownStep.Check);
          }}
        />
      </div>
    </div>
  ) : (
    <form
      className="space-y-4"
      onSubmit={(event: React.FormEvent) => {
        event.preventDefault();
        void startChecking();
      }}
    >
      <p className="text-sm text-gray-500">
        {translator.translateText(WEBSITE_DOWN_COPY.checkHelp)}
      </p>
      <div>
        <label
          htmlFor="guided-setup-address"
          className="block text-sm font-medium text-gray-700"
        >
          {translator.translateText(WEBSITE_DOWN_COPY.addressLabel)}
        </label>
        <div className="mt-1">
          <Input
            id="guided-setup-address"
            value={addressText}
            placeholder={WEBSITE_DOWN_COPY.addressPlaceholder}
            onChange={(value: string) => {
              setAddressText(value);
              setAddressError("");
            }}
            error={addressError || undefined}
            autoFocus={true}
            disableSpellCheck={true}
            dataTestId="guided-setup-address"
          />
        </div>
      </div>
      <CheckboxElement
        title={WEBSITE_DOWN_COPY.isApiLabel}
        value={isApi}
        onChange={(value: boolean) => {
          setIsApi(value);
        }}
        dataTestId="guided-setup-is-api"
      />
      {saveError ? (
        <p role="alert" className="text-sm text-red-600">
          {saveError}
        </p>
      ) : (
        <></>
      )}
      <div className={ACTIONS_CLASS_NAME}>
        <Button
          title={WEBSITE_DOWN_COPY.startChecking}
          type={ButtonType.Submit}
          buttonStyle={ButtonStyleType.PRIMARY}
          isLoading={isSaving}
          dataTestId="guided-setup-start-checking"
        />
        {/* A server, a port, a heartbeat: Create Monitor has every type. */}
        <AppLink
          to={routeOf(PageMap.MONITOR_CREATE)}
          className={`${linkClassName} md:ml-4`}
          dataTestId="guided-setup-other-types"
        >
          {translator.translateText("More monitor types") || ""}
        </AppLink>
      </div>
    </form>
  );

  /*
   * STEP 2: WHO SHOULD BE TOLD?
   */
  const pickedUserIds: Array<string> = people[PeoplePickerKind.User] || [];
  const pickedTeamIds: Array<string> = people[PeoplePickerKind.Team] || [];

  const saveWhoIsTold: () => Promise<void> = async (): Promise<void> => {
    setSaveError("");

    if (mode !== WhoIsToldMode.CreatePolicy || policy) {
      if (!policy) {
        saveRun({ [WebsiteDownRunValue.WhoIsToldConfirmed]: true });
      }
      openNextStep(WebsiteDownStep.WhoIsTold);
      return;
    }

    if (pickedUserIds.length + pickedTeamIds.length === 0) {
      setPeopleError(
        translator.translateText(WEBSITE_DOWN_COPY.whoNobodyPicked) || "",
      );
      return;
    }

    setIsSaving(true);

    try {
      /*
       * Asked again before the policy is made: another tab or device may
       * have made the project's first one since this page read it. Then the
       * project's own policies decide, the step says why, and nothing is
       * made twice (#7059). Counts that cannot be read now make nothing on
       * a guess: the step stays open to try again.
       */
      const latestFacts: WhoIsToldFacts =
        await WebsiteDownApi.loadWhoIsToldFacts();

      if (!areWhoIsToldCountsKnown(latestFacts)) {
        setSaveError(
          translator.translateText(WEBSITE_DOWN_COPY.couldNotSave) || "",
        );
        setIsSaving(false);
        return;
      }

      const latestMode: WhoIsToldMode = getWhoIsToldMode(latestFacts);

      if (latestMode !== WhoIsToldMode.CreatePolicy) {
        setWhoFacts(latestFacts);
        setIsPolicyMadeElsewhere(latestMode === WhoIsToldMode.ExistingPolicy);
        setIsSaving(false);
        return;
      }

      const policyId: string = await WebsiteDownApi.createPolicy({
        userIds: pickedUserIds,
        teamIds: pickedTeamIds,
      });
      saveRun({ [WebsiteDownRunValue.PolicyId]: policyId });
      setPolicy(
        (await WebsiteDownApi.loadPolicy(policyId)) || {
          id: policyId,
          name: WEBSITE_DOWN_POLICY_NAME,
          responders: [],
        },
      );
      openNextStep(WebsiteDownStep.WhoIsTold);
    } catch (err) {
      setSaveError(API.getFriendlyMessage(err));
    }

    setIsSaving(false);
  };

  const whoDoneLine: string = policy
    ? policy.responders.length > 0
      ? translator.translateTemplate('"{{policy}}" pages {{people}}.', {
          policy: policy.name,
          people: policy.responders.join(", "),
        })
      : translator.translateTemplate('"{{policy}}" pages its responders.', {
          policy: policy.name,
        })
    : mode === WhoIsToldMode.ExistingPolicy
      ? translator.translateText(
          "This project's on-call policies and rules decide who is paged.",
        ) || ""
      : translator.translateText("You are emailed as the monitor's owner.") ||
        "";

  const whoContent: ReactElement = (
    <div className="space-y-4">
      {policy ? (
        <p className="text-sm text-gray-700">{whoDoneLine}</p>
      ) : mode === WhoIsToldMode.CreatePolicy ? (
        <>
          <p className="text-sm text-gray-500">
            {translator.translateText(WEBSITE_DOWN_COPY.whoCreateHelp)}
          </p>
          <div>
            <p
              id="guided-setup-people-label"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              {translator.translateText(WEBSITE_DOWN_COPY.whoPeopleLabel)}
            </p>
            <LazyPeoplePicker
              kinds={[PeoplePickerKind.User, PeoplePickerKind.Team]}
              value={people}
              onChange={(value: PeoplePickerValue) => {
                setPeople(value);
                setPeopleError("");
              }}
              addButtonText={WEBSITE_DOWN_COPY.whoAddPeople}
              error={peopleError || undefined}
              ariaLabelledby="guided-setup-people-label"
              dataTestId="guided-setup-people"
            />
          </div>
          <p className="text-sm text-gray-500">
            {translator.translateTemplate(
              WEBSITE_DOWN_COPY.whoCreatePolicyNote,
              {
                policy: WEBSITE_DOWN_POLICY_NAME,
              },
            )}
          </p>
        </>
      ) : (
        <>
          {isPolicyMadeElsewhere && mode === WhoIsToldMode.ExistingPolicy ? (
            <p
              className="text-sm text-gray-500"
              data-testid="guided-setup-policy-made-elsewhere"
            >
              {translator.translateText(WEBSITE_DOWN_COPY.policyMadeElsewhere)}
            </p>
          ) : (
            <></>
          )}
          <p
            className="text-sm text-gray-700"
            data-testid="guided-setup-who-help"
          >
            {translator.translateText(
              mode === WhoIsToldMode.ExistingPolicy
                ? WEBSITE_DOWN_COPY.whoExistingHelp
                : WEBSITE_DOWN_COPY.whoOwnerOnlyHelp,
            )}
          </p>
          {mode === WhoIsToldMode.ExistingPolicy ? (
            <AppLink
              to={routeOf(PageMap.INCIDENTS_SETTINGS_ON_CALL_RULES)}
              className={linkClassName}
            >
              {translator.translateText(WEBSITE_DOWN_COPY.whoOnCallRulesLink) ||
                ""}
            </AppLink>
          ) : (
            <></>
          )}
        </>
      )}
      {emailWarning}
      {saveError ? (
        <p role="alert" className="text-sm text-red-600">
          {saveError}
        </p>
      ) : (
        <></>
      )}
      <div className={ACTIONS_CLASS_NAME}>
        <Button
          title={
            mode === WhoIsToldMode.CreatePolicy && !policy
              ? WEBSITE_DOWN_COPY.whoSave
              : WEBSITE_DOWN_COPY.continueButton
          }
          buttonStyle={ButtonStyleType.PRIMARY}
          isLoading={isSaving}
          dataTestId="guided-setup-who-continue"
          onClick={() => {
            void saveWhoIsTold();
          }}
        />
      </div>
    </div>
  );

  /*
   * STEP 3: SEND A TEST.
   */
  const onTestResult: (result: OnCallTestPageResult) => void = (
    result: OnCallTestPageResult,
  ): void => {
    setTestResult(result);
  };

  const isAcknowledged: boolean =
    testResult?.status === OnCallTestPageStatus.Acknowledged;

  const skipTest: ReactElement = (
    <Button
      title={WEBSITE_DOWN_COPY.testSkip}
      buttonStyle={ButtonStyleType.LINK}
      dataTestId="guided-setup-skip-test"
      onClick={() => {
        saveRun({ [WebsiteDownRunValue.TestSkipped]: true });
        setOpenStepKey(null);
      }}
    />
  );

  const testContent: ReactElement = (
    <div className="space-y-4">
      {executionLogId ? (
        <TestPageResult
          executionLogId={executionLogId}
          onResult={onTestResult}
        />
      ) : (
        <p className="text-sm text-gray-500">
          {translator.translateText(WEBSITE_DOWN_COPY.testHelp)}
        </p>
      )}
      {executionLogId ? <></> : emailWarning}
      {isAcknowledged ? (
        <div className={ACTIONS_CLASS_NAME}>
          <Button
            title={WEBSITE_DOWN_COPY.continueButton}
            buttonStyle={ButtonStyleType.PRIMARY}
            dataTestId="guided-setup-test-continue"
            onClick={() => {
              setOpenStepKey(null);
            }}
          />
        </div>
      ) : (
        <div className={ACTIONS_CLASS_NAME}>
          <SendTestPageButton
            target={{ kind: "self" }}
            title={
              executionLogId ? WEBSITE_DOWN_COPY.testSendAnother : undefined
            }
            buttonStyle={
              executionLogId ? ButtonStyleType.NORMAL : ButtonStyleType.PRIMARY
            }
            onSent={(id: string) => {
              setTestResult(null);
              setShowNotReceivedHelp(false);
              saveRun({
                [WebsiteDownRunValue.TestExecutionLogId]: id,
                [WebsiteDownRunValue.TestSkipped]: null,
              });
            }}
            onResult={onTestResult}
          />
          {executionLogId ? (
            <Button
              title={WEBSITE_DOWN_COPY.testDidNotGetIt}
              buttonStyle={ButtonStyleType.NORMAL}
              dataTestId="guided-setup-did-not-get-it"
              onClick={() => {
                setShowNotReceivedHelp(true);
              }}
            />
          ) : (
            <></>
          )}
          {skipTest}
        </div>
      )}
      {showNotReceivedHelp && !isAcknowledged ? (
        <div className="space-y-2" data-testid="guided-setup-not-received">
          <p className="text-sm text-gray-700">
            {translator.translateText(WEBSITE_DOWN_COPY.testDidNotGetItHelp)}
          </p>
          <AppLink
            to={routeOf(PageMap.USER_SETTINGS_NOTIFICATION_METHODS)}
            className={linkClassName}
          >
            {translator.translateText(WEBSITE_DOWN_COPY.testMethodsLink) || ""}
          </AppLink>
          {emailWarning}
        </div>
      ) : (
        <></>
      )}
    </div>
  );

  const steps: Array<GuidedSetupFrameStep> = [
    {
      ...progress[0]!,
      title: WEBSITE_DOWN_COPY.checkTitle,
      doneLine: checkSentence?.text || monitor?.name,
      content: checkContent,
    },
    {
      ...progress[1]!,
      title: WEBSITE_DOWN_COPY.whoTitle,
      doneLine: whoDoneLine,
      content: whoContent,
    },
    {
      ...progress[2]!,
      title: WEBSITE_DOWN_COPY.testTitle,
      doneLine:
        isAcknowledged && testResult
          ? getResultSentence(translator, testResult)
          : translator.translateText("Skipped") || "",
      content: testContent,
    },
  ];

  /*
   * THE SUMMARY.
   */
  const summaryRows: Array<WebsiteDownSummaryRow> =
    monitor && summaryExtras
      ? getWebsiteDownSummaryRows(translator, {
          monitorName: monitor.name,
          intervalText: MonitorCheckScheduleUtil.describeInterval(
            monitor.monitoringInterval,
            translator,
          ),
          locationCount: check?.locationCount ?? 0,
          incidentSeverityName: summaryExtras.incidentSeverityName,
          mode: mode,
          policyName: policy?.name || null,
          policyResponders: policy?.responders || [],
          isMonitorOwner: summaryExtras.isMonitorOwner,
          canSendEmail: canSendEmail,
          testResult: testResult,
          testResultSentence: testResult
            ? getResultSentence(translator, testResult)
            : null,
        })
      : [];

  const summary: ReactElement = (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="text-lg font-semibold text-gray-900">
        {translator.translateTemplate(WEBSITE_DOWN_COPY.summaryTitle, {
          name: monitor?.name || host,
        })}
      </h2>
      <dl className="mt-4 divide-y divide-gray-100">
        {summaryRows.map((row: WebsiteDownSummaryRow) => {
          return (
            <div
              key={row.key}
              className="py-3 sm:grid sm:grid-cols-4 sm:gap-4"
              data-testid={`guided-setup-summary-${row.key}`}
            >
              <dt className="text-sm font-medium text-gray-900">{row.label}</dt>
              <dd className="mt-1 text-sm text-gray-700 sm:col-span-3 sm:mt-0">
                {row.text}
              </dd>
            </div>
          );
        })}
      </dl>
      <h3 className="mt-5 text-sm font-semibold text-gray-900">
        {translator.translateText(WEBSITE_DOWN_COPY.summaryNext)}
      </h3>
      <ul className="mt-2 space-y-1">
        <li>
          {/*
           * The status page guided setup (#6806), which lists this monitor
           * to pick.
           */}
          <AppLink
            to={routeOf(PageMap.STATUS_PAGES_GUIDED_SETUP)}
            className={linkClassName}
          >
            {translator.translateText(WEBSITE_DOWN_COPY.nextStatusPage) || ""}
          </AppLink>
        </li>
        <li>
          <AppLink
            to={routeOf(PageMap.USER_SETTINGS_NOTIFICATION_METHODS)}
            className={linkClassName}
          >
            {translator.translateText(WEBSITE_DOWN_COPY.nextPhone) || ""}
          </AppLink>
        </li>
        {monitor ? (
          <li>
            <AppLink
              to={routeOf(PageMap.MONITOR_VIEW, monitor.id)}
              className={linkClassName}
            >
              {translator.translateText(WEBSITE_DOWN_COPY.nextMonitor) || ""}
            </AppLink>
          </li>
        ) : (
          <></>
        )}
      </ul>
      <div className={`mt-5 ${ACTIONS_CLASS_NAME}`}>
        <Button
          title={WEBSITE_DOWN_COPY.startOver}
          buttonStyle={ButtonStyleType.NORMAL}
          icon={IconProp.Add}
          dataTestId="guided-setup-start-over"
          onClick={() => {
            store.forget();
            setRun({});
            setMonitor(null);
            setPolicy(null);
            setTestResult(null);
            setSummaryExtras(null);
            setAddressText("");
            setIsApi(false);
            setIsExistingMonitor(false);
            setIsPolicyMadeElsewhere(false);
            setShowNotReceivedHelp(false);
            setOpenStepKey(WebsiteDownStep.Check);
            // The project may have a policy now: who is told is asked afresh.
            WebsiteDownApi.loadWhoIsToldFacts()
              .then(setWhoFacts)
              .catch(() => {
                setWhoFacts(null);
              });
          }}
        />
      </div>
    </div>
  );

  return (
    <GuidedSetupFrame
      setup={WEBSITE_DOWN_SETUP}
      steps={steps}
      openStepKey={openStepKey}
      onOpenStep={(key: string) => {
        setSaveError("");
        setOpenStepKey(key);
      }}
      summary={summary}
      isFinished={isWebsiteDownFinished(facts)}
      guideDocsPath={WEBSITE_DOWN_SETUP_GUIDE_DOCS_PATH}
    />
  );
};

export default WebsiteDownGuidedSetup;
