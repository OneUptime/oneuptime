import { describe, expect, test } from "@jest/globals";
import { render } from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
import useStableValue, {
  getStableValueKey,
} from "../../../UI/Utils/UseStableValue";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import Search from "../../../Types/BaseDatabase/Search";
import ObjectID from "../../../Types/ObjectID";

/*
 * useStableValue: a value with the identity it had the last time its value
 * changed (issue #4709).
 *
 * The telemetry explorers read their host's scope through it, because pages
 * hand that scope over anew on every render - `serviceIds={[modelId]}`, an
 * ObjectID read from the URL in the render, a stored query an incident page
 * re-reads on every background refresh - and every list, chart and facet
 * read is keyed on it. Equal must come back as the SAME object, or each
 * such render reads everything again; different must not, or a real change
 * of scope is never read at all.
 */

interface ProbeProps<T> {
  value: T;
  seen: Array<T>;
}

function Probe<T>(props: ProbeProps<T>): ReactElement {
  const stable: T = useStableValue(props.value);
  props.seen.push(stable);
  return <span />;
}

// Renders each value in turn and returns what the hook handed back for each.
function handedBack<T>(values: Array<T>): Array<T> {
  const seen: Array<T> = [];
  const Typed: FunctionComponent<ProbeProps<T>> = Probe as FunctionComponent<
    ProbeProps<T>
  >;
  const view: ReturnType<typeof render> = render(
    <Typed value={values[0] as T} seen={seen} />,
  );
  for (const value of values.slice(1)) {
    view.rerender(<Typed value={value} seen={seen} />);
  }
  view.unmount();
  return seen;
}

const SERVICE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_SERVICE_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("useStableValue", () => {
  test("an equal array handed over again is the first array", () => {
    const first: Array<string> = ["a", "b"];
    const seen: Array<Array<string>> = handedBack([
      first,
      ["a", "b"],
      ["a", "b"],
    ]);

    expect(seen).toHaveLength(3);
    for (const value of seen) {
      expect(value).toBe(first);
    }
  });

  test("a new ObjectID for the same id is the first ObjectID", () => {
    const first: Array<ObjectID> = [new ObjectID(SERVICE_ID)];
    const seen: Array<Array<ObjectID>> = handedBack([
      first,
      [new ObjectID(SERVICE_ID)],
    ]);

    expect(seen[1]).toBe(first);
  });

  test("a stored query re-read with the same operators and dates is the first query", () => {
    const build: () => Record<string, unknown> = (): Record<
      string,
      unknown
    > => {
      return {
        severityText: new Includes(["Error", "Fatal"]),
        body: new Search("timeout"),
        time: new InBetween<Date>(
          new Date("2026-09-20T08:00:00.000Z"),
          new Date("2026-09-20T09:30:00.000Z"),
        ),
      };
    };
    const first: Record<string, unknown> = build();
    const seen: Array<Record<string, unknown>> = handedBack([
      first,
      build(),
      build(),
    ]);

    expect(seen[1]).toBe(first);
    expect(seen[2]).toBe(first);
  });

  test("a changed value is handed back as itself", () => {
    const first: Array<ObjectID> = [new ObjectID(SERVICE_ID)];
    const second: Array<ObjectID> = [new ObjectID(OTHER_SERVICE_ID)];
    const seen: Array<Array<ObjectID>> = handedBack([first, second]);

    expect(seen[0]).toBe(first);
    expect(seen[1]).toBe(second);
  });

  test("a value that changes and changes back is handed back anew each time", () => {
    const one: Array<string> = ["one"];
    const two: Array<string> = ["two"];
    const oneAgain: Array<string> = ["one"];
    const seen: Array<Array<string>> = handedBack([one, two, oneAgain]);

    expect(seen[1]).toBe(two);
    // Equal to the first, but the last change was to `two`: a new identity.
    expect(seen[2]).toBe(oneAgain);
  });

  test("a later time window is a change", () => {
    const window: (end: string) => InBetween<Date> = (
      end: string,
    ): InBetween<Date> => {
      return new InBetween<Date>(
        new Date("2026-09-20T08:00:00.000Z"),
        new Date(end),
      );
    };
    const first: InBetween<Date> = window("2026-09-20T09:30:00.000Z");
    const later: InBetween<Date> = window("2026-09-20T09:30:00.001Z");
    const seen: Array<InBetween<Date>> = handedBack([first, later]);

    expect(seen[1]).toBe(later);
  });

  test("undefined stays undefined, and a value after it is a change", () => {
    const value: Array<string> = ["k"];
    const seen: Array<Array<string> | undefined> = handedBack<
      Array<string> | undefined
    >([undefined, undefined, value]);

    expect(seen[0]).toBeUndefined();
    expect(seen[1]).toBeUndefined();
    expect(seen[2]).toBe(value);
  });
});

describe("getStableValueKey", () => {
  test("operators keep their type: an Includes is not the plain list it holds", () => {
    expect(getStableValueKey(new Includes(["a"]))).not.toBe(
      getStableValueKey(["a"]),
    );
  });

  test("an ObjectID is not the plain string it holds", () => {
    expect(getStableValueKey(new ObjectID(SERVICE_ID))).not.toBe(
      getStableValueKey(SERVICE_ID),
    );
  });

  test("undefined and null are different answers", () => {
    expect(getStableValueKey(undefined)).toBe("undefined");
    expect(getStableValueKey(null)).toBe("null");
  });

  test("equal values give equal keys", () => {
    expect(
      getStableValueKey({
        ids: [new ObjectID(SERVICE_ID)],
        time: new InBetween<Date>(
          new Date("2026-09-20T08:00:00.000Z"),
          new Date("2026-09-20T09:30:00.000Z"),
        ),
      }),
    ).toBe(
      getStableValueKey({
        ids: [new ObjectID(SERVICE_ID)],
        time: new InBetween<Date>(
          new Date("2026-09-20T08:00:00.000Z"),
          new Date("2026-09-20T09:30:00.000Z"),
        ),
      }),
    );
  });
});
