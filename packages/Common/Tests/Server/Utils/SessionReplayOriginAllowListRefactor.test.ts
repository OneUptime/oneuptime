import SessionReplayGateCache, {
  SessionReplayGatePolicy,
} from "../../../Server/Utils/SessionReplay/SessionReplayGateCache";
import OriginAllowList from "../../../Utils/Telemetry/OriginAllowList";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * SessionReplayGateCache.isOriginAllowed after it was rewritten to delegate
 * its matching to the shared Common/Utils/Telemetry/OriginAllowList. The
 * point of this suite is that the rewrite changed NOTHING a customer can
 * observe: the gate answers today exactly what it answered before the shared
 * matcher existed.
 *
 * READ THIS BEFORE "FIXING" THE EMPTY-LIST RULE.
 *
 * An EMPTY allowlist here means "accept ANY origin". That is deliberately the
 * INVERSE of the rule the Browser telemetry-ingestion-key path applies, where
 * an empty allowlist means "accept NOTHING" (see TelemetryIngest -
 * `policy.allowedOrigins.length === 0 || !OriginAllowList.matches(...)`
 * refuses). The two are not inconsistent by accident:
 *
 *   - session replay shipped WITHOUT an allowlist. The column was retrofitted
 *     as optional hardening, defaults to '[]', and every installation running
 *     today has it empty. Reading empty as "refuse" would stop recording for
 *     all of them on upgrade, with no customer action and no warning - a
 *     silent, total outage of a feature they had working.
 *   - a Browser ingestion key is NEW. Nothing depends on it yet, so it can
 *     start closed, and it must: a public credential pasted into a web page
 *     with no origin binding is not a credential at all.
 *
 * The shared matcher stays out of this argument on purpose - OriginAllowList
 * .matches returns false for an empty list, meaning only "nothing in this
 * list matched", and each caller applies its own default. So the permissive
 * branch lives HERE, in the gate, and the strict branch lives in the ingest
 * middleware. Do not "align" one with the other; changing this one breaks
 * live installations, and changing that one reopens the hole the Browser key
 * type was built to close.
 *
 * Existing coverage this suite deliberately does not repeat: the exact-match,
 * unlisted-origin, missing-Origin-once-configured, origin-side case and
 * padding, and subdomain-of-an-exact-entry cases are pinned by
 * Common/Tests/Server/Utils/SessionReplay/SessionReplayOriginAllowlist.test.ts,
 * and the matcher's own semantics are pinned in depth by
 * Common/Tests/Utils/Telemetry/OriginAllowList.test.ts. What is added here is
 * the behaviour that only became reachable through the gate once it started
 * delegating - wildcards, scheme and port strictness, allowlist-side
 * normalization - plus the delegation itself and the inverse-polarity rule
 * above.
 */

type BuildPolicyFunction = (
  allowedOrigins: Array<string>,
) => SessionReplayGatePolicy;

const buildPolicy: BuildPolicyFunction = (
  allowedOrigins: Array<string>,
): SessionReplayGatePolicy => {
  return {
    allowedOrigins: allowedOrigins,
  } as unknown as SessionReplayGatePolicy;
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SessionReplayGateCache.isOriginAllowed - an empty allowlist accepts anything", () => {
  /*
   * The rule that must survive every refactor of this function, because
   * every installation that has not filled the list in depends on it.
   */
  test("an unconfigured allowlist accepts an origin nobody named", () => {
    expect(
      SessionReplayGateCache.isOriginAllowed(
        buildPolicy([]),
        "https://anything.example.com",
      ),
    ).toBe(true);
  });

  test("an unconfigured allowlist accepts a request that sends no Origin at all", () => {
    expect(
      SessionReplayGateCache.isOriginAllowed(buildPolicy([]), undefined),
    ).toBe(true);
  });

  test("an unconfigured allowlist accepts a blank Origin header", () => {
    /*
     * A blank header is the same situation as a missing one and has to reach
     * the same answer, or the gate becomes sensitive to which proxy stripped
     * the value.
     */
    expect(SessionReplayGateCache.isOriginAllowed(buildPolicy([]), "")).toBe(
      true,
    );
    expect(SessionReplayGateCache.isOriginAllowed(buildPolicy([]), "   ")).toBe(
      true,
    );
  });

  /*
   * The polarity assertion, spelled out so the inverse rules are visible side
   * by side in one test: the shared matcher says "nothing matched" for an
   * empty list, and the gate - not the matcher - is what turns that into
   * "allow". The ingest path turns the same answer into "refuse".
   */
  test("the permissive empty-list rule lives in the gate, not in the shared matcher", () => {
    const emptyList: Array<string> = [];

    expect(OriginAllowList.matches("https://app.example.com", emptyList)).toBe(
      false,
    );
    expect(
      SessionReplayGateCache.isOriginAllowed(
        buildPolicy(emptyList),
        "https://app.example.com",
      ),
    ).toBe(true);
  });

  test("an empty allowlist is answered without consulting the shared matcher", () => {
    /*
     * Not merely an optimisation: if the empty case were routed through
     * OriginAllowList.matches, the gate would inherit that module's
     * "nothing matched" answer and every unconfigured installation would stop
     * recording.
     */
    const matchesSpy: jest.SpyInstance = jest.spyOn(OriginAllowList, "matches");

    expect(
      SessionReplayGateCache.isOriginAllowed(
        buildPolicy([]),
        "https://app.example.com",
      ),
    ).toBe(true);

    expect(matchesSpy).not.toHaveBeenCalled();
  });
});

describe("SessionReplayGateCache.isOriginAllowed - a configured allowlist is strict", () => {
  test("a request with no Origin is refused once the customer has named their origins", () => {
    /*
     * The pivot: the permissive branch applies only while the list is empty.
     * If a missing header were waved through here, the allowlist could be
     * bypassed by simply not sending one.
     */
    const policy: SessionReplayGatePolicy = buildPolicy([
      "https://app.example.com",
    ]);

    expect(SessionReplayGateCache.isOriginAllowed(policy, undefined)).toBe(
      false,
    );
    expect(SessionReplayGateCache.isOriginAllowed(policy, "")).toBe(false);
    expect(SessionReplayGateCache.isOriginAllowed(policy, "   ")).toBe(false);
  });

  test("an exactly listed origin is accepted", () => {
    expect(
      SessionReplayGateCache.isOriginAllowed(
        buildPolicy(["https://app.example.com"]),
        "https://app.example.com",
      ),
    ).toBe(true);
  });

  test("a wildcard entry accepts a subdomain, so per-tenant hosts need not be enumerated", () => {
    const policy: SessionReplayGatePolicy = buildPolicy([
      "https://*.example.com",
    ]);

    expect(
      SessionReplayGateCache.isOriginAllowed(
        policy,
        "https://tenant-a.example.com",
      ),
    ).toBe(true);
    expect(
      SessionReplayGateCache.isOriginAllowed(
        policy,
        "https://deep.tenant-a.example.com",
      ),
    ).toBe(true);
  });

  /*
   * "*.example.com" is a statement about subdomains. The customer who wrote
   * it did not list the apex, and inferring it would quietly widen every
   * allowlist in the product by one origin.
   */
  test("a wildcard entry does not accept the bare apex domain", () => {
    expect(
      SessionReplayGateCache.isOriginAllowed(
        buildPolicy(["https://*.example.com"]),
        "https://example.com",
      ),
    ).toBe(false);
  });

  /*
   * The attack this branch exists to stop: "evilexample.com" is a domain
   * anyone can register, and a suffix match that forgot the dot would hand
   * its owner the ability to write recordings into this project.
   */
  test("a wildcard entry does not accept an attacker-registrable lookalike domain", () => {
    const policy: SessionReplayGatePolicy = buildPolicy([
      "https://*.example.com",
    ]);

    expect(
      SessionReplayGateCache.isOriginAllowed(policy, "https://evilexample.com"),
    ).toBe(false);
    expect(
      SessionReplayGateCache.isOriginAllowed(
        policy,
        "https://app.evilexample.com",
      ),
    ).toBe(false);
  });

  test("the scheme is part of the origin - http never satisfies an https entry", () => {
    expect(
      SessionReplayGateCache.isOriginAllowed(
        buildPolicy(["https://app.example.com"]),
        "http://app.example.com",
      ),
    ).toBe(false);
    expect(
      SessionReplayGateCache.isOriginAllowed(
        buildPolicy(["http://app.example.com"]),
        "https://app.example.com",
      ),
    ).toBe(false);
  });

  test("a wildcard entry does not relax the scheme either", () => {
    expect(
      SessionReplayGateCache.isOriginAllowed(
        buildPolicy(["https://*.example.com"]),
        "http://app.example.com",
      ),
    ).toBe(false);
  });

  test("the port is part of the origin - a different port is a different origin", () => {
    expect(
      SessionReplayGateCache.isOriginAllowed(
        buildPolicy(["https://app.example.com:8443"]),
        "https://app.example.com:9443",
      ),
    ).toBe(false);
    expect(
      SessionReplayGateCache.isOriginAllowed(
        buildPolicy(["https://app.example.com"]),
        "https://app.example.com:8443",
      ),
    ).toBe(false);
    expect(
      SessionReplayGateCache.isOriginAllowed(
        buildPolicy(["https://app.example.com:8443"]),
        "https://app.example.com",
      ),
    ).toBe(false);
  });

  test("a matching explicit port is accepted", () => {
    expect(
      SessionReplayGateCache.isOriginAllowed(
        buildPolicy(["http://localhost:3000"]),
        "http://localhost:3000",
      ),
    ).toBe(true);
  });

  /*
   * Origins are case-insensitive in scheme and host, and customers paste
   * allowlist entries out of address bars, docs and spreadsheets. Matching
   * has to be case-insensitive on BOTH sides or an allowlist stops working
   * because of how it was typed.
   */
  test("matching is case-insensitive on the allowlist side as well as the request side", () => {
    expect(
      SessionReplayGateCache.isOriginAllowed(
        buildPolicy(["HTTPS://APP.EXAMPLE.COM"]),
        "https://app.example.com",
      ),
    ).toBe(true);
    expect(
      SessionReplayGateCache.isOriginAllowed(
        buildPolicy(["https://*.EXAMPLE.com"]),
        "https://TENANT.example.COM",
      ),
    ).toBe(true);
  });

  /*
   * Entries arrive from a text field. A stray space or a trailing slash
   * copied from the address bar must not silently turn the allowlist into
   * one that matches nothing - that failure looks identical to a working
   * configuration until the recordings stop arriving.
   */
  test("a whitespace-padded allowlist entry still matches", () => {
    expect(
      SessionReplayGateCache.isOriginAllowed(
        buildPolicy(["  https://app.example.com  "]),
        "https://app.example.com",
      ),
    ).toBe(true);
  });

  test("a trailing slash on either side does not stop a match", () => {
    expect(
      SessionReplayGateCache.isOriginAllowed(
        buildPolicy(["https://app.example.com/"]),
        "https://app.example.com",
      ),
    ).toBe(true);
    expect(
      SessionReplayGateCache.isOriginAllowed(
        buildPolicy(["https://app.example.com"]),
        "https://app.example.com/",
      ),
    ).toBe(true);
  });

  test("a blank entry does not turn a configured allowlist back into an open one", () => {
    /*
     * A list of blanks is still a configured list: the customer meant to
     * restrict something. It must refuse rather than fall back to the
     * empty-list permissive branch.
     */
    const policy: SessionReplayGatePolicy = buildPolicy(["", "   "]);

    expect(
      SessionReplayGateCache.isOriginAllowed(
        policy,
        "https://anything.example.com",
      ),
    ).toBe(false);
  });

  test("an origin matching any one entry of several is accepted", () => {
    const policy: SessionReplayGatePolicy = buildPolicy([
      "https://app.example.com",
      "https://*.other.example",
      "http://localhost:3000",
    ]);

    expect(
      SessionReplayGateCache.isOriginAllowed(policy, "http://localhost:3000"),
    ).toBe(true);
    expect(
      SessionReplayGateCache.isOriginAllowed(
        policy,
        "https://tenant.other.example",
      ),
    ).toBe(true);
    expect(
      SessionReplayGateCache.isOriginAllowed(
        policy,
        "https://not.listed.example",
      ),
    ).toBe(false);
  });
});

describe("SessionReplayGateCache.isOriginAllowed - the delegation itself", () => {
  test("a configured allowlist is answered by the shared matcher, with the request's own arguments", () => {
    const matchesSpy: jest.SpyInstance = jest.spyOn(OriginAllowList, "matches");

    const allowedOrigins: Array<string> = ["https://app.example.com"];

    SessionReplayGateCache.isOriginAllowed(
      buildPolicy(allowedOrigins),
      "https://app.example.com",
    );

    expect(matchesSpy).toHaveBeenCalledTimes(1);
    expect(matchesSpy).toHaveBeenCalledWith(
      "https://app.example.com",
      allowedOrigins,
    );
  });

  /*
   * The gate must not second-guess the matcher on a configured list. If it
   * ever grew a rule of its own here, session replay and Browser-key ingest
   * would start disagreeing about which origins are legitimate - a split that
   * is confusing to debug and exploitable in whichever direction is looser.
   */
  test("on a configured allowlist the gate returns exactly what the shared matcher returns", () => {
    const allowedOrigins: Array<string> = [
      "https://app.example.com",
      "https://*.tenant.example.com",
    ];

    const origins: Array<string | undefined> = [
      "https://app.example.com",
      "https://a.tenant.example.com",
      "https://tenant.example.com",
      "https://eviltenant.example.com",
      "http://app.example.com",
      "https://app.example.com:8443",
      "  HTTPS://APP.EXAMPLE.COM/  ",
      "https://unlisted.example.com",
      "",
      undefined,
    ];

    for (const origin of origins) {
      expect(
        SessionReplayGateCache.isOriginAllowed(
          buildPolicy(allowedOrigins),
          origin,
        ),
      ).toBe(OriginAllowList.matches(origin, allowedOrigins));
    }
  });
});
