import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { getMetadataArgsStorage } from "typeorm";
import { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";
import AllModelTypes from "../../../../Models/DatabaseModels/Index";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  ADDED_BACK_BY_INGEST_SENTENCE,
  DELETE_CONSEQUENCES,
  DeleteConsequence,
  DeleteSideEffect,
  getDeleteConsequence,
  getDeleteConsequenceSentences,
} from "../../../../UI/Components/DeleteConfirmation/DeleteConsequences";
import {
  createTranslator,
  Translator,
} from "../../../../UI/Utils/TranslateTemplate";

/*
 * Every Delete question about a record says what goes with it - the row's
 * Delete in a list, a bulk Delete, the record's own Delete page - from one
 * catalog (DeleteConsequences). A sentence there is a promise to the person
 * about to press a red button, so each claim it makes is held to the code
 * that makes it true:
 *
 *   - a table it says goes with the record has an ON DELETE CASCADE relation
 *     to it (the database deletes those rows along with it);
 *   - a table it says stays has no such relation;
 *   - work it says a service does on delete (releasing phone numbers,
 *     deleting a device's monitors) is in that service's delete hook;
 *   - a kind it says comes back has the ingest code that adds it again.
 *
 * Change a relation, a hook or an ingest path, and the sentence that
 * describes it has to change with it.
 */

const COMMON_ROOT: string = path.resolve(__dirname, "../../../..");
const SERVICES_DIR: string = path.join(COMMON_ROOT, "Server", "Services");
const DASHBOARD_LOCALES: string = path.resolve(
  COMMON_ROOT,
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

type ModelClass = { new (): BaseModel };

const modelsByTable: Map<string, ModelClass> = new Map();

for (const modelType of AllModelTypes as Array<ModelClass>) {
  const tableName: string | null = new modelType().tableName;

  if (tableName) {
    modelsByTable.set(tableName, modelType);
  }
}

const relations: Array<RelationMetadataArgs> =
  getMetadataArgsStorage().relations;

type ModelOfFunction = (tableName: string) => ModelClass;

const modelOf: ModelOfFunction = (tableName: string): ModelClass => {
  const modelType: ModelClass | undefined = modelsByTable.get(tableName);

  if (!modelType) {
    throw new Error(`No database model has the table name ${tableName}.`);
  }

  return modelType;
};

type CascadesFunction = (child: ModelClass, parent: ModelClass) => boolean;

// Whether `child` has a ManyToOne relation to `parent` with ON DELETE CASCADE.
const cascadesFrom: CascadesFunction = (
  child: ModelClass,
  parent: ModelClass,
): boolean => {
  return relations.some((relation: RelationMetadataArgs): boolean => {
    if (relation.target !== child || relation.relationType !== "many-to-one") {
      return false;
    }

    const relationType: unknown =
      typeof relation.type === "function"
        ? (relation.type as () => unknown)()
        : relation.type;

    return relationType === parent && relation.options.onDelete === "CASCADE";
  });
};

type ServiceSourceFunction = (service: string) => string;

const serviceSource: ServiceSourceFunction = (service: string): string => {
  return fs.readFileSync(path.join(SERVICES_DIR, `${service}.ts`), "utf8");
};

type MethodBodyFunction = (source: string, method: string) => string;

/*
 * The text of a class method, from its name to the brace that closes it
 * (braces counted; good enough for the service files, whose bodies hold no
 * unbalanced braces in strings).
 */
const methodBody: MethodBodyFunction = (
  source: string,
  method: string,
): string => {
  const start: number = source.indexOf(`async ${method}(`);

  if (start === -1) {
    return "";
  }

  const open: number = source.indexOf("{", source.indexOf(")", start));
  let depth: number = 0;

  for (let index: number = open; index < source.length; index++) {
    if (source[index] === "{") {
      depth++;
    } else if (source[index] === "}") {
      depth--;

      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  return source.slice(start);
};

const entries: Array<[string, DeleteConsequence]> =
  Object.entries(DELETE_CONSEQUENCES);

describe("DeleteConsequences: the catalog", () => {
  test("covers the kinds of record the lists delete from, and only real ones", () => {
    expect(entries.length).toBeGreaterThan(30);

    for (const [tableName] of entries) {
      expect(modelsByTable.has(tableName)).toBe(true);
    }
  });

  test.each(entries)(
    "%s: every sentence is about the kind, so it reads the same for one row and for many",
    (_tableName: string, consequence: DeleteConsequence) => {
      if (consequence.sentence) {
        // "Deleting a status page also deletes ...", never "Its ...".
        expect(consequence.sentence).toMatch(/^Deleting an? /);
        expect(consequence.sentence.endsWith(".")).toBe(true);
      }

      // Every entry says something.
      expect(
        Boolean(consequence.sentence) || Boolean(consequence.addedBackBy),
      ).toBe(true);
    },
  );

  test("the shared sentence for what ingest adds back is about the record, not a kind", () => {
    expect(ADDED_BACK_BY_INGEST_SENTENCE).toBe(
      "If OneUptime still receives data about it, it is added back, without the labels, owners and settings you gave it.",
    );
  });
});

describe("DeleteConsequences: what goes with a record", () => {
  const deletedWith: Array<[string, string]> = entries.flatMap(
    ([tableName, consequence]: [string, DeleteConsequence]) => {
      return (consequence.deletedWith || []).map(
        (child: string): [string, string] => {
          return [tableName, child];
        },
      );
    },
  );

  test("names tables the sentences describe", () => {
    expect(deletedWith.length).toBeGreaterThan(40);
  });

  test.each(deletedWith)(
    "deleting a %s deletes its %s rows (ON DELETE CASCADE)",
    (parent: string, child: string) => {
      expect(cascadesFrom(modelOf(child), modelOf(parent))).toBe(true);
    },
  );
});

describe("DeleteConsequences: what stays", () => {
  const stays: Array<[string, string]> = entries.flatMap(
    ([tableName, consequence]: [string, DeleteConsequence]) => {
      return (consequence.stays || []).map(
        (other: string): [string, string] => {
          return [tableName, other];
        },
      );
    },
  );

  test("names tables the sentences say stay", () => {
    expect(stays.length).toBeGreaterThan(5);
  });

  test.each(stays)(
    "deleting a %s leaves its %s rows where they are",
    (parent: string, other: string) => {
      expect(cascadesFrom(modelOf(other), modelOf(parent))).toBe(false);
    },
  );
});

describe("DeleteConsequences: what a service does when one is deleted", () => {
  const sideEffects: Array<[string, DeleteSideEffect]> = entries.flatMap(
    ([tableName, consequence]: [string, DeleteConsequence]) => {
      return (consequence.sideEffects || []).map(
        (effect: DeleteSideEffect): [string, DeleteSideEffect] => {
          return [tableName, effect];
        },
      );
    },
  );

  test("names the services the sentences describe", () => {
    expect(
      sideEffects.map(([tableName]: [string, DeleteSideEffect]) => {
        return tableName;
      }),
    ).toEqual(
      expect.arrayContaining(["IncomingCallPolicy", "NetworkDevice", "Team"]),
    );
  });

  test.each(sideEffects)(
    "%s: its service's delete hook does it",
    (_tableName: string, effect: DeleteSideEffect) => {
      const hook: string = methodBody(
        serviceSource(effect.service),
        "onBeforeDelete",
      );

      expect(hook).not.toBe("");
      expect(hook).toContain(effect.code);
    },
  );
});

describe("DeleteConsequences: what ingest adds back", () => {
  const addedBack: Array<[string, DeleteSideEffect]> = entries
    .filter(([, consequence]: [string, DeleteConsequence]) => {
      return Boolean(consequence.addedBackBy);
    })
    .map(([tableName, consequence]: [string, DeleteConsequence]) => {
      return [tableName, consequence.addedBackBy!];
    });

  test("covers the resources telemetry describes", () => {
    expect(
      addedBack.map(([tableName]: [string, DeleteSideEffect]) => {
        return tableName;
      }),
    ).toEqual(
      expect.arrayContaining([
        "Host",
        "KubernetesCluster",
        "Service",
        "DockerHost",
        "CloudResource",
        "RumApplication",
      ]),
    );
  });

  test.each(addedBack)(
    "%s is created again by the code the catalog names",
    (_tableName: string, effect: DeleteSideEffect) => {
      expect(serviceSource(effect.service)).toContain(effect.code);
    },
  );
});

describe("DeleteConsequences: the words", () => {
  const english: Record<string, string> = JSON.parse(
    fs.readFileSync(path.join(DASHBOARD_LOCALES, "en.json"), "utf8"),
  ) as Record<string, string>;

  const german: Record<string, string> = JSON.parse(
    fs.readFileSync(path.join(DASHBOARD_LOCALES, "de.json"), "utf8"),
  ) as Record<string, string>;

  const sentences: Array<string> = [
    ...new Set(
      entries
        .map(([, consequence]: [string, DeleteConsequence]) => {
          return consequence.sentence || "";
        })
        .filter(Boolean)
        .concat([ADDED_BACK_BY_INGEST_SENTENCE]),
    ),
  ];

  test.each(sentences)(
    "%s is a Dashboard translation key, translated",
    (sentence: string) => {
      expect(english[sentence]).toBe(sentence);
      expect(german[sentence]).toBeTruthy();
      expect(german[sentence]).not.toBe(sentence);
    },
  );

  test("a kind with a sentence says it, then that ingest adds it back", () => {
    expect(getDeleteConsequenceSentences("IoTFleet")).toEqual([
      DELETE_CONSEQUENCES["IoTFleet"]!.sentence,
      ADDED_BACK_BY_INGEST_SENTENCE,
    ]);
    expect(getDeleteConsequenceSentences("Host")).toEqual([
      ADDED_BACK_BY_INGEST_SENTENCE,
    ]);
    expect(getDeleteConsequenceSentences("StatusPage")).toEqual([
      "Deleting a status page also deletes its subscribers, private users and custom domains.",
    ]);
  });

  test("a kind with nothing to add says nothing", () => {
    expect(getDeleteConsequenceSentences("CodeRepository")).toEqual([]);
    expect(getDeleteConsequenceSentences("Label")).toEqual([]);
    expect(getDeleteConsequenceSentences(undefined)).toEqual([]);
    expect(getDeleteConsequenceSentences(null)).toEqual([]);
    expect(getDeleteConsequence("CodeRepository")).toBe("");
  });

  test("each sentence is translated on its own, and joined with a space", () => {
    const translator: Translator = createTranslator((text: string) => {
      return german[text];
    }, "de");

    expect(getDeleteConsequence("IoTFleet", translator)).toBe(
      `${german[DELETE_CONSEQUENCES["IoTFleet"]!.sentence!]} ${german[ADDED_BACK_BY_INGEST_SENTENCE]}`,
    );
  });

  test("a reader whose language lacks a sentence reads it in English", () => {
    const translator: Translator = createTranslator(() => {
      return undefined;
    }, "de");

    expect(getDeleteConsequence("Workflow", translator)).toBe(
      "Deleting a workflow also deletes its variables and run logs.",
    );
  });
});
