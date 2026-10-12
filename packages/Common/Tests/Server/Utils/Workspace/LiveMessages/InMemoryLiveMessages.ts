import { jest } from "@jest/globals";
import WorkspaceLiveMessage from "../../../../../Models/DatabaseModels/WorkspaceLiveMessage";
import WorkspaceLiveMessageService from "../../../../../Server/Services/WorkspaceLiveMessageService";
import ObjectID from "../../../../../Types/ObjectID";

/*
 * The WorkspaceLiveMessage table, in memory: what the service's create,
 * findByMessageKey and updateOneById would write and read, so a suite sees
 * which messages OneUptime keeps and what it remembers about them. A read
 * hands out copies, as the database does: a change the code makes to a row
 * it read is not in the table until it is written.
 */
export default class InMemoryLiveMessages {
  public rows: Array<WorkspaceLiveMessage> = [];

  public install(): void {
    jest
      .spyOn(WorkspaceLiveMessageService, "create")
      .mockImplementation((async (data: {
        data: WorkspaceLiveMessage;
      }): Promise<WorkspaceLiveMessage> => {
        const row: WorkspaceLiveMessage = this.copy(data.data);
        row.id = ObjectID.generate();
        this.rows.push(row);
        return this.copy(row);
      }) as never);

    jest
      .spyOn(WorkspaceLiveMessageService, "findByMessageKey")
      .mockImplementation((async (data: {
        projectId: ObjectID;
        messageKey: string;
        channelId?: string | undefined;
      }): Promise<Array<WorkspaceLiveMessage>> => {
        return this.rows
          .filter((row: WorkspaceLiveMessage): boolean => {
            return (
              row.projectId?.toString() === data.projectId.toString() &&
              row.messageKey === data.messageKey &&
              (!data.channelId || row.channelId === data.channelId)
            );
          })
          .map((row: WorkspaceLiveMessage): WorkspaceLiveMessage => {
            return this.copy(row);
          });
      }) as never);

    jest
      .spyOn(WorkspaceLiveMessageService, "updateOneById")
      .mockImplementation((async (data: {
        id: ObjectID;
        data: Partial<WorkspaceLiveMessage>;
      }): Promise<number> => {
        const row: WorkspaceLiveMessage | undefined = this.rows.find(
          (candidate: WorkspaceLiveMessage): boolean => {
            return candidate.id?.toString() === data.id.toString();
          },
        );

        if (!row) {
          return 0;
        }

        Object.assign(row, JSON.parse(JSON.stringify(data.data)));
        return 1;
      }) as never);
  }

  // The rows kept for one key, in the order they were written.
  public forKey(messageKey: string): Array<WorkspaceLiveMessage> {
    return this.rows.filter((row: WorkspaceLiveMessage): boolean => {
      return row.messageKey === messageKey;
    });
  }

  private copy(row: WorkspaceLiveMessage): WorkspaceLiveMessage {
    const copy: WorkspaceLiveMessage = new WorkspaceLiveMessage();
    copy.id = row.id;
    copy.projectId = row.projectId;
    copy.workspaceType = row.workspaceType;
    copy.messageKey = row.messageKey;
    copy.destinationType = row.destinationType;
    copy.channelId = row.channelId;
    copy.channelName = row.channelName;
    copy.teamId = row.teamId;
    copy.messageId = row.messageId;
    copy.contentHash = row.contentHash;
    copy.messageData = row.messageData
      ? JSON.parse(JSON.stringify(row.messageData))
      : row.messageData;
    return copy;
  }
}
