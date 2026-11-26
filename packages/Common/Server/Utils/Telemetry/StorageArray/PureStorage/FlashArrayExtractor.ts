import StorageArrayResourceKind from "../../../../../Types/StorageArray/StorageArrayResourceKind";
import PureStorageFlashArrayPlatform from "../../../../../Types/StorageArray/Platforms/PureStorage/FlashArray/FlashArrayPlatform";
import {
  StorageArrayExtractor,
  StorageArrayResourceBufferEntry,
  StorageArraySeries,
  markStorageArrayKindComplete,
  recordHostVolumeConnection,
} from "../StorageArrayExtractor";
import {
  PurePerformanceFamily,
  applyPurePerformance,
  applyPurePerformanceDimension,
  applyPureSpaceDimension,
  getPurePerformanceFamily,
  lowerOrNull,
  readPureArrayDataReductionRatio,
  readPureArraySpaceBytes,
  readPureArraySpaceUtilization,
  readPureInfo,
  readPureOpenAlert,
} from "./PureStorageSeries";

/*
 * PURE STORAGE FLASHARRAY: one purefa_* datapoint into the array's
 * inventory and snapshot.
 *
 * Its families, by the endpoint the agent reads them from:
 *
 *   - /metrics/array: the array's identity (purefa_info), capacity and data
 *     reduction, its open alerts, and its hardware - components and their
 *     temperatures, drives, controllers and network interfaces;
 *   - /metrics/volumes, /metrics/hosts, /metrics/pods and
 *     /metrics/directories: each object's space, data reduction and
 *     performance, a host's connectivity and the volumes connected to it,
 *     a pod's replica links and mediator.
 *
 * Every series that lists the objects of a kind marks the kind complete for
 * the batch, so its count is written (StorageArraySnapshotScan's derive).
 */

function readHardware(series: StorageArraySeries): void {
  const metricName: string = series.metricName;

  if (metricName === "purefa_hw_component_status") {
    const componentName: string | null = series.label("component_name");
    if (!componentName) {
      return;
    }
    markStorageArrayKindComplete(
      series.array,
      StorageArrayResourceKind.Hardware,
    );
    const patch: StorageArrayResourceBufferEntry = series.newResource(
      StorageArrayResourceKind.Hardware,
      componentName,
    );
    patch.name = componentName;
    patch.status = lowerOrNull(series.label("component_status"));
    patch.componentType = series.label("component_type");
    series.fold(patch);
    return;
  }

  if (metricName === "purefa_hw_component_temperature_celsius") {
    const componentName: string | null = series.label("component_name");
    if (!componentName) {
      return;
    }
    const patch: StorageArrayResourceBufferEntry = series.newResource(
      StorageArrayResourceKind.Hardware,
      componentName,
    );
    patch.name = componentName;
    patch.componentType = series.label("component_type");
    patch.temperatureCelsius = series.value;
    series.fold(patch);
    return;
  }

  if (metricName === "purefa_drive_capacity_bytes") {
    const componentName: string | null = series.label("component_name");
    if (!componentName) {
      return;
    }
    markStorageArrayKindComplete(series.array, StorageArrayResourceKind.Drive);
    const patch: StorageArrayResourceBufferEntry = series.newResource(
      StorageArrayResourceKind.Drive,
      componentName,
    );
    patch.name = componentName;
    patch.status = lowerOrNull(series.label("component_status"));
    patch.componentType = series.label("component_type");
    patch.capacityBytes = Math.max(0, Math.trunc(series.value));
    const protocol: string | null = series.label("component_protocol");
    if (protocol) {
      patch.details["protocol"] = protocol;
    }
    series.fold(patch);
    return;
  }

  if (metricName === "purefa_hw_controller_info") {
    const controllerName: string | null = series.label("name");
    if (!controllerName) {
      return;
    }
    markStorageArrayKindComplete(
      series.array,
      StorageArrayResourceKind.Controller,
    );
    const patch: StorageArrayResourceBufferEntry = series.newResource(
      StorageArrayResourceKind.Controller,
      controllerName,
    );
    patch.name = controllerName;
    patch.status = lowerOrNull(series.label("status"));
    patch.statusDetail = series.label("mode");
    patch.model = series.label("model");
    patch.firmwareVersion = series.label("version");
    patch.componentType = series.label("type");
    series.fold(patch);
  }
}

function readNetworkInterface(series: StorageArraySeries): void {
  const metricName: string = series.metricName;
  const interfaceName: string | null = series.label("name");
  if (!interfaceName) {
    return;
  }
  const patch: StorageArrayResourceBufferEntry = series.newResource(
    StorageArrayResourceKind.NetworkInterface,
    interfaceName,
  );
  patch.name = interfaceName;
  patch.componentType = series.label("type");
  if (metricName === "purefa_network_interface_speed_bandwidth_bytes") {
    markStorageArrayKindComplete(
      series.array,
      StorageArrayResourceKind.NetworkInterface,
    );
    const enabled: string | null = lowerOrNull(series.label("enabled"));
    patch.status =
      enabled === "true" ? "enabled" : enabled === "false" ? "disabled" : null;
    patch.details["speedBytesPerSec"] = Math.max(0, series.value);
    const services: string | null = series.label("services");
    if (services) {
      patch.details["services"] = services;
    }
    const ethSubtype: string | null = series.label("ethsubtype");
    if (ethSubtype) {
      patch.details["ethSubtype"] = ethSubtype;
    }
  } else if (
    metricName === "purefa_network_interface_performance_bandwidth_bytes"
  ) {
    const dimension: string | null = series.label("dimension");
    if (dimension === "received_bytes_per_sec") {
      patch.details["receivedBytesPerSec"] = Math.max(0, series.value);
    } else if (dimension === "transmitted_bytes_per_sec") {
      patch.details["transmittedBytesPerSec"] = Math.max(0, series.value);
    } else {
      return;
    }
  } else if (metricName === "purefa_network_interface_performance_errors") {
    if (series.label("dimension") !== "total_errors_per_sec") {
      return;
    }
    patch.details["errorsPerSec"] = Math.max(0, series.value);
  } else {
    return;
  }
  series.fold(patch);
}

function readVolume(series: StorageArraySeries): void {
  const metricName: string = series.metricName;
  // purefa_volume_group_* series describe volume groups, not volumes.
  if (metricName.startsWith("purefa_volume_group_")) {
    return;
  }
  const volumeName: string | null = series.label("name");
  if (!volumeName) {
    return;
  }
  markStorageArrayKindComplete(series.array, StorageArrayResourceKind.Volume);
  const patch: StorageArrayResourceBufferEntry = series.newResource(
    StorageArrayResourceKind.Volume,
    volumeName,
  );
  patch.name = volumeName;
  patch.groupName = series.label("pod") || series.label("volume_group");
  const naaId: string | null = series.label("naa_id");
  if (naaId) {
    patch.details["naaId"] = naaId;
  }
  const family: PurePerformanceFamily | null =
    getPurePerformanceFamily(metricName);
  if (family) {
    if (
      !applyPurePerformanceDimension(
        patch,
        family,
        series.label("dimension"),
        series.value,
      )
    ) {
      // Still a sighting of the volume - keep it in the inventory.
      series.fold(patch);
      return;
    }
  } else if (metricName === "purefa_volume_space_bytes") {
    applyPureSpaceDimension(patch, series.label("space"), series.value);
  } else if (metricName === "purefa_volume_space_data_reduction_ratio") {
    patch.dataReductionRatio = Math.max(0, series.value);
  } else if (metricName === "purefa_volume_qos_iops_limit") {
    patch.details["qosIopsLimit"] = Math.max(0, series.value);
  } else if (metricName === "purefa_volume_qos_bandwidth_bytes_per_sec_limit") {
    patch.details["qosBandwidthBytesPerSecLimit"] = Math.max(0, series.value);
  }
  series.fold(patch);
}

function readHost(series: StorageArraySeries): void {
  const metricName: string = series.metricName;
  const hostName: string | null = series.label("host");
  if (!hostName) {
    return;
  }
  markStorageArrayKindComplete(series.array, StorageArrayResourceKind.Host);
  const patch: StorageArrayResourceBufferEntry = series.newResource(
    StorageArrayResourceKind.Host,
    hostName,
  );
  patch.name = hostName;

  if (metricName === "purefa_host_connectivity_info") {
    patch.status = lowerOrNull(series.label("status"));
    patch.statusDetail = series.label("details");
  } else if (metricName === "purefa_host_connections_info") {
    patch.groupName = series.label("hostgroup");
    recordHostVolumeConnection(series.array, {
      host: hostName,
      volume: series.label("volume"),
      observedAt: series.observedAt,
    });
  } else if (metricName === "purefa_host_space_bytes") {
    // total_provisioned: the size of everything the host is connected to.
    applyPureSpaceDimension(patch, series.label("space"), series.value);
  } else if (metricName === "purefa_host_space_data_reduction_ratio") {
    patch.dataReductionRatio = Math.max(0, series.value);
  } else {
    applyPurePerformance(series, patch);
  }
  series.fold(patch);
}

function readPod(series: StorageArraySeries): void {
  const metricName: string = series.metricName;
  let podName: string | null = null;
  if (metricName.startsWith("purefa_pod_replica_links_")) {
    podName = series.label("local_pod");
  } else if (metricName === "purefa_pod_mediator_status") {
    podName = series.label("pod");
  } else {
    podName = series.label("name");
  }
  if (!podName) {
    return;
  }
  markStorageArrayKindComplete(series.array, StorageArrayResourceKind.Pod);
  const patch: StorageArrayResourceBufferEntry = series.newResource(
    StorageArrayResourceKind.Pod,
    podName,
  );
  patch.name = podName;

  if (metricName === "purefa_pod_replica_links_lag_max_msec") {
    patch.replicationLagMs = Math.max(0, series.value);
    patch.status = lowerOrNull(series.label("status"));
    const remote: string | null = series.label("remote");
    if (remote) {
      patch.details["remote"] = remote;
    }
    const remotePod: string | null = series.label("remote_pod");
    if (remotePod) {
      patch.details["remotePod"] = remotePod;
    }
    const direction: string | null = series.label("direction");
    if (direction) {
      patch.details["direction"] = direction;
    }
  } else if (metricName === "purefa_pod_replica_links_lag_average_msec") {
    patch.details["averageLagMs"] = Math.max(0, series.value);
  } else if (metricName === "purefa_pod_mediator_status") {
    const mediatorStatus: string | null = lowerOrNull(series.label("status"));
    if (mediatorStatus) {
      patch.details["mediatorStatus"] = mediatorStatus;
    }
  } else if (metricName === "purefa_pod_space_bytes") {
    applyPureSpaceDimension(patch, series.label("space"), series.value);
  } else if (metricName === "purefa_pod_space_data_reduction_ratio") {
    patch.dataReductionRatio = Math.max(0, series.value);
  } else {
    applyPurePerformance(series, patch);
  }
  series.fold(patch);
}

function readDirectory(series: StorageArraySeries): void {
  const metricName: string = series.metricName;
  const directoryName: string | null = series.label("name");
  if (!directoryName) {
    return;
  }
  markStorageArrayKindComplete(
    series.array,
    StorageArrayResourceKind.Directory,
  );
  const patch: StorageArrayResourceBufferEntry = series.newResource(
    StorageArrayResourceKind.Directory,
    directoryName,
  );
  patch.name = directoryName;
  if (metricName === "purefa_directory_space_bytes") {
    applyPureSpaceDimension(patch, series.label("space"), series.value);
  } else if (metricName === "purefa_directory_space_data_reduction_ratio") {
    patch.dataReductionRatio = Math.max(0, series.value);
  } else {
    applyPurePerformance(series, patch);
  }
  series.fold(patch);
}

function extractFlashArraySeries(series: StorageArraySeries): void {
  const metricName: string = series.metricName;

  // ---------------- Array-level series (no inventory row) ----------------

  if (metricName === "purefa_info") {
    readPureInfo(series, PureStorageFlashArrayPlatform);
    return;
  }
  if (metricName === "purefa_alerts_open") {
    readPureOpenAlert(series);
    return;
  }
  if (metricName === "purefa_array_space_bytes") {
    readPureArraySpaceBytes(series);
    return;
  }
  if (metricName === "purefa_array_space_utilization") {
    readPureArraySpaceUtilization(series);
    return;
  }
  if (metricName === "purefa_array_space_data_reduction_ratio") {
    readPureArrayDataReductionRatio(series);
    return;
  }

  // ---------------- Inventory ----------------

  if (metricName.startsWith("purefa_network_interface_")) {
    readNetworkInterface(series);
    return;
  }
  if (metricName.startsWith("purefa_volume_")) {
    readVolume(series);
    return;
  }
  if (metricName.startsWith("purefa_host_")) {
    readHost(series);
    return;
  }
  if (metricName.startsWith("purefa_pod_")) {
    readPod(series);
    return;
  }
  if (metricName.startsWith("purefa_directory_")) {
    readDirectory(series);
    return;
  }
  readHardware(series);
}

const FlashArrayExtractor: StorageArrayExtractor = {
  storageSystem: PureStorageFlashArrayPlatform.storageSystem,
  extract: extractFlashArraySeries,
};

export default FlashArrayExtractor;
