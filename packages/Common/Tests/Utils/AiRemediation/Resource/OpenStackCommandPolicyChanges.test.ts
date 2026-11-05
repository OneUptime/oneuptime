import { describe, expect, test } from "@jest/globals";
import { generatedTexts } from "../../../Helpers/GeneratedTexts";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../../Helpers/SeededRandom";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import { AiRemediationCommandPolicyVerdict } from "../../../../Types/AutoRemediation/AiRemediationCommandPolicyVerdict";
import OpenStackCommandPolicy, {
  OPENSTACK_CHANGE_ROUTES,
  OPENSTACK_COMMAND_ROUTES,
  OPENSTACK_DRY_RUN_ROUTE,
  OPENSTACK_EVACUATION_UNATTENDED_MAX_INSTANCES,
  OPENSTACK_MAX_INSTANCES_PER_EVACUATION,
  OPENSTACK_SERVICE_ACTION_MICROVERSION,
  OpenStackApiRequest,
  OpenStackChangeRoute,
  OpenStackCommandParseResult,
  OpenStackLiveTarget,
  describeOpenStackTargetEntryProblem,
  getOpenStackDryRunCommand,
  getOpenStackLiveScopeRefusal,
  parseOpenStackCommand,
  readOpenStackChange,
} from "../../../../Utils/AiRemediation/Resource/OpenStackCommandPolicy";
import ResourceCommandPolicy from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicy";
import {
  ResourceAutoExecutionVerdict,
  ResourceCommandPolicyResult,
  tokenizeResourceCommand,
} from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicyCore";

/*
 * THE CHANGES OPENSTACK AI MAY MAKE: EVERY TIER AND EVERY REFUSAL.
 *
 * This changes a customer's production cloud, so what is pinned here is the whole
 * list and its opposite. Each of the ten changes has its tier, its one spelling and the
 * exact call it becomes. The rest is refused: everything that deletes, anything in
 * Keystone, quotas, security groups, forcing a state, new subcommands, other flag
 * orders, abbreviations, and arguments that try to carry a second action.
 */

const SERVER: string = "358ee736-ba74-40ba-a354-7ead413c5df6";
const OTHER: string = "4d955c70-df91-45ae-be57-044f4bcaefec";
const THIRD: string = "6c9d9b3a-7a53-4d7e-8f6a-2a1f5b0c9e11";
const AGENT: string = "d7e6c5b4-a392-4180-b6f5-e4d3c2b1a098";
const PROJECT: string = "9aee824cac87464292adffc328de1662";
const HOST: string = "compute-01";

function policyOf(command: string): ResourceCommandPolicyResult {
  return ResourceCommandPolicy.evaluateCommand({
    resourceType: AiResourceType.OpenStackCloud,
    command,
  });
}

function wordsOf(command: string): Array<string> {
  const argv: Array<string> | undefined = tokenizeResourceCommand(command).argv;

  if (!argv) {
    throw new Error(`"${command}" does not tokenize`);
  }

  return argv;
}

function requestOf(command: string): OpenStackApiRequest {
  const parsed: OpenStackCommandParseResult = parseOpenStackCommand(
    wordsOf(command),
  );

  if (!parsed.request) {
    throw new Error(`"${command}" was refused: ${parsed.errorMessage}`);
  }

  return parsed.request;
}

function expectDenied(command: string, reason?: RegExp): void {
  const result: ResourceCommandPolicyResult = policyOf(command);

  expect({ command, tier: result.tier }).toEqual({
    command,
    tier: ResourceCommandTier.Denied,
  });

  // The agent's translation refuses exactly what the policy refuses.
  const argv: Array<string> | undefined = tokenizeResourceCommand(command).argv;

  if (argv) {
    expect(parseOpenStackCommand(argv).request).toBeUndefined();
  }

  if (reason) {
    expect(result.reason).toMatch(reason);
  }
}

interface ChangeRow {
  command: string;
  tier: ResourceCommandTier;
  method: "POST" | "PUT";
  service: string;
  paths: Array<string>;
  body: Record<string, unknown>;
  targets: Array<string>;
  microversion?: string;
  requiresHuman?: boolean;
}

const CHANGES: ReadonlyArray<ChangeRow> = [
  {
    command: `openstack server start ${SERVER}`,
    tier: ResourceCommandTier.SafeWrite,
    method: "POST",
    service: "compute",
    paths: [`/servers/${SERVER}/action`],
    body: { "os-start": null },
    targets: [`instance:${SERVER}`],
  },
  {
    command: `openstack server reboot --soft ${SERVER}`,
    tier: ResourceCommandTier.SafeWrite,
    method: "POST",
    service: "compute",
    paths: [`/servers/${SERVER}/action`],
    body: { reboot: { type: "SOFT" } },
    targets: [`instance:${SERVER}`],
  },
  {
    command: `openstack server reboot --hard ${SERVER}`,
    tier: ResourceCommandTier.RiskyWrite,
    method: "POST",
    service: "compute",
    paths: [`/servers/${SERVER}/action`],
    body: { reboot: { type: "HARD" } },
    targets: [`instance:${SERVER}`],
  },
  {
    command: `openstack server migrate ${SERVER}`,
    tier: ResourceCommandTier.RiskyWrite,
    method: "POST",
    service: "compute",
    paths: [`/servers/${SERVER}/action`],
    body: { migrate: null },
    targets: [`instance:${SERVER}`, "destination:the-scheduler-chooses"],
  },
  {
    command: `openstack server migrate ${SERVER} --host compute-02`,
    tier: ResourceCommandTier.RiskyWrite,
    method: "POST",
    service: "compute",
    paths: [`/servers/${SERVER}/action`],
    body: { migrate: { host: "compute-02" } },
    targets: [`instance:${SERVER}`, "destination:compute-02"],
  },
  {
    command: `openstack server migrate live ${SERVER}`,
    tier: ResourceCommandTier.RiskyWrite,
    method: "POST",
    service: "compute",
    paths: [`/servers/${SERVER}/action`],
    body: { "os-migrateLive": { host: null, block_migration: "auto" } },
    targets: [`instance:${SERVER}`, "destination:the-scheduler-chooses"],
  },
  {
    command: `openstack server migrate live ${SERVER} --host compute-02`,
    tier: ResourceCommandTier.RiskyWrite,
    method: "POST",
    service: "compute",
    paths: [`/servers/${SERVER}/action`],
    body: { "os-migrateLive": { host: "compute-02", block_migration: "auto" } },
    targets: [`instance:${SERVER}`, "destination:compute-02"],
  },
  {
    command: `openstack server evacuate ${SERVER}`,
    tier: ResourceCommandTier.RiskyWrite,
    method: "POST",
    service: "compute",
    paths: [`/servers/${SERVER}/action`],
    body: { evacuate: {} },
    targets: [`instance:${SERVER}`, "destination:the-scheduler-chooses"],
    requiresHuman: true,
  },
  {
    command: `openstack server evacuate ${SERVER} ${OTHER} --host compute-02`,
    tier: ResourceCommandTier.RiskyWrite,
    method: "POST",
    service: "compute",
    paths: [`/servers/${SERVER}/action`, `/servers/${OTHER}/action`],
    body: { evacuate: { host: "compute-02" } },
    targets: [
      `instance:${SERVER}`,
      `instance:${OTHER}`,
      "destination:compute-02",
    ],
    requiresHuman: true,
  },
  {
    command: `openstack compute service set --enable ${HOST} nova-compute`,
    tier: ResourceCommandTier.SafeWrite,
    method: "PUT",
    service: "compute",
    paths: ["/os-services/enable"],
    body: { host: HOST, binary: "nova-compute" },
    targets: [`host:${HOST}`],
    microversion: OPENSTACK_SERVICE_ACTION_MICROVERSION,
  },
  {
    command: `openstack compute service set --disable --disable-reason "disk failing, ticket 4521" ${HOST} nova-compute`,
    tier: ResourceCommandTier.RiskyWrite,
    method: "PUT",
    service: "compute",
    paths: ["/os-services/disable-log-reason"],
    body: {
      host: HOST,
      binary: "nova-compute",
      disabled_reason: "disk failing, ticket 4521",
    },
    targets: [`host:${HOST}`],
    microversion: OPENSTACK_SERVICE_ACTION_MICROVERSION,
  },
  {
    command: `openstack network agent set --enable ${AGENT}`,
    tier: ResourceCommandTier.SafeWrite,
    method: "PUT",
    service: "network",
    paths: [`/agents/${AGENT}`],
    body: { agent: { admin_state_up: true } },
    targets: [`agent:${AGENT}`],
  },
  {
    command: `openstack network agent set --disable ${AGENT}`,
    tier: ResourceCommandTier.RiskyWrite,
    method: "PUT",
    service: "network",
    paths: [`/agents/${AGENT}`],
    body: { agent: { admin_state_up: false } },
    targets: [`agent:${AGENT}`],
  },
];

describe("every change, its tier and its one call", () => {
  test("the issue's list and no other", () => {
    expect(
      OPENSTACK_CHANGE_ROUTES.map((route: OpenStackChangeRoute) => {
        return [route.route, route.tier];
      }),
    ).toEqual([
      ["server start", ResourceCommandTier.SafeWrite],
      ["server reboot --soft", ResourceCommandTier.SafeWrite],
      ["server reboot --hard", ResourceCommandTier.RiskyWrite],
      ["server migrate", ResourceCommandTier.RiskyWrite],
      ["server migrate live", ResourceCommandTier.RiskyWrite],
      ["server evacuate", ResourceCommandTier.RiskyWrite],
      ["compute service set --enable", ResourceCommandTier.SafeWrite],
      ["compute service set --disable", ResourceCommandTier.RiskyWrite],
      ["network agent set --enable", ResourceCommandTier.SafeWrite],
      ["network agent set --disable", ResourceCommandTier.RiskyWrite],
    ]);
  });

  test("every route has a row here", () => {
    for (const route of OPENSTACK_CHANGE_ROUTES) {
      expect(
        CHANGES.filter((row: ChangeRow): boolean => {
          return (
            readOpenStackChange(wordsOf(row.command))?.route === route.route
          );
        }).length,
      ).toBeGreaterThan(0);
    }
  });

  test.each(
    CHANGES.map((row: ChangeRow) => {
      return [row.command, row] as [string, ChangeRow];
    }),
  )("%s", (_command: string, row: ChangeRow) => {
    const result: ResourceCommandPolicyResult = policyOf(row.command);

    expect(result.tier).toBe(row.tier);
    expect(result.targets).toEqual(row.targets);
    expect(result.requiresHuman === true).toBe(row.requiresHuman === true);
    expect(result.program).toBe("openstack");
    expect(result.reason.length).toBeGreaterThan(10);

    const request: OpenStackApiRequest = requestOf(row.command);

    expect(request.method).toBe(row.method);
    expect(request.service).toBe(row.service);
    expect(request.paths).toEqual(row.paths);
    expect(request.path).toBe(row.paths[0]);
    expect(request.body).toEqual(row.body);
    expect(request.query).toEqual({});
    expect(request.microversion).toBe(row.microversion);
  });

  test("a change may name another region, last", () => {
    const request: OpenStackApiRequest = requestOf(
      `openstack server migrate ${SERVER} --host compute-02 --os-region-name RegionTwo`,
    );

    expect(request.regionName).toBe("RegionTwo");
    expect(request.body).toEqual({ migrate: { host: "compute-02" } });
    expect(
      requestOf(`openstack server start ${SERVER} --os-region-name RegionTwo`)
        .regionName,
    ).toBe("RegionTwo");
  });

  test("a change's words survive being rendered and read again", () => {
    for (const row of CHANGES) {
      const shown: string = policyOf(row.command).displayCommand;

      expect(policyOf(shown).tier).toBe(row.tier);
      expect(requestOf(shown).body).toEqual(row.body);
    }
  });

  test("a read is still no change, and no read has a body", () => {
    expect(requestOf("openstack server list").body).toBeUndefined();
    expect(requestOf("openstack server list").change).toBeUndefined();
    expect(readOpenStackChange(["openstack", "server", "list"])).toBeNull();
    for (const route of OPENSTACK_COMMAND_ROUTES) {
      expect(route.tier).toBe(ResourceCommandTier.Read);
    }
  });
});

describe("denied: whoever approves it", () => {
  test.each([
    // Anything that deletes.
    [`openstack server delete ${SERVER}`, /deletes/],
    [`openstack server delete --force ${SERVER}`, /deletes/],
    [`openstack volume delete ${SERVER}`, /deletes/],
    [`openstack volume delete --purge ${SERVER}`, /deletes/],
    [`openstack volume snapshot delete ${SERVER}`, /deletes/],
    [`openstack volume backup delete ${SERVER}`, /deletes/],
    [`openstack project delete ${PROJECT}`, /deletes/],
    [`openstack project purge --project ${PROJECT}`, /deletes/],
    [`openstack project cleanup --project ${PROJECT}`, /deletes/],
    [`openstack network delete ${SERVER}`, /deletes/],
    [`openstack subnet delete ${SERVER}`, /deletes/],
    [`openstack router delete ${SERVER}`, /deletes/],
    [`openstack port delete ${SERVER}`, /deletes/],
    [`openstack floating ip delete ${SERVER}`, /deletes/],
    [`openstack image delete ${SERVER}`, /deletes/],
    [`openstack flavor delete m1.tiny`, /deletes/],
    [`openstack network agent delete ${SERVER}`, /deletes/],
    ["openstack compute service delete 1", /deletes/],
    [`openstack volume service delete ${SERVER}`, /deletes/],
    [`openstack hypervisor delete ${SERVER}`, /deletes/],
    // Anything in Keystone.
    ["openstack user create oneuptime --password x", /Keystone/],
    ["openstack user set --password x admin", /Keystone/],
    ["openstack user delete admin", /Keystone/],
    ["openstack user list", /Keystone/],
    ["openstack role add --user admin --project admin admin", /Keystone/],
    ["openstack role assignment list", /Keystone/],
    ["openstack credential create admin secret", /Keystone/],
    ["openstack credential delete 1", /Keystone/],
    ["openstack application credential create x", /Keystone/],
    ["openstack application credential delete x", /Keystone/],
    ["openstack token issue", /Keystone/],
    ["openstack trust create a b", /Keystone/],
    ["openstack group add user a b", /Keystone/],
    ["openstack keypair delete a", /Keystone/],
    ["openstack project create x", /change the cloud/],
    ["openstack domain set --disable x", /change the cloud/],
    ["openstack endpoint delete x", /deletes/],
    ["openstack service delete x", /deletes/],
    // Quotas.
    ["openstack quota set --instances 100 abc", /quotas/],
    ["openstack quota delete abc", /quotas/],
    ["openstack quota show abc", /quotas/],
    ["openstack limits show --absolute", /quotas/],
    // Security groups.
    ["openstack security group create x", /security groups/i],
    ["openstack security group delete x", /security groups/i],
    ["openstack security group set --name y x", /security groups/i],
    ["openstack security group rule create x", /security groups/i],
    ["openstack security group rule delete x", /security groups/i],
    ["openstack security group list", /security groups/i],
    // Forcing a state.
    [`openstack server set --state error ${SERVER}`, /forcing a state/],
    [`openstack server set --state active ${SERVER}`, /forcing a state/],
    [`openstack volume set --state available ${SERVER}`, /forcing a state/],
    [
      `openstack volume snapshot set --state error ${SERVER}`,
      /forcing a state/,
    ],
    [`openstack volume backup set --state error ${SERVER}`, /forcing a state/],
    [`openstack server reset state ${SERVER}`, /change the cloud/],
    // Forcing a service down.
    [
      `openstack compute service set --down ${HOST} nova-compute`,
      /forcing a service down/,
    ],
    [
      `openstack compute service set --up ${HOST} nova-compute`,
      /forcing a service down/,
    ],
    [
      `openstack compute service set --disable --down ${HOST} nova-compute`,
      /forcing a service down/,
    ],
    // Other changes nobody listed.
    [`openstack server stop ${SERVER}`, /change the cloud/],
    [`openstack server rebuild ${SERVER}`, /change the cloud/],
    [`openstack server resize ${SERVER}`, /change the cloud/],
    [`openstack server shelve ${SERVER}`, /change the cloud/],
    [`openstack server lock ${SERVER}`, /change the cloud/],
    [`openstack server pause ${SERVER}`, /change the cloud/],
    [`openstack server suspend ${SERVER}`, /change the cloud/],
    [`openstack server resume ${SERVER}`, /change the cloud/],
    [`openstack server rescue ${SERVER}`, /change the cloud/],
    [`openstack server create --image x y`, /change the cloud/],
    [
      `openstack volume service set --disable ${HOST} cinder-volume`,
      /change the cloud/,
    ],
    [`openstack volume migrate --host a@b#c ${SERVER}`, /change the cloud/],
    [`openstack router set --disable ${SERVER}`, /change the cloud/],
    [`openstack port set --disable ${SERVER}`, /change the cloud/],
    [`openstack network set --disable ${SERVER}`, /change the cloud/],
    [`openstack image set --public ${SERVER}`, /change the cloud/],
    [`openstack aggregate add host agg ${HOST}`, /change the cloud/],
    [`openstack flavor set --property a=b ${SERVER}`, /change the cloud/],
  ])("%s", (command: string, reason: RegExp) => {
    expectDenied(command, reason);
  });
});

describe("denied: new subcommands, and what the real client would also take", () => {
  test.each([
    // Subcommands no one listed under a change's own words.
    [`openstack server migrate confirm ${SERVER}`],
    [`openstack server migrate revert ${SERVER}`],
    [`openstack server migrate abort ${SERVER}`],
    [`openstack server migrate list ${SERVER}`],
    [`openstack server migrate live abort ${SERVER}`],
    [`openstack server migrate cold ${SERVER}`],
    [`openstack server migration confirm ${SERVER}`],
    [`openstack server migration abort ${SERVER} 1`],
    [`openstack server migration force complete ${SERVER} 1`],
    [`openstack server evacuate all ${HOST}`],
    [`openstack server evacuate --all-on ${HOST}`],
    [`openstack server start all`],
    [`openstack server reboot all`],
    [`openstack server restart ${SERVER}`],
    [`openstack hypervisor evacuate ${HOST}`],
    [`openstack host evacuate ${HOST}`],
    [`openstack compute service set`],
    [`openstack compute service set --enable`],
    [`openstack compute service unset ${HOST}`],
    [`openstack compute service evacuate ${HOST}`],
    [`openstack network agent set`],
    [`openstack network agent set --enable`],
    [`openstack network agent set ${AGENT}`],
    [`openstack network agent start ${AGENT}`],
    // The real client's other flags on the same words.
    [`openstack server reboot ${SERVER}`],
    [`openstack server reboot --soft --wait ${SERVER}`],
    [`openstack server reboot --hard --wait ${SERVER}`],
    [`openstack server start --wait ${SERVER}`],
    [`openstack server start --all-projects ${SERVER}`],
    [`openstack server migrate --live-migration ${SERVER}`],
    [`openstack server migrate --live-migration --host compute-02 ${SERVER}`],
    [`openstack server migrate --live compute-02 ${SERVER}`],
    [`openstack server migrate --shared-migration ${SERVER}`],
    [`openstack server migrate --block-migration ${SERVER}`],
    [`openstack server migrate --disk-overcommit ${SERVER}`],
    [`openstack server migrate --no-disk-overcommit ${SERVER}`],
    [`openstack server migrate --wait ${SERVER}`],
    [`openstack server migrate live --force ${SERVER}`],
    [`openstack server migrate live ${SERVER} --block-migration`],
    [`openstack server migrate live ${SERVER} --disk-overcommit`],
    [`openstack server evacuate --password hunter2 ${SERVER}`],
    [`openstack server evacuate ${SERVER} --password hunter2`],
    [`openstack server evacuate --shared-storage ${SERVER}`],
    [`openstack server evacuate ${SERVER} --on-shared-storage`],
    [`openstack server evacuate --wait ${SERVER}`],
    [`openstack server evacuate ${SERVER} --force`],
    [`openstack compute service set --disable ${HOST} nova-compute`],
    [`openstack compute service set --disable-reason why ${HOST} nova-compute`],
    [`openstack compute service set --enable --disable ${HOST} nova-compute`],
    [`openstack compute service set --disable --enable ${HOST} nova-compute`],
    [
      `openstack compute service set --enable --disable-reason why ${HOST} nova-compute`,
    ],
    [`openstack compute service set ${HOST} nova-compute`],
    [`openstack compute service set --enable ${HOST}`],
    [`openstack compute service set --enable ${HOST} nova-scheduler`],
    [`openstack compute service set --enable ${HOST} nova-conductor`],
    [`openstack compute service set --enable ${HOST} cinder-volume`],
    [`openstack compute service set --enable nova-compute ${HOST}`],
    [`openstack network agent set --description why --enable ${AGENT}`],
    [`openstack network agent set --enable --disable ${AGENT}`],
    [`openstack network agent set --disable --description why ${AGENT}`],
    // Output and login options a change has no use for.
    [`openstack server start ${SERVER} -f json`],
    [`openstack server start ${SERVER} --format json`],
    [`openstack server start ${SERVER} -c id`],
    [`openstack server start ${SERVER} --os-cloud other`],
    [`openstack server start ${SERVER} --os-auth-url http://x/`],
    [`openstack server start ${SERVER} --insecure`],
    [`openstack --os-cloud other server start ${SERVER}`],
    [`openstack --os-region-name RegionTwo server start ${SERVER}`],
    [`openstack server start --os-region-name RegionTwo ${SERVER}`],
    // A destination on what moves nothing.
    [`openstack server start ${SERVER} --host compute-02`],
    [`openstack server reboot --hard ${SERVER} --host compute-02`],
    [`openstack network agent set --enable ${AGENT} --host compute-02`],
  ])("%s", (command: string) => {
    expectDenied(command);
  });
});

describe("denied: odd flag orders", () => {
  test.each([
    [`openstack server reboot ${SERVER} --soft`],
    [`openstack server reboot ${SERVER} --hard`],
    [`openstack --soft server reboot ${SERVER}`],
    [`openstack reboot server --hard ${SERVER}`],
    [`openstack server --hard reboot ${SERVER}`],
    [`openstack server migrate --host compute-02 ${SERVER}`],
    [`openstack server migrate live --host compute-02 ${SERVER}`],
    [`openstack server migrate ${SERVER} live`],
    [`openstack server evacuate --host compute-02 ${SERVER}`],
    [`openstack server evacuate ${SERVER} --host compute-02 ${OTHER}`],
    [
      `openstack server migrate ${SERVER} --os-region-name RegionTwo --host compute-02`,
    ],
    [`openstack compute service set ${HOST} nova-compute --enable`],
    [`openstack compute service set ${HOST} --enable nova-compute`],
    [
      `openstack compute service set --disable-reason why --disable ${HOST} nova-compute`,
    ],
    [
      `openstack compute service set --disable ${HOST} nova-compute --disable-reason why`,
    ],
    [
      `openstack compute service set ${HOST} nova-compute --disable --disable-reason why`,
    ],
    [`openstack network agent set ${AGENT} --enable`],
    [`openstack network agent set ${AGENT} --disable`],
  ])("%s", (command: string) => {
    expectDenied(command);
  });

  test("the refusal writes out the spelling", () => {
    expectDenied(
      `openstack server reboot ${SERVER} --hard`,
      /openstack server reboot --soft SERVER-ID; openstack server reboot --hard SERVER-ID/,
    );
    expectDenied(
      `openstack compute service set ${HOST} nova-compute --enable`,
      /openstack compute service set --enable HOST nova-compute/,
    );
  });

  test("however its words are shuffled, a change only runs in its one order", () => {
    const random: SeededRandom = seededRandom(5747);

    for (const row of CHANGES) {
      const canonical: Array<string> = wordsOf(row.command).slice(1);
      const key: string = JSON.stringify(canonical);

      for (let i: number = 0; i < 300; i++) {
        const words: Array<string> = shuffled(canonical, random);

        if (JSON.stringify(words) === key) {
          continue;
        }

        const result: ResourceCommandPolicyResult =
          OpenStackCommandPolicy.evaluateArgv(["openstack", ...words]);

        /*
         * Two instances swapped are the same evacuation of the same instances:
         * nothing else may read as a change.
         */
        const isSwappedIdsOnly: boolean =
          row.command.includes(" evacuate ") &&
          words[0] === "server" &&
          words[1] === "evacuate" &&
          words[words.length - 2] === canonical[canonical.length - 2] &&
          words[words.length - 1] === canonical[canonical.length - 1];

        if (!isSwappedIdsOnly) {
          expect({ words, tier: result.tier }).toEqual({
            words,
            tier: ResourceCommandTier.Denied,
          });
        }
      }
    }
  });

  test("dropping any word refuses it, unless the word was optional", () => {
    for (const row of CHANGES) {
      const canonical: Array<string> = wordsOf(row.command).slice(1);

      for (let i: number = 0; i < canonical.length; i++) {
        const words: Array<string> = canonical.filter(
          (_word: string, index: number): boolean => {
            return index !== i;
          },
        );
        const result: ResourceCommandPolicyResult =
          OpenStackCommandPolicy.evaluateArgv(["openstack", ...words]);
        /*
         * What is left is another listed change in two cases only: one of an
         * evacuation's two instances, and the word live.
         */
        const isAnotherChange: boolean =
          (row.command.includes(" evacuate ") &&
            canonical.includes(SERVER) &&
            canonical.includes(OTHER) &&
            [SERVER, OTHER].includes(canonical[i] as string)) ||
          canonical[i] === "live";

        if (!isAnotherChange) {
          expect({ words, tier: result.tier }).toEqual({
            words,
            tier: ResourceCommandTier.Denied,
          });
        }
      }
    }
  });

  test("adding any flag anywhere refuses it", () => {
    const flags: ReadonlyArray<string> = [
      "--wait",
      "--force",
      "--all",
      "--all-projects",
      "--insecure",
      "--debug",
      "--yes",
      "-f",
      "-c",
      "--",
      "--soft",
      "--hard",
      "--enable",
      "--disable",
      "--down",
      "--up",
      "--state",
      "--password",
      "--live-migration",
    ];

    for (const row of CHANGES) {
      const canonical: Array<string> = wordsOf(row.command).slice(1);

      for (const flag of flags) {
        for (let at: number = 0; at <= canonical.length; at++) {
          const words: Array<string> = [
            ...canonical.slice(0, at),
            flag,
            ...canonical.slice(at),
          ];

          expect({
            words,
            tier: OpenStackCommandPolicy.evaluateArgv(["openstack", ...words])
              .tier,
          }).toEqual({ words, tier: ResourceCommandTier.Denied });
        }
      }
    }
  });
});

describe("denied: abbreviations", () => {
  test.each([
    [`openstack server reboot --s ${SERVER}`],
    [`openstack server reboot --so ${SERVER}`],
    [`openstack server reboot --sof ${SERVER}`],
    [`openstack server reboot --h ${SERVER}`],
    [`openstack server reboot --har ${SERVER}`],
    [`openstack server reboot -s ${SERVER}`],
    [`openstack server reboot -h ${SERVER}`],
    [`openstack server reboot --SOFT ${SERVER}`],
    [`openstack server reboot --Soft ${SERVER}`],
    [`openstack server migrate ${SERVER} --ho compute-02`],
    [`openstack server migrate ${SERVER} --hos compute-02`],
    [`openstack server migrate ${SERVER} --host=compute-02`],
    [`openstack compute service set --en ${HOST} nova-compute`],
    [`openstack compute service set --enabl ${HOST} nova-compute`],
    [
      `openstack compute service set --dis --disable-reason why ${HOST} nova-compute`,
    ],
    [
      `openstack compute service set --disable --disable-r why ${HOST} nova-compute`,
    ],
    [
      `openstack compute service set --disable --disable-reason=why ${HOST} nova-compute`,
    ],
    [`openstack network agent set --en ${AGENT}`],
    [`openstack network agent set --dis ${AGENT}`],
    // The words themselves.
    [`openstack server star ${SERVER}`],
    [`openstack server reb --soft ${SERVER}`],
    [`openstack server mig ${SERVER}`],
    [`openstack server evac ${SERVER}`],
    [`openstack comp service set --enable ${HOST} nova-compute`],
    [`openstack compute serv set --enable ${HOST} nova-compute`],
    [`openstack net agent set --enable ${AGENT}`],
    [`openstack network ag set --enable ${AGENT}`],
    // Another case, or a character that only looks right.
    [`openstack Server start ${SERVER}`],
    [`openstack SERVER START ${SERVER}`],
    [`OPENSTACK server start ${SERVER}`],
    [`openstack ѕerver start ${SERVER}`],
    [`openstack server ѕtart ${SERVER}`],
    [`openstack server reboot —soft ${SERVER}`],
    [`openstack server reboot ––soft ${SERVER}`],
  ])("%s", (command: string) => {
    expectDenied(command);
  });

  test("every prefix of every flag of a change is refused", () => {
    for (const route of OPENSTACK_CHANGE_ROUTES) {
      const pieces: Array<string> = route.spelling.split(" ");

      pieces.forEach((piece: string, index: number): void => {
        if (!piece.startsWith("--")) {
          return;
        }

        for (let length: number = 1; length < piece.length; length++) {
          const words: Array<string> = pieces.map(
            (word: string, at: number): string => {
              if (at === index) {
                return piece.slice(0, length);
              }

              if (word === "{server}" || word === "{servers}") {
                return SERVER;
              }

              if (word === "{agent}") {
                return AGENT;
              }

              if (word === "{host}") {
                return HOST;
              }

              return word === "{reason}" ? "why" : word;
            },
          );

          expect({
            words,
            tier: OpenStackCommandPolicy.evaluateArgv(["openstack", ...words])
              .tier,
          }).toEqual({ words, tier: ResourceCommandTier.Denied });
        }
      });
    }
  });
});

describe("denied: arguments that smuggle a second action", () => {
  test.each([
    // A second ID, on what changes one instance.
    [`openstack server start ${SERVER} ${OTHER}`],
    [`openstack server reboot --soft ${SERVER} ${OTHER}`],
    [`openstack server reboot --hard ${SERVER} ${OTHER}`],
    [`openstack server migrate ${SERVER} ${OTHER}`],
    [`openstack server migrate live ${SERVER} ${OTHER}`],
    [`openstack network agent set --enable ${AGENT} ${SERVER}`],
    // An ID that is not one, or a path.
    [`openstack server start ../../servers/${SERVER}/action`],
    [`openstack server start ${SERVER}/../${OTHER}`],
    [`openstack server start ${SERVER}/action`],
    [`openstack server start ${SERVER}?force=1`],
    [`openstack server start ${SERVER}#x`],
    [`openstack server start %2e%2e%2fservers`],
    [`openstack server start web-1`],
    [`openstack server start ${SERVER.toUpperCase()}`],
    [`openstack server start ${SERVER.replace(/-/g, "")}`],
    [`openstack server start ${SERVER}0`],
    [`openstack server start ${SERVER.slice(0, 35)}`],
    [`openstack server start "${SERVER} "`],
    [`openstack server start " ${SERVER}"`],
    [`openstack server start '${SERVER} --delete'`],
    [`openstack server start ''`],
    [`openstack server start '*'`],
    [`openstack server evacuate ${SERVER} ${SERVER}`],
    [`openstack server evacuate ${SERVER} web-1`],
    [`openstack server evacuate '${SERVER} ${OTHER}'`],
    [`openstack network agent set --enable ../${AGENT}`],
    [`openstack network agent set --enable ${AGENT}/l3-routers`],
    // A host that is not one.
    [
      `openstack compute service set --enable "compute-01 nova-compute" nova-compute`,
    ],
    [`openstack compute service set --enable compute-01/.. nova-compute`],
    [`openstack compute service set --enable -compute-01 nova-compute`],
    [`openstack compute service set --enable '*' nova-compute`],
    [`openstack compute service set --enable '' nova-compute`],
    [`openstack compute service set --enable compute-01@backend nova-compute`],
    [`openstack server migrate ${SERVER} --host 'compute-02 --force'`],
    [`openstack server migrate ${SERVER} --host --force`],
    [`openstack server migrate ${SERVER} --host`],
    [`openstack server migrate ${SERVER} --host compute-02 --host compute-03`],
    [`openstack server evacuate ${SERVER} --host '../x'`],
    // A reason that tries to be something else.
    [
      `openstack compute service set --disable --disable-reason --enable ${HOST} nova-compute`,
    ],
    [
      `openstack compute service set --disable --disable-reason -x ${HOST} nova-compute`,
    ],
    [
      `openstack compute service set --disable --disable-reason '' ${HOST} nova-compute`,
    ],
    [
      `openstack compute service set --disable --disable-reason ' why' ${HOST} nova-compute`,
    ],
    [
      `openstack compute service set --disable --disable-reason 'why"' ${HOST} nova-compute`,
    ],
    [
      `openstack compute service set --disable --disable-reason "it's" ${HOST} nova-compute`,
    ],
    [
      `openstack compute service set --disable --disable-reason '{"a":1}' ${HOST} nova-compute`,
    ],
    [
      `openstack compute service set --disable --disable-reason 'a;b' ${HOST} nova-compute`,
    ],
    [
      `openstack compute service set --disable --disable-reason 'a|b' ${HOST} nova-compute`,
    ],
    [
      `openstack compute service set --disable --disable-reason 'a&b' ${HOST} nova-compute`,
    ],
    [
      `openstack compute service set --disable --disable-reason 'a>b' ${HOST} nova-compute`,
    ],
    [
      `openstack compute service set --disable --disable-reason 'é' ${HOST} nova-compute`,
    ],
    [
      `openstack compute service set --disable --disable-reason '${"a".repeat(256)}' ${HOST} nova-compute`,
    ],
    // A region that is not one.
    [`openstack server start ${SERVER} --os-region-name '../x'`],
    [`openstack server start ${SERVER} --os-region-name`],
    [`openstack server start ${SERVER} --os-region-name --force`],
    [`openstack server start ${SERVER} --os-region-name a --os-region-name b`],
    // Words after the end.
    [`openstack server start ${SERVER} delete`],
    [`openstack server start ${SERVER} -- --force`],
    [`openstack server reboot --soft ${SERVER} server delete ${OTHER}`],
    [`openstack compute service set --enable ${HOST} nova-compute extra`],
    [`openstack network agent set --enable ${AGENT} delete`],
  ])("%s", (command: string) => {
    expectDenied(command);
  });

  test.each([
    [`openstack server start ${SERVER}; openstack server delete ${SERVER}`],
    [`openstack server start ${SERVER} && openstack server delete ${SERVER}`],
    [`openstack server start ${SERVER} || openstack server delete ${SERVER}`],
    [`openstack server start ${SERVER} | sh`],
    [`openstack server start ${SERVER} > /tmp/x`],
    [`openstack server start $(openstack server delete ${SERVER})`],
    [`openstack server start \`id\``],
    [`openstack server start ${SERVER}\nopenstack server delete ${SERVER}`],
    [`sudo openstack server start ${SERVER}`],
    [`/usr/bin/openstack server start ${SERVER}`],
    [`nova reset-state ${SERVER}`],
    [`bash -c 'openstack server start ${SERVER}'`],
  ])("the shell has no way in: %s", (command: string) => {
    expect(policyOf(command).tier).toBe(ResourceCommandTier.Denied);
  });

  test("an argv word can hold neither a newline nor a NUL", () => {
    for (const word of [`${SERVER}\n`, `${SERVER}\0`, `\r${SERVER}`]) {
      expect(
        ResourceCommandPolicy.evaluateArgv({
          resourceType: AiResourceType.OpenStackCloud,
          argv: ["openstack", "server", "start", word],
        }).tier,
      ).toBe(ResourceCommandTier.Denied);
    }
  });

  test("what the body holds comes from a validated word, and nothing else", () => {
    const reason: string = "evacuate now, delete all: see ticket #12 (a+b=c)";
    const request: OpenStackApiRequest = requestOf(
      `openstack compute service set --disable --disable-reason "${reason}" ${HOST} nova-compute`,
    );

    expect(request.body).toEqual({
      host: HOST,
      binary: "nova-compute",
      disabled_reason: reason,
    });
    expect(request.paths).toEqual(["/os-services/disable-log-reason"]);
  });
});

describe("the blast-radius guard: an evacuation always asks", () => {
  function ids(count: number): Array<string> {
    return Array.from({ length: count }, (_value: unknown, index: number) => {
      return `${index.toString(16).padStart(8, "0")}-ba74-40ba-a354-7ead413c5df6`;
    });
  }

  const everyMode: ReadonlyArray<{
    name: string;
    bypassApproval: boolean;
    allowlist: (command: string) => Array<string>;
  }> = [
    {
      name: "Automatic",
      bypassApproval: false,
      allowlist: () => {
        return [];
      },
    },
    {
      name: "Automatic, with the exact command on the allowlist",
      bypassApproval: false,
      allowlist: (command: string) => {
        return [command];
      },
    },
    {
      name: "Bypass approval",
      bypassApproval: true,
      allowlist: () => {
        return [];
      },
    },
    {
      name: "Bypass approval, with the exact command on the allowlist",
      bypassApproval: true,
      allowlist: (command: string) => {
        return [command];
      },
    },
  ];

  test("the number it states is zero", () => {
    expect(OPENSTACK_EVACUATION_UNATTENDED_MAX_INSTANCES).toBe(0);
  });

  test.each([1, 2, 3, 5, 10, 25, OPENSTACK_MAX_INSTANCES_PER_EVACUATION])(
    "of %d instances, in every mode, allowlist included",
    (count: number) => {
      const command: string = `openstack server evacuate ${ids(count).join(" ")}`;

      for (const mode of everyMode) {
        const verdict: ResourceAutoExecutionVerdict =
          ResourceCommandPolicy.evaluateForAutoExecution({
            resourceType: AiResourceType.OpenStackCloud,
            command,
            allowlistPatterns: mode.allowlist(command),
            bypassApproval: mode.bypassApproval,
          });

        expect({ mode: mode.name, verdict: verdict.verdict }).toEqual({
          mode: mode.name,
          verdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
        });
        expect(verdict.requiresHuman).toBe(true);
        expect(verdict.tier).toBe(ResourceCommandTier.RiskyWrite);
      }
    },
  );

  test("with a destination and a region too", () => {
    const command: string = `openstack server evacuate ${SERVER} --host compute-02 --os-region-name RegionTwo`;
    const verdict: ResourceAutoExecutionVerdict =
      ResourceCommandPolicy.evaluateForAutoExecution({
        resourceType: AiResourceType.OpenStackCloud,
        command,
        allowlistPatterns: [command],
        bypassApproval: true,
      });

    expect(verdict.requiresHuman).toBe(true);
    expect(verdict.verdict).toBe(
      AiRemediationCommandPolicyVerdict.RequiresApproval,
    );
  });

  test("one command names at most the stated number of instances, and each once", () => {
    const command: string = `openstack server evacuate ${ids(OPENSTACK_MAX_INSTANCES_PER_EVACUATION).join(" ")}`;

    expect(policyOf(command).tier).toBe(ResourceCommandTier.RiskyWrite);
    expect(policyOf(command).targets.length).toBe(
      OPENSTACK_MAX_INSTANCES_PER_EVACUATION + 1,
    );
    expectDenied(
      `openstack server evacuate ${ids(OPENSTACK_MAX_INSTANCES_PER_EVACUATION + 1).join(" ")}`,
      /at most 50 instances/,
    );
    expectDenied(
      `openstack server evacuate ${SERVER} ${OTHER} ${SERVER}`,
      /named twice/,
    );
  });

  test("the words of the largest fit what a command may hold, as a dry run too", () => {
    const longest: string = `openstack server evacuate ${ids(OPENSTACK_MAX_INSTANCES_PER_EVACUATION).join(" ")} --host compute-02.example.internal --os-region-name RegionTwo`;
    const dryRun: string | null = getOpenStackDryRunCommand(longest);

    expect(policyOf(longest).tier).toBe(ResourceCommandTier.RiskyWrite);
    expect(dryRun).not.toBeNull();
    expect(policyOf(dryRun as string).tier).toBe(ResourceCommandTier.Read);
  });

  test("an allowlist entry cannot pre-approve one, and says so", () => {
    expect(
      ResourceCommandPolicy.describeAllowlistPatternProblem({
        resourceType: AiResourceType.OpenStackCloud,
        pattern: `openstack server evacuate ${SERVER}`,
      }),
    ).toMatch(/always asks a person/);
    expect(
      ResourceCommandPolicy.describeAllowlistPatternProblem({
        resourceType: AiResourceType.OpenStackCloud,
        pattern: "openstack server evacuate *",
      }),
    ).toMatch(/always asks a person/);
  });
});

describe("the ladder, for every other change", () => {
  const SAFE: ReadonlyArray<string> = CHANGES.filter((row: ChangeRow) => {
    return row.tier === ResourceCommandTier.SafeWrite;
  }).map((row: ChangeRow) => {
    return row.command;
  });
  const RISKY: ReadonlyArray<string> = CHANGES.filter((row: ChangeRow) => {
    return (
      row.tier === ResourceCommandTier.RiskyWrite && row.requiresHuman !== true
    );
  }).map((row: ChangeRow) => {
    return row.command;
  });

  function verdictOf(
    command: string,
    allowlistPatterns: Array<string>,
    bypassApproval: boolean,
  ): AiRemediationCommandPolicyVerdict {
    return ResourceCommandPolicy.evaluateForAutoExecution({
      resourceType: AiResourceType.OpenStackCloud,
      command,
      allowlistPatterns,
      bypassApproval,
    }).verdict;
  }

  test.each(
    SAFE.map((command: string) => {
      return [command];
    }),
  )("%s runs unattended", (command: string) => {
    expect(verdictOf(command, [], false)).toBe(
      AiRemediationCommandPolicyVerdict.AutoApproved,
    );
  });

  test.each(
    RISKY.map((command: string) => {
      return [command];
    }),
  )("%s needs approval, unless allowlisted or bypassed", (command: string) => {
    expect(verdictOf(command, [], false)).toBe(
      AiRemediationCommandPolicyVerdict.RequiresApproval,
    );
    expect(verdictOf(command, [], true)).toBe(
      AiRemediationCommandPolicyVerdict.AutoApproved,
    );
    expect(verdictOf(command, [command], false)).toBe(
      AiRemediationCommandPolicyVerdict.AutoApproved,
    );
  });

  test("a Denied command stays Denied, whatever is set", () => {
    const command: string = `openstack server delete ${SERVER}`;

    expect(verdictOf(command, [command], true)).toBe(
      AiRemediationCommandPolicyVerdict.Denied,
    );
  });

  test("an allowlist entry holds for its words and no others", () => {
    const entry: string = `openstack server reboot --hard ${SERVER}`;

    expect(verdictOf(entry, [entry], false)).toBe(
      AiRemediationCommandPolicyVerdict.AutoApproved,
    );
    expect(
      verdictOf(`openstack server reboot --hard ${OTHER}`, [entry], false),
    ).toBe(AiRemediationCommandPolicyVerdict.RequiresApproval);
  });

  test("an entry with a * for the instance is valid, and broad", () => {
    const pattern: string = "openstack server reboot --hard *";

    expect(
      ResourceCommandPolicy.describeAllowlistPatternProblem({
        resourceType: AiResourceType.OpenStackCloud,
        pattern,
      }),
    ).toBeNull();
    expect(
      ResourceCommandPolicy.isBroadAllowlistPattern({
        resourceType: AiResourceType.OpenStackCloud,
        pattern,
      }),
    ).toBe(true);
    expect(
      ResourceCommandPolicy.matchesAllowlist({
        resourceType: AiResourceType.OpenStackCloud,
        command: `openstack server reboot --hard ${SERVER}`,
        patterns: [pattern],
      }),
    ).toBe(true);
    expect(
      ResourceCommandPolicy.matchesAllowlist({
        resourceType: AiResourceType.OpenStackCloud,
        command: `openstack server reboot --soft ${SERVER}`,
        patterns: [pattern],
      }),
    ).toBe(false);
  });

  test("an entry for a read, or a Denied command, is refused", () => {
    for (const pattern of [
      "openstack server list",
      "openstack server delete *",
      "openstack * start",
      `openstack server stop ${SERVER}`,
      "openstack dry-run server start *",
    ]) {
      expect({
        pattern,
        refused:
          ResourceCommandPolicy.describeAllowlistPatternProblem({
            resourceType: AiResourceType.OpenStackCloud,
            pattern,
          }) !== null,
      }).toEqual({ pattern, refused: true });
    }
  });
});

describe("a dry run", () => {
  test.each(
    CHANGES.map((row: ChangeRow) => {
      return [row.command, row] as [string, ChangeRow];
    }),
  )(
    "of %s is a read that holds the change it reads",
    (command: string, row: ChangeRow) => {
      const dryRun: string = getOpenStackDryRunCommand(command) as string;
      const result: ResourceCommandPolicyResult = policyOf(dryRun);

      expect(result.tier).toBe(ResourceCommandTier.Read);
      expect(result.verb).toBe(OPENSTACK_DRY_RUN_ROUTE);
      expect(result.targets).toEqual([]);
      expect(result.requiresHuman).toBeUndefined();

      const request: OpenStackApiRequest = requestOf(dryRun);

      expect(request.method).toBe("GET");
      expect(request.route).toBe(OPENSTACK_DRY_RUN_ROUTE);
      expect(request.dryRunOf?.body).toEqual(row.body);
      expect(request.dryRunOf?.paths).toEqual(row.paths);
      expect(request.dryRunOf?.change?.route).toBe(
        readOpenStackChange(wordsOf(command))?.route,
      );
      // What a read carries itself: nothing to send.
      expect(request.body).toBeUndefined();
      expect(request.change).toBeUndefined();
    },
  );

  test.each([
    ["openstack dry-run"],
    ["openstack dry-run server list"],
    [`openstack dry-run server delete ${SERVER}`],
    [`openstack dry-run server stop ${SERVER}`],
    [`openstack dry-run server start`],
    [`openstack dry-run server reboot ${SERVER}`],
    [`openstack dry-run dry-run server start ${SERVER}`],
    [`openstack server start --dry-run ${SERVER}`],
    [`openstack server dry-run start ${SERVER}`],
    [`openstack dry-run user list`],
  ])("%s is refused", (command: string) => {
    expectDenied(command);
  });

  test("there is none of a read, or of what the policy refuses", () => {
    expect(getOpenStackDryRunCommand("openstack server list")).toBeNull();
    expect(
      getOpenStackDryRunCommand(`openstack server delete ${SERVER}`),
    ).toBeNull();
    expect(getOpenStackDryRunCommand("docker ps")).toBeNull();
    expect(getOpenStackDryRunCommand("")).toBeNull();
    expect(getOpenStackDryRunCommand("a; b")).toBeNull();
  });
});

describe("where a change may land, on what its words say", () => {
  function refusal(
    command: string,
    lists: {
      allowWrites?: boolean;
      protectedTargets?: Array<string>;
      writeTargets?: Array<string>;
    },
  ): string | null {
    return ResourceCommandPolicy.getWriteScopeRefusal({
      result: policyOf(command),
      allowWrites: lists.allowWrites !== false,
      writeTargets: lists.writeTargets || [],
      protectedTargets: lists.protectedTargets || [],
      resourceType: AiResourceType.OpenStackCloud,
    });
  }

  test("an agent that may not write refuses every change, and no read", () => {
    for (const row of CHANGES) {
      expect(refusal(row.command, { allowWrites: false })).toMatch(/read-only/);
    }
    expect(refusal("openstack server list", { allowWrites: false })).toBeNull();
    expect(
      refusal(`openstack dry-run server start ${SERVER}`, {
        allowWrites: false,
      }),
    ).toBeNull();
  });

  test("a protected instance, by its ID or a pattern, in any case", () => {
    const command: string = `openstack server start ${SERVER}`;

    for (const entry of [
      `instance:${SERVER}`,
      `instance:${SERVER.toUpperCase()}`,
      "instance:358ee736-*",
      "instance:*",
    ]) {
      expect(refusal(command, { protectedTargets: [entry] })).toMatch(
        /wins over every other setting/,
      );
    }

    expect(
      refusal(command, { protectedTargets: [`instance:${OTHER}`] }),
    ).toBeNull();
  });

  test("one protected instance among an evacuation's stops all of it", () => {
    expect(
      refusal(`openstack server evacuate ${SERVER} ${OTHER} ${THIRD}`, {
        protectedTargets: [`instance:${OTHER}`, "project:abc"],
      }),
    ).toMatch(new RegExp(OTHER));
  });

  test("a protected host, by its short or its full name", () => {
    const command: string = `openstack compute service set --enable ${HOST} nova-compute`;

    for (const entry of [
      `host:${HOST}`,
      "host:COMPUTE-01",
      `host:${HOST}.example.internal`,
      "host:compute-*",
    ]) {
      expect(refusal(command, { protectedTargets: [entry] })).toMatch(
        /wins over every other setting/,
      );
    }

    expect(
      refusal(
        "openstack compute service set --enable compute-01.example.internal nova-compute",
        { protectedTargets: [`host:${HOST}`] },
      ),
    ).toMatch(/wins over every other setting/);
    expect(
      refusal(command, { protectedTargets: ["host:compute-02"] }),
    ).toBeNull();
    // A pattern on a domain does not read as every host of every domain.
    expect(
      refusal(command, { protectedTargets: ["host:*.example.internal"] }),
    ).toBeNull();
  });

  test("a move never lands on a protected host, and one the scheduler places might", () => {
    expect(
      refusal(`openstack server migrate ${SERVER} --host compute-02`, {
        protectedTargets: ["host:compute-02"],
      }),
    ).toMatch(/destination:compute-02/);
    expect(
      refusal(`openstack server evacuate ${SERVER} --host compute-02`, {
        protectedTargets: ["host:compute-*"],
      }),
    ).toMatch(/destination:compute-02/);
    expect(
      refusal(`openstack server migrate ${SERVER}`, {
        protectedTargets: ["host:compute-02"],
      }),
    ).toMatch(/the-scheduler-chooses/);
    expect(
      refusal(`openstack server migrate live ${SERVER} --host compute-03`, {
        protectedTargets: ["host:compute-02"],
      }),
    ).toBeNull();
    // A protected project says nothing about where the scheduler lands it.
    expect(
      refusal(`openstack server migrate ${SERVER}`, {
        protectedTargets: [`project:${PROJECT}`],
      }),
    ).toBeNull();
  });

  test("protected wins over a write target naming the same thing", () => {
    expect(
      refusal(`openstack server start ${SERVER}`, {
        protectedTargets: [`instance:${SERVER}`],
        writeTargets: [`instance:${SERVER}`],
      }),
    ).toMatch(/wins over every other setting/);
    expect(
      refusal(`openstack compute service set --enable ${HOST} nova-compute`, {
        protectedTargets: [`host:${HOST}`],
        writeTargets: [`host:${HOST}`, "host:*"],
      }),
    ).toMatch(/wins over every other setting/);
  });

  test("write targets hold an instance by its ID, on what its words say", () => {
    const command: string = `openstack server start ${SERVER}`;

    expect(
      refusal(command, { writeTargets: [`instance:${SERVER}`] }),
    ).toBeNull();
    expect(
      refusal(command, { writeTargets: [`instance:${SERVER.toUpperCase()}`] }),
    ).toBeNull();
    expect(
      refusal(command, { writeTargets: ["instance:358ee736-*"] }),
    ).toBeNull();
    expect(refusal(command, { writeTargets: [`instance:${OTHER}`] })).toMatch(
      /outside the targets/,
    );
  });

  test("write targets by project or host leave an instance to the agent", () => {
    const command: string = `openstack server start ${SERVER}`;

    expect(
      refusal(command, { writeTargets: [`project:${PROJECT}`] }),
    ).toBeNull();
    expect(refusal(command, { writeTargets: ["host:compute-*"] })).toBeNull();
  });

  test("a compute service is only held by a host entry", () => {
    const command: string = `openstack compute service set --enable ${HOST} nova-compute`;

    expect(refusal(command, { writeTargets: ["host:compute-*"] })).toBeNull();
    expect(refusal(command, { writeTargets: ["host:COMPUTE-01"] })).toBeNull();
    expect(refusal(command, { writeTargets: ["host:compute-02"] })).toMatch(
      /outside the targets/,
    );
    expect(refusal(command, { writeTargets: [`project:${PROJECT}`] })).toMatch(
      /outside the targets/,
    );
    expect(refusal(command, { writeTargets: [`instance:${SERVER}`] })).toMatch(
      /outside the targets/,
    );
  });

  test("a network agent is left to the agent by a host entry, and refused by any other", () => {
    const command: string = `openstack network agent set --enable ${AGENT}`;

    expect(refusal(command, { writeTargets: ["host:net-*"] })).toBeNull();
    expect(refusal(command, { writeTargets: [`project:${PROJECT}`] })).toMatch(
      /outside the targets/,
    );
  });

  test("a move stays inside the host entries, or names where it lands", () => {
    expect(
      refusal(`openstack server migrate ${SERVER} --host compute-02`, {
        writeTargets: ["host:compute-*"],
      }),
    ).toBeNull();
    expect(
      refusal(`openstack server migrate ${SERVER} --host db-02`, {
        writeTargets: ["host:compute-*"],
      }),
    ).toMatch(/destination:db-02/);
    expect(
      refusal(`openstack server migrate ${SERVER}`, {
        writeTargets: ["host:compute-*"],
      }),
    ).toMatch(/the-scheduler-chooses/);
    // No host entries: nothing limits where it lands.
    expect(
      refusal(`openstack server migrate ${SERVER}`, {
        writeTargets: [`instance:${SERVER}`],
      }),
    ).toBeNull();
    expect(
      refusal(`openstack server evacuate ${SERVER} --host db-02`, {
        writeTargets: [`project:${PROJECT}`],
      }),
    ).toBeNull();
  });
});

describe("where a change lands, on what the agent read", () => {
  function live(
    overrides: Partial<OpenStackLiveTarget> = {},
  ): OpenStackLiveTarget {
    return {
      target: `instance:${SERVER}`,
      projectId: PROJECT,
      hosts: [HOST, `${HOST}.example.internal`],
      ...overrides,
    };
  }

  function refusal(
    targets: Array<OpenStackLiveTarget>,
    lists: { protectedTargets?: Array<string>; writeTargets?: Array<string> },
  ): string | null {
    return getOpenStackLiveScopeRefusal({
      displayCommand: "openstack server start x",
      targets,
      protectedTargets: lists.protectedTargets || [],
      writeTargets: lists.writeTargets || [],
    });
  }

  test("no lists, nothing to refuse", () => {
    expect(refusal([live()], {})).toBeNull();
    expect(refusal([live({ projectId: null, hosts: [] })], {})).toBeNull();
  });

  test.each([
    [`project:${PROJECT}`],
    [`project:${PROJECT.toUpperCase()}`],
    ["project:9aee*"],
    [`host:${HOST}`],
    [`host:${HOST}.example.internal`],
    ["host:COMPUTE-*"],
    [`instance:${SERVER}`],
    ["instance:358ee736-*"],
  ])("a protected %s stops it", (entry: string) => {
    expect(refusal([live()], { protectedTargets: [entry] })).toMatch(
      /wins over every other setting/,
    );
  });

  test.each([
    ["project:abc123"],
    ["host:other-01.example.com"],
    ["host:db-*"],
    [`instance:${OTHER}`],
  ])("a protected %s, which is something else, does not", (entry: string) => {
    expect(refusal([live()], { protectedTargets: [entry] })).toBeNull();
  });

  test("protected wins over a write target naming the same thing", () => {
    expect(
      refusal([live()], {
        protectedTargets: [`project:${PROJECT}`],
        writeTargets: [`project:${PROJECT}`, `host:${HOST}`, "instance:*"],
      }),
    ).toMatch(/wins over every other setting/);
  });

  test("one protected instance among an evacuation's stops all of it", () => {
    expect(
      refusal(
        [
          live(),
          live({ target: `instance:${OTHER}`, projectId: "abc123" }),
          live({ target: `instance:${THIRD}` }),
        ],
        { protectedTargets: ["project:abc123"] },
      ),
    ).toMatch(new RegExp(OTHER));
  });

  test("what it could not read is never in scope", () => {
    expect(
      refusal([live({ projectId: null })], {
        protectedTargets: [`project:${PROJECT}`],
      }),
    ).toMatch(/could not read which project/);
    expect(
      refusal([live({ hosts: [] })], { protectedTargets: [`host:${HOST}`] }),
    ).toMatch(/could not read which host/);
    expect(
      refusal([live({ projectId: null })], {
        writeTargets: [`project:${PROJECT}`],
      }),
    ).toMatch(/outside the targets/);
    expect(
      refusal([live({ hosts: [] })], { writeTargets: [`host:${HOST}`] }),
    ).toMatch(/outside the targets/);
  });

  test("write targets hold it by its project, its host or its ID", () => {
    for (const entry of [
      `project:${PROJECT}`,
      "project:9AEE*",
      `host:${HOST}`,
      "host:compute-*",
      `instance:${SERVER}`,
    ]) {
      expect(refusal([live()], { writeTargets: [entry] })).toBeNull();
    }

    for (const entry of ["project:abc", "host:db-*", `instance:${OTHER}`]) {
      expect(refusal([live()], { writeTargets: [entry] })).toMatch(
        /outside the targets/,
      );
    }
  });

  test("a project's entry says nothing about a host or an agent", () => {
    const target: OpenStackLiveTarget = {
      target: `host:${HOST}`,
      projectId: null,
      hosts: [HOST],
    };

    expect(
      refusal([target], { protectedTargets: [`project:${PROJECT}`] }),
    ).toBeNull();
    expect(
      refusal(
        [{ target: `agent:${AGENT}`, projectId: null, hosts: ["net-1"] }],
        { protectedTargets: ["host:net-1"] },
      ),
    ).toMatch(/wins over every other setting/);
  });
});

describe("what a target entry may say", () => {
  test.each([
    [`project:${PROJECT}`],
    ["project:9aee*"],
    ["project:*"],
    [`instance:${SERVER}`],
    ["instance:358ee736-*"],
    ["host:compute-01"],
    ["host:compute-01.example.internal"],
    ["host:compute-*"],
    ["host:*"],
    ["host:10.0.0.1"],
  ])("%s reads", (entry: string) => {
    expect(describeOpenStackTargetEntryProblem(entry)).toBeNull();
  });

  test.each([
    ["prod", /does not say what it is/],
    [SERVER, /does not say what it is/],
    ["compute-01", /does not say what it is/],
    ["region:RegionOne", /does not say what it is/],
    [":x", /does not say what it is/],
    ["project:prod", /is not an ID/],
    ["project:", /is not an ID/],
    ["instance:web-1", /is not an ID/],
    ["host:", /is not a host's name/],
    ["host:a b", /is not a host's name/],
    ["host:a/b", /is not a host's name/],
  ])("%s does not", (entry: string, problem: RegExp) => {
    expect(describeOpenStackTargetEntryProblem(entry)).toMatch(problem);
  });

  test("the policy offers the check to the agent's settings", () => {
    expect(OpenStackCommandPolicy.describeTargetEntryProblem).toBe(
      describeOpenStackTargetEntryProblem,
    );
  });
});

describe("the guides say what the policy says", () => {
  test("the write guide spells every change, and the reads guide offers the dry run", () => {
    const guide: string = OpenStackCommandPolicy.writeCommandGuide;

    for (const needle of [
      "`openstack server start SERVER-ID`",
      "`openstack server reboot --soft SERVER-ID`",
      "`openstack compute service set --enable HOST nova-compute`",
      "`openstack network agent set --enable AGENT-ID`",
      "`openstack server reboot --hard SERVER-ID`",
      "`openstack server migrate SERVER-ID [--host HOST]`",
      "`openstack server migrate live SERVER-ID [--host HOST]`",
      '`openstack compute service set --disable --disable-reason "REASON" HOST nova-compute`',
      "`openstack network agent set --disable AGENT-ID`",
      "`openstack server evacuate SERVER-ID... [--host HOST]`",
    ]) {
      expect(guide).toContain(needle);
    }

    expect(OpenStackCommandPolicy.readCommandGuide).toContain("dry-run");
  });

  test("the Safe line holds what is safe, and nothing else", () => {
    const safe: string = OpenStackCommandPolicy.writeCommandGuide
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith("- Safe");
      }) as string;

    for (const route of OPENSTACK_CHANGE_ROUTES) {
      expect({
        route: route.route,
        safe: safe.includes(`openstack ${route.route}`),
      }).toEqual({
        route: route.route,
        safe: route.tier === ResourceCommandTier.SafeWrite,
      });
    }
  });
});

describe("it never throws, whatever it is handed", () => {
  test("generated text in every position of every change never reads as more", () => {
    const alphabet: ReadonlyArray<string> = [
      "server",
      "start",
      "--hard",
      "--soft",
      "--host",
      "evacuate",
      SERVER,
      "../",
      "%2e",
      "\u0000",
      "\n",
      " ",
      "'",
      '"',
      "*",
      "$(",
      "é",
      "-",
      "--",
      "=",
      ";",
    ];
    const texts: Array<string> = generatedTexts(1500, 5747, alphabet, 6);

    for (const row of CHANGES) {
      const canonical: Array<string> = wordsOf(row.command);

      canonical.forEach((word: string, at: number): void => {
        for (const text of texts) {
          if (text === word) {
            continue;
          }

          const argv: Array<string> = canonical.slice();

          argv[at] = text;

          const result: ResourceCommandPolicyResult =
            ResourceCommandPolicy.evaluateArgv({
              resourceType: AiResourceType.OpenStackCloud,
              argv,
            });
          const parsed: OpenStackCommandParseResult =
            parseOpenStackCommand(argv);

          // The two readings are one reading.
          expect(result.tier === ResourceCommandTier.Denied).toBe(
            parsed.request === undefined,
          );

          /*
           * Only a value in a value's place can still read as a change, and then
           * only a value its own rule took.
           */
          if (result.tier !== ResourceCommandTier.Denied) {
            expect(text).not.toMatch(/[\n\0'"$;%é]/);

            if (canonical[at - 1] !== "--disable-reason") {
              expect(text).not.toMatch(/[/=]/);
            }
          }
        }
      });
    }
  });

  test("anything that is not an argv is refused", () => {
    for (const argv of [
      null,
      undefined,
      "openstack server start",
      42,
      {},
      [],
      [null],
      ["openstack", 7],
      [
        "openstack",
        "server",
        "start",
        {
          toString: () => {
            return SERVER;
          },
        },
      ],
    ]) {
      expect(
        OpenStackCommandPolicy.evaluateArgv(argv as unknown as Array<string>)
          .tier,
      ).toBe(ResourceCommandTier.Denied);
      expect(readOpenStackChange(argv)).toBeNull();
    }
  });
});
