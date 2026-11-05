import ObjectID from "../ObjectID";
import { RunbookStep } from "../Runbook/RunbookStep";
import RunbookStepType from "../Runbook/RunbookStepType";
import { ResourceCommandTier } from "../ResourceAiAgent/ResourceAiAccess";
import { translationKey } from "../Translator";

/*
 * RUNBOOKS FOR THE COMMON FAILURES OF AN OPENSTACK CLOUD.
 *
 * Each says what to check, with the read to check it by, and which fix it may come to and
 * what tier that fix is. They are a person's steps, each a manual one: a runbook never
 * changes a cloud here, because a change goes through OneUptime AI's fixes and the command
 * policy, which a runbook's own step types would go around. A check or a fix written with an
 * ID is written with where the ID comes from, because a person is reading it at 3 a.m.
 *
 * OpenStackRunbookTemplates.test.ts holds every check to a Read and every fix to the tier it
 * says, against the policy itself, so these can't promise what the agent would refuse.
 *
 * Two failures have no fix OneUptime AI can make: RabbitMQ and Galera are below OpenStack, on
 * machines no command here reaches. Those say so, and say what a person does.
 */

export interface OpenStackRunbookCheck {
  title: string;
  // What to run: a read the policy allows, or null where it takes a shell on a machine.
  command: string | null;
  // What the answer means.
  whatItSays: string;
}

export enum OpenStackRunbookFixTier {
  Safe = "Safe",
  Riskier = "Riskier",
  AlwaysAsks = "Always asks a person",
  // Nothing OneUptime AI can run: a person, on the machines themselves.
  ByHand = "By hand",
}

// What a fix's tier reads as, as a key the dashboard looks up.
export const OPENSTACK_RUNBOOK_FIX_TIER_LABELS: Readonly<
  Record<OpenStackRunbookFixTier, string>
> = {
  [OpenStackRunbookFixTier.Safe]: translationKey("Safe"),
  [OpenStackRunbookFixTier.Riskier]: translationKey("Riskier"),
  [OpenStackRunbookFixTier.AlwaysAsks]: translationKey("Always asks a person"),
  [OpenStackRunbookFixTier.ByHand]: translationKey("By hand"),
};

export interface OpenStackRunbookFix {
  title: string;
  // The change as the policy spells it; null when it is not one the policy has.
  command: string | null;
  tier: OpenStackRunbookFixTier;
  whatItDoes: string;
}

export interface OpenStackRunbookTemplate {
  id: string;
  name: string;
  whenItIsFor: string;
  // The alert templates this answers, by their ids in the monitor's templates.
  alertTemplateIds: ReadonlyArray<string>;
  checks: ReadonlyArray<OpenStackRunbookCheck>;
  fixes: ReadonlyArray<OpenStackRunbookFix>;
}

// Written the way the policy reads them, with what goes in each place in capitals.
export const OPENSTACK_RUNBOOK_SERVER: string = "SERVER-ID";
export const OPENSTACK_RUNBOOK_HOST: string = "HOST";
export const OPENSTACK_RUNBOOK_AGENT: string = "AGENT-ID";
export const OPENSTACK_RUNBOOK_ROUTER: string = "ROUTER-ID";
export const OPENSTACK_RUNBOOK_VOLUME: string = "VOLUME-ID";

export const OPENSTACK_RUNBOOK_TEMPLATES: ReadonlyArray<OpenStackRunbookTemplate> =
  [
    {
      id: "openstack-compute-service-down",
      name: translationKey("OpenStack: compute service down"),
      whenItIsFor: translationKey(
        "A nova-compute reads down or disabled. Its instances may still be running: Nova can't say.",
      ),
      alertTemplateIds: ["openstack-compute-service-down"],
      checks: [
        {
          title: translationKey("Which service, and is it down or disabled"),
          command: "openstack compute service list --service nova-compute",
          whatItSays: translationKey(
            "State down means it stopped reporting. Status disabled means someone turned the scheduler off it, and disabled_reason says why.",
          ),
        },
        {
          title: translationKey("What that host holds, and whose"),
          command: `openstack server list --all-projects --host ${OPENSTACK_RUNBOOK_HOST} --limit 200`,
          whatItSays: translationKey(
            "An instance on a dead host keeps reading ACTIVE: host_status UNKNOWN is what says otherwise.",
          ),
        },
        {
          title: translationKey("Whether the host itself is alive"),
          command: null,
          whatItSays: translationKey(
            "Ask the machine, not OpenStack: is it up, and what does the nova-compute log say? An evacuation of a host that is still running runs its instances twice.",
          ),
        },
      ],
      fixes: [
        {
          title: translationKey(
            "It was only disabled: let the scheduler use it again",
          ),
          command: `openstack compute service set --enable ${OPENSTACK_RUNBOOK_HOST} nova-compute`,
          tier: OpenStackRunbookFixTier.Safe,
          whatItDoes: translationKey(
            "Lets new instances land there again, and moves nothing. Only if whoever disabled it is done with it.",
          ),
        },
        {
          title: translationKey(
            "It is up but failing: keep new instances off it",
          ),
          command: `openstack compute service set --disable --disable-reason "REASON" ${OPENSTACK_RUNBOOK_HOST} nova-compute`,
          tier: OpenStackRunbookFixTier.Riskier,
          whatItDoes: translationKey("Leaves what runs there running."),
        },
        {
          title: translationKey(
            "It is dead and not coming back: evacuate what it held",
          ),
          command: `openstack server evacuate ${OPENSTACK_RUNBOOK_SERVER}`,
          tier: OpenStackRunbookFixTier.AlwaysAsks,
          whatItDoes: translationKey(
            "Rebuilds those instances on another host, which loses what was on their local disks. Nova only takes it once the host reads down. Check it is fenced first.",
          ),
        },
      ],
    },
    {
      id: "openstack-instance-stuck",
      name: translationKey("OpenStack: instance stuck"),
      whenItIsFor: translationKey(
        "An instance has stayed in BUILD, REBOOT, MIGRATING or another state on the way to somewhere else.",
      ),
      alertTemplateIds: [
        "openstack-instance-stuck-building",
        "openstack-instance-stuck-transitioning",
        "openstack-instance-stuck-in-verify-resize",
      ],
      checks: [
        {
          title: translationKey("What state it is in, on which host"),
          command: `openstack server show ${OPENSTACK_RUNBOOK_SERVER}`,
          whatItSays: translationKey(
            "task_state says what it is waiting for, and fault what went wrong. host_status UNKNOWN means it is the host that is stuck, not the instance.",
          ),
        },
        {
          title: translationKey("What was asked of it, and what came of it"),
          command: `openstack server event list ${OPENSTACK_RUNBOOK_SERVER}`,
          whatItSays: translationKey(
            "Each action's request ID follows it through the logs of every service it touched.",
          ),
        },
        {
          title: translationKey("Whether its compute service answers"),
          command: `openstack compute service list --host ${OPENSTACK_RUNBOOK_HOST} --service nova-compute`,
          whatItSays: translationKey(
            "Down means this is the compute service down runbook.",
          ),
        },
      ],
      fixes: [
        {
          title: translationKey("It is stopped and should not be"),
          command: `openstack server start ${OPENSTACK_RUNBOOK_SERVER}`,
          tier: OpenStackRunbookFixTier.Safe,
          whatItDoes: translationKey("Starts it."),
        },
        {
          title: translationKey("Its guest is alive and needs a restart"),
          command: `openstack server reboot --soft ${OPENSTACK_RUNBOOK_SERVER}`,
          tier: OpenStackRunbookFixTier.Safe,
          whatItDoes: translationKey("Asks the guest to restart."),
        },
        {
          title: translationKey("Its guest does not answer"),
          command: `openstack server reboot --hard ${OPENSTACK_RUNBOOK_SERVER}`,
          tier: OpenStackRunbookFixTier.Riskier,
          whatItDoes: translationKey(
            "Power-cycles it, whatever the guest is doing.",
          ),
        },
        {
          title: translationKey("Its host is the trouble"),
          command: `openstack server migrate live ${OPENSTACK_RUNBOOK_SERVER} --host ${OPENSTACK_RUNBOOK_HOST}`,
          tier: OpenStackRunbookFixTier.Riskier,
          whatItDoes: translationKey(
            "Moves it while it runs, to a host you name.",
          ),
        },
        {
          title: translationKey(
            "Its task state is wrong, and nothing is running",
          ),
          command: null,
          tier: OpenStackRunbookFixTier.ByHand,
          whatItDoes: translationKey(
            "Forcing a state only changes what the database says, so OneUptime AI never does it. A person who has read the logs can, with openstack server set --state.",
          ),
        },
      ],
    },
    {
      id: "openstack-volume-stuck",
      name: translationKey("OpenStack: volume stuck"),
      whenItIsFor: translationKey(
        "A volume has stayed in creating, deleting, attaching or detaching.",
      ),
      alertTemplateIds: [
        "openstack-volume-stuck",
        "openstack-volumes-in-error",
        "openstack-volume-attach-failing",
      ],
      checks: [
        {
          title: translationKey("What state it is in, and who has it"),
          command: `openstack volume show ${OPENSTACK_RUNBOOK_VOLUME}`,
          whatItSays: translationKey(
            "attachments and migration_status say whether it is busy.",
          ),
        },
        {
          title: translationKey("Whether cinder-volume answers for its pool"),
          command: "openstack volume service list --service cinder-volume",
          whatItSays: translationKey(
            "A stopped cinder-volume leaves everything on its backend where it was.",
          ),
        },
        {
          title: translationKey("Whether its pool has room"),
          command: "openstack volume backend pool list",
          whatItSays: translationKey(
            "A full pool fails what asks it for space.",
          ),
        },
      ],
      fixes: [
        {
          title: translationKey(
            "Restart cinder-volume, or free space on its pool",
          ),
          command: null,
          tier: OpenStackRunbookFixTier.ByHand,
          whatItDoes: translationKey(
            "No command here changes a volume or its service: on a storage backend, the wrong word loses data. Resetting a volume's state is for a person who has read the logs, and never OneUptime AI.",
          ),
        },
      ],
    },
    {
      id: "openstack-router-without-agent",
      name: translationKey("OpenStack: router without an agent"),
      whenItIsFor: translationKey(
        "A router has no live L3 agent, so the networks behind it can't reach out. On ML2/OVS: OVN has no L3 agents.",
      ),
      alertTemplateIds: [
        "openstack-router-without-active-agent",
        "openstack-network-agent-down",
      ],
      checks: [
        {
          title: translationKey("Which agents are down or turned off"),
          command: "openstack network agent list",
          whatItSays: translationKey(
            "alive says whether it reports. admin_state_up false means someone turned it off.",
          ),
        },
        {
          title: translationKey("Which router, and whose"),
          command: `openstack router show ${OPENSTACK_RUNBOOK_ROUTER}`,
          whatItSays: translationKey("Its project is who to tell."),
        },
      ],
      fixes: [
        {
          title: translationKey("It was only turned off: turn it back on"),
          command: `openstack network agent set --enable ${OPENSTACK_RUNBOOK_AGENT}`,
          tier: OpenStackRunbookFixTier.Safe,
          whatItDoes: translationKey("Neutron schedules to it again."),
        },
        {
          title: translationKey("It is failing: keep new routers off it"),
          command: `openstack network agent set --disable ${OPENSTACK_RUNBOOK_AGENT}`,
          tier: OpenStackRunbookFixTier.Riskier,
          whatItDoes: translationKey(
            "Leaves what it serves on it. Rescheduling a router to another agent is for a person.",
          ),
        },
      ],
    },
    {
      id: "openstack-rabbitmq-partition",
      name: translationKey("OpenStack: RabbitMQ partition"),
      whenItIsFor: translationKey(
        "RabbitMQ's nodes disagree on who is in the cluster, so services stop hearing each other.",
      ),
      alertTemplateIds: [
        "openstack-rabbitmq-partition-detected",
        "openstack-rabbitmq-node-down",
      ],
      checks: [
        {
          title: translationKey("What stopped reporting because of it"),
          command: "openstack compute service list",
          whatItSays: translationKey(
            "Every service down at once points at the message bus, not at each service.",
          ),
        },
        {
          title: translationKey("What the cluster says of itself"),
          command: null,
          whatItSays: translationKey(
            "On a controller: rabbitmqctl cluster_status lists the partitions and the nodes on each side.",
          ),
        },
      ],
      fixes: [
        {
          title: translationKey("Heal the partition"),
          command: null,
          tier: OpenStackRunbookFixTier.ByHand,
          whatItDoes: translationKey(
            "Restart the nodes on the side you are giving up, on the machines themselves. RabbitMQ is below OpenStack: no command OneUptime AI has reaches it.",
          ),
        },
      ],
    },
    {
      id: "openstack-galera-lost-quorum",
      name: translationKey("OpenStack: Galera lost quorum"),
      whenItIsFor: translationKey(
        "MariaDB's Galera cluster has no primary component, so every service that writes its database fails.",
      ),
      alertTemplateIds: [
        "openstack-galera-cluster-size-dropped",
        "openstack-galera-node-not-ready",
      ],
      checks: [
        {
          title: translationKey("What is failing because of it"),
          command: "openstack endpoint list",
          whatItSays: translationKey(
            "Then read whether each service answers: an API that reads but can't write points at the database.",
          ),
        },
        {
          title: translationKey("What the cluster says of itself"),
          command: null,
          whatItSays: translationKey(
            "On each database node: SHOW STATUS LIKE 'wsrep_%'. wsrep_cluster_status other than Primary is what this is.",
          ),
        },
      ],
      fixes: [
        {
          title: translationKey("Bring the cluster back"),
          command: null,
          tier: OpenStackRunbookFixTier.ByHand,
          whatItDoes: translationKey(
            "Bootstrap from the node with the highest wsrep_last_committed, by hand, on the machines. Galera is below OpenStack: no command OneUptime AI has reaches it, and the wrong node loses transactions.",
          ),
        },
      ],
    },
  ];

function describeCheck(check: OpenStackRunbookCheck): string {
  return check.command
    ? `${check.command}\n\n${check.whatItSays}`
    : check.whatItSays;
}

function describeFix(fix: OpenStackRunbookFix): string {
  return [
    `Tier: ${fix.tier}.`,
    fix.command
      ? `Ask OneUptime AI for it, or run it yourself: ${fix.command}`
      : "",
    fix.whatItDoes,
  ]
    .filter((line: string): boolean => {
      return line.length > 0;
    })
    .join("\n\n");
}

/*
 * The steps a template becomes: a manual step for each check and each fix, in order. A
 * person ticks them off, and nothing here runs on its own.
 */
export function buildOpenStackRunbookSteps(
  template: OpenStackRunbookTemplate,
): Array<RunbookStep> {
  let order: number = 0;

  const step: (title: string, description: string) => RunbookStep = (
    title: string,
    description: string,
  ): RunbookStep => {
    order += 1;

    return {
      id: ObjectID.generate().toString(),
      order,
      type: RunbookStepType.Manual,
      title,
      description,
      config: {},
    } as RunbookStep;
  };

  return [
    ...template.checks.map((check: OpenStackRunbookCheck): RunbookStep => {
      return step(`Check: ${check.title}`, describeCheck(check));
    }),
    ...template.fixes.map((fix: OpenStackRunbookFix): RunbookStep => {
      return step(`Fix: ${fix.title}`, describeFix(fix));
    }),
  ];
}

// The tier the policy gives a fix a template names, for the test that holds them together.
export const OPENSTACK_RUNBOOK_TIER_OF_POLICY: Readonly<
  Record<string, OpenStackRunbookFixTier>
> = {
  [ResourceCommandTier.SafeWrite]: OpenStackRunbookFixTier.Safe,
  [ResourceCommandTier.RiskyWrite]: OpenStackRunbookFixTier.Riskier,
};
