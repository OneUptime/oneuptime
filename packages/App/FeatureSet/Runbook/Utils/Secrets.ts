import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import RunbookSecret from "Common/Models/DatabaseModels/RunbookSecret";
import RunbookSecretService from "Common/Server/Services/RunbookSecretService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import VMUtil from "Common/Server/Utils/VM/VMAPI";

export default class RunbookSecretsUtil {
  /*
   * The secrets assigned to a project's own Runner: of its project only,
   * whatever the assignment table says.
   */
  public static async loadForAgent(data: {
    agentId: ObjectID;
    projectId: ObjectID;
  }): Promise<Array<RunbookSecret>> {
    return RunbookSecretService.findBy({
      query: {
        projectId: data.projectId,
        runners: QueryHelper.inRelationArray([data.agentId]),
      },
      select: {
        secretValue: true,
        name: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * The secrets a step claimed by a global Runner gets: those of the step's
   * OWN project that its people let global Runners use
   * (RunbookSecret.isAvailableToGlobalRunners). A global Runner serves
   * every project, so what it is handed is read per job from the job's
   * project - never from the Runner, which belongs to none - and a step of
   * one project can never be handed another project's secret.
   */
  public static async loadForGlobalRunnerJob(data: {
    projectId: ObjectID;
  }): Promise<Array<RunbookSecret>> {
    return RunbookSecretService.findBy({
      query: {
        projectId: data.projectId,
        isAvailableToGlobalRunners: true,
      },
      select: {
        secretValue: true,
        name: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });
  }

  public static populateInScript(data: {
    script: string;
    secrets: Array<RunbookSecret>;
  }): string {
    if (!data.script) {
      return data.script;
    }

    if (!data.script.includes("runbookSecrets.")) {
      return data.script;
    }

    const storageMap: JSONObject = {
      runbookSecrets: {},
    };

    for (const secret of data.secrets) {
      if (!secret.name || !secret.secretValue) {
        continue;
      }

      (storageMap["runbookSecrets"] as JSONObject)[secret.name as string] =
        secret.secretValue;
    }

    return VMUtil.replaceValueInPlace(storageMap, data.script, false);
  }
}
