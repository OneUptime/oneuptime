import DatabaseService from "./DatabaseService";
import EmailServer from "Common/Types/Email/EmailServer";
import BadDataException from "Common/Types/Exception/BadDataException";
import Model from "Common/Models/DatabaseModels/ProjectSmtpConfig";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  public toEmailServer(
    projectSmtpConfig: Model | undefined,
  ): EmailServer | undefined {
    if (!projectSmtpConfig) {
      return undefined;
    }

    if (!projectSmtpConfig.id) {
      throw new BadDataException("Project SMTP config id is not set");
    }

    if (!projectSmtpConfig.hostname) {
      throw new BadDataException("Project SMTP config host is not set");
    }

    if (!projectSmtpConfig.port) {
      throw new BadDataException("Project SMTP config port is not set");
    }

    if (!projectSmtpConfig.username) {
      throw new BadDataException("Project SMTP config username is not set");
    }

    if (!projectSmtpConfig.password) {
      throw new BadDataException("Project SMTP config password is not set");
    }

    if (!projectSmtpConfig.fromEmail) {
      throw new BadDataException("Project SMTP config from email is not set");
    }

    if (!projectSmtpConfig.fromName) {
      throw new BadDataException("Project SMTP config from name is not set");
    }

    return {
      id: projectSmtpConfig.id!,
      host: projectSmtpConfig.hostname,
      port: projectSmtpConfig.port,
      username: projectSmtpConfig.username,
      password: projectSmtpConfig.password,
      fromEmail: projectSmtpConfig.fromEmail,
      fromName: projectSmtpConfig.fromName,
      secure: Boolean(projectSmtpConfig.secure),
    };
  }
}
export default new Service();
