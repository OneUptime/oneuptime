import { jest } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import ServerProducts from "../../../Server/Utils/ServerProducts/ServerProducts";

/*
 * EVERY PRODUCT ON, FOR A SUITE WITH NO DATABASE.
 *
 * A chat command, a card's action and a write a person makes ask what the
 * server has switched off before they act (WorkspaceProductRefusal,
 * WorkspaceActionAuthorization, ProductWriteRefusal, #7479). ServerProducts
 * reads that from the database, and when the read fails it logs "Could not
 * read the products switched off on this server" and treats every product
 * as on: right on a server, where it is worth an error in the log. A suite
 * that connects no database, and holds its error log to what the path it
 * runs logs, answers the read instead, with every product on.
 *
 * Call it from a beforeEach: jest.restoreAllMocks() takes it away. The spy
 * it returns answers another set of products where a test switches one off.
 */
export function everyServerProductIsOn(): SpyInstance<
  typeof ServerProducts.getOff
> {
  return jest.spyOn(ServerProducts, "getOff").mockResolvedValue({});
}
