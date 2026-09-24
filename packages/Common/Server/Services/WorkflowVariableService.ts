import DatabaseService from "./DatabaseService";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import UpdateBy from "../Types/Database/UpdateBy";
import logger from "../Utils/Logger";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import QueryDeepPartialEntity from "../../Types/Database/PartialEntity";
import Typeof from "../../Types/Typeof";
import {
  DEFAULT_OAUTH2_CLIENT_AUTHENTICATION_METHOD,
  OAuth2GrantType,
  WorkflowVariableType,
  getOAuth2AdditionalParametersError,
  isOAuth2ClientAuthenticationMethod,
  isOAuth2GrantType,
  normalizeOAuth2AdditionalParameters,
} from "../../Types/Workflow/WorkflowVariableOAuth";
import Model from "../../Models/DatabaseModels/WorkflowVariable";

/*
 * isSecret is declared `string` over a genuinely boolean column, so the value
 * that comes back is `true` from Postgres and can be the string "true" from a
 * request body. Read exactly the way RunWorkflow.getSecretWorkflowVariableValues
 * reads it, so what this service calls secret and what the run logs redact can
 * never disagree.
 */
function isSecretValue(value: unknown): boolean {
  return value === true || value === "true";
}

/*
 * The settings of an OAuth 2.0 variable a person can change after creating it.
 * A change to any of them can change which token the identity provider issues
 * (a new scope, a different client, another tenant's token URL), so the cached
 * token is thrown away when one of them actually changes.
 */
export const OAUTH2_EDITABLE_SETTINGS_COLUMNS: ReadonlyArray<keyof Model> = [
  "oauthTokenUrl",
  "oauthClientId",
  "oauthClientSecret",
  "oauthRefreshToken",
  "oauthScope",
  "oauthAdditionalParameters",
  "oauthClientAuthenticationMethod",
];

/*
 * Everything an OAuth 2.0 variable stores that a Static variable must never
 * carry: the settings above, the grant type, and the columns OneUptime writes
 * while it manages the token.
 */
export const OAUTH2_COLUMNS: ReadonlyArray<keyof Model> = [
  ...OAUTH2_EDITABLE_SETTINGS_COLUMNS,
  "oauthGrantType",
  "oauthAccessToken",
  "oauthAccessTokenExpiresAt",
  "oauthLastRefreshedAt",
  "oauthLastRefreshError",
  "oauthLastRefreshErrorAt",
];

/*
 * What onUpdateSuccess writes after a settings change: no token, no expiry, no
 * refresh history and no stale error, so the Token column reads "Not fetched
 * yet" and the next workflow that uses the variable fetches a new token.
 */
const CLEARED_OAUTH2_TOKEN_STATE: JSONObject = {
  oauthAccessToken: null,
  oauthAccessTokenExpiresAt: null,
  oauthLastRefreshedAt: null,
  oauthLastRefreshError: null,
  oauthLastRefreshErrorAt: null,
};

interface UpdateCarryForward {
  // Variables whose OAuth settings this update changes.
  invalidateOAuthTokenForIds: Array<string>;
}

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }

  if (typeof value === Typeof.String) {
    return (value as string).trim().length === 0;
  }

  if (typeof value === Typeof.Object && !Array.isArray(value)) {
    return Object.keys(value as Record<string, unknown>).length === 0;
  }

  return false;
}

function getTokenUrlError(value: unknown): string | null {
  if (typeof value !== Typeof.String && !(value instanceof Object)) {
    return "Token URL is required for an OAuth 2.0 variable.";
  }

  const text: string = String(value).trim();

  if (!text) {
    return "Token URL is required for an OAuth 2.0 variable.";
  }

  let parsed: URL;

  try {
    parsed = new URL(text);
  } catch {
    return `"${text}" is not a valid token URL.`;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return "The token URL must start with https:// (or http:// for an identity provider on your own network).";
  }

  return null;
}

/*
 * Compared as the service stores them: text trimmed, parameters normalised,
 * empty and absent treated alike. Without this an edit form that round-trips an
 * unchanged value would be read as a change and throw a good token away every
 * time somebody fixed a typo in the description.
 */
function normalizeSettingForComparison(
  column: keyof Model,
  value: unknown,
): string {
  if (column === "oauthAdditionalParameters") {
    const normalized: Record<string, string> =
      normalizeOAuth2AdditionalParameters(value);

    return JSON.stringify(
      Object.keys(normalized)
        .sort()
        .map((key: string) => {
          return [key, normalized[key]];
        }),
    );
  }

  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * A variable's type decides what it must carry, and the column metadata
   * cannot say "required when" - so both halves of that rule live here.
   *
   * A Static variable needs content (TableColumn used to require it for every
   * row, which an OAuth variable cannot satisfy). It never uses the OAuth
   * columns, and they are dropped rather than refused: the dashboard's create
   * form posts every field it has, including the OAuth ones it hid and their
   * default values.
   *
   * An OAuth 2.0 variable needs what its grant needs to fetch a token. It is
   * always secret, because its value is a bearer credential - redacting it from
   * run logs is not something to leave to a toggle - and it stores no content:
   * its value is the access token, which lives in its own encrypted column.
   */
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const data: Model = createBy.data;
    const record: Record<string, unknown> = data as unknown as Record<
      string,
      unknown
    >;

    const variableType: unknown = isBlank(data.variableType)
      ? WorkflowVariableType.Static
      : data.variableType;

    if (
      !Object.values(WorkflowVariableType).includes(
        variableType as WorkflowVariableType,
      )
    ) {
      throw new BadDataException(
        `Variable type must be one of: ${Object.values(
          WorkflowVariableType,
        ).join(", ")}.`,
      );
    }

    data.variableType = variableType as WorkflowVariableType;

    if (variableType === WorkflowVariableType.Static) {
      if (!data.content) {
        throw new BadDataException("content is required");
      }

      for (const column of OAUTH2_COLUMNS) {
        delete record[column as string];
      }

      return { createBy, carryForward: null };
    }

    if (!isOAuth2GrantType(data.oauthGrantType)) {
      throw new BadDataException(
        `OAuth grant type must be one of: ${Object.values(OAuth2GrantType).join(
          ", ",
        )}.`,
      );
    }

    const tokenUrlError: string | null = getTokenUrlError(data.oauthTokenUrl);

    if (tokenUrlError) {
      throw new BadDataException(tokenUrlError);
    }

    data.oauthTokenUrl = String(data.oauthTokenUrl).trim();

    if (
      typeof data.oauthClientId !== Typeof.String ||
      isBlank(data.oauthClientId)
    ) {
      throw new BadDataException(
        "Client ID is required for an OAuth 2.0 variable.",
      );
    }

    data.oauthClientId = (data.oauthClientId as string).trim();

    this.assertOptionalText(data.oauthClientSecret, "Client secret");
    this.assertOptionalText(data.oauthRefreshToken, "Refresh token");
    this.assertOptionalText(data.oauthScope, "Scope");

    if (
      data.oauthGrantType === OAuth2GrantType.ClientCredentials &&
      isBlank(data.oauthClientSecret)
    ) {
      throw new BadDataException(
        "Client secret is required for the Client Credentials grant.",
      );
    }

    if (data.oauthGrantType === OAuth2GrantType.RefreshToken) {
      if (isBlank(data.oauthRefreshToken)) {
        throw new BadDataException(
          "Refresh token is required for the Refresh Token grant.",
        );
      }
    } else {
      // The form hides it for this grant; an API caller may still send one.
      delete record["oauthRefreshToken"];
    }

    if (isBlank(data.oauthClientSecret)) {
      // A public client. Store nothing rather than an empty ciphertext.
      delete record["oauthClientSecret"];
    }

    data.oauthScope = isBlank(data.oauthScope)
      ? (null as unknown as string)
      : (data.oauthScope as string).trim();

    const parametersError: string | null = getOAuth2AdditionalParametersError(
      data.oauthAdditionalParameters,
    );

    if (parametersError) {
      throw new BadDataException(parametersError);
    }

    data.oauthAdditionalParameters = isBlank(data.oauthAdditionalParameters)
      ? (null as unknown as JSONObject)
      : normalizeOAuth2AdditionalParameters(data.oauthAdditionalParameters);

    if (isBlank(data.oauthClientAuthenticationMethod)) {
      data.oauthClientAuthenticationMethod =
        DEFAULT_OAUTH2_CLIENT_AUTHENTICATION_METHOD;
    } else if (
      !isOAuth2ClientAuthenticationMethod(data.oauthClientAuthenticationMethod)
    ) {
      throw new BadDataException(
        "Client authentication must be HTTP Basic Header or Request Body.",
      );
    }

    /*
     * isSecret is declared `string` over a boolean column (see isSecretValue);
     * write the boolean the column holds.
     */
    data.isSecret = true as unknown as string;
    data.content = "";

    return { createBy, carryForward: null };
  }

  /*
   * Clears the cached token of every variable whose OAuth settings this update
   * changed, so the next workflow that uses it fetches one with the new
   * settings instead of reusing a token the old ones produced.
   *
   * It runs after the write, as root, because nobody may write the token
   * columns through the API - so they cannot ride along in the caller's own
   * update, which is permission-checked column by column. A failure here is
   * logged rather than thrown: the settings are already saved, and a caller
   * who retried would change nothing and so clear nothing. The cost of a miss
   * is bounded - the old token is used until it expires or someone presses
   * Refresh now.
   */
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const carryForward: UpdateCarryForward | null =
      (onUpdate.carryForward as UpdateCarryForward | null) || null;

    const idsToInvalidate: Set<string> = new Set(
      carryForward?.invalidateOAuthTokenForIds || [],
    );

    if (idsToInvalidate.size === 0) {
      return onUpdate;
    }

    for (const id of updatedItemIds) {
      if (!idsToInvalidate.has(id.toString())) {
        continue;
      }

      try {
        await this.updateOneById({
          id,
          // Cast once: see the TS2589 note in onBeforeUpdate.
          data: CLEARED_OAUTH2_TOKEN_STATE as unknown as QueryDeepPartialEntity<Model>,
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
        });
      } catch (err) {
        logger.error(
          `Could not clear the cached OAuth token of workflow variable ${id.toString()} after its settings changed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return onUpdate;
  }

  private assertOptionalText(value: unknown, label: string): void {
    if (
      value !== undefined &&
      value !== null &&
      typeof value !== Typeof.String
    ) {
      throw new BadDataException(`${label} must be text.`);
    }
  }

  /*
   * The OAuth half of onBeforeUpdate, run against the rows the update will
   * touch. Returns the ids whose settings actually change.
   */
  private applyOAuthUpdateRules(
    updateBy: UpdateBy<Model>,
    itemsBeingUpdated: Array<Model>,
  ): UpdateCarryForward {
    const data: Record<string, unknown> = updateBy.data as unknown as Record<
      string,
      unknown
    >;

    const oauthItems: Array<Model> = itemsBeingUpdated.filter((item: Model) => {
      return item.variableType === WorkflowVariableType.OAuth2;
    });

    const staticItems: Array<Model> = itemsBeingUpdated.filter(
      (item: Model) => {
        return item.variableType !== WorkflowVariableType.OAuth2;
      },
    );

    if (data["content"] !== undefined && oauthItems.length > 0) {
      /*
       * An OAuth variable's value is the token OneUptime fetches. A value typed
       * over it would never be used, so it is refused rather than accepted and
       * silently ignored.
       */
      if (!isBlank(data["content"])) {
        throw new BadDataException(
          `"${oauthItems[0]!.name}" is an OAuth 2.0 variable. Its value is the access token OneUptime fetches from your identity provider, so it cannot be set by hand. Change its OAuth settings or credentials instead.`,
        );
      }

      if (staticItems.length === 0) {
        delete data["content"];
      }
    }

    const providedColumns: Array<keyof Model> = OAUTH2_COLUMNS.filter(
      (column: keyof Model) => {
        return data[column as string] !== undefined;
      },
    );

    if (providedColumns.length === 0) {
      return { invalidateOAuthTokenForIds: [] };
    }

    if (oauthItems.length === 0) {
      /*
       * A Static variable never uses these. The dashboard's edit form posts
       * every field it holds, the hidden OAuth ones included, so dropping them
       * is what keeps editing a Static variable working.
       */
      for (const column of providedColumns) {
        delete data[column as string];
      }

      return { invalidateOAuthTokenForIds: [] };
    }

    if (staticItems.length > 0) {
      throw new BadDataException(
        "OAuth settings can only be changed on OAuth 2.0 variables, and this update also matches Static variables. Update them separately.",
      );
    }

    if (data["oauthTokenUrl"] !== undefined) {
      const tokenUrlError: string | null = getTokenUrlError(
        data["oauthTokenUrl"],
      );

      if (tokenUrlError) {
        throw new BadDataException(tokenUrlError);
      }

      data["oauthTokenUrl"] = String(data["oauthTokenUrl"]).trim();
    }

    if (data["oauthClientId"] !== undefined) {
      if (
        typeof data["oauthClientId"] !== Typeof.String ||
        isBlank(data["oauthClientId"])
      ) {
        throw new BadDataException(
          "Client ID is required for an OAuth 2.0 variable.",
        );
      }

      data["oauthClientId"] = (data["oauthClientId"] as string).trim();
    }

    this.assertOptionalText(data["oauthClientSecret"], "Client secret");
    this.assertOptionalText(data["oauthRefreshToken"], "Refresh token");
    this.assertOptionalText(data["oauthScope"], "Scope");

    if (data["oauthScope"] !== undefined) {
      data["oauthScope"] = isBlank(data["oauthScope"])
        ? null
        : (data["oauthScope"] as string).trim();
    }

    if (data["oauthAdditionalParameters"] !== undefined) {
      const parametersError: string | null = getOAuth2AdditionalParametersError(
        data["oauthAdditionalParameters"],
      );

      if (parametersError) {
        throw new BadDataException(parametersError);
      }

      data["oauthAdditionalParameters"] = isBlank(
        data["oauthAdditionalParameters"],
      )
        ? null
        : normalizeOAuth2AdditionalParameters(
            data["oauthAdditionalParameters"],
          );
    }

    if (data["oauthClientAuthenticationMethod"] !== undefined) {
      if (isBlank(data["oauthClientAuthenticationMethod"])) {
        data["oauthClientAuthenticationMethod"] =
          DEFAULT_OAUTH2_CLIENT_AUTHENTICATION_METHOD;
      } else if (
        !isOAuth2ClientAuthenticationMethod(
          data["oauthClientAuthenticationMethod"],
        )
      ) {
        throw new BadDataException(
          "Client authentication must be HTTP Basic Header or Request Body.",
        );
      }
    }

    for (const item of oauthItems) {
      if (
        data["oauthClientSecret"] !== undefined &&
        isBlank(data["oauthClientSecret"]) &&
        item.oauthGrantType === OAuth2GrantType.ClientCredentials
      ) {
        throw new BadDataException(
          `The client secret of "${item.name}" cannot be removed: the Client Credentials grant needs one.`,
        );
      }

      if (data["oauthRefreshToken"] !== undefined) {
        if (item.oauthGrantType !== OAuth2GrantType.RefreshToken) {
          if (!isBlank(data["oauthRefreshToken"])) {
            throw new BadDataException(
              `"${item.name}" uses the ${item.oauthGrantType} grant, which does not use a refresh token.`,
            );
          }
        } else if (isBlank(data["oauthRefreshToken"])) {
          throw new BadDataException(
            `The refresh token of "${item.name}" cannot be removed: the Refresh Token grant needs one. Paste a new one to replace it.`,
          );
        }
      }
    }

    if (
      data["oauthClientSecret"] !== undefined &&
      isBlank(data["oauthClientSecret"])
    ) {
      // A Refresh Token variable becoming a public client.
      data["oauthClientSecret"] = null;
    }

    if (
      data["oauthRefreshToken"] !== undefined &&
      isBlank(data["oauthRefreshToken"])
    ) {
      delete data["oauthRefreshToken"];
    }

    const invalidateOAuthTokenForIds: Array<string> = [];

    for (const item of oauthItems) {
      const itemRecord: Record<string, unknown> = item as unknown as Record<
        string,
        unknown
      >;

      const changesSettings: boolean = OAUTH2_EDITABLE_SETTINGS_COLUMNS.some(
        (column: keyof Model) => {
          if (data[column as string] === undefined) {
            return false;
          }

          return (
            normalizeSettingForComparison(column, data[column as string]) !==
            normalizeSettingForComparison(column, itemRecord[column as string])
          );
        },
      );

      if (changesSettings && item.id) {
        invalidateOAuthTokenForIds.push(item.id.toString());
      }
    }

    return { invalidateOAuthTokenForIds };
  }

  /*
   * @UniqueColumnBy(["workflowId", "projectId"]) on `name` is enforced by
   * DatabaseService.checkUniqueColumnBy, which runs on create only - and there
   * is no unique index on WorkflowVariable to catch what it misses. That was
   * harmless while the dashboard offered no way to edit a variable. Now that it
   * does, a rename is the one write that can put two rows with the same name in
   * the same scope, and RunWorkflow.getVariables builds
   * `storageMap.local.variables[variable.name] = variable.content` - a plain
   * dictionary - so the second row would silently overwrite the first and
   * {{local.variables.X}} would resolve to whichever the query happened to
   * return last. Nothing would look broken; the workflow would just quietly run
   * on the wrong value.
   *
   * Two things this cannot close, both shared with the create-side guard it
   * mirrors: DatabaseService._updateBy skips every hook when props.ignoreHooks
   * is set, and check-then-write is not atomic, so two concurrent renames onto
   * the same free name can still both land. Closing either properly means a
   * unique index on (projectId, workflowId, LOWER(name)), which needs a dedupe
   * migration first because the racy create-side check may already have let
   * duplicates through.
   */
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    /*
     * Read through a plain JSON view: the typed partial of a model with a JSON
     * column (oauthAdditionalParameters) is recursive enough that TypeScript
     * gives up instantiating it (TS2589), and every value is checked by hand
     * below anyway.
     */
    const incoming: JSONObject = updateBy.data as unknown as JSONObject;

    const rawName: unknown = incoming["name"];

    /*
     * Only an update that does not carry the column at all is exempt. An
     * explicitly blank name is still a write to `name` - the column is
     * nullable: false but the empty string satisfies that, and update does not
     * re-run the required check - so two rows blanked in the same scope would
     * both become "" and collide like any other duplicate. Let it through to
     * the lookup rather than treating it as "no rename".
     */
    const isRename: boolean = rawName !== undefined && rawName !== null;

    /*
     * sanitizeUpdateData passes plain objects straight through, so `name` is
     * whatever the request body said it was. Reject a non-string here rather
     * than letting toLowerCase() throw a TypeError, which would surface as a
     * 500 and a stack trace instead of a 400 naming the field.
     */
    if (isRename && typeof rawName !== Typeof.String) {
      throw new BadDataException("Workflow variable name must be text.");
    }

    const newName: string = rawName as string;

    /*
     * Turning the secret flag OFF is the one direction that can expose
     * something. isSecret decides whether RunWorkflow replaces this variable's
     * value with [REDACTED] before a run log is persisted, and content itself
     * is unreadable through the API - so a caller who may write a variable but
     * may not read it could otherwise clear the flag, trigger a run, and read
     * the value out of the log. Marking a variable secret stays freely
     * available; unmarking one does not.
     */
    const isDeclassifying: boolean =
      incoming["isSecret"] !== undefined &&
      incoming["isSecret"] !== null &&
      !isSecretValue(incoming["isSecret"]);

    /*
     * Content and the OAuth columns mean different things for the two variable
     * types, so a write to either needs to know the type of every row it
     * touches. See applyOAuthUpdateRules.
     */
    const touchesTypeDependentColumns: boolean =
      incoming["content"] !== undefined ||
      OAUTH2_COLUMNS.some((column: keyof Model) => {
        return incoming[column as string] !== undefined;
      });

    if (!isRename && !isDeclassifying && !touchesTypeDependentColumns) {
      return { updateBy, carryForward: null };
    }

    /*
     * Read the rows this update will actually touch. Two things about this
     * query matter.
     *
     * It is scoped to the caller's tenant here rather than relying on the
     * permission layer, because _updateBy runs this hook BEFORE
     * ModelPermission.checkUpdateQueryPermissions - which is what appends the
     * project clause. Reading unscoped-as-root would make this hook answer
     * questions about another project's rows, and its refusal messages say
     * whether a variable is global and whether a name is taken. A caller
     * holding a variable id from a project they cannot see would get an oracle
     * before any authorization ran.
     *
     * isRoot inside that scope is still right: the conflicting row may be one
     * this caller cannot read - read access is label-gated - and a count that
     * cannot see it reports zero and waves the duplicate through.
     */
    const tenantId: ObjectID | undefined = updateBy.props.tenantId;

    const itemsBeingUpdated: Array<Model> = await this.findBy({
      query: tenantId
        ? { ...updateBy.query, projectId: tenantId }
        : updateBy.query,
      select: {
        _id: true,
        name: true,
        isSecret: true,
        projectId: true,
        workflowId: true,
        variableType: true,
        oauthGrantType: true,
        oauthTokenUrl: true,
        oauthClientId: true,
        oauthClientSecret: true,
        oauthRefreshToken: true,
        oauthScope: true,
        oauthAdditionalParameters: true,
        oauthClientAuthenticationMethod: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    if (isDeclassifying) {
      for (const item of itemsBeingUpdated) {
        if (isSecretValue(item.isSecret)) {
          throw new BadDataException(
            `"${item.name}" is marked secret, and a secret variable cannot be un-marked. Its value is redacted from workflow run logs, and clearing the flag would publish that value to the logs of every later run. Delete the variable and create it again if it should no longer be secret.`,
          );
        }
      }
    }

    const carryForward: UpdateCarryForward | null = touchesTypeDependentColumns
      ? this.applyOAuthUpdateRules(updateBy, itemsBeingUpdated)
      : null;

    if (!isRename) {
      return { updateBy, carryForward };
    }

    /*
     * Renaming two rows to one name is a conflict the database lookup below
     * cannot see: neither collides with anything that exists yet, they collide
     * with each other once both are written.
     */
    if (itemsBeingUpdated.length > 1) {
      throw new BadDataException(
        `Cannot rename ${itemsBeingUpdated.length} workflow variables to "${newName}" at once. Variable names must be unique.`,
      );
    }

    for (const item of itemsBeingUpdated) {
      /*
       * A no-op rename must stay a no-op. Compared case-insensitively because
       * that is how the uniqueness lookup compares, so "TOKEN" -> "token" is a
       * change of casing on the same row and not a collision with itself.
       */
      if (item.name && item.name.toLowerCase() === newName.toLowerCase()) {
        continue;
      }

      /*
       * The scope is what makes the lookup mean anything. projectId comes back
       * from the select above and is non-nullable on the table, so its absence
       * means the select or the row is wrong - and a missing projectId would
       * silently drop the clause and count this name across every project on
       * the instance. Refuse rather than answer the wrong question.
       */
      if (!item.projectId) {
        throw new BadDataException(
          "This workflow variable cannot be renamed because it is not attached to a project.",
        );
      }

      const conflictCount: number = (
        await this.countBy({
          query: {
            name: QueryHelper.findWithSameText(newName),
            projectId: item.projectId,
            /*
             * Global variables are the rows with a null workflowId, and they
             * share a namespace of their own. Querying `workflowId: undefined`
             * would drop the clause entirely and compare a global variable
             * against every workflow-local one in the project.
             */
            workflowId: item.workflowId
              ? item.workflowId
              : QueryHelper.isNull(),
            _id: QueryHelper.notEquals(item.id as ObjectID),
          },
          props: {
            isRoot: true,
          },
        })
      ).toNumber();

      if (conflictCount > 0) {
        throw new BadDataException(
          item.workflowId
            ? `A workflow variable named "${newName}" already exists on this workflow. Variable names must be unique within a workflow.`
            : `A global variable named "${newName}" already exists in this project. Global variable names must be unique.`,
        );
      }
    }

    return { updateBy, carryForward };
  }
}
export default new Service();
