import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import RunbookCredentialType from "Common/Types/Runbook/RunbookCredentialType";
import RunbookCredential from "Common/Models/DatabaseModels/RunbookCredential";
import RunbookCredentialService from "Common/Server/Services/RunbookCredentialService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import logger from "Common/Server/Utils/Logger";

/*
 * Resolving a credential for a claimed job.
 *
 * This is the ONE place a credential's secret material is decrypted, and the
 * only place it leaves the database. Two properties make that safe, and both
 * are enforced by the query rather than by the caller remembering:
 *
 *   1. the credential must be assigned to the Runner doing the claiming, and
 *   2. it must belong to the same project as the job.
 *
 * A step could otherwise name any credential id in the system and have the
 * server hand it over — the step config is authored by a project member, but
 * the credential is administered separately and on purpose.
 */
export default class RunbookCredentialsUtil {
  public static async resolveForJob(data: {
    credentialId: string;
    agentId: ObjectID;
    projectId: ObjectID;
  }): Promise<JSONObject | null> {
    /*
     * Validate before querying, not with a try/catch around the constructor:
     * ObjectID's constructor does not parse or validate a string, so a
     * malformed id would sail through and reach Postgres as a uuid
     * comparison, raising a driver error that surfaces as a 500 instead of
     * the readable "this credential is not available" failure the claim path
     * is built to give.
     */
    if (!ObjectID.isValidUUID(data.credentialId)) {
      logger.warn(
        `Runbook credential id ${data.credentialId} is not a valid identifier.`,
      );
      return null;
    }

    const credentialId: ObjectID = new ObjectID(data.credentialId);

    const credential: RunbookCredential | null =
      await RunbookCredentialService.findOneBy({
        query: {
          _id: credentialId.toString(),
          projectId: data.projectId,
          runners: QueryHelper.inRelationArray([data.agentId]),
        },
        select: {
          _id: true,
          credentialType: true,
          sshHostname: true,
          sshPort: true,
          sshUsername: true,
          sshPrivateKey: true,
          sshPassphrase: true,
          sshPassword: true,
          kubernetesApiServerUrl: true,
          kubernetesServiceAccountToken: true,
          kubernetesCaCertificate: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!credential) {
      logger.warn(
        `Runbook credential ${data.credentialId} is not available to Runner ${data.agentId.toString()} — it does not exist, belongs to another project, or is not assigned to this Runner.`,
      );
      return null;
    }

    if (credential.credentialType === RunbookCredentialType.SSH) {
      return {
        credentialType: RunbookCredentialType.SSH,
        hostname: credential.sshHostname || "",
        port: credential.sshPort || 22,
        username: credential.sshUsername || "",
        ...(credential.sshPrivateKey
          ? { privateKey: credential.sshPrivateKey }
          : {}),
        ...(credential.sshPassphrase
          ? { passphrase: credential.sshPassphrase }
          : {}),
        ...(credential.sshPassword ? { password: credential.sshPassword } : {}),
      };
    }

    if (credential.credentialType === RunbookCredentialType.Kubernetes) {
      return {
        credentialType: RunbookCredentialType.Kubernetes,
        apiServerUrl: credential.kubernetesApiServerUrl || "",
        token: credential.kubernetesServiceAccountToken || "",
        ...(credential.kubernetesCaCertificate
          ? { caCertificate: credential.kubernetesCaCertificate }
          : {}),
      };
    }

    return null;
  }
}
