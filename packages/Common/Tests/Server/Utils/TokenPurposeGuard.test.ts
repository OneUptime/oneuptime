import { listProductFiles } from "../../Helpers/CodeScanning";
import { REPOSITORY_DIRECTORY } from "../../Helpers/TagStripScan";
import JsonWebTokenPurpose from "../../../Types/JsonWebTokenPurpose";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * A TOKEN THAT NAMES A PERSON IS READ ONLY AS WHAT IT SAYS IT IS.
 *
 * Every token OneUptime signs is signed with the same key (TokenSigningKey),
 * so the signature says only that this server made it. A session, an SSO
 * sign-in and a status page private user's session all name a person, and
 * each says which it is in its purpose claim (JsonWebTokenPurpose). These
 * hold the code to that, across all product code (ee/ too, when it is
 * checked out):
 *
 *   - every JSONWebToken.decode names, in the code, the one kind of token it
 *     reads, and each file reads only the kinds listed below for it - so a
 *     session reader that started taking SSO sign-ins, or a new reader of a
 *     person's token, fails here until it is looked at;
 *   - each kind is signed only where it is made: a session only by
 *     JSONWebToken.signUserLoginToken, an SSO sign-in and a status page's
 *     session only by CookieUtil;
 *   - signUserLoginToken is called only by the sign-ins that make or renew a
 *     UserSession, and by CookieUtil.setUserCookie that they call;
 *   - nothing that signs or reads a token spells a purpose itself;
 *   - every other reader of a token's raw claims is listed with what it
 *     reads, none of which is a person's token.
 *
 * Read from the code by TypeScript's own parser, so a word in a comment is
 * never taken for code.
 */

const JSON_WEB_TOKEN_MODULE: string =
  "packages/Common/Server/Utils/JsonWebToken.ts";
const PURPOSE_MODULE: string = "packages/Common/Types/JsonWebTokenPurpose.ts";
const COOKIE_MODULE: string = "packages/Common/Server/Utils/Cookie.ts";

// Every product file that reads a person's token, and the kinds it reads.
const READERS: Record<string, Array<string>> = {
  "packages/Common/Server/Middleware/UserAuthorization.ts": [
    // readRequestSession: every API request, the image routes and the realtime join.
    "UserSession",
    // getSsoTokens, getGlobalSsoTokenData, getStatelessValidProjectScopedSsoSignIn.
    "SsoSignIn",
  ],
  "packages/Common/Server/Middleware/MasterAdminAuthorization.ts": [
    "UserSession",
  ],
  "packages/Common/Server/Utils/MasterAdminPageAccess.ts": ["UserSession"],
  // Who extended a trial or adjusted a balance, behind the master-admin gate.
  "packages/Common/Server/API/ProjectAPI.ts": ["UserSession"],
  // findSignedInSession: the page's own sign-in, held to its live session.
  "packages/Common/Server/Services/StatusPageService.ts": ["StatusPageSession"],
};

// Where each kind of token is signed: the `purpose` handed to JSONWebToken.sign.
const SIGNERS: Record<string, Array<string>> = {
  // signUserLoginToken.
  UserSession: [JSON_WEB_TOKEN_MODULE],
  // getSSOToken and getGlobalSSOToken.
  SsoSignIn: [COOKIE_MODULE],
  // setStatusPagePrivateUserCookie.
  StatusPageSession: [COOKIE_MODULE],
};

/*
 * The sign-ins that make a session (UserSessionService.createSession) or
 * renew one (/refresh-token) and hand its access token to a mobile client,
 * and CookieUtil.setUserCookie, which they call for a browser.
 */
const SESSION_MINTERS: Array<string> = [
  "packages/App/FeatureSet/Identity/API/Authentication.ts",
  "packages/App/FeatureSet/Identity/API/GlobalOIDC.ts",
  "packages/App/FeatureSet/Identity/API/GlobalSSO.ts",
  "packages/App/FeatureSet/Identity/API/OIDC.ts",
  "packages/App/FeatureSet/Identity/API/SSO.ts",
  COOKIE_MODULE,
];

/*
 * Every other product file that reads a token's raw claims
 * (JSONWebToken.decodeJsonPayload), with what it reads. None takes a
 * person's token: each checks a shape of its own, or reads a token one of
 * the readers above has already taken for what it is.
 */
const RAW_CLAIM_READERS: Record<string, string> = {
  "packages/App/FeatureSet/Identity/API/GlobalOIDC.ts":
    "the state cookie of a Global OIDC sign-in in flight, matched to the provider's answer",
  "packages/App/FeatureSet/Identity/API/OIDC.ts":
    "the state cookie of a project OIDC sign-in in flight, matched to the provider's answer",
  "packages/App/FeatureSet/Identity/API/StatusPageOIDC.ts":
    "the state cookie of a status page OIDC sign-in in flight, matched to the provider's answer",
  "packages/App/FeatureSet/Identity/API/MicrosoftSignIn.ts":
    "the state cookie of a Sign in with Microsoft in flight, matched to Microsoft's answer",
  "packages/App/FeatureSet/Identity/API/StatusPageAuthentication.ts":
    "a status page's master-password cookie, by its type and status page",
  "packages/Common/Server/Services/StatusPageService.ts":
    "a status page's master-password cookie, by its type and status page",
  "packages/Common/Server/Services/DashboardService.ts":
    "a public dashboard's master-password cookie, by its type and dashboard",
  "packages/Common/Server/Middleware/BearerTokenAuthorization.ts":
    "a reseller's token, held to the reseller in the route",
  "packages/Common/Server/Middleware/NotificationMiddleware.ts":
    "a phone call's keypad answer token",
  "packages/Common/Server/Utils/OnCall/OnCallPageLinkToken.ts":
    "an on-call page link, by its own purpose and notification",
  "packages/Common/Server/Utils/Mcp/McpOAuthSso.ts":
    "the expiry and provider of an SSO sign-in UserMiddleware has already taken as one",
  "packages/Common/Server/Utils/Realtime/RealtimeJoinAccess.ts":
    "the times of an access token readRequestSession has already taken as a session",
};

const CODE_FILE: RegExp = /\.(?:ts|tsx)$/;
const ANY_JSON_WEB_TOKEN_CALL: RegExp = /\bJSONWebToken\.\w+\(/;
const PURPOSE_MEMBER: RegExp = /\bJsonWebTokenPurpose\b/;

const hasEe: boolean = fs.existsSync(path.join(REPOSITORY_DIRECTORY, "ee"));

const PURPOSE_NAMES: Array<string> = Object.keys(JsonWebTokenPurpose);
const PURPOSE_VALUES: Array<string> = Object.values(JsonWebTokenPurpose);

function sourceOf(relativePath: string): ts.SourceFile {
  return ts.createSourceFile(
    path.basename(relativePath),
    fs.readFileSync(path.join(REPOSITORY_DIRECTORY, relativePath), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function productCodeFiles(): Array<string> {
  return listProductFiles(REPOSITORY_DIRECTORY, ["packages", "ee"]).filter(
    (relativePath: string): boolean => {
      return CODE_FILE.test(relativePath);
    },
  );
}

function rawTextMatches(relativePath: string, pattern: RegExp): boolean {
  return pattern.test(
    fs.readFileSync(path.join(REPOSITORY_DIRECTORY, relativePath), "utf8"),
  );
}

function visit(node: ts.Node, onNode: (node: ts.Node) => void): void {
  onNode(node);
  ts.forEachChild(node, (child: ts.Node): void => {
    visit(child, onNode);
  });
}

// `JSONWebToken.<method>(...)`.
function isJsonWebTokenCall(node: ts.Node, method: string): boolean {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "JSONWebToken" &&
    node.expression.name.text === method
  );
}

// `JsonWebTokenPurpose.<Member>`, or null.
function purposeMemberOf(node: ts.Node | undefined): string | null {
  if (
    node &&
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "JsonWebTokenPurpose"
  ) {
    return node.name.text;
  }

  return null;
}

interface PurposeUse {
  file: string;
  line: number;
  purpose: string;
  how: "reads" | "signs" | "elsewhere";
}

interface DecodeCall {
  file: string;
  line: number;
  argumentCount: number;
  purpose: string | null;
}

interface Scan {
  decodeCalls: Array<DecodeCall>;
  purposeUses: Array<PurposeUse>;
  sessionMinters: Array<string>;
  rawClaimReaders: Array<string>;
  spelledPurposes: Array<{ file: string; line: number; text: string }>;
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return (
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  );
}

/*
 * Where a `JsonWebTokenPurpose.X` sits: the second argument of a
 * JSONWebToken.decode (it reads that kind), the `purpose` of the object a
 * JSONWebToken.sign is handed (it signs that kind), or anywhere else.
 */
function howUsed(node: ts.PropertyAccessExpression): PurposeUse["how"] {
  const parent: ts.Node = node.parent;

  if (
    ts.isCallExpression(parent) &&
    isJsonWebTokenCall(parent, "decode") &&
    parent.arguments[1] === node
  ) {
    return "reads";
  }

  if (
    ts.isPropertyAssignment(parent) &&
    ts.isIdentifier(parent.name) &&
    parent.name.text === "purpose" &&
    ts.isObjectLiteralExpression(parent.parent) &&
    ts.isCallExpression(parent.parent.parent) &&
    isJsonWebTokenCall(parent.parent.parent, "sign") &&
    parent.parent.parent.arguments[0] === parent.parent
  ) {
    return "signs";
  }

  return "elsewhere";
}

function scanProductCode(): Scan {
  const scan: Scan = {
    decodeCalls: [],
    purposeUses: [],
    sessionMinters: [],
    rawClaimReaders: [],
    spelledPurposes: [],
  };

  for (const file of productCodeFiles()) {
    const mentionsJsonWebToken: boolean = rawTextMatches(
      file,
      ANY_JSON_WEB_TOKEN_CALL,
    );
    const mentionsPurpose: boolean = rawTextMatches(file, PURPOSE_MEMBER);

    if (!mentionsJsonWebToken && !mentionsPurpose) {
      continue;
    }

    const sourceFile: ts.SourceFile = sourceOf(file);
    let mintsSessions: boolean = false;
    let readsRawClaims: boolean = false;

    visit(sourceFile, (node: ts.Node): void => {
      if (isJsonWebTokenCall(node, "decode")) {
        const call: ts.CallExpression = node as ts.CallExpression;

        scan.decodeCalls.push({
          file,
          line: lineOf(sourceFile, node),
          argumentCount: call.arguments.length,
          purpose: purposeMemberOf(call.arguments[1]),
        });
      }

      if (isJsonWebTokenCall(node, "signUserLoginToken")) {
        mintsSessions = true;
      }

      if (isJsonWebTokenCall(node, "decodeJsonPayload")) {
        readsRawClaims = true;
      }

      const purpose: string | null = purposeMemberOf(node);

      if (purpose && file !== PURPOSE_MODULE) {
        scan.purposeUses.push({
          file,
          line: lineOf(sourceFile, node),
          purpose,
          how: howUsed(node as ts.PropertyAccessExpression),
        });
      }

      if (
        mentionsJsonWebToken &&
        file !== PURPOSE_MODULE &&
        (ts.isStringLiteral(node) ||
          ts.isNoSubstitutionTemplateLiteral(node)) &&
        PURPOSE_VALUES.includes(node.text)
      ) {
        scan.spelledPurposes.push({
          file,
          line: lineOf(sourceFile, node),
          text: node.text,
        });
      }
    });

    if (mintsSessions) {
      scan.sessionMinters.push(file);
    }

    if (readsRawClaims && file !== JSON_WEB_TOKEN_MODULE) {
      scan.rawClaimReaders.push(file);
    }
  }

  return scan;
}

const SCAN: Scan = scanProductCode();

describe("every reader of a person's token says which kind it reads", () => {
  test("the scan found the readers and signers it is about", () => {
    // A scan that read nothing would pass every test below.
    expect(SCAN.decodeCalls.length).toBeGreaterThanOrEqual(
      Object.keys(READERS).length,
    );
    expect(SCAN.purposeUses.length).toBeGreaterThan(0);
  });

  test("every JSONWebToken.decode names the kind of token it reads, as JsonWebTokenPurpose.<kind>", () => {
    const unnamed: Array<DecodeCall> = SCAN.decodeCalls.filter(
      (call: DecodeCall): boolean => {
        return (
          call.argumentCount !== 2 ||
          !call.purpose ||
          !PURPOSE_NAMES.includes(call.purpose)
        );
      },
    );

    /*
     * A read here does not say, in the code, what kind of token it takes.
     * Pass the JsonWebTokenPurpose member itself, not a variable, so the
     * reader's kind is plain where it is read and listed below.
     */
    expect(unnamed).toEqual([]);
  });

  test("each file reads only the kinds listed for it, and every listed file still reads them", () => {
    const read: Record<string, Array<string>> = {};

    for (const call of SCAN.decodeCalls) {
      if (!call.purpose) {
        continue;
      }

      const kinds: Array<string> = read[call.file] || [];

      if (!kinds.includes(call.purpose)) {
        kinds.push(call.purpose);
      }

      read[call.file] = kinds.sort();
    }

    const expected: Record<string, Array<string>> = {};

    for (const file of Object.keys(READERS)) {
      expected[file] = [...READERS[file]!].sort();
    }

    /*
     * A new reader of a person's token, or a reader that takes another
     * kind: is it the kind this place means? A session reader takes
     * UserSession and nothing else; an SSO sign-in is read only next to a
     * session (UserMiddleware). Then list it here.
     */
    expect(read).toEqual(expected);
  });
});

describe("each kind of token is signed only where it is made", () => {
  test("a purpose is named only where a token of that kind is read or signed", () => {
    const elsewhere: Array<PurposeUse> = SCAN.purposeUses.filter(
      (use: PurposeUse): boolean => {
        return use.how === "elsewhere" && use.file !== JSON_WEB_TOKEN_MODULE;
      },
    );

    /*
     * A purpose used outside a JSONWebToken.decode or the `purpose` of a
     * JSONWebToken.sign: decide which of the two it is, and write it that
     * way so this guard can hold it to the lists here.
     */
    expect(elsewhere).toEqual([]);
  });

  test("each purpose is signed only by the module that makes that kind", () => {
    const signed: Record<string, Array<string>> = {};

    for (const use of SCAN.purposeUses) {
      if (use.how !== "signs") {
        continue;
      }

      const files: Array<string> = signed[use.purpose] || [];

      if (!files.includes(use.file)) {
        files.push(use.file);
      }

      signed[use.purpose] = files.sort();
    }

    expect(signed).toEqual(SIGNERS);
  });

  test("JSONWebToken signs a session only in signUserLoginToken", () => {
    const sessionSigns: Array<PurposeUse> = SCAN.purposeUses.filter(
      (use: PurposeUse): boolean => {
        return use.purpose === "UserSession" && use.how === "signs";
      },
    );

    expect(sessionSigns).toHaveLength(1);

    const sourceFile: ts.SourceFile = sourceOf(JSON_WEB_TOKEN_MODULE);
    let signingMethod: string | null = null;

    visit(sourceFile, (node: ts.Node): void => {
      if (
        purposeMemberOf(node) === "UserSession" &&
        howUsed(node as ts.PropertyAccessExpression) === "signs"
      ) {
        let ancestor: ts.Node | undefined = node.parent;

        while (ancestor && !ts.isMethodDeclaration(ancestor)) {
          ancestor = ancestor.parent;
        }

        signingMethod =
          ancestor && ts.isIdentifier(ancestor.name)
            ? ancestor.name.text
            : null;
      }
    });

    expect(signingMethod).toBe("signUserLoginToken");
  });

  test("only the sign-ins that make or renew a session call signUserLoginToken", () => {
    /*
     * A new caller mints a session's access token. It must belong to a
     * UserSession the caller just made or renewed (UserSessionService), last
     * fifteen minutes, and be what a sign-in hands out - then list it here.
     */
    expect(SCAN.sessionMinters).toEqual([...SESSION_MINTERS].sort());
  });

  test("nothing that signs or reads a token spells a purpose itself", () => {
    /*
     * Name a purpose through JsonWebTokenPurpose, so this guard sees every
     * place a kind of token is read or signed.
     */
    expect(SCAN.spelledPurposes).toEqual([]);
  });
});

describe("every other reader of a token's raw claims is listed", () => {
  test("each reads a shape of its own, or a token already taken for what it is", () => {
    /*
     * A new reader of decodeJsonPayload: if what it reads names a person, it
     * reads it with JSONWebToken.decode and the kind it means instead. If it
     * does not, list it here with what it reads.
     */
    expect(SCAN.rawClaimReaders).toEqual(Object.keys(RAW_CLAIM_READERS).sort());
  });
});

describe("the guard reads what it should", () => {
  test("it reads ee/ too when it is checked out", () => {
    const eeFiles: Array<string> = listProductFiles(REPOSITORY_DIRECTORY, [
      "ee",
    ]);

    expect(eeFiles.length > 0).toBe(hasEe);
  });

  test("the purposes it knows are the ones JsonWebTokenPurpose has", () => {
    expect([...PURPOSE_NAMES].sort()).toEqual([...Object.keys(SIGNERS)].sort());
  });
});
