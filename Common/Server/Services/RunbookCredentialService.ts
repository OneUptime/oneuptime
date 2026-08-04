import DatabaseService from "./DatabaseService";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import BadDataException from "../../Types/Exception/BadDataException";
import RunbookCredentialType from "../../Types/Runbook/RunbookCredentialType";
import RunbookCredential from "../../Models/DatabaseModels/RunbookCredential";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<RunbookCredential> {
  public constructor() {
    super(RunbookCredential);
  }

  /*
   * A credential that is missing what its type needs is not a credential —
   * it is a step that will fail at execution time, on the far side of an
   * approval, in front of somebody's incident. Reject it at creation.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<RunbookCredential>,
  ): Promise<OnCreate<RunbookCredential>> {
    const type: RunbookCredentialType | undefined =
      createBy.data.credentialType;

    if (!type) {
      throw new BadDataException("Credential type is required.");
    }

    if (type === RunbookCredentialType.SSH) {
      if (!createBy.data.sshHostname) {
        throw new BadDataException("SSH credentials need a hostname.");
      }

      if (!createBy.data.sshUsername) {
        throw new BadDataException("SSH credentials need a username.");
      }

      if (!createBy.data.sshPrivateKey && !createBy.data.sshPassword) {
        throw new BadDataException(
          "SSH credentials need either a private key or a password.",
        );
      }
    }

    /*
     * The column is free text, not a database enum, so an unrecognised type
     * would otherwise create a credential that skips every check below and
     * can never be executed by anything.
     */
    if (
      type !== RunbookCredentialType.SSH &&
      type !== RunbookCredentialType.Kubernetes
    ) {
      throw new BadDataException(`Unknown credential type: ${String(type)}`);
    }

    if (type === RunbookCredentialType.Kubernetes) {
      if (!createBy.data.kubernetesApiServerUrl) {
        throw new BadDataException(
          "Kubernetes credentials need an API server URL.",
        );
      }

      if (!createBy.data.kubernetesServiceAccountToken) {
        throw new BadDataException(
          "Kubernetes credentials need a service account token.",
        );
      }
    }

    return { createBy, carryForward: [] };
  }
}

export default new Service();
