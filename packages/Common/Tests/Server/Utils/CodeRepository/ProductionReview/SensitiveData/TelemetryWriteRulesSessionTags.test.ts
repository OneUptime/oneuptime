import { SensitiveDataCandidate } from "../../../../../../Server/Utils/CodeRepository/ProductionReview/SensitiveData/SensitiveDataCandidate";
import { SensitiveNameMatcher } from "../../../../../../Server/Utils/CodeRepository/ProductionReview/SensitiveData/SensitiveDataNames";
import { readPatchLines } from "../../../../../../Server/Utils/CodeRepository/ProductionReview/SensitiveData/SensitiveDataPatch";
import {
  findTelemetryWrites,
  readSink,
  SESSION_TAGS_LOCATION,
  SESSION_TAGS_LOCATION_PREFIX,
  SESSION_TAGS_WHY,
} from "../../../../../../Server/Utils/CodeRepository/ProductionReview/SensitiveData/TelemetryWriteRules";
import {
  SensitiveDataLeakKind,
  SensitiveDataSink,
} from "../../../../../../Types/CodeRepository/ProductionReviewSensitiveData";
import DataSensitivity from "../../../../../../Types/DataSecurity/DataSensitivity";
import { RUM_SESSION_TAGS_PREFIX } from "../../../../../../Types/DataSecurity/RumSessionPlaces";
import { describe, expect, test } from "@jest/globals";

/*
 * A RECORDED SESSION'S TAGS, IN A PULL REQUEST (#11458).
 *
 * OneUptime's RUM SDK tags a session with setTags({ key: value }) and
 * addTag(key, value) - on `window.OneUptimeReplay`, through the React
 * Native hook's `replay`, and as the queue's ["setTags", ...] and
 * ["addTag", ...] before the recorder loads. A tag is stored as sent in
 * every masking mode, and everyone who can list sessions reads it, so a
 * change that tags a session with an email is the early form of the
 * finding Data Security now makes at sessions.tags.<key>. It is a Session
 * point there, with a sentence of its own; a tag is never taken for who
 * the session's user is, whatever its key; an opaque tag is no point; and
 * another SDK's setTags (an error tracker's) is what it was.
 */

const matcher: SensitiveNameMatcher = new SensitiveNameMatcher();

function writesIn(
  path: string,
  lines: Array<string>,
): Array<SensitiveDataCandidate> {
  return findTelemetryWrites({
    path,
    lines: readPatchLines(
      [
        `@@ -0,0 +1,${lines.length} @@`,
        ...lines.map((line: string): string => {
          return `+${line}`;
        }),
      ].join("\n"),
    ),
    matcher,
  });
}

function onlyPoint(path: string, lines: Array<string>): SensitiveDataCandidate {
  const points: Array<SensitiveDataCandidate> = writesIn(path, lines);

  expect(points).toHaveLength(1);

  return points[0]!;
}

describe("a recorded session's tags (#11458)", () => {
  test("OneUptimeReplay.setTags({ customer: user.email }): an email address in a session's tags, its own sentence, its fix and the line without it", () => {
    const point: SensitiveDataCandidate = onlyPoint("src/checkout.ts", [
      "export function tagSession(user: User): void {",
      '  OneUptimeReplay.setTags({ customer: user.email, build: "2026.11" });',
      "}",
    ]);

    expect(point).toMatchObject({
      kind: SensitiveDataLeakKind.Telemetry,
      checkId: "sensitive-data-in-telemetry",
      sink: SensitiveDataSink.Session,
      path: "src/checkout.ts",
      line: 2,
      subject: "user.email",
      where: "OneUptimeReplay.setTags",
      sensitivity: DataSensitivity.Confidential,
      isBlocking: false,
      location: "sessions.tags.customer",
      text: `Writes an email address to a recorded session's tags: \`user.email\`, in \`OneUptimeReplay.setTags\`. ${SESSION_TAGS_WHY}`,
      fix: "Leave `user.email` out of the session's tags, or tag the session with an opaque value instead, such as an id.",
      suggestion: {
        startLine: 2,
        endLine: 2,
        original: [
          '  OneUptimeReplay.setTags({ customer: user.email, build: "2026.11" });',
        ],
        replacement: ['  OneUptimeReplay.setTags({ build: "2026.11" });'],
        isByAi: false,
      },
    });
    expect(SESSION_TAGS_WHY).toBe(
      "A session's tags are stored as sent, and everyone who can list sessions reads them.",
    );
  });

  test("addTag(key, value): the tag is under the key the call is handed first", () => {
    const point: SensitiveDataCandidate = onlyPoint("src/account.js", [
      'window.OneUptimeReplay.addTag("email", account.email);',
    ]);

    expect(point).toMatchObject({
      sink: SensitiveDataSink.Session,
      subject: "email",
      where: "window.OneUptimeReplay.addTag",
      location: "sessions.tags.email",
      text: `Writes an email address to a recorded session's tags: \`email\`, in \`window.OneUptimeReplay.addTag\`. ${SESSION_TAGS_WHY}`,
    });
  });

  // Each way the SDK is handed a tag, as its documentation writes it.
  test.each([
    [
      "the browser SDK",
      ["OneUptimeReplay.setTags({ owner: order.ownerEmail });"],
      "OneUptimeReplay.setTags",
      "sessions.tags.owner",
    ],
    [
      "the browser SDK on window, one tag",
      ['window.OneUptimeReplay.addTag("contact", customer.email);'],
      "window.OneUptimeReplay.addTag",
      "sessions.tags.contact",
    ],
    [
      "the React Native SDK, through its hook",
      [
        "const replay = useOneUptimeReplay();",
        "replay.setTags({ shopper: shopper.email });",
      ],
      "replay.setTags",
      "sessions.tags.shopper",
    ],
    [
      "a module's recorder",
      ['recorder.addTag("buyer", buyer.email);'],
      "recorder.addTag",
      "sessions.tags.buyer",
    ],
    [
      "the command queue, on one line",
      ['window.OneUptimeReplayQueue.push(["setTags", { owner: user.email }]);'],
      'window.OneUptimeReplayQueue.push(["setTags"])',
      "sessions.tags.owner",
    ],
    [
      "the command queue's addTag",
      ['window.OneUptimeReplayQueue.push(["addTag", "owner", user.email]);'],
      'window.OneUptimeReplayQueue.push(["addTag"])',
      "sessions.tags.owner",
    ],
    [
      "the command queue, as its docs write it before the recorder loads",
      [
        "(window.OneUptimeReplayQueue = window.OneUptimeReplayQueue || []).push([",
        '  "setTags",',
        "  { owner: user.email, build: BUILD_ID },",
        "]);",
      ],
      'window.OneUptimeReplayQueue.push(["setTags"])',
      "sessions.tags.owner",
    ],
  ])(
    "%s",
    (_label: string, lines: Array<string>, where: string, location: string) => {
      const point: SensitiveDataCandidate = onlyPoint("src/session.ts", lines);

      expect(point.sink).toBe(SensitiveDataSink.Session);
      expect(point.where).toBe(where);
      expect(point.location).toBe(location);
      expect(point.text).toContain("to a recorded session's tags");
      expect(point.text.endsWith(SESSION_TAGS_WHY)).toBe(true);
    },
  );

  test("one push with an identity and tags is read entry by entry: a point for each", () => {
    const points: Array<SensitiveDataCandidate> = writesIn("src/boot.js", [
      "window.OneUptimeReplayQueue.push(",
      '  ["grantConsent"],',
      '  ["identify", user.email, { plan: "pro" }],',
      '  ["setTags", { contact: user.email }],',
      '  ["addTag", "phone", user.phone],',
      ");",
    ]);

    expect(
      points.map((point: SensitiveDataCandidate): Array<unknown> => {
        return [point.line, point.location, point.where];
      }),
    ).toEqual([
      [
        3,
        "sessions.identifiedUserLabel",
        'window.OneUptimeReplayQueue.push(["identify"])',
      ],
      [
        4,
        "sessions.tags.contact",
        'window.OneUptimeReplayQueue.push(["setTags"])',
      ],
      [
        5,
        "sessions.tags.phone",
        'window.OneUptimeReplayQueue.push(["addTag"])',
      ],
    ]);
  });

  test("a tag is never who the session's user is, whatever its key", () => {
    for (const key of ["id", "uid", "userId", "user_id", "identity"]) {
      const point: SensitiveDataCandidate = onlyPoint("src/session.js", [
        `OneUptimeReplay.setTags({ ${key}: user.email });`,
      ]);

      expect(point.location).toBe(`sessions.tags.${key}`);
      expect(point.text).not.toContain("Identifies a recorded session");
      expect(point.fix).not.toContain("Identify the session");
    }
  });

  test("a tag whose key the code does not spell out is the session's tags whole", () => {
    const point: SensitiveDataCandidate = onlyPoint("src/session.js", [
      "OneUptimeReplay.addTag(tagName, user.email);",
    ]);

    expect(point.subject).toBe("user.email");
    expect(point.location).toBe(SESSION_TAGS_LOCATION);
    expect(SESSION_TAGS_LOCATION).toBe("sessions.tags");
  });

  test("a whole record of a person given as the tags: every field is a tag", () => {
    for (const [line, subject] of [
      ["OneUptimeReplay.setTags(currentUser);", "currentUser"],
      ["OneUptimeReplay.setTags({ ...user });", "user"],
    ] as Array<[string, string]>) {
      const point: SensitiveDataCandidate = onlyPoint("src/session.js", [line]);

      expect(point).toMatchObject({
        sink: SensitiveDataSink.Session,
        isWholeObject: true,
        location: SESSION_TAGS_LOCATION,
        subject,
      });
      expect(point.text).toBe(
        `Writes a whole record of a person to a recorded session's tags: \`${subject}\`, in \`OneUptimeReplay.setTags\`. Every field of it is written, personal data too. ${SESSION_TAGS_WHY}`,
      );
    }
  });

  test("a secret in a tag is a secret's point, which can fail the check", () => {
    const point: SensitiveDataCandidate = onlyPoint("src/session.ts", [
      'OneUptimeReplay.addTag("api_token", config.apiToken);',
    ]);

    expect(point.checkId).toBe("secrets-in-telemetry");
    expect(point.isBlocking).toBe(true);
    expect(point.location).toBe("sessions.tags.api_token");
    expect(point.fix).toBe(
      "Leave `api_token` out: everyone who reads the telemetry could read the secret.",
    );
  });

  test("the repository's own redaction helper is suggested when the change has one", () => {
    const points: Array<SensitiveDataCandidate> = writesIn("src/session.ts", [
      "logger.info({ email: redactEmail(user.email) });",
      "OneUptimeReplay.setTags({ contact: user.email });",
    ]);

    expect(points).toHaveLength(1);
    expect(points[0]!.fix).toBe(
      "Pass `user.email` through `redactEmail` first, as this change does elsewhere, or leave it out.",
    );
  });

  // What tags a session with no sensitive value: no point.
  test.each([
    ['OneUptimeReplay.setTags({ build: "2026.11.28", experiment: arm });'],
    ['OneUptimeReplay.addTag("tier", account.tier);'],
    ['OneUptimeReplay.addTag("user", user.id);'],
    ["OneUptimeReplay.setTags({ email: hash(user.email) });"],
    ["OneUptimeReplay.setTags({ email: sha256(user.email) });"],
    ['OneUptimeReplay.setTags({ email: "redacted" });'],
    ["OneUptimeReplay.setTags({ hasEmail: !!user.email });"],
    ['window.OneUptimeReplayQueue.push(["setTags", { build: "1.4.2" }]);'],
    [
      "OneUptimeReplay.setTags({ contact: user.email }); // oneuptime:not-sensitive",
    ],
  ])("no point: %s", (line: string) => {
    expect(writesIn("src/session.ts", [line])).toEqual([]);
  });

  test("setTags on nothing, or on another SDK than OneUptime's, tags no recorded session: it is a span's, as it was", () => {
    for (const line of [
      // A tracer's span.setTags, OpenTracing's: read as a span's before #11458 too.
      "setTags({ contact: user.email });",
      "span.setTags({ contact: user.email });",
      // OpenReplay's tracker and LogRocket keep no session tags.
      "tracker.setTags({ contact: user.email });",
      "LogRocket.setTags({ contact: user.email });",
    ]) {
      const points: Array<SensitiveDataCandidate> = writesIn("src/session.ts", [
        line,
      ]);

      expect(
        points.map((point: SensitiveDataCandidate): unknown => {
          return [point.sink, point.location];
        }),
      ).toEqual([[SensitiveDataSink.Span, "attributes.contact"]]);
    }
  });

  test("an error tracker's setTags stays an error report", () => {
    const point: SensitiveDataCandidate = onlyPoint("src/errors.ts", [
      "Sentry.setTags({ email: user.email });",
    ]);

    expect(point.sink).toBe(SensitiveDataSink.Exception);
    expect(point.location).toBe("attributes.email");
    expect(point.text).toContain("to an error report");
  });

  test("read as a sink: OneUptime's recorder's tag methods, on its receivers only", () => {
    for (const name of [
      "OneUptimeReplay.setTags",
      "window.OneUptimeReplay.addTag",
      "replay.setTags",
      "recorder.addTag",
      "sessionRecorder.setTags",
      "sessionReplay.addTag",
    ]) {
      expect(readSink({ name, isMacro: false, isConstructor: false })).toEqual({
        sink: SensitiveDataSink.Session,
        isErrorReport: false,
        isIdentity: false,
        isTags: true,
      });
    }

    // A span's tags, as before #11458: no session's.
    for (const name of ["setTags", "span.setTags", "tracker.setTags"]) {
      expect(
        readSink({ name, isMacro: false, isConstructor: false })?.sink,
      ).toBe(SensitiveDataSink.Span);
    }

    // What writes no tag at all.
    for (const name of [
      "OneUptimeReplay.getTags",
      "OneUptimeReplay.removeTag",
      "posthog.addTag",
    ]) {
      expect(
        readSink({ name, isMacro: false, isConstructor: false }),
      ).toBeNull();
    }

    // Who the user is, as before.
    expect(
      readSink({
        name: "OneUptimeReplay.identify",
        isMacro: false,
        isConstructor: false,
      }),
    ).toEqual({
      sink: SensitiveDataSink.Session,
      isErrorReport: false,
      isIdentity: true,
    });
  });

  test("a tag's place is where Data Security names it", () => {
    expect(SESSION_TAGS_LOCATION_PREFIX).toBe(RUM_SESSION_TAGS_PREFIX);
    expect(SESSION_TAGS_LOCATION_PREFIX).toBe("sessions.tags.");
  });
});
