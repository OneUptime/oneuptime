import WebsiteDownApi, {
  FirstCheckState,
  WebsiteDownFoundMonitor,
  WebsiteDownMonitorRecord,
  WebsiteDownOtherMonitor,
  WebsiteDownPolicyRecord,
  isPaymentRequired,
  mayAddPaymentMethod,
  mayAddToStatusPage,
  mayCreateMonitor,
  mayUseOnCallSetup,
} from "./WebsiteDownApi";
import {
  FirstCheckSentence,
  WEBSITE_DOWN_COPY,
  WEBSITE_DOWN_SETUP,
  WEBSITE_DOWN_SETUP_GUIDE_DOCS_PATH,
  WEBSITE_DOWN_TERMS,
  WebsiteAddress,
  WebsiteDownProgressFacts,
  WebsiteDownRunValue,
  WebsiteDownStatusPageChoice,
  WebsiteDownStep,
  WebsiteDownSummaryRow,
  WhoIsToldFacts,
  WhoIsToldMode,
  areWhoIsToldCountsKnown,
  describeFirstCheck,
  getCheckHelpTemplate,
  getIncidentSeverityId,
  getMonitorAddress,
  getOtherMonitorSentence,
  getPagedByPhonePage,
  getPaymentNeededText,
  getStatusPageShownSentence,
  getWebsiteDownProgress,
  getWebsiteDownSummaryRows,
  getWhoIsToldDoneLine,
  getWhoIsToldHelp,
  getWhoIsToldMode,
  hasStatusPageStep,
  isFirstCheckSettled,
  isStatusPageSetupOffered,
  isWebsiteDownFinished,
  parseWebsiteAddress,
} from "./WebsiteDownSetup";
import { mayCreateStatusPage } from "../StatusPage/StatusPageSetupApi";
import GlossaryTerm from "Common/Types/Docs/GlossaryTerm";
import DefinedTerm from "Common/UI/Components/Glossary/DefinedTerm";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import { STATUS_PAGE_URL } from "Common/UI/Config";
import {
  GuidedSetupEntryPoint,
  withGuidedSetupEntryPoint,
} from "Common/UI/Utils/GuidedSetupEvents";
import GuidedSetupFrame, { GuidedSetupFrameStep } from "../GuidedSetupFrame";
import GuidedSetupRunStore, {
  GuidedSetupRun,
  getFirstOpenStepKey,
} from "../GuidedSetupProgress";
import AppLink from "../../AppLink/AppLink";
import MonitorWhoIsToldCard, {
  WhoIsToldCardVariant,
  WhoIsToldPlace,
} from "../../Monitor/Overview/MonitorWhoIsToldCard";
import WhoIsToldApi from "../../Monitor/Overview/WhoIsToldApi";
import { getWhoIsToldToldSentences } from "../../Monitor/Overview/WhoIsToldWords";
import { WhoIsToldResult } from "Common/Types/Monitor/WhoIsTold";
import ObjectID from "Common/Types/ObjectID";
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
import {
  WELCOME_STEP_MINUTES,
  WelcomeStep,
} from "Common/Types/WelcomeChecklist/WelcomeChecklist";
import IconProp from "Common/Types/Icon/IconProp";
import {
  OnCallTestPageResult,
  OnCallTestPageStatus,
} from "Common/Types/OnCallDutyPolicy/OnCallTestPage";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ButtonType from "Common/UI/Components/Button/ButtonTypes";
import CheckboxElement from "Common/UI/Components/Checkbox/Checkbox";
import Icon from "Common/UI/Components/Icon/Icon";
import Input from "Common/UI/Components/Input/Input";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import LazyPeoplePicker from "Common/UI/Components/PeoplePicker/LazyPeoplePicker";
import {
  PeoplePickerKind,
  PeoplePickerValue,
} from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import API from "Common/UI/Utils/API/API";
import ProjectUtil from "Common/UI/Utils/Project";
import { PluralTemplate, Translator } from "Common/UI/Utils/TranslateTemplate";
import UserUtil from "Common/UI/Utils/User";
import useTranslator from "Common/UI/Utils/UseTranslator";
import MonitorCheckScheduleUtil from "Common/Utils/Monitor/MonitorCheckScheduleUtil";
import {
  getFirstOnCallPolicyName,
  getSetupPolicyGone,
  isSetupPolicyInService,
  SetupPolicyGone,
} from "Common/Utils/GuidedSetup/OnCallPolicyRecords";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ErrorInSentence } from "Common/UI/Components/ErrorMessage/ErrorSentence";

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
  /*
   * Who the monitor tells, as its overview's When this goes down says it
   * (#7055): read for a project whose own rules decide who is paged. Null
   * when it was not read, or could not be.
   */
  whoIsTold: WhoIsToldResult | null;
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
 * A row of the step's actions, lined up with the words above: the row's gap
 * spaces them (a Button has no margin of its own).
 */
const ACTIONS_CLASS_NAME: string = "flex flex-wrap items-center gap-3";

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
  /*
   * Cloud's Free plan with no payment method: the server would refuse the
   * monitor, so the step says so before Start checking (#7367).
   */
  const [needsPayment, setNeedsPayment] = useState<boolean>(false);
  /*
   * Start checking was pressed and refused for want of one: the calm note
   * beside the button says so louder (#8897).
   */
  const [isPaymentRefused, setIsPaymentRefused] = useState<boolean>(false);
  /*
   * Whether this person owns the run's monitor, read from the records (the
   * setup makes them one when the server does not, #7409). Null until read.
   */
  const [isOwner, setIsOwner] = useState<boolean | null>(null);
  /*
   * How many locations a monitor made now would be checked from, read when
   * step 1 is the one to do (#7461). Null until read, or when it cannot be.
   */
  const [locationCount, setLocationCount] = useState<number | null>(null);
  /*
   * A monitor this person may read but did not make checks the address
   * typed (#7254): said, with the way to open it or make one's own, until
   * the address changes.
   */
  const [otherMonitor, setOtherMonitor] =
    useState<WebsiteDownOtherMonitor | null>(null);

  // Step 2's people: you, to start with.
  const [people, setPeople] = useState<PeoplePickerValue>({
    [PeoplePickerKind.User]: userId ? [userId] : [],
  });
  const [peopleError, setPeopleError] = useState<string>("");
  // Save and continue found a policy made meanwhile elsewhere (#7059).
  const [isPolicyMadeElsewhere, setIsPolicyMadeElsewhere] =
    useState<boolean>(false);
  /*
   * The policy this run made was deleted (#8235) or archived (#8432) - in
   * another tab, or by a teammate - so "Who should be told?" is open
   * again, and says which.
   */
  const [policyGone, setPolicyGone] = useState<SetupPolicyGone | null>(null);

  // Step 3.
  const [showNotReceivedHelp, setShowNotReceivedHelp] =
    useState<boolean>(false);

  /*
   * Step 4 (#7053): the project's status pages, read when the page opens
   * for someone who may put a monitor on one; the one that shows the
   * monitor, read from the records; and the one picked.
   */
  const [statusPages, setStatusPages] = useState<
    Array<WebsiteDownStatusPageChoice>
  >([]);
  const [statusPageShowing, setStatusPageShowing] =
    useState<WebsiteDownStatusPageChoice | null>(null);
  const [pickedStatusPageId, setPickedStatusPageId] = useState<string>("");

  const executionLogId: string =
    typeof run[WebsiteDownRunValue.TestExecutionLogId] === "string"
      ? (run[WebsiteDownRunValue.TestExecutionLogId] as string)
      : "";

  // The run walks step 4 only where it can be done (#7053).
  const walksStatusPageStep: boolean = hasStatusPageStep({
    mayAddToStatusPage: mayAddToStatusPage(),
    statusPages: statusPages,
  });

  const facts: WebsiteDownProgressFacts = {
    hasMonitor: Boolean(monitor),
    isWhoIsToldDone:
      Boolean(policy) || run[WebsiteDownRunValue.WhoIsToldConfirmed] === true,
    testStatus: testResult?.status || null,
    isTestSkipped: run[WebsiteDownRunValue.TestSkipped] === true,
    hasStatusPageStep: walksStatusPageStep,
    isOnStatusPage: Boolean(statusPageShowing),
    isStatusPageSkipped: run[WebsiteDownRunValue.StatusPageSkipped] === true,
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
      let runPolicyGone: SetupPolicyGone | null = null;

      const monitorId: string | boolean | undefined =
        stored[WebsiteDownRunValue.MonitorId];

      /*
       * A read that fails is the page's error, as the project's other reads
       * are: the run is never forgotten, nor its monitor or policy taken for
       * gone, because the server could not be reached (#8235). A record
       * that is gone, or that this person may no longer read, reads as
       * null.
       */
      if (typeof monitorId === "string") {
        loadedMonitor = await WebsiteDownApi.loadMonitor(monitorId);

        if (!loadedMonitor) {
          // The monitor is gone: this run starts again.
          store.forget();
          nextRun = {};
        }
      }

      const policyId: string | boolean | undefined =
        nextRun[WebsiteDownRunValue.PolicyId];

      if (loadedMonitor && typeof policyId === "string") {
        loadedPolicy = await WebsiteDownApi.loadPolicy(policyId);
        runPolicyGone = getSetupPolicyGone(loadedPolicy);

        if (runPolicyGone) {
          /*
           * The policy is gone, or archived and paging no one (#8432): who
           * is told is set up again, saying why.
           */
          nextRun = store.save({ [WebsiteDownRunValue.PolicyId]: null });
          loadedPolicy = null;
        }
      }

      const testId: string | boolean | undefined =
        nextRun[WebsiteDownRunValue.TestExecutionLogId];

      if (loadedMonitor && typeof testId === "string") {
        loadedResult = await OnCallTestPageApi.getResult(testId).catch(() => {
          return null;
        });
      }

      const mayAddPage: boolean = mayAddToStatusPage();

      const [
        loadedWhoFacts,
        loadedIsOwner,
        loadedNeedsPayment,
        loadedLocationCount,
        loadedStatusPages,
      ]: [
        WhoIsToldFacts,
        boolean | null,
        boolean,
        number | null,
        Array<WebsiteDownStatusPageChoice>,
      ] = await Promise.all([
        WebsiteDownApi.loadWhoIsToldFacts(),
        loadedMonitor
          ? WebsiteDownApi.isMonitorOwner({
              monitorId: loadedMonitor.id,
              userId: userId,
            })
          : Promise.resolve(null),
        // Step 1 is the one to do: is a payment method needed first?
        loadedMonitor
          ? Promise.resolve(false)
          : WebsiteDownApi.needsPaymentMethod(),
        // And from how many locations it would be checked (#7461).
        loadedMonitor
          ? Promise.resolve(null)
          : WebsiteDownApi.loadDefaultLocationCount(),
        /*
         * Step 4's status pages (#7053), for someone who may put a monitor
         * on one. A read that fails offers no step 4, as no page would.
         */
        mayAddPage
          ? WebsiteDownApi.loadStatusPages().catch(() => {
              return [];
            })
          : Promise.resolve([]),
      ]);

      // Whether a page shows the run's monitor already, the run's page first.
      const runStatusPageId: string | boolean | undefined =
        nextRun[WebsiteDownRunValue.StatusPageId];
      const loadedShowing: WebsiteDownStatusPageChoice | null =
        loadedMonitor && loadedStatusPages.length > 0
          ? await WebsiteDownApi.findStatusPageShowing({
              monitorId: loadedMonitor.id,
              statusPages: loadedStatusPages,
              preferredStatusPageId:
                typeof runStatusPageId === "string"
                  ? runStatusPageId
                  : undefined,
            }).catch(() => {
              return null;
            })
          : null;

      if (!isActive) {
        return;
      }

      setRun(nextRun);
      setIsOwner(loadedIsOwner);
      setNeedsPayment(loadedNeedsPayment);
      setLocationCount(loadedLocationCount);
      setMonitor(loadedMonitor);
      setPolicy(loadedPolicy);
      setPolicyGone(runPolicyGone);
      setTestResult(loadedResult);
      setWhoFacts(loadedWhoFacts);
      setStatusPages(loadedStatusPages);
      setStatusPageShowing(loadedShowing);
      setPickedStatusPageId(
        loadedShowing?.id || loadedStatusPages[0]?.id || "",
      );
      setOpenStepKey(
        getFirstOpenStepKey(
          getWebsiteDownProgress({
            hasMonitor: Boolean(loadedMonitor),
            isWhoIsToldDone:
              Boolean(loadedPolicy) ||
              nextRun[WebsiteDownRunValue.WhoIsToldConfirmed] === true,
            testStatus: loadedResult?.status || null,
            isTestSkipped: nextRun[WebsiteDownRunValue.TestSkipped] === true,
            hasStatusPageStep: hasStatusPageStep({
              mayAddToStatusPage: mayAddPage,
              statusPages: loadedStatusPages,
            }),
            isOnStatusPage: Boolean(loadedShowing),
            isStatusPageSkipped:
              nextRun[WebsiteDownRunValue.StatusPageSkipped] === true,
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

      /*
       * Asked again until every location that checks it has answered: with
       * one answer in, what the rest find decides whether an incident
       * opens (#7410).
       */
      const isSettled: boolean = Boolean(next && isFirstCheckSettled(next));

      if (!isSettled && attempts < FIRST_CHECK_POLL_LIMIT) {
        timer = setTimeout(
          read,
          props.firstCheckPollIntervalInMs || FIRST_CHECK_POLL_INTERVAL_IN_MS,
        );
      }
    };

    // Nothing is read for this monitor yet: "Checking", never "No location".
    setCheck(null);
    void read();

    return () => {
      isActive = false;

      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [monitor?.id]);

  /*
   * Back from adding a payment method in another tab: asked again, so the
   * step stops asking for one as soon as the project has it (#7367).
   */
  useEffect(() => {
    if (!needsPayment || monitor) {
      return;
    }

    let isActive: boolean = true;

    const askAgain: () => void = (): void => {
      void WebsiteDownApi.needsPaymentMethod().then((value: boolean) => {
        if (isActive) {
          setNeedsPayment(value);
        }
      });
    };

    window.addEventListener("focus", askAgain);

    return () => {
      isActive = false;
      window.removeEventListener("focus", askAgain);
    };
  }, [needsPayment, monitor?.id]);

  // The summary's facts, read once every step is done.
  useEffect(() => {
    if (openStepKey !== null || !monitor) {
      return;
    }

    let isActive: boolean = true;

    /*
     * A project whose own policies and rules decide who is paged: who they
     * page, from the resolver the monitor's overview reads (#7055). A read
     * that fails leaves the summary's general sentence.
     */
    const whoIsToldRead: Promise<WhoIsToldResult | null> =
      mode === WhoIsToldMode.ExistingPolicy
        ? WhoIsToldApi.getForMonitor({
            monitorId: new ObjectID(monitor.id),
          }).catch(() => {
            return null;
          })
        : Promise.resolve(null);

    Promise.all([
      WebsiteDownApi.loadIncidentSeverityName(
        getIncidentSeverityId(monitor.monitorSteps),
      ),
      WebsiteDownApi.isMonitorOwner({ monitorId: monitor.id, userId: userId }),
      whoIsToldRead,
    ])
      .then(
        ([severityName, isOwner, whoIsTold]: [
          string | null,
          boolean,
          WhoIsToldResult | null,
        ]) => {
          if (isActive) {
            setSummaryExtras({
              incidentSeverityName: severityName,
              isMonitorOwner: isOwner,
              whoIsTold: whoIsTold,
            });
          }
        },
      )
      .catch(() => {
        if (isActive) {
          setSummaryExtras({
            incidentSeverityName: null,
            isMonitorOwner: false,
            whoIsTold: null,
          });
        }
      });

    return () => {
      isActive = false;
    };
  }, [openStepKey, monitor?.id, mode]);

  if (isLoading) {
    return <PageSkeleton />;
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
        // Until the first read returns, it is checking: never "no location".
        isRead: check !== null,
        locationCount: check?.locationCount ?? 0,
        activeLocationCount: check?.activeLocationCount,
        answers: check?.answers || [],
        minimumProbeAgreement: monitor.minimumProbeAgreement,
        opensIncident: getIncidentSeverityId(monitor.monitorSteps) !== null,
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
  /*
   * `makesOwn`: "Create my own monitor", pressed once a teammate's monitor
   * for the address was said (#7254) - the person's own, made beside it.
   */
  const startChecking: (options?: {
    makesOwn?: boolean | undefined;
  }) => Promise<void> = async (options?: {
    makesOwn?: boolean | undefined;
  }): Promise<void> => {
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
      let existing: WebsiteDownMonitorRecord | null =
        await WebsiteDownApi.findOwnMonitor({
          address: address,
          userId: userId,
        });

      /*
       * Then the project's monitors this person may read (#7254): one a
       * teammate made, or the API, Terraform or an import, is said before
       * anything is made - never taken over, and never one the server
       * keeps from them. One of their own that their read missed is theirs.
       */
      if (!existing && !options?.makesOwn) {
        const other: WebsiteDownFoundMonitor | null =
          await WebsiteDownApi.findOtherMonitor({
            address: address,
            userId: userId,
          });

        if (other?.isOwn) {
          existing = other.record;
        } else if (other) {
          setOtherMonitor({
            id: other.id,
            name: other.name,
            creatorName: other.creatorName,
          });
          setIsSaving(false);
          return;
        }
      }

      setOtherMonitor(null);

      const monitorId: string = existing
        ? existing.id
        : await WebsiteDownApi.createMonitor({
            address: address,
            isApi: isApi,
            translator: translator,
          });

      saveRun({ [WebsiteDownRunValue.MonitorId]: monitorId });
      setNeedsPayment(false);

      /*
       * The person setting this up owns the monitor, so the next step's
       * "you are emailed when it goes down" holds - a master admin too,
       * whom the server never makes the owner of what they create (#7409).
       */
      setIsOwner(
        await WebsiteDownApi.ensureMonitorOwner({
          monitorId: monitorId,
          userId: userId,
        }),
      );

      /*
       * A monitor of theirs that a status page shows already makes step 4
       * done (#7053): nothing is added twice.
       */
      if (statusPages.length > 0) {
        const showing: WebsiteDownStatusPageChoice | null =
          await WebsiteDownApi.findStatusPageShowing({
            monitorId: monitorId,
            statusPages: statusPages,
          }).catch(() => {
            return null;
          });

        setStatusPageShowing(showing);

        if (showing) {
          setPickedStatusPageId(showing.id);
        }
      }

      if (existing) {
        setIsExistingMonitor(true);
        setMonitor(existing);
      } else {
        setMonitor(await WebsiteDownApi.loadMonitor(monitorId));
      }
    } catch (err) {
      if (isPaymentRequired(err)) {
        // Said with where to add one, not as the server's line in red (#7367).
        setNeedsPayment(true);
        setIsPaymentRefused(true);
      } else {
        setSaveError(API.getFriendlyMessage(err));
      }
    }

    setIsSaving(false);
  };

  /*
   * Before Start checking, on Cloud's Free plan with no payment method
   * (#7367). The truth, said calmly where it applies (#8897): right above
   * the button it is about, after the address it would check - not as a
   * warning over the field, the first thing the person met on the page. A
   * press refused for want of one says it louder, as the alert it now is.
   */
  const paymentNotice: ReactElement = needsPayment ? (
    <div
      data-testid="guided-setup-payment-needed"
      data-refused={isPaymentRefused ? "true" : "false"}
      role={isPaymentRefused ? "alert" : undefined}
      className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${
        isPaymentRefused
          ? "border-amber-200 bg-amber-50 text-amber-900"
          : "border-gray-200 bg-gray-50 text-gray-700"
      }`}
    >
      <Icon
        icon={IconProp.CreditCard}
        className={`mt-0.5 h-4 w-4 flex-none ${
          isPaymentRefused ? "text-amber-600" : "text-gray-400"
        }`}
      />
      <div className="min-w-0">
        <p>
          {getPaymentNeededText({
            translator: translator,
            mayAddPaymentMethod: mayAddPaymentMethod(),
          })}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {mayAddPaymentMethod() ? (
            /*
             * In a new tab: the address typed here stays, and the step asks
             * again when the person comes back to it.
             */
            <a
              href={routeOf(PageMap.SETTINGS_BILLING).toString()}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClassName}
              data-testid="guided-setup-add-payment-method"
            >
              {translator.translateText(WEBSITE_DOWN_COPY.addPaymentMethod)}
            </a>
          ) : (
            <></>
          )}
          <button
            type="button"
            className={linkClassName}
            data-testid="guided-setup-check-payment-again"
            onClick={() => {
              setIsPaymentRefused(false);
              void WebsiteDownApi.needsPaymentMethod().then(setNeedsPayment);
            }}
          >
            {translator.translateText(WEBSITE_DOWN_COPY.checkPaymentAgain)}
          </button>
        </div>
      </div>
    </div>
  ) : (
    <></>
  );

  // Step 1's help: the number of locations once read (#7461).
  const checkHelp: {
    template: string | PluralTemplate;
    count?: number | undefined;
  } = getCheckHelpTemplate(locationCount);

  /*
   * A monitor this person may read but did not make checks the address
   * (#7254): its name, who made it when the records say, and the two ways
   * on, under the address it is about. A polite live region: Start
   * checking made nothing, and a screen reader hears why.
   */
  const otherMonitorNotice: ReactElement = otherMonitor ? (
    <div
      className="space-y-1 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3"
      data-testid="guided-setup-other-monitor"
      aria-live="polite"
    >
      <p
        className="break-words text-sm text-gray-700"
        data-testid="guided-setup-other-monitor-sentence"
      >
        {getOtherMonitorSentence({
          translator: translator,
          monitorName: otherMonitor.name,
          creatorName: otherMonitor.creatorName,
        })}
      </p>
      <p className="text-sm text-gray-500">
        {translator.translateText(WEBSITE_DOWN_COPY.otherMonitorChoice)}
      </p>
    </div>
  ) : (
    <></>
  );

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
      {/*
       * What the answers mean under the probe agreement rule, a line of its
       * own (#7410): the line above can end with a probe's reason as it
       * wrote it.
       */}
      {checkSentence?.verdict ? (
        <p
          className="break-words text-sm text-gray-700"
          data-testid="guided-setup-first-check-verdict"
          aria-live="polite"
        >
          {checkSentence.verdict}
        </p>
      ) : (
        <></>
      )}
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
      {/*
       * How often, from how many locations (#7461), and when an incident
       * opens - the Glossary's monitor and incident marked, the first time
       * the setup uses them (#7057).
       */}
      <p
        className="text-sm text-gray-500"
        data-testid="guided-setup-check-help"
      >
        <TranslatedSentence
          template={checkHelp.template}
          count={checkHelp.count}
          slots={{
            monitor: (
              <DefinedTerm term={GlossaryTerm.Monitor}>
                {translator.translateText(WEBSITE_DOWN_TERMS.monitor)}
              </DefinedTerm>
            ),
            incident: (
              <DefinedTerm term={GlossaryTerm.Incident}>
                {translator.translateText(WEBSITE_DOWN_TERMS.incident)}
              </DefinedTerm>
            ),
          }}
        />
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
              // What was found was the address typed before (#7254).
              setOtherMonitor(null);
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
      {otherMonitorNotice}
      {saveError ? (
        <p role="alert" className="text-sm text-red-600">
          <ErrorInSentence message={saveError} showWhereToLook={true} />
        </p>
      ) : (
        <></>
      )}
      {paymentNotice}
      <div className={ACTIONS_CLASS_NAME}>
        {otherMonitor ? (
          /*
           * A monitor this person did not make checks the address
           * (#7254): open it, or make their own beside it. Neither is
           * pressed for them, so neither is primary.
           */
          <>
            <Button
              title={WEBSITE_DOWN_COPY.createOwnMonitor}
              buttonStyle={ButtonStyleType.NORMAL}
              isLoading={isSaving}
              dataTestId="guided-setup-create-own-monitor"
              onClick={() => {
                void startChecking({ makesOwn: true });
              }}
            />
            <a
              href={routeOf(PageMap.MONITOR_VIEW, otherMonitor.id).toString()}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClassName}
              data-testid="guided-setup-open-other-monitor"
            >
              {translator.translateText(WEBSITE_DOWN_COPY.nextMonitor)}
            </a>
          </>
        ) : (
          <>
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
          </>
        )}
      </div>
    </form>
  );

  /*
   * STEP 2: WHO SHOULD BE TOLD?
   */
  const pickedUserIds: Array<string> = people[PeoplePickerKind.User] || [];
  const pickedTeamIds: Array<string> = people[PeoplePickerKind.Team] || [];

  /*
   * THE RUN'S POLICY WAS DELETED OR ARCHIVED - in another tab, or by a
   * teammate - while this page was open (#8235, #8432). Its done line and
   * the summary said '"Default on-call policy" pages Ana Lopez.' of a
   * policy that pages nobody, and only a reload noticed: an archived policy
   * is still there, but incidents and alerts that use it skip it. The run
   * forgets it, as the page does when it opens on a policy that is gone;
   * the project's policies are counted again (or, uncountable, the counts
   * read before stand: they were read before the run made its policy), and
   * "Who should be told?" opens on what decides who is told now, saying
   * why first. `policyAsRead` is the policy as just read: null when
   * deleted.
   */
  const forgetGonePolicy: (
    policyAsRead: WebsiteDownPolicyRecord | null,
  ) => Promise<void> = async (
    policyAsRead: WebsiteDownPolicyRecord | null,
  ): Promise<void> => {
    const latestFacts: WhoIsToldFacts =
      await WebsiteDownApi.loadWhoIsToldFacts();

    setRun(store.save({ [WebsiteDownRunValue.PolicyId]: null }));
    setPolicy(null);
    setWhoFacts(
      areWhoIsToldCountsKnown(latestFacts) || !whoFacts
        ? latestFacts
        : whoFacts,
    );
    setIsPolicyMadeElsewhere(false);
    setPolicyGone(getSetupPolicyGone(policyAsRead) || SetupPolicyGone.Deleted);
    setOpenStepKey(WebsiteDownStep.WhoIsTold);
  };

  /*
   * The run's policy read again just before a step that says it pages
   * people moves on: Continue on "Who should be told?", and the test
   * step's Continue and Skip, which open the summary (#8235). The test
   * goes to the person setting this up, not to the policy, so it never
   * notices the policy is gone. Gone or archived (#8432): forgotten, and
   * step 2 opens again; null. Unreadable: the step says why and stays;
   * null. Read: the policy as it is now - who it pages may have changed
   * too.
   */
  const readRunPolicyAgain: (
    policyId: string,
  ) => Promise<WebsiteDownPolicyRecord | null> = async (
    policyId: string,
  ): Promise<WebsiteDownPolicyRecord | null> => {
    let latest: WebsiteDownPolicyRecord | null = null;

    try {
      latest = await WebsiteDownApi.loadPolicy(policyId);
    } catch (err) {
      setSaveError(API.getFriendlyMessage(err));
      return null;
    }

    if (!isSetupPolicyInService(latest)) {
      await forgetGonePolicy(latest);
      return null;
    }

    setPolicy(latest);
    return latest;
  };

  const saveWhoIsTold: () => Promise<void> = async (): Promise<void> => {
    setSaveError("");

    if (mode !== WhoIsToldMode.CreatePolicy || policy) {
      if (policy) {
        setIsSaving(true);
        const latest: WebsiteDownPolicyRecord | null = await readRunPolicyAgain(
          policy.id,
        );
        setIsSaving(false);

        if (!latest) {
          return;
        }
      } else {
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

      // Named in the reader's language, and its two rules too (#7995).
      const policyId: string = await WebsiteDownApi.createPolicy({
        userIds: pickedUserIds,
        teamIds: pickedTeamIds,
        translator: translator,
      });
      saveRun({ [WebsiteDownRunValue.PolicyId]: policyId });
      setPolicyGone(null);
      setPolicy(
        (await WebsiteDownApi.loadPolicy(policyId)) || {
          id: policyId,
          name: getFirstOnCallPolicyName(translator),
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
    : getWhoIsToldDoneLine({
        translator: translator,
        mode: mode,
        isMonitorOwner: isOwner,
      });

  // Who is told without a policy of this run: as the owner, only when they are.
  const whoHelp: string | null = getWhoIsToldHelp({
    mode: mode,
    isMonitorOwner: isOwner,
  });

  /*
   * Why the step is open again with no policy of the run's: the one it made
   * was deleted (#8235), or archived and pages no one (#8432) - each said
   * in a sentence of its own. Said first, in the step's polite live region.
   */
  const policyGoneLine: ReactElement =
    policyGone && !policy ? (
      <p
        className="text-sm text-gray-700"
        data-testid={
          policyGone === SetupPolicyGone.Archived
            ? "guided-setup-policy-archived"
            : "guided-setup-policy-deleted"
        }
      >
        {translator.translateText(
          policyGone === SetupPolicyGone.Archived
            ? WEBSITE_DOWN_COPY.policyArchived
            : WEBSITE_DOWN_COPY.policyDeleted,
        )}
      </p>
    ) : (
      <></>
    );

  const whoContent: ReactElement = (
    <div className="space-y-4">
      {/*
       * What decides who is told, and why that changed, said first: a
       * polite live region that is on the page whichever way the step
       * stands, so a screen reader hears why Continue led back here rather
       * than nothing at all (#8235). The picker and the buttons are not in
       * it.
       */}
      <div
        className="space-y-4"
        aria-live="polite"
        data-testid="guided-setup-who-region"
      >
        {policyGoneLine}
        {policy ? (
          <p
            className="text-sm text-gray-700"
            data-testid="guided-setup-who-done-line"
          >
            {whoDoneLine}
          </p>
        ) : mode === WhoIsToldMode.CreatePolicy ? (
          <p
            className="text-sm text-gray-500"
            data-testid="guided-setup-who-create-help"
          >
            {/*
             * How to Reach Me is a link to the person's own (#7757), in a
             * new tab, so the setup keeps its place and its people.
             */}
            <TranslatedSentence
              template={WEBSITE_DOWN_COPY.whoCreateHelp}
              slots={{
                howToReachMe: (
                  <a
                    href={routeOf(
                      PageMap.USER_SETTINGS_ON_CALL_RULES,
                    ).toString()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={linkClassName}
                    data-testid="guided-setup-how-to-reach-me"
                  >
                    {translator.translateText(WEBSITE_DOWN_TERMS.howToReachMe)}
                  </a>
                ),
              }}
            />
          </p>
        ) : (
          <>
            {isPolicyMadeElsewhere && mode === WhoIsToldMode.ExistingPolicy ? (
              <p
                className="text-sm text-gray-500"
                data-testid="guided-setup-policy-made-elsewhere"
              >
                {translator.translateText(
                  WEBSITE_DOWN_COPY.policyMadeElsewhere,
                )}
              </p>
            ) : (
              <></>
            )}
            {whoHelp ? (
              <p
                className="text-sm text-gray-700"
                data-testid="guided-setup-who-help"
              >
                {translator.translateText(whoHelp)}
              </p>
            ) : (
              <></>
            )}
          </>
        )}
      </div>
      {policy ? (
        <></>
      ) : mode === WhoIsToldMode.CreatePolicy ? (
        <>
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
          <p
            className="text-sm text-gray-500"
            data-testid="guided-setup-who-policy-note"
          >
            {/* The Glossary's on-call policy, marked where first met (#7057). */}
            <TranslatedSentence
              template={WEBSITE_DOWN_COPY.whoCreatePolicyNote}
              values={{
                // The name it will be made with, in the reader's language.
                policy: getFirstOnCallPolicyName(translator),
              }}
              slots={{
                onCallPolicy: (
                  <DefinedTerm term={GlossaryTerm.OnCallPolicy}>
                    {translator.translateText(WEBSITE_DOWN_TERMS.onCallPolicy)}
                  </DefinedTerm>
                ),
              }}
            />
          </p>
        </>
      ) : (
        <>
          {/*
           * A project that pages people already: who its rules page for
           * this monitor, and what would stop them (#7055) - the monitor's
           * own When this goes down, its fixes opening in a new tab.
           */}
          {mode === WhoIsToldMode.ExistingPolicy && monitor ? (
            <MonitorWhoIsToldCard
              monitorId={new ObjectID(monitor.id)}
              place={WhoIsToldPlace.GuidedSetup}
              variant={WhoIsToldCardVariant.Section}
            />
          ) : (
            <></>
          )}
        </>
      )}
      {emailWarning}
      {saveError ? (
        <p role="alert" className="text-sm text-red-600">
          <ErrorInSentence message={saveError} showWhereToLook={true} />
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

  /*
   * Continue and Skip open the summary, which says who the run's policy
   * pages: it is read again first (#8235). Gone, there is nothing true to
   * sum up, and "Who should be told?" opens again instead; unreadable, the
   * step says why and stays.
   */
  const finishTestStep: (skipped: boolean) => Promise<void> = async (
    skipped: boolean,
  ): Promise<void> => {
    setSaveError("");

    if (policy) {
      setIsSaving(true);
      const latest: WebsiteDownPolicyRecord | null = await readRunPolicyAgain(
        policy.id,
      );
      setIsSaving(false);

      if (!latest) {
        return;
      }
    }

    if (skipped) {
      saveRun({ [WebsiteDownRunValue.TestSkipped]: true });
    }

    // Step 4 where the run walks it and it is not done (#7053), or the summary.
    openNextStep(WebsiteDownStep.Test);
  };

  /*
   * STEP 4: SHOW IT TO CUSTOMERS? (#7053) The monitor goes on the page
   * picked, as the status page setup puts one on (never twice), and the
   * summary says which page shows it; or "Not now".
   */
  const pickedStatusPage: WebsiteDownStatusPageChoice | undefined =
    statusPages.find((page: WebsiteDownStatusPageChoice): boolean => {
      return page.id === pickedStatusPageId;
    }) || statusPages[0];

  const addToStatusPage: () => Promise<void> = async (): Promise<void> => {
    if (!monitor || !pickedStatusPage) {
      return;
    }

    setSaveError("");
    setIsSaving(true);

    try {
      await WebsiteDownApi.addToStatusPage({
        statusPageId: pickedStatusPage.id,
        monitorId: monitor.id,
        monitorName: monitor.name,
      });
      saveRun({
        [WebsiteDownRunValue.StatusPageId]: pickedStatusPage.id,
        [WebsiteDownRunValue.StatusPageSkipped]: null,
      });
      setStatusPageShowing(pickedStatusPage);
      openNextStep(WebsiteDownStep.StatusPage);
    } catch (err) {
      setSaveError(API.getFriendlyMessage(err));
    }

    setIsSaving(false);
  };

  const statusPageOptions: Array<DropdownOption> = statusPages.map(
    (page: WebsiteDownStatusPageChoice): DropdownOption => {
      // A page's name as the project wrote it.
      return { value: page.id, label: page.name, isUserContent: true };
    },
  );

  const statusPageContent: ReactElement = (
    <div className="space-y-4">
      <p className="break-words text-sm text-gray-500">
        {translator.translateTemplate(
          WEBSITE_DOWN_COPY.statusPageHelp,
          { name: monitor?.name || host },
          { setsValuesApart: true },
        )}
      </p>
      <div>
        <label
          htmlFor="guided-setup-status-page"
          className="block text-sm font-medium text-gray-700"
        >
          {translator.translateText(WEBSITE_DOWN_COPY.statusPageLabel)}
        </label>
        <div className="mt-1">
          <Dropdown
            inputId="guided-setup-status-page"
            dataTestId="guided-setup-status-page"
            options={statusPageOptions}
            value={statusPageOptions.find((option: DropdownOption) => {
              return option.value === pickedStatusPage?.id;
            })}
            isClearable={false}
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              if (typeof value === "string") {
                setPickedStatusPageId(value);
              }
            }}
          />
        </div>
      </div>
      {saveError ? (
        <p role="alert" className="text-sm text-red-600">
          <ErrorInSentence message={saveError} showWhereToLook={true} />
        </p>
      ) : (
        <></>
      )}
      <div className={ACTIONS_CLASS_NAME}>
        <Button
          title={WEBSITE_DOWN_COPY.statusPageAdd}
          buttonStyle={ButtonStyleType.PRIMARY}
          isLoading={isSaving}
          dataTestId="guided-setup-status-page-add"
          onClick={() => {
            void addToStatusPage();
          }}
        />
        <Button
          title={WEBSITE_DOWN_COPY.statusPageNotNow}
          buttonStyle={ButtonStyleType.LINK}
          dataTestId="guided-setup-status-page-not-now"
          onClick={() => {
            setSaveError("");
            saveRun({ [WebsiteDownRunValue.StatusPageSkipped]: true });
            openNextStep(WebsiteDownStep.StatusPage);
          }}
        />
      </div>
    </div>
  );

  const skipTest: ReactElement = (
    <Button
      title={WEBSITE_DOWN_COPY.testSkip}
      buttonStyle={ButtonStyleType.LINK}
      dataTestId="guided-setup-skip-test"
      onClick={() => {
        void finishTestStep(true);
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
      {saveError ? (
        <p role="alert" className="text-sm text-red-600">
          <ErrorInSentence message={saveError} showWhereToLook={true} />
        </p>
      ) : (
        <></>
      )}
      {isAcknowledged ? (
        <div className={ACTIONS_CLASS_NAME}>
          <Button
            title={WEBSITE_DOWN_COPY.continueButton}
            buttonStyle={ButtonStyleType.PRIMARY}
            isLoading={isSaving}
            dataTestId="guided-setup-test-continue"
            onClick={() => {
              void finishTestStep(false);
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
      outcome: WEBSITE_DOWN_COPY.checkOutcome,
      doneLine: checkSentence?.text || monitor?.name,
      content: checkContent,
    },
    {
      ...progress[1]!,
      title: WEBSITE_DOWN_COPY.whoTitle,
      outcome: WEBSITE_DOWN_COPY.whoOutcome,
      doneLine: whoDoneLine,
      content: whoContent,
    },
    {
      ...progress[2]!,
      title: WEBSITE_DOWN_COPY.testTitle,
      outcome: WEBSITE_DOWN_COPY.testOutcome,
      doneLine:
        isAcknowledged && testResult
          ? getResultSentence(translator, testResult)
          : translator.translateText("Skipped") || "",
      content: testContent,
    },
  ];

  // Step 4, where the run walks it (#7053).
  if (walksStatusPageStep && progress[3]) {
    steps.push({
      ...progress[3],
      title: WEBSITE_DOWN_COPY.statusPageTitle,
      outcome: WEBSITE_DOWN_COPY.statusPageOutcome,
      doneLine: statusPageShowing
        ? getStatusPageShownSentence(translator, statusPageShowing.name)
        : translator.translateText(WEBSITE_DOWN_COPY.statusPageNotNow) || "",
      content: statusPageContent,
    });
  }

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
          activeLocationCount: check?.activeLocationCount,
          minimumProbeAgreement: monitor.minimumProbeAgreement,
          incidentSeverityName: summaryExtras.incidentSeverityName,
          mode: mode,
          policyName: policy?.name || null,
          policyResponders: policy?.responders || [],
          isMonitorOwner: summaryExtras.isMonitorOwner,
          whoIsToldSentences: summaryExtras.whoIsTold
            ? getWhoIsToldToldSentences(summaryExtras.whoIsTold, translator)
            : null,
          canSendEmail: canSendEmail,
          testResult: testResult,
          testResultSentence: testResult
            ? getResultSentence(translator, testResult)
            : null,
          statusPageName: statusPageShowing?.name || null,
        })
      : [];

  /*
   * WHAT NEXT, each only for whoever may do it. A status page: the one
   * that shows the monitor, at its link; else, while the project has none
   * to add it to, the status page guided setup with this monitor ticked
   * (#7053). Paging by SMS or phone: the on-call guided setup (#7370).
   */
  const statusPageSetupRoute: Route | null =
    monitor &&
    isStatusPageSetupOffered({
      hasStatusPageStep: walksStatusPageStep,
      mayCreateStatusPage: mayCreateStatusPage(),
    })
      ? new Route(
          withGuidedSetupEntryPoint(
            `${routeOf(PageMap.STATUS_PAGES_GUIDED_SETUP).toString()}?monitorId=${monitor.id}`,
            GuidedSetupEntryPoint.WebsiteDownSummary,
          ),
        )
      : null;

  const pagedByPhonePage: PageMap = getPagedByPhonePage(mayUseOnCallSetup());
  const pagedByPhoneRoute: Route =
    pagedByPhonePage === PageMap.ON_CALL_DUTY_GUIDED_SETUP
      ? new Route(
          withGuidedSetupEntryPoint(
            routeOf(pagedByPhonePage).toString(),
            GuidedSetupEntryPoint.WebsiteDownSummary,
          ),
        )
      : routeOf(pagedByPhonePage);

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
        {statusPageShowing ? (
          <li>
            {/* The page that shows it, as its customers open it (#7053). */}
            <a
              href={`${STATUS_PAGE_URL.toString()}/${statusPageShowing.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClassName}
              data-testid="guided-setup-next-open-status-page"
            >
              {translator.translateText(WEBSITE_DOWN_COPY.nextOpenStatusPage)}
            </a>
          </li>
        ) : statusPageSetupRoute ? (
          <li>
            {/*
             * The status page guided setup (#6806), with this monitor
             * ticked: the project has no status page to add it to yet.
             */}
            <AppLink
              to={statusPageSetupRoute}
              className={linkClassName}
              dataTestId="guided-setup-next-status-page"
            >
              {translator.translateText(WEBSITE_DOWN_COPY.nextStatusPage) || ""}
            </AppLink>
          </li>
        ) : (
          <></>
        )}
        <li>
          {/*
           * The on-call guided setup turns SMS and calls on, adds balance on
           * Cloud and verifies the number on one page (#7370): for whoever
           * may use it. Anyone else adds a number to their methods.
           */}
          <AppLink
            to={pagedByPhoneRoute}
            className={linkClassName}
            dataTestId="guided-setup-next-phone"
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
            setPolicyGone(null);
            setShowNotReceivedHelp(false);
            setIsOwner(null);
            setOtherMonitor(null);
            setStatusPageShowing(null);
            setOpenStepKey(WebsiteDownStep.Check);
            // The project may have a policy now: who is told is asked afresh.
            WebsiteDownApi.loadWhoIsToldFacts()
              .then(setWhoFacts)
              .catch(() => {
                setWhoFacts(null);
              });
            // And whether a new monitor needs a payment method first.
            void WebsiteDownApi.needsPaymentMethod().then(setNeedsPayment);
            // From how many locations it would be checked (#7461).
            void WebsiteDownApi.loadDefaultLocationCount().then(
              setLocationCount,
            );
            /*
             * And the status pages step 4 offers (#7053): the project may
             * have one now, made from the summary's link.
             */
            if (mayAddToStatusPage()) {
              WebsiteDownApi.loadStatusPages()
                .then((pages: Array<WebsiteDownStatusPageChoice>) => {
                  setStatusPages(pages);
                  setPickedStatusPageId(pages[0]?.id || "");
                })
                .catch(() => {
                  setStatusPages([]);
                });
            }
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
      minutes={WELCOME_STEP_MINUTES[WelcomeStep.Monitor]}
    />
  );
};

export default WebsiteDownGuidedSetup;
