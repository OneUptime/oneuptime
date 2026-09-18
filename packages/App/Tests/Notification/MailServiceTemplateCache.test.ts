/*
 * PasswordHash reaches this suite through MailService -> EmailLogService and
 * fails ts-jest compilation on TS 5.9 (pre-existing TS2345). Nothing here
 * exercises it, so replace it before the import graph drags it into
 * compilation — same workaround as the Telemetry suites in this repo.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { afterEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import fsp from "fs/promises";
import Handlebars from "handlebars";
import Path from "path";

/*
 * compileEmailBody caches the compiled Handlebars delegate per template name,
 * so parse/codegen runs once per template type per process instead of once
 * per email. These tests pin the cache behavior: compile-once in production
 * mode, per-type isolation, the development-mode hot-reload bypass, failures
 * never being memoized, and rendered output staying per-call.
 *
 * The cache is intentionally bypassed when IsDevelopment (template
 * hot-reload), and App's npm test script exports config.env which sets
 * ENVIRONMENT=development — so every test loads MailService through
 * jest.isolateModules with ENVIRONMENT forced explicitly, never relying on
 * the ambient environment. fs/promises is a core module shared across
 * isolate contexts, so the fsp spies below still observe the isolated
 * service's reads; handlebars is not, so each load registers partials and
 * spies compile on its own isolated environment.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Notification",
  "Templates",
);

type SpyLike = {
  mock: { calls: Array<Array<unknown>> };
  mockRestore: () => void;
};

type Vars = Record<string, string>;

function inviteVars(projectName: string): Vars {
  return {
    projectName: projectName,
    signInLink: "https://oneuptime.test/accounts",
    registerLink: "https://oneuptime.test/accounts/register",
    homeUrl: "https://oneuptime.test",
    isInvitationAccepted: "false",
    isNewUser: "false",
  };
}

/*
 * Mirrors FeatureSet/Notification/Utils/Handlebars.ts on a given Handlebars
 * environment. Partials are registered pre-compiled (as the util does), so
 * render-time partial resolution never calls env.compile and the compile
 * spies below count only template compiles.
 */
function registerTemplateEnvironment(hb: typeof Handlebars): void {
  const partialsDir: string = Path.resolve(TEMPLATES_DIR, "Partials");

  for (const filename of fs.readdirSync(partialsDir)) {
    const matches: RegExpMatchArray | null = filename.match(/^(.*)\.hbs$/);

    if (!matches) {
      continue;
    }

    hb.registerPartial(
      matches[1]!,
      hb.compile(
        fs.readFileSync(Path.resolve(partialsDir, filename), {
          encoding: "utf8",
        }),
      ),
    );
  }

  hb.registerHelper("ifCond", function (v1: any, v2: any, options: any) {
    // @ts-expect-error - Handlebars uses dynamic this context for template helpers
    return v1 === v2 ? options.fn(this) : options.inverse(this);
  });

  hb.registerHelper("ifNotCond", function (v1: any, v2: any, options: any) {
    // @ts-expect-error - Handlebars uses dynamic this context for template helpers
    return v1 !== v2 ? options.fn(this) : options.inverse(this);
  });

  hb.registerHelper("concat", (v1: any, v2: any) => {
    return v1 + v2;
  });
}

type IsolatedMailEnvironment = {
  service: any;
  hb: typeof Handlebars;
};

function loadMailService(environment: string): IsolatedMailEnvironment {
  const originalEnvironment: string | undefined = process.env["ENVIRONMENT"];
  process.env["ENVIRONMENT"] = environment;

  let service: any = null;
  let hb: typeof Handlebars | null = null;

  try {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      hb = require("handlebars");
      registerTemplateEnvironment(hb!);
      service =
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
        require("../../FeatureSet/Notification/Services/MailService").default;
    });
  } finally {
    if (originalEnvironment === undefined) {
      delete process.env["ENVIRONMENT"];
    } else {
      process.env["ENVIRONMENT"] = originalEnvironment;
    }
  }

  return { service: service, hb: hb! };
}

function compileEmailBody(
  env: IsolatedMailEnvironment,
  templateType: EmailTemplateType,
  vars: Vars,
): Promise<string> {
  return env.service.compileEmailBody(templateType, vars);
}

function templateMemo(
  env: IsolatedMailEnvironment,
): Map<string, Handlebars.TemplateDelegate> {
  return env.service.compiledEmailTemplates;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("MailService.compileEmailBody - compiled template cache", () => {
  test("compiles and reads the template file once across repeated sends", async () => {
    const env: IsolatedMailEnvironment = loadMailService("production");
    const compileSpy: SpyLike = jest.spyOn(
      env.hb,
      "compile",
    ) as unknown as SpyLike;
    const readSpy: SpyLike = jest.spyOn(fsp, "readFile") as unknown as SpyLike;

    await compileEmailBody(
      env,
      EmailTemplateType.InviteMember,
      inviteVars("Cache Alpha Project"),
    );
    await compileEmailBody(
      env,
      EmailTemplateType.InviteMember,
      inviteVars("Cache Beta Project"),
    );

    expect(compileSpy.mock.calls.length).toBe(1);
    expect(readSpy.mock.calls.length).toBe(1);
  });

  test("caches the delegate, not the rendered HTML", async () => {
    const env: IsolatedMailEnvironment = loadMailService("production");

    const first: string = await compileEmailBody(
      env,
      EmailTemplateType.InviteMember,
      inviteVars("Cache Alpha Project"),
    );
    const second: string = await compileEmailBody(
      env,
      EmailTemplateType.InviteMember,
      inviteVars("Cache Beta Project"),
    );

    expect(first).not.toBe(second);
    expect(first).toContain("Cache Alpha Project");
    expect(first).not.toContain("Cache Beta Project");
    expect(second).toContain("Cache Beta Project");
    expect(second).not.toContain("Cache Alpha Project");
  });

  test("caches per template type and renders each from its own template", async () => {
    const env: IsolatedMailEnvironment = loadMailService("production");
    const compileSpy: SpyLike = jest.spyOn(
      env.hb,
      "compile",
    ) as unknown as SpyLike;
    const readSpy: SpyLike = jest.spyOn(fsp, "readFile") as unknown as SpyLike;

    const inviteHtml: string = await compileEmailBody(
      env,
      EmailTemplateType.InviteMember,
      inviteVars("Cache Alpha Project"),
    );
    const forgotHtml: string = await compileEmailBody(
      env,
      EmailTemplateType.ForgotPassword,
      {
        tokenVerifyUrl: "https://oneuptime.test/reset-password/token-123",
        homeUrl: "https://oneuptime.test",
      },
    );

    // Repeat sends of both types hit the memo.
    await compileEmailBody(
      env,
      EmailTemplateType.InviteMember,
      inviteVars("Cache Beta Project"),
    );
    await compileEmailBody(env, EmailTemplateType.ForgotPassword, {
      tokenVerifyUrl: "https://oneuptime.test/reset-password/token-456",
      homeUrl: "https://oneuptime.test",
    });

    expect(compileSpy.mock.calls.length).toBe(2);
    expect(readSpy.mock.calls.length).toBe(2);

    expect(inviteHtml).toContain("Invited to Cache Alpha Project");
    expect(inviteHtml).not.toContain("Reset Your Password");
    expect(forgotHtml).toContain("Reset Your Password");
    expect(forgotHtml).toContain(
      "https://oneuptime.test/reset-password/token-123",
    );
    expect(forgotHtml).not.toContain("Invited");
  });

  test("development mode re-reads and recompiles on every send (hot-reload)", async () => {
    const env: IsolatedMailEnvironment = loadMailService("development");
    const compileSpy: SpyLike = jest.spyOn(
      env.hb,
      "compile",
    ) as unknown as SpyLike;
    const readSpy: SpyLike = jest.spyOn(fsp, "readFile") as unknown as SpyLike;

    const first: string = await compileEmailBody(
      env,
      EmailTemplateType.InviteMember,
      inviteVars("Dev Alpha Project"),
    );
    const second: string = await compileEmailBody(
      env,
      EmailTemplateType.InviteMember,
      inviteVars("Dev Beta Project"),
    );

    expect(readSpy.mock.calls.length).toBe(2);
    expect(compileSpy.mock.calls.length).toBe(2);
    expect(first).toContain("Dev Alpha Project");
    expect(second).toContain("Dev Beta Project");
  });

  test("a failed template read is not memoized and the next send recovers", async () => {
    const env: IsolatedMailEnvironment = loadMailService("production");

    jest
      .spyOn(fsp, "readFile")
      .mockRejectedValueOnce(new Error("disk exploded"));

    await expect(
      compileEmailBody(
        env,
        EmailTemplateType.InviteMember,
        inviteVars("Cache Alpha Project"),
      ),
    ).rejects.toThrow("disk exploded");

    expect(templateMemo(env).size).toBe(0);

    // The spy falls back to the real readFile after the queued rejection.
    const html: string = await compileEmailBody(
      env,
      EmailTemplateType.InviteMember,
      inviteVars("Cache Alpha Project"),
    );

    expect(html).toContain("Cache Alpha Project");
    expect(templateMemo(env).size).toBe(1);
  });

  test("two concurrent first sends of one template both render correctly", async () => {
    const env: IsolatedMailEnvironment = loadMailService("production");

    const [first, second] = await Promise.all([
      compileEmailBody(
        env,
        EmailTemplateType.InviteMember,
        inviteVars("Cache Alpha Project"),
      ),
      compileEmailBody(
        env,
        EmailTemplateType.InviteMember,
        inviteVars("Cache Beta Project"),
      ),
    ]);

    expect(first).toContain("Cache Alpha Project");
    expect(second).toContain("Cache Beta Project");

    // Last write wins; the memo holds exactly one delegate for the type.
    expect(templateMemo(env).size).toBe(1);

    const third: string = await compileEmailBody(
      env,
      EmailTemplateType.InviteMember,
      inviteVars("Cache Gamma Project"),
    );

    expect(third).toContain("Cache Gamma Project");
  });
});
