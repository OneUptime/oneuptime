/*
 * What the server's custom OpenStack reads answer, worked out from an estate's rows the
 * way OpenStackResourceService works them out in SQL: one implementation of each read,
 * so a walk reads the numbers a real cloud with these rows would read, and an estate
 * needs to say nothing beyond its rows.
 *
 * Changing a query in OpenStackResourceService means changing it here too. Its Postgres
 * tests (Common/Tests/Server/Services/OpenStackResourcePostgres.test.ts) hold the SQL.
 */
import {
  OPENSTACK_IMAGE_STUCK_MINUTES,
  OPENSTACK_INSTANCE_STUCK_MINUTES,
  OPENSTACK_IP_POOL_WARNING_PERCENT,
  OPENSTACK_STORAGE_POOL_WARNING_PERCENT,
  OPENSTACK_VOLUME_STUCK_MINUTES,
  getOpenStackRouterAgents,
  getOpenStackShortHostName,
} from "../../../Common/Types/OpenStack/OpenStackHealthRules";
import {
  OPENSTACK_IMAGE_TRANSITIONAL_STATUSES,
  OPENSTACK_INSTANCE_TRANSITIONAL_STATUSES,
  OPENSTACK_VOLUME_ERROR_STATUSES,
  OPENSTACK_VOLUME_TRANSITIONAL_STATUSES,
} from "../../../Common/Types/OpenStack/OpenStackResourceKind";
import {
  buildOpenStackBlastRadius,
  getEmptyOpenStackBlastRadius,
} from "../../../Common/Types/OpenStack/OpenStackBlastRadius";
import { getOpenStackProjectQuotas } from "../../../Common/Types/OpenStack/OpenStackQuota";

const ATTENTION_ROWS_PER_KIND = 100;
const TOP_CONSUMERS_LIMIT = 5;

const isAdminDown = (row) => {
  return row.adminState === "disabled" || row.adminState === "down";
};

const canGive = (row) => {
  return row.status !== "down" && !isAdminDown(row);
};

const sum = (rows, field) => {
  return rows.reduce((total, row) => {
    return total + (typeof row[field] === "number" ? row[field] : 0);
  }, 0);
};

function ofRegion(rows, regionName) {
  return regionName
    ? rows.filter((row) => {
        return !row.regionName || row.regionName === regionName;
      })
    : rows;
}

function ofKind(rows, kind) {
  return rows.filter((row) => {
    return row.kind === kind;
  });
}

export function getInventorySummary(allRows, regionName) {
  const rows = ofRegion(allRows, regionName);
  const hypervisors = ofKind(rows, "Hypervisor");
  const pools = ofKind(rows, "StoragePool");
  const services = ofKind(rows, "Service");
  const instances = ofKind(rows, "Instance");
  const giving = hypervisors.filter(canGive);

  const placed = rows.filter((row) => {
    return (
      row.availabilityZone &&
      row.availabilityZone !== "internal" &&
      (row.kind === "Hypervisor" ||
        (row.kind === "Service" && row.facts?.family === "compute"))
    );
  });

  return {
    regionCount: new Set(
      rows
        .filter((row) => {
          return ["Api", "Hypervisor", "Service"].includes(row.kind);
        })
        .map((row) => {
          return row.regionName;
        })
        .filter(Boolean),
    ).size,
    availabilityZoneCount: new Set(
      placed.map((row) => {
        return row.availabilityZone;
      }),
    ).size,
    hypervisorCount: hypervisors.length,
    instanceCount: instances.length,
    activeInstanceCount: instances.filter((row) => {
      return row.status === "ACTIVE";
    }).length,
    volumeCount: ofKind(rows, "Volume").length,
    networkCount: ofKind(rows, "Network").length,
    routerCount: ofKind(rows, "Router").length,
    floatingIpCount: ofKind(rows, "FloatingIp").length,
    projectCount: ofKind(rows, "Project").length,
    serviceCount: services.length,
    downServiceCount: services.filter((row) => {
      return row.status === "down" && !isAdminDown(row);
    }).length,
    vcpuCapacity: sum(giving, "vcpuCapacity"),
    vcpuAllocated: sum(giving, "vcpuAllocated"),
    memoryCapacityBytes: sum(giving, "memoryCapacityBytes"),
    memoryAllocatedBytes: sum(giving, "memoryAllocatedBytes"),
    storageCapacityBytes: sum(pools, "diskCapacityBytes"),
    storageUsedBytes: sum(pools, "diskAllocatedBytes"),
  };
}

// One row for each region, as POST /region-summaries answers.
export function getRegionSummaries(allRows) {
  const names = Array.from(
    new Set(
      allRows
        .map((row) => {
          return row.regionName;
        })
        .filter(Boolean),
    ),
  ).sort();

  return names.map((regionName) => {
    const rows = allRows.filter((row) => {
      return row.regionName === regionName;
    });
    const apis = ofKind(rows, "Api");
    const services = ofKind(rows, "Service");
    const hypervisors = ofKind(rows, "Hypervisor");
    const instances = ofKind(rows, "Instance");
    const pools = ofKind(rows, "StoragePool");
    const giving = hypervisors.filter(canGive);
    return {
      regionName,
      apiCount: apis.length,
      downApiCount: apis.filter((row) => {
        return row.status === "down";
      }).length,
      serviceCount: services.length,
      downServiceCount: services.filter((row) => {
        return row.status === "down" && !isAdminDown(row);
      }).length,
      hypervisorCount: hypervisors.length,
      instanceCount: instances.length,
      vcpuCapacity: sum(giving, "vcpuCapacity"),
      vcpuAllocated: sum(giving, "vcpuAllocated"),
      memoryCapacityBytes: sum(giving, "memoryCapacityBytes"),
      memoryAllocatedBytes: sum(giving, "memoryAllocatedBytes"),
      storageCapacityBytes: sum(pools, "diskCapacityBytes"),
      storageUsedBytes: sum(pools, "diskAllocatedBytes"),
    };
  });
}

/*
 * A row as the read answers it: a date written out, and a column nothing has set as null.
 * Postgres hands a bigint back as text, and the service turns it back into a number before
 * it answers (toRowWithNumbers), so these are numbers here too.
 */
function asRawRow(row) {
  return {
    _id: row._id,
    kind: row.kind,
    externalId: row.externalId,
    name: row.name ?? null,
    regionName: row.regionName ?? null,
    availabilityZone: row.availabilityZone ?? null,
    hypervisorName: row.hypervisorName ?? null,
    openStackProjectId: row.openStackProjectId ?? null,
    status: row.status ?? null,
    adminState: row.adminState ?? null,
    disabledReason: row.disabledReason ?? null,
    stateChangedAt: row.stateChangedAt
      ? new Date(row.stateChangedAt).toISOString()
      : null,
    vcpuCapacity: row.vcpuCapacity ?? null,
    vcpuAllocated: row.vcpuAllocated ?? null,
    memoryCapacityBytes: row.memoryCapacityBytes ?? null,
    memoryAllocatedBytes: row.memoryAllocatedBytes ?? null,
    diskCapacityBytes: row.diskCapacityBytes ?? null,
    diskAllocatedBytes: row.diskAllocatedBytes ?? null,
    instanceCount: row.instanceCount ?? null,
    facts: row.facts ?? {},
    lastSeenAt: row.lastSeenAt ? new Date(row.lastSeenAt).toISOString() : null,
  };
}

function stuckSince(row, minutes, now) {
  return (
    row.stateChangedAt &&
    new Date(row.stateChangedAt).getTime() <= now.getTime() - minutes * 60000
  );
}

const ATTENTION_QUERIES = [
  {
    kind: "Api",
    where: (row) => {
      return row.status === "down";
    },
  },
  { kind: "Service", where: () => true, whole: true },
  { kind: "Hypervisor", where: () => true, whole: true },
  {
    kind: "StoragePool",
    where: (row) => {
      return (
        row.diskAllocatedBytes * 100 >
        row.diskCapacityBytes * OPENSTACK_STORAGE_POOL_WARNING_PERCENT
      );
    },
  },
  {
    kind: "Instance",
    where: (row, now) => {
      return (
        row.status === "ERROR" ||
        (OPENSTACK_INSTANCE_TRANSITIONAL_STATUSES.has(row.status) &&
          stuckSince(row, OPENSTACK_INSTANCE_STUCK_MINUTES, now))
      );
    },
  },
  {
    kind: "Volume",
    where: (row, now) => {
      return (
        OPENSTACK_VOLUME_ERROR_STATUSES.has(row.status) ||
        (OPENSTACK_VOLUME_TRANSITIONAL_STATUSES.has(row.status) &&
          stuckSince(row, OPENSTACK_VOLUME_STUCK_MINUTES, now))
      );
    },
  },
  {
    kind: "Image",
    where: (row, now) => {
      return (
        OPENSTACK_IMAGE_TRANSITIONAL_STATUSES.has(row.status) &&
        stuckSince(row, OPENSTACK_IMAGE_STUCK_MINUTES, now)
      );
    },
  },
  {
    kind: "Network",
    where: (row) => {
      return (
        row.facts?.isExternal === true &&
        row.facts?.ipsUsed * 100 >
          row.facts?.ipsTotal * OPENSTACK_IP_POOL_WARNING_PERCENT
      );
    },
  },
  {
    kind: "Router",
    where: (row) => {
      return (
        row.adminState !== "down" &&
        ((row.status && row.status !== "ACTIVE") ||
          Boolean(row.facts && "l3Agents" in row.facts))
      );
    },
  },
  {
    kind: "FloatingIp",
    where: (row) => {
      return (
        row.status !== "ACTIVE" &&
        Boolean(row.facts?.routerId || row.facts?.portId)
      );
    },
  },
];

// A project at a quota: the same line as OpenStackHealth, as the SQL draws it.
const PROJECT_AT_QUOTA = {
  kind: "Project",
  where: (row, now) => {
    return getOpenStackProjectQuotas(row.facts, now).some((quota) => {
      return quota.isAtLine;
    });
  },
};

export function getAttentionRows(allRows, regionName, now) {
  const rows = regionName
    ? allRows.filter((row) => {
        return row.regionName === regionName;
      })
    : allRows;
  const answer = { rows: [], totalsByKind: {} };

  for (const query of [...ATTENTION_QUERIES, PROJECT_AT_QUOTA]) {
    const found = ofKind(rows, query.kind)
      .filter((row) => {
        return query.where(row, now);
      })
      .sort((first, second) => {
        return String(first.name).localeCompare(String(second.name));
      });
    answer.totalsByKind[query.kind] = found.length;
    answer.rows.push(
      ...(query.whole ? found : found.slice(0, ATTENTION_ROWS_PER_KIND)).map(
        asRawRow,
      ),
    );
  }
  return answer;
}

function countsByProject(rows) {
  const counts = new Map();
  for (const row of rows) {
    const id = row.openStackProjectId || null;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return Array.from(counts.entries()).map(([projectId, count]) => {
    return { projectId, count };
  });
}

export function getBlastRadius(allRows, part) {
  const projectNames = {};
  for (const row of ofKind(allRows, "Project")) {
    projectNames[row.externalId] = row.name;
  }
  const instancesOn = (hypervisorName) => {
    return ofKind(allRows, "Instance").filter((row) => {
      return (
        row.hypervisorName === hypervisorName &&
        row.regionName === part.regionName
      );
    });
  };
  const finish = (counts, isKnown = true) => {
    return buildOpenStackBlastRadius({ counts, projectNames, isKnown });
  };

  if (part.kind === "Hypervisor") {
    return finish([
      {
        count: "instanceCount",
        byProject: countsByProject(instancesOn(part.hypervisorName)),
      },
    ]);
  }

  if (part.kind === "Service" && part.name === "nova-compute") {
    const host = getOpenStackShortHostName(part.facts?.host);
    const hypervisors = ofKind(allRows, "Hypervisor").filter((row) => {
      return (
        row.regionName === part.regionName &&
        getOpenStackShortHostName(row.hypervisorName) === host
      );
    });
    return finish(
      hypervisors.map((hypervisor) => {
        return {
          count: "instanceCount",
          byProject: countsByProject(instancesOn(hypervisor.hypervisorName)),
        };
      }),
    );
  }

  if (part.kind === "Service" && part.name === "neutron-l3-agent") {
    const agentId = part.facts?.agentId;
    if (!agentId) {
      return getEmptyOpenStackBlastRadius(false);
    }
    const stranded = ofKind(allRows, "Router").filter((router) => {
      const agents = router.facts?.l3Agents;
      if (!agents || !agents[agentId]) {
        return false;
      }
      const others = { ...agents };
      delete others[agentId];
      return !getOpenStackRouterAgents({ l3Agents: others }).some((agent) => {
        return agent.isAlive && agent.isAdminUp;
      });
    });
    const strandedIds = new Set(
      stranded.map((router) => {
        return router.externalId;
      }),
    );
    return finish([
      { count: "routerCount", byProject: countsByProject(stranded) },
      {
        count: "floatingIpCount",
        byProject: countsByProject(
          ofKind(allRows, "FloatingIp").filter((row) => {
            return strandedIds.has(row.facts?.routerId);
          }),
        ),
      },
    ]);
  }

  if (part.kind === "Router") {
    return finish([
      {
        count: "floatingIpCount",
        byProject: countsByProject(
          ofKind(allRows, "FloatingIp").filter((row) => {
            return row.facts?.routerId === part.externalId;
          }),
        ),
      },
    ]);
  }

  if (part.kind === "StoragePool") {
    const volumes = ofKind(allRows, "Volume").filter((row) => {
      return row.facts?.pool === part.name;
    });
    return finish(
      [{ count: "volumeCount", byProject: countsByProject(volumes) }],
      volumes.length > 0,
    );
  }

  if (part.kind === "Api") {
    const inRegion = (kind) => {
      return ofKind(allRows, kind).filter((row) => {
        return row.regionName === part.regionName;
      });
    };
    switch (part.name) {
      case "compute":
        return finish([
          {
            count: "instanceCount",
            byProject: countsByProject(inRegion("Instance")),
          },
        ]);
      case "volume":
        return finish([
          {
            count: "volumeCount",
            byProject: countsByProject(inRegion("Volume")),
          },
        ]);
      case "network":
        return finish([
          {
            count: "routerCount",
            byProject: countsByProject(inRegion("Router")),
          },
          {
            count: "floatingIpCount",
            byProject: countsByProject(inRegion("FloatingIp")),
          },
        ]);
      case "identity":
        return finish([
          {
            count: "instanceCount",
            byProject: countsByProject(ofKind(allRows, "Instance")),
          },
        ]);
      default:
        return finish([]);
    }
  }

  return getEmptyOpenStackBlastRadius(false);
}

// Who holds the most of a region or the cloud, as POST /top-consumers answers.
// How many of a kind there are by what they hold, as OpenStackResourceService.getCounts.
export function getCounts(allRows, kind, by) {
  const valueOf = {
    flavor: (row) => {
      return row.facts?.flavorId ?? null;
    },
    volumeType: (row) => {
      return row.facts?.volumeType ?? null;
    },
    project: (row) => {
      return row.openStackProjectId ?? null;
    },
  }[by];
  const groups = new Map();
  for (const row of ofKind(allRows, kind)) {
    const value = valueOf(row);
    const key = JSON.stringify([value, row.regionName ?? null]);
    const group = groups.get(key) || {
      value,
      regionName: row.regionName ?? null,
      count: 0,
      sizeBytes: 0,
    };
    group.count += 1;
    group.sizeBytes += row.diskCapacityBytes || 0;
    groups.set(key, group);
  }
  return Array.from(groups.values()).sort((first, second) => {
    return second.count - first.count;
  });
}

export function getTopConsumers(allRows, regionName) {
  const rows = ofRegion(allRows, regionName);
  const names = {};
  for (const row of ofKind(allRows, "Project")) {
    names[row.externalId] = row.name;
  }
  const top = (kind, amount) => {
    const totals = new Map();
    for (const row of ofKind(rows, kind)) {
      if (row.openStackProjectId) {
        totals.set(
          row.openStackProjectId,
          (totals.get(row.openStackProjectId) || 0) + amount(row),
        );
      }
    }
    return Array.from(totals.entries())
      .sort((first, second) => {
        return second[1] - first[1] || first[0].localeCompare(second[0]);
      })
      .slice(0, TOP_CONSUMERS_LIMIT)
      .map(([projectId, value]) => {
        return { projectId, name: names[projectId] || null, value };
      });
  };
  return {
    projectsByInstances: top("Instance", () => {
      return 1;
    }),
    projectsByVolumeBytes: top("Volume", (row) => {
      return row.diskCapacityBytes || 0;
    }),
  };
}

// What each of a page of projects runs (OpenStackResourceService.getProjectSummaries).
export function getProjectSummaries(allRows, projectIds) {
  return projectIds.map((projectId) => {
    const owned = allRows.filter((row) => {
      return row.openStackProjectId === projectId;
    });
    const count = (kind) => {
      return ofKind(owned, kind).length;
    };
    return {
      projectId,
      instanceCount: count("Instance"),
      activeInstanceCount: ofKind(owned, "Instance").filter((row) => {
        return row.status === "ACTIVE";
      }).length,
      volumeCount: count("Volume"),
      networkCount: count("Network"),
      routerCount: count("Router"),
      floatingIpCount: count("FloatingIp"),
    };
  });
}

// The parts of those projects that may need someone: the cloud's own are nobody's.
export function getProjectAttention(allRows, projectIds, now) {
  const ids = new Set(projectIds);
  const answer = getAttentionRows(
    allRows.filter((row) => {
      return ids.has(row.openStackProjectId);
    }),
    null,
    now,
  );
  return {
    rows: answer.rows.filter((row) => {
      return !["Api", "Service", "Hypervisor"].includes(row.kind);
    }),
    totalsByKind: answer.totalsByKind,
  };
}

export function getProjectOverview(allRows, projectId, now) {
  const instances = ofKind(allRows, "Instance").filter((row) => {
    return row.openStackProjectId === projectId;
  });

  const hostsDown = [];
  for (const host of ofKind(allRows, "Hypervisor")) {
    const held = instances.filter((row) => {
      return (
        row.hypervisorName === host.hypervisorName &&
        row.regionName === host.regionName
      );
    }).length;
    if (held > 0 && host.status === "down" && !isAdminDown(host)) {
      hostsDown.push({
        hypervisorName: host.hypervisorName,
        regionName: host.regionName,
        externalId: host.externalId,
        instanceCount: held,
      });
    }
  }

  const labels = new Map();
  for (const row of instances) {
    for (const [key, value] of Object.entries(row.facts?.labels || {})) {
      const id = `${key}=${value}`;
      labels.set(id, {
        key,
        value,
        instanceCount: (labels.get(id)?.instanceCount || 0) + 1,
      });
    }
  }

  return {
    summary: getProjectSummaries(allRows, [projectId])[0],
    attention: getProjectAttention(allRows, [projectId], now),
    hostsDown,
    labels: Array.from(labels.values()),
  };
}

export function getDomainSummaries(allRows) {
  const byDomain = new Map();
  for (const row of ofKind(allRows, "Project")) {
    const domainId = row.facts?.domainId;
    if (!domainId) {
      continue;
    }
    const known = byDomain.get(domainId) || {
      domainId,
      projectCount: 0,
      enabledProjectCount: 0,
    };
    known.projectCount += 1;
    known.enabledProjectCount += row.status === "enabled" ? 1 : 0;
    byDomain.set(domainId, known);
  }
  return Array.from(byDomain.values());
}

export function getProjectIdsOfDomain(allRows, domainId) {
  return {
    projectIds: ofKind(allRows, "Project")
      .filter((row) => {
        return row.facts?.domainId === domainId;
      })
      .map((row) => {
        return row.externalId;
      }),
    isPartial: false,
  };
}

// What a cloud's map reads. No estate here is past the stated size, so all of it.
export function getTopologyRead(allRows) {
  const drawn = new Set([
    "Api",
    "Service",
    "Hypervisor",
    "Instance",
    "Volume",
    "StoragePool",
    "Network",
    "Subnet",
    "Router",
    "FloatingIp",
  ]);
  const totalsByKind = {};
  const hosts = new Map();
  for (const row of allRows) {
    totalsByKind[row.kind] = (totalsByKind[row.kind] || 0) + 1;
    if (row.kind === "Instance" && row.hypervisorName) {
      const key = `${row.regionName}/${row.hypervisorName}`;
      hosts.set(key, {
        regionName: row.regionName,
        hypervisorName: row.hypervisorName,
        instanceCount: (hosts.get(key)?.instanceCount || 0) + 1,
      });
    }
  }
  const projectNames = {};
  for (const row of ofKind(allRows, "Project")) {
    projectNames[row.externalId] = row.name;
  }
  return {
    rows: allRows
      .filter((row) => {
        return drawn.has(row.kind);
      })
      .map(asRawRow),
    totalsByKind,
    instancesByHost: Array.from(hosts.values()),
    isSummarized: false,
    projectNames,
  };
}
