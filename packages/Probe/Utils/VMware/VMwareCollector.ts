import {
  ClassifiedVMwareError,
  VMwareCollectionError,
  classifyVMwareError,
} from "./VMwareCollectionErrors";
import VMwareInventoryCollector from "./VMwareInventoryCollector";
import { VMwareInventorySnapshot } from "./VMwareInventory";
import VMwareOtlpBuilder, { VMwareOtlpBuildResult } from "./VMwareOtlpBuilder";
import { createVSphereTransport } from "./VSphereHttp";
import VSphereSessionCache, { getSessionKey } from "./VSphereSessionCache";
import VSphereSoapClient, {
  MoRef,
  VSphereObject,
  VSphereServiceContent,
  VSphereTransport,
} from "./VSphereSoapClient";
import { VSphereVerifyingAgent } from "./VSphereTls";
import { AppVersion } from "Common/Server/EnvironmentConfig";
import SSRFProtection, {
  ValidatedWebhookTarget,
  ValidatedWebhookTargetAddress,
} from "Common/Server/Utils/SSRFProtection";
import VMwareCollectionErrorCode from "Common/Types/VMware/VMwareCollectionError";
import {
  VMWARE_COLLECTION_MAX_PAYLOAD_BYTES,
  VMwareCollectionJob,
  VMwareCollectionReport,
  VMwareCollectionSummary,
  VMwareConnectionTestJob,
  VMwareConnectionTestReport,
} from "Common/Types/VMware/VMwareProbeCollection";
import VMwareVCenterAddress, {
  VCenterAddress,
  VCenterAddressResult,
} from "Common/Utils/VMware/VMwareVCenterAddress";

/*
 * One collection, or one connection test, from the address to the report:
 *
 *   1. the address is read as the server reads it, and checked - with every
 *      address it resolves to - against the addresses a probe never connects
 *      to (loopback, link-local, cloud metadata: SSRFProtection, the same
 *      guard as every other address a person types into OneUptime). The
 *      socket is pinned to those very addresses;
 *   2. vCenter is spoken to over a TLS connection verified before the first
 *      byte (VSphereTls), as the user saved, reusing the session of the last
 *      collection when it is still alive (VSphereSessionCache);
 *   3. the inventory and samples are read (VMwareInventoryCollector) and
 *      turned into the VMware agent's metrics (VMwareOtlpBuilder);
 *   4. whatever went wrong becomes a code and an exact sentence
 *      (VMwareCollectionErrors) - a report is always sent.
 *
 * The password never leaves this module except to vCenter, and never
 * appears in a report or a log line.
 */

export const VSPHERE_CONNECT_TIMEOUT_IN_MS: number = 15_000;
export const VSPHERE_REQUEST_TIMEOUT_IN_MS: number = 60_000;
export const VSPHERE_MAX_RESPONSE_BYTES: number = 64 * 1024 * 1024;
export const MAX_COLLECTION_TIME_IN_MS: number = 10 * 60_000;
export const TEST_TIME_IN_MS: number = 60_000;

export interface VMwareTransportHandle {
  transport: VSphereTransport;
  close: () => void;
}

export interface VMwareCollectorDependencies {
  // The addresses a vCenter address may be connected to (validated).
  resolve: (url: string) => Promise<Array<string>>;
  createTransport: (data: {
    address: VCenterAddress;
    pinnedAddresses: Array<string>;
    trustedFingerprint: string | null;
  }) => VMwareTransportHandle;
  now: () => Date;
  scopeVersion: string;
  collectVsan: boolean;
}

export async function resolveVCenterAddress(url: string): Promise<Array<string>> {
  const target: ValidatedWebhookTarget =
    await SSRFProtection.validateAndResolveWebhookTarget(url, {
      // A probe sits in the network it watches: vCenter is usually private.
      allowPrivateNetworkTargets: true,
      privateNetworkAccessIsAllowed: true,
      targetLabel: "vCenter address",
      includeResolutionDetailInError: true,
    });

  return target.addresses.map(
    (address: ValidatedWebhookTargetAddress): string => {
      return address.address;
    },
  );
}

export const DEFAULT_COLLECTOR_DEPENDENCIES: VMwareCollectorDependencies = {
  resolve: resolveVCenterAddress,
  createTransport: (data: {
    address: VCenterAddress;
    pinnedAddresses: Array<string>;
    trustedFingerprint: string | null;
  }): VMwareTransportHandle => {
    const agent: VSphereVerifyingAgent = new VSphereVerifyingAgent({
      host: data.address.host,
      port: data.address.port,
      pinnedAddresses: data.pinnedAddresses,
      trustedFingerprint: data.trustedFingerprint,
      connectTimeoutInMs: VSPHERE_CONNECT_TIMEOUT_IN_MS,
    });

    return {
      transport: createVSphereTransport({
        host: data.address.host,
        port: data.address.port,
        agent: agent,
        requestTimeoutInMs: VSPHERE_REQUEST_TIMEOUT_IN_MS,
        maxResponseBytes: VSPHERE_MAX_RESPONSE_BYTES,
      }),
      close: (): void => {
        agent.destroy();
      },
    };
  },
  now: (): Date => {
    return new Date();
  },
  scopeVersion: AppVersion,
  collectVsan: true,
};

const USER_AGENT: string = `OneUptime-Probe/${AppVersion} (VMware collection)`;

function withDeadline<T>(
  promise: Promise<T>,
  timeoutInMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline: Promise<never> = new Promise<never>(
    (_resolve: (value: never) => void, reject: (error: Error) => void) => {
      timer = setTimeout(() => {
        reject(new VMwareCollectionError(VMwareCollectionErrorCode.TimedOut, message));
      }, timeoutInMs);
    },
  );

  return Promise.race([promise, deadline]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

function summarize(data: {
  serviceContent: VSphereServiceContent | null;
  counts: Omit<
    VMwareCollectionSummary,
    | "warnings"
    | "productName"
    | "fullName"
    | "version"
    | "build"
    | "apiType"
    | "apiVersion"
    | "instanceUuid"
  >;
  warnings: Array<string>;
}): VMwareCollectionSummary {
  const summary: VMwareCollectionSummary = {
    ...data.counts,
    warnings: data.warnings.slice(0, 20),
  };

  const about: VSphereServiceContent["about"] | undefined =
    data.serviceContent?.about;

  if (about) {
    const fields: Array<
      [keyof VSphereServiceContent["about"], keyof VMwareCollectionSummary]
    > = [
      ["name", "productName"],
      ["fullName", "fullName"],
      ["version", "version"],
      ["build", "build"],
      ["apiType", "apiType"],
      ["apiVersion", "apiVersion"],
      ["instanceUuid", "instanceUuid"],
    ];

    for (const [from, to] of fields) {
      const value: string | null = about[from];

      if (value) {
        (summary as unknown as Record<string, unknown>)[to] = value;
      }
    }
  }

  return summary;
}

// The refusal for a login that sees nothing - the classic missing propagation.
function noInventoryError(username: string): VMwareCollectionError {
  return new VMwareCollectionError(
    VMwareCollectionErrorCode.NoPermission,
    `${username} logged in but sees no datacenter. Give it the Read-Only role on the top-level vCenter object, with Propagate to children ticked.`,
  );
}

export default class VMwareCollector {
  public static async collect(
    job: VMwareCollectionJob,
    dependencies: VMwareCollectorDependencies = DEFAULT_COLLECTOR_DEPENDENCIES,
  ): Promise<VMwareCollectionReport> {
    const startedAt: Date = dependencies.now();
    const report: VMwareCollectionReport = {
      vmwareVCenterId: job.vmwareVCenterId,
      settingsVersion: job.settingsVersion,
      collectedAt: startedAt.toISOString(),
      status: "Failed",
      durationInMs: 0,
    };

    const normalized: VCenterAddressResult = VMwareVCenterAddress.normalize(
      job.vcenterUrl,
    );

    if (!normalized.address) {
      report.errorCode = VMwareCollectionErrorCode.InvalidAddress;
      report.errorMessage = normalized.error;
      return report;
    }

    const address: VCenterAddress = normalized.address;
    const sessionKey: string = getSessionKey({
      vmwareVCenterId: job.vmwareVCenterId,
      vcenterUrl: address.url,
      username: job.username,
      password: job.password,
      trustedFingerprint: job.trustedCertificateFingerprint || null,
    });

    let handle: VMwareTransportHandle | null = null;

    const budgetInMs: number = Math.min(
      Math.max(job.collectionIntervalInMinutes, 1) * 60_000,
      MAX_COLLECTION_TIME_IN_MS,
    );

    try {
      const pinnedAddresses: Array<string> = await dependencies.resolve(
        address.url,
      );

      handle = dependencies.createTransport({
        address: address,
        pinnedAddresses: pinnedAddresses,
        trustedFingerprint: job.trustedCertificateFingerprint || null,
      });

      const activeClient: VSphereSoapClient = new VSphereSoapClient({
        transport: handle.transport,
        userAgent: USER_AGENT,
        sessionCookie: VSphereSessionCache.get(sessionKey),
      });
      activeClient.setCredentials(job.username, job.password);

      const snapshot: VMwareInventorySnapshot = await withDeadline(
        (async (): Promise<VMwareInventorySnapshot> => {
          await activeClient.negotiateVersion();
          await activeClient.retrieveServiceContent();

          if (!activeClient.hasSession()) {
            await activeClient.login(job.username, job.password);
          }

          return await new VMwareInventoryCollector(activeClient, {
            collectVsan: dependencies.collectVsan,
            now: dependencies.now,
          }).collect();
        })(),
        budgetInMs,
        `Collecting ${address.host} took longer than ${Math.round(
          budgetInMs / 60_000,
        )} minutes. Collect it less often, or check vCenter's load.`,
      );

      if (snapshot.datacenters.length === 0) {
        throw noInventoryError(job.username);
      }

      const built: VMwareOtlpBuildResult = VMwareOtlpBuilder.build(
        snapshot,
        dependencies.scopeVersion,
      );

      const payloadBytes: number = Buffer.byteLength(
        JSON.stringify(built.resourceMetrics),
      );

      if (payloadBytes > VMWARE_COLLECTION_MAX_PAYLOAD_BYTES) {
        throw new VMwareCollectionError(
          VMwareCollectionErrorCode.PayloadTooLarge,
          `This vCenter's collection is ${Math.round(
            payloadBytes / (1024 * 1024),
          )} MiB of metrics, more than the ${Math.round(
            VMWARE_COLLECTION_MAX_PAYLOAD_BYTES / (1024 * 1024),
          )} MiB one probe upload takes. Use the VMware agent for this vCenter.`,
        );
      }

      const warnings: Array<string> = [...snapshot.warnings, ...built.warnings];

      if (built.hostCount === 0) {
        warnings.unshift(
          `${job.username} sees datacenters but no hosts. Check that its Read-Only role is propagated to children.`,
        );
      }

      const cookie: string | null = activeClient.getSessionCookie();

      if (cookie) {
        VSphereSessionCache.set(sessionKey, cookie);
      }

      report.status = "Succeeded";
      report.resourceMetrics = built.resourceMetrics;
      report.summary = summarize({
        serviceContent: activeClient.getServiceContent(),
        counts: {
          datacenterCount: built.datacenterCount,
          clusterCount: built.clusterCount,
          hostCount: built.hostCount,
          vmCount: built.vmCount,
          poweredOnVmCount: built.poweredOnVmCount,
          templateCount: built.templateCount,
          datastoreCount: built.datastoreCount,
          resourcePoolCount: built.resourcePoolCount,
          resourceCount: built.resourceCount,
          datapointCount: built.datapointCount,
        },
        warnings: warnings,
      });
    } catch (error) {
      const classified: ClassifiedVMwareError = classifyVMwareError(error, {
        host: address.host,
        port: address.port,
        username: job.username,
      });

      if (
        classified.code === VMwareCollectionErrorCode.InvalidLogin ||
        classified.code === VMwareCollectionErrorCode.CertificateChanged ||
        classified.code === VMwareCollectionErrorCode.UntrustedCertificate
      ) {
        VSphereSessionCache.forget(sessionKey);
      }

      report.status = "Failed";
      report.errorCode = classified.code;
      report.errorMessage = classified.message;

      if (classified.presentedCertificate) {
        report.presentedCertificate = classified.presentedCertificate;
      }
    } finally {
      handle?.close();
    }

    report.durationInMs = Math.max(
      0,
      dependencies.now().getTime() - startedAt.getTime(),
    );

    return report;
  }

  /*
   * A connection test: log in, see how much of the inventory the user can
   * read, log out. Nothing is collected and nothing is kept.
   */
  public static async test(
    job: VMwareConnectionTestJob,
    dependencies: VMwareCollectorDependencies = DEFAULT_COLLECTOR_DEPENDENCIES,
  ): Promise<VMwareConnectionTestReport> {
    const startedAt: Date = dependencies.now();
    const report: VMwareConnectionTestReport = {
      vmwareVCenterConnectionTestId: job.vmwareVCenterConnectionTestId,
      status: "Failed",
      durationInMs: 0,
    };

    const normalized: VCenterAddressResult = VMwareVCenterAddress.normalize(
      job.vcenterUrl,
    );

    if (!normalized.address) {
      report.errorCode = VMwareCollectionErrorCode.InvalidAddress;
      report.errorMessage = normalized.error;
      return report;
    }

    const address: VCenterAddress = normalized.address;
    let handle: VMwareTransportHandle | null = null;

    try {
      const pinnedAddresses: Array<string> = await dependencies.resolve(
        address.url,
      );

      handle = dependencies.createTransport({
        address: address,
        pinnedAddresses: pinnedAddresses,
        trustedFingerprint: job.trustedCertificateFingerprint || null,
      });

      const client: VSphereSoapClient = new VSphereSoapClient({
        transport: handle.transport,
        userAgent: USER_AGENT,
      });

      report.summary = await withDeadline(
        VMwareCollector.testWithClient(client, job),
        TEST_TIME_IN_MS,
        `${address.host} did not finish the test within ${Math.round(
          TEST_TIME_IN_MS / 1000,
        )} seconds.`,
      );
      report.status = "Succeeded";
    } catch (error) {
      const classified: ClassifiedVMwareError = classifyVMwareError(error, {
        host: address.host,
        port: address.port,
        username: job.username,
      });

      report.status = "Failed";
      report.errorCode = classified.code;
      report.errorMessage = classified.message;

      if (classified.presentedCertificate) {
        report.presentedCertificate = classified.presentedCertificate;
      }
    } finally {
      handle?.close();
    }

    report.durationInMs = Math.max(
      0,
      dependencies.now().getTime() - startedAt.getTime(),
    );

    return report;
  }

  private static async testWithClient(
    client: VSphereSoapClient,
    job: VMwareConnectionTestJob,
  ): Promise<VMwareCollectionSummary> {
    await client.negotiateVersion();
    const content: VSphereServiceContent = await client.retrieveServiceContent();
    await client.login(job.username, job.password);

    try {
      const view: MoRef = await client.createContainerView({
        container: content.rootFolder,
        types: [
          "Datacenter",
          "ClusterComputeResource",
          "HostSystem",
          "VirtualMachine",
          "Datastore",
          "ResourcePool",
        ],
      });

      const count: (type: string, paths: Array<string>) => Promise<
        Array<VSphereObject>
      > = async (
        type: string,
        paths: Array<string>,
      ): Promise<Array<VSphereObject>> => {
        return await client.retrieveFromView({
          view: view,
          type: type,
          paths: paths,
          maxObjects: 500,
        });
      };

      try {
        const datacenters: Array<VSphereObject> = await count("Datacenter", [
          "name",
        ]);

        if (datacenters.length === 0) {
          throw noInventoryError(job.username);
        }

        const clusters: Array<VSphereObject> = await count(
          "ClusterComputeResource",
          ["name"],
        );
        const hosts: Array<VSphereObject> = await count("HostSystem", ["name"]);
        const vms: Array<VSphereObject> = await count("VirtualMachine", [
          "config.template",
          "runtime.powerState",
        ]);
        const datastores: Array<VSphereObject> = await count("Datastore", [
          "name",
        ]);
        const pools: Array<VSphereObject> = await count("ResourcePool", [
          "name",
        ]);

        let vmCount: number = 0;
        let poweredOnVmCount: number = 0;
        let templateCount: number = 0;

        for (const vm of vms) {
          if (vm.properties.get("config.template")?.text.trim() === "true") {
            templateCount++;
            continue;
          }

          vmCount++;

          if (
            vm.properties.get("runtime.powerState")?.text.trim() === "poweredOn"
          ) {
            poweredOnVmCount++;
          }
        }

        const warnings: Array<string> = [];

        if (hosts.length === 0) {
          warnings.push(
            `${job.username} sees datacenters but no hosts. Check that its Read-Only role is propagated to children.`,
          );
        }

        return summarize({
          serviceContent: content,
          counts: {
            datacenterCount: datacenters.length,
            clusterCount: clusters.length,
            hostCount: hosts.length,
            vmCount: vmCount,
            poweredOnVmCount: poweredOnVmCount,
            templateCount: templateCount,
            datastoreCount: datastores.length,
            resourcePoolCount: pools.filter((pool: VSphereObject): boolean => {
              return pool.ref.type !== "VirtualApp";
            }).length,
          },
          warnings: warnings,
        });
      } finally {
        try {
          await client.destroyView(view);
        } catch {
          // The session ends just below.
        }
      }
    } finally {
      try {
        await client.logout();
      } catch {
        // A test that could not log out leaves a session vCenter times out.
      }
    }
  }
}
