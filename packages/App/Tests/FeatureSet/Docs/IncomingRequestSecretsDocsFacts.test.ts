import { readPage } from "./DocsContentSupport";
import IncomingRequestSecretsCopy from "../../../FeatureSet/Dashboard/src/Components/IncomingRequestSecret/IncomingRequestSecretsCopy";
import { MONITOR_SECRET_ACCESS_TITLES } from "../../../FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorSecretAccessFormFields";
import {
  INCOMING_REQUEST_SECRET_AUTHORIZATION_SCHEME,
  INCOMING_REQUEST_SECRET_HEADER,
  INCOMING_REQUEST_SIGNATURE_FORMATS,
  INCOMING_REQUEST_SIGNATURE_HEADER,
  INCOMING_REQUEST_SIGNATURE_TOLERANCE_SECONDS,
  INCOMING_REQUEST_UNTIMED_SIGNATURE_MEMORY_SECONDS,
  INCOMING_REQUEST_WITHOUT_SECRET_WINDOW_HOURS,
  IncomingRequestSignatureFormat,
  IncomingRequestSignatureScheme,
} from "Common/Types/Monitor/IncomingMonitor/IncomingRequestSecret";
import MonitorSecretAccess from "Common/Types/Monitor/MonitorSecretAccess";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "Common/Types/Permission";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import IncomingRequestSignature from "Common/Server/Utils/Monitor/IncomingRequestSignature";
import {
  WRONG_INCOMING_REQUEST_SECRET_WINDOW_SECONDS,
  WRONG_INCOMING_REQUEST_SECRETS_PER_ADDRESS,
} from "Common/Server/Utils/RateLimit/WrongIncomingRequestSecretLimit";
import { describe, expect, it } from "@jest/globals";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

/*
 * What the English Incoming Request Monitor page says about a project's
 * incoming request secrets (issue #7526), held to the code that makes it
 * true: where a sender puts the secret, what a request without one gets,
 * the names of the switch, the page and the column it points to, and the
 * two refusals that keep the requirement from refusing every sender by
 * mistake. And what it says about finding the senders that send no secret
 * yet (issue #8498): the list, its columns and its day, when requests start
 * being checked, and the line under a monitor's heartbeat URL. Each
 * language's copy is held to the English page's shape and labels by
 * ScriptAndInboundMonitorDocsTranslations.
 */

const PAGE: string = "monitor/incoming-request-monitor";
const HEADING: string = "## Require a secret on every request";

const REPO: string = path.resolve(__dirname, "../../../../..");

const readRepoFile: (relative: string) => string = (
  relative: string,
): string => {
  return fs.readFileSync(path.join(REPO, relative), "utf8");
};

const english: string = readPage("en", PAGE);

// The new section: from its heading to the next level-2 heading.
const section: () => string = (): string => {
  const start: number = english.indexOf(HEADING);

  expect(start).toBeGreaterThan(-1);

  const end: number = english.indexOf("\n## ", start + HEADING.length);

  return english.slice(start, end === -1 ? english.length : end);
};

describe("the Incoming Request page on a project's incoming request secrets", () => {
  it("names the header and the bearer token the ingest path reads", () => {
    expect(INCOMING_REQUEST_SECRET_HEADER).toBe("X-OneUptime-Secret");
    expect(section()).toContain(`\`${INCOMING_REQUEST_SECRET_HEADER}\` header`);
    expect(section()).toContain(
      `-H "${INCOMING_REQUEST_SECRET_HEADER}: YOUR_PROJECT_SECRET"`,
    );
    expect(section()).toContain(
      `-H "Authorization: ${INCOMING_REQUEST_SECRET_AUTHORIZATION_SCHEME} YOUR_PROJECT_SECRET"`,
    );
  });

  it("says a request without the secret gets 401, as the endpoint answers it", () => {
    const endpoint: string = readRepoFile(
      "packages/App/FeatureSet/Telemetry/API/IncomingRequestIngest/IncomingRequest.ts",
    );

    expect(endpoint).toContain(
      "throw new NotAuthenticatedException(secretDecision.refusalMessage);",
    );
    // The refusal comes before the 200 the page says every other request gets.
    expect(
      endpoint.indexOf("throw new NotAuthenticatedException("),
    ).toBeLessThan(
      endpoint.indexOf("Response.sendEmptySuccessResponse(req, res);"),
    );

    expect(section()).toContain("is refused with `401` and the reason");
    expect(english).toContain(
      "A project that requires a secret on every request answers a request without one with `401`",
    );
  });

  /*
   * A service's check of the URL (WebhookVerification, #8429) is answered
   * only once the requirement lets it through: the edge decides before it
   * answers, and a refused check gets the 401 any request gets.
   */
  it("says a service's check without the secret is refused too, as the endpoint decides it", () => {
    const endpoint: string = readRepoFile(
      "packages/App/FeatureSet/Telemetry/API/IncomingRequestIngest/IncomingRequest.ts",
    );

    expect(
      endpoint.indexOf("throw new NotAuthenticatedException("),
    ).toBeLessThan(
      endpoint.indexOf("WebhookVerification.send(res, answeredVerification);"),
    );
    expect(english).toContain(
      "in a project that requires a secret on every request, a check that sends none is refused with `401`, as any request is",
    );
  });

  it("names the switch, the page and the column as the Dashboard draws them", () => {
    expect(section()).toContain(
      `**${IncomingRequestSecretsCopy.switchTitle}**`,
    );
    expect(section()).toContain(
      `**Monitors → Settings → ${IncomingRequestSecretsCopy.pageTitle}**`,
    );
    expect(section()).toContain(
      `**${IncomingRequestSecretsCopy.lastUsedTitle}**`,
    );

    expect(
      readRepoFile(
        "packages/App/FeatureSet/Dashboard/src/Pages/Monitor/SideMenu.tsx",
      ),
    ).toContain(`title: "${IncomingRequestSecretsCopy.pageTitle}"`);
  });

  it("says the switch needs a secret to turn on, and the last secret stays while it is on", () => {
    const projectService: string = readRepoFile(
      "packages/Common/Server/Services/ProjectService.ts",
    );
    const secretService: string = readRepoFile(
      "packages/Common/Server/Services/IncomingRequestSecretService.ts",
    );

    // However the formatter wraps the throw.
    const squashed: (source: string) => string = (source: string): string => {
      return source.replace(/\s+/g, "");
    };

    expect(squashed(projectService)).toContain(
      "thrownewBadDataException(NO_INCOMING_REQUEST_SECRET_TO_REQUIRE_MESSAGE",
    );
    expect(squashed(secretService)).toContain(
      "thrownewBadDataException(LAST_INCOMING_REQUEST_SECRET_MESSAGE",
    );

    expect(section()).toContain(
      "It cannot be turned on while the project has no secret",
    );
    expect(section()).toContain(
      "the last one cannot be deleted while the requirement is on",
    );
  });

  it("says OneUptime generates the value, as the service does for one left empty", () => {
    expect(
      readRepoFile(
        "packages/Common/Server/Services/IncomingRequestSecretService.ts",
      ),
    ).toContain("createBy.data.secretValue = Service.generateSecretValue();");
    expect(section()).toContain(
      "Give it a name and OneUptime generates the value",
    );
  });

  it("links to the section from where the page used to say the URL key is the only credential", () => {
    expect(english).not.toContain("is the only credential");
    expect(english).toContain(
      "unless the project [requires a secret on every request](#require-a-secret-on-every-request)",
    );
    expect(english).toContain(":::details My sender gets a 401");
  });

  it("names the list of requests without a secret, its columns and its day as the Dashboard draws them", () => {
    expect(section()).toContain(
      `**${IncomingRequestSecretsCopy.withoutSecretTableTitle}**, on the same page`,
    );
    expect(section()).toContain(
      `**${IncomingRequestSecretsCopy.lastWithSecretTitle}**`,
    );
    expect(section()).toContain(
      `**${IncomingRequestSecretsCopy.lastWithoutSecretTitle}**`,
    );
    expect(section()).toContain(
      `in the last ${INCOMING_REQUEST_WITHOUT_SECRET_WINDOW_HOURS} hours`,
    );
    expect(IncomingRequestSecretsCopy.withoutSecretTableDescription).toContain(
      `in the last ${INCOMING_REQUEST_WITHOUT_SECRET_WINDOW_HOURS} hours`,
    );

    // On the same page as the secrets and the switch.
    const page: string = readRepoFile(
      "packages/App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/IncomingRequestSecrets.tsx",
    );

    expect(page).toContain("<RequireIncomingRequestSecretCard");
    expect(page).toContain("<RequestsWithoutSecretTable");
    expect(page).toContain("<ModelTable<IncomingRequestSecret>");
  });

  it("says requests are checked from the moment the project has a secret, as the policy reads its secrets whether or not it requires one", () => {
    expect(section()).toContain(
      "As soon as the project has a secret, OneUptime checks every request for one, without refusing any yet.",
    );

    const policy: string = readRepoFile(
      "packages/Common/Server/Utils/Monitor/IncomingRequestSecretPolicy.ts",
    ).replace(/\s+/g, "");

    expect(policy).toContain(
      "if(!project){return{isRequired:false,secrets:[]};}",
    );
    expect(policy).toContain(
      "isRequired:Boolean(project.requireIncomingRequestSecret)",
    );
  });

  it("tells whoever finds a monitor gone quiet where its refused requests show", () => {
    const entryStart: number = english.indexOf(
      ":::details The monitor stopped getting requests after a secret was required",
    );

    expect(entryStart).toBeGreaterThan(-1);

    const entry: string = english.slice(
      entryStart,
      english.indexOf("\n:::", entryStart + 1),
    );

    expect(entry).toContain("A line under the monitor's **Heartbeat URL**");
    expect(entry).toContain(
      `**${IncomingRequestSecretsCopy.withoutSecretTableTitle}**`,
    );
    expect(entry).toContain("(#require-a-secret-on-every-request)");

    // The line is drawn under the URL wherever a monitor shows it.
    for (const card of [
      "packages/App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorSetupCard.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorConnectionCard.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/Monitor/IncomingRequestMonitor/IncomingMonitorLink.tsx",
    ]) {
      expect({
        card,
        note: readRepoFile(card).includes("<IncomingRequestSecretNote"),
      }).toEqual({
        card,
        note: true,
      });
    }
  });
});

// A sub-section of the secrets section: from its heading to the next heading.
const subsection: (heading: string) => string = (heading: string): string => {
  const text: string = section();
  const start: number = text.indexOf(heading);

  expect(start).toBeGreaterThan(-1);

  const next: number = text.indexOf("\n### ", start + heading.length);

  return text.slice(start, next === -1 ? text.length : next);
};

// A troubleshooting entry, from its :::details line to its end.
const troubleshooting: (summary: string) => string = (
  summary: string,
): string => {
  const start: number = english.indexOf(`:::details ${summary}`);

  expect(start).toBeGreaterThan(-1);

  return english.slice(start, english.indexOf("\n:::", start + 1));
};

/*
 * Issue #8499: what an address that sends too many wrong secrets gets, held
 * to the limit the endpoint keeps.
 */
describe("the Incoming Request page on too many wrong secrets", () => {
  it("names the limit and its window as WrongIncomingRequestSecretLimit keeps them", () => {
    const minutes: number = WRONG_INCOMING_REQUEST_SECRET_WINDOW_SECONDS / 60;

    expect(section()).toContain(
      `more than ${WRONG_INCOMING_REQUEST_SECRETS_PER_ADDRESS} different wrong secrets in ${minutes} minutes is refused with \`429\``,
    );
    expect(section()).toContain("`Retry-After` header");
    expect(section()).toContain("Senders at other addresses are not affected");
  });

  it("says a right secret is refused too once over the limit, as the gate checks the limit before it compares", () => {
    expect(section()).toContain(
      "is refused with `429` for every secret it then sends, right or wrong,",
    );

    const gate: string = readRepoFile(
      "packages/Common/Server/Utils/Monitor/IncomingRequestSecretGate.ts",
    );
    const atEdge: string = gate.slice(
      gate.indexOf("public static async decideAtEdge("),
      gate.indexOf("public static async decideInWorker("),
    );

    expect(atEdge.indexOf("checkBeforeComparing(")).toBeGreaterThan(-1);
    expect(atEdge.indexOf("checkBeforeComparing(")).toBeLessThan(
      atEdge.indexOf("IncomingRequestSecretPolicy.decide("),
    );
  });

  it("says 429 with Retry-After as the endpoint answers it", () => {
    const endpoint: string = readRepoFile(
      "packages/App/FeatureSet/Telemetry/API/IncomingRequestIngest/IncomingRequest.ts",
    );

    expect(endpoint).toContain('"Retry-After"');
    expect(endpoint).toContain(
      "throw new TooManyRequestsException(secretDecision.refusalMessage);",
    );
    // Before anything is answered, recorded or queued.
    expect(
      endpoint.indexOf("throw new TooManyRequestsException("),
    ).toBeLessThan(
      endpoint.indexOf("Response.sendEmptySuccessResponse(req, res);"),
    );
  });

  it("has a troubleshooting entry for a 429", () => {
    const entry: string = troubleshooting("My sender gets a 429");

    expect(entry).toContain(
      `more than ${WRONG_INCOMING_REQUEST_SECRETS_PER_ADDRESS} different wrong secrets or signatures`,
    );
    expect(entry).toContain("`Retry-After`");
    expect(entry).toContain("(#require-a-secret-on-every-request)");
  });
});

/*
 * Issue #8500: signing a request instead of sending the secret, held to the
 * signatures the endpoint checks and the times it keeps.
 */
describe("the Incoming Request page on signing requests", () => {
  const SIGN: string = "### Sign requests with the secret";

  it("lists every signature the endpoint checks, OneUptime's own first, and how each is made", () => {
    const text: string = subsection(SIGN);

    for (const format of INCOMING_REQUEST_SIGNATURE_FORMATS) {
      expect({
        header: format.header,
        listed: text.includes(`\`${format.header}`),
      }).toEqual({
        header: format.header,
        listed: true,
      });

      if (format.timestampHeader) {
        expect(text).toContain(`\`${format.timestampHeader}\``);
      }
    }

    expect(text).toContain(
      `| \`${INCOMING_REQUEST_SIGNATURE_HEADER}: t=<time>,v1=<signature>\` | \`<time>.<body>\` |`,
    );
    expect(text).toContain("| `v0:<time>:<body>` |");
    expect(text).toContain("HMAC-SHA256 in hex with the secret as its key");
  });

  it("what it says is signed is what each signature is made over", () => {
    const body: Buffer = Buffer.from("B", "utf8");

    const payloadOf: (scheme: IncomingRequestSignatureScheme) => string = (
      scheme: IncomingRequestSignatureScheme,
    ): string => {
      return IncomingRequestSignature.getSignedPayload({
        signature: { scheme, timestampSeconds: 7, digests: [] },
        body,
      }).toString("utf8");
    };

    expect(payloadOf(IncomingRequestSignatureScheme.OneUptime)).toBe("7.B");
    expect(payloadOf(IncomingRequestSignatureScheme.Stripe)).toBe("7.B");
    expect(payloadOf(IncomingRequestSignatureScheme.Slack)).toBe("v0:7:B");
    expect(payloadOf(IncomingRequestSignatureScheme.GitHub)).toBe("B");
  });

  it("names the time a signature may be off by, and how long one without a time is remembered", () => {
    const text: string = subsection(SIGN);

    expect(text).toContain(
      `more than ${INCOMING_REQUEST_SIGNATURE_TOLERANCE_SECONDS / 60} minutes from OneUptime's clock is refused`,
    );
    expect(INCOMING_REQUEST_UNTIMED_SIGNATURE_MEMORY_SECONDS).toBe(
      24 * 60 * 60,
    );
    expect(text).toContain("remembers each one for a day");
    expect(text).toContain("so is a signed request sent a second time");

    const github: IncomingRequestSignatureFormat | undefined =
      INCOMING_REQUEST_SIGNATURE_FORMATS.find(
        (format: IncomingRequestSignatureFormat): boolean => {
          return format.scheme === IncomingRequestSignatureScheme.GitHub;
        },
      );

    expect(github?.hasTimestamp).toBe(false);
  });

  it("says to prefer it, and why the secret in a query string was left out", () => {
    const text: string = subsection(SIGN);

    expect(text).toContain("Prefer it wherever a sender can sign");
    expect(text).toContain(
      "A secret in the URL's query string is not accepted",
    );
    // The step that sends the secret points here.
    expect(section()).toContain("(#sign-requests-with-the-secret)");
    // And so does the Dashboard, under the switch.
    expect(IncomingRequestSecretsCopy.switchNote).toContain(
      "sign each request with it",
    );
  });

  it("says a probe passes a signed body on as it came, as the probe's ingress does", () => {
    expect(subsection(SIGN)).toContain(
      "A probe's incoming request ingress passes a signed request's body on as it came, so its signature holds there too.",
    );

    const ingress: string = readRepoFile(
      "packages/Probe/API/IncomingRequestIngress.ts",
    ).replace(/\s+/g, "");

    expect(ingress).toContain(
      "if(carriesIncomingRequestSignature(req.headersasDictionary<string|Array<string>|undefined>,)){returngetSignedRequestBody(req);}",
    );
    expect(ingress).toContain(
      "WebhookRequestBody.getSignedBodyReader(INGRESS_BODY_LIMIT,isSignedRequest)",
    );
  });

  it("names the fold a service's own signing secret is typed in as the form draws it", () => {
    expect(MORE_FIELDS_SECTION_TITLE).toBe("More fields");
    expect(subsection(SIGN)).toContain(
      `under **${MORE_FIELDS_SECTION_TITLE}**`,
    );
  });

  /*
   * The example is run as a sender would run it, and its signature checked
   * the way the endpoint checks one. It needs openssl, which CI has.
   */
  const hasOpenSsl: boolean = [
    "/usr/bin/openssl",
    "/usr/local/bin/openssl",
  ].some((candidate: string): boolean => {
    return fs.existsSync(candidate);
  });

  (hasOpenSsl ? it : it.skip)(
    "its shell example makes a signature the endpoint accepts",
    () => {
      const text: string = subsection(SIGN);
      const fenceStart: number = text.indexOf("```bash\n");
      const fenceEnd: number = text.indexOf("\n```", fenceStart + 8);
      const code: string = text.slice(fenceStart + 8, fenceEnd);

      // Everything before the request itself: the body, the time, the signature.
      const signing: string = code.slice(0, code.indexOf("\ncurl"));
      const secret: string = "a-project-secret-for-the-docs-test";

      const output: string = execFileSync(
        "bash",
        [
          "-c",
          `${signing.split("YOUR_PROJECT_SECRET").join(secret)}\nprintf '%s %s' "$t" "$sig"`,
        ],
        { encoding: "utf8" },
      ).trim();

      const [time, signature] = output.split(" ") as [string, string];

      expect(code).toContain(
        `-H "${INCOMING_REQUEST_SIGNATURE_HEADER}: t=$t,v1=$sig"`,
      );
      expect(code).toContain(`-d "$body"`);

      expect(
        IncomingRequestSignature.verify({
          signatures: IncomingRequestSignature.readPresentedSignatures({
            [INCOMING_REQUEST_SIGNATURE_HEADER]: `t=${time},v1=${signature}`,
          }),
          body: Buffer.from('{"status":"healthy"}', "utf8"),
          secrets: [{ secretId: "docs", value: secret }],
          now: new Date(Number(time) * 1000),
        }).matchedSecretId,
      ).toBe("docs");
    },
  );
});

/*
 * Issue #8501: limiting a secret to some monitors, named as the form and the
 * list draw it.
 */
describe("the Incoming Request page on limiting a secret", () => {
  const SCOPE: string = "### Limit a secret to some monitors";

  it("names the fold, the modes and the reason as the Dashboard draws them", () => {
    const text: string = subsection(SCOPE);

    expect(text).toContain(`**${MORE_FIELDS_SECTION_TITLE}**`);
    expect(text).toContain(
      `**${MONITOR_SECRET_ACCESS_TITLES[MonitorSecretAccess.SpecificMonitors]}**`,
    );
    expect(text).toContain(
      `**${MONITOR_SECRET_ACCESS_TITLES[MonitorSecretAccess.MonitorsWithLabels]}**`,
    );
    expect(text).toContain(
      `**${IncomingRequestSecretsCopy.withoutSecretTableTitle}**`,
    );
    expect(text).toContain(
      `**${IncomingRequestSecretsCopy.reasonSecretNotForMonitor}**`,
    );
  });

  it("says another monitor refuses it with 401, as the policy decides", () => {
    expect(subsection(SCOPE)).toContain(
      "Any other monitor refuses it with `401`, as it refuses a wrong secret",
    );
    expect(
      readRepoFile(
        "packages/Common/Server/Utils/Monitor/IncomingRequestSecretPolicy.ts",
      ),
    ).toContain("IncomingRequestSecretProblem.SecretNotForMonitor");
  });

  it("says the project keeps a secret that covers a monitor while it requires one, as the service refuses otherwise", () => {
    expect(subsection(SCOPE)).toContain(
      "the project keeps at least one secret that covers a monitor",
    );

    const service: string = readRepoFile(
      "packages/Common/Server/Services/IncomingRequestSecretService.ts",
    ).replace(/\s+/g, "");

    expect(service).toContain(
      "thrownewBadDataException(LAST_COVERING_INCOMING_REQUEST_SECRET_MESSAGE",
    );
  });
});

// Issue #8502: who manages the secrets, by the permissions the picker offers.
describe("the Incoming Request page on who manages the secrets", () => {
  it("names the four permissions as the permission picker titles them", () => {
    const titles: Array<string> = PermissionHelper.getAllPermissionProps()
      .filter((props: PermissionProps): boolean => {
        return [
          Permission.CreateIncomingRequestSecret,
          Permission.ReadIncomingRequestSecret,
          Permission.EditIncomingRequestSecret,
          Permission.DeleteIncomingRequestSecret,
        ].includes(props.permission);
      })
      .map((props: PermissionProps): string => {
        return props.title;
      })
      .sort();

    expect(titles).toEqual([
      "Create Incoming Request Secret",
      "Delete Incoming Request Secret",
      "Edit Incoming Request Secret",
      "Read Incoming Request Secret",
    ]);
    expect(section()).toContain(
      "a custom role with the Create, Read, Edit and Delete Incoming Request Secret permissions",
    );
  });
});

// Issue #8564: the question the switch asks before it turns on.
describe("the Incoming Request page on turning the requirement on", () => {
  it("says the question names how many monitors would be refused", () => {
    expect(section()).toContain(
      `it names how many Incoming Request monitors got a request without a valid secret in the last ${INCOMING_REQUEST_WITHOUT_SECRET_WINDOW_HOURS} hours, if any`,
    );
    expect(
      readRepoFile(
        "packages/App/FeatureSet/Dashboard/src/Components/IncomingRequestSecret/RequireIncomingRequestSecretCard.tsx",
      ),
    ).toContain("CONFIRM_TURN_ON_REFUSED_MONITORS");
  });
});
