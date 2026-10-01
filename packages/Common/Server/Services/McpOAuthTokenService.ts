import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/McpOAuthToken";
import OneUptimeDate from "../../Types/Date";
import McpOAuthTokenType from "../../Types/Mcp/McpOAuthTokenType";
import ObjectID from "../../Types/ObjectID";
import McpOAuthConfig from "../Utils/Mcp/McpOAuthConfig";
import McpOAuthSecret from "../Utils/Mcp/McpOAuthSecret";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export interface IssuedMcpOAuthAuthorizationCode {
  code: string;
  expiresAt: Date;
}

export interface IssuedMcpOAuthTokenPair {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

export class Service extends DatabaseService<Model> {
  /*
   * An expired credential is kept for a day and then deleted. It has to
   * outlive its expiry by a little: a consumed code or refresh token that is
   * presented again is how a leak is noticed, and that only works while the
   * row is still there to be found.
   */
  public static readonly EXPIRED_TOKEN_RETENTION_IN_DAYS: number = 1;

  public constructor() {
    super(Model);

    this.hardDeleteItemsOlderThanInDays(
      "expiresAt",
      Service.EXPIRED_TOKEN_RETENTION_IN_DAYS,
    );
  }

  /*
   * A new authorization code for a grant the member has just approved. The
   * PKCE challenge and the redirect URI are stored with it so the exchange
   * can hold the client to both.
   */
  @CaptureSpan()
  public async issueAuthorizationCode(data: {
    grantId: ObjectID;
    codeChallenge: string;
    redirectUri: string;
    now?: Date | undefined;
  }): Promise<IssuedMcpOAuthAuthorizationCode> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const code: string = McpOAuthSecret.mint(
      McpOAuthTokenType.AuthorizationCode,
    );
    const expiresAt: Date = OneUptimeDate.addRemoveSeconds(
      now,
      McpOAuthConfig.AUTHORIZATION_CODE_TTL_SECONDS,
    );

    const row: Model = new Model();
    row.mcpOAuthGrantId = data.grantId;
    row.tokenType = McpOAuthTokenType.AuthorizationCode;
    row.tokenHash = McpOAuthSecret.hash(code);
    row.expiresAt = expiresAt;
    row.codeChallenge = data.codeChallenge;
    row.redirectUri = data.redirectUri;

    await this.create({
      data: row,
      props: {
        isRoot: true,
      },
    });

    return { code, expiresAt };
  }

  // A new access token and refresh token for a grant.
  @CaptureSpan()
  public async issueTokenPair(data: {
    grantId: ObjectID;
    now?: Date | undefined;
  }): Promise<IssuedMcpOAuthTokenPair> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();

    const accessToken: string = McpOAuthSecret.mint(
      McpOAuthTokenType.AccessToken,
    );
    const refreshToken: string = McpOAuthSecret.mint(
      McpOAuthTokenType.RefreshToken,
    );

    const accessTokenExpiresAt: Date = OneUptimeDate.addRemoveSeconds(
      now,
      McpOAuthConfig.ACCESS_TOKEN_TTL_SECONDS,
    );
    const refreshTokenExpiresAt: Date = OneUptimeDate.addRemoveSeconds(
      now,
      McpOAuthConfig.REFRESH_TOKEN_TTL_SECONDS,
    );

    const accessTokenRow: Model = new Model();
    accessTokenRow.mcpOAuthGrantId = data.grantId;
    accessTokenRow.tokenType = McpOAuthTokenType.AccessToken;
    accessTokenRow.tokenHash = McpOAuthSecret.hash(accessToken);
    accessTokenRow.expiresAt = accessTokenExpiresAt;

    const refreshTokenRow: Model = new Model();
    refreshTokenRow.mcpOAuthGrantId = data.grantId;
    refreshTokenRow.tokenType = McpOAuthTokenType.RefreshToken;
    refreshTokenRow.tokenHash = McpOAuthSecret.hash(refreshToken);
    refreshTokenRow.expiresAt = refreshTokenExpiresAt;

    await this.create({
      data: accessTokenRow,
      props: {
        isRoot: true,
      },
    });

    await this.create({
      data: refreshTokenRow,
      props: {
        isRoot: true,
      },
    });

    return {
      accessToken,
      accessTokenExpiresAt,
      refreshToken,
      refreshTokenExpiresAt,
    };
  }

  /*
   * The row behind a presented secret, or null. Expiry and consumption are
   * NOT filtered here: the caller has to tell "never existed" from "expired"
   * from "already used", because each of those is answered differently.
   *
   * The shape guard comes first, so a value that could not be one of our
   * secrets - including one of the right kind presented as the wrong kind -
   * never reaches the database.
   */
  @CaptureSpan()
  public async findBySecret(data: {
    secret: unknown;
    tokenType: McpOAuthTokenType;
  }): Promise<Model | null> {
    if (!McpOAuthSecret.isValidShape(data.secret, data.tokenType)) {
      return null;
    }

    return await this.findOneBy({
      query: {
        tokenHash: McpOAuthSecret.hash(data.secret),
        tokenType: data.tokenType,
      },
      select: {
        _id: true,
        mcpOAuthGrantId: true,
        tokenType: true,
        expiresAt: true,
        consumedAt: true,
        codeChallenge: true,
        redirectUri: true,
      },
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * Claim a single-use credential. True for exactly one caller: the check
   * ("not consumed yet") and the write are one statement, so two requests
   * racing with the same code or refresh token cannot both be told yes.
   */
  @CaptureSpan()
  public async claim(data: {
    tokenId: ObjectID;
    now?: Date | undefined;
  }): Promise<boolean> {
    return await this.compareAndSetColumnsByIdWithoutHooks({
      id: data.tokenId,
      data: {
        consumedAt: data.now || OneUptimeDate.getCurrentDate(),
      },
      expectedData: {
        /*
         * The model types the column as an optional Date; null is what an
         * unconsumed row holds, and the guard compares null-safely.
         */
        consumedAt: null as unknown as Date,
      },
      skipUpdateDateColumn: true,
    });
  }

  public static isExpired(token: Model, now?: Date | undefined): boolean {
    if (!token.expiresAt) {
      return true;
    }

    return (
      new Date(token.expiresAt).getTime() <=
      (now || OneUptimeDate.getCurrentDate()).getTime()
    );
  }
}

export default new Service();
