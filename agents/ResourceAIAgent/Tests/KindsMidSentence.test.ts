import "./Helpers/TestSupport";
import assert from "assert";
import fs from "fs";
import path from "path";
import { describe, test } from "node:test";
import {
  describeDefaultIdentity,
  resolveIdentity,
  ResolvedIdentity,
} from "../Config";
import { ClaimedJob, getJobRefusal, parseClaimedJob } from "../JobLoop";
import {
  DUPLICATE_AGENT_AFTER_MS,
  planRegistrationRetry,
  RegistrationRetryPlan,
} from "../Registration";
import { IngestResponse } from "../IngestClient";
import { testPayload } from "./Helpers/FakeOneUptime";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
  ALL_AI_RESOURCE_TYPES,
  AiResourceTypeInfo,
} from "../Common/Types/ResourceAiAgent/AiResourceType";

/*
 * THE AGENT'S OWN MESSAGES NAME ITS KIND OF RESOURCE AS A SENTENCE DOES
 * (#8250).
 *
 * Each kind of resource has a label (displayName: "Host", "Database
 * server", for the start of a line) and a name for the middle of a
 * sentence (sentenceName: "host", "database server"). The agent's own
 * messages, which operators read in its logs and its setup checks, put the
 * label mid-sentence: "This Host is named "localhost" ...", "Read this
 * Host's name after 3 attempts", "it must name a Database server of the
 * project", and, with "a" before it, "a AWS account" and "a OpenStack
 * cloud". They now say sentenceName, and every message that names the kind
 * puts "this", "each" or "the" before it, so no article has to agree with
 * the name.
 *
 * Checked for every kind on the messages a test can build without a
 * resource (a job's refusal, the registration's answers, the identity
 * checks), and on the agent's own source, so a new message cannot put the
 * label after an article again.
 */

// The tests run from build/dist/Tests: the agent's own sources are three folders up.
const AGENT_DIR: string = path.resolve(__dirname, "..", "..", "..");

// The agent's own files: not its byte-identical copy of Common (Scripts/SyncCommon.js).
const OWN_SOURCE_DIRS: ReadonlyArray<string> = [".", "Executors"];

// A label written after a word that puts it mid-sentence.
const LABEL_MID_SENTENCE: RegExp =
  /\b(?:this|that|a|an|the|every|each|which|same|its own)\s+\$\{[^}]*\.displayName\}/i;

// A name "a" does not agree with: "AWS account", "OpenStack cloud".
const STARTS_WITH_A_VOWEL: RegExp = /^[AEIOU]/i;

// What the messages used to write, for a kind whose label is not its sentence name.
function wrongWordings(info: AiResourceTypeInfo): Array<string> {
  const wrong: Array<string> = [];

  if (info.displayName !== info.sentenceName) {
    for (const before of ["this", "a", "an", "the", "every", "each"]) {
      wrong.push(`${before} ${info.displayName}`);
    }
  }

  // "a AWS account", "a OpenStack cloud": an article that does not agree.
  if (STARTS_WITH_A_VOWEL.test(info.sentenceName)) {
    wrong.push(`a ${info.sentenceName}`);
  }

  return wrong;
}

function assertSaysItsSentenceName(
  type: AiResourceType,
  message: string,
): void {
  const info: AiResourceTypeInfo = AI_RESOURCE_TYPE_INFO[type];
  // The agent's own name is a name ("the Host AI agent"), not the kind mid-sentence.
  let words: string = message;

  for (const other of ALL_AI_RESOURCE_TYPES) {
    words = words.split(AI_RESOURCE_TYPE_INFO[other].agentDisplayName).join("");
  }

  for (const wrong of wrongWordings(info)) {
    assert.ok(!words.includes(wrong), `${type}: "${message}" says "${wrong}"`);
  }
}

function job(type: AiResourceType): ClaimedJob {
  return parseClaimedJob({
    jobId: "job-1",
    origin: "AiInvestigation",
    stepId: "step-1",
    stepType: "ResourceCommand",
    timeoutInMs: 30_000,
    payload: testPayload({ resourceType: type }),
  })!;
}

function refusalResponse(reason: string, message: string): IngestResponse {
  return {
    kind: "auth",
    status: 403,
    body: { reason, message },
    message,
    retryAfterSeconds: null,
  };
}

// An agent of `other` kind, given a job for `type`.
function otherKindOf(type: AiResourceType): AiResourceType {
  return type === AiResourceType.Host
    ? AiResourceType.DatabaseServer
    : AiResourceType.Host;
}

describe("the names this test reads", () => {
  test("give every kind a sentence name, and the kinds whose label differs", () => {
    const apart: Array<string> = ALL_AI_RESOURCE_TYPES.filter(
      (type: AiResourceType): boolean => {
        const info: AiResourceTypeInfo = AI_RESOURCE_TYPE_INFO[type];
        return info.displayName !== info.sentenceName;
      },
    );

    assert.deepStrictEqual(
      apart.sort(),
      [AiResourceType.DatabaseServer, AiResourceType.Host].sort(),
    );
    assert.strictEqual(
      AI_RESOURCE_TYPE_INFO[AiResourceType.Host].sentenceName,
      "host",
    );
    assert.strictEqual(
      AI_RESOURCE_TYPE_INFO[AiResourceType.DatabaseServer].sentenceName,
      "database server",
    );
  });

  test("find the wordings that were wrong", () => {
    assert.ok(
      wrongWordings(AI_RESOURCE_TYPE_INFO[AiResourceType.Host]).includes(
        "this Host",
      ),
    );
    assert.ok(
      wrongWordings(AI_RESOURCE_TYPE_INFO[AiResourceType.AwsAccount]).includes(
        "a AWS account",
      ),
    );
    assert.ok(
      wrongWordings(
        AI_RESOURCE_TYPE_INFO[AiResourceType.OpenStackCloud],
      ).includes("a OpenStack cloud"),
    );
    assert.deepStrictEqual(
      wrongWordings(AI_RESOURCE_TYPE_INFO[AiResourceType.DockerHost]),
      [],
    );
  });

  test("read the agent's own name as a name, and the kind after it", () => {
    assert.doesNotThrow(() => {
      assertSaysItsSentenceName(
        AiResourceType.Host,
        "Refused by the Host AI agent: it does not know which host it serves.",
      );
    });
    assert.throws(() => {
      assertSaysItsSentenceName(
        AiResourceType.Host,
        "Refused by the Host AI agent: it does not know which Host it serves, so the Host is idle.",
      );
    });
  });
});

describe("a job for another kind of resource", () => {
  for (const type of ALL_AI_RESOURCE_TYPES) {
    test(`is refused by the ${type} agent in its sentence name`, () => {
      const other: AiResourceType = otherKindOf(type);
      const refusal: string = getJobRefusal(job(other), type)!;

      assert.ok(
        refusal.endsWith(
          `this agent serves only its own ${AI_RESOURCE_TYPE_INFO[type].sentenceName}.`,
        ),
        refusal,
      );
      assert.ok(
        refusal.includes(
          `another kind of resource (${AI_RESOURCE_TYPE_INFO[other].sentenceName})`,
        ),
        refusal,
      );
      assertSaysItsSentenceName(type, refusal);
      assertSaysItsSentenceName(other, refusal);
    });
  }

  test("reads for a Host agent as a sentence does", () => {
    assert.strictEqual(
      getJobRefusal(job(AiResourceType.AwsAccount), AiResourceType.Host),
      "Refused by the Host AI agent: this command is for another kind of resource (AWS account), and this agent serves only its own host.",
    );
  });
});

describe("the registration's answers", () => {
  for (const type of ALL_AI_RESOURCE_TYPES) {
    const name: string = AI_RESOURCE_TYPE_INFO[type].sentenceName;

    test(`name a ${type} in the middle of a sentence as ${name}`, () => {
      const notFound: RegistrationRetryPlan = planRegistrationRetry({
        response: refusalResponse("resource_not_found", "Not found."),
        consecutiveFailures: 1,
        context: { resourceType: type, identitySource: "THE_VARIABLE" },
      });
      const waiting: RegistrationRetryPlan = planRegistrationRetry({
        response: refusalResponse(
          "previous_instance_online",
          "The previous agent is online.",
        ),
        consecutiveFailures: 1,
        context: { resourceType: type },
      });
      const duplicate: RegistrationRetryPlan = planRegistrationRetry({
        response: refusalResponse(
          "previous_instance_online",
          "The previous agent is online.",
        ),
        consecutiveFailures: 1,
        context: { resourceType: type, resourceIdentifier: "id-1" },
        waitingForMs: DUPLICATE_AGENT_AFTER_MS,
      });

      assert.match(
        notFound.message,
        new RegExp(`it must be the name of this ${name} in the project`),
      );
      assert.ok(
        waiting.message.startsWith(
          `Waiting for this ${name}'s previous AI agent to go offline`,
        ),
        waiting.message,
      );
      assert.ok(
        duplicate.message.includes(`online as this ${name} ("id-1")`),
        duplicate.message,
      );
      assert.ok(duplicate.message.includes(`Give each ${name} its own`));

      for (const plan of [notFound, waiting, duplicate]) {
        assertSaysItsSentenceName(type, plan.message);
      }
    });
  }
});

describe("the identity checks", () => {
  for (const type of ALL_AI_RESOURCE_TYPES) {
    const info: AiResourceTypeInfo = AI_RESOURCE_TYPE_INFO[type];

    test(`say ${info.sentenceName} mid-sentence for a ${type}`, () => {
      const tooLong: ResolvedIdentity = resolveIdentity(
        { ONEUPTIME_AI_AGENT_RESOURCE_NAME: "x".repeat(300) },
        type,
      );
      const unset: ResolvedIdentity = resolveIdentity({}, type);

      for (const message of [
        ...tooLong.problems,
        ...tooLong.warnings,
        ...unset.problems,
        ...unset.warnings,
      ]) {
        assertSaysItsSentenceName(type, message);
      }

      for (const placeholder of info.defaultIdentityPlaceholders) {
        const warning: string = describeDefaultIdentity({
          type,
          identifier: placeholder,
          source: null,
        })!;

        assert.ok(
          warning.startsWith(
            `This ${info.sentenceName} is named "${placeholder}"`,
          ),
          warning,
        );
        assertSaysItsSentenceName(type, warning);
      }
    });
  }

  test("say host for a Host that names itself too long", () => {
    const tooLong: ResolvedIdentity = resolveIdentity(
      { HOST_NAME: "h".repeat(300) },
      AiResourceType.Host,
    );

    assert.match(
      tooLong.problems.join(" "),
      /^The host identity from HOST_NAME is 300 characters long/,
    );
  });
});

describe("the agent's own source", () => {
  function ownSourceFiles(): Array<string> {
    const files: Array<string> = [];

    for (const dir of OWN_SOURCE_DIRS) {
      for (const name of fs.readdirSync(path.join(AGENT_DIR, dir))) {
        if (name.endsWith(".ts") && !name.endsWith(".d.ts")) {
          files.push(path.join(dir, name));
        }
      }
    }

    return files;
  }

  test("is read, the executors with it", () => {
    const files: Array<string> = ownSourceFiles();

    assert.ok(files.includes("Config.ts"));
    assert.ok(files.includes("Registration.ts"));
    assert.ok(files.includes(path.join("Executors", "PrepareGuard.ts")));
  });

  test("never puts a kind's label after a word that makes it mid-sentence", () => {
    const found: Array<string> = [];

    for (const file of ownSourceFiles()) {
      const lines: Array<string> = fs
        .readFileSync(path.join(AGENT_DIR, file), "utf8")
        .split("\n");

      lines.forEach((line: string, index: number): void => {
        if (LABEL_MID_SENTENCE.test(line)) {
          found.push(`${file}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    assert.deepStrictEqual(found, []);
  });

  test("the check finds the old wordings", () => {
    assert.ok(LABEL_MID_SENTENCE.test("`This ${info.displayName} is named`"));
    assert.ok(LABEL_MID_SENTENCE.test("`serves a ${info.displayName}.`"));
    assert.ok(
      !LABEL_MID_SENTENCE.test("Logger.info(`${info.displayName} access`"),
    );
    assert.ok(!LABEL_MID_SENTENCE.test("`This ${info.sentenceName} is named`"));
  });
});
