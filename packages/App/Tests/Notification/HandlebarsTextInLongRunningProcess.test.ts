import { describe, expect, test } from "@jest/globals";
import childProcess from "child_process";
import path from "path";

/*
 * AN EMAIL WITH A BODY OF MEGABYTES, SENT BY A PROCESS THAT HAS BEEN RUNNING
 * A WHILE.
 *
 * V8 matches a regular expression on a backtracking stack that can grow with
 * every character a quantifier takes, and once a process has compiled enough
 * code, V8 stops optimizing the regular expressions it compiles - which
 * roughly doubles that stack. A notification worker that has been up a while
 * gets there, and so does a jest worker that has run a few hundred test
 * files: there, Handlebars ran out of stack ("Maximum call stack size
 * exceeded") reading a four-megabyte body, and the email was never sent
 * (MailServiceSizeLimit failed so in CI). Whether it did depended on what the
 * process had run before.
 *
 * So the rendering of such a body runs here in a node process started with
 * --no-regexp-optimization, the state such a process reaches, with the
 * module loaded through ts-node.
 */

const APP_ROOT: string = path.resolve(__dirname, "..", "..");

interface Attempt<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

interface ProcessReport {
  handlebarsReadsTheBody: Attempt<boolean>;
  bodyWithNoMustache: Attempt<boolean>;
  bodyWithMustaches: Attempt<boolean>;
}

function runWithUnoptimizedRegularExpressions(): ProcessReport {
  const output: string = childProcess.execFileSync(
    process.execPath,
    [
      "--no-regexp-optimization",
      "-e",
      String.raw`
        require("ts-node").register({
          transpileOnly: true,
          compilerOptions: { module: "commonjs" },
        });

        const Handlebars = require("handlebars");
        const HandlebarsText = require("./FeatureSet/Notification/Utils/HandlebarsText").default;

        const attempt = (work) => {
          try {
            return { ok: true, value: work() };
          } catch (error) {
            return { ok: false, error: String((error && error.message) || error).split("\n")[0] };
          }
        };

        const fourMegabytes = (letter) => {
          return letter.repeat(4 * 1024 * 1024);
        };

        const body = "<p>" + fourMegabytes("x") + "</p>";
        const vars = { name: "Ada <Lovelace>", yes: true, items: ["one", "two"] };

        // The state this is about: Handlebars itself runs out of stack here.
        const handlebarsReadsTheBody = attempt(() => {
          return Handlebars.compile(body)(vars) === body;
        });

        const bodyWithNoMustache = attempt(() => {
          return HandlebarsText.render(body, vars) === body;
        });

        /*
         * Text after the last mustache is what Handlebars runs out of stack
         * on: its lexer reads it with a greedy rule, once its lazy one
         * finds no "{{" ahead.
         */
        const bodyWithMustaches = attempt(() => {
          const first = fourMegabytes("a");
          const second = fourMegabytes("b");
          const last = fourMegabytes("c");
          const template =
            "<p>{{name}}</p>" + first +
            "{{#if yes}}" + second + "{{/if}}" +
            "{{#each items}}<i>{{this}}</i>{{/each}}" + last;

          return (
            HandlebarsText.render(template, vars) ===
            "<p>Ada &lt;Lovelace&gt;</p>" + first + second + "<i>one</i><i>two</i>" + last
          );
        });

        process.stdout.write(
          JSON.stringify({ handlebarsReadsTheBody, bodyWithNoMustache, bodyWithMustaches }),
        );
      `,
    ],
    {
      cwd: APP_ROOT,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );

  return JSON.parse(output) as ProcessReport;
}

describe("an email body of megabytes, in a process that has been running a while", () => {
  const report: ProcessReport = runWithUnoptimizedRegularExpressions();

  test("is the state where Handlebars runs out of stack reading such a body", () => {
    expect(report.handlebarsReadsTheBody.ok).toBe(false);
    expect(report.handlebarsReadsTheBody.error).toContain(
      "Maximum call stack size exceeded",
    );
  });

  test("a body with no mustache is sent as it is", () => {
    expect(report.bodyWithNoMustache).toEqual({ ok: true, value: true });
  });

  test("a body with mustaches around megabytes of text is rendered in full", () => {
    expect(report.bodyWithMustaches).toEqual({ ok: true, value: true });
  });
});
