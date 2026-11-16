import fs from "fs";
import path from "path";
import vm from "vm";
import ts from "typescript";
import {
  ON_CALL_PAGE_MERGE_UNNAMED_POLICY,
  OnCallPageCoverKind,
  OnCallPageCoverName,
  getOnCallPageMergeTakenOverMessage,
  getOnCallPageMergedLine,
  getOnCallPageMergedMessage,
  readOnCallPageMergedLine,
} from "../../../Types/OnCallDutyPolicy/OnCallPageMerge";
import UserNotificationExecutionStatus from "../../../Types/UserNotification/UserNotificationExecutionStatus";
import { ON_CALL_ALREADY_PAGED_STATUS_LABEL } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ExecutionLogs/OnCallLogStatusLabels";
import { describe, expect, test } from "@jest/globals";

/*
 * THE MOBILE APP'S COPY OF A MERGED PAGE SAYS WHAT THE SERVER'S SAYS
 * (#8858, Types/OnCallDutyPolicy/OnCallPageMerge).
 *
 * My Pages tells a page merged into another page of the person's - two
 * policies, or a policy and a page sent from a chat or by a workflow
 * (#8859), paging them about one record - by its stored status, and says
 * which page to answer from its line: "Already paged about this by
 * Payments, so not paged again." The app is built without Common's runtime
 * code, so it keeps its own copy of the status and of how the line reads
 * back (MobileApp/src/oncall/mergedPage). A copy drifts, and every drift is
 * silent: a merged page would read Not acknowledged again, or its line name
 * the wrong page.
 *
 * So this suite compiles the app's file as it is, runs it in a fresh
 * context, and asks it about every line the server writes - each kind of
 * page, names with the lines' own words in them - and about lines that are
 * no merged page's.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");
const MOBILE_FILE: string = path.join(
  REPOSITORY_ROOT,
  "packages/MobileApp/src/oncall/mergedPage.ts",
);

type MobileCover =
  | { kind: "policy"; name: string | null }
  | { kind: "person"; name: string }
  | { kind: "workflow"; name: string };

interface MobileMergedPage {
  MERGED_PAGE_TEXT: { status: string; label: string };
  readMergedPageCover: (line: string | null | undefined) => MobileCover | null;
  isMergedPage: (page: {
    status?: string | undefined;
    acknowledgedAt?: string | null | undefined;
  }) => boolean;
  getMergedPageLine: (line: string | null | undefined) => string | null;
}

// The app's file compiled to CommonJS as it is and run in a fresh context.
function loadMobile(): MobileMergedPage {
  const source: string = fs.readFileSync(MOBILE_FILE, "utf8");

  const compiled: string = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
      esModuleInterop: true,
    },
    fileName: "mergedPage.ts",
  }).outputText;

  const moduleObject: { exports: Record<string, unknown> } = { exports: {} };

  vm.runInNewContext(compiled, {
    module: moduleObject,
    exports: moduleObject.exports,
    require: (specifier: string): never => {
      throw new Error(
        `The app's mergedPage.ts imports ${specifier}: it must import nothing, so this suite can run it as it is.`,
      );
    },
  });

  return moduleObject.exports as unknown as MobileMergedPage;
}

const MOBILE: MobileMergedPage = loadMobile();

// The app's kinds, by the server's.
const MOBILE_KIND: Record<OnCallPageCoverKind, MobileCover["kind"]> = {
  [OnCallPageCoverKind.Policy]: "policy",
  [OnCallPageCoverKind.PersonPage]: "person",
  [OnCallPageCoverKind.WorkflowPage]: "workflow",
};

// Names with the lines' own words in them, and the punctuation names have.
const NAMES: Array<string> = [
  "Payments",
  "Jane Doe",
  "jane@example.com",
  "Nightly Checks",
  "Payments, EU",
  "Tier 1. Database",
  "the workflow team",
  "directly about this by Jane",
  "through the workflow Nightly",
  "another on-call policy team",
  "Zoë Ångström",
  "مدیر شیفت",
];

function asMobile(cover: OnCallPageCoverName | null): MobileCover | null {
  if (!cover) {
    return null;
  }

  return { kind: MOBILE_KIND[cover.kind], name: cover.name } as MobileCover;
}

describe("the app reads every merged page's line as the server does", () => {
  for (const kind of Object.values(OnCallPageCoverKind)) {
    test.each(NAMES)(`a ${kind} page named %j`, (name: string) => {
      const line: string = getOnCallPageMergedLine({ kind: kind, name: name });

      expect(MOBILE.readMergedPageCover(line)).toEqual(
        asMobile(readOnCallPageMergedLine(line)),
      );
      expect(MOBILE.readMergedPageCover(line)).toEqual({
        kind: MOBILE_KIND[kind],
        name: name,
      });
    });
  }

  test("a policy the line names none of", () => {
    const line: string = getOnCallPageMergedMessage({ policyName: null });

    expect(line).toContain(ON_CALL_PAGE_MERGE_UNNAMED_POLICY);
    expect(MOBILE.readMergedPageCover(line)).toEqual({
      kind: "policy",
      name: null,
    });
    expect(MOBILE.readMergedPageCover(line)).toEqual(
      asMobile(readOnCallPageMergedLine(line)),
    );
  });

  test.each([
    getOnCallPageMergeTakenOverMessage({ policyName: "Payments" }),
    getOnCallPageMergeTakenOverMessage({
      policyName: "Payments",
      isDirectPage: true,
    }),
    getOnCallPageMergeTakenOverMessage({ policyName: null }),
    "Already paged directly about this, so not paged again.",
    "Notification Sent",
    "",
  ])("a line that is no merged page's is none to both: %j", (line: string) => {
    expect(readOnCallPageMergedLine(line)).toBeNull();
    expect(MOBILE.readMergedPageCover(line)).toBeNull();
  });
});

describe("the app's status and label are the server's and the Dashboard's", () => {
  test("a merged page's status, as the server stores it", () => {
    expect(MOBILE.MERGED_PAGE_TEXT.status).toBe(
      UserNotificationExecutionStatus.AlreadyPaged,
    );
    expect(
      MOBILE.isMergedPage({
        status: UserNotificationExecutionStatus.AlreadyPaged,
        acknowledgedAt: null,
      }),
    ).toBe(true);
  });

  test("its label is the Dashboard's pill, in the app's sentence case", () => {
    expect(MOBILE.MERGED_PAGE_TEXT.label.toLowerCase()).toBe(
      ON_CALL_ALREADY_PAGED_STATUS_LABEL.toLowerCase(),
    );
  });

  test("every line the server writes is said as a page to answer, none as the server's English", () => {
    for (const kind of Object.values(OnCallPageCoverKind)) {
      const said: string | null = MOBILE.getMergedPageLine(
        getOnCallPageMergedLine({ kind: kind, name: "Jane Doe" }),
      );

      expect(said).toContain("Jane Doe");
      expect(said).toContain("answers this one too");
      expect(said).not.toContain("Already paged");
    }
  });
});
