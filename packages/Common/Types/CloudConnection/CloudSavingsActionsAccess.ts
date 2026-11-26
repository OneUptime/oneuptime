import {
  CloudSavingsActionsAccess,
  getCloudSavingsActionsAccess,
} from "../Cloud/CloudSavingsAction";

/*
 * SAVINGS ACTIONS: WHAT A CONNECTION'S SETUP COMMAND GRANTS SO ONEUPTIME
 * CAN ACT ON A SAVING (#11010).
 *
 * Off on every connection until someone picks otherwise ("Savings
 * actions", CloudConnectionCatalog), and granted on its own - a policy or
 * a custom role of its own, beside the read-only access - so it is seen
 * and removed on its own. Two levels:
 *
 *   - "clean-up": stop and start an instance (and, on AWS, an RDS
 *     database), delete an unattached disk after a final snapshot (and
 *     make it again from that snapshot, to undo it), delete an old
 *     snapshot or image, release an idle public address, change an EBS
 *     volume from gp2 to gp3;
 *   - "resize": that, and change an instance's size or a database's
 *     class - a restart.
 *
 * Each list is exactly the calls the cloud's savings actions make
 * (Server/Utils/CloudSavings/Cloud/*), no more: a guard holds them to it
 * (CloudSavingsActionsCommandNeeds). Nothing here reads data, changes who
 * may sign in, or deletes anything but the disks, snapshots, images and
 * addresses a person or a rule names - and those only once they are
 * unattached, which each action reads first.
 */

/*
 * ---------------------------------------------------------------------------
 * AWS: an inline policy of its own, OneUptimeSavingsActions
 * ---------------------------------------------------------------------------
 */

export const AWS_SAVINGS_ACTIONS_POLICY_NAME: string =
  "OneUptimeSavingsActions";

/*
 * The access key's user takes it through a group of its own, as it takes
 * the other policies its full inline policies cannot hold.
 */
export const AWS_SAVINGS_ACTIONS_GROUP_NAME: string =
  AWS_SAVINGS_ACTIONS_POLICY_NAME;

export const AWS_SAVINGS_ACTIONS_CLEAN_UP_ACTIONS: ReadonlyArray<string> = [
  "ec2:DescribeInstances",
  "ec2:StopInstances",
  "ec2:StartInstances",
  "ec2:DescribeVolumes",
  "ec2:ModifyVolume",
  "ec2:CreateSnapshot",
  "ec2:DescribeSnapshots",
  "ec2:DeleteVolume",
  "ec2:CreateVolume",
  "ec2:DeleteSnapshot",
  "ec2:DescribeAddresses",
  "ec2:ReleaseAddress",
  "rds:DescribeDBInstances",
  "rds:StopDBInstance",
  "rds:StartDBInstance",
];

export const AWS_SAVINGS_ACTIONS_RESIZE_ACTIONS: ReadonlyArray<string> = [
  "ec2:ModifyInstanceAttribute",
  "rds:ModifyDBInstance",
];

/*
 * A final snapshot, and a disk made again from it, are tagged as they are
 * made, so the account can tell them OneUptime's: EC2 asks for
 * ec2:CreateTags then, which is granted for those two calls alone (the
 * ec2:CreateAction condition), never to tag anything else.
 */
export const AWS_SAVINGS_ACTIONS_TAG_ON_CREATE: ReadonlyArray<string> = [
  "CreateSnapshot",
  "CreateVolume",
];

// The tag OneUptime puts on what it makes: the action that made it.
export const CLOUD_SAVINGS_ACTION_TAG_KEY: string = "oneuptime-savings-action";

// The actions a level grants, in the order they are written.
export function getAwsSavingsActions(
  access: CloudSavingsActionsAccess | string | undefined,
): Array<string> {
  const level: CloudSavingsActionsAccess = getCloudSavingsActionsAccess(access);

  if (level === CloudSavingsActionsAccess.Off) {
    return [];
  }

  return [
    ...AWS_SAVINGS_ACTIONS_CLEAN_UP_ACTIONS,
    ...(level === CloudSavingsActionsAccess.Resize
      ? AWS_SAVINGS_ACTIONS_RESIZE_ACTIONS
      : []),
  ];
}

export interface AwsSavingsActionsStatement {
  Effect: string;
  Action: Array<string>;
  Resource: string;
  Condition?: Record<string, Record<string, Array<string>>> | undefined;
}

// The policy, or null when Savings actions are off.
export function getAwsSavingsActionsPolicy(
  access: CloudSavingsActionsAccess | string | undefined,
): { Version: string; Statement: Array<AwsSavingsActionsStatement> } | null {
  const actions: Array<string> = getAwsSavingsActions(access);

  if (actions.length === 0) {
    return null;
  }

  return {
    Version: "2012-10-17",
    Statement: [
      { Effect: "Allow", Action: actions, Resource: "*" },
      {
        Effect: "Allow",
        Action: ["ec2:CreateTags"],
        Resource: "*",
        Condition: {
          StringEquals: {
            "ec2:CreateAction": [...AWS_SAVINGS_ACTIONS_TAG_ON_CREATE],
          },
        },
      },
    ],
  };
}

// The policy as the commands write it; "" when it is off.
export function getAwsSavingsActionsPolicyDocument(
  access: CloudSavingsActionsAccess | string | undefined,
): string {
  const policy: ReturnType<typeof getAwsSavingsActionsPolicy> =
    getAwsSavingsActionsPolicy(access);

  return policy ? JSON.stringify(policy) : "";
}

/*
 * ---------------------------------------------------------------------------
 * Azure: a custom role of its own, OneUptime Savings Actions
 * ---------------------------------------------------------------------------
 */

export const AZURE_SAVINGS_ACTIONS_ROLE: string = "OneUptime Savings Actions";

export const AZURE_SAVINGS_ACTIONS_CLEAN_UP_ACTIONS: ReadonlyArray<string> = [
  "Microsoft.Compute/virtualMachines/read",
  "Microsoft.Compute/virtualMachines/deallocate/action",
  "Microsoft.Compute/virtualMachines/start/action",
  "Microsoft.Compute/disks/read",
  "Microsoft.Compute/disks/write",
  "Microsoft.Compute/disks/delete",
  "Microsoft.Compute/snapshots/read",
  "Microsoft.Compute/snapshots/write",
  "Microsoft.Compute/snapshots/delete",
  "Microsoft.Network/publicIPAddresses/read",
  "Microsoft.Network/publicIPAddresses/delete",
];

export const AZURE_SAVINGS_ACTIONS_RESIZE_ACTIONS: ReadonlyArray<string> = [
  "Microsoft.Compute/virtualMachines/write",
];

export function getAzureSavingsActions(
  access: CloudSavingsActionsAccess | string | undefined,
): Array<string> {
  const level: CloudSavingsActionsAccess = getCloudSavingsActionsAccess(access);

  if (level === CloudSavingsActionsAccess.Off) {
    return [];
  }

  return [
    ...AZURE_SAVINGS_ACTIONS_CLEAN_UP_ACTIONS,
    ...(level === CloudSavingsActionsAccess.Resize
      ? AZURE_SAVINGS_ACTIONS_RESIZE_ACTIONS
      : []),
  ];
}

/*
 * The role, built by jq in the shell where the scope it is assigned at
 * ($SCOPE) is known, then assigned to the app on that scope - as Data
 * security response's role is.
 */
export function getAzureSavingsActionsRoleLines(
  access: CloudSavingsActionsAccess | string | undefined,
): Array<string> {
  const actions: Array<string> = getAzureSavingsActions(access);

  if (actions.length === 0) {
    return [];
  }

  const quoted: string = actions
    .map((action: string): string => {
      return `"${action}"`;
    })
    .join(", ");

  return [
    `SAVINGS_ROLE=$(jq -n --arg scope "$SCOPE" '{Name: "${AZURE_SAVINGS_ACTIONS_ROLE}", IsCustom: true, Description: "OneUptime: act on the savings you approve - stop and start VMs, delete unattached disks and old snapshots, release idle public IPs.", Actions: [${quoted}], NotActions: [], AssignableScopes: [$scope]}')`,
    `az role definition create --role-definition "$SAVINGS_ROLE" > /dev/null 2>&1 || az role definition update --role-definition "$SAVINGS_ROLE" > /dev/null`,
    `az role assignment create --assignee "$APP" --role "${AZURE_SAVINGS_ACTIONS_ROLE}" --scope "$SCOPE" > /dev/null`,
  ];
}

/*
 * ---------------------------------------------------------------------------
 * Google Cloud: a custom role of its own, oneuptimeSavingsActions
 * ---------------------------------------------------------------------------
 */

export const GCP_SAVINGS_ACTIONS_ROLE_ID: string = "oneuptimeSavingsActions";

// The API the actions call, turned on by the command's line of its own.
export const GCP_SAVINGS_ACTIONS_SERVICES: ReadonlyArray<string> = [
  "compute.googleapis.com",
];

export const GCP_SAVINGS_ACTIONS_CLEAN_UP_PERMISSIONS: ReadonlyArray<string> = [
  "compute.instances.get",
  "compute.instances.stop",
  "compute.instances.start",
  "compute.disks.get",
  "compute.disks.createSnapshot",
  "compute.snapshots.create",
  "compute.snapshots.get",
  "compute.disks.delete",
  "compute.disks.create",
  "compute.snapshots.useReadOnly",
  "compute.addresses.get",
  "compute.addresses.delete",
  "compute.globalAddresses.get",
  "compute.globalAddresses.delete",
  "compute.images.get",
  "compute.images.delete",
];

export const GCP_SAVINGS_ACTIONS_RESIZE_PERMISSIONS: ReadonlyArray<string> = [
  "compute.instances.setMachineType",
];

export function getGcpSavingsActionsPermissions(
  access: CloudSavingsActionsAccess | string | undefined,
): Array<string> {
  const level: CloudSavingsActionsAccess = getCloudSavingsActionsAccess(access);

  if (level === CloudSavingsActionsAccess.Off) {
    return [];
  }

  return [
    ...GCP_SAVINGS_ACTIONS_CLEAN_UP_PERMISSIONS,
    ...(level === CloudSavingsActionsAccess.Resize
      ? GCP_SAVINGS_ACTIONS_RESIZE_PERMISSIONS
      : []),
  ];
}

/*
 * The API, the role made where the command binds roles (the project, or
 * the organization) and bound there, as the other custom roles are.
 */
export function getGcpSavingsActionsRoleLines(data: {
  access: CloudSavingsActionsAccess | string | undefined;
  roleHome: string;
  roleName: string;
  bind: (role: string) => string;
}): Array<string> {
  const permissions: Array<string> = getGcpSavingsActionsPermissions(
    data.access,
  );

  if (permissions.length === 0) {
    return [];
  }

  const list: string = permissions.join(",");

  return [
    `gcloud services enable ${GCP_SAVINGS_ACTIONS_SERVICES.join(" ")}`,
    `gcloud iam roles create ${GCP_SAVINGS_ACTIONS_ROLE_ID} ${data.roleHome} --title "OneUptime Savings Actions" --description "OneUptime: act on the savings you approve - stop and start VMs, delete unattached disks and old images, release idle addresses." --permissions ${list} --stage GA --quiet > /dev/null 2>&1 || gcloud iam roles update ${GCP_SAVINGS_ACTIONS_ROLE_ID} ${data.roleHome} --permissions ${list} --quiet > /dev/null`,
    data.bind(data.roleName),
  ];
}
