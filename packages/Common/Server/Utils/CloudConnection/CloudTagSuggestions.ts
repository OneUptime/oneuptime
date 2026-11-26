import CloudApp from "../../../Models/DatabaseModels/CloudApp";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import CloudResourceOwnerTeam from "../../../Models/DatabaseModels/CloudResourceOwnerTeam";
import Host from "../../../Models/DatabaseModels/Host";
import {
  CloudVmFacts,
  isCloudHostVmType,
} from "../../../Types/Cloud/CloudHostLink";
import {
  CloudRequiredTagRule,
  CloudTagFinding,
  CloudTagNeighbourGroup,
  CloudTagNeighbourRelation,
  CloudTagSuggestion,
  evaluateCloudTags,
  getCloudResourceNamePrefix,
  getCloudTagCommand,
  suggestCloudTagValue,
} from "../../../Types/Cloud/CloudRequiredTags";
import { CloudTagMissingJSON } from "../../../Types/Cloud/CloudTagCoverage";
import { readDeclaredCode } from "../../../Utils/AiRemediation/DeclaredCodeChange";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import CloudAppService from "../../Services/CloudAppService";
import CloudResourceOwnerTeamService from "../../Services/CloudResourceOwnerTeamService";
import CloudResourceService from "../../Services/CloudResourceService";
import HostService from "../../Services/HostService";
import QueryHelper from "../../Types/Database/QueryHelper";
import CloudAiTargets from "../AI/ResourceAccess/CloudAiTargets";
import CloudHostLinks, {
  CloudLinkedHost,
  toCloudVmFacts,
} from "./CloudHostLinks";

/*
 * WHAT A RESOURCE WITHOUT A REQUIRED TAG LACKS, AND WHAT TO PUT THERE
 * (#11012): the findings of its tags against its account's required tags
 * (evaluateCloudTags), each with the value OneUptime suggests from what it
 * knows of the resource (suggestCloudTagValue) and the command that
 * applies it in its cloud (getCloudTagCommand). Shared by Cloud > Tags and
 * the watcher, so a page and an email suggest the same value.
 *
 * What a suggestion is read from, for a batch of resources at once:
 *
 *   - its owner teams (owner rules and teams), by name;
 *   - its environment: the App Platforms environment an app runs as it is
 *     part of, else, for a VM, the deployment environment the host it is
 *     reports (deployment.environment, #11013);
 *   - the resources beside it in the same account: the same CloudFormation
 *     stack, the same Azure resource group, the same name before its
 *     number - a few hundred of each at most.
 *
 * Every read is as OneUptime, for resources the caller already read.
 */

// The resources beside one read per group at most.
const NEIGHBOURS_PER_GROUP: number = 200;

// The tag a CloudFormation stack writes on everything it makes.
export const CLOUDFORMATION_STACK_TAG: string = "aws:cloudformation:stack-name";

// A resource as the suggestions read it.
export interface CloudTagSubject {
  id: ObjectID;
  name: string;
  provider: string;
  type: string;
  accountId: string;
  region: string;
  resourceGroup: string;
  providerResourceId: string;
  tags: Record<string, string>;
  vm: CloudVmFacts;
}

export function toCloudTagSubject(resource: CloudResource): CloudTagSubject {
  return {
    id: resource.id!,
    name: (resource.name || "").trim(),
    provider: (resource.cloudProvider as string) || "",
    type: resource.cloudResourceType || "",
    accountId: (resource.cloudAccountId || "").trim(),
    region: (resource.cloudRegion || "").trim(),
    resourceGroup: (resource.cloudResourceGroup || "").trim(),
    providerResourceId: (resource.providerResourceId || "").trim(),
    tags: readTags(resource.cloudTags),
    vm: toCloudVmFacts(resource),
  };
}

export const CLOUD_TAG_SUBJECT_SELECT: {
  _id: true;
  name: true;
  cloudProvider: true;
  cloudResourceType: true;
  cloudAccountId: true;
  cloudRegion: true;
  cloudResourceGroup: true;
  providerResourceId: true;
  cloudTags: true;
  telemetryAttributes: true;
  cloudProperties: true;
  isArchived: true;
} = {
  _id: true,
  name: true,
  cloudProvider: true,
  cloudResourceType: true,
  cloudAccountId: true,
  cloudRegion: true,
  cloudResourceGroup: true,
  providerResourceId: true,
  cloudTags: true,
  telemetryAttributes: true,
  cloudProperties: true,
  isArchived: true,
};

function readTags(value: unknown): Record<string, string> {
  const tags: Record<string, string> = {};

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return tags;
  }

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key && typeof entry === "string") {
      tags[key] = entry;
    }
  }

  return tags;
}

/*
 * The code that declares a resource, from its tags ('CloudFormation stack
 * "web"', "Terraform", "Pulumi"), or null when none does: a tag belongs
 * there, or the next deploy takes it off again.
 */
export function getCloudTagDeclaredCode(
  tags: Record<string, string>,
): string | null {
  const managedAsCode: string | null = CloudAiTargets.getManagedAsCode(tags);

  return readDeclaredCode(managedAsCode) ? managedAsCode : null;
}

// What one resource lacks, with what to put there: nothing when it carries every tag.
export interface CloudTagSubjectFindings {
  subject: CloudTagSubject;
  findings: Array<CloudTagFinding>;
  missing: Array<CloudTagMissingJSON>;
  // The code that declares it, when its tags say.
  declaredCode: string | null;
}

export default class CloudTagSuggestions {
  // Each resource's owner teams' names, by the resource's row id.
  private static async readOwnerTeams(data: {
    projectId: ObjectID;
    resourceIds: Array<ObjectID>;
  }): Promise<Map<string, Array<string>>> {
    const teams: Map<string, Array<string>> = new Map();

    if (data.resourceIds.length === 0) {
      return teams;
    }

    const rows: Array<CloudResourceOwnerTeam> =
      await CloudResourceOwnerTeamService.findBy({
        query: {
          projectId: data.projectId,
          cloudResourceId: QueryHelper.any(data.resourceIds),
        },
        select: { cloudResourceId: true, team: { name: true } },
        skip: 0,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      });

    for (const row of rows) {
      const id: string = row.cloudResourceId?.toString() || "";
      const name: string = (row.team?.name || "").trim();

      if (!id || !name) {
        continue;
      }

      const names: Array<string> = teams.get(id) || [];

      if (!names.includes(name)) {
        names.push(name);
      }

      teams.set(id, names);
    }

    return teams;
  }

  /*
   * Each resource's environment, by its row id: the App Platforms
   * environment of an app that runs as it, else - a VM - the deployment
   * environment its host reports.
   */
  private static async readEnvironments(data: {
    projectId: ObjectID;
    subjects: Array<CloudTagSubject>;
  }): Promise<Map<string, string>> {
    const environments: Map<string, string> = new Map();

    if (data.subjects.length === 0) {
      return environments;
    }

    const apps: Array<CloudApp> = await CloudAppService.findBy({
      query: {
        projectId: data.projectId,
        platformCloudResourceId: QueryHelper.any(
          data.subjects.map((subject: CloudTagSubject): ObjectID => {
            return subject.id;
          }),
        ),
      },
      select: { platformCloudResourceId: true, cloudResource: { name: true } },
      skip: 0,
      limit: LIMIT_MAX,
      props: { isRoot: true },
    });

    for (const app of apps) {
      const id: string = app.platformCloudResourceId?.toString() || "";
      const name: string = (app.cloudResource?.name || "").trim();

      if (id && name && !environments.has(id)) {
        environments.set(id, name);
      }
    }

    const vms: Array<CloudTagSubject> = data.subjects.filter(
      (subject: CloudTagSubject): boolean => {
        return (
          !environments.has(subject.id.toString()) &&
          isCloudHostVmType(subject.provider, subject.type)
        );
      },
    );

    if (vms.length > 0) {
      const hosts: Map<string, CloudLinkedHost> =
        await CloudHostLinks.hostsOfVms({
          projectId: data.projectId,
          vms: vms.map((subject: CloudTagSubject): CloudVmFacts => {
            return subject.vm;
          }),
        });
      const hostIds: Array<ObjectID> = Array.from(hosts.values()).map(
        (host: CloudLinkedHost): ObjectID => {
          return host.id;
        },
      );
      const hostRows: Array<Host> =
        hostIds.length > 0
          ? await HostService.findBy({
              query: {
                projectId: data.projectId,
                _id: QueryHelper.any(hostIds),
              },
              select: { _id: true, deploymentEnvironment: true },
              skip: 0,
              limit: LIMIT_MAX,
              props: { isRoot: true },
            })
          : [];
      const byHost: Map<string, string> = new Map();

      for (const host of hostRows) {
        const environment: string = (host.deploymentEnvironment || "").trim();

        if (host.id && environment) {
          byHost.set(host.id.toString(), environment);
        }
      }

      for (const [vmId, host] of hosts) {
        const environment: string | undefined = byHost.get(host.id.toString());

        if (environment) {
          environments.set(vmId, environment);
        }
      }
    }

    return environments;
  }

  /*
   * The groups a resource's neighbours are read in: its stack, its
   * resource group and its name's prefix, in its account.
   */
  private static async readNeighbours(data: {
    projectId: ObjectID;
    subject: CloudTagSubject;
  }): Promise<Array<CloudTagNeighbourGroup>> {
    const groups: Array<CloudTagNeighbourGroup> = [];
    const base: Record<string, unknown> = {
      projectId: data.projectId,
      cloudProvider: data.subject.provider,
      cloudAccountId: QueryHelper.findWithSameText(data.subject.accountId),
      isArchived: false,
    };
    const readGroup: (
      relation: CloudTagNeighbourRelation,
      name: string,
      query: Record<string, unknown>,
      isNeighbour?: (row: CloudResource) => boolean,
    ) => Promise<void> = async (
      relation: CloudTagNeighbourRelation,
      name: string,
      query: Record<string, unknown>,
      isNeighbour?: (row: CloudResource) => boolean,
    ): Promise<void> => {
      const rows: Array<CloudResource> = await CloudResourceService.findBy({
        query: { ...base, ...query } as never,
        select: { _id: true, name: true, cloudTags: true },
        skip: 0,
        limit: NEIGHBOURS_PER_GROUP,
        props: { isRoot: true },
      });
      const tags: Array<Record<string, unknown>> = rows
        .filter((row: CloudResource): boolean => {
          return (
            row.id?.toString() !== data.subject.id.toString() &&
            (!isNeighbour || isNeighbour(row))
          );
        })
        .map((row: CloudResource): Record<string, unknown> => {
          return readTags(row.cloudTags);
        });

      if (tags.length > 0) {
        groups.push({ relation, name, tags });
      }
    };

    if (!data.subject.accountId) {
      return groups;
    }

    const stack: string = (
      data.subject.tags[CLOUDFORMATION_STACK_TAG] || ""
    ).trim();

    if (stack) {
      const ids: Array<{ id: string }> =
        await CloudResourceService.getRepository().manager.query(
          `SELECT "_id" AS "id" FROM "CloudResource"
           WHERE "projectId" = $1 AND "deletedAt" IS NULL
             AND "cloudTags"->>'${CLOUDFORMATION_STACK_TAG}' = $2
           LIMIT ${NEIGHBOURS_PER_GROUP}`,
          [data.projectId.toString(), stack],
        );

      if (ids.length > 1) {
        await readGroup(CloudTagNeighbourRelation.Stack, stack, {
          _id: QueryHelper.any(
            ids.map((row: { id: string }): string => {
              return row.id;
            }),
          ),
        });
      }
    }

    if (data.subject.resourceGroup) {
      await readGroup(
        CloudTagNeighbourRelation.ResourceGroup,
        data.subject.resourceGroup,
        {
          cloudResourceGroup: QueryHelper.findWithSameText(
            data.subject.resourceGroup,
          ),
        },
      );
    }

    const prefix: string | null = getCloudResourceNamePrefix(data.subject.name);

    if (prefix) {
      // "web" starts "webserver" too: only a name with the same prefix is one.
      await readGroup(
        CloudTagNeighbourRelation.NamePrefix,
        prefix,
        { name: QueryHelper.startsWithAnyOf([prefix]) },
        (row: CloudResource): boolean => {
          return getCloudResourceNamePrefix(row.name || "") === prefix;
        },
      );
    }

    return groups;
  }

  /*
   * What each resource lacks of its required tags, with the value to put
   * there and how: only the resources that lack one are returned.
   */
  public static async findMissing(data: {
    projectId: ObjectID;
    subjects: Array<CloudTagSubject>;
    // The required tags of a resource's account.
    rulesOf: (subject: CloudTagSubject) => Array<CloudRequiredTagRule>;
  }): Promise<Array<CloudTagSubjectFindings>> {
    const lacking: Array<{
      subject: CloudTagSubject;
      rules: Array<CloudRequiredTagRule>;
      findings: Array<CloudTagFinding>;
    }> = [];

    for (const subject of data.subjects) {
      const rules: Array<CloudRequiredTagRule> = data.rulesOf(subject);
      const findings: Array<CloudTagFinding> = evaluateCloudTags(
        subject.tags,
        rules,
      );

      if (findings.length > 0) {
        lacking.push({ subject, rules, findings });
      }
    }

    if (lacking.length === 0) {
      return [];
    }

    const subjects: Array<CloudTagSubject> = lacking.map(
      (entry: { subject: CloudTagSubject }): CloudTagSubject => {
        return entry.subject;
      },
    );
    const [ownerTeams, environments]: [
      Map<string, Array<string>>,
      Map<string, string>,
    ] = await Promise.all([
      CloudTagSuggestions.readOwnerTeams({
        projectId: data.projectId,
        resourceIds: subjects.map((subject: CloudTagSubject): ObjectID => {
          return subject.id;
        }),
      }),
      CloudTagSuggestions.readEnvironments({
        projectId: data.projectId,
        subjects,
      }),
    ]);

    const results: Array<CloudTagSubjectFindings> = [];

    for (const entry of lacking) {
      const id: string = entry.subject.id.toString();
      // Neighbours are read only when a finding needs them.
      let neighbours: Array<CloudTagNeighbourGroup> | null = null;
      const missing: Array<CloudTagMissingJSON> = [];

      for (const finding of entry.findings) {
        const rule: CloudRequiredTagRule | undefined = entry.rules.find(
          (candidate: CloudRequiredTagRule): boolean => {
            return candidate.key === finding.key;
          },
        );
        let suggestion: CloudTagSuggestion | null = null;

        if (rule) {
          const fromWhatOneUptimeKnows: CloudTagSuggestion | null =
            suggestCloudTagValue({
              rule,
              provider: entry.subject.provider,
              ownerTeamNames: ownerTeams.get(id) || [],
              environmentName: environments.get(id) || null,
              neighbours: [],
            });

          if (fromWhatOneUptimeKnows) {
            suggestion = fromWhatOneUptimeKnows;
          } else {
            if (neighbours === null) {
              neighbours = await CloudTagSuggestions.readNeighbours({
                projectId: data.projectId,
                subject: entry.subject,
              });
            }

            suggestion = suggestCloudTagValue({
              rule,
              provider: entry.subject.provider,
              ownerTeamNames: [],
              environmentName: null,
              neighbours,
            });
          }
        }

        const item: CloudTagMissingJSON = {
          key: finding.key,
          problem: finding.problem,
        };

        if (finding.value) {
          item.value = finding.value;
        }

        if (suggestion) {
          item.suggestion = suggestion;

          const command: string | null = getCloudTagCommand({
            provider: entry.subject.provider,
            type: entry.subject.type,
            providerResourceId: entry.subject.providerResourceId,
            accountId: entry.subject.accountId,
            region: entry.subject.region,
            // The key as the resource spells it, when it carries one.
            key: finding.foundKey || finding.key,
            value: suggestion.value,
          });

          if (command) {
            item.command = command;
          }
        }

        missing.push(item);
      }

      results.push({
        subject: entry.subject,
        findings: entry.findings,
        missing,
        declaredCode: getCloudTagDeclaredCode(entry.subject.tags),
      });
    }

    return results;
  }
}
