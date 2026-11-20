import { CloudConnectorTransport } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";

/*
 * A STAND-IN FOR AWS STS, AS A PROJECT'S AMAZON SES ROLE MEETS IT (#7378).
 *
 * Answers the two calls a role sign-in makes, over STS's query protocol:
 *
 *   - GetCallerIdentity: who OneUptime's own identity is, in the account
 *     the test names (OneUptime's own AWS account);
 *   - AssumeRole: a session of an hour (or sessionSeconds) for a role that
 *     trusts the external id it was asked with - each role trusts the ids
 *     the test lists, or any id at all (a role made without the
 *     sts:ExternalId condition) - and AWS's own AccessDenied otherwise,
 *     which names OneUptime's identity as AWS's does.
 *
 * Each session it hands out has keys of its own (sessions), so a test can
 * hand them to the stand-in for Amazon SES and see which one signed an
 * email. Every request is recorded, with the fields a test reads.
 */

export const FAKE_ONEUPTIME_ACCOUNT: string = "999988887777";

// What AWS's AccessDenied to OneUptime names: its own identity.
export const FAKE_ONEUPTIME_PRINCIPAL_ARN: string = `arn:aws:sts::${FAKE_ONEUPTIME_ACCOUNT}:assumed-role/oneuptime-app/i-0abc123`;

export interface FakeStsRole {
  arn: string;
  // The external ids its trust policy lets OneUptime in with, or any at all.
  trusts: Array<string> | "any";
}

export interface FakeStsSession {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiresAtMs: number;
}

export interface FakeStsAssumeRole {
  roleArn: string;
  externalId: string;
  sessionName: string;
  durationSeconds: string;
  policy: string | null;
  url: string;
  authorization: string;
  securityToken: string;
}

export interface FakeStsAnswer {
  status: number;
  body: string;
}

export interface FakeSts {
  transport: CloudConnectorTransport;
  // Every action asked, in order.
  actions: Array<string>;
  assumeRoles: Array<FakeStsAssumeRole>;
  // The sessions handed out, in order.
  sessions: Array<FakeStsSession>;
  // The next AssumeRole is answered with this, whatever it asks.
  answerNextAssumeRoleWith: (answer: FakeStsAnswer) => void;
  // GetCallerIdentity is answered with this from now on (null: answered).
  failCallerIdentityWith: (answer: FakeStsAnswer | null) => void;
}

export function stsErrorAnswer(
  status: number,
  code: string,
  message: string,
): FakeStsAnswer {
  return {
    status,
    body: `<ErrorResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><Error><Type>Sender</Type><Code>${code}</Code><Message>${message}</Message></Error><RequestId>1</RequestId></ErrorResponse>`,
  };
}

function headerOf(request: DataSourceHttpRequest, name: string): string {
  for (const [key, value] of Object.entries(request.headers || {})) {
    if (key.toLowerCase() === name.toLowerCase()) {
      return String(value);
    }
  }

  return "";
}

function respond(answer: FakeStsAnswer): DataSourceHttpResponse {
  return {
    statusCode: answer.status,
    bodyText: answer.body,
    bodyJson: undefined,
    headers: {},
  };
}

export function createFakeSts(options: {
  roles: Array<FakeStsRole>;
  // OneUptime's own account: FAKE_ONEUPTIME_ACCOUNT unless said.
  callerAccount?: string | undefined;
  // How long a session lasts, from Date.now; an hour unless said.
  sessionSeconds?: number | undefined;
}): FakeSts {
  const actions: Array<string> = [];
  const assumeRoles: Array<FakeStsAssumeRole> = [];
  const sessions: Array<FakeStsSession> = [];
  const scripted: Array<FakeStsAnswer> = [];
  let callerIdentityFailure: FakeStsAnswer | null = null;
  const account: string = options.callerAccount || FAKE_ONEUPTIME_ACCOUNT;

  const transport: CloudConnectorTransport = async (
    request: DataSourceHttpRequest,
  ): Promise<DataSourceHttpResponse> => {
    const form: URLSearchParams = new URLSearchParams(
      String(request.body || ""),
    );
    const action: string = form.get("Action") || "";

    actions.push(action);

    if (action === "GetCallerIdentity") {
      if (callerIdentityFailure) {
        return respond(callerIdentityFailure);
      }

      return respond({
        status: 200,
        body: `<GetCallerIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><GetCallerIdentityResult><Arn>${FAKE_ONEUPTIME_PRINCIPAL_ARN}</Arn><UserId>AROAEXAMPLE:i-0abc123</UserId><Account>${account}</Account></GetCallerIdentityResult><ResponseMetadata><RequestId>1</RequestId></ResponseMetadata></GetCallerIdentityResponse>`,
      });
    }

    if (action !== "AssumeRole") {
      return respond(stsErrorAnswer(400, "InvalidAction", "Unknown action."));
    }

    const roleArn: string = form.get("RoleArn") || "";
    const externalId: string = form.get("ExternalId") || "";

    assumeRoles.push({
      roleArn,
      externalId,
      sessionName: form.get("RoleSessionName") || "",
      durationSeconds: form.get("DurationSeconds") || "",
      policy: form.get("Policy"),
      url: request.url,
      authorization: headerOf(request, "Authorization"),
      securityToken: headerOf(request, "X-Amz-Security-Token"),
    });

    const next: FakeStsAnswer | undefined = scripted.shift();

    if (next) {
      return respond(next);
    }

    const role: FakeStsRole | undefined = options.roles.find(
      (candidate: FakeStsRole): boolean => {
        return candidate.arn === roleArn;
      },
    );

    if (!role || (role.trusts !== "any" && !role.trusts.includes(externalId))) {
      return respond(
        stsErrorAnswer(
          403,
          "AccessDenied",
          `User: ${FAKE_ONEUPTIME_PRINCIPAL_ARN} is not authorized to perform: sts:AssumeRole on resource: ${roleArn}`,
        ),
      );
    }

    const number: number = sessions.length + 1;
    const session: FakeStsSession = {
      accessKeyId: `ASIASESSION${String(number).padStart(9, "0")}`,
      secretAccessKey: `sessionSecret${number}EXAMPLEabcdefghijklmnop`,
      sessionToken: `IQoJb3JpZ2luSessionToken${number}EXAMPLE`,
      expiresAtMs: Date.now() + (options.sessionSeconds ?? 3600) * 1000,
    };

    sessions.push(session);

    return respond({
      status: 200,
      body: `<AssumeRoleResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><AssumeRoleResult><AssumedRoleUser><Arn>${roleArn.replace(
        ":iam::",
        ":sts::",
      )}/session</Arn><AssumedRoleId>AROA:session</AssumedRoleId></AssumedRoleUser><Credentials><AccessKeyId>${session.accessKeyId}</AccessKeyId><SecretAccessKey>${session.secretAccessKey}</SecretAccessKey><SessionToken>${session.sessionToken}</SessionToken><Expiration>${new Date(
        session.expiresAtMs,
      ).toISOString()}</Expiration></Credentials></AssumeRoleResult></AssumeRoleResponse>`,
    });
  };

  return {
    transport,
    actions,
    assumeRoles,
    sessions,
    answerNextAssumeRoleWith: (answer: FakeStsAnswer): void => {
      scripted.push(answer);
    },
    failCallerIdentityWith: (answer: FakeStsAnswer | null): void => {
      callerIdentityFailure = answer;
    },
  };
}
