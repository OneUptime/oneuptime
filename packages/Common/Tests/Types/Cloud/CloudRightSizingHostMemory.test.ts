import { describe, expect, test } from "@jest/globals";
import {
  CLOUD_RIGHT_SIZING_HOST_NAME_MAX_LENGTH,
  CLOUD_RIGHT_SIZING_MIN_OBSERVED_HOURS,
  CLOUD_RIGHT_SIZING_MIN_SAMPLES,
  CloudMemoryReading,
  CloudMemorySource,
  CloudRightSizing,
  CloudRightSizingEvidence,
  CloudRightSizingProfile,
  CloudRightSizingVerdict,
  CloudUsageObservation,
  buildCloudRightSizing,
  chooseCloudMemoryReading,
  getCloudRightSizingProfile,
  isCloudHostVmProfile,
  isCloudMemoryReadingUsable,
  readCloudRightSizingEvidence,
  toCloudRightSizingEvidence,
  withCloudMemoryReading,
} from "../../../Types/Cloud/CloudRightSizing";

/*
 * RIGHT-SIZING ON THE MEMORY THE HOST READS (#11013). A VM's cloud reads
 * its memory only with an agent of its own inside (the CloudWatch agent,
 * the Ops Agent) or not at all (an Azure VM reports the memory left), so
 * a VM was often sized by its CPU alone. When OneUptime's host collector
 * runs on it, the host's used memory sizes it instead: once the host has
 * the history the CPU needs (6 days, 288 readings), and - where both read
 * it - the source with more readings, its cloud's on a tie. Its sizing
 * and its saving's evidence say where the memory came from.
 */

const HOST: { id: string; name: string } = { id: "host-1", name: "web-1" };
const WEEK_HOURS: number = 7 * 24;

function profile(provider: string, type: string): CloudRightSizingProfile {
  const found: CloudRightSizingProfile | null = getCloudRightSizingProfile(
    provider,
    type,
  );

  if (!found) {
    throw new Error(`No right-sizing profile for ${provider} ${type}.`);
  }

  return found;
}

const EC2: CloudRightSizingProfile = profile("aws", "AWS::EC2::Instance");
const AZURE_VM: CloudRightSizingProfile = profile(
  "azure",
  "Microsoft.Compute/virtualMachines",
);
const GCE: CloudRightSizingProfile = profile("gcp", "gce_instance");
const RDS: CloudRightSizingProfile = profile("aws", "AWS::RDS::DBInstance");

function observation(
  overrides: Partial<CloudUsageObservation> = {},
): CloudUsageObservation {
  return {
    cpuP95Percent: 12,
    cpuMaxPercent: 30,
    memoryPeakPercent: null,
    samples: 2016,
    observedHours: WEEK_HOURS,
    ...overrides,
  };
}

function hostReading(
  overrides: Partial<CloudMemoryReading> = {},
): CloudMemoryReading {
  return {
    source: CloudMemorySource.Host,
    peakPercent: 30,
    samples: 2016,
    observedHours: WEEK_HOURS,
    host: HOST,
    ...overrides,
  };
}

describe("which profiles are VMs a host collector runs on", () => {
  test("EC2 instances, Compute Engine VMs and Azure VMs; no database", () => {
    expect(isCloudHostVmProfile(EC2)).toBe(true);
    expect(isCloudHostVmProfile(AZURE_VM)).toBe(true);
    expect(isCloudHostVmProfile(GCE)).toBe(true);
    expect(isCloudHostVmProfile(RDS)).toBe(false);
  });
});

describe("a memory reading that can size a resource", () => {
  test("its cloud's, as it comes, with a reading", () => {
    expect(
      isCloudMemoryReadingUsable({
        source: CloudMemorySource.Cloud,
        peakPercent: 40,
        samples: 3,
        observedHours: 1,
      }),
    ).toBe(true);
    expect(
      isCloudMemoryReadingUsable({
        source: CloudMemorySource.Cloud,
        peakPercent: null,
        samples: 3000,
        observedHours: WEEK_HOURS,
      }),
    ).toBe(false);
    expect(isCloudMemoryReadingUsable(null)).toBe(false);
  });

  test(`a host's, only with the history the CPU must have: ${CLOUD_RIGHT_SIZING_MIN_SAMPLES} readings over ${CLOUD_RIGHT_SIZING_MIN_OBSERVED_HOURS / 24} days`, () => {
    expect(isCloudMemoryReadingUsable(hostReading())).toBe(true);
    expect(
      isCloudMemoryReadingUsable(
        hostReading({
          samples: CLOUD_RIGHT_SIZING_MIN_SAMPLES,
          observedHours: CLOUD_RIGHT_SIZING_MIN_OBSERVED_HOURS,
        }),
      ),
    ).toBe(true);
    expect(
      isCloudMemoryReadingUsable(
        hostReading({ samples: CLOUD_RIGHT_SIZING_MIN_SAMPLES - 1 }),
      ),
    ).toBe(false);
    expect(
      isCloudMemoryReadingUsable(
        hostReading({
          observedHours: CLOUD_RIGHT_SIZING_MIN_OBSERVED_HOURS - 1,
        }),
      ),
    ).toBe(false);
    expect(
      isCloudMemoryReadingUsable(hostReading({ peakPercent: Number.NaN })),
    ).toBe(false);
  });
});

describe("choosing between the cloud's memory and the host's", () => {
  const cloud: CloudMemoryReading = {
    source: CloudMemorySource.Cloud,
    peakPercent: 55,
    samples: 2016,
    observedHours: WEEK_HOURS,
  };

  test("the one usable, or the one with more readings, the cloud's on a tie", () => {
    expect(chooseCloudMemoryReading({ cloud, host: null })).toBe(cloud);
    expect(chooseCloudMemoryReading({ cloud: null, host: hostReading() })).toEqual(
      hostReading(),
    );
    expect(
      chooseCloudMemoryReading({
        cloud,
        host: hostReading({ samples: 4032 }),
      })?.source,
    ).toBe(CloudMemorySource.Host);
    expect(
      chooseCloudMemoryReading({ cloud, host: hostReading({ samples: 2016 }) })
        ?.source,
    ).toBe(CloudMemorySource.Cloud);
    expect(
      chooseCloudMemoryReading({
        cloud: { ...cloud, samples: 5000 },
        host: hostReading({ samples: 4032 }),
      })?.source,
    ).toBe(CloudMemorySource.Cloud);
  });

  test("a host too new to size by never wins, and nothing usable is nothing", () => {
    expect(
      chooseCloudMemoryReading({
        cloud,
        host: hostReading({ samples: 100000, observedHours: 24 }),
      })?.source,
    ).toBe(CloudMemorySource.Cloud);
    expect(
      chooseCloudMemoryReading({
        cloud: null,
        host: hostReading({ observedHours: 24 }),
      }),
    ).toBeNull();
  });
});

describe("an observation with the memory it is sized by", () => {
  test("a VM its cloud reads no memory of, sized on its host's", () => {
    expect(
      withCloudMemoryReading({ observation: observation(), host: hostReading() }),
    ).toEqual({
      ...observation(),
      memoryPeakPercent: 30,
      memorySamples: 2016,
      memorySource: CloudMemorySource.Host,
      memoryHost: HOST,
      memoryHostPending: undefined,
    });
  });

  test("its cloud's own reading stays when it has more readings than the host", () => {
    const sized: CloudUsageObservation = withCloudMemoryReading({
      observation: observation({ memoryPeakPercent: 62, memorySamples: 4032 }),
      host: hostReading(),
    });

    expect(sized.memoryPeakPercent).toBe(62);
    expect(sized.memorySource).toBe(CloudMemorySource.Cloud);
    expect(sized.memoryHost).toBeUndefined();
  });

  test("a host that has read too little yet is named, with its days, and sizes nothing", () => {
    const sized: CloudUsageObservation = withCloudMemoryReading({
      observation: observation(),
      host: hostReading({ samples: 500, observedHours: 50 }),
    });

    expect(sized.memoryPeakPercent).toBeNull();
    expect(sized.memorySource).toBeUndefined();
    expect(sized.memoryHostPending).toEqual({ host: HOST, observedDays: 2 });
  });

  test("no host: the observation as it was", () => {
    expect(
      withCloudMemoryReading({
        observation: observation({ memoryPeakPercent: 40, memorySamples: 10 }),
        host: null,
      }),
    ).toEqual({
      ...observation({ memoryPeakPercent: 40, memorySamples: 10 }),
      memorySource: CloudMemorySource.Cloud,
      memoryHost: undefined,
      memoryHostPending: undefined,
    });
  });
});

describe("a VM sized on its host's memory", () => {
  test("an Azure VM, whose cloud reports only the memory left, is sized on memory once its host reads it", () => {
    const byCpu: CloudRightSizing = buildCloudRightSizing({
      profile: AZURE_VM,
      size: "Standard_D8s_v5",
      observation: observation({ cpuP95Percent: 10, cpuMaxPercent: 20 }),
    });

    expect(byCpu.isMemoryRead).toBe(false);
    expect(byCpu.memorySource).toBeNull();
    expect(byCpu.canHostReadMemory).toBe(true);

    // Its memory peaks at 60%: a quarter of the size would hold 240%, half 120%.
    const byHost: CloudRightSizing = buildCloudRightSizing({
      profile: AZURE_VM,
      size: "Standard_D8s_v5",
      observation: withCloudMemoryReading({
        observation: observation({ cpuP95Percent: 10, cpuMaxPercent: 20 }),
        host: hostReading({ peakPercent: 60 }),
      }),
    });

    expect(byHost.isMemoryRead).toBe(true);
    expect(byHost.memorySource).toBe(CloudMemorySource.Host);
    expect(byHost.memoryHost).toEqual(HOST);
    expect(byHost.memoryPeakPercent).toBe(60);
    expect(byHost.memoryNotRead).toBeUndefined();
    // By its CPU alone it would shrink; its memory says it cannot.
    expect(byCpu.verdict).toBe(CloudRightSizingVerdict.Overprovisioned);
    expect(byHost.verdict).not.toBe(CloudRightSizingVerdict.Overprovisioned);
  });

  test("a host's light memory lets a VM shrink as far as its CPU does", () => {
    const sized: CloudRightSizing = buildCloudRightSizing({
      profile: EC2,
      size: "m5.2xlarge",
      observation: withCloudMemoryReading({
        observation: observation({ cpuP95Percent: 10, cpuMaxPercent: 20 }),
        host: hostReading({ peakPercent: 12 }),
      }),
    });

    expect(sized.verdict).toBe(CloudRightSizingVerdict.Overprovisioned);
    expect(sized.recommendedSize).toBe("m5.large");
    expect(sized.factor).toBe(4);
    expect(sized.projectedMemoryPeakPercent).toBe(48);
  });

  test("a host's memory never sizes what is not a VM, such as a database", () => {
    const sized: CloudRightSizing = buildCloudRightSizing({
      profile: RDS,
      size: "db.m5.2xlarge",
      observation: observation({
        memoryPeakPercent: 90,
        memorySource: CloudMemorySource.Host,
      }),
    });

    expect(sized.memorySource).not.toBe(CloudMemorySource.Host);
    expect(sized.canHostReadMemory).toBe(false);
  });

  test("a VM whose host has read too little says so instead of asking for a collector it has", () => {
    const sized: CloudRightSizing = buildCloudRightSizing({
      profile: GCE,
      size: "n2-standard-8",
      observation: withCloudMemoryReading({
        observation: observation(),
        host: hostReading({ samples: 200, observedHours: 72 }),
      }),
    });

    expect(sized.isMemoryRead).toBe(false);
    expect(sized.memoryHostPending).toEqual({ host: HOST, observedDays: 3 });
  });
});

describe("a right-sizing's evidence, as Savings keeps it", () => {
  function sizedOnHost(name: string): CloudRightSizing {
    return buildCloudRightSizing({
      profile: EC2,
      size: "m5.2xlarge",
      observation: withCloudMemoryReading({
        observation: observation({ cpuP95Percent: 10, cpuMaxPercent: 20 }),
        host: hostReading({ peakPercent: 12.34, host: { id: "h", name } }),
      }),
    });
  }

  test("says the memory was the host's, and names the host, read back as kept", () => {
    const evidence: CloudRightSizingEvidence = toCloudRightSizingEvidence(
      sizedOnHost("web-1"),
    );

    expect(evidence.memorySource).toBe(CloudMemorySource.Host);
    expect(evidence.memoryHostName).toBe("web-1");
    expect(evidence.memoryPeakPercent).toBe(12.3);
    expect(readCloudRightSizingEvidence(JSON.parse(JSON.stringify(evidence)))).toEqual(
      evidence,
    );
  });

  test(`a host's name is kept to ${CLOUD_RIGHT_SIZING_HOST_NAME_MAX_LENGTH} characters, whoever wrote it`, () => {
    const evidence: CloudRightSizingEvidence = toCloudRightSizingEvidence(
      sizedOnHost("h".repeat(500)),
    );

    expect(evidence.memoryHostName).toHaveLength(
      CLOUD_RIGHT_SIZING_HOST_NAME_MAX_LENGTH,
    );
    expect(
      readCloudRightSizingEvidence({
        ...evidence,
        memoryHostName: "x".repeat(900),
      })?.memoryHostName,
    ).toHaveLength(CLOUD_RIGHT_SIZING_HOST_NAME_MAX_LENGTH);
  });

  test("evidence kept before says nothing of a source; a host named without memory names none", () => {
    const before: CloudRightSizingEvidence | null =
      readCloudRightSizingEvidence({
        cpuP95Percent: 10,
        cpuMaxPercent: 20,
        memoryPeakPercent: 30,
        observedDays: 7,
        factor: 2,
        isSavingUpperBound: false,
      });

    expect(before?.memorySource).toBeUndefined();
    expect(
      readCloudRightSizingEvidence({
        cpuP95Percent: 10,
        cpuMaxPercent: 20,
        memoryPeakPercent: null,
        observedDays: 7,
        factor: 2,
        isSavingUpperBound: false,
        memorySource: CloudMemorySource.Host,
        memoryHostName: "web-1",
      }),
    ).toEqual({
      cpuP95Percent: 10,
      cpuMaxPercent: 20,
      memoryPeakPercent: null,
      observedDays: 7,
      factor: 2,
      isSavingUpperBound: false,
    });
  });
});
