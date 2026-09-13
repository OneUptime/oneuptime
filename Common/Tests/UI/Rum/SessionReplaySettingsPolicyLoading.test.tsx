import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Color from "../../../Types/Color";
import { Green, Red, Yellow } from "../../../Types/BrandColors";
import {
  RecordingHealthDiagnosis,
  RecordingHealthState,
} from "../../../Types/Rum/SessionReplayHealth";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import SessionReplayMaskingMode from "../../../Types/Rum/SessionReplayMaskingMode";
import SessionReplayConsentMode from "../../../Types/Rum/SessionReplayConsentMode";
import SessionReplayCaptureTrigger from "../../../Types/Rum/SessionReplayCaptureTrigger";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Replay Policy page (Pages/Rum/View/SessionReplaySettings.tsx) sat on
 * the policy card's loading bar forever. The page built a new ObjectID on
 * every render and lifted the loaded row into state; ModelDetail refetches
 * when its modelId changes by identity, so each load re-rendered the page,
 * handed the card a new id and loaded again. Health polls re-rendered the
 * page too.
 *
 * Once that loop was gone a second bug showed: ModelDetail keeps its field
 * renderers from its first render, and the Recording pill closed over the
 * page's diagnosis from that render - before health answered - so it read
 * "On (project switch not checked yet)" for good.
 *
 * These render the real page against the real Navigation. getItem hands back
 * a NEW row every call (a shared instance lets React bail out of the state
 * update and hides the loop) and the ingest-status response is held so the
 * policy lands before health does.
 */

const postMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown): string => {
        return error instanceof HTTPErrorResponse
          ? error.message
          : String(error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      getList: (): Promise<{ data: Array<unknown>; count: number }> => {
        return Promise.resolve({ data: [], count: 0 });
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return true;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return [];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

import * as SessionReplaySettingsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/SessionReplaySettings";
import useSessionReplayHealth, {
  SESSION_REPLAY_INGEST_STATUS_ROUTE,
  UseSessionReplayHealthResult,
  clearSessionReplayHealthStore,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/useSessionReplayHealth";

/*
 * Read off the module rather than named in the import so a page without the
 * standalone pill fails the tests that use it instead of the whole file.
 */
const settingsPage: {
  default: React.FunctionComponent<PageComponentProps>;
  describeEffectiveRecordingState: (
    isApplicationEnabled: boolean | undefined,
    diagnosis: RecordingHealthDiagnosis | null,
  ) => { text: string; color: Color };
  EffectiveRecordingStatePill?:
    | React.FunctionComponent<{
        rumApplicationId: ObjectID | string;
        isApplicationEnabled: boolean | undefined;
      }>
    | undefined;
} = SessionReplaySettingsPage;

const RumApplicationSessionReplaySettings: React.FunctionComponent<PageComponentProps> =
  settingsPage.default;
const describeEffectiveRecordingState: typeof settingsPage.describeEffectiveRecordingState =
  settingsPage.describeEffectiveRecordingState;

/*
 * These render real components that fetch, so give the waits enough room to
 * survive a loaded CI box.
 */
const WAIT_TIMEOUT: number = 20000;

/* Long enough for a render loop to go round many times; see the note above. */
const SETTLE_MS: number = 1500;

/*
 * CardModelDetail flips its own refresher in a mount effect, so every card
 * fetches twice as it mounts. That is the whole budget: the loop this pins
 * kept fetching without bound.
 */
const POLICY_FETCHES_ON_MOUNT: number = 2;

const PROJECT_ID: string = "0193a1b2-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
const APP_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";
const PAGE_PATH: string = `/dashboard/${PROJECT_ID}/rum/${APP_ID}/session-replay-settings`;

const NOT_CHECKED_COPY: string = "On (project switch not checked yet)";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function makeDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = (): void => {};
  const promise: Promise<T> = new Promise<T>((done: (value: T) => void) => {
    resolve = done;
  });

  return { promise: promise, resolve: resolve };
}

function wireStatus(overrides?: JSONObject): JSONObject {
  const recent: string = new Date(Date.now() - 60 * 1000).toISOString();

  return {
    isProjectAllowed: true,
    isApplicationEnabled: true,
    appIdentifier: "acme-web",
    allowedOrigins: [],
    samplePercentage: 100,
    captureTrigger: "Always",
    lastChunkReceivedAt: recent,
    budgetExceededAt: null,
    projectBytesUsedToday: 0,
    dailyByteLimit: 1024 * 1024 * 1024,
    applicationBytesUsedThisMonth: null,
    monthlyBudgetInGB: null,
    consentMode: "NotRequired",
    maskingMode: "MaskSensitiveInputsOnly",
    retentionInDays: 7,
    publishedRecorderVersion: "1.4.0",
    lastConfigFetchAt: recent,
    lastSessionStartedAt: recent,
    sessionsLast24h: 4,
    playableSessionsLast24h: 4,
    refusalsLast24h: [],
    ...overrides,
  };
}

/* A NEW row per call, the way the real API deserialises one. */
function makeApplication(overrides?: Partial<RumApplication>): RumApplication {
  const application: RumApplication = new RumApplication();

  application.id = new ObjectID(APP_ID);
  application.isSessionReplayEnabled = true;
  application.sessionReplayCaptureTrigger = SessionReplayCaptureTrigger.Always;
  application.sessionReplaySamplePercentage = 100;
  application.sessionReplayMaskingMode = SessionReplayMaskingMode.MaskAllText;
  application.sessionReplayConsentMode = SessionReplayConsentMode.NotRequired;
  application.sessionReplayCaptureUserIdentity = true;
  application.sessionReplayCaptureGeo = true;
  application.sessionReplayRecordCanvas = false;
  application.sessionReplayRetentionInDays = 7;

  Object.assign(application, overrides || {});

  return application;
}

interface HealthControl {
  release: (body: JSONObject) => void;
}

/*
 * Every ingest-status request waits for release(); the first release answers
 * it, and later requests answer at once with the last released body.
 */
function holdHealth(): HealthControl {
  const deferred: Deferred<HTTPResponse<JSONObject>> =
    makeDeferred<HTTPResponse<JSONObject>>();
  let releasedBody: JSONObject | null = null;

  postMock.mockImplementation((request: unknown): Promise<unknown> => {
    const url: string = (
      request as { url: { toString: () => string } }
    ).url.toString();

    if (!url.includes(SESSION_REPLAY_INGEST_STATUS_ROUTE)) {
      return Promise.resolve(new HTTPResponse<JSONObject>(200, {}, {}));
    }

    if (releasedBody !== null) {
      return Promise.resolve(
        new HTTPResponse<JSONObject>(200, releasedBody, {}),
      );
    }

    return deferred.promise;
  });

  return {
    release: (body: JSONObject): void => {
      releasedBody = body;
      deferred.resolve(new HTTPResponse<JSONObject>(200, body, {}));
    },
  };
}

function ingestStatusCalls(): Array<Array<unknown>> {
  return postMock.mock.calls.filter((call: Array<unknown>): boolean => {
    return (call[0] as { url: { toString: () => string } }).url
      .toString()
      .includes(SESSION_REPLAY_INGEST_STATUS_ROUTE);
  });
}

function policyGetItemCalls(): Array<Array<unknown>> {
  return getItemMock.mock.calls.filter((call: Array<unknown>): boolean => {
    const select: JSONObject =
      ((call[0] as { select?: JSONObject }).select as JSONObject) || {};

    return select["isSessionReplayEnabled"] === true;
  });
}

async function waitRealTime(ms: number): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise<void>((done: () => void) => {
      setTimeout(done, ms);
    });
  });
}

function getPolicyCard(): HTMLElement {
  return document.getElementById("replay-policy") as HTMLElement;
}

let captureRefresh: (() => Promise<void>) | null = null;

/* A second subscriber to the shared poller, which also hands out refresh(). */
function HealthProbe(props: { rumApplicationId: string }): React.ReactElement {
  const health: UseSessionReplayHealthResult = useSessionReplayHealth(
    props.rumApplicationId,
  );

  captureRefresh = health.refresh;

  return (
    <span data-testid="health-probe">
      {health.isLoading ? "loading" : health.diagnosis.state}
    </span>
  );
}

function renderPage(withProbe: boolean = false): void {
  render(
    <MemoryRouter>
      <RumApplicationSessionReplaySettings
        pageRoute={new Route(PAGE_PATH)}
        currentProject={null}
        hasPaymentMethod={false}
      />
      {withProbe ? <HealthProbe rumApplicationId={APP_ID} /> : <></>}
    </MemoryRouter>,
  );
}

async function waitForPolicyRows(): Promise<void> {
  await waitFor(
    () => {
      expect(within(getPolicyCard()).getByText("Masking")).toBeInTheDocument();
    },
    { timeout: WAIT_TIMEOUT },
  );
}

beforeEach(() => {
  postMock.mockReset();
  getItemMock.mockReset();
  captureRefresh = null;
  clearSessionReplayHealthStore();
  window.history.replaceState({}, "", PAGE_PATH);

  getItemMock.mockImplementation((): Promise<RumApplication> => {
    return Promise.resolve(makeApplication());
  });
});

afterEach(() => {
  cleanup();
  clearSessionReplayHealthStore();
});

describe("describeEffectiveRecordingState", () => {
  function diagnosis(state: RecordingHealthState): RecordingHealthDiagnosis {
    return { state: state, severity: "info", title: "t", detail: "d" };
  }

  const table: Array<[RecordingHealthState | null, string, Color]> = [
    [null, NOT_CHECKED_COPY, Yellow],
    ["unknown", NOT_CHECKED_COPY, Yellow],
    ["disabled-project", "Off: project switch is off", Red],
    ["disabled-app", "Off for this application", Red],
    ["budget-paused", "Paused: budget spent", Red],
    ["refusing", "On, but uploads are being refused", Yellow],
    ["never-loaded", "On, recorder never loaded", Yellow],
    ["loaded-never-uploaded", "On, nothing uploaded yet", Yellow],
    ["stale", "On, no chunk for a while", Yellow],
    ["healthy-quiet", "On", Green],
    ["healthy", "On", Green],
  ];

  it.each(table)(
    "an enabled application with diagnosis %p reads %p",
    (state: RecordingHealthState | null, text: string, color: Color) => {
      const result: { text: string; color: Color } =
        describeEffectiveRecordingState(
          true,
          state === null ? null : diagnosis(state),
        );

      expect(result.text).toBe(text);
      expect(result.color).toBe(color);
    },
  );

  it("a disabled application reads 'Off for this application' whatever health says", () => {
    for (const [state] of table) {
      for (const enabled of [false, undefined]) {
        expect(
          describeEffectiveRecordingState(
            enabled,
            state === null ? null : diagnosis(state),
          ),
        ).toEqual({ text: "Off for this application", color: Red });
      }
    }
  });
});

describe("Replay Policy page: the policy card loads once", () => {
  it("fetches the policy only on mount, for the id in the URL, and leaves the loading bar", async () => {
    const health: HealthControl = holdHealth();

    renderPage();

    await waitForPolicyRows();

    /* Many render cycles later: no further fetch, and no loader. */
    await waitRealTime(SETTLE_MS);

    expect(policyGetItemCalls()).toHaveLength(POLICY_FETCHES_ON_MOUNT);
    expect(getItemMock).toHaveBeenCalledTimes(POLICY_FETCHES_ON_MOUNT);

    for (const call of policyGetItemCalls()) {
      expect(
        (call[0] as { id: { toString: () => string } }).id.toString(),
      ).toBe(APP_ID);
    }

    const card: HTMLElement = getPolicyCard();

    expect(card.querySelector('[data-testid="bar-loader"]')).toBeNull();
    expect(within(card).getByText("Sampling")).toBeInTheDocument();
    expect(within(card).getByText("100%")).toBeInTheDocument();
    expect(within(card).getByText("7 days")).toBeInTheDocument();
    expect(
      within(card).getByText("All text masked: wireframe replay"),
    ).toBeInTheDocument();

    /* The privacy summary reads the same row the card loaded. */
    expect(screen.getByTestId("privacy-summary")).toBeInTheDocument();
    expect(screen.queryByTestId("privacy-summary-loading")).toBeNull();

    health.release(wireStatus());
  });

  it("health answering, and a later refresh, do not refetch the policy", async () => {
    const health: HealthControl = holdHealth();

    renderPage(true);

    await waitForPolicyRows();
    await waitRealTime(SETTLE_MS / 3);

    expect(policyGetItemCalls()).toHaveLength(POLICY_FETCHES_ON_MOUNT);

    /* Page, health card, installation test and probe share one request. */
    expect(ingestStatusCalls()).toHaveLength(1);

    await act(async (): Promise<void> => {
      health.release(wireStatus());
    });

    await waitFor(
      () => {
        expect(screen.getByTestId("health-probe")).toHaveTextContent("healthy");
      },
      { timeout: WAIT_TIMEOUT },
    );

    /* A poll re-notifies every subscriber on the page. */
    await act(async (): Promise<void> => {
      await captureRefresh!();
    });

    expect(ingestStatusCalls()).toHaveLength(2);

    await waitRealTime(SETTLE_MS / 3);

    expect(policyGetItemCalls()).toHaveLength(POLICY_FETCHES_ON_MOUNT);
    expect(
      getPolicyCard().querySelector('[data-testid="bar-loader"]'),
    ).toBeNull();
  });
});

describe("Replay Policy page: the Recording pill", () => {
  it("says 'not checked yet' while health is held, then 'On' once a healthy status arrives", async () => {
    const health: HealthControl = holdHealth();

    renderPage();

    await waitForPolicyRows();

    expect(
      within(getPolicyCard()).getByText(NOT_CHECKED_COPY),
    ).toBeInTheDocument();

    await act(async (): Promise<void> => {
      health.release(wireStatus());
    });

    await waitFor(
      () => {
        expect(within(getPolicyCard()).getByText("On")).toBeInTheDocument();
      },
      { timeout: WAIT_TIMEOUT },
    );

    expect(within(getPolicyCard()).queryByText(NOT_CHECKED_COPY)).toBeNull();
    expect(policyGetItemCalls()).toHaveLength(POLICY_FETCHES_ON_MOUNT);
  });

  it("reads 'Off: project switch is off' once health says the project switch is off", async () => {
    const health: HealthControl = holdHealth();

    renderPage();

    await waitForPolicyRows();

    await act(async (): Promise<void> => {
      health.release(wireStatus({ isProjectAllowed: false }));
    });

    await waitFor(
      () => {
        expect(
          within(getPolicyCard()).getByText("Off: project switch is off"),
        ).toBeInTheDocument();
      },
      { timeout: WAIT_TIMEOUT },
    );

    expect(policyGetItemCalls()).toHaveLength(POLICY_FETCHES_ON_MOUNT);
  });

  it("reads 'Off for this application' when the loaded row has recording off", async () => {
    getItemMock.mockImplementation((): Promise<RumApplication> => {
      return Promise.resolve(
        makeApplication({ isSessionReplayEnabled: false }),
      );
    });

    const health: HealthControl = holdHealth();

    renderPage();

    await waitForPolicyRows();

    expect(
      within(getPolicyCard()).getByText("Off for this application"),
    ).toBeInTheDocument();

    await act(async (): Promise<void> => {
      health.release(wireStatus());
    });

    await waitRealTime(SETTLE_MS / 3);

    expect(
      within(getPolicyCard()).getByText("Off for this application"),
    ).toBeInTheDocument();
    expect(policyGetItemCalls()).toHaveLength(POLICY_FETCHES_ON_MOUNT);
  });
});

describe("EffectiveRecordingStatePill (standalone)", () => {
  it("updates when the shared poller answers, sharing one request with another subscriber", async () => {
    const EffectiveRecordingStatePill: NonNullable<
      typeof settingsPage.EffectiveRecordingStatePill
    > = settingsPage.EffectiveRecordingStatePill!;

    expect(EffectiveRecordingStatePill).toBeDefined();

    const health: HealthControl = holdHealth();

    render(
      <>
        <EffectiveRecordingStatePill
          rumApplicationId={APP_ID}
          isApplicationEnabled={true}
        />
        <HealthProbe rumApplicationId={APP_ID} />
      </>,
    );

    expect(screen.getByText(NOT_CHECKED_COPY)).toBeInTheDocument();

    await waitFor(() => {
      expect(ingestStatusCalls()).toHaveLength(1);
    });

    expect((ingestStatusCalls()[0]![0] as { data: JSONObject }).data).toEqual({
      rumApplicationId: APP_ID,
    });

    await act(async (): Promise<void> => {
      health.release(wireStatus());
    });

    await waitFor(
      () => {
        expect(screen.getByText("On")).toBeInTheDocument();
      },
      { timeout: WAIT_TIMEOUT },
    );

    expect(screen.queryByText(NOT_CHECKED_COPY)).toBeNull();
    expect(ingestStatusCalls()).toHaveLength(1);
  });
});
