import { listProductFiles } from "../../Helpers/CodeScanning";
import { REPOSITORY_DIRECTORY } from "../../Helpers/TagStripScan";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * NOTHING SIGNS OR CHECKS A TOKEN WITH ENCRYPTION_SECRET BUT TokenSigningKey.
 *
 * On an installation whose ENCRYPTION_SECRET is unset or still a value this
 * repository ships, that secret is public. A token signed with it - a JWT, or
 * any HMAC a request presents as proof - is one anybody can make, so every
 * such signature goes through TokenSigningKey, which is ENCRYPTION_SECRET only
 * when the operator chose it and otherwise a key the installation generated
 * for itself.
 *
 * What may still use ENCRYPTION_SECRET directly is what protects STORED
 * data - the encrypted columns, the peppered and keyed digests - because
 * changing that key would make what is stored unreadable, and a public key
 * there costs only what a copy of the database already gives away. Each such
 * file is listed below with what it protects. A new file that reads
 * ENCRYPTION_SECRET fails this guard until it is sorted: a signature a
 * request presents uses TokenSigningKey; something stored is listed here.
 *
 * Read from the code with its comments removed, across all product code
 * (ee/ too, when it is checked out).
 */

/*
 * Every product file that may read EncryptionSecret, with what it protects.
 * All of them are about stored data; none is a token anybody presents.
 */
const STORED_DATA_USES: Record<string, string> = {
  "packages/Common/Server/EnvironmentConfig.ts":
    "defines it, and decides whether it is a value the repository ships",
  "packages/Common/Server/Utils/TokenSigningKey.ts":
    "signs with it only when the operator chose it",
  "packages/Common/Server/Utils/Encryption.ts":
    "encrypts the @TableColumn({ encrypted: true }) columns",
  "packages/Common/Server/Utils/PasswordHash.ts":
    "peppers the stored password hashes",
  "packages/Common/Server/Services/DatabaseService.ts":
    "keys the digests of hashed columns",
  "packages/Common/Server/Utils/VerificationCode.ts":
    "keys the stored digests of channel verification codes",
  "packages/Common/Server/Utils/TwoFactorBackupCode.ts":
    "keys the stored digests of two-factor backup codes",
  "packages/Common/Server/Services/UserSessionService.ts":
    "keys the stored digests of refresh tokens",
  "packages/Common/Server/Services/StatusPagePrivateUserSessionService.ts":
    "keys the stored digests of status page refresh tokens and login codes",
  "packages/Common/Server/Services/UserService.ts":
    "keys the stored digest of a password reset token",
  "packages/Common/Server/Services/StatusPagePrivateUserService.ts":
    "keys the stored digest of a status page password reset token",
  "packages/App/FeatureSet/Identity/API/Authentication.ts":
    "keys the stored digest of a password reset token",
  "packages/App/FeatureSet/Identity/API/StatusPageAuthentication.ts":
    "keys the stored digest of a status page password reset token",
  // A dashboard's and a form's private users (#10250, #10249).
  "packages/Common/Server/Services/PrivateUserServiceBase.ts":
    "keys the stored digest of a dashboard's or a form's private user's invitation and password reset token",
  "packages/Common/Server/Services/PrivateUserSessionServiceBase.ts":
    "keys the stored digests of a dashboard's or a form's private users' refresh tokens and single sign-on codes",
  "packages/App/FeatureSet/Identity/API/DashboardPrivateUserAuthentication.ts":
    "keys the stored digest of a dashboard private user's password reset token",
  "packages/App/FeatureSet/Identity/API/FormPrivateUserAuthentication.ts":
    "keys the stored digest of a form private user's password reset token",
  "packages/Common/Server/Utils/Rules/EpisodeGroupingKey.ts":
    "keys the stored episode grouping keys, which existing episodes match on",
  "packages/Common/Server/Utils/SessionReplay/SessionReplayIdentity.ts":
    "keys the stored digests of session replay user references",
  "packages/Common/Server/Utils/SessionReplay/SessionReplayTargeting.ts":
    "keys the Redis names of session replay targets, so they are no directory of users",
  "packages/App/FeatureSet/Notification/Services/SMTPOAuthService.ts":
    "keys the Redis names of cached SMTP OAuth tokens, so Redis holds no client secret",
  "packages/Common/Server/Utils/DataSecurity/DataSecurityRunner.ts":
    "keys the stored Data Security fingerprints of a project's sensitive values, so they compare only within the project and reveal no value",
  "packages/Common/Server/Utils/ServerSending/ServerSendingSettings.ts":
    "keys the stored fingerprints of the settings the server's email, SMS and calls go out with (GlobalConfig.serverSendingHealth), so they reveal no mail server, Twilio or gateway credential",
  "packages/Common/Server/Utils/APIKey/HashedApiKey.ts":
    "keys the stored digests of the master API key and every project's API keys (#7901, #8902), which a request's key is looked up by",
  "packages/Common/Server/Utils/PresentedKey/PresentedKey.ts":
    "keys the stored lookup hashes of the keys presented to OneUptime and the stored hashes of SCIM bearer tokens (#9012), which a request's key or token is looked up by",
};

/*
 * The modules that sign or check what a request presents. Each signs with
 * TokenSigningKey, and none reads ENCRYPTION_SECRET.
 */
const TOKEN_SIGNERS: Array<string> = [
  "packages/Common/Server/Utils/JsonWebToken.ts",
  "packages/Common/Server/Utils/Mcp/McpOAuthSignedToken.ts",
  "packages/App/FeatureSet/Identity/Utils/VerificationEmailResendToken.ts",
  "packages/App/FeatureSet/Identity/Utils/ProjectSsoSignInConfirmation.ts",
  // The proof a custom domain's readiness check sends to its CNAME target.
  "packages/Common/Server/Utils/CustomDomain/CustomDomainServerReadiness.ts",
  /*
   * The cluster key an installation whose ONEUPTIME_SECRET is a shipped
   * value presents between its own services is derived from it.
   */
  "packages/Common/Server/Middleware/ClusterKeyAuthorization.ts",
];

/*
 * The modules that use the JWT library. JsonWebToken signs and checks
 * OneUptime's own tokens.
 */
const JSON_WEB_TOKEN: string = "packages/Common/Server/Utils/JsonWebToken.ts";

/*
 * These sign assertions for Google with a service account's own private key
 * (RS256), and check none. (Google Cloud Marketplace's client, in ee/, signs
 * its assertions through JsonWebToken.signWithPrivateKey.)
 */
const GOOGLE_ASSERTION_SIGNERS: Array<string> = [
  "packages/Common/Server/Utils/VideoCall/Providers/GoogleMeetClient.ts",
  "packages/Common/Server/Utils/SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsClient.ts",
  // The Google Workspace connection, acting as an administrator (domain-wide delegation).
  "packages/Common/Server/Utils/SecurityEvent/Connectors/GoogleWorkspace/GoogleWorkspaceClient.ts",
  // AI / LLM observability's Google Vertex AI connection (Cloud Monitoring).
  "packages/Common/Server/Utils/LlmObservability/Connectors/GoogleVertexAI/GoogleServiceAccountToken.ts",
];

/*
 * These check tokens a vendor signed (Microsoft Entra ID, Google Cloud
 * Marketplace, Google's Pub/Sub pushes) with the keys the vendor publishes,
 * RS256 only, and sign none.
 */
const VENDOR_TOKEN_VERIFIERS: Array<string> = [
  "packages/Common/Server/Utils/Marketplace/RemoteJwtVerifier.ts",
];

const JWT_LIBRARY_USERS: Array<string> = [
  JSON_WEB_TOKEN,
  ...GOOGLE_ASSERTION_SIGNERS,
  ...VENDOR_TOKEN_VERIFIERS,
];

const ENCRYPTION_SECRET_IDENTIFIER: RegExp = /\bEncryptionSecret\b/;
const ENCRYPTION_SECRET_VARIABLE_READ: RegExp =
  /process\.env(?:\[\s*["'`]ENCRYPTION_SECRET["'`]\s*\]|\.ENCRYPTION_SECRET\b)/;
const JWT_LIBRARY_IMPORT: RegExp =
  /(?:from\s+["']jsonwebtoken["']|require\(\s*["']jsonwebtoken["']\s*\))/;
const TOKEN_SIGNING_KEY_USE: RegExp = /\bTokenSigningKey\.(?:get|deriveKey)\(/;
const CODE_FILE: RegExp = /\.(?:ts|tsx)$/;
const JWT_SIGN_CALL: RegExp = /\bjwt\.sign\(/g;
const JWT_VERIFY_CALL: RegExp = /\bjwt\.verify\(/g;

const hasEe: boolean = fs.existsSync(path.join(REPOSITORY_DIRECTORY, "ee"));

function visit(node: ts.Node, onNode: (node: ts.Node) => void): void {
  onNode(node);
  ts.forEachChild(node, (child: ts.Node): void => {
    visit(child, onNode);
  });
}

// `jwt.<method>(...)`.
function isJwtCall(node: ts.Node, method: string): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "jwt" &&
    node.expression.name.text === method
  );
}

function sourceOfText(text: string): ts.SourceFile {
  return ts.createSourceFile(
    "JsonWebToken.ts",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

// A node's code, its runs of whitespace as one space.
function written(node: ts.Node, source: ts.SourceFile): string {
  return node.getText(source).replace(/\s+/g, " ");
}

/*
 * The key JsonWebToken checks every one of OneUptime's own tokens with: the
 * key object jsonwebtoken would make of TokenSigningKey's key, made once
 * (JsonWebTokenKeys, held below to the key it is given).
 */
const VERIFYING_KEY: string =
  "JsonWebTokenKeys.forVerifying(TokenSigningKey.get()) as jwt.Secret";

/*
 * The one option the verify may be handed, and only as the caller asked for
 * it: to take a token past its expiry (DecodeOptions.acceptExpired, which
 * TokenPurposeGuard holds to the sign-out's read of a session, issue #8592).
 * An expiry is no part of a signature, so the token is checked with
 * TokenSigningKey alone either way.
 */
function isExpiryWaiverTheCallerAsks(
  node: ts.Expression,
  source: ts.SourceFile,
): boolean {
  if (!ts.isConditionalExpression(node)) {
    return false;
  }

  const waiver: ts.Expression = node.whenTrue;

  return (
    written(node.condition, source) === "options?.acceptExpired" &&
    ts.isObjectLiteralExpression(waiver) &&
    waiver.properties.length === 1 &&
    ts.isPropertyAssignment(waiver.properties[0]!) &&
    ts.isIdentifier(waiver.properties[0].name) &&
    waiver.properties[0].name.text === "ignoreExpiration" &&
    waiver.properties[0].initializer.kind === ts.SyntaxKind.TrueKeyword &&
    ts.isIdentifier(node.whenFalse) &&
    node.whenFalse.text === "undefined"
  );
}

/*
 * Why JsonWebToken's check of a token, as written in `text`, does not check
 * it with TokenSigningKey alone - none when it does. There is one jwt.verify,
 * in decodeJsonPayload, handed the token, TokenSigningKey's key object and at
 * most the expiry waiver its caller asks for (DecodeOptions). Nothing that
 * changes how the signature is checked: no `algorithms`, which would let the
 * token choose how it is checked, no `allowInvalidAsymmetricKeyTypes`, no
 * options object handed through, and no waiver for every token.
 */
function verifyRefusals(text: string): Array<string> {
  const source: ts.SourceFile = sourceOfText(text);
  const calls: Array<ts.CallExpression> = [];

  visit(source, (node: ts.Node): void => {
    if (isJwtCall(node, "verify")) {
      calls.push(node);
    }
  });

  if (calls.length !== 1) {
    return [`${calls.length} calls of jwt.verify, not one`];
  }

  const call: ts.CallExpression = calls[0]!;
  const [token, key, options, ...more] = call.arguments;
  const refusals: Array<string> = [];

  let method: ts.Node | undefined = call.parent;

  while (method && !ts.isMethodDeclaration(method)) {
    method = method.parent;
  }

  if (
    !method ||
    !ts.isMethodDeclaration(method) ||
    !ts.isIdentifier(method.name) ||
    method.name.text !== "decodeJsonPayload"
  ) {
    refusals.push("it is not in decodeJsonPayload");
  } else if (
    !method.parameters.some((parameter: ts.ParameterDeclaration): boolean => {
      return (
        ts.isIdentifier(parameter.name) &&
        parameter.name.text === "options" &&
        Boolean(parameter.type) &&
        written(parameter.type!, source) === "DecodeOptions"
      );
    })
  ) {
    refusals.push("its options are not its caller's DecodeOptions");
  }

  if (!token || !ts.isIdentifier(token) || token.text !== "token") {
    refusals.push("it checks something other than the token handed in");
  }

  if (!key || written(key, source) !== VERIFYING_KEY) {
    refusals.push(
      `it checks with ${key ? written(key, source) : "no key"}, not TokenSigningKey's key object`,
    );
  }

  if (options && !isExpiryWaiverTheCallerAsks(options, source)) {
    refusals.push(
      `it is handed ${written(options, source)}, not just the expiry waiver its caller asks for`,
    );
  }

  if (more.length > 0) {
    refusals.push(`it is handed ${more.length} more arguments`);
  }

  return refusals;
}

// The code of a file, its comments removed by TypeScript's own printer.
function codeOf(relativePath: string): string {
  const source: string = fs.readFileSync(
    path.join(REPOSITORY_DIRECTORY, relativePath),
    "utf8",
  );
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    path.basename(relativePath),
    source,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  return ts.createPrinter({ removeComments: true }).printFile(sourceFile);
}

/*
 * Product code files whose raw text matches `pattern` (a cheap first pass),
 * then whose code does, comments removed.
 */
function productFilesWhoseCodeMatches(pattern: RegExp): Array<string> {
  return listProductFiles(REPOSITORY_DIRECTORY, ["packages", "ee"])
    .filter((relativePath: string): boolean => {
      return CODE_FILE.test(relativePath);
    })
    .filter((relativePath: string): boolean => {
      return pattern.test(
        fs.readFileSync(path.join(REPOSITORY_DIRECTORY, relativePath), "utf8"),
      );
    })
    .filter((relativePath: string): boolean => {
      return pattern.test(codeOf(relativePath));
    });
}

describe("ENCRYPTION_SECRET is read only to protect stored data", () => {
  const readers: Array<string> = productFilesWhoseCodeMatches(
    ENCRYPTION_SECRET_IDENTIFIER,
  );

  test("every product file that reads it is one listed, with what it protects", () => {
    const unlisted: Array<string> = readers.filter(
      (relativePath: string): boolean => {
        return !(relativePath in STORED_DATA_USES);
      },
    );

    /*
     * A file here signs or protects something with ENCRYPTION_SECRET that
     * this guard has not been told about. If a request presents what it
     * signs, sign with TokenSigningKey.get() (or deriveKey); if it protects
     * something stored, list it above with what it protects.
     */
    expect(unlisted).toEqual([]);
  });

  test("every listed file still reads it, so the list stays true", () => {
    const stale: Array<string> = Object.keys(STORED_DATA_USES).filter(
      (relativePath: string): boolean => {
        return !readers.includes(relativePath);
      },
    );

    expect(stale).toEqual([]);
  });

  test("only EnvironmentConfig reads the ENCRYPTION_SECRET variable itself", () => {
    expect(
      productFilesWhoseCodeMatches(ENCRYPTION_SECRET_VARIABLE_READ),
    ).toEqual(["packages/Common/Server/EnvironmentConfig.ts"]);
  });

  test("the guard reads ee/ too when it is checked out", () => {
    const eeFiles: Array<string> = listProductFiles(REPOSITORY_DIRECTORY, [
      "ee",
    ]);

    expect(eeFiles.length > 0).toBe(hasEe);
  });
});

describe("what a request presents is signed with TokenSigningKey", () => {
  test.each(TOKEN_SIGNERS)(
    "%s signs with TokenSigningKey and never with ENCRYPTION_SECRET",
    (relativePath: string) => {
      const code: string = codeOf(relativePath);

      expect(code).toMatch(TOKEN_SIGNING_KEY_USE);
      expect(code).not.toMatch(ENCRYPTION_SECRET_IDENTIFIER);
    },
  );

  test("only the listed modules use the JWT library", () => {
    expect(productFilesWhoseCodeMatches(JWT_LIBRARY_IMPORT)).toEqual(
      [...JWT_LIBRARY_USERS].sort(),
    );
  });

  test("JsonWebToken signs and checks OneUptime's own tokens with TokenSigningKey alone", () => {
    const code: string = codeOf("packages/Common/Server/Utils/JsonWebToken.ts");

    /*
     * Through the key object jsonwebtoken would make of the key, made once
     * (JsonWebTokenKeys, held below to the key it is given).
     */
    expect(code).toContain(
      "jwt.sign(payload, JsonWebTokenKeys.forSigning(TokenSigningKey.get()) as jwt.Secret, {",
    );
    /*
     * Checked with that key alone, taking at most the expiry waiver a
     * caller asks for, and nothing that changes how a signature is checked.
     */
    expect(
      verifyRefusals(
        fs.readFileSync(
          path.join(REPOSITORY_DIRECTORY, JSON_WEB_TOKEN),
          "utf8",
        ),
      ),
    ).toEqual([]);
    // The one other signing call: RS256, with the caller's private key.
    expect(code).toContain("jwt.sign(payload, privateKey, {");
    expect(code.match(JWT_SIGN_CALL)).toHaveLength(2);
    expect(code.match(JWT_VERIFY_CALL)).toHaveLength(1);
  });

  test("JsonWebTokenKeys makes a key object of the key it is given, and of nothing else", () => {
    const code: string = codeOf(
      "packages/Common/Server/Utils/JsonWebTokenKeys.ts",
    );

    // No key of its own: neither TokenSigningKey nor ENCRYPTION_SECRET.
    expect(code).not.toMatch(TOKEN_SIGNING_KEY_USE);
    expect(code).not.toMatch(ENCRYPTION_SECRET_IDENTIFIER);
    expect(code).not.toContain("EnvironmentConfig");
    expect(code).not.toContain("process.env");
    // Only the conversions jsonwebtoken makes, of the text it is handed.
    expect(code).toContain("crypto.createPrivateKey(text)");
    expect(code).toContain("crypto.createPublicKey(text)");
    expect(code).toContain("crypto.createSecretKey(Buffer.from(text))");
    expect(code.match(JWT_SIGN_CALL)).toBeNull();
    expect(code.match(JWT_VERIFY_CALL)).toBeNull();
  });

  test("the Google clients sign with a private key, and verify nothing", () => {
    for (const relativePath of GOOGLE_ASSERTION_SIGNERS) {
      const code: string = codeOf(relativePath);

      expect({ relativePath, rs256: code.includes('"RS256"') }).toEqual({
        relativePath,
        rs256: true,
      });
      expect({ relativePath, verifies: code.includes("jwt.verify(") }).toEqual({
        relativePath,
        verifies: false,
      });
      expect(code).not.toMatch(TOKEN_SIGNING_KEY_USE);
    }
  });

  test("the vendor token verifiers check RS256 tokens with the vendor's keys, and sign nothing", () => {
    for (const relativePath of VENDOR_TOKEN_VERIFIERS) {
      const code: string = codeOf(relativePath);

      // The token never chooses its algorithm: "alg: none" and HMAC-with-the-public-key start there.
      expect({
        relativePath,
        rs256Only: code.includes('algorithms: ["RS256"]'),
      }).toEqual({ relativePath, rs256Only: true });
      expect({ relativePath, signs: code.includes("jwt.sign(") }).toEqual({
        relativePath,
        signs: false,
      });
      expect(code.match(JWT_VERIFY_CALL)).toHaveLength(1);
      expect(code).not.toMatch(TOKEN_SIGNING_KEY_USE);
      expect(code).not.toMatch(ENCRYPTION_SECRET_IDENTIFIER);
    }
  });
});

/*
 * The check above allows the verify one option - the expiry waiver a caller
 * asks for, #8592's sign-out read - and nothing else (issue #8673). Run on
 * JsonWebToken as it is, with its one jwt.verify written another way, it
 * refuses every other way of handing the verify a key or an option.
 */
describe("JsonWebToken's verify may waive an expiry its caller asks to, and nothing else", () => {
  const actual: string = fs.readFileSync(
    path.join(REPOSITORY_DIRECTORY, JSON_WEB_TOKEN),
    "utf8",
  );

  // JsonWebToken with its one jwt.verify(...) written as `call`.
  function withVerify(call: string): string {
    const source: ts.SourceFile = sourceOfText(actual);
    let found: ts.CallExpression | null = null;

    visit(source, (node: ts.Node): void => {
      if (!found && isJwtCall(node, "verify")) {
        found = node;
      }
    });

    const verify: ts.CallExpression = found!;

    return `${actual.slice(0, verify.getStart(source))}${call}${actual.slice(verify.getEnd())}`;
  }

  const KEY: string = VERIFYING_KEY;

  test("as it is: the token, TokenSigningKey's key object, and the waiver only when its caller asks", () => {
    expect(verifyRefusals(actual)).toEqual([]);
  });

  test("without the waiver at all, as before #8592: allowed", () => {
    expect(verifyRefusals(withVerify(`jwt.verify(token, ${KEY})`))).toEqual([]);
  });

  test.each([
    {
      name: "the expiry waived for every token",
      call: `jwt.verify(token, ${KEY}, { ignoreExpiration: true })`,
    },
    {
      name: "the expiry waived for every token that did not ask",
      call: `jwt.verify(token, ${KEY}, !options?.acceptExpired ? { ignoreExpiration: true } : undefined)`,
    },
    {
      name: "the waiver decided by something other than its caller",
      call: `jwt.verify(token, ${KEY}, process.env["ACCEPT_EXPIRED"] ? { ignoreExpiration: true } : undefined)`,
    },
    {
      name: "the caller's options handed through",
      call: `jwt.verify(token, ${KEY}, options)`,
    },
    {
      name: "the caller's options spread into the waiver",
      call: `jwt.verify(token, ${KEY}, options?.acceptExpired ? { ...options } : undefined)`,
    },
    {
      name: "the algorithms the token may choose",
      call: `jwt.verify(token, ${KEY}, { algorithms: ["HS256", "none"] })`,
    },
    {
      name: "algorithms beside the waiver",
      call: `jwt.verify(token, ${KEY}, options?.acceptExpired ? { ignoreExpiration: true, algorithms: ["none"] } : undefined)`,
    },
    {
      name: "algorithms when the caller does not ask",
      call: `jwt.verify(token, ${KEY}, options?.acceptExpired ? { ignoreExpiration: true } : { algorithms: ["RS256"] })`,
    },
    {
      name: "another waiver in its place",
      call: `jwt.verify(token, ${KEY}, options?.acceptExpired ? { ignoreNotBefore: true } : undefined)`,
    },
    {
      name: "keys of a kind the algorithm is not for",
      call: `jwt.verify(token, ${KEY}, { allowInvalidAsymmetricKeyTypes: true })`,
    },
    {
      name: "ENCRYPTION_SECRET for the key",
      call: "jwt.verify(token, EncryptionSecret as jwt.Secret)",
    },
    {
      name: "TokenSigningKey's text, not its key object",
      call: "jwt.verify(token, TokenSigningKey.get() as jwt.Secret)",
    },
    {
      name: "a callback besides",
      call: `jwt.verify(token, ${KEY}, undefined, () => {})`,
    },
  ])("refused: $name", ({ call }: { call: string }) => {
    expect(verifyRefusals(withVerify(call)).length).toBeGreaterThan(0);
  });

  test("refused: a second jwt.verify, wherever it is", () => {
    expect(
      verifyRefusals(
        `${actual}\nexport const second: unknown = jwt.verify("token", "key");\n`,
      ),
    ).toEqual(["2 calls of jwt.verify, not one"]);
  });
});
