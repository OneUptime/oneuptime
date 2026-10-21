import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateOptions,
  PermissionGateResult,
} from "../../Utils/PermissionGate";
import User from "../../Utils/User";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import Select from "../../../Types/BaseDatabase/Select";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import UUID from "../../../Utils/UUID";

/*
 * A workflow's webhook secret key: the last segment of its Webhook trigger's
 * URL (Types/Workflow/WebhookTrigger.ts), and so a bearer credential - whoever
 * has the URL can start the workflow.
 *
 * It is shown, copied and reset in the Webhook trigger's settings dialog
 * (WebhookTriggerPanel), where someone wiring an outside system to the
 * workflow goes looking for it. It used to be a card on the workflow's
 * Settings page, away from the trigger it belongs to.
 *
 * Who may see it is who may reset it: the column's read list is its update
 * list (Workflow.webhookSecretKey). Asking for a column you cannot read is
 * fatal, not degraded - SelectPermission refuses the whole request - so the
 * builder spreads getWebhookSecretKeySelect() into its select rather than
 * naming the column.
 */
export const WEBHOOK_SECRET_KEY_COLUMN: string = "webhookSecretKey";

type ColumnPermissionsFunction = () => Array<Permission>;

const getColumnUpdatePermissions: ColumnPermissionsFunction =
  (): Array<Permission> => {
    const accessControl: ColumnAccessControl | undefined =
      new Workflow().getColumnAccessControlForAllColumns()[
        WEBHOOK_SECRET_KEY_COLUMN
      ];

    return accessControl?.update || [];
  };

export type CanSeeWebhookSecretKeyFunction = (
  options?: PermissionGateOptions | undefined,
) => boolean;

/*
 * Whether the signed-in user may read the key. Fails closed while the
 * permission snapshot has not landed, like PermissionGate.canReadColumn: the
 * dialog then says the URL is hidden, which is recoverable, where asking for
 * the column would fail the builder's whole load.
 */
export const canSeeWebhookSecretKey: CanSeeWebhookSecretKeyFunction = (
  options?: PermissionGateOptions | undefined,
): boolean => {
  return PermissionGate.canReadColumn(
    new Workflow(),
    WEBHOOK_SECRET_KEY_COLUMN,
    options,
  );
};

export type GetWebhookSecretKeySelectFunction = (
  options?: PermissionGateOptions | undefined,
) => Select<Workflow>;

// Spread into a Workflow select: the key when the user may read it, else nothing.
export const getWebhookSecretKeySelect: GetWebhookSecretKeySelectFunction = (
  options?: PermissionGateOptions | undefined,
): Select<Workflow> => {
  if (!canSeeWebhookSecretKey(options)) {
    return {};
  }

  return { webhookSecretKey: true };
};

export type GetWebhookSecretKeyResetGateFunction = (
  options?: PermissionGateOptions | undefined,
) => PermissionGateResult;

/*
 * Whether the signed-in user may reset the key, and when not, the sentence
 * that says which permission is missing. Read the same way as
 * PermissionGate.check, but against the column's own update list: that is
 * what ColumnPermission checks when the reset is saved, and it is narrower
 * than the table's (Delete Workflow can update a workflow, not its key).
 *
 * `isAllowed: false` with no reason means the permission snapshot has not
 * landed: hide the action rather than accuse anyone of lacking a permission
 * they hold.
 */
export const getWebhookSecretKeyResetGate: GetWebhookSecretKeyResetGateFunction =
  (options?: PermissionGateOptions | undefined): PermissionGateResult => {
    if (User.isMasterAdmin()) {
      return { isAllowed: true };
    }

    const columnPermissions: Array<Permission> = getColumnUpdatePermissions();

    if (columnPermissions.length === 0) {
      return { isAllowed: false };
    }

    if (!PermissionGate.hasPermissionSnapshot(options)) {
      return { isAllowed: false };
    }

    // The column's update, read the way the server's column check reads it.
    if (
      PermissionGate.holdsColumnPermission(
        new Workflow(),
        WEBHOOK_SECRET_KEY_COLUMN,
        "update",
        options,
      )
    ) {
      return { isAllowed: true };
    }

    const titles: Array<string> =
      PermissionGate.getPermissionTitles(columnPermissions);

    return {
      isAllowed: false,
      disabledReason:
        titles.length > 0
          ? `You do not have permission to reset this webhook URL. You need one of these permissions: ${titles.join(", ")}.`
          : "You do not have permission to reset this webhook URL.",
    };
  };

export type ResetWebhookSecretKeyFunction = (
  workflowId: ObjectID,
) => Promise<string>;

/*
 * Gives the workflow a new key and resolves with it once it is saved. The old
 * URL stops working at once: the trigger looks workflows up by the key in the
 * URL, and nothing remembers the previous one.
 *
 * A random v4 UUID, as the server generates for a new workflow
 * (WorkflowService.onCreateSuccess). Rejects with the API's error when the
 * save is refused, and the key is then unchanged.
 */
export const resetWebhookSecretKey: ResetWebhookSecretKeyFunction = async (
  workflowId: ObjectID,
): Promise<string> => {
  const secretKey: string = UUID.generate();

  await ModelAPI.updateById<Workflow>({
    modelType: Workflow,
    id: workflowId,
    data: {
      [WEBHOOK_SECRET_KEY_COLUMN]: secretKey,
    },
  });

  return secretKey;
};

export type IsWebhookSecretKeyTheWorkflowIdFunction = (data: {
  secretKey: string;
  workflowId: ObjectID | string;
}) => boolean;

/*
 * Workflows created before webhook secret keys existed were given their own ID
 * as the key, so the URLs they already had kept working
 * (1774559064920-MigrationName). That ID is no secret: it is in the address of
 * every page of the workflow. The dialog says so, next to the reset that fixes
 * it.
 */
export const isWebhookSecretKeyTheWorkflowId: IsWebhookSecretKeyTheWorkflowIdFunction =
  (data: { secretKey: string; workflowId: ObjectID | string }): boolean => {
    const secretKey: string = data.secretKey.trim().toLowerCase();

    return (
      secretKey.length > 0 &&
      secretKey === data.workflowId.toString().trim().toLowerCase()
    );
  };
