import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import RunbookSecret from "Common/Models/DatabaseModels/RunbookSecret";
import RunbookSecretService from "Common/Server/Services/RunbookSecretService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import VMUtil from "Common/Server/Utils/VM/VMAPI";
import {
  TemplatePlaceholder,
  findTemplatePlaceholders,
} from "Common/Utils/TemplatePlaceholders";

const RUNBOOK_SECRETS_PREFIX: string = "runbookSecrets.";

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

  /*
   * The runbook secrets a script names ({{runbookSecrets.NAME}}), each once,
   * in the order it names them - read with the same placeholder reader that
   * fills them in, in time in line with the script's length.
   */
  public static getSecretNamesInScript(script: string): Array<string> {
    const names: Array<string> = [];

    for (const placeholder of findTemplatePlaceholders(script || "")) {
      const inner: string = (placeholder as TemplatePlaceholder).inner.trim();

      if (!inner.startsWith(RUNBOOK_SECRETS_PREFIX)) {
        continue;
      }

      const name: string = inner.slice(RUNBOOK_SECRETS_PREFIX.length).trim();

      if (name && !names.includes(name)) {
        names.push(name);
      }
    }

    return names;
  }

  /*
   * The secrets a script names that are not among `secrets` - for a step on
   * a global Runner, the ones its project has not let global Runners use (or
   * that do not exist). Such a step is failed with their names rather than
   * run with a placeholder where the value should be.
   */
  public static getSecretNamesNotIn(data: {
    script: string;
    secrets: Array<RunbookSecret>;
  }): Array<string> {
    const available: Set<string> = new Set<string>(
      data.secrets.map((secret: RunbookSecret): string => {
        return secret.name || "";
      }),
    );

    return RunbookSecretsUtil.getSecretNamesInScript(data.script).filter(
      (name: string): boolean => {
        return !available.has(name);
      },
    );
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
