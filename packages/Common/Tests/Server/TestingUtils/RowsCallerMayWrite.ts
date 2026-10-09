import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "../../../Server/Services/DatabaseService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";

// What the read of the rows a caller may write asks for.
export interface RowsCallerMayWriteRead {
  query: JSONObject;
  select: JSONObject;
  skip: number;
  limit: number;
}

/*
 * Answers the read of the rows a teammate's update may write, without a
 * database.
 *
 * Before an update's hooks run, the update path reads the rows of it its
 * caller may write (DatabaseService.keepRowsCallerMayWrite), and a hook that
 * checks those rows reads them again by id (findRowsAndHoldUpdateToThem). A
 * suite that calls a service's onBeforeUpdate directly, with a teammate's
 * props, skips the update path, so the hook makes that first read itself.
 * This answers it the way a project-wide editor's is answered: the read is
 * narrowed to the request's project, and the caller may write every row
 * `rows()` gives - the rows the suite's findBy stub answers with - in the
 * update's window. `rows` is handed the read (the update's query so
 * narrowed, and its window), for a suite whose rows depend on it. The read
 * is not a findBy call, so the suite's findBy stub sees only the hook's own
 * read.
 *
 * Returns the stub of that read (see readsOfRowsCallerMayWrite).
 */
export function stubRowsCallerMayWrite<TModel extends DatabaseBaseModel>(
  service: DatabaseService<TModel>,
  rows: (
    read: RowsCallerMayWriteRead,
  ) => Array<unknown> | Promise<Array<unknown>>,
): jest.SpyInstance {
  // As a project-wide editor's is narrowed: to the request's project.
  jest.spyOn(ModelPermission, "getUpdatableQuery").mockImplementation((async (
    modelType: new () => DatabaseBaseModel,
    query: JSONObject,
    props: DatabaseCommonInteractionProps,
  ): Promise<unknown> => {
    const tenantColumn: string | null = new modelType().getTenantColumn();

    if (!tenantColumn || !props.tenantId || props.isMultiTenantRequest) {
      return query;
    }

    return { ...query, [tenantColumn]: props.tenantId };
  }) as never);

  return jest
    .spyOn(service as unknown as { _findBy: () => unknown }, "_findBy")
    .mockImplementation((async (
      read: RowsCallerMayWriteRead,
    ): Promise<Array<unknown>> => {
      return await rows(read);
    }) as never);
}

/*
 * What stubRowsCallerMayWriteLikeFindBy reads of the suite's findBy spy:
 * what it is set to answer. Either kind of spy has it - the global jest's
 * and @jest/globals'.
 */
interface AnswersLikeFindBy {
  getMockImplementation(): unknown;
}

/*
 * stubRowsCallerMayWrite, answered the way the suite's findBy stub answers
 * the same read - whatever it is set to answer at the time - without
 * counting as a call of it. A findBy the suite has not stubbed reads
 * through to this same read, which then answers no row.
 */
export function stubRowsCallerMayWriteLikeFindBy<
  TModel extends DatabaseBaseModel,
>(
  service: DatabaseService<TModel>,
  findBy: AnswersLikeFindBy,
): jest.SpyInstance {
  let answering: boolean = false;

  return stubRowsCallerMayWrite(
    service,
    async (read: RowsCallerMayWriteRead): Promise<Array<unknown>> => {
      let answer: unknown = findBy.getMockImplementation();

      /*
       * A mock function handed in as the implementation answers through its
       * own implementation, so the read is not counted as a call of it.
       */
      while (answer && jest.isMockFunction(answer)) {
        answer = (
          answer as unknown as AnswersLikeFindBy
        ).getMockImplementation();
      }

      if (typeof answer !== "function" || answering) {
        return [];
      }

      answering = true;

      try {
        return (await (answer as (...args: Array<unknown>) => unknown).call(
          service,
          read,
        )) as Array<unknown>;
      } finally {
        answering = false;
      }
    },
  );
}

// The reads of the rows a caller's update may write, as the stub was given them.
export function readsOfRowsCallerMayWrite<TModel extends DatabaseBaseModel>(
  service: DatabaseService<TModel>,
): Array<RowsCallerMayWriteRead> {
  return jest
    .spyOn(service as unknown as { _findBy: () => unknown }, "_findBy")
    .mock.calls.map((call: Array<unknown>): RowsCallerMayWriteRead => {
      return call[0] as RowsCallerMayWriteRead;
    });
}
