import KubectlPolicy, {
  KubectlNamedObject,
} from "../../../Utils/AiRemediation/KubectlPolicy";
import { describe, expect, it } from "@jest/globals";

/*
 * KubectlPolicy.getNamedObject: the ONE object a command names, read from
 * its positionals the way the tiers read them — what the GitOps ownership
 * check reads before and after a fix. Several objects, a bare kind or a
 * selector name none.
 */

function namedObject(command: string): KubectlNamedObject | null {
  return KubectlPolicy.getNamedObject(
    KubectlPolicy.evaluateCommand(command).args,
  );
}

describe("KubectlPolicy.getNamedObject", () => {
  it("reads the object of every write that names one, in either spelling", () => {
    expect(namedObject("kubectl rollout undo deployment/web -n shop")).toEqual(
      {
        verb: "rollout",
        subcommand: "undo",
        rawKind: "deployment",
        kind: "deployment",
        builtinKind: "deployment",
        name: "web",
      },
    );
    expect(
      namedObject("kubectl scale deploy web --replicas=3 -n shop"),
    ).toMatchObject({
      verb: "scale",
      subcommand: "",
      rawKind: "deploy",
      kind: "deployment",
      name: "web",
    });
    expect(
      namedObject("kubectl set image deployment/web app=web:2 -n shop"),
    ).toMatchObject({ verb: "set", subcommand: "image", name: "web" });
    expect(
      namedObject("kubectl set env statefulset/db MODE=b -n shop"),
    ).toMatchObject({ kind: "statefulset", name: "db" });
    expect(
      namedObject(
        `kubectl patch deployment web -n shop -p '{"spec":{"replicas":2}}'`,
      ),
    ).toMatchObject({ verb: "patch", name: "web" });
    expect(namedObject("kubectl delete pod web-1 -n shop")).toMatchObject({
      verb: "delete",
      builtinKind: "pod",
      name: "web-1",
    });
    expect(
      namedObject("kubectl annotate deployment/web example.com/a=b -n shop"),
    ).toMatchObject({ verb: "annotate", name: "web" });
  });

  it("knows a group-qualified built-in kind from a custom resource that borrows its name", () => {
    expect(
      namedObject("kubectl rollout restart deployments.apps/web -n shop")
        ?.builtinKind,
    ).toBe("deployment");
    expect(
      namedObject(
        `kubectl patch deployments.example.com/web -n shop -p '{"a":1}'`,
      ),
    ).toMatchObject({ kind: "deployment", builtinKind: undefined });
    expect(
      namedObject(`kubectl patch hpa/web -n shop -p '{"spec":{}}'`),
    ).toMatchObject({ kind: "horizontalpodautoscaler", builtinKind: undefined });
  });

  it("names nothing for several objects, a bare kind or a selector", () => {
    expect(namedObject("kubectl rollout restart deployment -n shop")).toBeNull();
    expect(namedObject("kubectl delete pod a b -n shop")).toBeNull();
    expect(
      namedObject("kubectl scale deployment -l app=web --replicas=2 -n shop"),
    ).toBeNull();
    expect(
      namedObject("kubectl rollout restart deployment/web deployment/api -n shop"),
    ).toBeNull();
    expect(namedObject("kubectl delete pods --all -n shop")).toBeNull();
  });

  it("names nothing for what is not a command at all", () => {
    expect(KubectlPolicy.getNamedObject([])).toBeNull();
    expect(namedObject("")).toBeNull();
  });
});
