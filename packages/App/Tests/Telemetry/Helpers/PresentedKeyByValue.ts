import ObjectID from "Common/Types/ObjectID";

/*
 * A SERVICE'S findOneByPresentedKey FOR A TEST THAT STUBS ITS findOneBy.
 *
 * A key presented to OneUptime (a monitor's secret key, #9012) is kept
 * encrypted, and DatabaseService.findOneByPresentedKey finds its record by
 * the key's lookup hash, then holds it to the key. A test of what an ingest
 * does with the monitor it finds - not of how the key is stored - stubs
 * findOneBy, and reads back the query it was asked: this hands it the query
 * the lookup by value asked before, the key in its column as an ObjectID
 * (as the ingest wrote it), with the rest of the lookup's query beside it.
 * DatabaseServicePresentedKeys.test.ts holds the lookup itself.
 *
 * A plain function, not a mock, so a test that resets its mocks keeps it:
 * put it on the service's stub, which it calls findOneBy on (`this`).
 */
export default function findOneByPresentedKeyByValue(
  this: { findOneBy: (findBy: unknown) => Promise<unknown> },
  lookup: {
    column: string;
    presentedKey: unknown;
    query?: Record<string, unknown> | undefined;
    select: unknown;
    props: unknown;
  },
): Promise<unknown> {
  return this.findOneBy({
    query: {
      ...(lookup.query || {}),
      [lookup.column]:
        typeof lookup.presentedKey === "string"
          ? new ObjectID(lookup.presentedKey)
          : lookup.presentedKey,
    },
    select: lookup.select,
    props: lookup.props,
  });
}
