import {
  DOCS_LANGUAGES,
  DocsFence,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import { slugifyMarkdownHeading } from "Common/Server/Types/MarkdownSlugify";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Hardening Guide's "Turn HTTP/2 off until you can upgrade" (#9846),
 * held to the setting it names.
 *
 * The gateway's primary server offers HTTP/2 for the install's own address
 * when the gateway terminates TLS itself. When nginx fixed two
 * vulnerabilities in HTTP/2 (#9709), the guide told people to sed the
 * config inside the running container, which the next container or pod
 * undid. The gateway now reads a setting, NGINX_HTTP2 (config.env) or
 * nginx.http2 (the Helm chart), and the guide says:
 *
 *   - the setting, written as config.env and values.yaml take it, and the
 *     commands that apply a change to them, the same in every language (the
 *     guide is in English in every language today; a translation would
 *     translate the words around the code, not the code);
 *   - that docker-compose.base.yml and the chart hand it to the gateway under
 *     the name envsubst-on-templates.sh reads, which turns HTTP/2 off for it;
 *   - the line the gateway's log prints then, as the script prints it;
 *   - what stops (OTLP over gRPC), what keeps working (OTLP over HTTP), and
 *     that upgrading is the fix;
 *   - and no command that edits the config inside a running container.
 *
 * packages/Nginx/Tests/PrimaryServerHttp2.test.js holds the gateway to the
 * setting, and HelmChart/Public/oneuptime/tests/nginx-http2_test.yaml the
 * chart.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const REPO_ROOT: string = path.resolve(PACKAGES_DIR, "..");

const HARDENING: string = "self-hosted/hardening";
const HEADING: string = "Turn HTTP/2 off until you can upgrade";

const SETTING: string = "NGINX_HTTP2";
const COMPOSE_LINE: string = `${SETTING}=off`;
const VALUES_BLOCK: string = "nginx:\n  http2: false";
const COMPOSE_APPLY: string = "npm run start";
const HELM_APPLY: string =
  "helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml";
const LOG_LINE: string = "HTTP/2 is off";

// A heading that starts the page's next section, or a part of it.
const SECTION_HEADING: RegExp = /^#{1,3} /;

function read(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

// The section in a language: its heading, up to the next section's.
function section(language: string): string {
  const lines: Array<string> = readPage(language, HARDENING).split("\n");
  const start: number = lines.indexOf(`### ${HEADING}`);

  if (start < 0) {
    throw new Error(`${language}/${HARDENING} has no "${HEADING}" section`);
  }

  const end: number = lines.findIndex(
    (line: string, index: number): boolean => {
      return index > start && SECTION_HEADING.test(line);
    },
  );

  return lines.slice(start, end < 0 ? undefined : end).join("\n");
}

// The section's code, block by block: what a reader copies.
function codeOf(language: string): Array<{ info: string; code: string }> {
  return scanMarkdown(section(language)).fences.map(
    (fence: DocsFence): { info: string; code: string } => {
      return { info: fence.info, code: fence.code };
    },
  );
}

// The section's words, outside its code, on one line.
function proseOf(language: string): string {
  return section(language)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\s+/g, " ");
}

describe("the Hardening Guide's HTTP/2 section", () => {
  const english: Array<{ info: string; code: string }> = codeOf("en");

  it("turns HTTP/2 off with the setting, written as config.env and values.yaml take it, and applies it as every change to them is applied", () => {
    expect(english).toEqual([
      { info: 'bash title="config.env"', code: COMPOSE_LINE },
      { info: "bash", code: COMPOSE_APPLY },
      { info: 'yaml title="values.yaml"', code: VALUES_BLOCK },
      { info: "bash", code: HELM_APPLY },
      {
        info: "bash",
        code: "curl -s -o /dev/null -w '%{http_version}\\n' --http2 https://oneuptime.example.com",
      },
    ]);
  });

  it.each(DOCS_LANGUAGES)("has the same code in %s", (language: string) => {
    expect(codeOf(language)).toEqual(english);
  });

  it("names the setting docker-compose.base.yml hands the gateway from config.env, which config.example.env ships on", () => {
    expect(read("docker-compose.base.yml")).toContain(
      `      ${SETTING}: \${${SETTING}:-on}\n`,
    );
    expect(read("config.example.env").split("\n")).toContain(`${SETTING}=on`);
  });

  it("names the chart value the chart hands the gateway, which values.yaml ships true", () => {
    const values: string = read("HelmChart/Public/oneuptime/values.yaml");
    const nginxValues: string = values.slice(values.indexOf("\nnginx:\n"));

    expect(nginxValues.slice(0, nginxValues.indexOf("\npostgresql:"))).toMatch(
      /^ {2}http2: true$/m,
    );
    expect(read("HelmChart/Public/oneuptime/templates/nginx.yaml")).toContain(
      `- name: ${SETTING}\n              value: {{ ternary "off" "on" (eq (toString $.Values.nginx.http2) "false") | quote }}`,
    );
  });

  it("is the setting the gateway's script turns HTTP/2 off for, and quotes the line its log then prints", () => {
    const script: string = read("packages/Nginx/envsubst-on-templates.sh");

    expect(script).toContain(
      `off | false | no | 0) export ${SETTING}="off" ;;`,
    );
    expect(script).toContain(
      `echo "$ME: ${LOG_LINE} for \${HOST_WITHOUT_PORT}`,
    );
    expect(proseOf("en")).toContain(`\`${LOG_LINE}\``);
  });

  it("says what stops, what keeps working, and that upgrading is the fix", () => {
    const prose: string = proseOf("en");

    for (const said of [
      "PROVISION_SSL=true",
      "ssl.provision: true",
      "Upgrading is the fix",
      "OTLP over gRPC to your install's address",
      "OTLP over HTTP keeps working",
      "Restarts and upgrades keep it",
      "Only upgrading fixes that",
    ]) {
      expect({ said, there: prose.includes(said) }).toEqual({
        said,
        there: true,
      });
    }
  });

  it.each(DOCS_LANGUAGES)(
    "tells nobody in %s to edit the config inside a running container",
    (language: string) => {
      const text: string = section(language);

      for (const edit of [
        /\bsed\b/,
        /default\.conf/,
        /\bexec\b/,
        /nginx -s reload/,
      ]) {
        expect({ edit: String(edit), found: edit.test(text) }).toEqual({
          edit: String(edit),
          found: false,
        });
      }
    },
  );

  it("is where the chart's configuration docs send nginx.http2's readers", () => {
    expect(read("HelmChart/Public/oneuptime/docs/configuration.md")).toContain(
      `| \`nginx.http2\` `,
    );
    expect(read("HelmChart/Public/oneuptime/docs/configuration.md")).toContain(
      `(https://oneuptime.com/docs/${HARDENING}#${slugifyMarkdownHeading(HEADING)})`,
    );
  });
});
