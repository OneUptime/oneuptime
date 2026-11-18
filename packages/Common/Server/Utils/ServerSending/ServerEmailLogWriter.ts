import ServerEmailLog from "../../../Models/DatabaseModels/ServerEmailLog";
import ColumnLength from "../../../Types/Database/ColumnLength";
import MailStatus from "../../../Types/Mail/MailStatus";
import ServerEmailLogService from "../../Services/ServerEmailLogService";
import logger from "../Logger";
import ServerEmailLogRecorder, {
  ServerEmailLogFacts,
} from "./ServerEmailLogRecorder";

/*
 * Writes the server's email log's rows (#6878): what ServerEmailLogRecorder
 * says the log keeps of an email, and nothing else. Registered by the
 * Notification service as it starts.
 */
export default class ServerEmailLogWriter {
  // The row the log keeps for the email (ServerEmailLogRecorder).
  public static toRow(facts: ServerEmailLogFacts): ServerEmailLog {
    const row: ServerEmailLog = new ServerEmailLog();

    row.toEmail = facts.toEmail;
    row.status = facts.isSent ? MailStatus.Success : MailStatus.Error;

    // A project's subject is the project's: its own Email Logs keep it.
    const subject: string | undefined = facts.projectId
      ? undefined
      : ServerEmailLogRecorder.scrub(facts.subject);

    if (subject) {
      row.subject = subject;
    }

    if (facts.templateType) {
      row.templateType = facts.templateType.slice(0, ColumnLength.ShortText);
    }

    const statusMessage: string | undefined = ServerEmailLogRecorder.scrub(
      facts.statusMessage,
    );

    if (statusMessage) {
      row.statusMessage = statusMessage;
    }

    if (facts.projectId) {
      row.projectId = facts.projectId;
    }

    return row;
  }

  // Writes the row; a row that cannot be written is logged without its address.
  public static async write(facts: ServerEmailLogFacts): Promise<void> {
    try {
      await ServerEmailLogService.create({
        data: ServerEmailLogWriter.toRow(facts),
        props: {
          isRoot: true,
        },
      });
    } catch (err) {
      logger.error(
        `The server's email log could not keep an email's row: ${ServerEmailLogRecorder.withoutRecipient(
          err instanceof Error ? err.message : String(err),
          facts.toEmail,
        )}`,
      );
    }
  }

  // Points MailService at write (ServerEmailLogRecorder). Called once, at start.
  public static startWriting(): void {
    ServerEmailLogRecorder.register(ServerEmailLogWriter.write);
  }
}
