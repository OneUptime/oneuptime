import "@testing-library/jest-dom";
import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * This hook is what the invite forms call on every keystroke to find out
 * whether the address being typed already has a OneUptime account.
 *
 * It is therefore attached to a form the user is actively typing into, and the
 * state it owns lives on the page that renders that form - so every time it
 * flips, the whole form re-renders. The invite-user bug was ultimately about a
 * form that could not survive being re-rendered while in use; the fixes for that
 * live in ModelForm/BasicForm/Input, and these tests cover the other half of
 * the bargain: this hook must not cause MORE renders than the answer needs.
 */

interface PendingCheck {
  email: string;
  headers: unknown;
  resolve: (isRegistered: boolean) => void;
  reject: (error: Error) => void;
}

let pendingChecks: Array<PendingCheck> = [];

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (data: {
        data: { email: string };
        headers?: unknown;
      }): Promise<{ data: { isRegistered: boolean } }> => {
        return new Promise<{ data: { isRegistered: boolean } }>(
          (
            resolve: (value: { data: { isRegistered: boolean } }) => void,
            reject: (error: Error) => void,
          ) => {
            pendingChecks.push({
              email: data.data.email,
              headers: data.headers,
              resolve: (isRegistered: boolean) => {
                resolve({ data: { isRegistered: isRegistered } });
              },
              reject: reject,
            });
          },
        );
      },
      getFriendlyMessage: (): string => {
        return "";
      },
    },
  };
});

import { useUserEmailRegistrationStatus } from "../../../UI/Utils/UserEmailRegistrationStatus";

const DEBOUNCE_MS: number = 400;

interface ProbeResult {
  checkEmailIdentities: Array<unknown>;
  statuses: Array<boolean | null>;
  rerender: () => void;
  check: (email: string) => void;
}

type RenderProbeFunction = (
  headersFactory?: () => {
    [key: string]: string;
  },
) => ProbeResult;

/*
 * Renders the hook the way every real caller does - passing its options as an
 * inline object literal, so the options and the header factory are brand new
 * on every render - and records what comes back.
 */
const renderProbe: RenderProbeFunction = (
  headersFactory?: () => {
    [key: string]: string;
  },
): ProbeResult => {
  const result: ProbeResult = {
    checkEmailIdentities: [],
    statuses: [],
    rerender: () => {},
    check: () => {},
  };

  const Probe: React.FunctionComponent = (): React.ReactElement => {
    const [, setTick] = React.useState<number>(0);

    const { isEmailRegistered, checkEmail } = useUserEmailRegistrationStatus({
      getRequestHeaders: headersFactory
        ? () => {
            return headersFactory();
          }
        : undefined,
    });

    result.checkEmailIdentities.push(checkEmail);
    result.statuses.push(isEmailRegistered);
    result.check = checkEmail;
    result.rerender = () => {
      setTick((tick: number) => {
        return tick + 1;
      });
    };

    return <div />;
  };

  render(<Probe />);

  return result;
};

describe("useUserEmailRegistrationStatus", () => {
  beforeEach(() => {
    pendingChecks = [];
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    cleanup();
  });

  /*
   * The whole reason the header factory is held in a ref. A caller writing its
   * options inline used to get a new checkEmail on every render, which becomes
   * a new field definition, which becomes another render of the form.
   */
  test("hands back the same checkEmail across re-renders", () => {
    const probe: ProbeResult = renderProbe(() => {
      return { tenant: "abc" };
    });

    act(() => {
      probe.rerender();
    });
    act(() => {
      probe.rerender();
    });

    expect(probe.checkEmailIdentities.length).toBeGreaterThan(2);

    const identities: Set<unknown> = new Set(probe.checkEmailIdentities);
    expect(identities.size).toBe(1);
  });

  /*
   * And it still has to use the CURRENT headers, not the ones captured when the
   * hook first ran - the auth headers a form sends can change while the page is
   * open.
   */
  test("sends the headers the caller has now, not the ones it had first", () => {
    let tenant: string = "first";

    const probe: ProbeResult = renderProbe(() => {
      return { tenant: tenant };
    });

    tenant = "second";

    act(() => {
      probe.rerender();
    });

    act(() => {
      probe.check("member@company.com");
    });

    act(() => {
      jest.advanceTimersByTime(DEBOUNCE_MS);
    });

    expect(pendingChecks.length).toBe(1);
    expect(pendingChecks[0]!.headers).toEqual({ tenant: "second" });
  });

  test("only asks once the typing has settled, and reports the answer", async () => {
    const probe: ProbeResult = renderProbe();

    act(() => {
      probe.check("mem");
    });
    act(() => {
      probe.check("member@comp");
    });
    act(() => {
      probe.check("member@company.com");
    });

    // Still mid-word: nothing has been asked yet.
    expect(pendingChecks.length).toBe(0);

    act(() => {
      jest.advanceTimersByTime(DEBOUNCE_MS);
    });

    expect(pendingChecks.length).toBe(1);
    expect(pendingChecks[0]!.email).toBe("member@company.com");

    await act(async () => {
      pendingChecks[0]!.resolve(true);
    });

    expect(probe.statuses[probe.statuses.length - 1]).toBe(true);
  });

  /*
   * An address that is not a valid email cannot have an account, so it must not
   * cost a request - which also means the first few keystrokes of any address
   * are free.
   */
  test("does not ask about an address that is not a valid email", () => {
    const probe: ProbeResult = renderProbe();

    act(() => {
      probe.check("mem");
    });

    act(() => {
      jest.advanceTimersByTime(DEBOUNCE_MS * 3);
    });

    expect(pendingChecks.length).toBe(0);
    expect(probe.statuses[probe.statuses.length - 1]).toBeNull();
  });

  /*
   * The user carried on typing while a check was in flight. The old answer is
   * about an address they are no longer entering, so applying it would show the
   * wrong prompt - and, before the form fixes, would have wiped what they were
   * typing for good measure.
   */
  test("ignores an answer about an address that has since changed", async () => {
    const probe: ProbeResult = renderProbe();

    act(() => {
      probe.check("first@company.com");
    });
    act(() => {
      jest.advanceTimersByTime(DEBOUNCE_MS);
    });

    expect(pendingChecks.length).toBe(1);

    act(() => {
      probe.check("second@company.com");
    });
    act(() => {
      jest.advanceTimersByTime(DEBOUNCE_MS);
    });

    expect(pendingChecks.length).toBe(2);

    // The first request answers last.
    await act(async () => {
      pendingChecks[1]!.resolve(false);
    });
    await act(async () => {
      pendingChecks[0]!.resolve(true);
    });

    expect(probe.statuses[probe.statuses.length - 1]).toBe(false);
  });

  // A check still pending when the form closes has nowhere to report to.
  test("drops a pending check when the caller unmounts", () => {
    const probe: ProbeResult = renderProbe();

    act(() => {
      probe.check("member@company.com");
    });

    cleanup();

    act(() => {
      jest.advanceTimersByTime(DEBOUNCE_MS * 3);
    });

    expect(pendingChecks.length).toBe(0);
  });
});
