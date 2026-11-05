import FilterCondition from "../Filter/FilterCondition";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";
import {
  OPENSTACK_DEPENDENCY_DEFINITIONS,
  OPENSTACK_DEPENDENCY_LABEL,
  OPENSTACK_EXPORTER_HOST_LABEL,
  OPENSTACK_GALERA_STATE_SYNCED,
  OPENSTACK_HAPROXY_CLIENT_ERROR_RESPONSES_WARNING_PERCENT,
  OPENSTACK_HAPROXY_ERROR_RESPONSES_WARNING_PERCENT,
  OPENSTACK_MARIADB_CONNECTIONS_WARNING_PERCENT,
  OPENSTACK_MARIADB_SLOW_QUERIES_WARNING_PER_MINUTE,
  OPENSTACK_MEMCACHED_EVICTIONS_WARNING_PER_MINUTE,
  OPENSTACK_MEMCACHED_NO_CLIENT_CONNECTIONS,
  OPENSTACK_NETWORK_FACTS,
  OPENSTACK_RABBITMQ_FILE_DESCRIPTORS_WARNING_PERCENT,
  OPENSTACK_RABBITMQ_LINK_UP,
  OPENSTACK_RABBITMQ_QUEUE_DEPENDENCY_LABEL_VALUE,
  OPENSTACK_RABBITMQ_UNACKNOWLEDGED_MESSAGES_WARNING,
  OpenStackDependency,
} from "../OpenStack/OpenStackControlPlane";
import RollingTime from "../RollingTime/RollingTime";
import { CriteriaFilter, FilterType, NoDataPolicy } from "./CriteriaFilter";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import MonitorStep from "./MonitorStep";
import { OPENSTACK_REGION_ATTRIBUTE } from "./MonitorStepOpenStackMonitor";
import {
  IncidentWords,
  OPENSTACK_ANCHOR_METRIC_ALIAS,
  OpenStackAlertTemplate,
  OpenStackAlertTemplateArgs,
  OpenStackAlertTemplateCategory,
  OpenStackFormula,
  OpenStackQuery,
  buildOfflineCriteria,
  buildOpenStackMonitorStep,
  buildOpenStackSeriesConfig,
} from "./OpenStackAlertTemplates";
import {
  OPENSTACK_DATABASE_CONNECTION_LOST_TEMPLATE_ID,
  OPENSTACK_RABBITMQ_CONNECTION_LOST_TEMPLATE_ID,
  OPENSTACK_TOKEN_VALIDATION_FAILING_TEMPLATE_ID,
  OPENSTACK_TOO_MANY_ERRORS_TEMPLATE_ID,
} from "./OpenStackLogAlertTemplates";
import {
  AdditionalCriteriaFilterSpec,
  buildHealthyCriteriaInstance,
  getRecoveryThreshold,
} from "./Recommendation/RecommendationCriteriaBuilder";

/*
 * THE ALERT TEMPLATES ON WHAT A CLOUD STANDS ON.
 *
 * Written from what each exporter really said when its cluster was broken on purpose
 * (Tests/Ops/openstack-e2e/control-plane-clusters.sh, and control-plane-cloud.sh for what the
 * services above do meanwhile). OpenStackControlPlaneReplay.test.ts replays every scene through
 * every template: each fires on its scene, stays quiet on the others and on healthy, and
 * recovers. What those recordings taught, which no rule set says:
 *
 *  - A stopped RabbitMQ or HAProxy is an `up` of 0, because the exporter is inside it. A stopped
 *    MariaDB or Memcached leaves its exporter answering, with mysql_up or memcached_up 0.
 *  - RabbitMQ's default endpoint adds its queues up per node, so it cannot say a queue has
 *    messages nobody reads while another queue is being read. /metrics/detailed can.
 *  - A partition shows on erlang_vm_dist_node_state, which reads 1 (pending) for a peer it
 *    cannot reach, while every node still answers. A peer that stopped has no series at all,
 *    and rabbitmq_unreachable_cluster_peers_count reads the same for both, so it cannot tell.
 *  - mysqld_exporter's defaults do report Galera: wsrep_cluster_status reads 1 for Primary, 0
 *    otherwise, and wsrep_desync is one of its global variables. A MariaDB nobody clustered
 *    reports wsrep_* too, with wsrep_on 0, so none of it counts without wsrep_on.
 *  - A node asked to fall out of step for a backup reads wsrep_local_state 2 with wsrep_desync
 *    1. That is planned work, and it is what Atmosphere's noisy rule pages on.
 *  - memcached_current_connections never reads 0: Memcached's own listeners and the exporter
 *    hold 2 to 8 between them, however idle it is. Real clients read in the dozens (41 on a
 *    DevStack). And 20 clients connected and asking nothing read as many connections as 20
 *    clients, so nobody asking anything and nobody connected are two readings.
 *  - HAProxy counts responses by class and no finer, so a 401 reads as a 4xx.
 *  - A `listen` section with no servers reads 0 active servers for ever, so Backend Down reads
 *    the backend's own state and never its server count.
 *  - openstack-network-exporter reads the Southbound database's cluster status when a host has
 *    both sockets, as Kolla-Ansible's do. It reads Northbound's only where no Southbound socket
 *    is. So a cloud's reading of Northbound is whatever its exporters can see.
 *  - The same exporter never reconnects to Open vSwitch's database: after Open vSwitch restarts,
 *    ovs_build_info, every interface and all of ovn-controller's series stay gone until the
 *    exporter restarts too. ovs-vswitchd's own series, such as ovs_memory_rules_total, come
 *    straight back, so that is what says Open vSwitch is running.
 *  - A host with no Open vSwitch reads exactly as one whose Open vSwitch stopped: ovs_coverage_*
 *    all 0 and no ovs_build_info. So only a machine it was seen on can lose it: onlyWhereSeen.
 *  - ovn-controller's coverage series, such as ovnc_rconn_queued, go with it, and ovnc_encap_ip
 *    stays, because that is read from Open vSwitch. A stopped Open vSwitch takes both, so it reads
 *    as that and not as a stopped ovn-controller as well.
 *  - With every member of OVN's databases stopped, ovn_raft_cluster_leader has no series at all
 *    and ovn_northd_status reads 0 everywhere.
 *  - libvirt_up reads 0 with the exporter still answering, and nova-compute disables itself, so
 *    Compute Service Down stays quiet (adminState is no longer enabled).
 *
 * WHAT THESE HOLD THEMSELVES TO. The same as every OpenStack template (OpenStackAlertTemplates):
 * at least three collections in a window, never Sum, a series that goes away counts as
 * recovered, and silence is not recovery. The queries are collected every 60 seconds, so 5
 * minutes is the shortest window a monitor offers that holds three.
 *
 * ONE FAILURE, ONE INCIDENT. A stopped RabbitMQ takes nova-compute, the schedulers and Neutron's
 * agents with it, each with an alert of its own. So what goes with something waits longer than
 * it does: the whole of a dependency reads 5 minutes, and what depends on it at least 10, so the
 * parent is Offline by the time the child could fire and the product's dependency suppression
 * (MonitorDependencySuppression) quiets it. getOpenStackTemplateParents says which is which, and
 * OpenStackMonitorDependencies links monitors made from these templates accordingly.
 *
 * And where one failure reads as two things on the same series, the second template asks for
 * the first not to hold: a backend with no server is one incident and not one per server.
 */

export type OpenStackControlPlaneCategory = Extract<
  OpenStackAlertTemplateCategory,
  | "RabbitMQ"
  | "MariaDB and Galera"
  | "Memcached"
  | "HAProxy"
  | "OVN and Open vSwitch"
  | "libvirt"
>;

const REGION: string = OPENSTACK_REGION_ATTRIBUTE;
const HOST: string = OPENSTACK_EXPORTER_HOST_LABEL;

const REGION_GROUP: Array<string> = [REGION];
const MACHINE_GROUP: Array<string> = [REGION, HOST];
const QUEUE_GROUP: Array<string> = [REGION, "vhost", "queue"];
const BACKEND_GROUP: Array<string> = [REGION, "proxy"];
const DATABASE_GROUP: Array<string> = [REGION, "database"];

/*
 * The whole of a dependency reads 5 minutes: three collections and a little. What depends on
 * it reads 10, so it is the one that speaks first.
 */
const WHOLE_WINDOW: RollingTime = RollingTime.Past5Minutes;
const PART_WINDOW: RollingTime = RollingTime.Past10Minutes;

// One comparison of a criteria.
interface Comparison {
  alias: string;
  filterType: FilterType;
  value: number;
  // What it reads being gone is what failing looks like, so a gone series reads as 0.
  goneReadsAsZero?: boolean | undefined;
}

function gone(alias: string): Comparison {
  return {
    alias,
    filterType: FilterType.LessThan,
    value: 1,
    goneReadsAsZero: true,
  };
}

function below(alias: string, value: number): Comparison {
  return { alias, filterType: FilterType.LessThan, value };
}

function atLeast(alias: string, value: number): Comparison {
  return { alias, filterType: FilterType.GreaterThanOrEqualTo, value };
}

function above(alias: string, value: number): Comparison {
  return { alias, filterType: FilterType.GreaterThan, value };
}

function atMost(alias: string, value: number): Comparison {
  return { alias, filterType: FilterType.LessThanOrEqualTo, value };
}

function exactly(alias: string, value: number): Comparison {
  return { alias, filterType: FilterType.EqualTo, value };
}

// Where a share climbing past a line recovers: lower, so it has to really come back.
function deadBandBelow(value: number): number {
  return (
    getRecoveryThreshold({ filterType: FilterType.GreaterThan, value }) ?? value
  );
}

function additional(
  comparisons: Array<Comparison>,
): Array<AdditionalCriteriaFilterSpec> {
  return comparisons.map(
    (comparison: Comparison): AdditionalCriteriaFilterSpec => {
      return {
        metricAlias: comparison.alias,
        filterType: comparison.filterType,
        value: comparison.value,
      };
    },
  );
}

/*
 * A gone series reads as recovered: a floor holds of no data, and anything else reads no data
 * as 0, as OpenStackAlertTemplates' own recoveries do. Only a window with something still in it
 * gets this far, which is what the anchor is for.
 */
function countGoneSeriesAsRecovered(
  instance: MonitorCriteriaInstance,
): MonitorCriteriaInstance {
  for (const filter of (instance.data?.filters ||
    []) as Array<CriteriaFilter>) {
    filter.metricMonitorOptions = {
      ...filter.metricMonitorOptions,
      onNoDataPolicy:
        filter.filterType === FilterType.GreaterThanOrEqualTo
          ? NoDataPolicy.Trigger
          : NoDataPolicy.TreatAsZero,
    };
  }

  return instance;
}

// Filters come in the order their comparisons were given.
function readGoneSeriesAsZero(
  instance: MonitorCriteriaInstance,
  comparisons: Array<Comparison>,
): MonitorCriteriaInstance {
  ((instance.data?.filters || []) as Array<CriteriaFilter>).forEach(
    (filter: CriteriaFilter, index: number): void => {
      if (comparisons[index]?.goneReadsAsZero) {
        filter.metricMonitorOptions = {
          ...filter.metricMonitorOptions,
          onNoDataPolicy: NoDataPolicy.TreatAsZero,
        };
      }
    },
  );

  return instance;
}

/*
 * The agent's own `up`, whichever job it is from: while any job answers, the agent is sending,
 * so a window with nothing of this dependency in it means this dependency's series went, and
 * not that the agent stopped. See the top of OpenStackAlertTemplates. No criteria compares it.
 * A function, because that file lists these templates and so is still loading when this one is.
 */
function anchorQuery(): OpenStackQuery {
  return {
    alias: OPENSTACK_ANCHOR_METRIC_ALIAS,
    metricName: "up",
    aggregationType: MetricsAggregationType.Min,
  };
}

function upOf(
  alias: string,
  dependency: OpenStackDependency,
  aggregationType: MetricsAggregationType,
): OpenStackQuery {
  return {
    alias,
    metricName: "up",
    aggregationType,
    attributes: { [OPENSTACK_DEPENDENCY_LABEL]: dependency },
  };
}

function buildStep(data: {
  args: OpenStackAlertTemplateArgs;
  queries: Array<OpenStackQuery>;
  formulas?: Array<OpenStackFormula> | undefined;
  rollingTime: RollingTime;
  groupByAttributeKeys: Array<string>;
  firing: Array<Comparison>;
  // Any of them, unless it says all: a reading that only counts beside another says All.
  firingCondition?: FilterCondition | undefined;
  recovery: Array<Comparison>;
  recoveryCondition: FilterCondition;
  words: IncidentWords;
  // Only the machines that have had this: see MonitorStepOpenStackMonitor.onlyWhereSeen.
  onlyWhereSeen?: string | undefined;
}): MonitorStep {
  const [firstFiring, ...otherFiring] = data.firing;
  const [firstRecovery, ...otherRecovery] = data.recovery;

  return buildOpenStackMonitorStep({
    openstackMonitor: {
      ...buildOpenStackSeriesConfig({
        cloudIdentifier: data.args.cloudIdentifier,
        queries: [...data.queries, anchorQuery()],
        formulas: data.formulas,
        rollingTime: data.rollingTime,
        groupByAttributeKeys: data.groupByAttributeKeys,
      }),
      ...(data.onlyWhereSeen ? { onlyWhereSeen: data.onlyWhereSeen } : {}),
    },
    offlineCriteriaInstance: readGoneSeriesAsZero(
      buildOfflineCriteria({
        notification: { args: data.args, ...data.words },
        metricAlias: firstFiring!.alias,
        filterType: firstFiring!.filterType,
        value: firstFiring!.value,
        additionalFilters: additional(otherFiring),
        filterCondition: data.firingCondition,
      }),
      data.firing,
    ),
    onlineCriteriaInstance: countGoneSeriesAsRecovered(
      buildHealthyCriteriaInstance({
        onlineMonitorStatusId: data.args.onlineMonitorStatusId,
        metricAlias: firstRecovery!.alias,
        filterType: firstRecovery!.filterType,
        value: firstRecovery!.value,
        // Each line here is written out, so nothing moves it again.
        isBinaryMetric: true,
        filterCondition: data.recoveryCondition,
        additionalFilters: additional(otherRecovery),
      }),
    ),
  });
}

function percentOf(data: {
  alias: string;
  legend: string;
  part: string;
  whole: string;
}): OpenStackFormula {
  return {
    alias: data.alias,
    legend: data.legend,
    legendUnit: "%",
    formula: `(${data.part} / ${data.whole}) * 100`,
  };
}

// What each says it takes down, as its page says it, and what happens to the incident.
function takesDownOf(dependency: OpenStackDependency): string {
  return OPENSTACK_DEPENDENCY_DEFINITIONS[dependency].takesDown;
}

/*
 * RabbitMQ.
 */

const RABBITMQ_METRIC_FILTER: Record<string, string> = {
  [OPENSTACK_DEPENDENCY_LABEL]: OpenStackDependency.RabbitMq,
};

const rabbitMqDownTemplate: OpenStackAlertTemplate = {
  id: "openstack-rabbitmq-down",
  name: "RabbitMQ Down",
  summary: "No RabbitMQ node in a region answers for 5 minutes.",
  description:
    "Alert when no node of a region's RabbitMQ answers for 5 minutes (up reads 0 on every one, because the Prometheus plugin is inside RabbitMQ). One incident per region, which names what it takes down. Every worker's own alert on this cloud waits for this one, so a stopped RabbitMQ opens this and not twenty. Check `rabbitmqctl cluster_status` on each node, then start the node that stopped last first: nodes stopped together wait for each other.",
  category: "RabbitMQ",
  severity: "Critical",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    return buildStep({
      args,
      rollingTime: WHOLE_WINDOW,
      groupByAttributeKeys: REGION_GROUP,
      queries: [
        upOf(
          "any_node_answers",
          OpenStackDependency.RabbitMq,
          MetricsAggregationType.Max,
        ),
      ],
      firing: [below("any_node_answers", 1)],
      recovery: [atLeast("any_node_answers", 1)],
      recoveryCondition: FilterCondition.All,
      words: {
        incidentTitle: "[OpenStack] RabbitMQ Down",
        incidentDescription: `No RabbitMQ node in this region answers. ${takesDownOf(OpenStackDependency.RabbitMq)} Check rabbitmqctl cluster_status on each node (openstack compute service list will show the workers going down), and start the node that stopped last first, because nodes stopped together wait for each other. The incident resolves on its own once a node answers again, and the alerts it held back only open if their worker still reads down after that.`,
        criteriaName: "RabbitMQ Down - no node answers",
        criteriaDescription:
          "Triggers when no RabbitMQ node in a region answers for the whole window.",
      },
    });
  },
};

const rabbitMqNodeDownTemplate: OpenStackAlertTemplate = {
  id: "openstack-rabbitmq-node-down",
  name: "RabbitMQ Node Down",
  summary: "A RabbitMQ node does not answer for 10 minutes.",
  description:
    "Alert when one RabbitMQ node does not answer for 10 minutes (up reads 0). The cluster carries on without it, with less room and with whatever queues only that node held gone. One incident per node, longer than a rolling restart takes, and it waits for RabbitMQ Down when every node has gone. Check `rabbitmqctl cluster_status`, then RabbitMQ's service and log on that machine.",
  category: "RabbitMQ",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    return buildStep({
      args,
      rollingTime: PART_WINDOW,
      groupByAttributeKeys: MACHINE_GROUP,
      queries: [
        upOf(
          "node_answers",
          OpenStackDependency.RabbitMq,
          MetricsAggregationType.Min,
        ),
      ],
      firing: [below("node_answers", 1)],
      recovery: [atLeast("node_answers", 1)],
      recoveryCondition: FilterCondition.All,
      words: {
        incidentTitle: "[OpenStack] RabbitMQ Node Down",
        incidentDescription: `A RabbitMQ node has not answered for 10 minutes. The cluster carries on with the others, though with less room, and a queue only that node held is gone until it is back (openstack compute service list says whether anything noticed). Check rabbitmqctl cluster_status on another node, then RabbitMQ's service and log on the machine named above. The incident resolves on its own once it answers again.`,
        criteriaName: "RabbitMQ Node Down - not answering",
        criteriaDescription:
          "Triggers when one RabbitMQ node does not answer for the whole window.",
      },
    });
  },
};

const rabbitMqPartitionTemplate: OpenStackAlertTemplate = {
  id: "openstack-rabbitmq-partition-detected",
  name: "RabbitMQ Partition Detected",
  summary:
    "RabbitMQ nodes that all answer cannot reach each other for 5 minutes.",
  description: `Alert when RabbitMQ's nodes all answer and a link between two of them is not up for 5 minutes (erlang_vm_dist_node_state below ${OPENSTACK_RABBITMQ_LINK_UP}, recorded reading 1 for a peer cut off by a firewall). One incident per region: a partition is one failure, however many links it cuts. A peer that stopped has no series at all and reads as Node Down instead. With cluster_partition_handling set to pause_minority, the smaller side stops answering and this reads as Node Down too. Check \`rabbitmqctl cluster_status\` on each side, and the network between them. A side has to be restarted to heal: RabbitMQ will not guess which to keep.`,
  category: "RabbitMQ",
  severity: "Critical",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    return buildStep({
      args,
      rollingTime: WHOLE_WINDOW,
      groupByAttributeKeys: REGION_GROUP,
      queries: [
        {
          alias: "weakest_link",
          metricName: "erlang_vm_dist_node_state",
          aggregationType: MetricsAggregationType.Min,
          attributes: RABBITMQ_METRIC_FILTER,
        },
        upOf(
          "every_node_answers",
          OpenStackDependency.RabbitMq,
          MetricsAggregationType.Min,
        ),
      ],
      firing: [
        below("weakest_link", OPENSTACK_RABBITMQ_LINK_UP),
        atLeast("every_node_answers", 1),
      ],
      firingCondition: FilterCondition.All,
      recovery: [atLeast("weakest_link", OPENSTACK_RABBITMQ_LINK_UP)],
      recoveryCondition: FilterCondition.All,
      words: {
        incidentTitle: "[OpenStack] RabbitMQ Partition Detected",
        incidentDescription: `RabbitMQ's nodes all answer, but some of them cannot reach each other. Each side carries on, so a message published on one may never reach a consumer on the other, and services see calls time out while everything reads as up (openstack compute service list may show some workers flapping). Check rabbitmqctl cluster_status on each side, and the network between them. Once they can reach each other, restart the side you trust least: RabbitMQ will not guess which to keep. The incident resolves on its own once every link is up.`,
        criteriaName: "RabbitMQ Partition - a link is not up",
        criteriaDescription:
          "Triggers when every RabbitMQ node answers and a link between two of them is not up for the whole window.",
      },
    });
  },
};

function buildRabbitMqAlarmTemplate(data: {
  id: string;
  name: string;
  summary: string;
  metricName: string;
  alias: string;
  description: string;
  incidentDescription: string;
}): OpenStackAlertTemplate {
  return {
    id: data.id,
    name: data.name,
    summary: data.summary,
    description: data.description,
    category: "RabbitMQ",
    severity: "Critical",
    getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
      return buildStep({
        args,
        rollingTime: WHOLE_WINDOW,
        groupByAttributeKeys: MACHINE_GROUP,
        queries: [
          {
            alias: data.alias,
            metricName: data.metricName,
            aggregationType: MetricsAggregationType.Max,
          },
        ],
        firing: [above(data.alias, 0)],
        recovery: [exactly(data.alias, 0)],
        recoveryCondition: FilterCondition.All,
        words: {
          incidentTitle: `[OpenStack] ${data.name}`,
          incidentDescription: data.incidentDescription,
          criteriaName: `${data.name} - in alarm`,
          criteriaDescription: `Triggers when a RabbitMQ node holds this alarm for the whole window.`,
        },
      });
    },
  };
}

const rabbitMqMemoryAlarmTemplate: OpenStackAlertTemplate =
  buildRabbitMqAlarmTemplate({
    id: "openstack-rabbitmq-memory-alarm",
    name: "RabbitMQ Memory Alarm",
    summary: "A RabbitMQ node holds its memory alarm for 5 minutes.",
    metricName: "rabbitmq_alarms_memory_used_watermark",
    alias: "memory_alarm",
    description:
      "Alert when a RabbitMQ node has passed its memory watermark for 5 minutes (rabbitmq_alarms_memory_used_watermark reads 1). An alarm on one node stops publishers on every node, so services hang on their next call while nothing reads as down. One incident per node. Check `rabbitmq-diagnostics memory_breakdown` on it, and which queues have grown with `rabbitmqctl list_queues name messages memory`.",
    incidentDescription:
      "This RabbitMQ node has passed its memory watermark. RabbitMQ stops every publisher in the cluster while it lasts, so services hang on their next call while nothing reads as down (openstack compute service list can still look fine). Check rabbitmq-diagnostics memory_breakdown on the machine named above, and which queues have grown. The incident resolves on its own once the alarm clears.",
  });

const rabbitMqDiskAlarmTemplate: OpenStackAlertTemplate =
  buildRabbitMqAlarmTemplate({
    id: "openstack-rabbitmq-disk-alarm",
    name: "RabbitMQ Disk Alarm",
    summary: "A RabbitMQ node holds its disk alarm for 5 minutes.",
    metricName: "rabbitmq_alarms_free_disk_space_watermark",
    alias: "disk_alarm",
    description:
      "Alert when a RabbitMQ node has less free disk than its limit for 5 minutes (rabbitmq_alarms_free_disk_space_watermark reads 1). An alarm on one node stops publishers on every node, so services hang on their next call while nothing reads as down. One incident per node. Check `df -h` on it and `rabbitmq-diagnostics status`, then what has filled the disk.",
    incidentDescription:
      "This RabbitMQ node has less free disk than its limit. RabbitMQ stops every publisher in the cluster while it lasts, so services hang on their next call while nothing reads as down (openstack compute service list can still look fine). Check df -h on the machine named above and what has filled it. The incident resolves on its own once the alarm clears.",
  });

const rabbitMqFileDescriptorsHighTemplate: OpenStackAlertTemplate = {
  id: "openstack-rabbitmq-file-descriptors-high",
  name: "RabbitMQ File Descriptors High",
  summary: `A RabbitMQ node uses over ${OPENSTACK_RABBITMQ_FILE_DESCRIPTORS_WARNING_PERCENT}% of its file descriptors for 5 minutes.`,
  description: `Alert when a RabbitMQ node has used more than ${OPENSTACK_RABBITMQ_FILE_DESCRIPTORS_WARNING_PERCENT}% of its file descriptors for 5 minutes (rabbitmq_process_open_fds over rabbitmq_process_max_fds). Each connection holds one, so a busy cloud reaches this before its alarm, and past the limit the node refuses new connections and services cannot reconnect. Check \`rabbitmqctl list_connections\` for who holds them, then raise the limit with \`ulimit -n\` or RABBITMQ_MAX_OPEN_FILES.`,
  category: "RabbitMQ",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    const alias: string = "file_descriptors_used_percent";

    return buildStep({
      args,
      rollingTime: WHOLE_WINDOW,
      groupByAttributeKeys: MACHINE_GROUP,
      queries: [
        {
          alias: "open_file_descriptors",
          metricName: "rabbitmq_process_open_fds",
          aggregationType: MetricsAggregationType.Max,
        },
        {
          alias: "max_file_descriptors",
          metricName: "rabbitmq_process_max_fds",
          aggregationType: MetricsAggregationType.Max,
        },
      ],
      formulas: [
        percentOf({
          alias,
          legend: "File Descriptors Used (%)",
          part: "open_file_descriptors",
          whole: "max_file_descriptors",
        }),
      ],
      firing: [
        above(alias, OPENSTACK_RABBITMQ_FILE_DESCRIPTORS_WARNING_PERCENT),
      ],
      recovery: [
        atMost(
          alias,
          deadBandBelow(OPENSTACK_RABBITMQ_FILE_DESCRIPTORS_WARNING_PERCENT),
        ),
      ],
      recoveryCondition: FilterCondition.All,
      words: {
        incidentTitle: `[OpenStack] RabbitMQ File Descriptors High (>${OPENSTACK_RABBITMQ_FILE_DESCRIPTORS_WARNING_PERCENT}%)`,
        incidentDescription: `This RabbitMQ node has used nearly all of its file descriptors. Each connection holds one, and past the limit it refuses new ones, so services that reconnect cannot (openstack compute service list then shows workers going down one by one). Check rabbitmqctl list_connections for who holds them, and raise the limit if this is how the cloud is meant to run. The incident resolves on its own once it falls back.`,
        criteriaName: `File Descriptors High - used > ${OPENSTACK_RABBITMQ_FILE_DESCRIPTORS_WARNING_PERCENT}%`,
        criteriaDescription: `Triggers when a RabbitMQ node has used more than ${OPENSTACK_RABBITMQ_FILE_DESCRIPTORS_WARNING_PERCENT}% of its file descriptors for the whole window.`,
      },
    });
  },
};

const rabbitMqMessagesUnacknowledgedTemplate: OpenStackAlertTemplate = {
  id: "openstack-rabbitmq-messages-unacknowledged",
  name: "RabbitMQ Messages Unacknowledged",
  summary: `A RabbitMQ node holds over ${OPENSTACK_RABBITMQ_UNACKNOWLEDGED_MESSAGES_WARNING} unacknowledged messages for 10 minutes.`,
  description: `Alert when a RabbitMQ node holds more than ${OPENSTACK_RABBITMQ_UNACKNOWLEDGED_MESSAGES_WARNING} messages delivered and not acknowledged for 10 minutes (rabbitmq_queue_messages_unacked). A consumer has stopped working without letting go of what it took, which RabbitMQ cannot see for itself. One incident per node. Check \`rabbitmqctl list_queues name messages_unacknowledged consumers\` for the queue, then restart the service that consumes it.`,
  category: "RabbitMQ",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    const alias: string = "unacknowledged_messages";

    return buildStep({
      args,
      rollingTime: PART_WINDOW,
      groupByAttributeKeys: MACHINE_GROUP,
      queries: [
        {
          alias,
          metricName: "rabbitmq_queue_messages_unacked",
          aggregationType: MetricsAggregationType.Max,
        },
      ],
      firing: [
        above(alias, OPENSTACK_RABBITMQ_UNACKNOWLEDGED_MESSAGES_WARNING),
      ],
      recovery: [
        atMost(
          alias,
          deadBandBelow(OPENSTACK_RABBITMQ_UNACKNOWLEDGED_MESSAGES_WARNING),
        ),
      ],
      recoveryCondition: FilterCondition.All,
      words: {
        incidentTitle: `[OpenStack] RabbitMQ Messages Unacknowledged (>${OPENSTACK_RABBITMQ_UNACKNOWLEDGED_MESSAGES_WARNING})`,
        incidentDescription: `Consumers on this RabbitMQ node have taken many messages and acknowledged none of them, which usually means a service has stopped working without letting go of what it took (openstack compute service list can still read it as up). Check rabbitmqctl list_queues name messages_unacknowledged consumers for the queue, then restart the service that consumes it. The incident resolves on its own once they are acknowledged.`,
        criteriaName: `Messages Unacknowledged - held > ${OPENSTACK_RABBITMQ_UNACKNOWLEDGED_MESSAGES_WARNING}`,
        criteriaDescription: `Triggers when a RabbitMQ node holds more than ${OPENSTACK_RABBITMQ_UNACKNOWLEDGED_MESSAGES_WARNING} unacknowledged messages for the whole window.`,
      },
    });
  },
};

const rabbitMqQueueWithoutConsumersTemplate: OpenStackAlertTemplate = {
  id: "openstack-rabbitmq-queue-without-consumers",
  name: "RabbitMQ Queue Without Consumers",
  summary: "A queue holds messages and nothing consumes them for 10 minutes.",
  description:
    "Alert when a queue has messages ready and no consumer for 10 minutes (rabbitmq_detailed_queue_messages_ready above 0 with rabbitmq_detailed_queue_consumers at 0, one queue at a time from RabbitMQ's detailed endpoint). The service that should read it has stopped, or lost its route to RabbitMQ. One incident per queue, which names it. Reply and fanout queues are left out, because each belongs to one caller or one agent and goes with it. Check `rabbitmqctl list_queues name messages consumers`, then the service the queue is named after.",
  category: "RabbitMQ",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    const attributes: Record<string, string> = {
      [OPENSTACK_DEPENDENCY_LABEL]:
        OPENSTACK_RABBITMQ_QUEUE_DEPENDENCY_LABEL_VALUE,
    };

    return buildStep({
      args,
      rollingTime: PART_WINDOW,
      groupByAttributeKeys: QUEUE_GROUP,
      queries: [
        {
          alias: "consumers",
          metricName: "rabbitmq_detailed_queue_consumers",
          aggregationType: MetricsAggregationType.Max,
          attributes,
        },
        {
          alias: "messages_ready",
          metricName: "rabbitmq_detailed_queue_messages_ready",
          aggregationType: MetricsAggregationType.Min,
          attributes,
        },
      ],
      firing: [below("consumers", 1), above("messages_ready", 0)],
      firingCondition: FilterCondition.All,
      recovery: [atLeast("consumers", 1), exactly("messages_ready", 0)],
      recoveryCondition: FilterCondition.Any,
      words: {
        incidentTitle: "[OpenStack] RabbitMQ Queue Without Consumers",
        incidentDescription: `This queue has messages waiting and nothing consuming them, so whatever they ask for is not happening. The service that should read it has stopped or lost its route to RabbitMQ (openstack compute service list and openstack network agent list say which). Check rabbitmqctl list_queues name messages consumers, then the service the queue is named after. The incident resolves on its own once something consumes it, or the queue empties or goes.`,
        criteriaName: "Queue Without Consumers - messages and no consumer",
        criteriaDescription:
          "Triggers when a queue has messages ready and no consumer for the whole window.",
      },
    });
  },
};

/*
 * MariaDB and Galera.
 */

const mariaDbClusterDownTemplate: OpenStackAlertTemplate = {
  id: "openstack-mariadb-cluster-down",
  name: "MariaDB Cluster Down",
  summary: "No MariaDB node in a region takes writes for 5 minutes.",
  description:
    "Alert when no node of a region's MariaDB takes writes for 5 minutes: every exporter cannot be read (up 0), every node reads mysql_up 0, or Galera has no Primary component on any node that answers (wsrep_cluster_status 0, only where wsrep_on says Galera is on). One incident per region, which names what it takes down, and every API's and worker's own alert on this cloud waits for it, so a stopped MariaDB opens this and not twenty. Check `SHOW STATUS LIKE 'wsrep%'` on each node. A cluster that lost quorum needs one node told to bootstrap: see `galera_new_cluster`.",
  category: "MariaDB and Galera",
  severity: "Critical",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    return buildStep({
      args,
      rollingTime: WHOLE_WINDOW,
      groupByAttributeKeys: REGION_GROUP,
      queries: [
        upOf(
          "any_exporter_answers",
          OpenStackDependency.MariaDb,
          MetricsAggregationType.Max,
        ),
        {
          alias: "any_node_answers",
          metricName: "mysql_up",
          aggregationType: MetricsAggregationType.Max,
        },
        {
          alias: "any_node_primary",
          metricName: "mysql_global_status_wsrep_cluster_status",
          aggregationType: MetricsAggregationType.Max,
        },
        {
          alias: "galera_on",
          metricName: "mysql_global_variables_wsrep_on",
          aggregationType: MetricsAggregationType.Max,
        },
      ],
      formulas: [
        {
          // 1 only with Galera on and no Primary: a MariaDB with no cluster reads 0.
          alias: "galera_without_primary",
          legend: "Galera Without a Primary Component",
          formula: "(1 - any_node_primary) * galera_on",
        },
      ],
      firing: [
        below("any_exporter_answers", 1),
        below("any_node_answers", 1),
        above("galera_without_primary", 0),
      ],
      recovery: [
        atLeast("any_exporter_answers", 1),
        atLeast("any_node_answers", 1),
        exactly("galera_without_primary", 0),
      ],
      recoveryCondition: FilterCondition.All,
      words: {
        incidentTitle: "[OpenStack] MariaDB Cluster Down",
        incidentDescription: `No MariaDB node in this region takes writes. ${takesDownOf(OpenStackDependency.MariaDb)} Check SHOW STATUS LIKE 'wsrep%' on each node that answers, and the service on each that does not (openstack token issue fails while this lasts). A cluster that lost quorum, or that stopped whole, needs the most advanced node told to bootstrap with galera_new_cluster. The incident resolves on its own once a node takes writes again, and the alerts it held back only open if what they watch still reads down after that.`,
        criteriaName: "MariaDB Cluster Down - no node takes writes",
        criteriaDescription:
          "Triggers when no MariaDB node in a region answers, or Galera has no Primary component, for the whole window.",
      },
    });
  },
};

const galeraClusterSizeDroppedTemplate: OpenStackAlertTemplate = {
  id: "openstack-galera-cluster-size-dropped",
  name: "Galera Cluster Size Dropped",
  summary: "Galera has fewer nodes than the agent reads, for 10 minutes.",
  description:
    "Alert when Galera says it has fewer nodes than the agent has exporters to read for 10 minutes (wsrep_cluster_size below the number of targets in OPENSTACK_MARIADB_TARGETS), with every node that answers still ready. One incident per region. It reads against the targets you named, so name them all. A cluster with no quorum is MariaDB Cluster Down, and a node cut off from the rest is Galera Node Not Ready, so neither opens this as well. Check `SHOW STATUS LIKE 'wsrep_cluster_size'` on each node, then the service on whichever is missing. One more failure may cost the cluster its quorum.",
  category: "MariaDB and Galera",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    return buildStep({
      args,
      rollingTime: PART_WINDOW,
      groupByAttributeKeys: REGION_GROUP,
      queries: [
        upOf(
          "nodes_read",
          OpenStackDependency.MariaDb,
          MetricsAggregationType.Count,
        ),
        {
          alias: "cluster_size",
          metricName: "mysql_global_status_wsrep_cluster_size",
          aggregationType: MetricsAggregationType.Min,
        },
        {
          alias: "every_node_ready",
          metricName: "mysql_global_status_wsrep_ready",
          aggregationType: MetricsAggregationType.Min,
        },
      ],
      formulas: [
        {
          alias: "nodes_missing",
          legend: "Nodes Missing From the Cluster",
          formula: "nodes_read - cluster_size",
        },
      ],
      firing: [above("nodes_missing", 0), atLeast("every_node_ready", 1)],
      firingCondition: FilterCondition.All,
      recovery: [exactly("nodes_missing", 0)],
      recoveryCondition: FilterCondition.All,
      words: {
        incidentTitle: "[OpenStack] Galera Cluster Size Dropped",
        incidentDescription: `Galera says it has fewer nodes than the agent reads, so a node has left the cluster. It carries on with the others, and one more failure may cost it its quorum (openstack token issue goes on working until then). Check SHOW STATUS LIKE 'wsrep_cluster_size' on each node, then the service on whichever is missing. The incident resolves on its own once it is back, or its target is taken out of OPENSTACK_MARIADB_TARGETS.`,
        criteriaName: "Cluster Size Dropped - fewer nodes than read",
        criteriaDescription:
          "Triggers when Galera has fewer nodes than the agent reads, with every node that answers ready, for the whole window.",
      },
    });
  },
};

const galeraNodeNotReadyTemplate: OpenStackAlertTemplate = {
  id: "openstack-galera-node-not-ready",
  name: "Galera Node Not Ready",
  summary: "A Galera node answers and takes no queries for 10 minutes.",
  description:
    "Alert when a node answers its exporter and says it is not ready for 10 minutes (wsrep_ready reads 0, only where wsrep_on says Galera is on): it refuses every query, usually because it is cut off from the Primary component. HAProxy should have taken it out, and services connected to it directly see errors. One incident per node. Check `SHOW STATUS LIKE 'wsrep_cluster_status'` on it, and the network to the others.",
  category: "MariaDB and Galera",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    return buildStep({
      args,
      rollingTime: PART_WINDOW,
      groupByAttributeKeys: MACHINE_GROUP,
      queries: [
        {
          alias: "node_ready",
          metricName: "mysql_global_status_wsrep_ready",
          aggregationType: MetricsAggregationType.Min,
        },
        {
          alias: "galera_on",
          metricName: "mysql_global_variables_wsrep_on",
          aggregationType: MetricsAggregationType.Max,
        },
      ],
      firing: [below("node_ready", 1), atLeast("galera_on", 1)],
      firingCondition: FilterCondition.All,
      recovery: [atLeast("node_ready", 1), below("galera_on", 1)],
      recoveryCondition: FilterCondition.Any,
      words: {
        incidentTitle: "[OpenStack] Galera Node Not Ready",
        incidentDescription: `This Galera node answers and refuses every query, usually because it is cut off from the Primary component. The rest of the cluster carries on if it holds a quorum, and anything connected straight to this node sees errors (openstack token issue fails from a service that is). Check SHOW STATUS LIKE 'wsrep_cluster_status' on the machine named above, and the network to the others. The incident resolves on its own once it is ready again.`,
        criteriaName: "Node Not Ready - wsrep_ready is off",
        criteriaDescription:
          "Triggers when a Galera node answers and says it is not ready for the whole window.",
      },
    });
  },
};

const galeraNodeOutOfSyncTemplate: OpenStackAlertTemplate = {
  id: "openstack-galera-node-out-of-sync",
  name: "Galera Node Out of Sync",
  summary:
    "A Galera node is out of sync, and nobody asked for it, for 10 minutes.",
  description: `Alert when a node that is ready has not been Synced for 10 minutes (wsrep_local_state below ${OPENSTACK_GALERA_STATE_SYNCED}), and nobody asked for that: a node desynced on purpose for a backup, with wsrep_desync on, stays quiet. One incident per node. It serves stale reads meanwhile, and a node catching up can hold the whole cluster back through flow control. Check \`SHOW STATUS LIKE 'wsrep_local_state_comment'\`, then what is holding it: a long-running lock, a dump, or a slow disk.`,
  category: "MariaDB and Galera",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    return buildStep({
      args,
      rollingTime: PART_WINDOW,
      groupByAttributeKeys: MACHINE_GROUP,
      queries: [
        {
          alias: "local_state",
          metricName: "mysql_global_status_wsrep_local_state",
          aggregationType: MetricsAggregationType.Min,
        },
        {
          alias: "node_ready",
          metricName: "mysql_global_status_wsrep_ready",
          aggregationType: MetricsAggregationType.Min,
        },
        {
          alias: "desynced_on_purpose",
          metricName: "mysql_global_variables_wsrep_desync",
          aggregationType: MetricsAggregationType.Max,
        },
      ],
      firing: [
        below("local_state", OPENSTACK_GALERA_STATE_SYNCED),
        atLeast("node_ready", 1),
        below("desynced_on_purpose", 1),
      ],
      firingCondition: FilterCondition.All,
      recovery: [
        atLeast("local_state", OPENSTACK_GALERA_STATE_SYNCED),
        atLeast("desynced_on_purpose", 1),
      ],
      recoveryCondition: FilterCondition.Any,
      words: {
        incidentTitle: "[OpenStack] Galera Node Out of Sync",
        incidentDescription: `This Galera node has fallen behind, and nobody asked it to: wsrep_desync is off. It serves stale reads meanwhile, and a node catching up can hold the whole cluster back through flow control (openstack server list slows down with it). Check SHOW STATUS LIKE 'wsrep_local_state_comment' on the machine named above, then what is holding it: a long-running lock, a dump, or a slow disk. If this is a backup, set wsrep_desync on for it and this stays quiet. The incident resolves on its own once it is Synced.`,
        criteriaName: "Node Out of Sync - not Synced, and not asked to be",
        criteriaDescription:
          "Triggers when a ready Galera node is not Synced and wsrep_desync is off for the whole window.",
      },
    });
  },
};

const mariaDbTooManyConnectionsTemplate: OpenStackAlertTemplate = {
  id: "openstack-mariadb-too-many-connections",
  name: "MariaDB Too Many Connections",
  summary: `A MariaDB node uses over ${OPENSTACK_MARIADB_CONNECTIONS_WARNING_PERCENT}% of its connections for 5 minutes.`,
  description: `Alert when a MariaDB node has used more than ${OPENSTACK_MARIADB_CONNECTIONS_WARNING_PERCENT}% of max_connections for 5 minutes (mysql_global_status_threads_connected over mysql_global_variables_max_connections). Past the limit every new connection is refused, and services fail with "Too many connections". One incident per node. Check \`SHOW PROCESSLIST\` for who holds them, then each service's max_pool_size against max_connections.`,
  category: "MariaDB and Galera",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    const alias: string = "connections_used_percent";

    return buildStep({
      args,
      rollingTime: WHOLE_WINDOW,
      groupByAttributeKeys: MACHINE_GROUP,
      queries: [
        {
          alias: "connections",
          metricName: "mysql_global_status_threads_connected",
          aggregationType: MetricsAggregationType.Max,
        },
        {
          alias: "max_connections",
          metricName: "mysql_global_variables_max_connections",
          aggregationType: MetricsAggregationType.Max,
        },
      ],
      formulas: [
        percentOf({
          alias,
          legend: "Connections Used (%)",
          part: "connections",
          whole: "max_connections",
        }),
      ],
      firing: [above(alias, OPENSTACK_MARIADB_CONNECTIONS_WARNING_PERCENT)],
      recovery: [
        atMost(
          alias,
          deadBandBelow(OPENSTACK_MARIADB_CONNECTIONS_WARNING_PERCENT),
        ),
      ],
      recoveryCondition: FilterCondition.All,
      words: {
        incidentTitle: `[OpenStack] MariaDB Too Many Connections (>${OPENSTACK_MARIADB_CONNECTIONS_WARNING_PERCENT}%)`,
        incidentDescription: `This MariaDB node has used nearly all of its connections. Past the limit it refuses every new one, and services fail with Too many connections (openstack server list then answers 500). Check SHOW PROCESSLIST for who holds them, then each service's max_pool_size against max_connections. The incident resolves on its own once it falls back.`,
        criteriaName: `Too Many Connections - used > ${OPENSTACK_MARIADB_CONNECTIONS_WARNING_PERCENT}%`,
        criteriaDescription: `Triggers when a MariaDB node has used more than ${OPENSTACK_MARIADB_CONNECTIONS_WARNING_PERCENT}% of its connections for the whole window.`,
      },
    });
  },
};

const mariaDbSlowQueriesTemplate: OpenStackAlertTemplate = {
  id: "openstack-mariadb-slow-queries",
  name: "MariaDB Slow Queries",
  summary: `A MariaDB node logs over ${OPENSTACK_MARIADB_SLOW_QUERIES_WARNING_PER_MINUTE} slow queries a minute for 10 minutes.`,
  description: `Alert when a MariaDB node counts more than ${OPENSTACK_MARIADB_SLOW_QUERIES_WARNING_PER_MINUTE} queries a minute over long_query_time, every minute for 10 minutes (mysql_slow_queries_increase, how much the server's own counter grew). What counts as slow is that server's setting. One incident per node. Check the slow query log for what they are, usually a table that has outgrown its index, and \`SHOW PROCESSLIST\`.`,
  category: "MariaDB and Galera",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    const alias: string = "slow_queries_per_minute";

    return buildStep({
      args,
      rollingTime: PART_WINDOW,
      groupByAttributeKeys: MACHINE_GROUP,
      queries: [
        {
          alias,
          metricName: "mysql_slow_queries_increase",
          aggregationType: MetricsAggregationType.Max,
        },
      ],
      firing: [above(alias, OPENSTACK_MARIADB_SLOW_QUERIES_WARNING_PER_MINUTE)],
      recovery: [
        atMost(
          alias,
          deadBandBelow(OPENSTACK_MARIADB_SLOW_QUERIES_WARNING_PER_MINUTE),
        ),
      ],
      recoveryCondition: FilterCondition.All,
      words: {
        incidentTitle: `[OpenStack] MariaDB Slow Queries (>${OPENSTACK_MARIADB_SLOW_QUERIES_WARNING_PER_MINUTE} a minute)`,
        incidentDescription: `This MariaDB node keeps running queries over long_query_time, which every API feels as slowness (openstack server list takes its time). Check the slow query log for what they are, usually a table that has outgrown its index or one nobody has purged, and SHOW PROCESSLIST for what is running now. The incident resolves on its own once it falls back.`,
        criteriaName: `Slow Queries - more than ${OPENSTACK_MARIADB_SLOW_QUERIES_WARNING_PER_MINUTE} a minute`,
        criteriaDescription: `Triggers when a MariaDB node counts more than ${OPENSTACK_MARIADB_SLOW_QUERIES_WARNING_PER_MINUTE} slow queries in every minute of the window.`,
      },
    });
  },
};

/*
 * Memcached. None of it stops anything, so all of it is a Warning.
 */

const memcachedClusterDownTemplate: OpenStackAlertTemplate = {
  id: "openstack-memcached-cluster-down",
  name: "Memcached Cluster Down",
  summary: "No Memcached in a region answers for 5 minutes.",
  description:
    "Alert when no Memcached in a region answers for 5 minutes: memcached_up reads 0 on every one, or no exporter can be read. Nothing stops, because services validate tokens the long way, but every API slows down and Keystone takes the load. One incident per region. One of several gone is not an alert: clients move on. Check `systemctl status memcached`, then `openstack token issue` to feel how slow Keystone has become.",
  category: "Memcached",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    return buildStep({
      args,
      rollingTime: WHOLE_WINDOW,
      groupByAttributeKeys: REGION_GROUP,
      queries: [
        upOf(
          "any_exporter_answers",
          OpenStackDependency.Memcached,
          MetricsAggregationType.Max,
        ),
        {
          alias: "any_memcached_answers",
          metricName: "memcached_up",
          aggregationType: MetricsAggregationType.Max,
        },
      ],
      firing: [
        below("any_exporter_answers", 1),
        below("any_memcached_answers", 1),
      ],
      recovery: [
        atLeast("any_exporter_answers", 1),
        atLeast("any_memcached_answers", 1),
      ],
      recoveryCondition: FilterCondition.All,
      words: {
        incidentTitle: "[OpenStack] Memcached Cluster Down",
        incidentDescription: `No Memcached in this region answers. ${takesDownOf(OpenStackDependency.Memcached)} Check systemctl status memcached on each machine, then openstack token issue to feel how slow Keystone has become. The incident resolves on its own once one answers again.`,
        criteriaName: "Memcached Cluster Down - none answers",
        criteriaDescription:
          "Triggers when no Memcached in a region answers for the whole window.",
      },
    });
  },
};

const memcachedNoConnectionsTemplate: OpenStackAlertTemplate = {
  id: "openstack-memcached-no-connections",
  name: "Memcached No Connections",
  summary: "Nothing connects to or asks Memcached anything for 15 minutes.",
  description: `Alert when no client is connected to any Memcached in a region and none of them is asked anything for 15 minutes: fewer than ${OPENSTACK_MEMCACHED_NO_CLIENT_CONNECTIONS} connections everywhere, and no growth in memcached_commands_total. Memcached's connection count never reads 0, because its own listeners and the exporter hold a few, and connected clients that ask nothing are not this. It answers, and nobody is using it: usually memcache_servers points somewhere else after a change, so every API validates its tokens the long way. One incident per region. Check \`[keystone_authtoken] memcached_servers\` in each service's config, then \`openstack token issue\`.`,
  category: "Memcached",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    return buildStep({
      args,
      rollingTime: RollingTime.Past15Minutes,
      groupByAttributeKeys: REGION_GROUP,
      queries: [
        {
          alias: "busiest_connections",
          metricName: "memcached_current_connections",
          aggregationType: MetricsAggregationType.Max,
        },
        {
          alias: "busiest_commands",
          metricName: "memcached_commands_increase",
          aggregationType: MetricsAggregationType.Max,
        },
      ],
      firing: [
        below("busiest_connections", OPENSTACK_MEMCACHED_NO_CLIENT_CONNECTIONS),
        exactly("busiest_commands", 0),
      ],
      firingCondition: FilterCondition.All,
      recovery: [
        atLeast(
          "busiest_connections",
          OPENSTACK_MEMCACHED_NO_CLIENT_CONNECTIONS,
        ),
        above("busiest_commands", 0),
      ],
      recoveryCondition: FilterCondition.Any,
      words: {
        incidentTitle: "[OpenStack] Memcached No Connections",
        incidentDescription: `Memcached answers, and nothing in this region is using it: no client is connected, and nothing has asked it anything. Every API is validating its tokens the long way. Usually memcached_servers points somewhere else after a change. Check [keystone_authtoken] memcached_servers in each service's config, then openstack token issue to feel how slow Keystone has become. The incident resolves on its own once something connects.`,
        criteriaName: "No Connections - nothing connected, nothing asked",
        criteriaDescription: `Triggers when every Memcached in a region has fewer than ${OPENSTACK_MEMCACHED_NO_CLIENT_CONNECTIONS} connections and none is asked anything for the whole window.`,
      },
    });
  },
};

const memcachedEvictionsHighTemplate: OpenStackAlertTemplate = {
  id: "openstack-memcached-evictions-high",
  name: "Memcached Evictions High",
  summary: `A Memcached evicts over ${OPENSTACK_MEMCACHED_EVICTIONS_WARNING_PER_MINUTE} items a minute for 10 minutes.`,
  description: `Alert when a Memcached throws out more than ${OPENSTACK_MEMCACHED_EVICTIONS_WARNING_PER_MINUTE} items a minute, every minute for 10 minutes, to make room (memcached_items_evicted_increase, how much its own counter grew). It is too small for what is asked of it, so tokens are validated again and again. One incident per Memcached. Check \`echo stats | nc localhost 11211\` for limit_maxbytes and evictions, then raise its -m setting.`,
  category: "Memcached",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    const alias: string = "evictions_per_minute";

    return buildStep({
      args,
      rollingTime: PART_WINDOW,
      groupByAttributeKeys: MACHINE_GROUP,
      queries: [
        {
          alias,
          metricName: "memcached_items_evicted_increase",
          aggregationType: MetricsAggregationType.Max,
        },
      ],
      firing: [above(alias, OPENSTACK_MEMCACHED_EVICTIONS_WARNING_PER_MINUTE)],
      recovery: [
        atMost(
          alias,
          deadBandBelow(OPENSTACK_MEMCACHED_EVICTIONS_WARNING_PER_MINUTE),
        ),
      ],
      recoveryCondition: FilterCondition.All,
      words: {
        incidentTitle: `[OpenStack] Memcached Evictions High (>${OPENSTACK_MEMCACHED_EVICTIONS_WARNING_PER_MINUTE} a minute)`,
        incidentDescription: `This Memcached keeps throwing items out to make room, so it is too small for what is asked of it and tokens are validated again and again (openstack token issue is slower for it). Check its limit_maxbytes and evictions with echo stats | nc on port 11211, then raise its -m setting. The incident resolves on its own once it falls back.`,
        criteriaName: `Evictions High - more than ${OPENSTACK_MEMCACHED_EVICTIONS_WARNING_PER_MINUTE} a minute`,
        criteriaDescription: `Triggers when a Memcached evicts more than ${OPENSTACK_MEMCACHED_EVICTIONS_WARNING_PER_MINUTE} items in every minute of the window.`,
      },
    });
  },
};

/*
 * HAProxy.
 */

const HAPROXY_RESPONSES: string = "haproxy_backend_http_responses_increase";

function responsesOfClass(alias: string, code: string): OpenStackQuery {
  return {
    alias,
    metricName: HAPROXY_RESPONSES,
    aggregationType: MetricsAggregationType.Max,
    attributes: { code },
  };
}

const HAPROXY_RESPONSE_QUERIES: Array<OpenStackQuery> = [
  responsesOfClass("responses_2xx", "2xx"),
  responsesOfClass("responses_3xx", "3xx"),
  responsesOfClass("responses_4xx", "4xx"),
  responsesOfClass("responses_5xx", "5xx"),
];

const haProxyDownTemplate: OpenStackAlertTemplate = {
  id: "openstack-haproxy-down",
  name: "HAProxy Down",
  summary: "No HAProxy in a region answers for 5 minutes.",
  description:
    "Alert when no HAProxy in a region answers for 5 minutes (up reads 0 on every one, because its Prometheus exporter is inside it). One incident per region, and every API's own alert on this cloud waits for it. Check `systemctl status haproxy` and the virtual IP on each load balancer, then `openstack token issue`.",
  category: "HAProxy",
  severity: "Critical",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    return buildStep({
      args,
      rollingTime: WHOLE_WINDOW,
      groupByAttributeKeys: REGION_GROUP,
      queries: [
        upOf(
          "any_haproxy_answers",
          OpenStackDependency.HaProxy,
          MetricsAggregationType.Max,
        ),
      ],
      firing: [below("any_haproxy_answers", 1)],
      recovery: [atLeast("any_haproxy_answers", 1)],
      recoveryCondition: FilterCondition.All,
      words: {
        incidentTitle: "[OpenStack] HAProxy Down",
        incidentDescription: `No HAProxy in this region answers. ${takesDownOf(OpenStackDependency.HaProxy)} Check systemctl status haproxy and the virtual IP on each load balancer, then openstack token issue. The incident resolves on its own once one answers again.`,
        criteriaName: "HAProxy Down - none answers",
        criteriaDescription:
          "Triggers when no HAProxy in a region answers for the whole window.",
      },
    });
  },
};

const haProxyBackendDownTemplate: OpenStackAlertTemplate = {
  id: "openstack-haproxy-backend-down",
  name: "HAProxy Backend Down",
  summary: "An HAProxy backend has no server left for 5 minutes.",
  description:
    "Alert when every load balancer in a region calls a backend DOWN for 5 minutes (haproxy_backend_status with state DOWN reads 1 on each). That API cannot be reached, however healthy its service is. One incident per backend, which names it. It reads the backend's own state and never its server count, because a section with no servers reads 0 servers for ever. Check `echo 'show servers state' | socat stdio <admin socket>`, then the service behind it and its health check, and `openstack endpoint list`.",
  category: "HAProxy",
  severity: "Critical",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    const alias: string = "backend_down_everywhere";

    return buildStep({
      args,
      rollingTime: WHOLE_WINDOW,
      groupByAttributeKeys: BACKEND_GROUP,
      queries: [
        {
          alias,
          metricName: "haproxy_backend_status",
          aggregationType: MetricsAggregationType.Min,
          attributes: { state: "DOWN" },
        },
      ],
      firing: [above(alias, 0)],
      recovery: [exactly(alias, 0)],
      recoveryCondition: FilterCondition.All,
      words: {
        incidentTitle: "[OpenStack] HAProxy Backend Down",
        incidentDescription: `This backend has no server left, so the API behind it cannot be reached however healthy its service is, and everything that calls it fails too (openstack endpoint list shows which). Check the service on each controller and its health check, and HAProxy's view of it with show servers state on its admin socket. The incident resolves on its own once a server is back.`,
        criteriaName: "Backend Down - no server left",
        criteriaDescription:
          "Triggers when every load balancer in a region calls a backend DOWN for the whole window.",
      },
    });
  },
};

const haProxyServerDownTemplate: OpenStackAlertTemplate = {
  id: "openstack-haproxy-server-down",
  name: "HAProxy Server Down",
  summary: "A backend's server fails its health check for 10 minutes.",
  description:
    "Alert when a load balancer calls one of a backend's servers DOWN for 10 minutes while the backend still has others (haproxy_server_status with state DOWN). The API still answers, with less room, and one more failure takes it away. One incident per backend, naming its servers. A backend with no server left is HAProxy Backend Down, so it does not open this as well. Servers in maintenance read as neither. Check that service on the machine named, its health check, and `openstack endpoint list`.",
  category: "HAProxy",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    return buildStep({
      args,
      rollingTime: PART_WINDOW,
      groupByAttributeKeys: BACKEND_GROUP,
      queries: [
        {
          alias: "server_down",
          metricName: "haproxy_server_status",
          aggregationType: MetricsAggregationType.Max,
          attributes: { state: "DOWN" },
        },
        {
          alias: "backend_down_everywhere",
          metricName: "haproxy_backend_status",
          aggregationType: MetricsAggregationType.Min,
          attributes: { state: "DOWN" },
        },
      ],
      firing: [above("server_down", 0), below("backend_down_everywhere", 1)],
      firingCondition: FilterCondition.All,
      recovery: [exactly("server_down", 0)],
      recoveryCondition: FilterCondition.All,
      words: {
        incidentTitle: "[OpenStack] HAProxy Server Down",
        incidentDescription: `One of this backend's servers fails its health check. The API still answers from the others, with less room, and one more failure takes it away (openstack endpoint list shows which API). Check that service on the machine named above, and its health check. The incident resolves on its own once it passes again.`,
        criteriaName: "Server Down - a server is out, and others are left",
        criteriaDescription:
          "Triggers when a backend's server is DOWN and the backend still has others for the whole window.",
      },
    });
  },
};

function buildResponseRateTemplate(data: {
  id: string;
  name: string;
  summary: string;
  description: string;
  severity: "Critical" | "Warning";
  responsesAlias: string;
  percentAlias: string;
  legend: string;
  line: number;
  incidentDescription: string;
  criteriaName: string;
}): OpenStackAlertTemplate {
  return {
    id: data.id,
    name: data.name,
    summary: data.summary,
    description: data.description,
    category: "HAProxy",
    severity: data.severity,
    getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
      return buildStep({
        args,
        rollingTime: WHOLE_WINDOW,
        groupByAttributeKeys: BACKEND_GROUP,
        queries: [
          ...HAPROXY_RESPONSE_QUERIES,
          {
            alias: "servers_left",
            metricName: "haproxy_backend_active_servers",
            aggregationType: MetricsAggregationType.Min,
          },
        ],
        formulas: [
          {
            alias: data.percentAlias,
            legend: data.legend,
            legendUnit: "%",
            formula: `(${data.responsesAlias} / (responses_2xx + responses_3xx + responses_4xx + responses_5xx)) * 100`,
          },
        ],
        firing: [
          above(data.percentAlias, data.line),
          // With none left it is HAProxy Backend Down, which already says so.
          atLeast("servers_left", 1),
        ],
        firingCondition: FilterCondition.All,
        recovery: [atMost(data.percentAlias, deadBandBelow(data.line))],
        recoveryCondition: FilterCondition.All,
        words: {
          incidentTitle: `[OpenStack] ${data.name} (>${data.line}%)`,
          incidentDescription: data.incidentDescription,
          criteriaName: data.criteriaName,
          criteriaDescription: `Triggers when more than ${data.line}% of a backend's responses are of this class, in every minute of the window, with servers left to answer.`,
        },
      });
    },
  };
}

const haProxyApi5xxRateHighTemplate: OpenStackAlertTemplate =
  buildResponseRateTemplate({
    id: "openstack-haproxy-api-5xx-rate-high",
    name: "API 5xx Rate High",
    summary: `Over ${OPENSTACK_HAPROXY_ERROR_RESPONSES_WARNING_PERCENT}% of an API's responses through HAProxy are 5xx for 5 minutes.`,
    description: `Alert when more than ${OPENSTACK_HAPROXY_ERROR_RESPONSES_WARNING_PERCENT}% of a backend's responses are 5xx, in every minute for 5 minutes (haproxy_backend_http_responses_increase, how much each class grew). Its servers pass their health checks and fail real requests, which is what an API with no database looks like. One incident per backend. A backend with no server left is HAProxy Backend Down, so it does not open this as well. Check that service's log for the 500s, then the database and RabbitMQ behind it, and \`openstack endpoint list\`.`,
    severity: "Critical",
    responsesAlias: "responses_5xx",
    percentAlias: "responses_5xx_percent",
    legend: "5xx Responses (%)",
    line: OPENSTACK_HAPROXY_ERROR_RESPONSES_WARNING_PERCENT,
    incidentDescription: `This API's servers pass their health checks and fail real requests, which is what an API with no database or no RabbitMQ looks like. Check that service's log for the errors, then the database and RabbitMQ behind it (openstack endpoint list shows which API). The incident resolves on its own once it falls back.`,
    criteriaName: `API 5xx Rate High - more than ${OPENSTACK_HAPROXY_ERROR_RESPONSES_WARNING_PERCENT}%`,
  });

const haProxyApi4xxRateHighTemplate: OpenStackAlertTemplate =
  buildResponseRateTemplate({
    id: "openstack-haproxy-api-4xx-rate-high",
    name: "API 4xx Rate High",
    summary: `Over ${OPENSTACK_HAPROXY_CLIENT_ERROR_RESPONSES_WARNING_PERCENT}% of an API's responses through HAProxy are 4xx for 5 minutes.`,
    description: `Alert when more than ${OPENSTACK_HAPROXY_CLIENT_ERROR_RESPONSES_WARNING_PERCENT}% of a backend's responses are 4xx, in every minute for 5 minutes (haproxy_backend_http_responses_increase). HAProxy counts responses by class and no finer, so this is where a burst of 401s shows: the usual cause of this many is tokens nobody can validate, from Fernet keys that differ between controllers or a Keystone that lost its way. The line is higher than for 5xx because OpenStack's clients ask for what is not there as a matter of course. One incident per backend. Check \`openstack token issue\`, Fernet Key Rotation Out of Step, and that service's log.`,
    severity: "Warning",
    responsesAlias: "responses_4xx",
    percentAlias: "responses_4xx_percent",
    legend: "4xx Responses (%)",
    line: OPENSTACK_HAPROXY_CLIENT_ERROR_RESPONSES_WARNING_PERCENT,
    incidentDescription: `Many of this API's responses are refusals. HAProxy counts them by class and no finer, so a burst of 401s reads as this: tokens nobody can validate, from Fernet keys that differ between controllers or a Keystone that lost its way. Check openstack token issue, and that service's log for what it refused. The incident resolves on its own once it falls back.`,
    criteriaName: `API 4xx Rate High - more than ${OPENSTACK_HAPROXY_CLIENT_ERROR_RESPONSES_WARNING_PERCENT}%`,
  });

/*
 * OVN and Open vSwitch.
 */

const ovnControllerNotRunningTemplate: OpenStackAlertTemplate = {
  id: "openstack-ovn-controller-not-running",
  name: "OVN Controller Not Running",
  summary: "A chassis has no ovn-controller running for 5 minutes.",
  description:
    "Alert when a machine that is an OVN chassis has had no ovn-controller for 5 minutes. Its Open vSwitch still says it is a chassis (ovnc_encap_ip), and the series only a running ovn-controller has are gone (ovnc_rconn_queued). One incident per machine. Neutron reads ovn-controller and neutron-ovn-agent as down there within a minute, and Network Agent Down waits for this, so a stopped ovn-controller opens this and not three. What it programmed stays in place, so its instances keep their traffic, but new ports and changes do not reach that machine. Check `systemctl status ovn-controller` on it, or its container, and `openstack network agent list`.",
  category: "OVN and Open vSwitch",
  severity: "Critical",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    return buildStep({
      args,
      rollingTime: WHOLE_WINDOW,
      groupByAttributeKeys: MACHINE_GROUP,
      onlyWhereSeen: OPENSTACK_NETWORK_FACTS.OvnControllerSeenAt,
      queries: [
        {
          alias: "is_a_chassis",
          metricName: "ovnc_encap_ip",
          aggregationType: MetricsAggregationType.Min,
        },
        {
          alias: "controller_answers",
          metricName: "ovnc_rconn_queued",
          aggregationType: MetricsAggregationType.Max,
        },
      ],
      firing: [atLeast("is_a_chassis", 1), gone("controller_answers")],
      firingCondition: FilterCondition.All,
      recovery: [atLeast("controller_answers", 1)],
      recoveryCondition: FilterCondition.All,
      words: {
        incidentTitle: "[OpenStack] OVN Controller Not Running",
        incidentDescription: `ovn-controller is not running on the machine named above. What it programmed stays in place, so its instances keep their traffic, but new ports do not come up there and changes to networks do not reach it, and Neutron reads its ovn-controller and neutron-ovn-agent as down. Check systemctl status ovn-controller on that machine, or its container, and openstack network agent list. The incident resolves on its own once it is running again.`,
        criteriaName: "OVN Controller Not Running - a chassis without one",
        criteriaDescription:
          "Triggers when a machine is an OVN chassis and ovn-controller's own series are gone from it for the whole window.",
      },
    });
  },
};

const ovnDatabaseWithoutLeaderTemplate: OpenStackAlertTemplate = {
  id: "openstack-ovn-database-without-leader",
  name: "Northbound or Southbound Database Without a Leader",
  summary: "An OVN database's members read no leader for 5 minutes.",
  description:
    "Alert when no member of an OVN database says it leads for 5 minutes (ovn_raft_cluster_leader). One incident per region and database. Without a leader nothing can change the network, on any machine, though what is programmed keeps carrying traffic. openstack-network-exporter reads Southbound on a machine with both databases' sockets, as Kolla-Ansible's have, so Northbound shows only where a machine has no Southbound to read. Check `ovn-appctl -t /var/run/ovn/ovnsb_db.ctl cluster/status OVN_Southbound` on each member.",
  category: "OVN and Open vSwitch",
  severity: "Critical",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    return buildStep({
      args,
      rollingTime: WHOLE_WINDOW,
      groupByAttributeKeys: DATABASE_GROUP,
      queries: [
        {
          alias: "any_member_leads",
          metricName: "ovn_raft_cluster_leader",
          aggregationType: MetricsAggregationType.Max,
        },
      ],
      firing: [below("any_member_leads", 1)],
      recovery: [atLeast("any_member_leads", 1)],
      recoveryCondition: FilterCondition.All,
      words: {
        incidentTitle: "[OpenStack] OVN Database Without a Leader",
        incidentDescription: `No member of the OVN database named above says it leads, which usually means too few of its members can reach each other. Nothing can change the network on any machine until one does: no new ports, routers or security group changes, though what is programmed keeps carrying traffic. Check ovn-appctl -t /var/run/ovn/ovnsb_db.ctl cluster/status OVN_Southbound on each member, and the network between them. The incident resolves on its own once a member leads again.`,
        criteriaName: "OVN Database Without a Leader - no member leads",
        criteriaDescription:
          "Triggers when no member of an OVN database says it leads for the whole window.",
      },
    });
  },
};

const ovnNorthdNotActiveTemplate: OpenStackAlertTemplate = {
  id: "openstack-ovn-northd-not-active",
  name: "OVN Northd Not Active",
  summary: "No ovn-northd in a region is active for 10 minutes.",
  description:
    "Alert when no ovn-northd in a region reads active for 10 minutes (ovn_northd_status: 1 on the active one, 0 on a standby, and 0 everywhere when OVN's databases have all stopped, which leaves ovn_raft_cluster_leader with no series at all). One incident per region. One stopped member is fine, because a standby takes over. Nothing written to Northbound reaches the machines until one is active. Check `ovs-appctl -t ovn-northd status` on each, and that OVN's databases are running. It waits for a database without a leader, which says so first.",
  category: "OVN and Open vSwitch",
  severity: "Critical",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    return buildStep({
      args,
      rollingTime: PART_WINDOW,
      groupByAttributeKeys: REGION_GROUP,
      queries: [
        {
          alias: "any_northd_active",
          metricName: "ovn_northd_status",
          aggregationType: MetricsAggregationType.Max,
        },
      ],
      firing: [below("any_northd_active", 1)],
      recovery: [atLeast("any_northd_active", 1)],
      recoveryCondition: FilterCondition.All,
      words: {
        incidentTitle: "[OpenStack] OVN Northd Not Active",
        incidentDescription: `No ovn-northd in this region is active, so nothing written to OVN's Northbound database reaches the machines: new ports stay down and changes to networks do not arrive, though what is programmed keeps carrying traffic. Check ovs-appctl -t ovn-northd status on each, and that OVN's databases are running. The incident resolves on its own once one is active again.`,
        criteriaName: "OVN Northd Not Active - none active",
        criteriaDescription:
          "Triggers when no ovn-northd in a region reads active for the whole window.",
      },
    });
  },
};

const geneveTransmitErrorsTemplate: OpenStackAlertTemplate = {
  id: "openstack-geneve-transmit-errors",
  name: "Geneve Transmit Errors",
  summary:
    "A machine's Geneve tunnels fail to send, in every minute for 10 minutes.",
  description:
    "Alert when a machine's Geneve tunnels report transmit errors in every minute for 10 minutes (ovs_interface_tx_errors_increase, for interfaces of type geneve). One incident per machine. Instances on it lose traffic to other machines while those on the same machine are fine, which is what a bad NIC, a wrong MTU or a route gone from the tunnel network looks like. Check `ovs-vsctl list interface` for the tunnel's error, and `ip -s link` on the machine's tunnel network. Only a machine with a peer has a Geneve tunnel.",
  category: "OVN and Open vSwitch",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    return buildStep({
      args,
      rollingTime: PART_WINDOW,
      groupByAttributeKeys: MACHINE_GROUP,
      queries: [
        {
          alias: "tunnel_transmit_errors",
          metricName: "ovs_interface_tx_errors_increase",
          aggregationType: MetricsAggregationType.Max,
          attributes: { type: "geneve" },
        },
      ],
      firing: [above("tunnel_transmit_errors", 0)],
      recovery: [atMost("tunnel_transmit_errors", 0)],
      recoveryCondition: FilterCondition.All,
      words: {
        incidentTitle: "[OpenStack] Geneve Transmit Errors",
        incidentDescription: `The machine named above has been failing to send on its Geneve tunnels in every minute for 10 minutes. Its instances lose traffic to other machines while traffic on the machine itself is fine, which is what a bad NIC, a wrong MTU or a route gone from the tunnel network looks like. Check ovs-vsctl list interface for the tunnel's error, and ip -s link on its tunnel network. The incident resolves on its own once it stops.`,
        criteriaName: "Geneve Transmit Errors - errors every minute",
        criteriaDescription:
          "Triggers when a machine's Geneve tunnels report transmit errors in every minute of the window.",
      },
    });
  },
};

const ovsServiceDownTemplate: OpenStackAlertTemplate = {
  id: "openstack-ovs-service-down",
  name: "Open vSwitch Service Down",
  summary: "Open vSwitch stops on a machine it ran on, for 5 minutes.",
  description:
    "Alert when ovs-vswitchd stops answering on a machine it was running on for 5 minutes, with the exporter still answering (ovs_memory_rules_total is gone). One incident per machine. That machine's instances are off the network. A machine that never ran it never fires, because a host of only OVN's databases reads the same as a stopped one. Neutron reads that machine's Open vSwitch or OVN agents as down within two minutes, and Network Agent Down waits for this. Check `systemctl status openvswitch-switch` on it, or its containers, and `ovs-vsctl show`. Once it is back, restart openstack-network-exporter there too, which does not reconnect to its database on its own.",
  category: "OVN and Open vSwitch",
  severity: "Critical",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    return buildStep({
      args,
      rollingTime: WHOLE_WINDOW,
      groupByAttributeKeys: MACHINE_GROUP,
      onlyWhereSeen: OPENSTACK_NETWORK_FACTS.OvsSeenAt,
      queries: [
        {
          alias: "vswitchd_answers",
          metricName: "ovs_memory_rules_total",
          aggregationType: MetricsAggregationType.Max,
        },
        upOf(
          "exporter_answers",
          OpenStackDependency.Network,
          MetricsAggregationType.Min,
        ),
      ],
      firing: [gone("vswitchd_answers"), atLeast("exporter_answers", 1)],
      firingCondition: FilterCondition.All,
      recovery: [atLeast("vswitchd_answers", 1)],
      recoveryCondition: FilterCondition.All,
      words: {
        incidentTitle: "[OpenStack] Open vSwitch Service Down",
        incidentDescription: `Open vSwitch has stopped on the machine named above, which takes its instances off the network, and Neutron reads that machine's Open vSwitch or OVN agents as down. Check systemctl status openvswitch-switch on it, or its containers, and ovs-vsctl show. The incident resolves on its own once it answers again. Restart openstack-network-exporter on that machine afterwards: it does not reconnect to Open vSwitch's database on its own, and until it does ovn-controller and the tunnels there go unread.`,
        criteriaName: "Open vSwitch Service Down - gone from where it ran",
        criteriaDescription:
          "Triggers when ovs-vswitchd's own series are gone for the whole window from a machine it ran on, with the exporter answering.",
      },
    });
  },
};

const ovsDatabaseNotReadTemplate: OpenStackAlertTemplate = {
  id: "openstack-ovs-database-not-read",
  name: "Exporter Lost Open vSwitch's Database",
  summary:
    "An exporter stops reading a running Open vSwitch's database for 10 minutes.",
  description:
    "Alert when Open vSwitch is running on a machine and openstack-network-exporter has not read its database for 10 minutes (ovs_build_info is gone, and ovs_memory_rules_total is there). Version 0.3.0 connects to that database once, so this follows every restart of Open vSwitch and lasts until the exporter restarts. Nothing is wrong with the network, but until then OVN Controller Not Running and Geneve Transmit Errors cannot see this machine. One incident per machine. Check for a recent restart of Open vSwitch, then restart the exporter on that machine: `docker restart prometheus_openstack_network_exporter` on Kolla-Ansible.",
  category: "OVN and Open vSwitch",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    return buildStep({
      args,
      rollingTime: PART_WINDOW,
      groupByAttributeKeys: MACHINE_GROUP,
      onlyWhereSeen: OPENSTACK_NETWORK_FACTS.OvsDatabaseSeenAt,
      queries: [
        {
          alias: "database_read",
          metricName: "ovs_build_info",
          aggregationType: MetricsAggregationType.Max,
        },
        {
          alias: "vswitchd_answers",
          metricName: "ovs_memory_rules_total",
          aggregationType: MetricsAggregationType.Min,
        },
      ],
      firing: [gone("database_read"), atLeast("vswitchd_answers", 1)],
      firingCondition: FilterCondition.All,
      recovery: [atLeast("database_read", 1)],
      recoveryCondition: FilterCondition.All,
      words: {
        incidentTitle: "[OpenStack] Exporter Lost Open vSwitch's Database",
        incidentDescription: `openstack-network-exporter on the machine named above has stopped reading Open vSwitch's database, which it does after every restart of Open vSwitch, because it connects only once. Nothing is wrong with the network, but until the exporter restarts OVN Controller Not Running and Geneve Transmit Errors cannot see this machine. Check for a recent restart of Open vSwitch, then restart the exporter there (docker restart prometheus_openstack_network_exporter on Kolla-Ansible). The incident resolves on its own once it reads it again.`,
        criteriaName: "Exporter Lost Open vSwitch's Database - not read",
        criteriaDescription:
          "Triggers when Open vSwitch answers on a machine and its database's series are gone for the whole window.",
      },
    });
  },
};

function buildExporterTargetDownTemplate(data: {
  id: string;
  name: string;
  category: OpenStackControlPlaneCategory;
  dependency: OpenStackDependency;
  exporter: string;
  blindTo: string;
}): OpenStackAlertTemplate {
  return {
    id: data.id,
    name: data.name,
    summary: `${data.exporter} does not answer on a machine for 10 minutes.`,
    description: `Alert when the agent cannot read ${data.exporter} on a machine for 10 minutes (up reads 0). What it reports may be fine: this says it cannot be seen, so ${data.blindTo} on that machine are not being watched. One incident per machine. Check that the exporter is running there and that the agent can reach its port, with \`curl\` from the agent's machine.`,
    category: data.category,
    severity: "Warning",
    getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
      return buildStep({
        args,
        rollingTime: PART_WINDOW,
        groupByAttributeKeys: MACHINE_GROUP,
        queries: [
          upOf("exporter_answers", data.dependency, MetricsAggregationType.Max),
        ],
        firing: [below("exporter_answers", 1)],
        recovery: [atLeast("exporter_answers", 1)],
        recoveryCondition: FilterCondition.All,
        words: {
          incidentTitle: `[OpenStack] ${data.name}`,
          incidentDescription: `The agent has not been able to read ${data.exporter} on the machine named above for 10 minutes, so ${data.blindTo} there are not being watched. What it reports may be fine. Check that the exporter is running on that machine and that the agent can reach its port, with curl from the agent's machine. The incident resolves on its own once it answers again.`,
          criteriaName: `${data.name} - not answering`,
          criteriaDescription:
            "Triggers when the agent cannot read the exporter on a machine for the whole window.",
        },
      });
    },
  };
}

const networkExporterTargetDownTemplate: OpenStackAlertTemplate =
  buildExporterTargetDownTemplate({
    id: "openstack-network-exporter-target-down",
    name: "Network Exporter Target Down",
    category: "OVN and Open vSwitch",
    dependency: OpenStackDependency.Network,
    exporter: "openstack-network-exporter",
    blindTo: "Open vSwitch and ovn-controller",
  });

/*
 * libvirt.
 */

const libvirtServiceDownTemplate: OpenStackAlertTemplate = {
  id: "openstack-libvirt-service-down",
  name: "libvirt Service Down",
  summary: "libvirt does not answer on a machine for 5 minutes.",
  description:
    "Alert when libvirt does not answer on a machine for 5 minutes (libvirt_up reads 0, with the exporter still answering). One incident per machine. Its instances carry on, but none can be started, stopped or moved there. nova-compute disables itself on that machine, so Compute Service Down stays quiet and this is the one that speaks. It can stay disabled for a while after libvirt is back, which `openstack compute service list` shows. Check `systemctl status libvirtd` on it, or `docker ps` for nova_libvirt on Kolla-Ansible.",
  category: "libvirt",
  severity: "Critical",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    return buildStep({
      args,
      rollingTime: WHOLE_WINDOW,
      groupByAttributeKeys: MACHINE_GROUP,
      queries: [
        {
          alias: "libvirt_answers",
          metricName: "libvirt_up",
          aggregationType: MetricsAggregationType.Min,
        },
      ],
      firing: [below("libvirt_answers", 1)],
      recovery: [atLeast("libvirt_answers", 1)],
      recoveryCondition: FilterCondition.All,
      words: {
        incidentTitle: "[OpenStack] libvirt Service Down",
        incidentDescription: `${takesDownOf(OpenStackDependency.Libvirt)} Check systemctl status libvirtd on the machine named above, or nova_libvirt's container on Kolla-Ansible, and openstack compute service list. The incident resolves on its own once it answers again.`,
        criteriaName: "libvirt Service Down - not answering",
        criteriaDescription:
          "Triggers when libvirt does not answer on a machine for the whole window.",
      },
    });
  },
};

const libvirtExporterTargetDownTemplate: OpenStackAlertTemplate =
  buildExporterTargetDownTemplate({
    id: "openstack-libvirt-exporter-target-down",
    name: "libvirt Exporter Target Down",
    category: "libvirt",
    dependency: OpenStackDependency.Libvirt,
    exporter: "the libvirt exporter",
    blindTo: "libvirt's own health and the instances' usage",
  });

/*
 * What each dependency's templates are, in the order its page lists them. The pages read this,
 * and the alert templates' list is made from it.
 */
const TEMPLATES_BY_DEPENDENCY: Record<
  OpenStackDependency,
  Array<OpenStackAlertTemplate>
> = {
  [OpenStackDependency.RabbitMq]: [
    rabbitMqDownTemplate,
    rabbitMqNodeDownTemplate,
    rabbitMqPartitionTemplate,
    rabbitMqMemoryAlarmTemplate,
    rabbitMqDiskAlarmTemplate,
    rabbitMqFileDescriptorsHighTemplate,
    rabbitMqMessagesUnacknowledgedTemplate,
    rabbitMqQueueWithoutConsumersTemplate,
  ],
  [OpenStackDependency.MariaDb]: [
    mariaDbClusterDownTemplate,
    galeraClusterSizeDroppedTemplate,
    galeraNodeNotReadyTemplate,
    galeraNodeOutOfSyncTemplate,
    mariaDbTooManyConnectionsTemplate,
    mariaDbSlowQueriesTemplate,
  ],
  [OpenStackDependency.Memcached]: [
    memcachedClusterDownTemplate,
    memcachedNoConnectionsTemplate,
    memcachedEvictionsHighTemplate,
  ],
  [OpenStackDependency.HaProxy]: [
    haProxyDownTemplate,
    haProxyBackendDownTemplate,
    haProxyServerDownTemplate,
    haProxyApi5xxRateHighTemplate,
    haProxyApi4xxRateHighTemplate,
  ],
  [OpenStackDependency.Network]: [
    ovnControllerNotRunningTemplate,
    ovnDatabaseWithoutLeaderTemplate,
    ovnNorthdNotActiveTemplate,
    geneveTransmitErrorsTemplate,
    ovsServiceDownTemplate,
    ovsDatabaseNotReadTemplate,
    networkExporterTargetDownTemplate,
  ],
  [OpenStackDependency.Libvirt]: [
    libvirtServiceDownTemplate,
    libvirtExporterTargetDownTemplate,
  ],
};

export function getAllOpenStackControlPlaneAlertTemplates(): Array<OpenStackAlertTemplate> {
  return Object.values(TEMPLATES_BY_DEPENDENCY).flat();
}

export function getOpenStackControlPlaneTemplateIds(
  dependency: OpenStackDependency,
): Array<string> {
  return TEMPLATES_BY_DEPENDENCY[dependency].map(
    (template: OpenStackAlertTemplate): string => {
      return template.id;
    },
  );
}

/*
 * WHO WAITS FOR WHOM: one failure, one incident.
 *
 * Each of these reads a whole dependency, in a region. While it is down, the monitors below it
 * open nothing there (MonitorDependencySuppression), and their own status still moves. Nothing
 * here is about one machine: a monitor depends on a monitor, so a parent about one machine would
 * quiet a child's alerts about every other, for as long as that one machine stayed down.
 *
 * What a part of it is about, each a monitor of its own, waits for the whole of it too, so a
 * cluster that goes reads as that and not as each of its nodes.
 */
const CLOUD_STOPPED_REPORTING_TEMPLATE_ID: string =
  "openstack-cloud-stopped-reporting";

const WORKER_TEMPLATE_IDS: ReadonlyArray<string> = [
  "openstack-compute-service-down",
  "openstack-scheduler-or-conductor-down",
  "openstack-every-scheduler-or-conductor-down",
  "openstack-network-agent-down",
  "openstack-block-storage-service-down",
];

const API_TEMPLATE_IDS: ReadonlyArray<string> = [
  "openstack-identity-api-down",
  "openstack-compute-api-down",
  "openstack-network-api-down",
  "openstack-block-storage-api-down",
  "openstack-image-api-down",
  "openstack-placement-api-down",
];

const CHILDREN_OF_PARENT_TEMPLATE: Readonly<
  Record<string, ReadonlyArray<string>>
> = {
  [rabbitMqDownTemplate.id]: [
    rabbitMqNodeDownTemplate.id,
    ...WORKER_TEMPLATE_IDS,
    ...API_TEMPLATE_IDS,
    OPENSTACK_RABBITMQ_CONNECTION_LOST_TEMPLATE_ID,
    OPENSTACK_TOO_MANY_ERRORS_TEMPLATE_ID,
  ],
  [mariaDbClusterDownTemplate.id]: [
    galeraClusterSizeDroppedTemplate.id,
    galeraNodeNotReadyTemplate.id,
    galeraNodeOutOfSyncTemplate.id,
    ...WORKER_TEMPLATE_IDS,
    ...API_TEMPLATE_IDS,
    OPENSTACK_DATABASE_CONNECTION_LOST_TEMPLATE_ID,
    OPENSTACK_TOKEN_VALIDATION_FAILING_TEMPLATE_ID,
    OPENSTACK_TOO_MANY_ERRORS_TEMPLATE_ID,
    // The exporter logs in to read anything, so with no Keystone it answers nothing.
    CLOUD_STOPPED_REPORTING_TEMPLATE_ID,
  ],
  [haProxyDownTemplate.id]: [
    haProxyBackendDownTemplate.id,
    haProxyServerDownTemplate.id,
    haProxyApi5xxRateHighTemplate.id,
    haProxyApi4xxRateHighTemplate.id,
    ...API_TEMPLATE_IDS,
    CLOUD_STOPPED_REPORTING_TEMPLATE_ID,
  ],
  /*
   * Each of these is one machine's, and each speaks only for the agents that live on what it is
   * about: OPENSTACK_AGENTS_ON_A_MACHINES_SWITCH, by OpenStackDependencySuppression.
   */
  [ovnControllerNotRunningTemplate.id]: ["openstack-network-agent-down"],
  [ovsServiceDownTemplate.id]: ["openstack-network-agent-down"],
  [ovnDatabaseWithoutLeaderTemplate.id]: [ovnNorthdNotActiveTemplate.id],
};

// The templates whose monitors a monitor made from this one waits for.
export function getOpenStackTemplateParents(templateId: string): Array<string> {
  return Object.keys(CHILDREN_OF_PARENT_TEMPLATE).filter(
    (parent: string): boolean => {
      return CHILDREN_OF_PARENT_TEMPLATE[parent]!.includes(templateId);
    },
  );
}

// The templates whose monitors wait for a monitor made from this one.
export function getOpenStackTemplateChildren(
  templateId: string,
): ReadonlyArray<string> {
  return CHILDREN_OF_PARENT_TEMPLATE[templateId] || [];
}
