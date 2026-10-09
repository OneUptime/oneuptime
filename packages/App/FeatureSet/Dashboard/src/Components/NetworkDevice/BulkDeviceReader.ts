import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { translateText, translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Fresh reads of a bulk selection, a page at a time.
 *
 * A bulk action that merges into what a device already holds has to merge
 * into what it holds NOW, not into what the table loaded: the rows are as old
 * as the page, and a poll (or a colleague) may have written to the device
 * since. Reading each device on its own costs a request per device; reading
 * the selection in pages of a hundred costs five for five hundred devices.
 *
 * A page is fetched the first time one of its devices is asked for, and once:
 * the actions that use this work on several devices at a time, and the
 * devices of one page share its request. A page that cannot be read fails the
 * devices on it, with the reason, rather than the whole action.
 */

export const BULK_DEVICE_READ_PAGE_SIZE: number = 100;

export const DEVICE_NOT_READABLE_MESSAGE: string = translationKey(
  "This device could not be read. It may have been deleted since the list was loaded.",
);

export default class BulkDeviceReader {
  private readonly pageIdsByIndex: Array<Array<string>> = [];
  private readonly pageIndexById: Map<string, number> = new Map();
  private readonly pages: Map<number, Promise<Map<string, NetworkDevice>>> =
    new Map();
  private readonly select: Select<NetworkDevice>;
  private readonly pageSize: number;

  public constructor(data: {
    deviceIds: Array<string>;
    select: Select<NetworkDevice>;
    pageSize?: number | undefined;
  }) {
    this.select = data.select;
    this.pageSize = Math.max(
      1,
      Math.floor(data.pageSize || BULK_DEVICE_READ_PAGE_SIZE),
    );

    const uniqueIds: Array<string> = Array.from(
      new Set(
        data.deviceIds
          .map((id: string): string => {
            return id.trim();
          })
          .filter((id: string): boolean => {
            return id.length > 0;
          }),
      ),
    );

    uniqueIds.forEach((id: string, position: number) => {
      const pageIndex: number = Math.floor(position / this.pageSize);

      if (!this.pageIdsByIndex[pageIndex]) {
        this.pageIdsByIndex[pageIndex] = [];
      }

      this.pageIdsByIndex[pageIndex]!.push(id);
      this.pageIndexById.set(id, pageIndex);
    });
  }

  // How many pages the selection is read in.
  public getPageCount(): number {
    return this.pageIdsByIndex.length;
  }

  /*
   * The device as it is now. Throws when it is not in its page's answer - it
   * was deleted, or the caller may no longer read it - or when the page
   * itself could not be read, with that error's message.
   */
  public async read(deviceId: ObjectID | string): Promise<NetworkDevice> {
    const id: string = deviceId.toString();
    const pageIndex: number | undefined = this.pageIndexById.get(id);

    if (pageIndex === undefined) {
      throw new BadDataException(
        translateText(DEVICE_NOT_READABLE_MESSAGE) ||
          DEVICE_NOT_READABLE_MESSAGE,
      );
    }

    const page: Map<string, NetworkDevice> = await this.getPage(pageIndex);
    const device: NetworkDevice | undefined = page.get(id);

    if (!device) {
      throw new BadDataException(
        translateText(DEVICE_NOT_READABLE_MESSAGE) ||
          DEVICE_NOT_READABLE_MESSAGE,
      );
    }

    return device;
  }

  private getPage(pageIndex: number): Promise<Map<string, NetworkDevice>> {
    const existing: Promise<Map<string, NetworkDevice>> | undefined =
      this.pages.get(pageIndex);

    if (existing) {
      return existing;
    }

    const request: Promise<Map<string, NetworkDevice>> =
      this.fetchPage(pageIndex);

    this.pages.set(pageIndex, request);

    return request;
  }

  private async fetchPage(
    pageIndex: number,
  ): Promise<Map<string, NetworkDevice>> {
    const ids: Array<string> = this.pageIdsByIndex[pageIndex] || [];

    const query: Query<NetworkDevice> = {
      _id: new Includes(ids),
    } as Query<NetworkDevice>;

    /*
     * The project the page is working in. The API scopes every read to it
     * anyway; naming it keeps this read the same shape as the table's.
     */
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (projectId) {
      (query as Record<string, unknown>)["projectId"] = projectId;
    }

    const result: ListResult<NetworkDevice> =
      await ModelAPI.getList<NetworkDevice>({
        modelType: NetworkDevice,
        query: query,
        limit: ids.length,
        skip: 0,
        select: {
          ...this.select,
          _id: true,
        },
        sort: {},
      });

    const byId: Map<string, NetworkDevice> = new Map();

    for (const device of result.data) {
      const id: string | undefined = device._id?.toString();

      if (id) {
        byId.set(id, device);
      }
    }

    return byId;
  }
}
