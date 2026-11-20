import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A MOVE IN A DRAG-ORDERED LIST SETS OFF WHAT A WRITE OF ITS NUMBERS DOES
 * (issue #9609).
 *
 * A move (DatabaseService.moveInList) renumbers a list's rows in one
 * statement of its own, so none of the service's update hooks run for it.
 * Two hooks of its own stand in for them:
 *
 *   - onBeforeMoveInList, which may refuse it: every service that holds a
 *     write of its numbers to StateOrderGuard (a path's built-in states keep
 *     their order) holds a move to it too;
 *   - onMoveInListSuccess, for what follows: every service of a
 *     drag-ordered list whose onUpdateSuccess does something sets off what
 *     a renumbering needs of it there too - or is listed below, with why a
 *     move needs none of it.
 *
 * A service that gains an onUpdateSuccess, or starts guarding its order,
 * has to decide what a move does - by whoever adds it.
 */

const SERVICES_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "Server",
  "Services",
);

type ModelType = { new (): BaseModel; name: string };

/*
 * The services whose onUpdateSuccess a move needs nothing of, and why. A
 * move changes only the rows' numbers.
 */
const NOTHING_TO_FOLLOW_A_MOVE: Record<string, string> = {
  IncidentCustomFieldService:
    "Its onUpdateSuccess moves the values of a renamed field, applies option edits and backfills mapped values: what a field is called and holds, never where it is shown.",
};

const listModels: Array<string> = (AllModelTypes as unknown as Array<ModelType>)
  .filter((modelType: ModelType): boolean => {
    return Boolean(new modelType().getListOrder());
  })
  .map((modelType: ModelType): string => {
    return modelType.name;
  })
  .sort();

function serviceSource(model: string): string {
  return fs.readFileSync(path.join(SERVICES_DIR, `${model}Service.ts`), "utf8");
}

describe("the hooks of a move in a drag-ordered list", () => {
  test("there are drag-ordered lists to check", () => {
    expect(listModels.length).toBeGreaterThan(30);
  });

  test.each(listModels)(
    "%sService: a move sets off what a write of its numbers does",
    (model: string) => {
      const source: string = serviceSource(model);
      const followsWrites: boolean = source.includes(
        "protected override async onUpdateSuccess(",
      );
      const followsMoves: boolean = source.includes(
        "protected override async onMoveInListSuccess(",
      );
      const reason: string | undefined =
        NOTHING_TO_FOLLOW_A_MOVE[`${model}Service`];

      if (!followsWrites) {
        expect({ model, reason }).toEqual({ model, reason: undefined });
        return;
      }

      expect({ model, decided: followsMoves || Boolean(reason) }).toEqual({
        model,
        decided: true,
      });
      // Not both: a reason stands only where the move follows nothing.
      expect({ model, both: followsMoves && Boolean(reason) }).toEqual({
        model,
        both: false,
      });
    },
  );

  test.each(listModels)(
    "%sService: a move is held to the same order rules as a write",
    (model: string) => {
      const source: string = serviceSource(model);
      const guardsWrites: boolean = source.includes(
        "StateOrderGuard.beforeUpdate(",
      );
      const guardsMoves: boolean =
        source.includes("protected override async onBeforeMoveInList(") &&
        source.includes("StateOrderGuard.beforeMove(");

      expect({ model, guardsMoves }).toEqual({
        model,
        guardsMoves: guardsWrites,
      });
    },
  );

  test("every reason names a service of a drag-ordered list that has an onUpdateSuccess", () => {
    for (const service of Object.keys(NOTHING_TO_FOLLOW_A_MOVE)) {
      const model: string = service.replace(/Service$/, "");

      expect(listModels).toContain(model);
      expect(serviceSource(model)).toContain(
        "protected override async onUpdateSuccess(",
      );
    }
  });
});
