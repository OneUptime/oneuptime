import { jest } from "@jest/globals";
import WorkspaceLiveMessage from "../../../../../Models/DatabaseModels/WorkspaceLiveMessage";
import WorkspaceLiveMessageService from "../../../../../Server/Services/WorkspaceLiveMessageService";
import MicrosoftTeamsCutChatIds from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsCutChatIds";
import ObjectID from "../../../../../Types/ObjectID";

// A statement run on the table, with its parameters.
export interface InMemoryLiveMessagesStatement {
  statement: string;
  parameters: Array<unknown>;
}

/*
 * The WorkspaceLiveMessage table, in memory: what the service's create,
 * findByMessageKey and updateOneById would write and read, so a suite sees
 * which messages OneUptime keeps and what it remembers about them. A read
 * hands out copies, as the database does: a change the code makes to a row
 * it read is not in the table until it is written.
 *
 * The one statement OneUptime runs on the table itself - the one that puts
 * back a Microsoft Teams chat's whole id in the messages kept with it cut
 * to 100 characters (MicrosoftTeamsCutChatIds) - runs here as Postgres runs
 * it, and is recorded in `statements`. Any other statement fails the suite.
 */
export default class InMemoryLiveMessages {
  public rows: Array<WorkspaceLiveMessage> = [];
  public statements: Array<InMemoryLiveMessagesStatement> = [];

  public install(): void {
    jest.spyOn(WorkspaceLiveMessageService, "getRepository").mockReturnValue({
      manager: {
        query: async (
          statement: string,
          parameters: Array<unknown>,
        ): Promise<unknown> => {
          return this.query(statement, parameters);
        },
      },
    } as never);

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

  /*
   * A statement on the table: only the restore of a chat's whole id ($1 the
   * project, $2 the cut ids, $3 the whole id of each, $4 the workspace),
   * which gives each row of the project and workspace whose channel id is
   * exactly a cut id that id's whole one. It answers as Postgres answers an
   * UPDATE: its rows (none) and how many it changed.
   */
  private async query(
    statement: string,
    parameters: Array<unknown>,
  ): Promise<unknown> {
    if (
      statement !==
      MicrosoftTeamsCutChatIds.getRestoreStatement("WorkspaceLiveMessage")
    ) {
      throw new Error(
        `InMemoryLiveMessages does not run this statement: ${statement}`,
      );
    }

    this.statements.push({
      statement: statement,
      parameters: JSON.parse(JSON.stringify(parameters)),
    });

    const [projectId, cutIds, wholeIds, workspaceType] = parameters as [
      string,
      Array<string>,
      Array<string>,
      string,
    ];
    let changed: number = 0;

    for (const row of this.rows) {
      const index: number = cutIds.indexOf(row.channelId as string);

      if (
        index !== -1 &&
        row.projectId?.toString() === projectId &&
        row.workspaceType === workspaceType
      ) {
        row.channelId = wholeIds[index]!;
        changed++;
      }
    }

    return [[], changed];
  }

  // A row as a read hands one out: its own object, its data its own copy.
  private copy(row: WorkspaceLiveMessage): WorkspaceLiveMessage {
    const copy: WorkspaceLiveMessage = Object.assign(
      new WorkspaceLiveMessage(),
      row,
    );

    if (row.messageData) {
      copy.messageData = JSON.parse(JSON.stringify(row.messageData));
    }

    return copy;
  }
}
