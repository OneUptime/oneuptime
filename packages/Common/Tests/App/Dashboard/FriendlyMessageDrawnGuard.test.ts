// UX rule: Docs/ux/README.md#errors
import {
  findFriendlyDraws,
  findFriendlyDrawsInSources,
  formatFriendlyDraw,
  FriendlyDrawFinding,
  FriendlySource,
  listFriendlyScanFiles,
  REPOSITORY_ROOT,
} from "../../FriendlyMessageDrawnScan";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #7537: API.getFriendlyMessage answers a failure nobody explained
 * with a few fixed English sentences: a gateway's 502 or 504 is
 * SERVER_DOWN_MESSAGE, no key in any language, and a server failure comes
 * with its reference filled in. The shared error places and every card
 * sentence with {{error}} say these in the reader's language; but about two
 * hundred Dashboard places drew the answer on its own - `<p>{error}</p>`,
 * `{turnMonitoringOn.error}`, an empty state's `description={error}` - so
 * a German or a Persian page read "Error connecting to server. Please try
 * again in few minutes." and a server failure's reference had no copy
 * button.
 *
 * An error drawn on its own is drawn with ErrorInSentence now
 * (Common/UI/Components/ErrorMessage/ErrorSentence), or handed to a shared
 * place that explains it (Alert's title, ErrorMessage, ErrorExplanation,
 * TableEmptyState, ConfirmModal, ErrorLine). This guard reads every
 * browser module - each feature set's (the Dashboard, Accounts, the Admin
 * Dashboard, status pages, public dashboards), the shared UI's and ee/'s
 * (FriendlyMessageDrawnScan, through the TypeScript AST) and fails on a value set from API.getFriendlyMessage that
 * is drawn as a bare text child or handed to a text prop that draws it as
 * it is. The detector is pinned on snippets first - each way the answer was
 * drawn before, and each way it may be drawn now - then run over the tree,
 * with a negative control that puts a real file back the way it was.
 */

// Each finding as "<how> @<file>:<line>".
function judge(
  files: Array<{ file: string; lines: Array<string> }>,
): Array<string> {
  return findFriendlyDrawsInSources(
    files.map((file: { file: string; lines: Array<string> }) => {
      return { file: file.file, source: file.lines.join("\n") };
    }),
  ).map((finding: FriendlyDrawFinding): string => {
    return `${finding.how} @${finding.file}:${finding.line}`;
  });
}

function judgeOne(lines: Array<string>): Array<string> {
  return judge([{ file: "Fixture.tsx", lines }]);
}

describe("the detector finds each way the answer was drawn as it came", () => {
  test("a state set from it, drawn as a text child", () => {
    expect(
      judgeOne([
        "const Card = () => {",
        '  const [error, setError] = useState<string>("");',
        "  const save = async () => {",
        "    try { await x(); } catch (err) { setError(API.getFriendlyMessage(err)); }",
        "  };",
        '  return <p className="text-red-600">{error}</p>;',
        "};",
      ]),
    ).toEqual(["text child @Fixture.tsx:6"]);
  });

  test("inside a condition, an || or a ??, it is still the answer", () => {
    expect(
      judgeOne([
        "const [error, setError] = useState<string | null>(null);",
        "x.catch((err) => { setError(API.getFriendlyMessage(err)); });",
        "const A = () => <p>{error ? error : null}</p>;",
        'const B = () => <p>{error || "Could not save."}</p>;',
        'const C = () => <p>{error ?? ""}</p>;',
        "const D = () => <>{error && <span>{error}</span>}</>;",
      ]),
    ).toEqual([
      "text child @Fixture.tsx:3",
      "text child @Fixture.tsx:4",
      "text child @Fixture.tsx:5",
      "text child @Fixture.tsx:6",
    ]);
  });

  test("a variable declared or assigned with it", () => {
    expect(
      judgeOne([
        "const A = () => {",
        "  const message: string = API.getFriendlyMessage(e);",
        "  return <span>{message}</span>;",
        "};",
        "let said: string = '';",
        "said = BaseAPI.getFriendlyMessage(e);",
        "const B = () => <span>{said}</span>;",
      ]),
    ).toEqual(["text child @Fixture.tsx:3", "text child @Fixture.tsx:7"]);
  });

  test("an object state's property, set whole or from the state before", () => {
    expect(
      judgeOne([
        "const [state, setState] = useState<{ error: string }>({ error: '' });",
        "setState({ error: API.getFriendlyMessage(e) });",
        "const [other, setOther] = useState({ loadError: '' });",
        "setOther((previous) => ({ ...previous, loadError: API.getFriendlyMessage(e) }));",
        "const A = () => <p>{state.error}</p>;",
        "const B = () => <p>{other.loadError}</p>;",
      ]),
    ).toEqual(["text child @Fixture.tsx:5", "text child @Fixture.tsx:6"]);
  });

  test("a hook's returned property, in the file that calls the hook", () => {
    expect(
      judge([
        {
          file: "useTurnOn.ts",
          lines: [
            "export const useTurnOn = () => {",
            '  const [error, setError] = useState<string>("");',
            "  const turnOn = async () => { try { await x(); } catch (e) { setError(API.getFriendlyMessage(e)); } };",
            "  return { error, turnOn };",
            "};",
          ],
        },
        {
          file: "Hero.tsx",
          lines: [
            "const Hero = () => {",
            "  const turnOn = useTurnOn();",
            '  return <p role="alert">{turnOn.error}</p>;',
            "};",
            "const Other = () => {",
            "  const { error } = useTurnOn();",
            "  return <p>{error}</p>;",
            "};",
          ],
        },
      ]),
    ).toEqual(["text child @Hero.tsx:3", "text child @Hero.tsx:7"]);
  });

  test("a prop that draws its text as it is", () => {
    expect(
      judgeOne([
        'const [error, setError] = useState("");',
        "setError(API.getFriendlyMessage(e));",
        'const A = () => <EmptyState title="Nothing" description={error} />;',
        "const B = () => <IsolatedLine text={error} />;",
        "const C = () => <span title={error}>!</span>;",
      ]),
    ).toEqual([
      "EmptyState's description @Fixture.tsx:3",
      "IsolatedLine's text @Fixture.tsx:4",
      "span's title @Fixture.tsx:5",
    ]);
  });
});

describe("the detector lets each way the answer is drawn now through", () => {
  test("drawn with ErrorInSentence, ErrorExplanation, ErrorMessage, ErrorLine or ErrorSentence", () => {
    expect(
      judgeOne([
        'const [error, setError] = useState("");',
        "setError(API.getFriendlyMessage(e));",
        "const A = () => <p><ErrorInSentence message={error} showWhereToLook={true} /></p>;",
        "const B = () => <ErrorExplanation message={error} />;",
        "const C = () => <ErrorMessage message={error} />;",
        "const D = () => <ErrorLine message={error} whatFailed={w} />;",
        'const E = () => <ErrorSentence template="Couldn\'t load. {{error}}" error={error} />;',
      ]),
    ).toEqual([]);
  });

  test("handed to a shared place that explains it: Alert's title, TableEmptyState's description, ConfirmModal's description", () => {
    expect(
      judgeOne([
        'const [error, setError] = useState("");',
        "setError(API.getFriendlyMessage(e));",
        "const A = () => <Alert type={AlertType.DANGER} title={error} />;",
        'const B = () => <TableEmptyState title="Not loaded" description={error} />;',
        'const C = () => <ConfirmModal title="Error" description={error} />;',
        "const D = () => <InvestigationNotice indicator={i} title={error} />;",
      ]),
    ).toEqual([]);
  });

  test("an error nobody explained explained by hand, and only a written message drawn as it is", () => {
    expect(
      judgeOne([
        'const [error, setError] = useState("");',
        "setError(API.getFriendlyMessage(e));",
        "const A = () => <p>{isUnexplainedErrorMessage(error) ? <ErrorExplanation message={error} /> : error}</p>;",
        "const B = () => <p>{isSomethingElse(error) ? <b>!</b> : error}</p>;",
      ]),
    ).toEqual(["text child @Fixture.tsx:4"]);
  });

  test("a stored text of the server's, never set from the answer, is drawn as it is", () => {
    expect(
      judgeOne([
        "const Row = (props) => <p>{props.job.lastError}</p>;",
        'const [note, setNote] = useState("");',
        "setNote(response.data.message);",
        "const A = () => <p>{note}</p>;",
      ]),
    ).toEqual([]);
  });

  test("a module that draws nothing (a .ts file) has no findings", () => {
    expect(
      judge([
        {
          file: "Words.ts",
          lines: [
            "const message: string = API.getFriendlyMessage(e);",
            "export const x = `${message}`;",
          ],
        },
      ]),
    ).toEqual([]);
  });
});

/*
 * What is left as it is, file by file, with the reason: nothing, today.
 * A file named here must still have a finding, so the list never outlives
 * its reason.
 */
export const FRIENDLY_DRAW_EXCEPTIONS: Record<string, string> = {};

describe("every browser module", () => {
  const findings: Array<FriendlyDrawFinding> = findFriendlyDraws();

  test("the walk read them", () => {
    const files: Array<string> = listFriendlyScanFiles(REPOSITORY_ROOT);

    expect(files.length).toBeGreaterThan(3000);
    expect(
      files.some((file: string): boolean => {
        return file.endsWith(
          path.join(
            "Dashboard",
            "src",
            "Components",
            "Monitor",
            "Overview",
            "MonitorOverviewHero.tsx",
          ),
        );
      }),
    ).toBe(true);
  });

  test("draw API.getFriendlyMessage's answer in the reader's language, never as it came", () => {
    const left: Array<string> = findings
      .filter((finding: FriendlyDrawFinding): boolean => {
        return FRIENDLY_DRAW_EXCEPTIONS[finding.file] === undefined;
      })
      .map(formatFriendlyDraw);

    if (left.length > 0) {
      throw new Error(
        [
          `${left.length} place(s) draw API.getFriendlyMessage's answer as it came, so an error nobody explained reads English on every page and a server failure's reference has no copy button (#7537).`,
          "Draw it with <ErrorInSentence message={error} showWhereToLook={true} /> (Common/UI/Components/ErrorMessage/ErrorSentence), or hand it to ErrorMessage, ErrorLine or an Alert's title:",
          ...left.map((line: string): string => {
            return `  ${line}`;
          }),
        ].join("\n"),
      );
    }

    expect(left).toEqual([]);
  });

  test("every exception still has a finding", () => {
    for (const file of Object.keys(FRIENDLY_DRAW_EXCEPTIONS)) {
      expect({
        file,
        hasFinding: findings.some((finding: FriendlyDrawFinding) => {
          return finding.file === file;
        }),
      }).toEqual({ file, hasFinding: true });
    }
  });
});

/*
 * Negative controls: real files, each put back the way it drew its error,
 * are findings again.
 */
describe("a converted file put back is a finding again", () => {
  const read: (file: string) => FriendlySource = (
    file: string,
  ): FriendlySource => {
    return {
      file,
      source: fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8"),
    };
  };

  // The error drawn now, however the line is wrapped (a new one each time: it is global).
  const drawnNow: () => RegExp = (): RegExp => {
    return /<ErrorInSentence\s+message=\{turnMonitoringOn\.error\}\s+showWhereToLook=\{true\}\s*\/>/g;
  };

  test.each([
    "packages/App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorOverviewHero.tsx",
    "packages/App/FeatureSet/Dashboard/src/Components/Monitor/DisabledWarning.tsx",
    "packages/App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceStatusHero.tsx",
  ])("%s", (file: string) => {
    const hook: FriendlySource = read(
      "packages/App/FeatureSet/Dashboard/src/Components/Monitor/useTurnMonitoringOn.ts",
    );
    const source: FriendlySource = read(file);

    expect(source.source).toMatch(drawnNow());
    expect(findFriendlyDrawsInSources([hook, source])).toEqual([]);

    const putBack: FriendlySource = {
      file,
      source: source.source.replace(drawnNow(), "{turnMonitoringOn.error}"),
    };
    const found: Array<FriendlyDrawFinding> = findFriendlyDrawsInSources([
      hook,
      putBack,
    ]);

    expect(found.length).toBeGreaterThan(0);
    expect(
      found.every((finding: FriendlyDrawFinding): boolean => {
        return finding.text === "turnMonitoringOn.error";
      }),
    ).toBe(true);
  });

  test("CheckFromSentence drawing its error as an IsolatedLine's text", () => {
    const file: string =
      "packages/App/FeatureSet/Dashboard/src/Components/DataObservability/CheckFromSentence.tsx";
    const source: FriendlySource = read(file);
    const putBack: string = source.source
      .split("message: API.getFriendlyMessage(err),")
      .join("text: API.getFriendlyMessage(err),")
      .replace(
        "<ErrorLine\n            message={error.message}",
        "<IsolatedLine\n            text={error.text}",
      );

    expect(findFriendlyDrawsInSources([source])).toEqual([]);
    expect(
      findFriendlyDrawsInSources([{ file, source: putBack }]).map(
        (finding: FriendlyDrawFinding): string => {
          return finding.how;
        },
      ),
    ).toEqual(["IsolatedLine's text"]);
  });
});
