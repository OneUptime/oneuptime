import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { listScanRoots, listSourceFiles } from "../ForeignHiddenRuleGuard";
import {
  describeConditionalHookCall,
  HookCall,
  scanHookCalls,
} from "../Helpers/HookOrderScan";

/*
 * Every hook, on every render. The Dashboard's translation work put
 * translator hooks at the top of components that return early and call more
 * hooks after that return - the table's labels list (#4266), the filter
 * components (#4285), the custom script monitor summary (#4295) - and each
 * one then crashed the page the first time a mounted instance went from one
 * side of its return to the other. A type check cannot see it, and a test
 * only sees it when it renders that exact change with translations on.
 *
 * The detector lives in Tests/Helpers/HookOrderScan.ts. This file pins it on
 * inline modules first - every shape it must catch and every shape it must
 * leave alone - and then runs it over every component and hook in the
 * product: each feature set's browser source, Common/UI, the mobile app and,
 * when the checkout has it, ee/Dashboard and ee/AdminDashboard (the Common
 * Test job deletes ee/ first). There is no list of exceptions: a hook that
 * can be skipped is a bug, and a function named like a hook that is not one
 * is renamed.
 */

// packages/Common/Tests/UI -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

function relative(file: string): string {
  return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
}

function listGuardedFiles(): Array<string> {
  const roots: Array<string> = listScanRoots(REPOSITORY_ROOT);
  const mobileApp: string = path.join(
    REPOSITORY_ROOT,
    "packages",
    "MobileApp",
    "src",
  );

  if (fs.existsSync(mobileApp)) {
    roots.push(mobileApp);
  }

  return roots.flatMap(listSourceFiles);
}

interface ProductScan {
  files: Array<string>;
  calls: Array<HookCall>;
}

let cachedScan: ProductScan | null = null;

function scanProduct(): ProductScan {
  if (cachedScan) {
    return cachedScan;
  }

  const files: Array<string> = listGuardedFiles();
  const calls: Array<HookCall> = [];

  for (const file of files) {
    calls.push(...scanHookCalls(relative(file), fs.readFileSync(file, "utf8")));
  }

  cachedScan = { files, calls };

  return cachedScan;
}

// "Name hook why" for each call that can be skipped, in source order.
function conditionalCallsIn(
  source: string,
  file: string = "X.tsx",
): Array<string> {
  return scanHookCalls(file, source)
    .filter((call: HookCall): boolean => {
      return call.conditionalBecause !== null;
    })
    .map((call: HookCall): string => {
      return `${call.functionName} ${call.hook} ${call.conditionalBecause}`;
    });
}

describe("the detector", () => {
  test("a hook below an early return is reported, with the return's line", () => {
    expect(
      conditionalCallsIn(
        [
          "const List = (props) => {", // 1
          "  const t = useTranslator();", // 2
          "  if (!props.items.length) {", // 3
          "    return <p>{t.translateText('None')}</p>;", // 4
          "  }", // 5
          "  const [open, setOpen] = React.useState(false);", // 6
          "  return <ul />;", // 7
          "};", // 8
        ].join("\n"),
      ),
    ).toEqual(["List React.useState after the return at line 4"]);
  });

  test("the shape #4285 left in the filter components is reported", () => {
    expect(
      conditionalCallsIn(
        [
          "const DateFilter = <T,>(props: Props<T>): ReactElement => {",
          "  const translator: Translator = useTranslator();",
          "  if (props.filter.type !== FieldType.Date) {",
          "    return <></>;",
          "  }",
          "  const [operator, setOperator] = useState(detect(props));",
          "  useEffect(() => {",
          "    setOperator(detect(props));",
          "  }, [props.filterData]);",
          "  return <div />;",
          "};",
        ].join("\n"),
      ),
    ).toEqual([
      "DateFilter useState after the return at line 4",
      "DateFilter useEffect after the return at line 4",
    ]);
  });

  test("a return inside a loop, a switch or a try counts as an early return", () => {
    for (const statement of [
      "for (const x of xs) { if (x) { return null; } }",
      "switch (kind) { case 'a': return null; }",
      "try { if (bad) { return null; } } finally { done(); }",
    ]) {
      expect(
        conditionalCallsIn(
          `function useThing(xs) {\n  ${statement}\n  return useMemo(() => xs, [xs]);\n}`,
          "X.ts",
        ),
      ).toEqual(["useThing useMemo after the return at line 2"]);
    }
  });

  test.each([
    ["an if", "if (open) { useEffect(() => {}, []); }"],
    ["an else", "if (open) { go(); } else { useEffect(() => {}, []); }"],
    ["a loop", "for (const x of xs) { useRef(x); }"],
    ["a loop", "while (more()) { useRef(null); }"],
    ["a switch", "switch (kind) { case 'a': useContext(A); }"],
    ["a catch block", "try { go(); } catch { useState(0); }"],
    ["a ternary", "const v = open ? useMemo(() => 1, []) : 0;"],
    ["the right of ||", "const ref = props.formRef || useRef(null);"],
    ["the right of &&", "const v = open && useContext(A);"],
    ["the right of ??", "const v = props.value ?? useState(0)[0];"],
    ["the right of ||=", "let ref = props.formRef; ref ||= useRef(null);"],
  ])(
    "a hook only some paths reach is reported: inside %s, as in %s",
    (branch: string, statement: string) => {
      const reasons: Array<string | null> = scanHookCalls(
        "X.tsx",
        `const Panel = (props) => {\n  ${statement}\n  return <div />;\n};`,
      ).map((call: HookCall): string | null => {
        return call.conditionalBecause;
      });

      expect(reasons).toEqual([`inside ${branch}`]);
    },
  );

  test("hooks that all run before the first return pass", () => {
    expect(
      conditionalCallsIn(
        [
          "const List = (props) => {",
          "  const t = useTranslator();",
          "  const [open, setOpen] = useState(false);",
          "  useEffect(() => { setOpen(false); }, [props.items]);",
          "  if (!props.items.length) {",
          "    return <p>{t.translateText('None')}</p>;",
          "  }",
          "  return <ul />;",
          "};",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("a hook in the returned expression itself runs on every render", () => {
    expect(
      conditionalCallsIn(
        "function useLabel(id) {\n  return useMemo(() => lookUp(id), [id]);\n}",
        "X.ts",
      ),
    ).toEqual([]);
  });

  test("a return inside an effect, a callback or an inline component is not the outer function's", () => {
    expect(
      conditionalCallsIn(
        [
          "const Panel = (props) => {",
          "  useEffect(() => {",
          "    if (!props.open) { return; }",
          "    return subscribe();",
          "  }, [props.open]);",
          "  const onKey = (event) => {",
          "    if (event.key !== 'Enter') { return; }",
          "    submit();",
          "  };",
          "  const Row = () => {",
          "    return <li />;",
          "  };",
          "  const [value, setValue] = useState('');",
          "  return <div onKeyDown={onKey}><Row /></div>;",
          "};",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("each nested function is held to its own returns", () => {
    expect(
      conditionalCallsIn(
        [
          "const Panel = () => {",
          "  const Row = (props) => {",
          "    if (!props.item) { return null; }",
          "    const [open] = useState(false);",
          "    return <li />;",
          "  };",
          "  return <Row />;",
          "};",
        ].join("\n"),
      ),
    ).toEqual(["Row useState after the return at line 3"]);
  });

  /*
   * The fix this guard asks for: the early return in a component with no
   * hooks, which renders the component that owns them.
   */
  test("a hook-free wrapper that returns early and renders the component owning the hooks passes", () => {
    expect(
      conditionalCallsIn(
        [
          "const DateFilterControls = (props) => {",
          "  const translator = useTranslator();",
          "  const [operator, setOperator] = useState('is');",
          "  return <div />;",
          "};",
          "const DateFilter = (props) => {",
          "  if (props.filter.type !== FieldType.Date) {",
          "    return <></>;",
          "  }",
          "  return <DateFilterControls {...props} />;",
          "};",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("components in memo, forwardRef, function declarations and methods are read", () => {
    expect(
      conditionalCallsIn(
        [
          "const A = React.memo((props) => { if (!props.x) { return null; } useState(0); return <i />; });",
          "const B = forwardRef(function B(props, ref) { if (!props.x) { return null; } useRef(ref); return <i />; });",
          "export default function C(props) { if (!props.x) { return null; } useContext(Ctx); return <i />; }",
          "const hooks = { useD(x) { if (!x) { return null; } return useMemo(() => x, [x]); } };",
        ].join("\n"),
      ),
    ).toEqual([
      "A useState after the return at line 1",
      "B useRef after the return at line 2",
      "C useContext after the return at line 3",
      "useD useMemo after the return at line 4",
    ]);
  });

  test("React's use(), names that merely start with 'use', and hooks in strings or comments are not calls", () => {
    expect(
      conditionalCallsIn(
        [
          "const Panel = (props) => {",
          "  if (!props.ready) { return null; }",
          "  const data = use(props.promise);",
          "  const u = user(); const ok = useful(); const t = usersTable();",
          "  // useState(0) once lived here",
          "  const label = 'call useState(0) first';",
          "  return <div>{label}</div>;",
          "};",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  /*
   * WorkflowTemplatePicker's Enter handler was called usePickedTemplate: a
   * plain function, called from a key handler after a return. React and its
   * tooling read the name as a hook, so it was renamed, not excused.
   */
  test("a function named like a hook is held to the hook rules", () => {
    expect(
      conditionalCallsIn(
        [
          "const Picker = (props) => {",
          "  const usePicked = () => { props.onUse(); };",
          "  const onKey = (event) => {",
          "    if (event.nativeEvent.isComposing) { return; }",
          "    usePicked();",
          "  };",
          "  return <ul onKeyDown={onKey} />;",
          "};",
        ].join("\n"),
      ),
    ).toEqual(["onKey usePicked after the return at line 4"]);
  });
});

describe("every component and hook in the product", () => {
  test("the scan reads the product, so a pass is not vacuous", () => {
    const { files, calls } = scanProduct();
    const relativeFiles: Set<string> = new Set(files.map(relative));

    expect(files.length).toBeGreaterThan(2000);
    expect(calls.length).toBeGreaterThan(10000);

    for (const expected of [
      "packages/Common/UI/Components/Filters/DateFilter.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/Traces/FlameGraph.tsx",
      "packages/App/FeatureSet/StatusPage/src/App.tsx",
      "packages/MobileApp/src/screens/HomeScreen.tsx",
    ]) {
      expect(relativeFiles).toContain(expected);
    }

    // The hooks the fixes moved are read, and read as unconditional.
    const seen: Array<string> = calls.map((call: HookCall): string => {
      return `${call.file} ${call.functionName} ${call.hook} ${call.conditionalBecause}`;
    });

    expect(seen).toContain(
      "packages/Common/UI/Components/Filters/DateFilter.tsx DateFilterControls useState null",
    );
    expect(seen).toContain(
      "packages/Common/UI/Components/TableColumnList/TableColumnListComponent.tsx TableColumnListComponent React.useState null",
    );
    expect(seen).toContain(
      "packages/App/FeatureSet/Dashboard/src/Components/Traces/FlameGraph.tsx FlameGraph React.useMemo null",
    );
  });

  /*
   * A call listed here can be skipped on some renders. Call the hook above
   * the first return, or put the return in a wrapper with no hooks that
   * renders the component owning them (DateFilter and DateFilterControls);
   * for a branch, call the hook every time and branch on what it gives back
   * (ModelFormModal's own form ref). A function named like a hook that is
   * not one gets a name that does not start with "use".
   */
  test("no hook can be skipped by an early return or a branch", () => {
    const { calls } = scanProduct();

    expect(
      calls
        .filter((call: HookCall): boolean => {
          return call.conditionalBecause !== null;
        })
        .map(describeConditionalHookCall),
    ).toEqual([]);
  });
});
