import Semaphore, { SemaphoreMutex } from "../../Infrastructure/Semaphore";
import WorkflowVariableService from "../../Services/WorkflowVariableService";
import logger from "../Logger";
import OAuth2TokenClient, {
  OAuth2TokenRequestConfig,
  OAuth2TokenRequestException,
  OAuth2TokenResult,
} from "./OAuth2TokenClient";
import WorkflowVariable from "../../../Models/DatabaseModels/WorkflowVariable";
import QueryDeepPartialEntity from "../../../Types/Database/PartialEntity";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import ObjectID from "../../../Types/ObjectID";
import {
  OAuth2GrantType,
  isOAuth2AccessTokenUsable,
  isOAuth2WorkflowVariable,
  normalizeOAuth2AdditionalParameters,
  toDateOrNull,
} from "../../../Types/Workflow/WorkflowVariableOAuth";

/*
 * Hands out a current access token for an OAuth 2.0 workflow variable,
 * fetching a new one from the identity provider only when the cached one will
 * not do.
 *
 * Two callers: the workflow runner, right before a step that refers to the
 * variable runs, and the dashboard's "Refresh now" button. Both go through
 * getAccessToken, so there is one place that decides whether to refresh, one
 * place that writes the result, and one lock.
 *
 * The lock matters more than it looks. Many runs of many workflows can use the
 * same global variable at the same moment, and with the Refresh Token grant
 * most providers ROTATE the refresh token: the exchange that succeeds
 * invalidates the token it used. Two concurrent refreshes would both send the
 * same refresh token, one would win, and the other would get invalid_grant and
 * could overwrite the winner's fresh refresh token with nothing useful. So a
 * refresh holds a Redis mutex per variable, and whoever waited for it re-reads
 * the row first: if the holder already stored a usable token, the waiter uses
 * that one and makes no request at all.
 */

export interface WorkflowVariableAccessToken {
  accessToken: string;
  expiresAt: Date | null;
  refreshedAt: Date | null;
  // True when this call fetched the token rather than reusing the cached one.
  didRefresh: boolean;
}

export const WORKFLOW_VARIABLE_OAUTH_LOCK_NAMESPACE: string =
  "workflow-variable-oauth-token";

/*
 * Longer than one token request (OAUTH2_TOKEN_REQUEST_TIMEOUT_IN_MS, 20s), so a
 * waiter outlasts the refresh it is waiting on. redis-semaphore keeps
 * extending a held lock, so lockTimeout only bounds how long a crashed holder
 * can block everyone else.
 */
const LOCK_TIMEOUT_IN_MS: number = 30 * 1000;
const LOCK_ACQUIRE_TIMEOUT_IN_MS: number = 30 * 1000;
const LOCK_RETRY_INTERVAL_IN_MS: number = 100;

// What the refresh error column keeps.
const MAX_REFRESH_ERROR_LENGTH: number = 2000;

export default class WorkflowVariableOAuthToken {
  public static async getAccessToken(data: {
    variableId: ObjectID;
    // Ignore the cached token and always ask the identity provider.
    forceRefresh?: boolean | undefined;
    /*
     * A cached token whose expiry is unknown is reused only if it was fetched
     * at or after this moment. See isOAuth2AccessTokenUsable.
     */
    acceptTokenRefreshedAtOrAfter?: Date | null | undefined;
    timeoutInMs?: number | undefined;
  }): Promise<WorkflowVariableAccessToken> {
    const mutex: SemaphoreMutex | null = await WorkflowVariableOAuthToken.lock(
      data.variableId,
    );

    try {
      const variable: WorkflowVariable | null =
        await WorkflowVariableService.findOneById({
          id: data.variableId,
          select: {
            _id: true,
            name: true,
            variableType: true,
            oauthGrantType: true,
            oauthTokenUrl: true,
            oauthClientId: true,
            oauthClientSecret: true,
            oauthRefreshToken: true,
            oauthScope: true,
            oauthAdditionalParameters: true,
            oauthClientAuthenticationMethod: true,
            oauthAccessToken: true,
            oauthAccessTokenExpiresAt: true,
            oauthLastRefreshedAt: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!variable) {
        throw new BadDataException("Workflow variable not found.");
      }

      if (!isOAuth2WorkflowVariable(variable.variableType)) {
        throw new BadDataException(
          `"${variable.name || "This variable"}" is not an OAuth 2.0 variable, so it has no access token to refresh.`,
        );
      }

      if (
        !data.forceRefresh &&
        variable.oauthAccessToken &&
        isOAuth2AccessTokenUsable({
          state: {
            hasAccessToken: true,
            accessTokenExpiresAt: variable.oauthAccessTokenExpiresAt,
            lastRefreshedAt: variable.oauthLastRefreshedAt,
          },
          now: new Date(),
          acceptTokenRefreshedAtOrAfter: data.acceptTokenRefreshedAtOrAfter,
        })
      ) {
        return {
          accessToken: variable.oauthAccessToken,
          expiresAt: toDateOrNull(variable.oauthAccessTokenExpiresAt),
          refreshedAt: toDateOrNull(variable.oauthLastRefreshedAt),
          didRefresh: false,
        };
      }

      return await WorkflowVariableOAuthToken.refresh(
        variable,
        data.timeoutInMs,
      );
    } finally {
      if (mutex) {
        try {
          await Semaphore.release(mutex);
        } catch (err) {
          /*
           * The lock expires on its own; failing the caller's token over a
           * release that did not reach Redis would throw away a good token.
           */
          logger.warn(
            `Could not release the OAuth token lock for workflow variable ${data.variableId.toString()}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    }
  }

  public static getTokenRequestConfig(
    variable: WorkflowVariable,
  ): OAuth2TokenRequestConfig {
    return {
      grantType: variable.oauthGrantType as OAuth2GrantType,
      tokenUrl: variable.oauthTokenUrl ? variable.oauthTokenUrl.toString() : "",
      clientId: variable.oauthClientId || "",
      clientSecret: variable.oauthClientSecret || undefined,
      refreshToken: variable.oauthRefreshToken || undefined,
      scope: variable.oauthScope || undefined,
      additionalParameters: normalizeOAuth2AdditionalParameters(
        variable.oauthAdditionalParameters,
      ),
      clientAuthenticationMethod:
        variable.oauthClientAuthenticationMethod || undefined,
    };
  }

  private static async refresh(
    variable: WorkflowVariable,
    timeoutInMs: number | undefined,
  ): Promise<WorkflowVariableAccessToken> {
    const variableId: ObjectID = variable.id!;

    let result: OAuth2TokenResult;

    try {
      result = await OAuth2TokenClient.requestToken(
        WorkflowVariableOAuthToken.getTokenRequestConfig(variable),
        { timeoutInMs },
      );
    } catch (err) {
      const failure: OAuth2TokenRequestException =
        err instanceof OAuth2TokenRequestException
          ? err
          : new OAuth2TokenRequestException(
              err instanceof Exception || err instanceof Error
                ? err.message
                : "The token request failed.",
            );

      await WorkflowVariableOAuthToken.recordFailure(
        variableId,
        failure.message,
      );

      throw failure;
    }

    const refreshedAt: Date = new Date();

    /*
     * A plain record cast once, because the typed partial of this model (it
     * has a JSON column) is too deep for TypeScript to instantiate (TS2589).
     *
     * isRoot + ignoreHooks: this is OneUptime writing columns nobody may write
     * through the API (the token, its expiry, the refresh bookkeeping), and the
     * service's update hook would read a change to the OAuth settings as a
     * reason to throw the new token away. ignoreHooks does not skip encryption
     * - _updateBy encrypts outside the hook branch - so the token and a rotated
     * refresh token are stored encrypted like every other secret column.
     */
    const data: Record<string, unknown> = {
      oauthAccessToken: result.accessToken,
      oauthAccessTokenExpiresAt: result.expiresAt,
      oauthLastRefreshedAt: refreshedAt,
      oauthLastRefreshError: null,
      oauthLastRefreshErrorAt: null,
    };

    /*
     * Only replace the refresh token when the provider sent a new one. RFC 6749
     * section 6 lets it keep the old one valid and say nothing, and clearing
     * the stored token then would break every later refresh.
     */
    if (
      result.refreshToken &&
      result.refreshToken !== variable.oauthRefreshToken
    ) {
      data["oauthRefreshToken"] = result.refreshToken;
    }

    await WorkflowVariableService.updateOneById({
      id: variableId,
      data: data as QueryDeepPartialEntity<WorkflowVariable>,
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    return {
      accessToken: result.accessToken,
      expiresAt: result.expiresAt,
      refreshedAt,
      didRefresh: true,
    };
  }

  /*
   * Best effort. The caller is already failing with the real reason, and a
   * write that could not be made must not replace it with a database error.
   */
  private static async recordFailure(
    variableId: ObjectID,
    message: string,
  ): Promise<void> {
    try {
      await WorkflowVariableService.updateOneById({
        id: variableId,
        data: {
          oauthLastRefreshError: message.substring(0, MAX_REFRESH_ERROR_LENGTH),
          oauthLastRefreshErrorAt: new Date(),
        } as QueryDeepPartialEntity<WorkflowVariable>,
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });
    } catch (err) {
      logger.error(
        `Could not record the OAuth token refresh failure for workflow variable ${variableId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /*
   * Without Redis there is no cross-process lock to take, and failing every
   * run that uses the variable would be worse than the rare double refresh an
   * unlocked request risks - so the refresh goes ahead unlocked. The same goes
   * for a lock that could not be acquired in time: whoever holds it has been at
   * it longer than a token request can take.
   */
  private static async lock(
    variableId: ObjectID,
  ): Promise<SemaphoreMutex | null> {
    try {
      return await Semaphore.lock({
        key: variableId.toString(),
        namespace: WORKFLOW_VARIABLE_OAUTH_LOCK_NAMESPACE,
        lockTimeout: LOCK_TIMEOUT_IN_MS,
        acquireTimeout: LOCK_ACQUIRE_TIMEOUT_IN_MS,
        retryInterval: LOCK_RETRY_INTERVAL_IN_MS,
      });
    } catch (err) {
      logger.warn(
        `Refreshing the OAuth token of workflow variable ${variableId.toString()} without a lock: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );

      return null;
    }
  }
}
