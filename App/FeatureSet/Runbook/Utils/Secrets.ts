import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import RunbookSecret from "Common/Models/DatabaseModels/RunbookSecret";
import RunbookSecretService from "Common/Server/Services/RunbookSecretService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import VMUtil from "Common/Server/Utils/VM/VMAPI";

export default class RunbookSecretsUtil {
  public static async loadForAgent(
    agentId: ObjectID,
  ): Promise<Array<RunbookSecret>> {
    return RunbookSecretService.findBy({
      query: {
        runbookAgents: QueryHelper.inRelationArray([agentId]),
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
