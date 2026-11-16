import { readPage } from "./DocsContentSupport";
import IncomingRequestSecretsCopy from "../../../FeatureSet/Dashboard/src/Components/IncomingRequestSecret/IncomingRequestSecretsCopy";
import {
  INCOMING_REQUEST_SECRET_AUTHORIZATION_SCHEME,
  INCOMING_REQUEST_SECRET_HEADER,
  INCOMING_REQUEST_WITHOUT_SECRET_WINDOW_HOURS,
} from "Common/Types/Monitor/IncomingMonitor/IncomingRequestSecret";
import { describe, expect, it } from "@jest/globals";
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
