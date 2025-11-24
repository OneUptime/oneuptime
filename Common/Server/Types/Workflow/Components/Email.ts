import ComponentCode, { RunOptions, RunReturnType } from "../ComponentCode";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ComponentMetadata, { Port } from "../../../../Types/Workflow/Component";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import Components from "../../../../Types/Workflow/Components/Email";
import nodemailer, { Transporter } from "nodemailer";
import SMTPTransport from "nodemailer/lib/smtp-transport";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export default class Email extends ComponentCode {
  public constructor() {
    super();

    const Component: ComponentMetadata | undefined = Components.find(
      (i: ComponentMetadata) => {
        return i.id === ComponentID.SendEmail;
      },
    );

    if (!Component) {
      throw new BadDataException("Component not found.");
    }

    this.setMetadata(Component);
  }

  @CaptureSpan()
  public override async run(
    args: JSONObject,
    options: RunOptions,
  ): Promise<RunReturnType> {
    const successPort: Port | undefined = this.getMetadata().outPorts.find(
      (p: Port) => {
        return p.id === "success";
      },
    );

    if (!successPort) {
      throw options.onError(new BadDataException("Success port not found"));
    }

    const errorPort: Port | undefined = this.getMetadata().outPorts.find(
      (p: Port) => {
        return p.id === "error";
      },
    );

    if (!errorPort) {
      throw options.onError(new BadDataException("Error port not found"));
    }

    if (!args["to"]) {
      throw options.onError(new BadDataException("To Email not found"));
    }

    if (args["to"] && typeof args["to"] !== "string") {
      throw options.onError(
        new BadDataException("To Email is not type of string"),
      );
    }

    if (!args["from"]) {
      throw options.onError(new BadDataException("From Email not found"));
    }

    if (args["from"] && typeof args["from"] !== "string") {
      throw options.onError(
        new BadDataException("From Email is not type of string"),
      );
    }

    if (args["smtp-username"] && typeof args["smtp-username"] !== "string") {
      throw options.onError(
        new BadDataException("SMTP Username is not type of string"),
      );
    }

    if (args["smtp-password"] && typeof args["smtp-password"] !== "string") {
      throw options.onError(
        new BadDataException("SMTP Password is not type of string"),
      );
    }

    if (!args["smtp-host"]) {
      throw options.onError(new BadDataException("SMTP Host not found"));
    }

    if (args["smtp-host"] && typeof args["smtp-host"] !== "string") {
      throw options.onError(
        new BadDataException("SMTP Host is not type of string"),
      );
    }

    if (!args["smtp-port"]) {
      throw options.onError(new BadDataException("SMTP Port not found"));
    }

    if (args["smtp-port"] && typeof args["smtp-port"] === "string") {
      args["smtp-port"] = parseInt(args["smtp-port"]);
    }

    if (args["smtp-port"] && typeof args["smtp-port"] !== "number") {
      throw options.onError(
        new BadDataException("SMTP Port is not type of number"),
      );
    }

    try {
      const username: string | undefined =
        args["smtp-username"]?.toString() || undefined;
      const password: string | undefined =
        args["smtp-password"]?.toString() || undefined;

      const smtpTransport: SMTPTransport.Options = {
        host: args["smtp-host"]?.toString(),
        port: args["smtp-port"] as number,
      };

      if (
        args["secure"] === true ||
        args["secure"] === "true" ||
        args["secure"] === 1
      ) {
        smtpTransport.secure = true;
      } else {
        smtpTransport.secure = false;
      }

      if (username && password) {
        smtpTransport.auth = {
          user: username,
          pass: password,
        };
      }

      const mailer: Transporter = nodemailer.createTransport(smtpTransport);

      await mailer.sendMail({
        from: args["from"].toString(),
        to: args["to"].toString(),
        subject: args["subject"]?.toString() || "",
        html: args["email-body"]?.toString() || "",
      });

      options.log("Email sent.");

      return Promise.resolve({
        returnValues: {},
        executePort: successPort,
      });
    } catch (err: unknown) {
      options.log(err as Error);
      return Promise.resolve({
        returnValues: {},
        executePort: errorPort,
      });
    }
  }
}
