import Model from "../../Models/DatabaseModels/CloudCostGroup";
import {
  CLOUD_COST_MAX_GROUPS_PER_VIEW,
  CloudCostSharedPercentages,
  CloudCostSharedSplit,
  isCloudCostSharedSplit,
  readCloudCostSharedPercentages,
} from "../../Types/Cloud/CloudCostAllocation";
import {
  CloudCostRule,
  CloudCostRuleCondition,
  CloudCostRuleField,
  readCloudCostRules,
} from "../../Types/Cloud/CloudCostRules";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import { JsonReferenceColumn } from "../Utils/Database/ProjectReferenceCheck";
import { ProjectScopedReference } from "../Utils/Database/ProjectScopedReferenceValidator";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import CloudAccountService from "./CloudAccountService";
import CloudAppService from "./CloudAppService";
import CloudResourceService from "./CloudResourceService";
import KubernetesClusterService from "./KubernetesClusterService";
import LabelService from "./LabelService";
import ProjectReferencesService from "./ProjectReferencesService";
import TeamService from "./TeamService";

/*
 * Cost groups (CloudCostGroup). This guards a group as it is written:
 *
 *   - its rules are read as the allocation reads them (readCloudCostRules),
 *     and refused with what to fix when they cannot be;
 *   - every record a rule names - an account, a team, a label, an App
 *     Platforms environment or app, a Kubernetes cluster - is the project's
 *     (getJsonReferenceColumns). A record since deleted may stay named: a
 *     rule that names a deleted team matches nothing, and refusing would
 *     keep a person from saving their way out of it;
 *   - a shared group's split is one OneUptime knows, and its fixed
 *     percentages name other groups of the same view and add up to 100;
 *   - a view holds at most CLOUD_COST_MAX_GROUPS_PER_VIEW groups;
 *   - the rules of a group OneUptime made for a view per tag value or owner
 *     team are OneUptime's (CloudCostViewSync): a person may rename it, link
 *     it to a team or share it, but not rewrite what it is made for.
 */

export const CLOUD_COST_GROUP_SPLIT_ERROR: string =
  "Choose how a shared group is split: Even, Proportional or Fixed.";
export const CLOUD_COST_GROUP_AUTOMATIC_RULES_ERROR: string =
  "OneUptime makes this group's rules for its view, one group per tag value or owner team. Rename it, link it to a team or share it instead, or add a group of your own.";
export const CLOUD_COST_GROUP_PERCENTAGES_VIEW_ERROR: string =
  "A shared group's percentages must name other groups of the same view.";
export const CLOUD_COST_GROUP_LIMIT_ERROR: string = `A cost view holds at most ${CLOUD_COST_MAX_GROUPS_PER_VIEW} groups. Remove some, or sort the rest in another view.`;

// The service each ID field of a rule names a record of.
const FIELD_REFERENCES: ReadonlyArray<{
  field: CloudCostRuleField;
  modelName: string;
  service: ProjectScopedReference["service"];
}> = [
  {
    field: CloudCostRuleField.Account,
    modelName: "Cloud Account",
    service:
      CloudAccountService as unknown as ProjectScopedReference["service"],
  },
  {
    field: CloudCostRuleField.OwnerTeam,
    modelName: "Team",
    service: TeamService as unknown as ProjectScopedReference["service"],
  },
  {
    field: CloudCostRuleField.Label,
    modelName: "Label",
    service: LabelService as unknown as ProjectScopedReference["service"],
  },
  {
    field: CloudCostRuleField.Environment,
    modelName: "App Platforms Environment",
    service:
      CloudResourceService as unknown as ProjectScopedReference["service"],
  },
  {
    field: CloudCostRuleField.App,
    modelName: "App",
    service: CloudAppService as unknown as ProjectScopedReference["service"],
  },
  {
    field: CloudCostRuleField.KubernetesCluster,
    modelName: "Kubernetes Cluster",
    service:
      KubernetesClusterService as unknown as ProjectScopedReference["service"],
  },
];

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  // Every record a group's rules name, each held to the project.
  public static getRuleReferences(
    value: unknown,
  ): Array<ProjectScopedReference> {
    let rules: Array<CloudCostRule>;

    try {
      rules = readCloudCostRules(value);
    } catch {
      // The rules' own check refuses them, in its own words.
      return [];
    }

    const references: Array<ProjectScopedReference> = [];

    for (const rule of rules) {
      for (const condition of rule.conditions as Array<CloudCostRuleCondition>) {
        const reference: (typeof FIELD_REFERENCES)[number] | undefined =
          FIELD_REFERENCES.find(
            (entry: (typeof FIELD_REFERENCES)[number]): boolean => {
              return entry.field === condition.field;
            },
          );

        if (!reference) {
          continue;
        }

        for (const id of condition.values) {
          references.push({
            modelName: reference.modelName,
            id,
            service: reference.service,
            mustExist: false,
          });
        }
      }
    }

    return references;
  }

  // Whether two sets of rules read differently, as the allocation reads them.
  public static rulesDiffer(stored: unknown, sent: unknown): boolean {
    const read: (value: unknown) => string = (value: unknown): string => {
      try {
        return JSON.stringify(readCloudCostRules(value));
      } catch {
        return JSON.stringify(value ?? null);
      }
    };

    return read(stored) !== read(sent);
  }

  protected override getJsonReferenceColumns(): Array<JsonReferenceColumn> {
    return [
      {
        column: "rules",
        getReferences: Service.getRuleReferences,
      },
    ];
  }

  public normalizeSplit(value: unknown): CloudCostSharedSplit {
    if (value === null || value === undefined || value === "") {
      return CloudCostSharedSplit.Proportional;
    }

    if (!isCloudCostSharedSplit(value)) {
      throw new BadDataException(CLOUD_COST_GROUP_SPLIT_ERROR);
    }

    return value;
  }

  /*
   * Fixed percentages naming only other groups of the view: a group that
   * names itself, or a group of another view, would split a cost onto
   * something the view never shows.
   */
  private async checkPercentagesInView(data: {
    percentages: CloudCostSharedPercentages;
    viewId: ObjectID;
    groupId?: ObjectID | undefined;
  }): Promise<void> {
    const ids: Array<string> = Object.keys(data.percentages);

    if (ids.length === 0) {
      return;
    }

    if (data.groupId && ids.includes(data.groupId.toString().toLowerCase())) {
      throw new BadDataException(CLOUD_COST_GROUP_PERCENTAGES_VIEW_ERROR);
    }

    const groups: Array<Model> = await this.findBy({
      query: { cloudCostViewId: data.viewId },
      select: { _id: true },
      props: { isRoot: true },
      limit: CLOUD_COST_MAX_GROUPS_PER_VIEW + 1,
      skip: 0,
    });
    const inView: Set<string> = new Set(
      groups.map((group: Model): string => {
        return group.id!.toString().toLowerCase();
      }),
    );

    if (
      ids.some((id: string): boolean => {
        return !inView.has(id);
      })
    ) {
      throw new BadDataException(CLOUD_COST_GROUP_PERCENTAGES_VIEW_ERROR);
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    createBy.data.rules = readCloudCostRules(createBy.data.rules);
    createBy.data.sharedSplit = this.normalizeSplit(createBy.data.sharedSplit);
    createBy.data.sharedPercentages = readCloudCostSharedPercentages(
      createBy.data.sharedPercentages,
    );

    /*
     * A group a person creates is theirs: only OneUptime's own writes make
     * a group for a tag value or a team (CloudCostViewSync).
     */
    if (!createBy.props.isRoot) {
      (createBy.data as { automaticKey?: string | undefined }).automaticKey =
        undefined;
    }

    const viewId: ObjectID | undefined = createBy.data.cloudCostViewId;

    if (viewId) {
      const count: number = (
        await this.countBy({
          query: { cloudCostViewId: viewId },
          props: { isRoot: true },
        })
      ).toNumber();

      if (count >= CLOUD_COST_MAX_GROUPS_PER_VIEW) {
        throw new BadDataException(CLOUD_COST_GROUP_LIMIT_ERROR);
      }

      await this.checkPercentagesInView({
        percentages: createBy.data.sharedPercentages,
        viewId,
      });
    }

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    if (updateBy.data.rules !== undefined) {
      (updateBy.data as { rules?: Array<CloudCostRule> }).rules =
        readCloudCostRules(updateBy.data.rules);
    }

    if (updateBy.data.sharedSplit !== undefined) {
      updateBy.data.sharedSplit = this.normalizeSplit(
        updateBy.data.sharedSplit,
      );
    }

    if (updateBy.data.sharedPercentages !== undefined) {
      updateBy.data.sharedPercentages = readCloudCostSharedPercentages(
        updateBy.data.sharedPercentages,
      );
    }

    const changesRules: boolean = updateBy.data.rules !== undefined;
    const changesPercentages: boolean =
      updateBy.data.sharedPercentages !== undefined &&
      Object.keys(updateBy.data.sharedPercentages || {}).length > 0;

    if (changesRules || changesPercentages) {
      const groups: Array<Model> = await this.findBy({
        query: updateBy.query,
        select: {
          _id: true,
          automaticKey: true,
          cloudCostViewId: true,
          rules: true,
        },
        props: { isRoot: true },
        limit: CLOUD_COST_MAX_GROUPS_PER_VIEW,
        skip: 0,
      });

      for (const group of groups) {
        /*
         * A form sends every field it shows, so a renamed group sends its
         * rules too: only rules that differ from its own are refused.
         */
        if (
          changesRules &&
          group.automaticKey &&
          !updateBy.props.isRoot &&
          Service.rulesDiffer(group.rules, updateBy.data.rules)
        ) {
          throw new BadDataException(CLOUD_COST_GROUP_AUTOMATIC_RULES_ERROR);
        }

        if (changesPercentages && group.cloudCostViewId) {
          await this.checkPercentagesInView({
            percentages:
              (updateBy.data.sharedPercentages as
                | CloudCostSharedPercentages
                | undefined) || {},
            viewId: group.cloudCostViewId,
            groupId: group.id || undefined,
          });
        }
      }
    }

    return { updateBy, carryForward: null };
  }
}

export default new Service();
