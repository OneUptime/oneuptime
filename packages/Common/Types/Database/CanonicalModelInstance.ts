/*
 * The one instance of a model class that column-metadata enumeration is
 * allowed to look at.
 *
 * WHY THIS EXISTS.
 *
 * Every "which columns does this model have" lookup in this directory answers
 * the question by enumerating an INSTANCE's own keys (Object.keys) and then
 * caching the answer per CLASS. That is only sound while every instance of a
 * class has the same own keys. The class bodies do guarantee that - each
 * decorated column is initialised to `undefined` - right up until some caller
 * deletes a key off a live instance.
 *
 * One caller did. BaseAPI.createItem used to `delete item._id` before handing
 * the model to the service, and DatabaseService.create asks that very instance
 * for its columns (generateDefaultValues). Whenever the mutilated instance was
 * the first to ask, the class's cached column list was built WITHOUT `_id` -
 * permanently, for the life of the process, for every later caller - and since
 * DatabaseBaseModel.toJSONObject serialises a row by iterating exactly that
 * list, every API response for that model silently lost its id. A single
 * create was enough, including a create that was refused, because the columns
 * are read before the permission check. Rows still carried their real `_id` in
 * memory and in the SQL projection; it was dropped on the way out.
 *
 * So enumeration stopped reading the caller's instance. It reads a frozen,
 * private instance of the caller's CLASS instead - constructed here, reachable
 * by nobody, impossible to mutate - so what a class reports about itself can
 * never depend on which instance happened to ask first, or on what anyone did
 * to that instance. Reads already constructed a throwaway instance for exactly
 * this purpose (SelectPermission, QueryPermission, ColumnPermission all do
 * `new modelType()`), which is why a single read of a model was enough to make
 * the same create harmless; this makes that the only behaviour.
 *
 * Every database model is no-arg constructible (Models/DatabaseModels/Index.ts
 * relies on it already, in getModelTypeByName), and a fresh instance carries
 * every declared column - both facts are asserted by
 * Tests/Types/Database/CanonicalModelInstance.test.ts against all 400+ models.
 */

type NoArgConstructor = new () => unknown;

const canonicalInstanceCache: WeakMap<NoArgConstructor, unknown> =
  new WeakMap();

/*
 * Classes whose canonical instance is being constructed right now. A model
 * constructor that asked for its own columns would otherwise recurse forever;
 * such a call gets the caller's instance instead, which is the old behaviour.
 */
const beingConstructed: WeakSet<NoArgConstructor> = new WeakSet();

/**
 * A frozen, shared instance of `target`'s class, safe to enumerate for
 * metadata. Returns `target` itself when no such instance can be made - a
 * class that needs constructor arguments, a class still being defined
 * (circular imports), a constructor that throws, or a plain object with no
 * useful constructor. Falling back rather than throwing is deliberate: a
 * metadata lookup must never be the reason a process fails to boot.
 */
export default function getCanonicalModelInstance<T>(target: T): T {
  const modelClass: NoArgConstructor | undefined = (
    target as { constructor?: NoArgConstructor } | null | undefined
  )?.constructor;

  if (typeof modelClass !== "function") {
    return target;
  }

  const cached: unknown = canonicalInstanceCache.get(modelClass);

  if (cached) {
    return cached as T;
  }

  if (beingConstructed.has(modelClass)) {
    return target;
  }

  let canonical: T;

  beingConstructed.add(modelClass);

  try {
    canonical = Object.freeze(new modelClass()) as T;
  } catch {
    return target;
  } finally {
    beingConstructed.delete(modelClass);
  }

  canonicalInstanceCache.set(modelClass, canonical);

  return canonical;
}
