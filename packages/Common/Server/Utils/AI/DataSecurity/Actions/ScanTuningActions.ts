import DataSecurityAiProposal from "../../../../../Models/DatabaseModels/DataSecurityAiProposal";
import DataSecuritySetting from "../../../../../Models/DatabaseModels/DataSecuritySetting";
import DataStore from "../../../../../Models/DatabaseModels/DataStore";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { DataSecurityAiProposalKind } from "../../../../../Types/DataSecurity/DataSecurityAi";
import {
  AddScanExclusionPlan,
  isExcludedAlready,
  readAddScanExclusionPlan,
  readTurnOffDataTypePlan,
  TurnOffDataTypePlan,
} from "../../../../../Types/DataSecurity/DataSecurityScanTuning";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import FeedMarkdown, { mdText } from "../../../../../Utils/Markdown/FeedMarkdown";
import DataSecuritySettingService from "../../../../Services/DataSecuritySettingService";
import DataStoreService from "../../../../Services/DataStoreService";
import CallerPermission from "../../../Permission/CallerPermission";
import {
  DataSecurityAiAction,
  DataSecurityAiActor,
  DataSecurityAiChangeMade,
  DataSecurityAiChangeUndone,
  DataSecurityAiPlanOutcome,
  DataSecurityAiPlannedChange,
} from "../DataSecurityAiAction";

/*
 * TUNING THE SCANS FROM THE TEAM'S DECISIONS (#10372).
 *
 * What people marked not sensitive, again and again, says what the scans
 * should stop looking for (Types/DataSecurity/DataSecurityScanTuning):
 *
 *   - TurnOffDataType: a built-in data type every finding of which was
 *     marked not sensitive, turned off under Data Security > Settings >
 *     Data Types, as its switch there does;
 *   - AddScanExclusion: a location of a store where every finding was,
 *     added to the store's scan exclusions, as its Settings would.
 *
 * Proposed by DataSecurityScanTuning, never planned for an issue. A scan
 * that stops looking misses the real data that comes later, so each always
 * asks (ChangesWhatScansLookFor), and is made as the person who approved
 * it, with their own permission for that setting. Undo takes back only what
 * it changed, and only while it stands: a type someone turned on again, or
 * an exclusion someone removed, is left as it is. Never Sensitive is never
 * proposed: it holds values, and OneUptime AI never sees one.
 */

export const TURN_OFF_DATA_TYPE_PERMISSION_MESSAGE: string =
  "This turns a data type off in your Data Security settings, and you do not have permission to change them. Ask a Project Owner or Project Admin, or for Edit Data Security Setting.";

export const ADD_SCAN_EXCLUSION_PERMISSION_MESSAGE: string =
  "This changes what a data store's scans leave out, and you do not have permission to change data stores. Ask a Project Owner or Project Admin, or for Edit Data Store.";

function nothingForAnIssue(): Promise<DataSecurityAiPlanOutcome> {
  return Promise.resolve({ kind: "nothing", detail: "not-for-an-issue" });
}

// The change that turns a built-in type off.
export function planTurnOffDataType(
  plan: TurnOffDataTypePlan,
): DataSecurityAiPlannedChange {
  const name: string = plan.dataTypeName || plan.dataTypeId;

  return {
    title: `Turn off ${name} in your scans`,
    changeMarkdown:
      mdText`**${name}** is turned off under Data Security > Settings > Data Types. No scan of the project looks for it from the next scan on.`.toString(),
    reasonMarkdown:
      mdText`Your team marked every finding of **${name}** not sensitive: ${String(plan.findings)} findings, on ${String(plan.stores)} stores. No scan found one your team kept.`.toString(),
    proofMarkdown:
      mdText`Its findings keep your team's decisions, and the scans stop making new ones. Turn it on again on the same page whenever you need it.`.toString(),
    undoMarkdown:
      mdText`Undo turns **${name}** on again, unless someone turned it on already.`.toString(),
    plan: plan as unknown as JSONObject,
    planKey: `turn-off:${plan.dataTypeId}`.slice(0, 100),
    meetsDefaultConditions: false,
    canRunWithoutAsking: false,
  };
}

// The change that leaves one location of a store out of its scans.
export function planAddScanExclusion(
  plan: AddScanExclusionPlan,
): DataSecurityAiPlannedChange {
  const store: string = plan.storeName || "the store";

  return {
    title: `Leave ${plan.exclusion} out of the scans of ${store}`,
    changeMarkdown:
      mdText`\`${plan.exclusion}\` is added to the scan exclusions of **${store}**: its scans no longer read that place.`.toString(),
    reasonMarkdown:
      mdText`Your team marked every finding at \`${plan.location}\` not sensitive: ${String(plan.findings)} findings, each of a different data type.`.toString(),
    proofMarkdown:
      mdText`The findings there keep your team's decisions, and the scans stop making new ones. Remove the exclusion in the store's Settings whenever you need it read again.`.toString(),
    undoMarkdown:
      mdText`Undo removes \`${plan.exclusion}\` from the store's scan exclusions, unless someone removed it already.`.toString(),
    plan: plan as unknown as JSONObject,
    planKey: `exclude:${plan.dataStoreId}:${plan.exclusion}`
      .toLowerCase()
      .slice(0, 100),
    meetsDefaultConditions: false,
    canRunWithoutAsking: false,
  };
}

function readSettingIds(value: unknown): Array<string> {
  return Array.isArray(value)
    ? value.filter((id: unknown): id is string => {
        return typeof id === "string";
      })
    : [];
}

export const TurnOffDataTypeAction: DataSecurityAiAction = {
  kind: DataSecurityAiProposalKind.TurnOffDataType,

  appliesToCheck(): boolean {
    return false;
  },

  plan: nothingForAnIssue,

  getApproveRefusal(data: {
    props: DatabaseCommonInteractionProps;
  }): string | null {
    return CallerPermission.holdsAnyOf(
      data.props,
      new DataSecuritySetting().updateRecordPermissions,
    )
      ? null
      : TURN_OFF_DATA_TYPE_PERMISSION_MESSAGE;
  },

  getUndoRefusal(data: {
    props: DatabaseCommonInteractionProps;
  }): string | null {
    return CallerPermission.holdsAnyOf(
      data.props,
      new DataSecuritySetting().updateRecordPermissions,
    )
      ? null
      : TURN_OFF_DATA_TYPE_PERMISSION_MESSAGE;
  },

  async apply(data: {
    projectId: ObjectID;
    proposal: DataSecurityAiProposal;
    actor: DataSecurityAiActor;
  }): Promise<DataSecurityAiChangeMade> {
    const plan: TurnOffDataTypePlan | null = readTurnOffDataTypePlan(
      data.proposal.plan,
    );

    if (!plan) {
      throw new BadDataException(
        "This proposal no longer says which data type it turns off, so nothing was done.",
      );
    }

    const setting: DataSecuritySetting =
      await DataSecuritySettingService.getOrCreateForProject(data.projectId);
    const disabled: Array<string> = readSettingIds(setting.disabledDataTypeIds);
    const name: string = plan.dataTypeName || plan.dataTypeId;

    if (disabled.includes(plan.dataTypeId)) {
      return {
        result: { dataTypeId: plan.dataTypeId, turnedOff: false },
        summaryMarkdown:
          mdText`**${name}** was turned off already, so nothing changed.`.toString(),
      };
    }

    await DataSecuritySettingService.updateOneById({
      id: setting.id!,
      data: { disabledDataTypeIds: [...disabled, plan.dataTypeId] },
      props: data.actor.props,
    });

    return {
      result: { dataTypeId: plan.dataTypeId, turnedOff: true },
      summaryMarkdown:
        mdText`**${name}** is turned off: no scan of the project looks for it from the next scan on.`.toString(),
    };
  },

  async undo(data: {
    projectId: ObjectID;
    proposal: DataSecurityAiProposal;
    actor: DataSecurityAiActor;
  }): Promise<DataSecurityAiChangeUndone> {
    const dataTypeId: string =
      typeof data.proposal.result?.["dataTypeId"] === "string"
        ? (data.proposal.result["dataTypeId"] as string)
        : "";
    const setting: DataSecuritySetting =
      await DataSecuritySettingService.getOrCreateForProject(data.projectId);
    const disabled: Array<string> = readSettingIds(setting.disabledDataTypeIds);

    if (
      data.proposal.result?.["turnedOff"] !== true ||
      !dataTypeId ||
      !disabled.includes(dataTypeId)
    ) {
      return {
        summaryMarkdown:
          mdText`The data type was on already, so nothing changed.`.toString(),
      };
    }

    await DataSecuritySettingService.updateOneById({
      id: setting.id!,
      data: {
        disabledDataTypeIds: disabled.filter((id: string): boolean => {
          return id !== dataTypeId;
        }),
      },
      props: data.actor.props,
    });

    return {
      summaryMarkdown:
        mdText`The data type is on again: the next scans look for it.`.toString(),
    };
  },
};

export const AddScanExclusionAction: DataSecurityAiAction = {
  kind: DataSecurityAiProposalKind.AddScanExclusion,

  appliesToCheck(): boolean {
    return false;
  },

  plan: nothingForAnIssue,

  getApproveRefusal(data: {
    props: DatabaseCommonInteractionProps;
  }): string | null {
    return CallerPermission.holdsAnyOf(
      data.props,
      new DataStore().updateRecordPermissions,
    )
      ? null
      : ADD_SCAN_EXCLUSION_PERMISSION_MESSAGE;
  },

  getUndoRefusal(data: {
    props: DatabaseCommonInteractionProps;
  }): string | null {
    return CallerPermission.holdsAnyOf(
      data.props,
      new DataStore().updateRecordPermissions,
    )
      ? null
      : ADD_SCAN_EXCLUSION_PERMISSION_MESSAGE;
  },

  async apply(data: {
    projectId: ObjectID;
    proposal: DataSecurityAiProposal;
    actor: DataSecurityAiActor;
  }): Promise<DataSecurityAiChangeMade> {
    const plan: AddScanExclusionPlan | null = readAddScanExclusionPlan(
      data.proposal.plan,
    );

    if (!plan || !ObjectID.isValidUUID(plan.dataStoreId)) {
      throw new BadDataException(
        "This proposal no longer says which place of which store it leaves out, so nothing was done.",
      );
    }

    const store: DataStore | null = await DataStoreService.findOneBy({
      query: { _id: new ObjectID(plan.dataStoreId), projectId: data.projectId },
      select: { _id: true, scanExclusions: true },
      props: { isRoot: true },
    });

    if (!store?.id) {
      throw new BadDataException(
        "The store this proposal is for is gone, so nothing was done.",
      );
    }

    if (isExcludedAlready(store.scanExclusions, plan.exclusion)) {
      return {
        result: { exclusion: plan.exclusion, added: false },
        summaryMarkdown:
          mdText`\`${plan.exclusion}\` was left out of the store's scans already, so nothing changed.`.toString(),
      };
    }

    await DataStoreService.updateOneById({
      id: store.id,
      data: {
        scanExclusions: [
          ...readSettingIds(store.scanExclusions),
          plan.exclusion,
        ],
      },
      props: data.actor.props,
    });

    return {
      result: { exclusion: plan.exclusion, added: true },
      summaryMarkdown: FeedMarkdown.join(
        [
          mdText`\`${plan.exclusion}\` is left out of the store's scans from the next one on.`,
          mdText`Remove it in the store's Settings to have it read again.`,
        ],
        " ",
      ).toString(),
    };
  },

  async undo(data: {
    projectId: ObjectID;
    proposal: DataSecurityAiProposal;
    actor: DataSecurityAiActor;
  }): Promise<DataSecurityAiChangeUndone> {
    const plan: AddScanExclusionPlan | null = readAddScanExclusionPlan(
      data.proposal.plan,
    );
    const store: DataStore | null =
      plan && ObjectID.isValidUUID(plan.dataStoreId)
        ? await DataStoreService.findOneBy({
            query: {
              _id: new ObjectID(plan.dataStoreId),
              projectId: data.projectId,
            },
            select: { _id: true, scanExclusions: true },
            props: { isRoot: true },
          })
        : null;

    if (
      !plan ||
      !store?.id ||
      data.proposal.result?.["added"] !== true ||
      !isExcludedAlready(store.scanExclusions, plan.exclusion)
    ) {
      return {
        summaryMarkdown:
          mdText`The exclusion was removed already, so nothing changed.`.toString(),
      };
    }

    await DataStoreService.updateOneById({
      id: store.id,
      data: {
        scanExclusions: readSettingIds(store.scanExclusions).filter(
          (entry: string): boolean => {
            return (
              entry.trim().toLowerCase() !==
              plan.exclusion.trim().toLowerCase()
            );
          },
        ),
      },
      props: data.actor.props,
    });

    return {
      summaryMarkdown:
        mdText`The exclusion was removed: the store's next scans read that place again.`.toString(),
    };
  },
};
