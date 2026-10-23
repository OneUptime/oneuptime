import { ModelRelation, modelRelations } from "./ModelRelations";
import EnterpriseLicense from "../../Models/DatabaseModels/EnterpriseLicense";
import EnterpriseLicenseInstance from "../../Models/DatabaseModels/EnterpriseLicenseInstance";
import { describe, expect, test } from "@jest/globals";

/*
 * modelRelations reads TypeORM's relation metadata for suites outside
 * Common that cannot import typeorm (ee's DeletedLicenseClaims): each
 * relation as declared, with its lazy type function already called.
 */
describe("modelRelations", () => {
  test("reads a relation as its decorator declares it: the model, the model it points to, its kind and ON DELETE", () => {
    const relations: Array<ModelRelation> = modelRelations().filter(
      (relation: ModelRelation): boolean => {
        return relation.model === EnterpriseLicenseInstance;
      },
    );

    expect(relations).toContainEqual({
      model: EnterpriseLicenseInstance,
      relatedModel: EnterpriseLicense,
      relationType: "many-to-one",
      onDelete: "CASCADE",
    });
  });

  test("calls each lazy type function, so a relation points at the model class, never at the function", () => {
    const relations: Array<ModelRelation> = modelRelations();

    expect(relations.length).toBeGreaterThan(0);

    /*
     * A class and the arrow function that returns it are both functions;
     * only the class has a prototype.
     */
    const notClasses: Array<ModelRelation> = relations.filter(
      (relation: ModelRelation): boolean => {
        return (
          typeof relation.relatedModel !== "function" ||
          typeof (relation.relatedModel as { prototype?: unknown })
            .prototype !== "object"
        );
      },
    );

    expect(notClasses).toEqual([]);
  });
});
