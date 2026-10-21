import { EncryptionSecret } from "../../../../Server/EnvironmentConfig";
import EpisodeGroupingKey from "../../../../Server/Utils/Rules/EpisodeGroupingKey";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, jest, test } from "@jest/globals";
import crypto from "crypto";

/*
 * THE TITLE IN AN EPISODE'S GROUPING KEY, HASHED.
 *
 * An episode a private incident (or alert) opens under a rule that groups by
 * title is stored with the title in its grouping key hashed: the key is read
 * with the episode by everyone who can see it, and the episode is not
 * private. The hash keeps grouping as it was - titles that group together
 * hash alike, and others do not - while it neither shows the title nor lets
 * a reader confirm a guess at it by hashing the guess: it is keyed with
 * ENCRYPTION_SECRET.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0195d1e2-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "0195d1e2-0000-4000-8000-000000000002",
);
const MONITOR_ID: string = "0195d1e2-0000-4000-8000-0000000000a1";
const SEVERITY_ID: string = "0195d1e2-0000-4000-8000-0000000000c1";
const LABEL_IDS: string =
  "0195d1e2-0000-4000-8000-0000000000f1,0195d1e2-0000-4000-8000-0000000000f2";

const TITLE: string = "Northwind payroll export 2024 copied to a public bucket";
// The title as a rule that groups by title keys episodes by it.
const TITLE_PART: string =
  "title:northwind payroll export X copied to a public bucket";

// A hashed title part: the name, and an HMAC-SHA256 in hex.
const HASHED_TITLE_PART: RegExp = /^titleHmac:[0-9a-f]{64}$/;

type EpisodeGroupingKeyClass = typeof EpisodeGroupingKey;

function hashedTitlePart(
  title: string,
  projectId: ObjectID = PROJECT_ID,
): string {
  return EpisodeGroupingKey.getHashedTitlePart({
    projectId: projectId,
    title: title,
  });
}

// Loads a private copy of the module that hashes with a different secret.
function loadWithEncryptionSecret(secret: string): EpisodeGroupingKeyClass {
  let loaded: EpisodeGroupingKeyClass | null = null;

  jest.isolateModules((): void => {
    jest.doMock("../../../../Server/EnvironmentConfig", (): unknown => {
      return {
        ...(jest.requireActual(
          "../../../../Server/EnvironmentConfig",
        ) as Record<string, unknown>),
        EncryptionSecret: new ObjectID(secret),
      };
    });

    loaded = (
      jest.requireActual(
        "../../../../Server/Utils/Rules/EpisodeGroupingKey",
      ) as {
        default: EpisodeGroupingKeyClass;
      }
    ).default;
  });

  jest.dontMock("../../../../Server/EnvironmentConfig");

  if (!loaded) {
    throw new Error("module did not load");
  }

  return loaded;
}

describe("the title part of a grouping key", () => {
  test("is the title lowercased, every number an X - as before", () => {
    expect(EpisodeGroupingKey.getTitlePart(TITLE)).toBe(TITLE_PART);
    expect(EpisodeGroupingKey.getTitlePart("Disk 91% full on DB-2")).toBe(
      "title:disk X% full on db-X",
    );
  });
});

describe("the hashed title part", () => {
  test("is an HMAC in hex, with no trace of the title", () => {
    const part: string = hashedTitlePart(TITLE);

    expect(part).toMatch(HASHED_TITLE_PART);
    expect(part).not.toMatch(/northwind|payroll|bucket/i);
  });

  test("is the same for titles that group together: case and numbers count for nothing", () => {
    expect(
      hashedTitlePart(
        "NORTHWIND payroll export 2025 copied to a public bucket",
      ),
    ).toBe(hashedTitlePart(TITLE));
    expect(hashedTitlePart("Disk 91% full")).toBe(
      hashedTitlePart("disk 95% FULL"),
    );
  });

  test("differs for titles that do not group together", () => {
    expect(
      hashedTitlePart("Northwind payroll export copied to a private bucket"),
    ).not.toBe(hashedTitlePart(TITLE));
    expect(hashedTitlePart("Disk full")).not.toBe(
      hashedTitlePart("Disk full!"),
    );
  });

  test("differs between projects", () => {
    expect(hashedTitlePart(TITLE, OTHER_PROJECT_ID)).not.toBe(
      hashedTitlePart(TITLE),
    );
  });

  test("is not a plain hash a reader could make of a guessed title", () => {
    const hash: string = hashedTitlePart("Disk full").replace("titleHmac:", "");

    const plainHashes: Array<string> = [
      "disk full",
      "title:disk full",
      `${PROJECT_ID.toString()}:disk full`,
    ].map((text: string): string => {
      return crypto.createHash("sha256").update(text).digest("hex");
    });

    expect(plainHashes).not.toContain(hash);
  });

  test("is keyed with ENCRYPTION_SECRET: the same secret hashes alike, another differently", () => {
    const sameSecret: EpisodeGroupingKeyClass = loadWithEncryptionSecret(
      EncryptionSecret.toString(),
    );
    const otherSecret: EpisodeGroupingKeyClass = loadWithEncryptionSecret(
      `${EncryptionSecret.toString()}-rotated`,
    );

    const data: { projectId: ObjectID; title: string } = {
      projectId: PROJECT_ID,
      title: TITLE,
    };

    expect(sameSecret.getHashedTitlePart(data)).toBe(hashedTitlePart(TITLE));
    expect(otherSecret.getHashedTitlePart(data)).toMatch(HASHED_TITLE_PART);
    expect(otherSecret.getHashedTitlePart(data)).not.toBe(
      hashedTitlePart(TITLE),
    );
  });
});

describe("a grouping key with its title hashed", () => {
  test("has the title part hashed and every other part as built", () => {
    const groupingKey: string = `monitor:${MONITOR_ID}|severity:${SEVERITY_ID}|${TITLE_PART}|incidentLabels:${LABEL_IDS}|monitorLabels:${LABEL_IDS}`;

    expect(
      EpisodeGroupingKey.hashTitle({
        groupingKey: groupingKey,
        projectId: PROJECT_ID,
        title: TITLE,
      }),
    ).toBe(
      `monitor:${MONITOR_ID}|severity:${SEVERITY_ID}|${hashedTitlePart(TITLE)}|incidentLabels:${LABEL_IDS}|monitorLabels:${LABEL_IDS}`,
    );
  });

  test("is the hashed title part alone when the title is all the key holds", () => {
    expect(
      EpisodeGroupingKey.hashTitle({
        groupingKey: TITLE_PART,
        projectId: PROJECT_ID,
        title: TITLE,
      }),
    ).toBe(hashedTitlePart(TITLE));
  });

  test("is the key as built when it was built without the title", () => {
    for (const groupingKey of [
      "default",
      `monitor:${MONITOR_ID}|severity:${SEVERITY_ID}`,
    ]) {
      expect(
        EpisodeGroupingKey.hashTitle({
          groupingKey: groupingKey,
          projectId: PROJECT_ID,
          title: TITLE,
        }),
      ).toBe(groupingKey);
    }
  });

  test("finds a title holding the key's own separators and names, and leaves nothing of it", () => {
    const title: string =
      "Title: checkout|severity:$& down $1 for title:Northwind";
    const groupingKey: string = `severity:${SEVERITY_ID}|${EpisodeGroupingKey.getTitlePart(title)}|alertLabels:${LABEL_IDS}`;

    const hashed: string = EpisodeGroupingKey.hashTitle({
      groupingKey: groupingKey,
      projectId: PROJECT_ID,
      title: title,
    });

    expect(hashed).toBe(
      `severity:${SEVERITY_ID}|${hashedTitlePart(title)}|alertLabels:${LABEL_IDS}`,
    );
    expect(hashed).not.toMatch(/checkout|northwind/i);
  });
});
