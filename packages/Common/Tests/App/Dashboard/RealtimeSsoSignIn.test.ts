import ObjectID from "../../../Types/ObjectID";
import { listenForRealtimeSsoSignIn } from "../../../../App/FeatureSet/Dashboard/src/Utils/RealtimeSsoSignIn";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Live updates of a project that requires an SSO sign-in are refused to a
 * session without one, as its API requests are, and the server names the
 * project. The Dashboard sends the person to sign in with SSO when that is
 * the project open in front of them - the way a refused API request does -
 * and ignores a refusal for any other project.
 */

type SsoListener = (tenantId: ObjectID) => void;

const mockListeners: Set<SsoListener> = new Set<SsoListener>();

jest.mock("../../../UI/Utils/Realtime", () => {
  return {
    __esModule: true,
    default: {
      listenForSsoAuthorizationRequired: (
        listener: SsoListener,
      ): (() => void) => {
        mockListeners.add(listener);

        return (): void => {
          mockListeners.delete(listener);
        };
      },
    },
  };
});

const PROJECT: ObjectID = new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const OTHER_PROJECT: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);

function serverRefuses(tenantId: ObjectID): void {
  for (const listener of Array.from(mockListeners)) {
    listener(tenantId);
  }
}

describe("listenForRealtimeSsoSignIn", () => {
  let currentProjectId: ObjectID | null;
  let signInsAsked: number;
  let stop: () => void;

  beforeEach(() => {
    mockListeners.clear();
    currentProjectId = PROJECT;
    signInsAsked = 0;

    stop = listenForRealtimeSsoSignIn({
      getCurrentProjectId: (): ObjectID | null => {
        return currentProjectId;
      },
      onSsoSignInRequired: (): void => {
        signInsAsked++;
      },
    });
  });

  afterEach(() => {
    stop();
  });

  test("a refusal for the open project sends the person to sign in with SSO", () => {
    serverRefuses(PROJECT);

    expect(signInsAsked).toBe(1);
  });

  test("the open project is matched by its id, not by being the same object", () => {
    serverRefuses(new ObjectID(PROJECT.toString()));

    expect(signInsAsked).toBe(1);
  });

  test("a refusal for another project changes nothing on the page", () => {
    serverRefuses(OTHER_PROJECT);

    expect(signInsAsked).toBe(0);
  });

  test("with no project open, nothing happens", () => {
    currentProjectId = null;

    serverRefuses(PROJECT);

    expect(signInsAsked).toBe(0);
  });

  test("the project open when the refusal arrives is the one compared", () => {
    currentProjectId = OTHER_PROJECT;

    serverRefuses(OTHER_PROJECT);

    expect(signInsAsked).toBe(1);
  });

  test("stopping stops listening", () => {
    stop();

    serverRefuses(PROJECT);

    expect(signInsAsked).toBe(0);
    expect(mockListeners.size).toBe(0);
  });
});
