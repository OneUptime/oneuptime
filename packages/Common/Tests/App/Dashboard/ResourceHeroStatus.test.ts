import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  Translator,
  createTranslator,
} from "../../../UI/Utils/TranslateTemplate";
import {
  RESOURCE_CONNECTED_LABEL,
  RESOURCE_DISCONNECTED_LABEL,
  RESOURCE_HEALTH_UNKNOWN_LABEL,
  ResourceHealth,
  getResourceConnectionLabel,
  getResourceHealthLabel,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ResourceHeroStatus";

/*
 * #5298's UI review: the words in a resource hero's pills. Nine heroes (a
 * host, a Docker and a Podman host, a Docker Swarm, a Kubernetes cluster,
 * a vCenter, a Proxmox and a Ceph cluster, an IoT fleet) wrote
 * "Connected", "Disconnected", "Healthy", "Degraded" and "Unhealthy" in
 * English for every reader, and four of them called a disconnected
 * resource's health a bare "Unknown" where a Ceph cluster's and a storage
 * array's said "Health Unknown". Every hero now takes the words from
 * ResourceHeroStatus, looked up in the reader's language.
 */

const ENGLISH: Translator = createTranslator(undefined, "en");

const LOCALES_DIRECTORY: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(code: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIRECTORY, `${code}.json`), "utf8"),
  ) as Record<string, string>;
}

// A reader in the Dashboard's own German and Persian.
const GERMAN_WORDS: Record<string, string> = readLocale("de");
const PERSIAN_WORDS: Record<string, string> = readLocale("fa");

const GERMAN: Translator = createTranslator((text: string) => {
  return GERMAN_WORDS[text];
}, "de");

const PERSIAN: Translator = createTranslator((text: string) => {
  return PERSIAN_WORDS[text];
}, "fa");

const ALL_HEALTH: Array<ResourceHealth> = ["Healthy", "Degraded", "Unhealthy"];

describe("the connection pill", () => {
  test("says Connected while the agent reports", () => {
    expect(
      getResourceConnectionLabel({
        translator: ENGLISH,
        isConnected: true,
        status: "connected",
      }),
    ).toBe("Connected");
  });

  test("says Disconnected for a stopped agent, an empty status and none", () => {
    for (const status of ["disconnected", "Disconnected", "", "  ", null]) {
      expect(
        getResourceConnectionLabel({
          translator: ENGLISH,
          isConnected: false,
          status: status,
        }),
      ).toBe("Disconnected");
    }
    expect(
      getResourceConnectionLabel({
        translator: ENGLISH,
        isConnected: false,
        status: undefined,
      }),
    ).toBe("Disconnected");
  });

  test("any other state the agent's record holds is said as it is held, capitalized", () => {
    expect(
      getResourceConnectionLabel({
        translator: ENGLISH,
        isConnected: false,
        status: "pending",
      }),
    ).toBe("Pending");
  });

  test("whether the agent is connected decides, not the stored word", () => {
    // A hero counts "active" as connected too.
    expect(
      getResourceConnectionLabel({
        translator: ENGLISH,
        isConnected: true,
        status: "active",
      }),
    ).toBe("Connected");
  });

  test("in the reader's language: German and Persian", () => {
    expect(
      getResourceConnectionLabel({
        translator: GERMAN,
        isConnected: true,
        status: "connected",
      }),
    ).toBe(GERMAN_WORDS["Connected"]);
    expect(
      getResourceConnectionLabel({
        translator: GERMAN,
        isConnected: false,
        status: "disconnected",
      }),
    ).toBe(GERMAN_WORDS["Disconnected"]);
    expect(
      getResourceConnectionLabel({
        translator: PERSIAN,
        isConnected: true,
        status: "connected",
      }),
    ).toBe(PERSIAN_WORDS["Connected"]);

    // The German words are German, not the English ones.
    expect(GERMAN_WORDS["Connected"]).toBe("Verbunden");
    expect(GERMAN_WORDS["Disconnected"]).toBe("Getrennt");
  });

  test("a state the Dashboard has no words for stays as the agent wrote it", () => {
    expect(
      getResourceConnectionLabel({
        translator: GERMAN,
        isConnected: false,
        status: "rebooting",
      }),
    ).toBe("Rebooting");
  });

  test("its words are the Dashboard's keys", () => {
    expect(RESOURCE_CONNECTED_LABEL).toBe("Connected");
    expect(RESOURCE_DISCONNECTED_LABEL).toBe("Disconnected");
  });
});

describe("the health pill", () => {
  test("says the health worked out from the inventory while the agent reports", () => {
    for (const health of ALL_HEALTH) {
      expect(
        getResourceHealthLabel({
          translator: ENGLISH,
          health: health,
          isConnected: true,
        }),
      ).toBe(health);
    }
  });

  test("says Health Unknown - never a bare Unknown, never the stale health - while it does not", () => {
    for (const health of ALL_HEALTH) {
      const label: string = getResourceHealthLabel({
        translator: ENGLISH,
        health: health,
        isConnected: false,
      });
      expect(label).toBe("Health Unknown");
      expect(label).toBe(RESOURCE_HEALTH_UNKNOWN_LABEL);
    }
  });

  test("a health it does not know reads as its worst, as its red pill does", () => {
    expect(
      getResourceHealthLabel({
        translator: ENGLISH,
        health: "Failing" as ResourceHealth,
        isConnected: true,
      }),
    ).toBe("Unhealthy");
  });

  test("in the reader's language: every word, German and Persian", () => {
    for (const health of ALL_HEALTH) {
      const german: string = getResourceHealthLabel({
        translator: GERMAN,
        health: health,
        isConnected: true,
      });
      expect(german).toBe(GERMAN_WORDS[health]);
      expect(german).not.toBe(health);

      const persian: string = getResourceHealthLabel({
        translator: PERSIAN,
        health: health,
        isConnected: true,
      });
      expect(persian).toBe(PERSIAN_WORDS[health]);
      expect(persian).not.toBe(health);
    }

    expect(
      getResourceHealthLabel({
        translator: GERMAN,
        health: "Healthy",
        isConnected: false,
      }),
    ).toBe("Integrität unbekannt");
    expect(
      getResourceHealthLabel({
        translator: PERSIAN,
        health: "Healthy",
        isConnected: false,
      }),
    ).toBe(PERSIAN_WORDS["Health Unknown"]);
    expect(PERSIAN_WORDS["Health Unknown"]).not.toBe("Health Unknown");
  });
});

describe("every Dashboard language words the pills", () => {
  const LOCALES: Array<string> = fs
    .readdirSync(LOCALES_DIRECTORY)
    .filter((name: string): boolean => {
      return name.endsWith(".json") && name !== "en.json";
    })
    .map((name: string): string => {
      return name.replace(".json", "");
    });

  // The hero pills' words, and the Ceph and storage array health pills'.
  const PILL_WORDS: Array<string> = [
    "Connected",
    "Disconnected",
    "Healthy",
    "Degraded",
    "Unhealthy",
    "Health Unknown",
    "Health OK",
    "Health Warning",
    "Health Error",
    "Health Critical",
  ];

  test("there are sixteen of them", () => {
    expect(LOCALES).toHaveLength(16);
  });

  test.each(LOCALES)("%s has its own word for each", (code: string) => {
    const words: Record<string, string> = readLocale(code);
    for (const word of PILL_WORDS) {
      expect({ word: word, value: words[word] }).toEqual({
        word: word,
        value: expect.any(String),
      });
      expect({ word: word, translated: words[word] !== word }).toEqual({
        word: word,
        translated: true,
      });
    }
  });

  test("English has the key the extractor found for Unhealthy", () => {
    expect(readLocale("en")["Unhealthy"]).toBe("Unhealthy");
  });
});
