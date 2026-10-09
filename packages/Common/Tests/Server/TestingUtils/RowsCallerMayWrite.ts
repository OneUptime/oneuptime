import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "../../../Server/Services/DatabaseService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";

/*
 * Answers the read of the rows a teammate's update may write, without a
 * database.
 *
 * Before an update's hooks run, the update path reads the rows of it its
 * caller may write (DatabaseService.keepRowsCallerMayWrite), and a hook that
 * checks those rows reads them again by id (findRowsAndHoldUpdateToThem). A
 * suite that calls a service's onBeforeUpdate directly, with a teammate's
 * props, skips the update path, so the hook makes that first read itself.
 * This answers it the way a project-wide editor's is answered: the caller
 * may write every row `rows()` gives - the rows the suite's findBy stub
 * answers with - in the update's window. The read is not a findBy call, so
 * the suite's findBy stub sees only the hook's own read.
 *
 * Returns the stub of that read, which is handed the window (skip, limit).
 */
export function stubRowsCallerMayWrite<TModel extends DatabaseBaseModel>(
  service: DatabaseService<TModel>,
  rows: () => Array<unknown> | Promise<Array<unknown>>,
): jest.SpyInstance {
  jest.spyOn(ModelPermission, "getUpdatableQuery").mockImplementation((async (
    _modelType: unknown,
    query: unknown,
  ): Promise<unknown> => {
    return query;
  }) as never);

  return jest
    .spyOn(service as unknown as { _findBy: () => unknown }, "_findBy")
    .mockImplementation((async (): Promise<Array<unknown>> => {
      return await rows();
    }) as never);
}
