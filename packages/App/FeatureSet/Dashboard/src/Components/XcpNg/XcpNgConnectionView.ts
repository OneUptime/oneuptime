import XcpNgConnection from "Common/Models/DatabaseModels/XcpNgConnection";
import XcpNgConnectionTest from "Common/Models/DatabaseModels/XcpNgConnectionTest";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import XcpNgCollectionErrorCode, {
  XcpNgCollectionErrorAdvice,
  XcpNgCollectionErrorUtil,
} from "Common/Types/XcpNg/XcpNgCollectionError";
import XcpNgCollectionMethod from "Common/Types/XcpNg/XcpNgCollectionMethod";
import XcpNgCollectionStatus from "Common/Types/XcpNg/XcpNgCollectionStatus";
import XcpNgConnectionTestStatus from "Common/Types/XcpNg/XcpNgConnectionTestStatus";
import XcpNgConnectionType, {
  XcpNgConnectionTypeUtil,
} from "Common/Types/XcpNg/XcpNgConnectionType";
import {
  XcpNgApiTokenSummary,
  XcpNgCollectionSummary,
  XcpNgPoolSummary,
  XcpNgPresentedCertificate,
  XcpNgXapiAccountSummary,
} from "Common/Types/XcpNg/XcpNgProbeCollection";
import XcpNgXapiAccountKind from "Common/Types/XcpNg/XcpNgXapiAccount";
import { CardSelectOption } from "Common/UI/Components/CardSelect/CardSelect";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { formatList } from "Common/Types/Translator";
import {
  Translator,
  translatableTerm,
  translateText,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import {
  ClaimDue,
  ClaimDueState,
  readClaimDue,
} from "Common/Utils/Probe/ClaimDueTime";
import VMwareCertificateFingerprint from "Common/Utils/VMware/VMwareCertificateFingerprint";
import XcpNgConnectionAddress, {
  XcpNgAddressResult,
} from "Common/Utils/XcpNg/XcpNgConnectionAddress";
import {
  XCP_NG_API_TOKEN_WARNING_DAYS,
  DEFAULT_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES,
} from "Common/Utils/XcpNg/XcpNgCollectionSettings";
import {
  XcpNgCollectionStop,
  XcpNgCollectionStopFacts,
  getXcpNgCollectionStop,
} from "Common/Utils/XcpNg/XcpNgCollectionStop";
import { getProbeCollectionDescription } from "../Probe/ProbeCollectionDescription";

/*
 * What the Dashboard says about an XCP-ng connection a probe reads (#10996,
 * #10999) - a Xen Orchestra and every pool it manages, or one pool's XAPI -
 * as plain values, free of React, so the pages and the tests read the same
 * answers: where a connection test stands, how the last read went and the
 * one thing that fixes it, what its API token or its XAPI account may do,
 * and how a pool is read.
 *
 * A vCenter's (VMware/VMwareProbeCollectionView), sentence for sentence
 * where the words are the same, so they read as one product - and are
 * translated once. Every sentence is looked up whole, in the reader's
 * language, through the translator the caller hands in.
 */

// ?connect=1 on the Connections page opens Connect (the Pools page links so).
export const XCP_NG_CONNECT_QUERY_PARAM: string = "connect";

// How often a page asks again while a test or a first read is pending.
export const XCP_NG_TEST_POLL_INTERVAL_IN_MS: number = 2000;
export const XCP_NG_STATUS_POLL_INTERVAL_IN_MS: number = 10000;

/*
 * How long the Dashboard waits for a test before it stops asking: the
 * server answers an abandoned test within its pickup and run timeouts
 * (90 s + 150 s), so this is only reached when the server stopped
 * answering too.
 */
export const XCP_NG_TEST_MAX_WAIT_IN_MS: number = 5 * 60 * 1000;

/*
 * How long a connection can stay due before it is said that no probe has
 * come for it. A probe asks every ten seconds, and a read still running
 * holds the next one back for at most its time budget of five minutes, and
 * its upload for a few more. Past that, nothing is asking: the probe is
 * offline, or too old to read XCP-ng.
 */
export const XCP_NG_COLLECTION_OVERDUE_AFTER_IN_MS: number = 20 * 60 * 1000;

function readType(value: unknown): XcpNgConnectionType | null {
  return XcpNgConnectionTypeUtil.isValid(value) ? value : null;
}

// "Xen Orchestra", or "Pool master (XAPI)": how a connection's kind is named.
export function getXcpNgConnectionTypeLabel(
  type: XcpNgConnectionType | string | null | undefined,
  translator: Translator,
): string {
  return readType(type) === XcpNgConnectionType.Xapi
    ? (translator.translateText("Pool master (XAPI)") as string)
    : (translator.translateText("Xen Orchestra") as string);
}

// The choice Connect starts with.
export function getXcpNgConnectionTypeOptions(): Array<CardSelectOption> {
  return [
    {
      value: XcpNgConnectionType.XenOrchestra,
      title: translationKey("Xen Orchestra"),
      description: translationKey(
        "Every pool Xen Orchestra manages, read through its OpenMetrics plugin. One connection for all of them.",
      ),
      icon: IconProp.XcpNg,
    },
    {
      value: XcpNgConnectionType.Xapi,
      title: translationKey("A pool without Xen Orchestra"),
      description: translationKey(
        "One pool, read straight from XAPI on its master with the pool's own account. One connection per pool.",
      ),
      icon: IconProp.ServerStack,
    },
  ];
}

/*
 * What was read, as short phrases a person scans: "2 pools", "5 hosts (4
 * running)", "40 VMs (31 running)", "6 storage repositories".
 */
export function getXcpNgInventoryPhrases(
  summary: XcpNgCollectionSummary | null | undefined,
  translator: Translator,
): Array<string> {
  if (!summary || !Array.isArray(summary.pools)) {
    return [];
  }

  const pools: Array<XcpNgPoolSummary> = summary.pools;
  const sum: (read: (pool: XcpNgPoolSummary) => number) => number = (
    read: (pool: XcpNgPoolSummary) => number,
  ): number => {
    return pools.reduce((total: number, pool: XcpNgPoolSummary): number => {
      const value: number = read(pool);
      return total + (Number.isFinite(value) ? value : 0);
    }, 0);
  };

  const phrases: Array<string> = [];

  if (summary.connectionType !== XcpNgConnectionType.Xapi) {
    phrases.push(
      translator.translatePlural(
        { one: "{{count}} XCP-ng pool", other: "{{count}} XCP-ng pools" },
        pools.length,
      ),
    );
  }

  phrases.push(
    translator.translatePlural(
      {
        one: "{{count}} host ({{running}} running)",
        other: "{{count}} hosts ({{running}} running)",
      },
      sum((pool: XcpNgPoolSummary) => {
        return pool.hostCount;
      }),
      {
        running: translator.formatNumber(
          sum((pool: XcpNgPoolSummary) => {
            return pool.runningHostCount;
          }),
        ),
      },
    ),
    translator.translatePlural(
      {
        one: "{{count}} VM ({{running}} running)",
        other: "{{count}} VMs ({{running}} running)",
      },
      sum((pool: XcpNgPoolSummary) => {
        return pool.vmCount;
      }),
      {
        running: translator.formatNumber(
          sum((pool: XcpNgPoolSummary) => {
            return pool.runningVmCount;
          }),
        ),
      },
    ),
    translator.translatePlural(
      {
        one: "{{count}} storage repository",
        other: "{{count}} storage repositories",
      },
      sum((pool: XcpNgPoolSummary) => {
        return pool.storageRepositoryCount;
      }),
    ),
  );

  return phrases;
}

// The pools' names as XCP-ng names them, or their UUID's first part.
export function getXcpNgPoolNames(
  summary: XcpNgCollectionSummary | null | undefined,
): Array<string> {
  if (!summary || !Array.isArray(summary.pools)) {
    return [];
  }

  return summary.pools.map((pool: XcpNgPoolSummary): string => {
    return (pool.poolName || "").trim() || pool.poolId.split("-")[0] || "";
  });
}

// What a pool's master runs, from its own answer: "XCP-ng 8.3.0".
export function getXcpNgProductLine(
  summary: XcpNgCollectionSummary | null | undefined,
): string | null {
  if (!summary) {
    return null;
  }

  return (
    [summary.productName || "", summary.productVersion || ""]
      .filter(Boolean)
      .join(" ") || null
  );
}

export enum XcpNgConnectionTestPhase {
  Waiting = "Waiting",
  Running = "Running",
  Succeeded = "Succeeded",
  Failed = "Failed",
}

export enum XcpNgNoticeTone {
  Info = "Info",
  Warning = "Warning",
  Danger = "Danger",
}

export interface XcpNgNotice {
  tone: XcpNgNoticeTone;
  title: string;
  nextStep: string | null;
}

export interface XcpNgConnectionTestView {
  phase: XcpNgConnectionTestPhase;
  title: string;
  message: string | null;
  nextStep: string | null;
  inventory: Array<string>;
  poolNames: Array<string>;
  // What the API token or the XAPI account may do, when it needs saying.
  notices: Array<XcpNgNotice>;
  // The certificate presented, when trusting it fixes the test.
  certificate: XcpNgPresentedCertificate | null;
}

function getAdviceOf(code: unknown): XcpNgCollectionErrorAdvice {
  return XcpNgCollectionErrorUtil.getAdvice(
    XcpNgCollectionErrorUtil.isValid(code)
      ? code
      : XcpNgCollectionErrorCode.Internal,
  );
}

/*
 * What an XAPI account may do, when that needs saying. XAPI's roles apply
 * to Active Directory users only: root, the one local account, may change
 * everything in the pool, so it is said - with the way to a read-only one.
 */
export function getXcpNgAccountNotice(
  account: XcpNgXapiAccountSummary | null | undefined,
  translator: Translator,
): XcpNgNotice | null {
  if (!account) {
    return null;
  }

  if (account.kind === XcpNgXapiAccountKind.Root) {
    return {
      tone: XcpNgNoticeTone.Warning,
      title: translator.translateText(
        "Signed in as root, which can change everything in this pool.",
      ) as string,
      nextStep: translator.translateText(
        "XAPI has no read-only local account. For read-only access, join the pool to Active Directory, give a user the read-only role, and sign in as that user.",
      ) as string,
    };
  }

  if (account.kind === XcpNgXapiAccountKind.Elevated) {
    return {
      tone: XcpNgNoticeTone.Warning,
      title: translator.translateTemplate(
        "{{name}} can change this pool: its roles are {{roles}}.",
        {
          name: account.name,
          roles: formatList(account.roles, translator),
        },
      ),
      nextStep: translator.translateText(
        "Give the user only XAPI's read-only role: OneUptime reads, and never changes anything.",
      ) as string,
    };
  }

  return null;
}

/*
 * What a Xen Orchestra API token may do, from what a read or a test found,
 * when that needs saying: it changes things, it cannot read all it needs,
 * or it was refused.
 */
export function getXcpNgApiTokenProblemNotice(
  apiToken: XcpNgApiTokenSummary | null | undefined,
  translator: Translator,
): XcpNgNotice | null {
  if (!apiToken?.errorCode) {
    return null;
  }

  const advice: XcpNgCollectionErrorAdvice = getAdviceOf(apiToken.errorCode);

  return {
    tone:
      apiToken.errorCode === XcpNgCollectionErrorCode.TokenCannotReadAlarms
        ? XcpNgNoticeTone.Warning
        : XcpNgNoticeTone.Danger,
    title: translator.translateText(advice.title) as string,
    nextStep: translator.translateText(advice.nextStep) as string,
  };
}

/*
 * When the saved API token stops working: Xen Orchestra forgets a token the
 * moment it expires, so it is said two weeks before (the feed of every pool
 * the connection reads says it too), and once it has.
 */
export function getXcpNgApiTokenExpiryNotice(
  connection: Pick<
    XcpNgConnection,
    "connectionType" | "isApiTokenSet" | "apiTokenExpiresAt"
  >,
  translator: Translator,
  now: Date = new Date(),
): XcpNgNotice | null {
  if (
    readType(connection.connectionType) === XcpNgConnectionType.Xapi ||
    !connection.isApiTokenSet ||
    !connection.apiTokenExpiresAt
  ) {
    return null;
  }

  const expiresAt: Date = new Date(connection.apiTokenExpiresAt);

  if (Number.isNaN(expiresAt.getTime())) {
    return null;
  }

  const nextStep: string = translator.translateText(
    "Create a new token in Xen Orchestra for the same read-only user, and enter it in Edit Connection.",
  ) as string;

  if (expiresAt.getTime() <= now.getTime()) {
    return {
      tone: XcpNgNoticeTone.Danger,
      title: translator.translateTemplate("The API token expired {{time}}.", {
        time: OneUptimeDate.fromNow(expiresAt),
      }),
      nextStep: nextStep,
    };
  }

  if (
    expiresAt.getTime() - now.getTime() <=
    XCP_NG_API_TOKEN_WARNING_DAYS * 24 * 60 * 60 * 1000
  ) {
    return {
      tone: XcpNgNoticeTone.Warning,
      title: translator.translateTemplate("The API token expires {{time}}.", {
        time: OneUptimeDate.fromNow(expiresAt),
      }),
      nextStep: nextStep,
    };
  }

  return null;
}

// Where a connection test stands, in words.
export function getXcpNgConnectionTestView(
  test: Pick<
    XcpNgConnectionTest,
    | "status"
    | "connectionType"
    | "errorCode"
    | "errorMessage"
    | "presentedCertificate"
    | "summary"
  >,
  translator: Translator,
): XcpNgConnectionTestView {
  const isXapi: boolean =
    readType(test.connectionType || test.summary?.connectionType) ===
    XcpNgConnectionType.Xapi;
  const empty: Omit<XcpNgConnectionTestView, "phase" | "title"> = {
    message: null,
    nextStep: null,
    inventory: [],
    poolNames: [],
    notices: [],
    certificate: null,
  };

  switch (test.status) {
    case XcpNgConnectionTestStatus.Running:
      return {
        ...empty,
        phase: XcpNgConnectionTestPhase.Running,
        title: (isXapi
          ? translator.translateText(
              "The probe is connecting to the pool master…",
            )
          : translator.translateText(
              "The probe is connecting to Xen Orchestra…",
            )) as string,
      };
    case XcpNgConnectionTestStatus.Succeeded: {
      const product: string | null = isXapi
        ? getXcpNgProductLine(test.summary)
        : (translator.translateText("Xen Orchestra") as string);
      const notices: Array<XcpNgNotice> = [];
      const accountNotice: XcpNgNotice | null = getXcpNgAccountNotice(
        test.summary?.account,
        translator,
      );
      const tokenNotice: XcpNgNotice | null = getXcpNgApiTokenProblemNotice(
        test.summary?.apiToken,
        translator,
      );

      if (accountNotice) {
        notices.push(accountNotice);
      }

      if (tokenNotice) {
        notices.push(tokenNotice);
      }

      return {
        ...empty,
        phase: XcpNgConnectionTestPhase.Succeeded,
        title: product
          ? translator.translateTemplate(
              "Connected to {{product}}. The account can read:",
              { product: product },
            )
          : (translator.translateText(
              "Connected. The account can read:",
            ) as string),
        inventory: getXcpNgInventoryPhrases(test.summary, translator),
        poolNames: isXapi ? [] : getXcpNgPoolNames(test.summary),
        notices: notices,
      };
    }
    case XcpNgConnectionTestStatus.Failed: {
      const advice: XcpNgCollectionErrorAdvice = getAdviceOf(test.errorCode);

      return {
        ...empty,
        phase: XcpNgConnectionTestPhase.Failed,
        title: translator.translateText(advice.title) as string,
        message: test.errorMessage || null,
        nextStep: translator.translateText(advice.nextStep) as string,
        certificate:
          XcpNgCollectionErrorUtil.isCertificateTrustProblem(
            XcpNgCollectionErrorUtil.isValid(test.errorCode)
              ? test.errorCode
              : null,
          ) && test.presentedCertificate?.fingerprint256
            ? test.presentedCertificate
            : null,
      };
    }
    default:
      return {
        ...empty,
        phase: XcpNgConnectionTestPhase.Waiting,
        title: translator.translateText(
          "Waiting for the probe to pick the test up…",
        ) as string,
      };
  }
}

export function isXcpNgConnectionTestSettled(
  status: XcpNgConnectionTestStatus | null | undefined,
): boolean {
  return (
    status === XcpNgConnectionTestStatus.Succeeded ||
    status === XcpNgConnectionTestStatus.Failed
  );
}

export enum XcpNgCollectionTone {
  Checking = "Checking",
  Collecting = "Collecting",
  Failing = "Failing",
}

export interface XcpNgCollectionStatusView {
  tone: XcpNgCollectionTone;
  // The badge: "Checking", "Collecting", "Not collecting".
  label: string;
  title: string;
  message: string | null;
  nextStep: string | null;
  certificate: XcpNgPresentedCertificate | null;
  // Whether the page should ask again soon.
  isPending: boolean;
}

// The columns the stop and the next read are read from, for a card's select.
export type XcpNgCollectionScheduleFacts = XcpNgCollectionStopFacts &
  Pick<XcpNgConnection, "nextCollectionAt">;

/*
 * When a probe reads this connection next, and whether that is a promise
 * (Common/Utils/Probe/ClaimDueTime): its nextCollectionAt only when nothing
 * stops the claim handing it out (getXcpNgCollectionStop). A connection
 * nothing may read is set aside a quarter of an hour at a time, so its
 * nextCollectionAt keeps moving and promises nothing.
 */
export function getXcpNgNextCollection(
  connection: XcpNgCollectionScheduleFacts,
  now: Date,
  isBillingEnabled: boolean,
): ClaimDue<XcpNgCollectionStop> {
  return readClaimDue<XcpNgCollectionStop>({
    stop: getXcpNgCollectionStop(connection, isBillingEnabled),
    dueAt: connection.nextCollectionAt,
    now: now,
    overdueAfterInMs: XCP_NG_COLLECTION_OVERDUE_AFTER_IN_MS,
  });
}

/*
 * The status card's description: how the connection is read, as a promise
 * only while a probe comes for it, and otherwise what it is set to
 * (Components/Probe/ProbeCollectionDescription, OneUptime issue #8326).
 */
export function getXcpNgCollectionDescription(
  connection: XcpNgCollectionScheduleFacts &
    Pick<XcpNgConnection, "collectionProbe" | "collectionIntervalInMinutes">,
  translator: Translator,
  now: Date,
  isBillingEnabled: boolean,
): string | undefined {
  const state: ClaimDueState = getXcpNgNextCollection(
    connection,
    now,
    isBillingEnabled,
  ).state;

  return getProbeCollectionDescription(
    {
      isCollected:
        state === ClaimDueState.Scheduled || state === ClaimDueState.DueNow,
      hasProbe: Boolean(connection.collectionProbeId),
      // Translated along with the sentence it goes into, never on its own.
      probeName:
        connection.collectionProbe?.name || translatableTerm("its probe"),
      address: connection.address,
      intervalInMinutes:
        connection.collectionIntervalInMinutes ||
        DEFAULT_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES,
    },
    translator,
  );
}

// What the card says for a connection no probe reads, and the one thing that fixes it.
const STOP_WORDS: Record<
  Exclude<
    XcpNgCollectionStop,
    XcpNgCollectionStop.ProbeNotAllowed | XcpNgCollectionStop.ProbeDisconnected
  >,
  { title: string; nextStep: string }
> = {
  [XcpNgCollectionStop.NoAddress]: {
    title: translationKey("This connection has no address."),
    nextStep: translationKey(
      "Enter the address in Edit Connection, and test the connection.",
    ),
  },
  [XcpNgCollectionStop.NoSecret]: {
    title: translationKey(
      "No OpenMetrics secret is saved for this connection.",
    ),
    nextStep: translationKey(
      "Enter the secret of Xen Orchestra's OpenMetrics plugin in Edit Connection, and test the connection.",
    ),
  },
  [XcpNgCollectionStop.NoUserName]: {
    title: translationKey("This connection has no user name."),
    nextStep: translationKey(
      "Enter the pool's user name in Edit Connection, and test the connection.",
    ),
  },
  [XcpNgCollectionStop.NoPassword]: {
    title: translationKey("No password is saved for this connection."),
    nextStep: translationKey(
      "Enter the pool's password in Edit Connection, and test the connection.",
    ),
  },
  [XcpNgCollectionStop.NoProbe]: {
    title: translationKey("No probe is set to read this connection."),
    nextStep: translationKey(
      "Pick one of this project's probes in Edit Connection.",
    ),
  },
};

// Why no probe reads this connection, in words, or null when one will.
function getXcpNgStopView(
  connection: XcpNgCollectionStopFacts &
    Pick<XcpNgConnection, "collectionProbe">,
  translator: Translator,
  isBillingEnabled: boolean,
): XcpNgCollectionStatusView | null {
  const stop: XcpNgCollectionStop | null = getXcpNgCollectionStop(
    connection,
    isBillingEnabled,
  );

  if (!stop) {
    return null;
  }

  let title: string;
  let message: string | null = null;
  let nextStep: string;

  if (
    stop === XcpNgCollectionStop.ProbeNotAllowed ||
    stop === XcpNgCollectionStop.ProbeDisconnected
  ) {
    const advice: XcpNgCollectionErrorAdvice =
      XcpNgCollectionErrorUtil.getAdvice(
        stop === XcpNgCollectionStop.ProbeNotAllowed
          ? XcpNgCollectionErrorCode.ProbeNotAllowed
          : XcpNgCollectionErrorCode.ProbeNotAvailable,
      );

    title = translator.translateText(advice.title) as string;
    nextStep = translator.translateText(advice.nextStep) as string;

    if (stop === XcpNgCollectionStop.ProbeDisconnected) {
      message = translator.translateTemplate(
        "Nothing reads this connection while {{probe}} is disconnected.",
        {
          probe:
            connection.collectionProbe?.name || translatableTerm("its probe"),
        },
      );
    }
  } else {
    title = translator.translateText(STOP_WORDS[stop].title) as string;
    nextStep = translator.translateText(STOP_WORDS[stop].nextStep) as string;
  }

  return {
    tone: XcpNgCollectionTone.Failing,
    label: translator.translateText("Not collecting") as string,
    title: title,
    message: message,
    nextStep: nextStep,
    certificate: null,
    // Nothing changes it but a write the page reads again after.
    isPending: false,
  };
}

/*
 * How a connection's reading stands, in words. What stops the probes'
 * claim handing it out comes first: a connection nothing may read is set
 * aside, never overdue, and its last report is not what it is doing now.
 * Then one overdue: no probe has come for it, whatever it last reported.
 */
export function getXcpNgCollectionStatusView(
  connection: XcpNgCollectionStopFacts &
    Pick<
      XcpNgConnection,
      | "collectionStatus"
      | "collectionErrorCode"
      | "collectionError"
      | "presentedCertificate"
      | "nextCollectionAt"
      | "collectionProbe"
    >,
  translator: Translator,
  now: Date = new Date(),
  isBillingEnabled: boolean = false,
): XcpNgCollectionStatusView {
  const stopView: XcpNgCollectionStatusView | null = getXcpNgStopView(
    connection,
    translator,
    isBillingEnabled,
  );

  if (stopView) {
    return stopView;
  }

  if (
    readClaimDue<null>({
      stop: null,
      dueAt: connection.nextCollectionAt,
      now: now,
      overdueAfterInMs: XCP_NG_COLLECTION_OVERDUE_AFTER_IN_MS,
    }).state === ClaimDueState.Overdue
  ) {
    const advice: XcpNgCollectionErrorAdvice =
      XcpNgCollectionErrorUtil.getAdvice(
        XcpNgCollectionErrorCode.ProbeNotAvailable,
      );

    return {
      tone: XcpNgCollectionTone.Failing,
      label: translator.translateText("Not collecting") as string,
      title: translator.translateText(advice.title) as string,
      message: translator.translateTemplate(
        "This connection was due to be read {{time}}, and no probe has come for it.",
        { time: OneUptimeDate.fromNow(connection.nextCollectionAt as Date) },
      ),
      nextStep: translator.translateText(advice.nextStep) as string,
      certificate: null,
      // It says so until the probe is back, which nobody reloads the page to see.
      isPending: true,
    };
  }

  const isXapi: boolean =
    readType(connection.connectionType) === XcpNgConnectionType.Xapi;

  if (connection.collectionStatus === XcpNgCollectionStatus.Succeeded) {
    return {
      tone: XcpNgCollectionTone.Collecting,
      label: translator.translateText("Collecting") as string,
      title: (isXapi
        ? translator.translateText("The probe is reading this pool.")
        : translator.translateText(
            "The probe is reading this Xen Orchestra.",
          )) as string,
      message: null,
      nextStep: null,
      certificate: null,
      isPending: false,
    };
  }

  if (connection.collectionStatus === XcpNgCollectionStatus.Failed) {
    const code: XcpNgCollectionErrorCode = XcpNgCollectionErrorUtil.isValid(
      connection.collectionErrorCode,
    )
      ? connection.collectionErrorCode
      : XcpNgCollectionErrorCode.Internal;
    const advice: XcpNgCollectionErrorAdvice =
      XcpNgCollectionErrorUtil.getAdvice(code);

    return {
      tone: XcpNgCollectionTone.Failing,
      label: translator.translateText("Not collecting") as string,
      title: translator.translateText(advice.title) as string,
      message: connection.collectionError || null,
      nextStep: translator.translateText(advice.nextStep) as string,
      certificate:
        XcpNgCollectionErrorUtil.isCertificateTrustProblem(code) &&
        connection.presentedCertificate?.fingerprint256
          ? connection.presentedCertificate
          : null,
      isPending: false,
    };
  }

  return {
    tone: XcpNgCollectionTone.Checking,
    label: translator.translateText("Checking") as string,
    title: translator.translateText(
      "The probe reads this connection with its new settings within a minute.",
    ) as string,
    message: null,
    nextStep: null,
    certificate: null,
    isPending: true,
  };
}

/*
 * What "Test connection" tries: the form's kind, address, probe,
 * certificate and secrets. An empty secret tests a saved connection's own
 * (xcpNgConnectionId), under the rule its saves are held to.
 */
export interface XcpNgConnectionTestInput {
  connectionType: XcpNgConnectionType | null;
  address: string;
  probeId: string;
  trustedCertificateFingerprint: string;
  openMetricsSecret: string;
  apiToken: string;
  username: string;
  password: string;
  xcpNgConnectionId?: ObjectID | undefined;
}

// Why the form cannot be tested yet, or null when it can.
export function getXcpNgConnectionTestBlocker(
  input: XcpNgConnectionTestInput,
): string | null {
  const hasSaved: boolean = Boolean(input.xcpNgConnectionId);

  if (input.connectionType === XcpNgConnectionType.Xapi) {
    if (
      !input.address.trim() ||
      !input.username.trim() ||
      !input.probeId ||
      (!input.password && !hasSaved)
    ) {
      return translationKey(
        "Enter the address, user name, password and probe first.",
      );
    }

    return null;
  }

  if (
    !input.connectionType ||
    !input.address.trim() ||
    !input.probeId ||
    (!input.openMetricsSecret && !hasSaved)
  ) {
    return translationKey(
      "Enter the address, the OpenMetrics secret and the probe first.",
    );
  }

  return null;
}

function readString(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

// The probe a form value names, however the dropdown handed it in.
function readProbeId(record: Record<string, unknown>): string {
  const probe: unknown =
    record["collectionProbe"] ?? record["collectionProbeId"];

  if (!probe) {
    return "";
  }

  if (typeof probe === "string") {
    return probe;
  }

  if (probe instanceof ObjectID) {
    return probe.toString();
  }

  const relation: { _id?: unknown; id?: unknown } = probe as {
    _id?: unknown;
    id?: unknown;
  };

  return readString(relation._id || relation.id);
}

// What a test of the form as it stands now would try.
export function getXcpNgConnectionTestInput(
  values: FormValues<XcpNgConnection>,
  saved?:
    | {
        xcpNgConnectionId: ObjectID;
        connectionType: XcpNgConnectionType | null | undefined;
      }
    | undefined,
): XcpNgConnectionTestInput {
  const record: Record<string, unknown> = values as Record<string, unknown>;

  return {
    connectionType:
      readType(record["connectionType"]) ||
      readType(saved?.connectionType) ||
      null,
    address: readString(record["address"]),
    probeId: readProbeId(record),
    trustedCertificateFingerprint: readString(
      record["trustedCertificateFingerprint"],
    ),
    openMetricsSecret: readString(record["openMetricsSecret"]),
    apiToken: readString(record["apiToken"]),
    username: readString(record["username"]),
    password: readString(record["password"]),
    xcpNgConnectionId: saved?.xcpNgConnectionId,
  };
}

// The kind a Connect form is on: Xen Orchestra until another is picked.
export function getXcpNgFormConnectionType(
  values: FormValues<XcpNgConnection>,
): XcpNgConnectionType {
  return (
    readType((values as Record<string, unknown>)["connectionType"]) ||
    XcpNgConnectionType.XenOrchestra
  );
}

/*
 * The address as the server will read it, refused with the sentence the
 * server would answer with.
 */
export function validateXcpNgAddress(
  value: unknown,
  type: XcpNgConnectionType,
): string | null {
  const result: XcpNgAddressResult = XcpNgConnectionAddress.normalize(
    readString(value),
    type,
  );

  return result.address ? null : translateText(result.error) || result.error;
}

export function validateXcpNgTrustedCertificate(value: unknown): string | null {
  const text: string = readString(value).trim();

  if (!text || VMwareCertificateFingerprint.isValid(text)) {
    return null;
  }

  return (
    translateText(
      "Enter a SHA-256 fingerprint: 64 hexadecimal characters, such as AB:CD:EF:... .",
    ) || ""
  );
}

// Where to compare a presented certificate before trusting it.
export function getXcpNgTrustHint(
  type: XcpNgConnectionType | string | null | undefined,
): string {
  return readType(type) === XcpNgConnectionType.Xapi
    ? translationKey(
        "Check the fingerprint against the host's certificate first: on the pool master, run openssl x509 -noout -fingerprint -sha256 -in /etc/xensource/xapi-ssl.pem.",
      )
    : translationKey(
        "Check the fingerprint against Xen Orchestra's own certificate first: on its machine, run openssl x509 -noout -fingerprint -sha256 on the certificate file xo-server is set up with.",
      );
}

export enum XcpNgPoolReadBy {
  Agent = "Agent",
  Connection = "Connection",
  // Set to a probe, through a connection since deleted.
  RemovedConnection = "RemovedConnection",
}

// How a pool is read, from its own row.
export function getXcpNgPoolReadBy(
  pool: Pick<
    {
      collectionMethod?: XcpNgCollectionMethod | string | null | undefined;
      xcpNgConnectionId?: { toString: () => string } | null | undefined;
    },
    "collectionMethod" | "xcpNgConnectionId"
  >,
): XcpNgPoolReadBy {
  if (pool.collectionMethod !== XcpNgCollectionMethod.Probe) {
    return XcpNgPoolReadBy.Agent;
  }

  return pool.xcpNgConnectionId
    ? XcpNgPoolReadBy.Connection
    : XcpNgPoolReadBy.RemovedConnection;
}

// Whether a connection's last read (or its test) saw this pool.
export function isXcpNgPoolInSummary(
  summary: XcpNgCollectionSummary | null | undefined,
  poolIdentifier: string | null | undefined,
): boolean {
  const id: string = (poolIdentifier || "").trim().toLowerCase();

  if (!id || !summary || !Array.isArray(summary.pools)) {
    return false;
  }

  return summary.pools.some((pool: XcpNgPoolSummary): boolean => {
    return (pool.poolId || "").toLowerCase() === id;
  });
}
