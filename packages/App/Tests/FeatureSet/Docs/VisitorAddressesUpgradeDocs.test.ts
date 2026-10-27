import { inlineCode } from "./DocsTranslationChecks";
import { readPage } from "./DocsContentSupport";
import {
  flattened,
  otherChangesItemAtEnglishPlace,
  otherChangesItems,
} from "./UpgradingDocsNotes";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { slugifyMarkdownHeading } from "Common/Server/Types/MarkdownSlugify";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The upgrade note that says visitors keep their own address in more setups,
 * and the Docker Compose guide's "Visitor addresses" section it points to,
 * held to the code that makes them true.
 *
 * OneUptime counts a visitor by the address its ingress accepted the
 * connection from. The note (installation/upgrading, "Other changes in 14")
 * says what changed for that: the ingress listens on IPv6 too, IPv6 for
 * Docker Compose's network is turned on in docker-compose.override.yml (the
 * compose files OneUptime ships leave the network as installs made it, so an
 * upgrade never recreates it), a proxy on the same server publishes the
 * ingress on 127.0.0.1 (and npm start says so while it is still published
 * on every address: Scripts/Install/CheckIngressPorts.js), the Helm chart's
 * nginx.service.externalTrafficPolicy (and helm install / helm upgrade saying
 * so while it is unset), the Admin Dashboard's OneUptime Health page, and
 * NGINX_LISTEN_OPTIONS working again. It sits after the note on runbook
 * variables (RunbookVariablesUpgradeDocs) and before the note that a code
 * repository picks its Runner (CodeRepositoryRunnerUpgradeDocs), and
 * every translation carries it in the English note's place, with the English
 * note's code and a link to the guide's section in the reader's language.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const REPO_ROOT: string = path.resolve(PACKAGES_DIR, "..");

const NOTE_LEAD: string = "Visitors keep their own address in more setups.";
// The note before it (RunbookVariablesUpgradeDocs).
const PREVIOUS_LEAD: string =
  "**Runbook secrets and the credentials runbook steps used are runbook variables.**";
// The note after it (CodeRepositoryRunnerUpgradeDocs).
const NEXT_LEAD: string =
  "**A code repository picks its Runner, and Runners lose their AI code fix switch.**";

const GUIDE: string = "installation/docker-compose";
const GUIDE_LINK: string = "(/docs/installation/docker-compose#";
const SECTION_HEADING: string = "## Visitor addresses";

const TRANSLATIONS: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

function source(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

const ENGLISH_ITEMS: Array<string> = otherChangesItems("en");
const NOTE_INDEX: number = ENGLISH_ITEMS.findIndex((item: string): boolean => {
  return flattened(item).startsWith(`- **${NOTE_LEAD}**`);
});
const ENGLISH_NOTE: string = flattened(ENGLISH_ITEMS[NOTE_INDEX] || "");

// The guide's section, from its heading to the next heading of its level.
function sectionOf(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.indexOf(heading);

  if (start < 0) {
    return "";
  }

  const end: number = lines.findIndex((line: string, index: number) => {
    return index > start && line.startsWith("## ");
  });

  return lines.slice(start, end < 0 ? undefined : end).join("\n");
}

describe("the English upgrade note on visitor addresses", () => {
  it("is a note of the 13 → 14 changes, once, after the runbook variables note and before the note that a code repository picks its Runner", () => {
    expect(NOTE_INDEX).toBeGreaterThan(0);
    expect(
      ENGLISH_ITEMS.filter((item: string): boolean => {
        return flattened(item).includes(NOTE_LEAD);
      }),
    ).toHaveLength(1);
    expect(
      flattened(ENGLISH_ITEMS[NOTE_INDEX - 1]!).startsWith(
        `- ${PREVIOUS_LEAD}`,
      ),
    ).toBe(true);
    expect(
      flattened(ENGLISH_ITEMS[NOTE_INDEX + 1]!).startsWith(`- ${NEXT_LEAD}`),
    ).toBe(true);
  });

  it("says what changed, and what to set", () => {
    for (const claim of [
      "Its ingress now listens on IPv6 as well as IPv4, and IPv6 can be turned on for Docker Compose's network in `docker-compose.override.yml` (Docker Engine 27 or later)",
      "publish the ingress on `127.0.0.1` only (`ONEUPTIME_HTTP_PORT=127.0.0.1:8080`)",
      "through the proxy alone; `npm start` says so while it is still published on every address.",
      "With Helm, `nginx.service.externalTrafficPolicy: Local` keeps each visitor's address through a load balancer that passes it on; while that is unset, `helm install` and `helm upgrade` say so.",
      "**Admin Dashboard → OneUptime Health** says when several people sign in from one private network address.",
      "Networks and Services stay as they are until you set one of these.",
      "`NGINX_LISTEN_OPTIONS`, which nginx refused for any value, now works.",
      "[Visitor addresses](/docs/installation/docker-compose#visitor-addresses)",
    ]) {
      expect({ claim, said: ENGLISH_NOTE.includes(claim) }).toEqual({
        claim,
        said: true,
      });
    }
  });
});

describe("the note and the guide are true to the install", () => {
  it("Docker Compose's network is the one installs made: IPv6 is the operator's override, never the shipped files'", () => {
    /*
     * Docker Compose recreates a network whose settings change, and cannot
     * while a container it does not manage is attached: an upgrade that
     * changed the shipped network would stop such an install. So the shipped
     * files keep the network exactly as it was, and IPv6 is turned on in
     * docker-compose.override.yml (Tests/Ops/ComposeVisitorAddresses.test.js
     * merges the guide's snippet with the real files).
     */
    for (const file of [
      "docker-compose.yml",
      "docker-compose.base.yml",
      "Scripts/Dev/docker-compose.dev.yml",
    ]) {
      const compose: string = source(file);

      expect({
        file,
        network: compose.endsWith(
          "\nnetworks:\n  oneuptime:\n    driver: bridge\n",
        ),
        ipv6: compose.includes("enable_ipv6"),
      }).toEqual({ file, network: true, ipv6: false });
    }
  });

  it("the ingress has an IPv6 twin for every listen, unless NGINX_LISTEN_ADDRESS names one address", () => {
    const script: string = source("packages/Nginx/envsubst-on-templates.sh");
    const template: string = source("packages/Nginx/default.conf.template");

    expect(script).toContain(
      'if [ -z "${NGINX_LISTEN_ADDRESS}" ] && [ -f "${NGINX_IPV6_SUPPORT_FILE}" ]; then',
    );
    expect(script).toContain(
      'export NGINX_IPV6_LISTEN_DEFAULT_DIRECTIVE="    listen [::]:7849 default_server;"',
    );
    expect(template).toContain(
      "    listen ${NGINX_LISTEN_ADDRESS}7849 default_server ${NGINX_LISTEN_OPTIONS};\n${NGINX_IPV6_LISTEN_DEFAULT_DIRECTIVE}\n",
    );
    // The primary's own listen carries no socket options: nginx takes them once per port.
    expect(template).toContain(
      "    listen ${NGINX_LISTEN_ADDRESS}7849;\n${NGINX_IPV6_LISTEN_DIRECTIVE}\n",
    );
  });

  it("npm start says so while a proxy is counted and the ingress, moved off its ports, is still published on every address", () => {
    const scripts: Record<string, string> = (
      JSON.parse(source("package.json")) as { scripts: Record<string, string> }
    ).scripts;
    const commands: Array<string> = (scripts["start"] || "").split(" && ");
    const check: number = commands.indexOf(
      "node ./Scripts/Install/CheckIngressPorts.js",
    );

    // A step of the start script, before Compose starts anything.
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(
      commands.findIndex((command: string): boolean => {
        return command.startsWith(
          "sh ./Scripts/Install/WithConfig.sh docker compose up ",
        );
      }),
    );
    expect(scripts["update"]).toMatch(/&& npm run start$/);

    const checkSource: string = source("Scripts/Install/CheckIngressPorts.js");

    expect(checkSource).toContain(
      '{ setting: "ONEUPTIME_HTTP_PORT", defaultPort: "80" }',
    );
    expect(checkSource).toContain(
      '{ setting: "STATUS_PAGE_HTTPS_PORT", defaultPort: "443" }',
    );
    expect(checkSource).toContain(
      '"https://oneuptime.com/docs/installation/docker-compose#use-your-own-reverse-proxy"',
    );
    expect(slugifyMarkdownHeading("Use your own reverse proxy")).toBe(
      "use-your-own-reverse-proxy",
    );
  });

  it("the Helm chart keeps Kubernetes' default policy until it is set, and says so meanwhile", () => {
    const values: string = source("HelmChart/Public/oneuptime/values.yaml");
    const notes: string = source(
      "HelmChart/Public/oneuptime/templates/NOTES.txt",
    );
    const service: string = source(
      "HelmChart/Public/oneuptime/templates/nginx.yaml",
    );

    expect(values).toContain('    externalTrafficPolicy: ""\n');
    expect(service).toContain(
      "{{- with $.Values.nginx.service.externalTrafficPolicy }}",
    );
    expect(service).toContain("  externalTrafficPolicy: {{ . }}\n");
    expect(notes).toContain(
      "ACTION RECOMMENDED -- OneUptime sees visitors at a node's address.",
    );
    expect(notes).toContain(
      "To keep things as they are, set nginx.service.externalTrafficPolicy=Cluster.",
    );
  });

  it("the Admin Dashboard's Health landing page asks where people sign in from", () => {
    expect(source("packages/App/API/AdminHealth.ts")).toContain(
      '  "/visitor-addresses",\n  MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,\n',
    );
    expect(
      source(
        "packages/App/FeatureSet/AdminDashboard/src/Pages/Health/CommunityHealthOverview.tsx",
      ),
    ).toContain("<VisitorAddressesSummary />");
    expect(
      source(
        "packages/App/FeatureSet/AdminDashboard/src/Pages/Health/VisitorAddressesSummary.tsx",
      ),
    ).toContain('"/docs/installation/docker-compose#visitor-addresses";');
  });
});

describe("the Docker Compose guide's section", () => {
  const english: string = readPage("en", GUIDE);
  const section: string = sectionOf(english, SECTION_HEADING);

  it("is there, under the heading the Health page and the upgrade note link to", () => {
    expect(section).not.toBe("");
    expect(slugifyMarkdownHeading("Visitor addresses")).toBe(
      "visitor-addresses",
    );
  });

  it("names the setting of each setup, and how to turn IPv6 on, restart and check it", () => {
    for (const line of [
      "| People reach OneUptime over IPv6, for example through an `AAAA` record | IPv6 on OneUptime's network, in `docker-compose.override.yml` |",
      "| Your own reverse proxy is in front of OneUptime | `TRUSTED_PROXY_HOPS=2`, with the ingress published on `127.0.0.1` (see [Use your own reverse proxy](#use-your-own-reverse-proxy)) |",
      'Create `docker-compose.override.yml` next to `docker-compose.yml`, or add this to the one you have; `npm start` and `npm run update` read it:\n\n```yaml title="docker-compose.override.yml"\nnetworks:\n  oneuptime:\n    enable_ipv6: true\n```',
      "```bash\nnpm stop\nnpm start\n```",
      "disconnect it from OneUptime's network first, and connect it again afterwards. If `npm start` stops with `has active endpoints`, disconnect it, then run `npm stop` and `npm start` again.",
      "docker network ls --quiet --filter name=_oneuptime | xargs docker network inspect | grep EnableIPv6",
      'It prints `"EnableIPv6": true,`.',
      "Turning IPv6 on needs Docker Engine 27 or later (`docker version` shows yours).",
    ]) {
      expect({ line, said: section.includes(line) }).toEqual({
        line,
        said: true,
      });
    }
  });

  it("publishes the ingress on the loopback address when a proxy on the server is in front", () => {
    expect(english).toContain(
      '```ini title="config.env"\nONEUPTIME_HTTP_PORT=127.0.0.1:8080\nSTATUS_PAGE_HTTPS_PORT=127.0.0.1:8443\n',
    );
    expect(english).toContain(
      "let only the proxy reach ports 80 and 443 with your cloud provider's firewall",
    );
  });
});

describe("every translation carries the note", () => {
  it.each(TRANSLATIONS)(
    "%s has the note in the English note's place, with the English code and the guide's link",
    (language: string) => {
      const note: string = flattened(
        otherChangesItemAtEnglishPlace(language, NOTE_LEAD),
      );

      // The same code spans as the English note, in the same order.
      expect(inlineCode(note)).toEqual(inlineCode(ENGLISH_NOTE));

      // The guide's section, in the reader's language (localized anchor).
      expect(note).toContain(GUIDE_LINK);

      const guide: string = readPage(language, GUIDE);
      const anchor: string = note.slice(
        note.indexOf(GUIDE_LINK) + GUIDE_LINK.length,
        note.indexOf(")", note.indexOf(GUIDE_LINK)),
      );
      const headings: Array<string> = guide
        .split("\n")
        .filter((line: string): boolean => {
          return line.startsWith("## ");
        })
        .map((line: string): string => {
          return slugifyMarkdownHeading(line.slice(3));
        });

      expect(headings).toContain(anchor);

      // A translated lead, not the English words.
      expect(note.startsWith(`- **${NOTE_LEAD}`)).toBe(false);
    },
  );
});
