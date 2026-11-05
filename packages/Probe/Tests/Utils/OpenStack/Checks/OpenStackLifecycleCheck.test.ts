import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import {
  OpenStackLifecycleCheckJob,
  OpenStackLifecyclePhase,
  OpenStackLifecycleRun,
  OpenStackLifecycleStep,
  OpenStackLifecycleStepResult,
  getOpenStackJanitorAgeInMs,
  getOpenStackLifecycleRunBudgetInMs,
  OpenStackCheckRemovedResource,
} from "Common/Types/OpenStack/OpenStackCheck";
import {
  buildOpenStackCheckName,
  buildOpenStackCheckRunId,
} from "Common/Utils/OpenStack/OpenStackCheckName";
import { OpenStackBackoffMemory } from "../../../../Utils/OpenStack/OpenStackBackoff";
import { OpenStackCheckDependencies } from "../../../../Utils/OpenStack/Checks/OpenStackCheckDependencies";
import OpenStackLifecycleCheck, {
  CLEANUP_RESERVE_IN_MS,
  SERVER_ACTIVE_TIMEOUT_IN_MS,
  chooseOpenStackCheckFlavor,
  chooseOpenStackCheckImage,
  chooseOpenStackCheckNetwork,
  findOpenStackCheckByIdOrName,
  getOpenStackCheckPollDelayInMs,
} from "../../../../Utils/OpenStack/Checks/OpenStackLifecycleCheck";
import { readOpenStackCreatedAt } from "../../../../Utils/OpenStack/Checks/OpenStackLifecycleCloud";
import {
  OSPROFILER_TRACE_HMAC_HEADER,
  OSPROFILER_TRACE_INFO_HEADER,
} from "Common/Server/Utils/OpenStack/OpenStackTraceSigning";
import { OpenStackHttpRequest } from "../../../../Utils/OpenStack/OpenStackHttp";
import {
  COLLECTED_AT_MS,
  FakeClock,
  SECRET,
  createFakeClock,
} from "../Helpers/CollectorHarness";
import MockLifecycleCloud, {
  CHECK_PROJECT_ID,
  CHECK_PROJECT_NAME,
  FLOATING_ADDRESS,
  MockLifecycleOptions,
  OTHER_PROJECT_ID,
} from "../Helpers/MockLifecycleCloud";
import { RECORDED_AUTH_URL, RECORDED_REGION } from "../Helpers/RecordedCloud";

/*
 * THE MOST DANGEROUS CODE IN THE OPENSTACK PRODUCT, BECAUSE IT WRITES TO A CUSTOMER'S CLOUD.
 *
 * So these hold it to the letter: exactly what it asks a cloud, in order, and exactly what it
 * deletes. A sequence in these tests is the whole of what a run does, and a change to it is a
 * change to what happens in someone's cloud, to be read as that.
 */

const CHECK_KEY: string = "0123456789ab";
const OSPROFILER_KEY: string = "an-osprofiler-key-in-no-report";
const INTERVAL_IN_MINUTES: number = 30;
const MINUTE: number = 60_000;

function lifecycleJob(
  overrides: Partial<OpenStackLifecycleCheckJob> = {},
): OpenStackLifecycleCheckJob {
  return {
    openStackCloudCheckId: "check-1",
    openStackCloudId: "cloud-1",
    cloudName: "Lab",
    authUrl: RECORDED_AUTH_URL,
    regions: [RECORDED_REGION],
    endpointInterface: "public",
    trustedCertificateFingerprints: [],
    settingsVersion: 3,
    credential: {
      kind: "applicationCredential",
      id: "check-credential",
      secret: SECRET,
    },
    intervalInMinutes: INTERVAL_IN_MINUTES,
    checkKey: CHECK_KEY,
    expectedProjectName: CHECK_PROJECT_NAME,
    options: {},
    ...overrides,
  };
}

interface Harness {
  clock: FakeClock;
  cloud: MockLifecycleCloud;
  deps: OpenStackCheckDependencies;
  pings: Array<string>;
  transportsClosed: () => number;
}

function createHarness(
  options: Partial<MockLifecycleOptions> = {},
  extra?: {
    clock?: FakeClock | undefined;
    answersPing?: ((attempt: number) => boolean) | undefined;
    backoff?: OpenStackBackoffMemory | undefined;
  },
): Harness {
  const clock: FakeClock = extra?.clock || createFakeClock();
  const cloud: MockLifecycleCloud = new MockLifecycleCloud({
    clock: clock,
    ...options,
  });
  const pings: Array<string> = [];
  let closed: number = 0;
  let randomCount: number = 0;
  let uuidCount: number = 0;

  return {
    clock: clock,
    cloud: cloud,
    pings: pings,
    transportsClosed: (): number => {
      return closed;
    },
    deps: {
      resolve: async (): Promise<Array<string>> => {
        return ["192.0.2.10"];
      },
      createTransport: () => {
        return {
          transport: cloud.transport,
          close: (): void => {
            closed += 1;
          },
        };
      },
      clock: clock,
      ping: async (address: string): Promise<boolean> => {
        pings.push(address);
        return extra?.answersPing ? extra.answersPing(pings.length) : true;
      },
      randomHex: (): string => {
        randomCount += 1;
        return randomCount.toString(16).padStart(6, "0");
      },
      randomUuid: (): string => {
        uuidCount += 1;
        return `4e3e0ec6-2938-40b1-8504-${String(uuidCount).padStart(12, "0")}`;
      },
      backoff: extra?.backoff || new OpenStackBackoffMemory(),
      userAgent: "OneUptime-Probe/test",
    },
  };
}

function stepsOf(run: OpenStackLifecycleRun): Array<string> {
  return run.steps.map((step: OpenStackLifecycleStepResult): string => {
    return `${step.step}:${step.status}`;
  });
}

function oneRun(runs: Array<OpenStackLifecycleRun>): OpenStackLifecycleRun {
  expect(runs).toHaveLength(1);
  return runs[0] as OpenStackLifecycleRun;
}

function nameFor(data: {
  part: "server" | "volume" | "sg" | "fip";
  at: number;
  random?: string | undefined;
  checkKey?: string | undefined;
}): string {
  return buildOpenStackCheckName({
    checkKey: data.checkKey || CHECK_KEY,
    runId: buildOpenStackCheckRunId({
      startedAt: data.at,
      random: data.random || "abcdef",
    }),
    part: data.part,
  });
}

const CREDENTIAL_CHECK_READS: Array<string> = [
  "POST /identity/v3/auth/tokens",
  "GET /identity/v3/projects",
  "GET /compute/v2.1/os-hypervisors?limit=1",
  "GET /networking/v2.0/agents?limit=1",
];

const LIST_OWN: Array<string> = [
  "GET /compute/v2.1/servers/detail?limit=1000",
  "GET /volume/v3/volumes/detail?limit=1000",
  "GET /networking/v2.0/floatingips?limit=1000",
  "GET /networking/v2.0/security-groups?limit=1000",
];

const FIND_WHAT_TO_BOOT: Array<string> = [
  "GET /image/v2/images?status=active&limit=1000",
  "GET /compute/v2.1/flavors/detail?limit=1000",
  "GET /networking/v2.0/networks?limit=1000",
];

describe("a whole run", () => {
  test("a plain boot: exactly these requests, in this order, and nothing left", async () => {
    const harness: Harness = createHarness();

    const run: OpenStackLifecycleRun = oneRun(
      await OpenStackLifecycleCheck.run(lifecycleJob(), harness.deps),
    );

    expect(harness.cloud.log).toEqual([
      ...CREDENTIAL_CHECK_READS,
      ...LIST_OWN,
      ...FIND_WHAT_TO_BOOT,
      "POST /compute/v2.1/servers",
      "GET /compute/v2.1/servers/{server}",
      "GET /compute/v2.1/servers/{server}",
      "DELETE /compute/v2.1/servers/{server}",
      "GET /compute/v2.1/servers/{server}",
      ...LIST_OWN,
    ]);

    expect(run.status).toBe("Succeeded");
    expect(run.failedStep).toBeUndefined();
    expect(run.fault).toBeUndefined();
    expect(stepsOf(run)).toEqual([
      "token:Passed",
      "credential_check:Passed",
      "prepare:Passed",
      "janitor:Passed",
      "server_create:Passed",
      "server_active:Passed",
      "server_delete:Passed",
    ]);
    expect(run.phases).toEqual({
      [OpenStackLifecyclePhase.Credential]: "Passed",
      [OpenStackLifecyclePhase.Boot]: "Passed",
      [OpenStackLifecyclePhase.FloatingIp]: "Off",
      [OpenStackLifecyclePhase.Volume]: "Off",
      [OpenStackLifecyclePhase.Cleanup]: "Passed",
    });
    expect(run.leftoverCount).toBe(0);
    expect(run.writeCount).toBe(2);
    expect(harness.cloud.everythingLeft()).toEqual([]);
    expect(harness.transportsClosed()).toBe(1);
  });

  test("a server Nova reads as DELETED is gone: not deleted twice, and no word of it", async () => {
    const harness: Harness = createHarness({ readsDeletedBeforeGoing: true });

    const run: OpenStackLifecycleRun = oneRun(
      await OpenStackLifecycleCheck.run(lifecycleJob(), harness.deps),
    );

    expect(run.status).toBe("Succeeded");
    expect(run.writeCount).toBe(2);
    expect(
      harness.cloud.log.filter((line: string): boolean => {
        return line.startsWith("DELETE /compute");
      }),
    ).toHaveLength(1);
    expect(run.warnings).toEqual([]);
    expect(run.leftoverCount).toBe(0);
  });

  test("what else a project holds is counted as a person would say it", async () => {
    const harness: Harness = createHarness();

    harness.cloud.addServer({
      id: "someone-elses",
      name: "someone-elses",
      createdAt: new Date(harness.clock.now()),
    });

    const run: OpenStackLifecycleRun = oneRun(
      await OpenStackLifecycleCheck.run(lifecycleJob(), harness.deps),
    );

    expect(run.warnings.join(" ")).toContain("also holds 1 server and 0 volumes");
  });

  test("with a floating IP and a volume: exactly these requests, and nothing left", async () => {
    const harness: Harness = createHarness();

    const run: OpenStackLifecycleRun = oneRun(
      await OpenStackLifecycleCheck.run(
        lifecycleJob({
          options: { isFloatingIpEnabled: true, isVolumeEnabled: true },
        }),
        harness.deps,
      ),
    );

    expect(harness.cloud.log).toEqual([
      ...CREDENTIAL_CHECK_READS,
      ...LIST_OWN,
      ...FIND_WHAT_TO_BOOT,
      "POST /networking/v2.0/security-groups",
      "POST /networking/v2.0/security-group-rules",
      "POST /compute/v2.1/servers",
      "GET /compute/v2.1/servers/{server}",
      "GET /compute/v2.1/servers/{server}",
      "GET /networking/v2.0/ports?device_id=dddddddd-0000-4000-8000-000000000002&limit=1000".replace(
        "dddddddd-0000-4000-8000-000000000002",
        "{server}",
      ),
      "POST /networking/v2.0/floatingips",
      "POST /volume/v3/volumes",
      "GET /volume/v3/volumes/{volume}",
      "GET /volume/v3/volumes/{volume}",
      "POST /compute/v2.1/servers/{server}/os-volume_attachments",
      "GET /volume/v3/volumes/{volume}",
      "GET /volume/v3/volumes/{volume}",
      "DELETE /compute/v2.1/servers/{server}/os-volume_attachments/{volume}",
      "GET /volume/v3/volumes/{volume}",
      "GET /volume/v3/volumes/{volume}",
      "DELETE /volume/v3/volumes/{volume}",
      "GET /volume/v3/volumes/{volume}",
      "DELETE /networking/v2.0/floatingips/{fip}",
      "DELETE /compute/v2.1/servers/{server}",
      "GET /compute/v2.1/servers/{server}",
      "DELETE /networking/v2.0/security-groups/{sg}",
      ...LIST_OWN,
    ]);

    expect(run.status).toBe("Succeeded");
    expect(harness.pings).toEqual([FLOATING_ADDRESS]);
    expect(stepsOf(run)).toEqual([
      "token:Passed",
      "credential_check:Passed",
      "prepare:Passed",
      "janitor:Passed",
      "security_group_create:Passed",
      "server_create:Passed",
      "server_active:Passed",
      "floating_ip_create:Passed",
      "ping:Passed",
      "volume_create:Passed",
      "volume_attach:Passed",
      "volume_detach:Passed",
      "volume_delete:Passed",
      "floating_ip_delete:Passed",
      "server_delete:Passed",
      "security_group_delete:Passed",
    ]);
    expect(run.phases).toEqual({
      [OpenStackLifecyclePhase.Credential]: "Passed",
      [OpenStackLifecyclePhase.Boot]: "Passed",
      [OpenStackLifecyclePhase.FloatingIp]: "Passed",
      [OpenStackLifecyclePhase.Volume]: "Passed",
      [OpenStackLifecyclePhase.Cleanup]: "Passed",
    });
    expect(harness.cloud.everythingLeft()).toEqual([]);
  });

  test("each thing it makes is named for the check, and its floating IP by its description", async () => {
    const harness: Harness = createHarness();

    await OpenStackLifecycleCheck.run(
      lifecycleJob({
        options: { isFloatingIpEnabled: true, isVolumeEnabled: true },
      }),
      harness.deps,
    );

    const bodies: Record<string, unknown> = {};

    for (const request of harness.cloud.requests) {
      if (request.method === "POST" && request.body) {
        bodies[new globalThis.URL(request.url).pathname] = JSON.parse(
          request.body,
        );
      }
    }

    const prefix: string = `oneuptime-check-${CHECK_KEY}-20261104115000-000001-`;

    expect(bodies["/networking/v2.0/security-groups"]).toMatchObject({
      security_group: { name: `${prefix}sg` },
    });
    expect(bodies["/compute/v2.1/servers"]).toMatchObject({
      server: {
        name: `${prefix}server`,
        flavorRef: "42",
        imageRef: "bbbbbbbb-0000-4000-8000-000000000001",
        networks: [{ uuid: "aaaaaaaa-0000-4000-8000-000000000001" }],
        security_groups: [{ name: `${prefix}sg` }],
      },
    });
    expect(bodies["/networking/v2.0/floatingips"]).toMatchObject({
      floatingip: {
        description: `${prefix}fip`,
        floating_network_id: "aaaaaaaa-0000-4000-8000-000000000002",
      },
    });
    expect(bodies["/volume/v3/volumes"]).toMatchObject({
      volume: { name: `${prefix}volume`, size: 1 },
    });
    // Lets a ping in and nothing else, and only that group's ports.
    expect(bodies["/networking/v2.0/security-group-rules"]).toEqual({
      security_group_rule: {
        security_group_id: expect.any(String),
        direction: "ingress",
        ethertype: "IPv4",
        protocol: "icmp",
        remote_ip_prefix: "0.0.0.0/0",
      },
    });
  });

  test("no request ever asks for another project, or for all of them", async () => {
    const harness: Harness = createHarness();

    await OpenStackLifecycleCheck.run(
      lifecycleJob({
        options: { isFloatingIpEnabled: true, isVolumeEnabled: true },
      }),
      harness.deps,
    );

    for (const line of harness.cloud.log) {
      expect(line).not.toContain("all_tenants");
      expect(line).not.toContain("all_projects");
      expect(line).not.toContain(OTHER_PROJECT_ID);
    }
  });

  test("the secret and the key are in no report, and the secret only goes to Keystone", async () => {
    const harness: Harness = createHarness({
      bootFault: { code: 500, message: "No valid host was found. " },
    });

    const runs: Array<OpenStackLifecycleRun> =
      await OpenStackLifecycleCheck.run(
        lifecycleJob({ osProfilerKey: OSPROFILER_KEY }),
        harness.deps,
      );

    const report: string = JSON.stringify(runs);

    expect(report).not.toContain(SECRET);
    expect(report).not.toContain(OSPROFILER_KEY);
    expect(report).not.toContain("a-check-token");

    for (const request of harness.cloud.requests) {
      const isLogin: boolean = request.url.endsWith("/v3/auth/tokens");

      if (!isLogin) {
        expect(JSON.stringify(request)).not.toContain(SECRET);
      }

      expect(JSON.stringify(request)).not.toContain(OSPROFILER_KEY);
    }
  });

  test("says how long each step took, from the clock", async () => {
    const clock: FakeClock = createFakeClock();
    const harness: Harness = createHarness(
      {
        pollsUntilActive: 3,
        answer: (request: OpenStackHttpRequest) => {
          if (request.method === "POST" && request.url.endsWith("/servers")) {
            clock.advance(1500);
          }

          return undefined;
        },
      },
      { clock: clock },
    );

    const run: OpenStackLifecycleRun = oneRun(
      await OpenStackLifecycleCheck.run(lifecycleJob(), harness.deps),
    );

    const durationOf: (step: OpenStackLifecycleStep) => number | undefined = (
      step: OpenStackLifecycleStep,
    ): number | undefined => {
      return run.steps.find((result: OpenStackLifecycleStepResult): boolean => {
        return result.step === step;
      })?.durationInMs;
    };

    expect(durationOf(OpenStackLifecycleStep.ServerCreate)).toBe(1500);
    // Three polls saw BUILD, each followed by its wait, and the fourth saw ACTIVE.
    expect(durationOf(OpenStackLifecycleStep.ServerActive)).toBe(
      getOpenStackCheckPollDelayInMs(0) +
        getOpenStackCheckPollDelayInMs(1) +
        getOpenStackCheckPollDelayInMs(2),
    );
  });

  test("runs each region on its own, and one failing costs the other nothing", async () => {
    const harness: Harness = createHarness();

    const runs: Array<OpenStackLifecycleRun> =
      await OpenStackLifecycleCheck.run(
        lifecycleJob({ regions: [RECORDED_REGION, "Elsewhere"] }),
        harness.deps,
      );

    const byRegion: Record<string, OpenStackLifecycleRun> = {};

    for (const run of runs) {
      byRegion[run.regionName] = run;
    }

    expect(byRegion[RECORDED_REGION]?.status).toBe("Succeeded");
    expect(byRegion["Elsewhere"]?.status).toBe("Failed");
    expect(byRegion["Elsewhere"]?.failedStep).toBe(
      OpenStackLifecycleStep.Prepare,
    );
    expect(byRegion["Elsewhere"]?.fault?.message).toContain("Elsewhere");
    expect(byRegion["Elsewhere"]?.writeCount).toBe(0);
    expect(harness.cloud.everythingLeft()).toEqual([]);
  });
});

describe("a failed run names its step and the fault", () => {
  test("Nova's fault, at the wait for ACTIVE, and the server is still deleted", async () => {
    const harness: Harness = createHarness({
      // What the rig's own failing instance recorded, on every release.
      bootFault: { code: 500, message: "No valid host was found. " },
    });

    const run: OpenStackLifecycleRun = oneRun(
      await OpenStackLifecycleCheck.run(
        lifecycleJob({
          options: { isFloatingIpEnabled: true, isVolumeEnabled: true },
        }),
        harness.deps,
      ),
    );

    expect(run.status).toBe("Failed");
    expect(run.failedStep).toBe(OpenStackLifecycleStep.ServerActive);
    expect(run.fault).toEqual({
      source: "nova",
      code: 500,
      message: "No valid host was found.",
    });
    expect(stepsOf(run)).toEqual([
      "token:Passed",
      "credential_check:Passed",
      "prepare:Passed",
      "janitor:Passed",
      "security_group_create:Passed",
      "server_create:Passed",
      "server_active:Failed",
      "server_delete:Passed",
      "security_group_delete:Passed",
    ]);
    // What it never got to says nothing, so an incident open on it is not closed by this.
    expect(run.phases[OpenStackLifecyclePhase.Boot]).toBe("Failed");
    expect(run.phases[OpenStackLifecyclePhase.FloatingIp]).toBe("NotReached");
    expect(run.phases[OpenStackLifecyclePhase.Volume]).toBe("NotReached");
    expect(run.phases[OpenStackLifecyclePhase.Cleanup]).toBe("Passed");
    expect(harness.pings).toEqual([]);
    expect(harness.cloud.everythingLeft()).toEqual([]);
  });

  test("a server that never leaves BUILD, as with nothing to schedule it, fails at the limit and says what it was", async () => {
    const harness: Harness = createHarness({ neverActive: true });

    const run: OpenStackLifecycleRun = oneRun(
      await OpenStackLifecycleCheck.run(lifecycleJob(), harness.deps),
    );

    expect(run.failedStep).toBe(OpenStackLifecycleStep.ServerActive);
    expect(run.fault?.source).toBe("nova");
    expect(run.fault?.message).toContain("The server never reached ACTIVE");
    expect(run.fault?.message).toContain("10 minutes");
    expect(run.fault?.message).toContain("still says BUILD");
    expect(harness.cloud.everythingLeft()).toEqual([]);

    const active: OpenStackLifecycleStepResult | undefined = run.steps.find(
      (step: OpenStackLifecycleStepResult): boolean => {
        return step.step === OpenStackLifecycleStep.ServerActive;
      },
    );

    expect(active?.durationInMs).toBeLessThanOrEqual(
      SERVER_ACTIVE_TIMEOUT_IN_MS,
    );
    expect(active?.durationInMs).toBeGreaterThan(
      SERVER_ACTIVE_TIMEOUT_IN_MS - 11_000,
    );
  });

  test("Nova's refusal of the request itself, in its own words", async () => {
    const harness: Harness = createHarness({
      answer: (request: OpenStackHttpRequest) => {
        if (request.method === "POST" && request.url.endsWith("/servers")) {
          return {
            status: 403,
            headers: {},
            body: JSON.stringify({
              forbidden: {
                code: 403,
                message:
                  "Quota exceeded for instances: Requested 1, but already used 3 of 3 instances",
              },
            }),
          };
        }

        return undefined;
      },
    });

    const run: OpenStackLifecycleRun = oneRun(
      await OpenStackLifecycleCheck.run(lifecycleJob(), harness.deps),
    );

    expect(run.failedStep).toBe(OpenStackLifecycleStep.ServerCreate);
    expect(run.fault).toEqual({
      source: "nova",
      code: 403,
      message:
        "Quota exceeded for instances: Requested 1, but already used 3 of 3 instances",
    });
    expect(harness.cloud.writes()).toEqual([
      "POST /identity/v3/auth/tokens",
      "POST /compute/v2.1/servers",
    ]);
  });

  test("a create that timed out and made a server anyway: the list at the end finds it and deletes it", async () => {
    const harness: Harness = createHarness();
    const realTransport: typeof harness.cloud.transport =
      harness.cloud.transport;
    let isDone: boolean = false;

    const deps: OpenStackCheckDependencies = {
      ...harness.deps,
      createTransport: () => {
        return {
          transport: async (request: OpenStackHttpRequest) => {
            const answer: Awaited<ReturnType<typeof realTransport>> =
              await realTransport(request);

            if (
              !isDone &&
              request.method === "POST" &&
              request.url.endsWith("/compute/v2.1/servers")
            ) {
              isDone = true;
              const timeout: Error = new Error("timed out");
              (timeout as unknown as { code: string }).code = "ETIMEDOUT";
              throw timeout;
            }

            return answer;
          },
          close: (): void => {
            // Nothing to close.
          },
        };
      },
    };

    const run: OpenStackLifecycleRun = oneRun(
      await OpenStackLifecycleCheck.run(lifecycleJob(), deps),
    );

    expect(run.failedStep).toBe(OpenStackLifecycleStep.ServerCreate);
    expect(run.fault?.source).toBe("probe");
    expect(harness.cloud.everythingLeft()).toEqual([]);
    expect(run.warnings.join(" ")).toContain("Deleted 1 of this run's own");
    expect(run.leftoverCount).toBe(0);
  });

  test("a floating IP that does not answer costs that part: the boot passed, and the volume is still tried", async () => {
    const harness: Harness = createHarness(
      {},
      {
        answersPing: (): boolean => {
          return false;
        },
      },
    );

    const run: OpenStackLifecycleRun = oneRun(
      await OpenStackLifecycleCheck.run(
        lifecycleJob({
          options: { isFloatingIpEnabled: true, isVolumeEnabled: true },
        }),
        harness.deps,
      ),
    );

    expect(run.status).toBe("Failed");
    expect(run.failedStep).toBe(OpenStackLifecycleStep.Ping);
    expect(run.fault?.source).toBe("probe");
    expect(run.fault?.message).toContain(`No reply from ${FLOATING_ADDRESS}`);
    expect(run.fault?.message).toContain("Neutron says its status is ACTIVE");
    expect(run.phases[OpenStackLifecyclePhase.Boot]).toBe("Passed");
    expect(run.phases[OpenStackLifecyclePhase.FloatingIp]).toBe("Failed");
    expect(run.phases[OpenStackLifecyclePhase.Volume]).toBe("Passed");
    expect(harness.cloud.everythingLeft()).toEqual([]);
  });

  test("a floating IP Neutron gives as something other than an address is never pinged", async () => {
    for (const address of [
      "-f",
      "--help",
      "8.8.8.8; reboot",
      "$(reboot)",
      "127.0.0.1",
      "169.254.169.254",
      "::1",
      "",
    ]) {
      const harness: Harness = createHarness({
        answer: (request: OpenStackHttpRequest) => {
          if (
            request.method === "POST" &&
            request.url.endsWith("/floatingips")
          ) {
            return {
              status: 201,
              headers: {},
              body: JSON.stringify({
                floatingip: { id: "a-fip", floating_ip_address: address },
              }),
            };
          }

          return undefined;
        },
      });

      const run: OpenStackLifecycleRun = oneRun(
        await OpenStackLifecycleCheck.run(
          lifecycleJob({ options: { isFloatingIpEnabled: true } }),
          harness.deps,
        ),
      );

      expect(run.failedStep).toBe(OpenStackLifecycleStep.Ping);
      expect(harness.pings).toEqual([]);
    }
  });

  test("Cinder's own message when a volume fails, and the rest of the run still cleans up", async () => {
    const harness: Harness = createHarness({
      volumeErrorMessage:
        "schedule allocate volume:Could not find any available weighted backend.",
    });

    const run: OpenStackLifecycleRun = oneRun(
      await OpenStackLifecycleCheck.run(
        lifecycleJob({ options: { isVolumeEnabled: true } }),
        harness.deps,
      ),
    );

    expect(run.failedStep).toBe(OpenStackLifecycleStep.VolumeCreate);
    expect(run.fault).toEqual({
      source: "cinder",
      message:
        "schedule allocate volume:Could not find any available weighted backend.",
    });
    expect(run.phases[OpenStackLifecyclePhase.Boot]).toBe("Passed");
    expect(run.phases[OpenStackLifecyclePhase.Volume]).toBe("Failed");
    expect(harness.cloud.everythingLeft()).toEqual([]);
  });

  test("an attach Nova rolled back: says what Nova's action says, since nothing else did", async () => {
    const harness: Harness = createHarness({ attachRollsBack: true });

    const run: OpenStackLifecycleRun = oneRun(
      await OpenStackLifecycleCheck.run(
        lifecycleJob({ options: { isVolumeEnabled: true } }),
        harness.deps,
      ),
    );

    expect(run.failedStep).toBe(OpenStackLifecycleStep.VolumeAttach);
    expect(run.fault?.source).toBe("nova");
    expect(run.fault?.message).toContain("attach_volume");
    expect(run.fault?.message).toContain("Error");
    expect(harness.cloud.everythingLeft()).toEqual([]);

    // Rolled back means not attached: nothing to detach.
    expect(harness.cloud.writes()).not.toContain(
      "DELETE /compute/v2.1/servers/{server}/os-volume_attachments/{volume}",
    );
  });

  test("a failure while cleaning up is a failed run, and the run says what it left", async () => {
    const harness: Harness = createHarness({
      answer: (request: OpenStackHttpRequest) => {
        if (
          request.method === "DELETE" &&
          request.url.includes("/compute/v2.1/servers/")
        ) {
          return {
            status: 500,
            headers: {},
            body: JSON.stringify({
              computeFault: { code: 500, message: "It went wrong." },
            }),
          };
        }

        return undefined;
      },
    });

    const run: OpenStackLifecycleRun = oneRun(
      await OpenStackLifecycleCheck.run(lifecycleJob(), harness.deps),
    );

    expect(run.status).toBe("Failed");
    expect(run.failedStep).toBe(OpenStackLifecycleStep.ServerDelete);
    expect(run.fault?.message).toBe("It went wrong.");
    expect(run.phases[OpenStackLifecyclePhase.Boot]).toBe("Passed");
    expect(run.phases[OpenStackLifecyclePhase.Cleanup]).toBe("Failed");
    expect(run.leftoverCount).toBe(1);
    expect(harness.cloud.everythingLeft()).toHaveLength(1);
  });

  test("a Keystone that is down: the run fails at its first step, and nothing is asked of anyone else", async () => {
    const harness: Harness = createHarness({
      answer: (request: OpenStackHttpRequest) => {
        if (request.url.endsWith("/auth/tokens")) {
          return {
            status: 503,
            headers: {},
            body: "<html>Service Unavailable</html>",
          };
        }

        return undefined;
      },
    });

    const run: OpenStackLifecycleRun = oneRun(
      await OpenStackLifecycleCheck.run(lifecycleJob(), harness.deps),
    );

    expect(run.status).toBe("Failed");
    expect(run.failedStep).toBe(OpenStackLifecycleStep.Token);
    expect(run.fault?.source).toBe("keystone");
    expect(harness.cloud.log).toEqual(["POST /identity/v3/auth/tokens"]);
  });

  test("a credential Keystone refuses is not repeated into a lockout", async () => {
    const backoff: OpenStackBackoffMemory = new OpenStackBackoffMemory();
    const harness: Harness = createHarness(
      {
        answer: (request: OpenStackHttpRequest) => {
          if (request.url.endsWith("/auth/tokens")) {
            return { status: 401, headers: {}, body: "{}" };
          }

          return undefined;
        },
      },
      { backoff: backoff },
    );

    const first: OpenStackLifecycleRun = oneRun(
      await OpenStackLifecycleCheck.run(lifecycleJob(), harness.deps),
    );

    expect(first.failedStep).toBe(OpenStackLifecycleStep.Token);
    expect(harness.cloud.log).toHaveLength(1);

    harness.clock.advance(MINUTE);

    const second: OpenStackLifecycleRun = oneRun(
      await OpenStackLifecycleCheck.run(lifecycleJob(), harness.deps),
    );

    // Held back: no second try at the credential.
    expect(harness.cloud.log).toHaveLength(1);
    expect(second.failedStep).toBe(OpenStackLifecycleStep.Token);
    expect(second.fault?.message).toContain("locks an account");
  });
});

describe("it refuses a credential that could reach further than its own project", () => {
  type RefusalCase = [
    string,
    Partial<MockLifecycleOptions>,
    Partial<OpenStackLifecycleCheckJob>,
    string,
  ];

  const CASES: Array<RefusalCase> = [
    [
      "scoped to another project",
      { project: { id: OTHER_PROJECT_ID, name: "payments" } },
      {},
      "scoped to project payments",
    ],
    [
      "not scoped to a project at all",
      { project: null },
      {},
      "not scoped to a project",
    ],
    [
      "a project of the same name with another id",
      {},
      { pinnedProjectId: OTHER_PROJECT_ID },
      "A project of that name is not the same project",
    ],
    [
      "the admin role",
      { roleNames: ["member", "admin"] },
      {},
      "has the admin role",
    ],
    ["Admin in another case", { roleNames: ["Admin"] }, {}, "Admin role"],
    [
      "a role with admin in its name",
      { roleNames: ["cloud_admin"] },
      {},
      "cloud_admin",
    ],
    ["the service role", { roleNames: ["service"] }, {}, "service role"],
    [
      "Keystone's admin project",
      { isAdminProject: true },
      {},
      "its admin project",
    ],
    [
      "an unrestricted application credential",
      { isUnrestricted: true },
      {},
      "--unrestricted",
    ],
    [
      "a role called something harmless that can read like an admin",
      { roleNames: ["ops"], answersAdminReads: true },
      {},
      "can see further than its project",
    ],
    [
      "this check given the cloud's own admin project by name",
      { project: { id: CHECK_PROJECT_ID, name: "admin" } },
      { expectedProjectName: "admin" },
      "is the cloud's own",
    ],
    [
      "this check given the cloud's own service project by name",
      { project: { id: CHECK_PROJECT_ID, name: "service" } },
      { expectedProjectName: "service" },
      "is the cloud's own",
    ],
  ];

  test.each(CASES)(
    "%s: it says why, and writes nothing at all",
    async (
      _name: string,
      options: Partial<MockLifecycleOptions>,
      job: Partial<OpenStackLifecycleCheckJob>,
      says: string,
    ) => {
      const harness: Harness = createHarness(options);

      const run: OpenStackLifecycleRun = oneRun(
        await OpenStackLifecycleCheck.run(
          lifecycleJob({
            options: { isFloatingIpEnabled: true, isVolumeEnabled: true },
            ...job,
          }),
          harness.deps,
        ),
      );

      expect(run.status).toBe("Refused");
      expect(run.message).toContain(says);
      expect(run.writeCount).toBe(0);

      // The login is the one thing it posts, and nothing is ever deleted.
      expect(harness.cloud.writes()).toEqual(["POST /identity/v3/auth/tokens"]);
      expect(harness.pings).toEqual([]);
    },
  );

  test("the refusal is checked before each run, not only the first", async () => {
    const clock: FakeClock = createFakeClock();
    const harness: Harness = createHarness({}, { clock: clock });

    const first: OpenStackLifecycleRun = oneRun(
      await OpenStackLifecycleCheck.run(lifecycleJob(), harness.deps),
    );

    expect(first.status).toBe("Succeeded");

    // Someone gives the credential's user the admin role.
    harness.cloud.options.roleNames = ["member", "admin"];
    clock.advance(INTERVAL_IN_MINUTES * MINUTE);

    const before: number = harness.cloud.writes().length;

    const second: OpenStackLifecycleRun = oneRun(
      await OpenStackLifecycleCheck.run(lifecycleJob(), harness.deps),
    );

    expect(second.status).toBe("Refused");
    expect(harness.cloud.writes().slice(before)).toEqual([
      "POST /identity/v3/auth/tokens",
    ]);
  });

  test("a read that cannot say whether it is refused is not a no: nothing is written", async () => {
    const harness: Harness = createHarness({
      answer: (request: OpenStackHttpRequest) => {
        if (request.url.includes("/os-hypervisors")) {
          return { status: 503, headers: {}, body: "<html></html>" };
        }

        return undefined;
      },
    });

    const run: OpenStackLifecycleRun = oneRun(
      await OpenStackLifecycleCheck.run(lifecycleJob(), harness.deps),
    );

    expect(run.status).toBe("Failed");
    expect(run.failedStep).toBe(OpenStackLifecycleStep.CredentialCheck);
    expect(harness.cloud.writes()).toEqual(["POST /identity/v3/auth/tokens"]);
  });

  test("Neutron's empty answer to a member is not reach: it answers 200 and no rows, as recorded", async () => {
    const harness: Harness = createHarness();

    const run: OpenStackLifecycleRun = oneRun(
      await OpenStackLifecycleCheck.run(lifecycleJob(), harness.deps),
    );

    expect(run.status).toBe("Succeeded");
  });

  test("a token renewed part way is held to the same project, and nothing more is written", async () => {
    const clock: FakeClock = createFakeClock();

    // Near its end when the boot's first write is due, so a new one is bought before it.
    const harness: Harness = createHarness(
      { tokenLifeInMinutes: 1 },
      { clock: clock },
    );

    harness.cloud.options.answer = (request: OpenStackHttpRequest) => {
      if (
        request.method === "GET" &&
        request.url.includes("/networking/v2.0/networks")
      ) {
        // The next login is for another project.
        harness.cloud.options.project = {
          id: OTHER_PROJECT_ID,
          name: CHECK_PROJECT_NAME,
        };
      }

      return undefined;
    };

    const run: OpenStackLifecycleRun = oneRun(
      await OpenStackLifecycleCheck.run(lifecycleJob(), harness.deps),
    );

    expect(run.status).toBe("Refused");
    expect(run.message).toContain("not the same project");
    expect(harness.cloud.writes()).toEqual([
      "POST /identity/v3/auth/tokens",
      "POST /identity/v3/auth/tokens",
    ]);
  });
});

describe("the janitor", () => {
  const INTERVAL_MS: number = INTERVAL_IN_MINUTES * MINUTE;
  const LIMIT_MS: number = getOpenStackJanitorAgeInMs(INTERVAL_IN_MINUTES);
  const OLD_AT: number = COLLECTED_AT_MS - LIMIT_MS - MINUTE;

  test("removes everything named for this check once it is older than two intervals, and nothing else", async () => {
    const harness: Harness = createHarness();
    const oldAt: Date = new Date(OLD_AT);

    harness.cloud.addFloatingIp({
      id: "old-fip",
      description: nameFor({ part: "fip", at: OLD_AT }),
      createdAt: oldAt,
    });
    harness.cloud.addServer({
      id: "old-server",
      name: nameFor({ part: "server", at: OLD_AT }),
      createdAt: oldAt,
    });
    harness.cloud.addVolume({
      id: "old-volume",
      name: nameFor({ part: "volume", at: OLD_AT }),
      createdAt: oldAt,
    });
    harness.cloud.addSecurityGroup({
      id: "old-sg",
      name: nameFor({ part: "sg", at: OLD_AT }),
      createdAt: oldAt,
    });

    const run: OpenStackLifecycleRun = oneRun(
      await OpenStackLifecycleCheck.run(lifecycleJob(), harness.deps),
    );

    expect(run.status).toBe("Succeeded");
    expect(harness.cloud.everythingLeft()).toEqual([]);
    expect(
      run.janitor?.removed
        .map((one: OpenStackCheckRemovedResource) => {
          return one.id;
        })
        .sort(),
    ).toEqual(["old-fip", "old-server", "old-sg", "old-volume"]);
    expect(run.janitor?.remainingCount).toBe(0);

    // An address first, then its server, then what its server held.
    expect(
      harness.cloud.writes().filter((line: string): boolean => {
        return line.startsWith("DELETE") && line.includes("{old-");
      }),
    ).toEqual([
      "DELETE /networking/v2.0/floatingips/{old-fip}",
      "DELETE /compute/v2.1/servers/{old-server}",
      "DELETE /volume/v3/volumes/{old-volume}",
      "DELETE /networking/v2.0/security-groups/{old-sg}",
    ]);
  });

  test("a name that merely looks like the check's is never touched, however old", async () => {
    const harness: Harness = createHarness();
    const longAgo: Date = new Date(COLLECTED_AT_MS - 365 * 24 * 60 * MINUTE);
    const real: string = nameFor({ part: "server", at: OLD_AT });

    const lookalikes: Array<string> = [
      "oneuptime-check",
      "oneuptime-check-",
      "oneuptime-check-web",
      "oneuptime-check-web-1",
      "oneuptime-checkout",
      "oneuptime-checks-20261104115000-abcdef-server",
      `not-${real}`,
      `${real}-old`,
      `${real}-copy`,
      `${real} `,
      ` ${real}`,
      real.toUpperCase(),
      real.replace("oneuptime", "OneUptime"),
      real.replace("-server", "-Server"),
      real.replace("-server", "-servers"),
      // Another check's, on the same project.
      nameFor({ part: "server", at: OLD_AT, checkKey: "ffffffffffff" }),
      // Not a real moment: the 31st of June.
      `oneuptime-check-${CHECK_KEY}-20260631120000-abcdef-server`,
      `oneuptime-check-${CHECK_KEY}-2026110411500-abcdef-server`,
      `oneuptime-check-${CHECK_KEY}-20261104115000-abcde-server`,
      `oneuptime-check-${CHECK_KEY}-20261104115000-ABCDEF-server`,
      `oneuptime-check-${CHECK_KEY}-20261104115000-abcdef-`,
      `oneuptime-check-${CHECK_KEY}-20261104115000-abcdef`,
      // A volume's name on a server.
      nameFor({ part: "volume", at: OLD_AT }),
      nameFor({ part: "fip", at: OLD_AT }),
      nameFor({ part: "sg", at: OLD_AT }),
    ];

    lookalikes.forEach((name: string, index: number) => {
      harness.cloud.addServer({
        id: `person-${index}`,
        name: name,
        createdAt: longAgo,
      });
    });

    const realVolumeName: string = nameFor({ part: "volume", at: OLD_AT });

    harness.cloud.addVolume({
      id: "person-volume",
      name: realVolumeName.replace("-volume", "-volume2"),
      createdAt: longAgo,
    });
    harness.cloud.addVolume({
      id: "person-volume-named-as-a-server",
      name: real,
      createdAt: longAgo,
    });
    harness.cloud.addFloatingIp({
      id: "person-fip",
      description: "oneuptime-check: please keep",
      createdAt: longAgo,
    });
    harness.cloud.addFloatingIp({
      id: "person-fip-named-for-a-server",
      description: real,
      createdAt: longAgo,
    });
    harness.cloud.addSecurityGroup({
      id: "person-sg",
      name: "oneuptime-check-web",
      createdAt: longAgo,
    });
    harness.cloud.addSecurityGroup({
      id: "default-sg",
      name: "default",
      createdAt: longAgo,
    });

    const run: OpenStackLifecycleRun = oneRun(
      await OpenStackLifecycleCheck.run(lifecycleJob(), harness.deps),
    );

    expect(run.status).toBe("Succeeded");
    expect(run.janitor?.removed).toEqual([]);

    // What was deleted is what this run made, and only that.
    expect(
      harness.cloud.writes().filter((line: string): boolean => {
        return line.startsWith("DELETE");
      }),
    ).toEqual(["DELETE /compute/v2.1/servers/{server}"]);

    for (const lookalike of lookalikes) {
      expect(harness.cloud.everythingLeft()).toContain(lookalike);
    }

    expect(harness.cloud.everythingLeft()).toHaveLength(lookalikes.length + 6);
    expect(run.warnings.join(" ")).toContain("not a project of its own");
  });

  test("something named for this check in another project is not this check's, whatever a list says", async () => {
    const harness: Harness = createHarness();
    const oldAt: Date = new Date(OLD_AT);

    harness.cloud.addServer({
      id: "someone-elses",
      name: nameFor({ part: "server", at: OLD_AT }),
      createdAt: oldAt,
      project: OTHER_PROJECT_ID,
    });
    harness.cloud.addFloatingIp({
      id: "someone-elses-fip",
      description: nameFor({ part: "fip", at: OLD_AT }),
      createdAt: oldAt,
      project: OTHER_PROJECT_ID,
    });
    harness.cloud.addSecurityGroup({
      id: "someone-elses-sg",
      name: nameFor({ part: "sg", at: OLD_AT }),
      createdAt: oldAt,
      project: OTHER_PROJECT_ID,
    });

    const run: OpenStackLifecycleRun = oneRun(
      await OpenStackLifecycleCheck.run(lifecycleJob(), harness.deps),
    );

    expect(run.janitor?.removed).toEqual([]);
    expect(harness.cloud.everythingLeft()).toHaveLength(3);
  });

  test("older than one interval and not two: left alone, and the run goes on", async () => {
    const harness: Harness = createHarness();
    const at: number = COLLECTED_AT_MS - INTERVAL_MS - MINUTE;
    const left: string = nameFor({ part: "server", at: at });

    harness.cloud.addServer({
      id: "old-server",
      name: left,
      createdAt: new Date(at),
    });

    const run: OpenStackLifecycleRun = oneRun(
      await OpenStackLifecycleCheck.run(lifecycleJob(), harness.deps),
    );

    expect(run.status).toBe("Succeeded");
    expect(run.janitor?.removed).toEqual([]);
    expect(run.janitor?.remainingCount).toBe(1);
    expect(harness.cloud.everythingLeft()).toEqual([left]);
  });

  test("exactly two intervals is not older than two intervals", async () => {
    const harness: Harness = createHarness();
    const at: number = COLLECTED_AT_MS - LIMIT_MS;
    const left: string = nameFor({ part: "server", at: at });

    harness.cloud.addServer({
      id: "old-server",
      name: left,
      createdAt: new Date(at),
    });

    await OpenStackLifecycleCheck.run(lifecycleJob(), harness.deps);

    expect(harness.cloud.everythingLeft()).toEqual([left]);
  });

  test("a name that says old on something the service says is young is as young as the service says", async () => {
    const harness: Harness = createHarness();
    const nameAt: number = COLLECTED_AT_MS - 10 * LIMIT_MS;
    const left: string = nameFor({ part: "server", at: nameAt });

    harness.cloud.addServer({
      id: "renamed-yesterday",
      name: left,
      createdAt: new Date(COLLECTED_AT_MS - INTERVAL_MS - MINUTE),
    });

    const run: OpenStackLifecycleRun = oneRun(
      await OpenStackLifecycleCheck.run(lifecycleJob(), harness.deps),
    );

    expect(run.janitor?.removed).toEqual([]);
    expect(harness.cloud.everythingLeft()).toEqual([left]);
  });

  test("Cinder's times have no zone, and are read as UTC whatever this machine's zone is", () => {
    expect(readOpenStackCreatedAt("2026-11-04T12:33:57.000000")).toBe(
      Date.UTC(2026, 10, 4, 12, 33, 57),
    );
    expect(readOpenStackCreatedAt("2026-11-04T12:33:57Z")).toBe(
      Date.UTC(2026, 10, 4, 12, 33, 57),
    );
    expect(readOpenStackCreatedAt("2026-11-04T12:33:57+02:00")).toBe(
      Date.UTC(2026, 10, 4, 10, 33, 57),
    );
    expect(readOpenStackCreatedAt("not a time")).toBeNull();
    expect(readOpenStackCreatedAt("")).toBeNull();
    expect(readOpenStackCreatedAt(undefined)).toBeNull();
    expect(readOpenStackCreatedAt(12345)).toBeNull();
  });

  test("a volume attached to a server this check did not make is left as it is, and it says so", async () => {
    const harness: Harness = createHarness();

    harness.cloud.addServer({
      id: "someones-server",
      name: "web-1",
      createdAt: new Date(OLD_AT),
    });
    harness.cloud.addVolume({
      id: "old-volume",
      name: nameFor({ part: "volume", at: OLD_AT }),
      createdAt: new Date(OLD_AT),
      status: "in-use",
      attachedTo: "someones-server",
    });

    const run: OpenStackLifecycleRun = oneRun(
      await OpenStackLifecycleCheck.run(lifecycleJob(), harness.deps),
    );

    expect(run.status).toBe("Failed");
    expect(run.failedStep).toBe(OpenStackLifecycleStep.Janitor);
    expect(run.fault?.message).toContain("which this check did not make");
    expect(run.phases[OpenStackLifecyclePhase.Boot]).toBe("Passed");
    expect(harness.cloud.writes()).not.toContain(
      "DELETE /volume/v3/volumes/{old-volume}",
    );
    expect(harness.cloud.volumes.has("old-volume")).toBe(true);
    expect(harness.cloud.servers.has("someones-server")).toBe(true);
  });

  test("a security group a port still holds is left for the next run, and is not a failure", async () => {
    const harness: Harness = createHarness({ securityGroupInUseCount: 1 });

    harness.cloud.addSecurityGroup({
      id: "old-sg",
      name: nameFor({ part: "sg", at: OLD_AT }),
      createdAt: new Date(OLD_AT),
    });

    const run: OpenStackLifecycleRun = oneRun(
      await OpenStackLifecycleCheck.run(lifecycleJob(), harness.deps),
    );

    expect(run.status).toBe("Succeeded");
    expect(run.janitor?.removed).toEqual([]);
    expect(run.janitor?.remainingCount).toBe(1);
  });

  test("a delete a service refuses is a failed step, and the boot is still judged on its own", async () => {
    const harness: Harness = createHarness({
      answer: (request: OpenStackHttpRequest) => {
        if (request.method === "DELETE" && request.url.includes("old-server")) {
          return {
            status: 500,
            headers: {},
            body: JSON.stringify({
              computeFault: { code: 500, message: "It went wrong." },
            }),
          };
        }

        return undefined;
      },
    });

    harness.cloud.addServer({
      id: "old-server",
      name: nameFor({ part: "server", at: OLD_AT }),
      createdAt: new Date(OLD_AT),
    });

    const run: OpenStackLifecycleRun = oneRun(
      await OpenStackLifecycleCheck.run(lifecycleJob(), harness.deps),
    );

    expect(run.failedStep).toBe(OpenStackLifecycleStep.Janitor);
    expect(run.phases[OpenStackLifecyclePhase.Boot]).toBe("Passed");
    expect(run.phases[OpenStackLifecyclePhase.Cleanup]).toBe("Failed");
    expect(run.janitor?.remainingCount).toBe(1);
  });

  test("still deletes what earlier runs left when what this run wants to boot has gone", async () => {
    const harness: Harness = createHarness();

    harness.cloud.images = [];
    harness.cloud.addServer({
      id: "old-server",
      name: nameFor({ part: "server", at: OLD_AT }),
      createdAt: new Date(OLD_AT),
    });

    const run: OpenStackLifecycleRun = oneRun(
      await OpenStackLifecycleCheck.run(lifecycleJob(), harness.deps),
    );

    expect(run.failedStep).toBe(OpenStackLifecycleStep.Prepare);
    expect(run.fault?.source).toBe("glance");
    expect(harness.cloud.everythingLeft()).toEqual([]);
    expect(
      harness.cloud.writes().filter((line: string): boolean => {
        return line.startsWith("POST /compute");
      }),
    ).toEqual([]);
  });
});

describe("a run killed part way", () => {
  /*
   * A run whose process has gone: no request of it is answered again, and it never reaches its own
   * clean-up. What it made is exactly what was there when it died.
   */
  async function killPartWay(data: {
    clock: FakeClock;
    dieOn: (request: OpenStackHttpRequest) => boolean;
    options?: Record<string, unknown> | undefined;
  }): Promise<Harness> {
    const harness: Harness = createHarness(
      { dieOn: data.dieOn },
      { clock: data.clock },
    );

    // Left running on purpose: it never returns, which is what a killed process does.
    OpenStackLifecycleCheck.run(
      lifecycleJob({
        options: { isFloatingIpEnabled: true, isVolumeEnabled: true },
      }),
      harness.deps,
    ).catch(() => {
      // It never settles.
    });

    // Long enough for every answered request of the run to have been made.
    for (let turn: number = 0; turn < 500 && !harness.cloud.isDead; turn++) {
      await new Promise<void>((resolve: () => void) => {
        setImmediate(resolve);
      });
    }

    expect(harness.cloud.isDead).toBe(true);

    return harness;
  }

  const diesAtVolumeAttach: (request: OpenStackHttpRequest) => boolean = (
    request: OpenStackHttpRequest,
  ): boolean => {
    return (
      request.method === "POST" &&
      request.url.endsWith("/os-volume_attachments")
    );
  };

  test("leaves everything it made, for now", async () => {
    const harness: Harness = await killPartWay({
      clock: createFakeClock(),
      dieOn: diesAtVolumeAttach,
    });

    expect(harness.cloud.everythingLeft()).toEqual([
      `oneuptime-check-${CHECK_KEY}-20261104115000-000001-fip`,
      `oneuptime-check-${CHECK_KEY}-20261104115000-000001-server`,
      `oneuptime-check-${CHECK_KEY}-20261104115000-000001-sg`,
      `oneuptime-check-${CHECK_KEY}-20261104115000-000001-volume`,
    ]);
  });

  test("the next run within the time a run can take is skipped: one may still be going", async () => {
    const clock: FakeClock = createFakeClock();
    const harness: Harness = await killPartWay({
      clock: clock,
      dieOn: diesAtVolumeAttach,
    });

    harness.cloud.isDead = false;
    harness.cloud.options.dieOn = undefined;

    clock.advance(5 * MINUTE);

    const before: number = harness.cloud.log.length;
    const left: Array<string> = harness.cloud.everythingLeft();

    const run: OpenStackLifecycleRun = oneRun(
      await OpenStackLifecycleCheck.run(lifecycleJob(), harness.deps),
    );

    expect(run.status).toBe("Skipped");
    expect(run.message).toContain("another run may be going");
    expect(run.writeCount).toBe(0);
    expect(harness.cloud.everythingLeft()).toEqual(left);
    expect(
      harness.cloud.log.slice(before).filter((line: string): boolean => {
        return line.startsWith("POST") && !line.includes("/auth/tokens");
      }),
    ).toEqual([]);
  });

  test("a later run goes ahead beside what is left, and the one after two intervals clears it", async () => {
    const clock: FakeClock = createFakeClock();
    const harness: Harness = await killPartWay({
      clock: clock,
      dieOn: diesAtVolumeAttach,
    });

    harness.cloud.isDead = false;
    harness.cloud.options.dieOn = undefined;

    const left: Array<string> = harness.cloud.everythingLeft();

    expect(left).toHaveLength(4);

    // The next run on the schedule: it has its own, and leaves the dead one's alone.
    clock.advance(INTERVAL_IN_MINUTES * MINUTE);

    const second: OpenStackLifecycleRun = oneRun(
      await OpenStackLifecycleCheck.run(lifecycleJob(), harness.deps),
    );

    expect(second.status).toBe("Succeeded");
    expect(second.janitor?.removed).toEqual([]);
    expect(second.janitor?.remainingCount).toBe(4);
    expect(harness.cloud.everythingLeft()).toEqual(left);

    // Two intervals and a moment after the run that died.
    clock.advance(INTERVAL_IN_MINUTES * MINUTE + MINUTE);

    const third: OpenStackLifecycleRun = oneRun(
      await OpenStackLifecycleCheck.run(lifecycleJob(), harness.deps),
    );

    expect(third.status).toBe("Succeeded");
    expect(
      third.janitor?.removed
        .map((one: OpenStackCheckRemovedResource) => {
          return one.name;
        })
        .sort(),
    ).toEqual(left);
    expect(third.janitor?.remainingCount).toBe(0);
    expect(harness.cloud.everythingLeft()).toEqual([]);
  });

  /*
   * Killed at every request of a run in turn: whichever moment it was, what is left is named for the
   * check, and the janitor takes all of it.
   */
  test("wherever it dies, the janitor clears all of it", async () => {
    const whole: Harness = createHarness();

    await OpenStackLifecycleCheck.run(
      lifecycleJob({
        options: { isFloatingIpEnabled: true, isVolumeEnabled: true },
      }),
      whole.deps,
    );

    const total: number = whole.cloud.log.length;

    expect(total).toBeGreaterThan(30);

    for (let diesAt: number = 1; diesAt <= total; diesAt++) {
      const clock: FakeClock = createFakeClock();
      let seen: number = 0;

      const harness: Harness = await killPartWay({
        clock: clock,
        dieOn: (): boolean => {
          seen += 1;
          return seen === diesAt;
        },
      });

      harness.cloud.isDead = false;
      harness.cloud.options.dieOn = undefined;

      clock.advance(
        getOpenStackJanitorAgeInMs(INTERVAL_IN_MINUTES) + 2 * MINUTE,
      );

      const run: OpenStackLifecycleRun = oneRun(
        await OpenStackLifecycleCheck.run(lifecycleJob(), harness.deps),
      );

      expect(harness.cloud.everythingLeft()).toEqual([]);
      expect(run.status).toBe("Succeeded");
    }
  });
});

describe("when the check is turned off, it only sweeps", () => {
  test("no run, nothing created, what is old is deleted, and it says what remains", async () => {
    const harness: Harness = createHarness();
    const limit: number = getOpenStackJanitorAgeInMs(INTERVAL_IN_MINUTES);
    const oldAt: number = COLLECTED_AT_MS - limit - MINUTE;
    const youngAt: number = COLLECTED_AT_MS - MINUTE;

    harness.cloud.addServer({
      id: "old-server",
      name: nameFor({ part: "server", at: oldAt }),
      createdAt: new Date(oldAt),
    });

    const young: string = nameFor({ part: "volume", at: youngAt });

    harness.cloud.addVolume({
      id: "young-volume",
      name: young,
      createdAt: new Date(youngAt),
    });

    const run: OpenStackLifecycleRun = oneRun(
      await OpenStackLifecycleCheck.run(
        lifecycleJob({ isSweepOnly: true }),
        harness.deps,
      ),
    );

    expect(run.status).toBe("Swept");
    expect(
      run.janitor?.removed.map((one: OpenStackCheckRemovedResource) => {
        return one.id;
      }),
    ).toEqual(["old-server"]);
    expect(run.janitor?.remainingCount).toBe(1);
    expect(harness.cloud.everythingLeft()).toEqual([young]);
    expect(harness.cloud.writes()).toEqual([
      "POST /identity/v3/auth/tokens",
      "DELETE /compute/v2.1/servers/{old-server}",
    ]);
  });

  test("still refuses a credential it should not write with", async () => {
    const harness: Harness = createHarness({ roleNames: ["admin"] });

    const run: OpenStackLifecycleRun = oneRun(
      await OpenStackLifecycleCheck.run(
        lifecycleJob({ isSweepOnly: true }),
        harness.deps,
      ),
    );

    expect(run.status).toBe("Refused");
    expect(harness.cloud.writes()).toEqual(["POST /identity/v3/auth/tokens"]);
  });
});

describe("what it boots", () => {
  test("names given in the settings are used, by name or by id", async () => {
    const harness: Harness = createHarness();

    await OpenStackLifecycleCheck.run(
      lifecycleJob({
        options: {
          flavor: "m1.tiny",
          image: "ubuntu-24.04",
          network: "aaaaaaaa-0000-4000-8000-000000000001",
        },
      }),
      harness.deps,
    );

    const body: string =
      harness.cloud.requests.find((request: OpenStackHttpRequest): boolean => {
        return request.method === "POST" && request.url.endsWith("/servers");
      })?.body || "";

    expect(JSON.parse(body)).toMatchObject({
      server: {
        flavorRef: "1",
        imageRef: "bbbbbbbb-0000-4000-8000-000000000002",
        networks: [{ uuid: "aaaaaaaa-0000-4000-8000-000000000001" }],
      },
    });
  });

  type PrepareCase = [
    string,
    () => Partial<OpenStackLifecycleCheckJob>,
    string,
  ];

  const PREPARE_CASES: Array<PrepareCase> = [
    [
      "an image that is not there",
      () => {
        return { options: { image: "gone" } };
      },
      "no image called gone",
    ],
    [
      "a flavor that is not there",
      () => {
        return { options: { flavor: "gone" } };
      },
      "no flavor called gone",
    ],
    [
      "a network that is not there",
      () => {
        return { options: { network: "gone" } };
      },
      "no network called gone",
    ],
  ];

  test.each(PREPARE_CASES)(
    "%s: fails at prepare, and creates nothing",
    async (
      _name: string,
      job: () => Partial<OpenStackLifecycleCheckJob>,
      says: string,
    ) => {
      const harness: Harness = createHarness();

      const run: OpenStackLifecycleRun = oneRun(
        await OpenStackLifecycleCheck.run(lifecycleJob(job()), harness.deps),
      );

      expect(run.failedStep).toBe(OpenStackLifecycleStep.Prepare);
      expect(run.fault?.message).toContain(says);
      expect(harness.cloud.writes()).toEqual(["POST /identity/v3/auth/tokens"]);
    },
  );

  test("two external networks and no name: the floating IP part fails, and says to name one", async () => {
    const harness: Harness = createHarness();

    harness.cloud.networks = [
      ...harness.cloud.networks,
      {
        id: "aaaaaaaa-0000-4000-8000-000000000003",
        name: "public-2",
        "router:external": true,
        subnets: ["x"],
      },
    ];

    const run: OpenStackLifecycleRun = oneRun(
      await OpenStackLifecycleCheck.run(
        lifecycleJob({ options: { isFloatingIpEnabled: true } }),
        harness.deps,
      ),
    );

    expect(run.failedStep).toBe(OpenStackLifecycleStep.FloatingIpCreate);
    expect(run.fault?.message).toContain("several external networks");
    expect(run.phases[OpenStackLifecyclePhase.Boot]).toBe("Passed");
    expect(run.phases[OpenStackLifecyclePhase.FloatingIp]).toBe("Failed");
    expect(harness.cloud.everythingLeft()).toEqual([]);
  });

  test("the smallest flavor that fits the image, passing over one that is too small or disabled", () => {
    const image: JSONObject = { min_ram: 256, min_disk: 2, size: 1024 };
    const flavors: Array<JSONObject> = [
      { id: "too-small", ram: 128, disk: 10, vcpus: 1 },
      { id: "no-disk", ram: 512, disk: 0, vcpus: 1 },
      {
        id: "disabled",
        ram: 256,
        disk: 2,
        vcpus: 1,
        "OS-FLV-DISABLED:disabled": true,
      },
      { id: "fits-but-bigger", ram: 1024, disk: 20, vcpus: 2 },
      { id: "fits", ram: 512, disk: 2, vcpus: 1 },
    ];

    expect(
      chooseOpenStackCheckFlavor({ flavors: flavors, image: image })?.["id"],
    ).toBe("fits");
  });

  test("a flavor must hold the image's own size, whatever min_disk says", () => {
    const flavors: Array<JSONObject> = [
      { id: "one", ram: 512, disk: 1, vcpus: 1 },
      { id: "ten", ram: 512, disk: 10, vcpus: 1 },
    ];

    expect(
      chooseOpenStackCheckFlavor({
        flavors: flavors,
        image: { size: 5 * 1024 * 1024 * 1024, min_disk: 0, min_ram: 0 },
      })?.["id"],
    ).toBe("ten");
    expect(chooseOpenStackCheckFlavor({ flavors: [], image: {} })).toBeNull();
  });

  test("cirros if there is one, or the smallest image", () => {
    expect(
      chooseOpenStackCheckImage([
        { id: "big", name: "ubuntu", size: 100 },
        { id: "tiny", name: "alpine", size: 1 },
        { id: "cirros", name: "CirrOS 0.6", size: 50 },
      ])?.["id"],
    ).toBe("cirros");
    expect(
      chooseOpenStackCheckImage([
        { id: "big", name: "ubuntu", size: 100 },
        { id: "tiny", name: "alpine", size: 1 },
      ])?.["id"],
    ).toBe("tiny");
    expect(chooseOpenStackCheckImage([])).toBeNull();
  });

  test("the project's own network; a shared one if it has none; and it never guesses between several", () => {
    const own: Record<string, unknown> = {
      id: "own",
      name: "own",
      project_id: CHECK_PROJECT_ID,
      subnets: ["s"],
    };
    const shared: Record<string, unknown> = {
      id: "shared",
      name: "shared",
      project_id: OTHER_PROJECT_ID,
      subnets: ["s"],
    };
    const external: Record<string, unknown> = {
      id: "external",
      name: "public",
      "router:external": true,
      subnets: ["s"],
    };
    const noSubnet: Record<string, unknown> = {
      id: "empty",
      name: "empty",
      project_id: CHECK_PROJECT_ID,
      subnets: [],
    };

    const choose: (
      networks: Array<Record<string, unknown>>,
    ) => ReturnType<typeof chooseOpenStackCheckNetwork> = (
      networks: Array<Record<string, unknown>>,
    ): ReturnType<typeof chooseOpenStackCheckNetwork> => {
      return chooseOpenStackCheckNetwork({
        networks: networks as never,
        projectId: CHECK_PROJECT_ID,
      });
    };

    expect(choose([own, shared, external, noSubnet])).toEqual({ network: own });
    expect(choose([shared, external])).toEqual({ network: shared });
    expect(choose([external, noSubnet])).toHaveProperty("error");
    expect(
      (
        choose([own, { ...own, id: "own-2", name: "own-2" }]) as {
          error: string;
        }
      ).error,
    ).toContain("own, own-2");
  });

  test("a name two things share is not a name", () => {
    const rows: Array<JSONObject> = [
      { id: "1", name: "same" },
      { id: "2", name: "same" },
      { id: "3", name: "other" },
    ];

    expect(
      findOpenStackCheckByIdOrName({ rows: rows, wanted: "other", what: "x" }),
    ).toEqual({ row: rows[2] });
    expect(
      findOpenStackCheckByIdOrName({ rows: rows, wanted: "1", what: "x" }),
    ).toEqual({ row: rows[0] });
    expect(
      findOpenStackCheckByIdOrName({ rows: rows, wanted: "same", what: "x" }),
    ).toHaveProperty("error");
    expect(
      findOpenStackCheckByIdOrName({ rows: rows, wanted: "none", what: "x" }),
    ).toHaveProperty("error");
  });
});

describe("a run's time", () => {
  test("a run is over before the next is due, and always leaves time to delete what it made", () => {
    for (const interval of [15, 30, 60, 240, 1440]) {
      const budget: number = getOpenStackLifecycleRunBudgetInMs(interval);

      expect(budget).toBeLessThan(interval * MINUTE);
      expect(budget).toBeGreaterThan(CLEANUP_RESERVE_IN_MS);
    }

    expect(getOpenStackLifecycleRunBudgetInMs(30)).toBe(27 * MINUTE);
    expect(getOpenStackJanitorAgeInMs(30)).toBe(60 * MINUTE);
  });

  test("on the shortest interval a stuck boot still leaves time to delete what it made", async () => {
    const harness: Harness = createHarness({ neverActive: true });

    const run: OpenStackLifecycleRun = oneRun(
      await OpenStackLifecycleCheck.run(
        lifecycleJob({ intervalInMinutes: 15 }),
        harness.deps,
      ),
    );

    const active: OpenStackLifecycleStepResult | undefined = run.steps.find(
      (step: OpenStackLifecycleStepResult): boolean => {
        return step.step === OpenStackLifecycleStep.ServerActive;
      },
    );

    expect(active?.status).toBe("Failed");
    expect(active?.durationInMs).toBeLessThanOrEqual(
      getOpenStackLifecycleRunBudgetInMs(15) - CLEANUP_RESERVE_IN_MS,
    );
    expect(harness.cloud.everythingLeft()).toEqual([]);
  });

  test("a poll that fails is not the step failing: an API restarting part way is sat through", async () => {
    let failures: number = 3;

    const harness: Harness = createHarness({
      answer: (request: OpenStackHttpRequest) => {
        if (
          request.method === "GET" &&
          request.url.includes("/compute/v2.1/servers/dddddddd") &&
          failures > 0
        ) {
          failures -= 1;

          return { status: 503, headers: {}, body: "" };
        }

        return undefined;
      },
    });

    const run: OpenStackLifecycleRun = oneRun(
      await OpenStackLifecycleCheck.run(lifecycleJob(), harness.deps),
    );

    expect(run.status).toBe("Succeeded");
  });
});

describe("tracing", () => {
  test("with a key, a step's writes are signed, its polls are not, and the boot's trace is named", async () => {
    const harness: Harness = createHarness();

    const run: OpenStackLifecycleRun = oneRun(
      await OpenStackLifecycleCheck.run(
        lifecycleJob({ osProfilerKey: OSPROFILER_KEY }),
        harness.deps,
      ),
    );

    const signed: Array<string> = [];
    const notSigned: Array<string> = [];

    harness.cloud.requests.forEach(
      (request: OpenStackHttpRequest, index: number) => {
        const line: string = harness.cloud.log[index] as string;

        if (request.headers[OSPROFILER_TRACE_INFO_HEADER]) {
          expect(request.headers[OSPROFILER_TRACE_HMAC_HEADER]).toMatch(
            /^[0-9a-f]{40}$/,
          );
          signed.push(line);
        } else {
          notSigned.push(line);
        }
      },
    );

    expect(signed).toEqual([
      "POST /compute/v2.1/servers",
      "DELETE /compute/v2.1/servers/{server}",
    ]);
    expect(notSigned).toContain("GET /compute/v2.1/servers/{server}");
    expect(notSigned).toContain("POST /identity/v3/auth/tokens");

    // What the client prints as its Trace ID, without its dashes: the trace's id once stored.
    expect(run.traceId).toBe("4e3e0ec6293840b18504000000000001");
    expect(
      run.steps.find((step: OpenStackLifecycleStepResult): boolean => {
        return step.step === OpenStackLifecycleStep.ServerCreate;
      })?.traceId,
    ).toBe(run.traceId);
    // Each step its own trace, so the boot's holds the boot.
    expect(
      run.steps.find((step: OpenStackLifecycleStepResult): boolean => {
        return step.step === OpenStackLifecycleStep.ServerDelete;
      })?.traceId,
    ).toBe("4e3e0ec6293840b18504000000000002");
  });

  test("without a key nothing is signed and no trace is named", async () => {
    const harness: Harness = createHarness();

    const run: OpenStackLifecycleRun = oneRun(
      await OpenStackLifecycleCheck.run(lifecycleJob(), harness.deps),
    );

    for (const request of harness.cloud.requests) {
      expect(request.headers[OSPROFILER_TRACE_INFO_HEADER]).toBeUndefined();
      expect(request.headers[OSPROFILER_TRACE_HMAC_HEADER]).toBeUndefined();
    }

    expect(run.traceId).toBeUndefined();
  });
});
