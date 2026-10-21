/*
 * The owner-only mark on a column, and how a model's marked columns are
 * enumerated (OwnerOnlyColumn). The enumeration reads a canonical instance of
 * the class, so what the caller did to its own instance cannot change the
 * answer.
 */

import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OwnerOnlyColumn, {
  getOwnerOnlyColumns,
  isOwnerOnlyColumn,
} from "../../../../Types/Database/AccessControl/OwnerOnlyColumn";
import { describe, expect, test } from "@jest/globals";
import "reflect-metadata";

class WebhookLike {
  public name: string | undefined = undefined;

  @OwnerOnlyColumn()
  public url: string | undefined = undefined;

  @OwnerOnlyColumn()
  public secret: string | undefined = undefined;

  public userId: string | undefined = undefined;
}

class SignedWebhookLike extends WebhookLike {
  @OwnerOnlyColumn()
  public signingKey: string | undefined = undefined;

  public description: string | undefined = undefined;
}

class NothingMarked {
  public name: string | undefined = undefined;
  public count: number | undefined = undefined;
}

class MarkedButNeverInitialised {
  public name: string | undefined = undefined;

  @OwnerOnlyColumn()
  public token?: string;
}

class ThrowsWhenConstructed {
  @OwnerOnlyColumn()
  public phone: string | undefined = undefined;

  public label: string | undefined = undefined;

  public constructor(required?: { value: string }) {
    // A class that needs its argument cannot give a canonical instance.
    this.label = required!.value;
  }
}

type AsModelFunction = (value: unknown) => BaseModel;

const asModel: AsModelFunction = (value: unknown): BaseModel => {
  return value as BaseModel;
};

describe("isOwnerOnlyColumn", () => {
  test("is true for a marked column", () => {
    const model: BaseModel = asModel(new WebhookLike());

    expect(isOwnerOnlyColumn(model, "url")).toBe(true);
    expect(isOwnerOnlyColumn(model, "secret")).toBe(true);
  });

  test("is false for an unmarked or unknown column", () => {
    const model: BaseModel = asModel(new WebhookLike());

    expect(isOwnerOnlyColumn(model, "name")).toBe(false);
    expect(isOwnerOnlyColumn(model, "userId")).toBe(false);
    expect(isOwnerOnlyColumn(model, "doesNotExist")).toBe(false);
  });

  test("reads marks through the prototype chain, so a subclass inherits them", () => {
    const model: BaseModel = asModel(new SignedWebhookLike());

    expect(isOwnerOnlyColumn(model, "url")).toBe(true);
    expect(isOwnerOnlyColumn(model, "secret")).toBe(true);
    expect(isOwnerOnlyColumn(model, "signingKey")).toBe(true);
    expect(isOwnerOnlyColumn(model, "description")).toBe(false);
  });

  test("a subclass's mark does not leak onto its parent", () => {
    expect(isOwnerOnlyColumn(asModel(new WebhookLike()), "signingKey")).toBe(
      false,
    );
  });

  test("still answers for a key deleted off the instance", () => {
    const instance: WebhookLike = new WebhookLike();
    delete (instance as { secret?: string | undefined }).secret;

    expect(isOwnerOnlyColumn(asModel(instance), "secret")).toBe(true);
  });

  test("works for a column declared without an initialiser", () => {
    expect(
      isOwnerOnlyColumn(asModel(new MarkedButNeverInitialised()), "token"),
    ).toBe(true);
  });
});

describe("getOwnerOnlyColumns", () => {
  test("lists every marked column in declaration order", () => {
    expect(getOwnerOnlyColumns(asModel(new WebhookLike()))).toEqual([
      "url",
      "secret",
    ]);
  });

  test("includes the marks a subclass inherits", () => {
    expect(getOwnerOnlyColumns(asModel(new SignedWebhookLike()))).toEqual([
      "url",
      "secret",
      "signingKey",
    ]);
  });

  test("is empty for a model that marks nothing", () => {
    expect(getOwnerOnlyColumns(asModel(new NothingMarked()))).toEqual([]);
  });

  test("does not depend on what the caller did to its own instance", () => {
    const mutilated: WebhookLike = new WebhookLike();
    delete (mutilated as { url?: string | undefined }).url;
    delete (mutilated as { secret?: string | undefined }).secret;

    expect(getOwnerOnlyColumns(asModel(mutilated))).toEqual(["url", "secret"]);
  });

  test("gives the same answer whichever instance asks first", () => {
    class FreshModel {
      @OwnerOnlyColumn()
      public email: string | undefined = undefined;

      public name: string | undefined = undefined;
    }

    const first: FreshModel = new FreshModel();
    delete (first as { email?: string | undefined }).email;

    expect(getOwnerOnlyColumns(asModel(first))).toEqual(["email"]);
    expect(getOwnerOnlyColumns(asModel(new FreshModel()))).toEqual(["email"]);
  });

  test("ignores extra keys the caller added to its instance", () => {
    const instance: WebhookLike = new WebhookLike();
    (instance as unknown as Record<string, unknown>)["extra"] = "value";

    expect(getOwnerOnlyColumns(asModel(instance))).toEqual(["url", "secret"]);
  });

  test("a marked column the class body never initialises is not listed", () => {
    /*
     * Enumeration relies on every declared column being initialised in the
     * class body: a column with no initialiser is not an own key.
     */
    expect(
      getOwnerOnlyColumns(asModel(new MarkedButNeverInitialised())),
    ).toEqual([]);
  });

  test("falls back to the caller's instance when no canonical one can be made", () => {
    const instance: ThrowsWhenConstructed = new ThrowsWhenConstructed({
      value: "x",
    });

    expect(getOwnerOnlyColumns(asModel(instance))).toEqual(["phone"]);
  });

  test("with that fallback, a key deleted off the instance is missed", () => {
    const instance: ThrowsWhenConstructed = new ThrowsWhenConstructed({
      value: "x",
    });
    delete (instance as { phone?: string | undefined }).phone;

    expect(getOwnerOnlyColumns(asModel(instance))).toEqual([]);
  });

  test("an object with no constructor is read as it is", () => {
    const bare: Record<string, unknown> = Object.create(null) as Record<
      string,
      unknown
    >;
    bare["url"] = undefined;

    expect(getOwnerOnlyColumns(asModel(bare))).toEqual([]);
  });
});
