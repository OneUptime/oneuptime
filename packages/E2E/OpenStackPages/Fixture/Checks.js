/*
 * A cloud's check, as a probe's reports leave it, for the Checks page's walks. The rules of a save
 * and of a report have tests of their own, against the real code: this only holds what a page reads
 * back.
 *
 *   ?checks=   on: both checks on and passing | failed: a run stopped at Wait for ACTIVE, with
 *              Nova's fault | refused: a credential the check will not write with | sweeping: turned
 *              off, with a probe still clearing up | waiting: on, with no report yet
 */

function minutesBefore(now, minutes) {
  return new Date(now - minutes * 60_000).toISOString();
}

const STEPS_BEFORE_BOOT = [
  { step: "token", status: "Passed", durationInMs: 310 },
  { step: "credential_check", status: "Passed", durationInMs: 540 },
  { step: "prepare", status: "Passed", durationInMs: 880 },
  { step: "janitor", status: "Passed", durationInMs: 420 },
  { step: "server_create", status: "Passed", durationInMs: 1240 },
];

const NOVA_FAULT = {
  source: "nova",
  code: 500,
  message:
    "No valid host was found. There are not enough hosts available. Compute service of the scheduler is not responding.",
};

function apiResult(now) {
  const startedAt = minutesBefore(now, 1);

  return {
    startedAt: startedAt,
    durationInMs: 1450,
    regionNames: ["RegionOne"],
    token: { status: "Passed", durationInMs: 180 },
    services: [
      {
        regionName: "RegionOne",
        serviceType: "compute",
        serviceName: "nova",
        read: "GET /servers?limit=1",
        outcome: "Answered",
        status: 200,
        durationInMs: 86,
      },
      {
        regionName: "RegionOne",
        serviceType: "volumev3",
        serviceName: "cinder",
        read: "GET /volumes?limit=1",
        outcome: "Failing",
        status: 503,
        durationInMs: 1320,
        message: "Cinder answered 503 Service Unavailable.",
      },
    ],
    certificates: [
      {
        host: "keystone.acme-cloud.example",
        port: 443,
        validTo: new Date(now + 5 * 86_400_000).toISOString(),
        subject: "keystone.acme-cloud.example",
        issuer: "Acme Cloud CA",
        regionNames: ["RegionOne"],
        serviceTypes: ["identity"],
      },
      {
        host: "nova.acme-cloud.example",
        port: 443,
        validTo: new Date(now + 200 * 86_400_000).toISOString(),
        subject: "nova.acme-cloud.example",
        issuer: "Acme Cloud CA",
        regionNames: ["RegionOne"],
        serviceTypes: ["compute"],
      },
    ],
    warnings: [],
  };
}

function goodRun(now) {
  return {
    runId: "20261105010203-abcdef",
    regionName: "RegionOne",
    startedAt: minutesBefore(now, 7),
    finishedAt: minutesBefore(now, 4),
    status: "Succeeded",
    steps: [
      ...STEPS_BEFORE_BOOT,
      { step: "server_active", status: "Passed", durationInMs: 48_200 },
      { step: "server_delete", status: "Passed", durationInMs: 9_100 },
    ],
    phases: { credential: "Passed", boot: "Passed", cleanup: "Passed" },
    janitor: { removed: [], remainingCount: 0, errors: [] },
    leftoverCount: 0,
    traceId: "4e3e0ec6293840b1850409eb1d4b0dee",
    requestCount: 41,
    writeCount: 2,
    warnings: [],
  };
}

function failedRun(now) {
  return {
    runId: "20261105013203-fedcba",
    regionName: "RegionOne",
    startedAt: minutesBefore(now, 7),
    finishedAt: minutesBefore(now, 4),
    status: "Failed",
    failedStep: "server_active",
    fault: NOVA_FAULT,
    steps: [
      ...STEPS_BEFORE_BOOT,
      {
        step: "server_active",
        status: "Failed",
        durationInMs: 2_400,
        fault: NOVA_FAULT,
      },
      { step: "server_delete", status: "Passed", durationInMs: 3_100 },
    ],
    phases: { credential: "Passed", boot: "Failed", cleanup: "Passed" },
    leftoverCount: 0,
    requestCount: 22,
    writeCount: 2,
    warnings: [],
  };
}

function brief(run) {
  return {
    runId: run.runId,
    finishedAt: run.finishedAt,
    status: run.status,
    durationInMs: Date.parse(run.finishedAt) - Date.parse(run.startedAt),
    failedStep: run.failedStep,
    fault: run.fault,
    message: run.message,
    traceId: run.traceId,
  };
}

function records(lastVerdict, lastAttempt) {
  return {
    RegionOne: {
      regionName: "RegionOne",
      lastVerdict: lastVerdict,
      lastAttempt: lastAttempt,
      phaseVerdicts: lastVerdict?.phases || {},
      recent: [lastAttempt, lastVerdict].filter(Boolean).map(brief),
    },
  };
}

const ON = {
  isCredentialSet: true,
  isApiCheckEnabled: true,
  apiCheckIntervalInMinutes: 1,
  isLifecycleCheckEnabled: true,
  lifecycleCheckIntervalInMinutes: 30,
  lifecycleProjectName: "oneuptime-checks",
  isSweepPending: false,
  isOsProfilerKeySet: false,
};

// The row a walk starts from, or none: a cloud with no check turned on has no row.
export function checkRowOf(name, cloudId, projectId, now) {
  const base = {
    _id: "77000000-0000-4000-8000-000000000001",
    projectId: projectId,
    openStackCloudId: cloudId,
    settingsVersion: 3,
  };

  if (name === "on") {
    return {
      ...base,
      ...ON,
      isOsProfilerKeySet: true,
      lastApiCheckAt: minutesBefore(now, 1),
      lastLifecycleCheckAt: minutesBefore(now, 4),
      apiCheckResult: apiResult(now),
      lifecycleRecords: records(goodRun(now)),
    };
  }

  if (name === "failed") {
    return {
      ...base,
      ...ON,
      lastApiCheckAt: minutesBefore(now, 1),
      lastLifecycleCheckAt: minutesBefore(now, 4),
      apiCheckResult: apiResult(now),
      lifecycleRecords: records(failedRun(now)),
    };
  }

  if (name === "refused") {
    const run = {
      ...goodRun(now),
      status: "Refused",
      steps: [],
      message:
        "This credential's token is for project admin, and the check was told oneuptime-checks. Nothing was written.",
    };

    return {
      ...base,
      ...ON,
      lastApiCheckAt: minutesBefore(now, 1),
      lastLifecycleCheckAt: minutesBefore(now, 4),
      apiCheckResult: apiResult(now),
      lifecycleRecords: records(undefined, run),
    };
  }

  if (name === "sweeping") {
    return {
      ...base,
      ...ON,
      isLifecycleCheckEnabled: false,
      isSweepPending: true,
      lastApiCheckAt: minutesBefore(now, 1),
      apiCheckResult: apiResult(now),
    };
  }

  if (name === "waiting") {
    return { ...base, ...ON };
  }

  return null;
}
