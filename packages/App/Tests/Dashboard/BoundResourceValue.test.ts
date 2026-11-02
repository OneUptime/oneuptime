import { describe, expect, test } from "@jest/globals";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import boundResourceValue from "../../FeatureSet/Dashboard/src/Components/Form/Monitor/InfrastructureMonitorSetup/BoundResourceValue";
import fs from "fs";
import path from "path";

/*
 * An infrastructure monitor's resource field shows the resource its step is
 * bound to (InfrastructureResourceBinding) when the step's value names no
 * option any more: a cluster renamed since the monitor was saved, or a host
 * name typed "Web-01" for the host ingest stores as "web-01". It showed an
 * empty picker, as if the monitor watched nothing.
 */

interface Cluster {
  _id?: string;
  name: string;
}

const CLUSTERS: Array<Cluster> = [
  { _id: "c-1", name: "pve-production" },
  { _id: "c-2", name: "pve-dr" },
];

function toOption(record: Cluster): DropdownOption {
  return { value: record.name, label: record.name };
}

function shown(step: { value: string; resourceId?: string }): string {
  return boundResourceValue<Cluster>({
    step,
    options: CLUSTERS.map(toOption),
    records: CLUSTERS,
    toOption,
  });
}

describe("boundResourceValue", () => {
  test("a value that is an option is shown as it is", () => {
    expect(shown({ value: "pve-dr", resourceId: "c-1" })).toBe("pve-dr");
  });

  test("a renamed resource is shown by its current name", () => {
    expect(shown({ value: "pve-prod", resourceId: "c-1" })).toBe(
      "pve-production",
    );
  });

  test("a value differing in case from its resource shows the resource", () => {
    expect(shown({ value: "PVE-DR", resourceId: "c-2" })).toBe("pve-dr");
  });

  test("an unbound value, or one bound to a resource not listed, is shown as it is", () => {
    expect(shown({ value: "pve-prod" })).toBe("pve-prod");
    expect(shown({ value: "pve-prod", resourceId: "c-9" })).toBe("pve-prod");
  });

  test("a record without an id never matches", () => {
    expect(
      boundResourceValue<Cluster>({
        step: { value: "old", resourceId: "undefined" },
        options: [],
        records: [{ name: "new" }],
        toOption,
      }),
    ).toBe("old");
  });
});

describe("every infrastructure monitor form shows its step's bound resource", () => {
  const FORMS_DIR: string = path.join(
    __dirname,
    "../../FeatureSet/Dashboard/src/Components/Form/Monitor",
  );

  const FORMS: Array<{ file: string; step: string; field: string }> = [
    {
      file: "HostMonitor/HostMonitorStepForm.tsx",
      step: "monitorStepHostMonitor",
      field: "hostIdentifier",
    },
    {
      file: "DockerMonitor/DockerMonitorStepForm.tsx",
      step: "monitorStepDockerMonitor",
      field: "hostIdentifier",
    },
    {
      file: "PodmanMonitor/PodmanMonitorStepForm.tsx",
      step: "monitorStepPodmanMonitor",
      field: "hostIdentifier",
    },
    {
      file: "KubernetesMonitor/KubernetesMonitorStepForm.tsx",
      step: "monitorStepKubernetesMonitor",
      field: "clusterIdentifier",
    },
    {
      file: "DockerSwarmMonitor/DockerSwarmMonitorStepForm.tsx",
      step: "monitorStepDockerSwarmMonitor",
      field: "clusterIdentifier",
    },
    {
      file: "ProxmoxMonitor/ProxmoxMonitorStepForm.tsx",
      step: "monitorStepProxmoxMonitor",
      field: "clusterIdentifier",
    },
    {
      file: "VMwareMonitor/VMwareMonitorStepForm.tsx",
      step: "monitorStepVMwareMonitor",
      field: "vcenterIdentifier",
    },
    {
      file: "CephMonitor/CephMonitorStepForm.tsx",
      step: "monitorStepCephMonitor",
      field: "clusterIdentifier",
    },
    {
      file: "StorageArrayMonitor/StorageArrayMonitorStepForm.tsx",
      step: "monitorStepStorageArrayMonitor",
      field: "arrayIdentifier",
    },
    {
      file: "IoTMonitor/IoTMonitorStepForm.tsx",
      step: "monitorStepIoTMonitor",
      field: "fleetIdentifier",
    },
  ];

  test.each(FORMS)(
    "$file",
    (form: { file: string; step: string; field: string }) => {
      const source: string = fs
        .readFileSync(path.join(FORMS_DIR, form.file), "utf8")
        .replace(/\s+/g, " ");

      expect(source).toMatch(
        new RegExp(
          `value=\\{\\w+\\.valueOf\\(\\{ value: ${form.step}\\.${form.field}, resourceId: ${form.step}\\.resourceId, \\}\\)\\}`,
        ),
      );
    },
  );
});
