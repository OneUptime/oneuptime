/*
 * The Node.js service images run their start script through sh, not npm.
 *
 * `npm start` stays running as node's parent, so the container holds two
 * Node.js processes. The Kubernetes agent's eBPF instrumentation (OBI) installs
 * its Node.js agent through the inspector that SIGUSR1 opens on
 * 127.0.0.1:9229, a port every process in the pod shares, so with npm there the
 * agent can land in npm twice and never in the app. On the test cluster it did
 * in the App and Probe pods, and not in the Home and Worker pods: none of the
 * App's Postgres, Redis or outgoing HTTP calls joined the trace of the request
 * that made them, and Redis commands were handed to whichever request ran last.
 *
 * So each image's production CMD is exactly `sh -c <package.json's start
 * script>`, and that script execs node: sh is replaced by node, and npm never
 * runs. Pinning the CMD to the script keeps the two from drifting apart, since
 * `npm start` still runs the script outside the image.
 */

const fs = require("fs");
const path = require("path");

const {
  render,
  parseStages,
  instructions,
} = require("./Utils/DockerfileTemplate");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

// The images that ran `npm start`, and how many production stages each ends
// in: the App builds the Enterprise and Community images from one template.
// The Worker runs the App image.
const IMAGES = [
  { packageName: "App", finalStages: 2 },
  { packageName: "Home", finalStages: 1 },
  { packageName: "Probe", finalStages: 1 },
  { packageName: "Runner", finalStages: 1 },
  { packageName: "TestServer", finalStages: 1 },
];

const PACKAGE_MANAGER = /\b(npm|npx|yarn|pnpm)\b/;

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function startScript(packageName) {
  return JSON.parse(read(`packages/${packageName}/package.json`)).scripts.start;
}

// Every CMD and ENTRYPOINT in the production render, per stage. file.Exists
// is answered from the repository root, where configure.sh runs gomplate.
function productionCommands(packageName) {
  const stages = parseStages(
    render(read(`packages/${packageName}/Dockerfile.tpl`), "production", {
      fileExists: (relativePath) => {
        return fs.existsSync(path.join(REPO_ROOT, relativePath));
      },
    }),
  );

  return stages.flatMap((stage) => {
    return instructions(stage.body)
      .filter((instruction) => {
        return /^(CMD|ENTRYPOINT) /.test(instruction);
      })
      .map((instruction) => {
        return { stage: stage.name, instruction };
      });
  });
}

describe.each(IMAGES)(
  "packages/$packageName/Dockerfile.tpl",
  ({ packageName, finalStages }) => {
    const start = startScript(packageName);
    const commands = productionCommands(packageName);
    const cmds = commands.filter(({ instruction }) => {
      return instruction.startsWith("CMD ");
    });

    test("the start script execs node, so sh hands the process over to it", () => {
      expect(start).toMatch(/&& exec node /);
      expect(start).not.toMatch(PACKAGE_MANAGER);
    });

    test("every production CMD is sh -c with the start script, in JSON form", () => {
      expect(cmds).toHaveLength(finalStages);

      for (const { instruction } of cmds) {
        expect(JSON.parse(instruction.slice("CMD ".length))).toEqual([
          "sh",
          "-c",
          start,
        ]);
      }
    });

    test("no production CMD or ENTRYPOINT runs a package manager", () => {
      for (const { instruction } of commands) {
        expect(instruction).not.toMatch(PACKAGE_MANAGER);
      }
    });
  },
);
