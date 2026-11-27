import { XapiPoolSnapshot } from "../../../../Utils/XcpNg/XapiOpenMetrics";
import path from "path";

/*
 * The XAPI recording of the two-pool lab (Tests/Ops/Fixtures/XcpNg/
 * XapiLab.js): what each pool's master answers a probe reading it straight
 * from XAPI, for the very lab #10995 recorded from Xen Orchestra.
 */

export interface XapiLabHost {
  key: string;
  uuid: string;
  name: string;
  address: string;
  isRunning: boolean;
  isMaster: boolean;
}

export interface XapiLab {
  pool: "production" | "unnamed";
  poolId: string;
  scrape: 1 | 2;
  nowSeconds: number;
  masterHostUuid: string;
  masterRef: string;
  hosts: Array<XapiLabHost>;
  records: Record<string, Record<string, Record<string, unknown>>>;
  rrds: Record<string, string>;
}

interface XapiLabModule {
  buildXapiLab: (options: {
    pool: "production" | "unnamed";
    scrape: 1 | 2;
    nowSeconds: number;
  }) => XapiLab;
  HOST_ADDRESSES: Record<string, string>;
}

const LAB_MODULE_PATH: string = path.resolve(
  __dirname,
  "../../../../../../Tests/Ops/Fixtures/XcpNg/XapiLab.js",
);

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const labModule: XapiLabModule = require(LAB_MODULE_PATH) as XapiLabModule;

export function buildXapiLab(options: {
  pool: "production" | "unnamed";
  scrape: 1 | 2;
  nowSeconds: number;
}): XapiLab {
  return labModule.buildXapiLab(options);
}

// The lab as the port reads it: every record by class, and the RRDs read.
export function toSnapshot(
  lab: XapiLab,
  options?: { rrdHostUuids?: Array<string> | undefined },
): XapiPoolSnapshot {
  const records: XapiLab["records"] = lab.records;
  const rrdHostUuids: Array<string> =
    options?.rrdHostUuids || Object.keys(lab.rrds);

  return {
    pools: records["pool"] as unknown as XapiPoolSnapshot["pools"],
    hosts: records["host"] as unknown as XapiPoolSnapshot["hosts"],
    hostMetrics: records[
      "host_metrics"
    ] as unknown as XapiPoolSnapshot["hostMetrics"],
    vms: records["VM"] as unknown as XapiPoolSnapshot["vms"],
    vmMetrics: records[
      "VM_metrics"
    ] as unknown as XapiPoolSnapshot["vmMetrics"],
    srs: records["SR"] as unknown as XapiPoolSnapshot["srs"],
    pbds: records["PBD"] as unknown as XapiPoolSnapshot["pbds"],
    vdis: records["VDI"] as unknown as XapiPoolSnapshot["vdis"],
    vbds: records["VBD"] as unknown as XapiPoolSnapshot["vbds"],
    vifs: records["VIF"] as unknown as XapiPoolSnapshot["vifs"],
    pifs: records["PIF"] as unknown as XapiPoolSnapshot["pifs"],
    networks: records["network"] as unknown as XapiPoolSnapshot["networks"],
    rrds: rrdHostUuids
      .filter((hostUuid: string): boolean => {
        return lab.rrds[hostUuid] !== undefined;
      })
      .map((hostUuid: string) => {
        return { hostUuid: hostUuid, text: lab.rrds[hostUuid]! };
      }),
    nowSeconds: lab.nowSeconds,
  };
}
