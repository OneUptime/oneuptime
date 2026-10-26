import { isShippedSecretValue } from "../../EnvironmentConfig";
import { ExpressRequest, ExpressResponse } from "../Express";
import Response from "../Response";
import TokenSigningKey from "../TokenSigningKey";
import WrongKeyLimit, { WrongKeyRefusal } from "./WrongKeyLimit";
import TooManyRequestsException from "../../../Types/Exception/TooManyRequestsException";
import crypto from "crypto";

/*
 * WRONG PROBE, RUNNER AND AI AGENT KEYS, COUNTED FOR THE CLIENT THAT SENDS
 * THEM.
 *
 * A probe, a Runner and an AI agent prove who they are with a key of their
 * own, and a global probe registers with a key of the installation's own
 * (REGISTER_PROBE_KEY). An operator may set any of them by hand, and so may
 * the people who manage a probe or a Runner, so these keys are held to what
 * every credential is held to: one client may try only so many wrong ones.
 * The rule is the one the cluster key keeps (WrongKeyLimit): different wrong
 * keys are counted, the right key never is, and a client over the limit is
 * refused whichever key it carries until its window ends. Valkey away, keys
 * are compared as always.
 *
 * WHAT IS COUNTED TOGETHER
 *
 *  - A probe's key (ProbeAuthorization) and a Runner's or an AI agent's key
 *    (RunnerAuthorization, the code-fix protocol through CodeFixAgentAuth,
 *    the AI agent heartbeat) are counted for that one probe, Runner or agent,
 *    apart from every other: a client guessing one probe's key is refused for
 *    that probe alone, and a whole fleet behind one address - each holding
 *    its own key, some of them old - never adds up to a refusal. A wrong key
 *    is counted only for a probe, Runner or agent there is: an id nothing has
 *    can never be let in, whatever key comes with it, so nothing is kept for
 *    it either.
 *  - REGISTER_PROBE_KEY, one secret of the installation's, is counted for
 *    the client alone, like the cluster key.
 *
 * Every one of them sends the same key on every request, so a probe or a
 * Runner that restarts, or still holds the key it had before a rotation or a
 * reset, presents one wrong key however often it calls, and is let through
 * the moment it has the right one: it is never refused for it.
 *
 * A key the repository ships, or a key that is not text, is never counted: it
 * is refused before it is compared, and can never be right.
 *
 * A CLIENT OVER THE LIMIT IS REFUSED BEFORE ITS KEY IS LOOKED UP
 *
 * A probe's, a Runner's and an AI agent's key is looked up in the database.
 * Every check of one asks checkBeforeLookup first, and a client already over
 * the limit for that component is refused there: its key is not looked up or
 * compared, so its requests cost no database read, and each is answered the
 * same whatever key it carries. Once the key is compared, checkComponentKey
 * counts it, and refuses a client that went over the limit while its request
 * was on the way. REGISTER_PROBE_KEY is compared with a value the app
 * holds, and reads nothing.
 *
 * NOT ON A PRIVATE NETWORK ADDRESS
 *
 * Like every wrong-key limit, a key presented from a private network address
 * is compared as it always was and never counted (WrongKeyLimit, NOT ON A
 * PRIVATE NETWORK ADDRESS): the bundled probes, the global Runner and the
 * agents beside them call from one, so nothing sent from beside them can get
 * them refused. Here that is asked before anything else, so nothing is looked
 * up, read or kept for such a key either.
 */

// The window a client's different wrong keys are counted in.
export const WRONG_COMPONENT_KEY_WINDOW_SECONDS: number = 15 * 60;

/*
 * How many different wrong keys one address may present in a window: for
 * one probe, one Runner or one AI agent, or for an installation key.
 */
export const WRONG_COMPONENT_KEYS_PER_ADDRESS: number = 10;

export enum ComponentKeyKind {
  // A probe's own key.
  Probe = "probe",
  // A Runner's or an AI agent's own key.
  Agent = "agent",
  // REGISTER_PROBE_KEY, which registers a global probe.
  ProbeRegistration = "probe registration",
}

// What a client refused for its wrong keys is told, by the kind of key.
export const WRONG_PROBE_KEYS_MESSAGE: string =
  "This address has sent too many different wrong keys for this probe, so its requests for this probe are refused for now. Wait for the time in the Retry-After header, then send the key the probe has in OneUptime.";

export const WRONG_AGENT_KEYS_MESSAGE: string =
  "This address has sent too many different wrong keys for this Runner, so its requests for this Runner are refused for now. Wait for the time in the Retry-After header, then send the key the Runner has in OneUptime.";

export const WRONG_PROBE_REGISTRATION_KEYS_MESSAGE: string =
  "This address has sent too many different wrong probe registration keys, so its registrations are refused for now. Wait for the time in the Retry-After header, then register with the REGISTER_PROBE_KEY the OneUptime server is set to.";

/*
 * What a wrong key's digest is made with: a key derived for this alone from
 * the installation's token signing key, so the same wrong key is one value in
 * every app process, and what Valkey keeps says nothing of it.
 */
export const WRONG_COMPONENT_KEY_DIGEST_LABEL: string =
  "oneuptime-wrong-component-key-digest";

// An id, once braces and hyphens are taken off: 32 hex digits.
const COMPACT_ID: RegExp = /^[0-9a-f]{32}$/;

// No id a request names is longer than this; longer text is no id.
const MAX_ID_LENGTH: number = 64;

interface KindOfKey {
  limit: WrongKeyLimit;
  message: string;
}

function limitFor(data: {
  scope: string;
  countedKeys: string;
  keyPrefix: string;
}): WrongKeyLimit {
  return new WrongKeyLimit({
    scope: data.scope,
    logSource: "WrongComponentKeyLimit",
    countedKeys: data.countedKeys,
    keyPrefix: data.keyPrefix,
    perAddress: WRONG_COMPONENT_KEYS_PER_ADDRESS,
    windowSeconds: WRONG_COMPONENT_KEY_WINDOW_SECONDS,
    countFailedMessage: `WrongComponentKeyLimit: the ${data.scope} count failed, so those keys are compared without it`,
  });
}

const KINDS: Record<ComponentKeyKind, KindOfKey> = {
  [ComponentKeyKind.Probe]: {
    limit: limitFor({
      scope: "wrong probe key",
      countedKeys: "different wrong keys for probe",
      keyPrefix: "probe-key:wrong-keys:",
    }),
    message: WRONG_PROBE_KEYS_MESSAGE,
  },
  [ComponentKeyKind.Agent]: {
    limit: limitFor({
      scope: "wrong agent key",
      countedKeys: "different wrong keys for Runner or AI agent",
      keyPrefix: "agent-key:wrong-keys:",
    }),
    message: WRONG_AGENT_KEYS_MESSAGE,
  },
  [ComponentKeyKind.ProbeRegistration]: {
    limit: limitFor({
      scope: "wrong probe registration key",
      countedKeys: "different wrong probe registration keys",
      keyPrefix: "probe-registration-key:wrong-keys:",
    }),
    message: WRONG_PROBE_REGISTRATION_KEYS_MESSAGE,
  },
};

export default class WrongComponentKeyLimit {
  /*
   * For a request that presented a probe's, a Runner's or an AI agent's id
   * and key, once the key was checked: the refusal to answer it with, when
   * its client has sent too many different wrong keys for that component -
   * the wrong key it presented counted first - or null, when it may be
   * answered as its key deserves.
   *
   * `isKeyRight` says whether the key is that component's. A wrong key is
   * counted only when it is text the repository does not ship, and only for
   * a component there is: `componentExists` is asked then, and only then.
   */
  public static async checkComponentKey(data: {
    req: ExpressRequest;
    kind: ComponentKeyKind.Probe | ComponentKeyKind.Agent;
    // The id the request named, as it named it.
    componentId: string;
    presentedKey: unknown;
    isKeyRight: boolean;
    componentExists: () => Promise<boolean>;
  }): Promise<WrongKeyRefusal | null> {
    const subject: string | null = WrongComponentKeyLimit.countedSubject(data);

    if (subject === null) {
      return null;
    }

    let wrongKey: string | null = null;

    if (!data.isKeyRight) {
      if (!WrongComponentKeyLimit.isCountable(data.presentedKey)) {
        return null;
      }

      if (!(await data.componentExists())) {
        return null;
      }

      wrongKey = WrongComponentKeyLimit.digestOf(
        data.kind,
        subject,
        data.presentedKey as string,
      );
    }

    return await KINDS[data.kind].limit.check({
      req: data.req,
      wrongKey: wrongKey,
      subject: subject,
    });
  }

  /*
   * Before a probe's, a Runner's or an AI agent's key is looked up: the
   * refusal to answer the request with when its client is already over the
   * limit for that component, or null (A CLIENT OVER THE LIMIT IS REFUSED
   * BEFORE ITS KEY IS LOOKED UP, above). Nothing is counted here: whether
   * the key is wrong is not known yet.
   */
  public static async checkBeforeLookup(data: {
    req: ExpressRequest;
    kind: ComponentKeyKind.Probe | ComponentKeyKind.Agent;
    // The id the request named, as it named it.
    componentId: string;
  }): Promise<WrongKeyRefusal | null> {
    const subject: string | null = WrongComponentKeyLimit.countedSubject(data);

    if (subject === null) {
      return null;
    }

    return await KINDS[data.kind].limit.check({
      req: data.req,
      wrongKey: null,
      subject: subject,
    });
  }

  /*
   * For a request that presented an installation key - REGISTER_PROBE_KEY -
   * once the key was compared:
   * the refusal to answer it with, when its client has sent too many
   * different wrong ones, or null.
   */
  public static async checkRegistrationKey(data: {
    req: ExpressRequest;
    kind: ComponentKeyKind.ProbeRegistration;
    presentedKey: unknown;
    isKeyRight: boolean;
  }): Promise<WrongKeyRefusal | null> {
    // A private network address: never counted (NOT ON A PRIVATE NETWORK ADDRESS).
    if (WrongComponentKeyLimit.isFromPrivateNetwork(data.req)) {
      return null;
    }

    let wrongKey: string | null = null;

    if (!data.isKeyRight) {
      if (!WrongComponentKeyLimit.isCountable(data.presentedKey)) {
        return null;
      }

      wrongKey = WrongComponentKeyLimit.digestOf(
        data.kind,
        "",
        data.presentedKey as string,
      );
    }

    return await KINDS[data.kind].limit.check({
      req: data.req,
      wrongKey: wrongKey,
    });
  }

  /*
   * Answers a refused request: 429, with when the client may try again in
   * Retry-After, and what to do in the body.
   */
  public static answerRefusal(
    req: ExpressRequest,
    res: ExpressResponse,
    kind: ComponentKeyKind,
    refusal: WrongKeyRefusal,
  ): void {
    if (typeof res.setHeader === "function") {
      res.setHeader("Retry-After", String(refusal.retryAfterSeconds));
    }

    Response.sendErrorResponse(
      req,
      res,
      new TooManyRequestsException(KINDS[kind].message),
    );
  }

  /*
   * Whether a client address is a private network address, whose keys are
   * not counted (NOT ON A PRIVATE NETWORK ADDRESS above): the one rule every
   * wrong-key limit keeps (WrongKeyLimit.isPrivateNetworkAddress).
   */
  public static isPrivateNetworkAddress(address: string): boolean {
    return WrongKeyLimit.isPrivateNetworkAddress(address);
  }

  /*
   * The component a probe's, a Runner's or an AI agent's key is counted for -
   * its id, as one spelling - or null when that key is not counted at all.
   */
  private static countedSubject(data: {
    req: ExpressRequest;
    kind: ComponentKeyKind.Probe | ComponentKeyKind.Agent;
    componentId: string;
  }): string | null {
    // Valkey away: keys are compared as always, and nothing is read to count.
    if (!KINDS[data.kind].limit.isCounting()) {
      return null;
    }

    // A private network address: never counted (NOT ON A PRIVATE NETWORK ADDRESS).
    if (WrongComponentKeyLimit.isFromPrivateNetwork(data.req)) {
      return null;
    }

    // Not an id: nothing can be let in with it, so nothing is counted for it.
    return WrongComponentKeyLimit.canonicalId(data.componentId);
  }

  // Whether a request comes from a private network address.
  private static isFromPrivateNetwork(req: ExpressRequest): boolean {
    return WrongKeyLimit.isFromPrivateNetwork(req);
  }

  /*
   * One spelling of an id, whichever the request used: lower case, with its
   * hyphens where they belong. Postgres reads an id in any case, with or
   * without braces, and with a hyphen after any group of four digits, so a
   * client must not get a new count for each spelling of one probe's id.
   * Null for anything that is not an id.
   */
  public static canonicalId(id: string): string | null {
    if (typeof id !== "string" || id.length > MAX_ID_LENGTH) {
      return null;
    }

    let compact: string = id.trim().toLowerCase();

    if (compact.startsWith("{") && compact.endsWith("}")) {
      compact = compact.slice(1, -1);
    }

    compact = compact.split("-").join("");

    if (!COMPACT_ID.test(compact)) {
      return null;
    }

    return [
      compact.slice(0, 8),
      compact.slice(8, 12),
      compact.slice(12, 16),
      compact.slice(16, 20),
      compact.slice(20),
    ].join("-");
  }

  /*
   * What Valkey keeps of a wrong key: an HMAC of it, with the kind of key and
   * the component it was presented for, under a key of the installation's
   * own. Never the key: a wrong key can be a near miss, or the key of another
   * probe or Runner.
   */
  public static digestOf(
    kind: ComponentKeyKind,
    subject: string,
    presentedKey: string,
  ): string {
    return crypto
      .createHmac(
        "sha256",
        TokenSigningKey.deriveKey(WRONG_COMPONENT_KEY_DIGEST_LABEL),
      )
      .update(`${kind}\n${subject}\n${presentedKey}`, "utf8")
      .digest("hex");
  }

  /*
   * Whether a key a request presented is counted when it is wrong: text the
   * repository does not ship. Anything else is refused before it is
   * compared, and can never be right.
   */
  private static isCountable(presentedKey: unknown): boolean {
    return (
      typeof presentedKey === "string" && !isShippedSecretValue(presentedKey)
    );
  }
}
