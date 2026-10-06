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

/*
 * A workflow's incoming email secret key: what its Incoming Email trigger's
 * address is built from (workflow-{key}@{inbound domain}, see
 * Types/Workflow/IncomingEmailTrigger.ts), and so a bearer credential -
 * whoever has the address can start the workflow.
 *
 * It is shown, copied and reset in the Incoming Email trigger's settings
 * dialog (IncomingEmailTriggerPanel), the way the Webhook trigger's URL is
 * (WorkflowWebhookSecretKey.ts). Who may see it is who may reset it: the
 * column's read list is its update list (Workflow.incomingEmailSecretKey).
 * Asking for a column you cannot read fails the whole request, so the builder
 * spreads getIncomingEmailSecretKeySelect() into its select rather than naming
 * the column.
 */
export const INCOMING_EMAIL_SECRET_KEY_COLUMN: string =
  "incomingEmailSecretKey";

type ColumnPermissionsFunction = () => Array<Permission>;

const getColumnUpdatePermissions: ColumnPermissionsFunction =
  (): Array<Permission> => {
    const accessControl: ColumnAccessControl | undefined =
      new Workflow().getColumnAccessControlForAllColumns()[
        INCOMING_EMAIL_SECRET_KEY_COLUMN
      ];

    return accessControl?.update || [];
  };

export type CanSeeIncomingEmailSecretKeyFunction = (
  options?: PermissionGateOptions | undefined,
) => boolean;

/*
 * Whether the signed-in user may read the key. Fails closed while the
 * permission snapshot has not landed: the dialog then says the address is
 * hidden, which is recoverable, where asking for the column would fail the
 * builder's whole load.
 */
export const canSeeIncomingEmailSecretKey: CanSeeIncomingEmailSecretKeyFunction =
  (options?: PermissionGateOptions | undefined): boolean => {
    return PermissionGate.canReadColumn(
      new Workflow(),
      INCOMING_EMAIL_SECRET_KEY_COLUMN,
      options,
    );
  };

export type GetIncomingEmailSecretKeySelectFunction = (
  options?: PermissionGateOptions | undefined,
) => Select<Workflow>;

// Spread into a Workflow select: the key when the user may read it, else nothing.
export const getIncomingEmailSecretKeySelect: GetIncomingEmailSecretKeySelectFunction =
  (options?: PermissionGateOptions | undefined): Select<Workflow> => {
    if (!canSeeIncomingEmailSecretKey(options)) {
      return {};
    }

    return { incomingEmailSecretKey: true };
  };

export type GetIncomingEmailSecretKeyResetGateFunction = (
  options?: PermissionGateOptions | undefined,
) => PermissionGateResult;

/*
 * Whether the signed-in user may give the workflow a new address, and when
 * not, the sentence that says which permission is missing. Read against the
 * column's own update list, which is what ColumnPermission checks when the
 * new key is saved.
 *
 * `isAllowed: false` with no reason means the permission snapshot has not
 * landed: hide the action rather than accuse anyone of lacking a permission
 * they hold.
 */
export const getIncomingEmailSecretKeyResetGate: GetIncomingEmailSecretKeyResetGateFunction =
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
        INCOMING_EMAIL_SECRET_KEY_COLUMN,
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
          ? `You do not have permission to reset this email address. You need one of these permissions: ${titles.join(", ")}.`
          : "You do not have permission to reset this email address.",
    };
  };

export type ResetIncomingEmailSecretKeyFunction = (
  workflowId: ObjectID,
) => Promise<string>;

/*
 * Gives the workflow a new key - and so a new address - and resolves with it
 * once it is saved. The old address stops working at once: the trigger finds
 * workflows by the key in the address, and nothing remembers the previous
 * one. Also what creates the first address of a workflow that has none.
 *
 * Rejects with the API's error when the save is refused, and the key is then
 * unchanged.
 */
export const resetIncomingEmailSecretKey: ResetIncomingEmailSecretKeyFunction =
  async (workflowId: ObjectID): Promise<string> => {
    const secretKey: ObjectID = ObjectID.generate();

    await ModelAPI.updateById<Workflow>({
      modelType: Workflow,
      id: workflowId,
      data: {
        [INCOMING_EMAIL_SECRET_KEY_COLUMN]: secretKey.toString(),
      },
    });

    return secretKey.toString();
  };
