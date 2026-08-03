# Runbook Credentials

A credential is how a runbook reaches something that is **not** the Runner's own host — a server over SSH, or a Kubernetes cluster.

Without one, "restart the service" means writing a shell script and provisioning a key or a kubeconfig onto the Runner host by hand, where it sits on disk outside OneUptime's control. A credential is that same access as a managed object: encrypted at rest, assigned to specific Runners, and referenced by name from a step.

Manage them under **Runbooks → Credentials**.

## What is stored

| Type | Fields |
| --- | --- |
| SSH | Hostname, port (defaults to 22), username, and either a PEM private key (with an optional passphrase) or a password. |
| Kubernetes | API server URL, a service account token, and the cluster CA certificate. |

## Secret values are write-only

Private keys, passphrases, passwords and service account tokens are encrypted at rest and the API **never returns them** — not to the dashboard, not to a workflow, not to an export. The table can show you what a credential *is* without ever showing what it holds.

That means there is no "view" for a secret value, only "replace": re-entering a value is how you rotate it. If you lose the original, issue a new key on the target system and update the credential.

## Assigning a credential to Runners

A credential is usable only by the Runners you assign it to, and a step must target one of those Runners. If a step names a credential its Runner is not assigned to, the step **fails rather than running** — a Runner that silently does nothing looks exactly like one that worked.

The assignment is the access boundary, so keep it narrow: a Runner that only ever restarts one cluster does not need the SSH key for your database hosts.

## Least privilege on the far side

OneUptime cannot restrict what your credential is allowed to do on the target system — that is the target system's job, and it is worth doing:

- **SSH** — prefer a key over a password, give the user only the commands it needs (a forced command or a restricted shell where practical), and do not reuse an administrator's personal key.
- **Kubernetes** — bind the service account to a Role that permits `patch` on exactly the workloads your runbooks touch, in exactly the namespaces they run in. Restart and scale need nothing more than that.

## Who can see them

Creating, editing and deleting credentials needs the Runbook Credential permissions (or Project Owner/Admin). Reading a credential shows its non-secret fields only.

Note that a Runner's **agent key** is equivalent to the credentials assigned to that Runner: anything holding the key can claim work as that Runner and receive credential material. Agent keys are readable only by Project Owners, Project Admins and Runbook Admins for that reason — treat them the same way you would treat the credentials themselves.
