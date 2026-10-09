import Model from "../../Models/DatabaseModels/HuntressConnection";
import BadDataException from "../../Types/Exception/BadDataException";
import { isHuntressSeverity } from "../../Types/Huntress/HuntressSeverity";
import { getHuntressOrganizationFilterProblem } from "../../Types/Huntress/HuntressOrganizationFilter";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import StandardWebhookSignature from "../Utils/Webhook/StandardWebhookSignature";
import ProjectReferencesService from "./ProjectReferencesService";

/*
 * Huntress connections. A connection names the project's on-call policies,
 * labels and incident severities, so the base class holds every one of
 * them to the project (ProjectReferencesService). On top of that, a
 * connection is checked here when it is saved, so what is stored is what
 * the webhook can use:
 *
 *   - the signing secret is one Huntress could have issued ("whsec_" and
 *     base64), saved trimmed. An empty one on an update keeps the saved
 *     secret: the secret is write-only, so a form never has it to send back.
 *   - isSigningSecretSet follows the secret, whatever the request says.
 *   - "Page On-Call For" is a Huntress severity.
 *   - the organizations it watches are a list it can match.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  public static readonly SIGNING_SECRET_PROBLEM: string =
    "The signing secret is not one Huntress issues. In Huntress, open the endpoint's menu (⋯), choose View Signing Secret and copy all of it. It starts with whsec_.";

  public static readonly PAGE_ON_CALL_FOR_PROBLEM: string =
    "Page On-Call For must be critical, high or low.";

  // A pasted secret, trimmed, or null for none at all.
  public static readSigningSecret(value: unknown): string | null {
    if (value === undefined || value === null) {
      return null;
    }

    if (typeof value !== "string") {
      throw new BadDataException(Service.SIGNING_SECRET_PROBLEM);
    }

    const secret: string = value.trim();

    if (!secret) {
      return null;
    }

    if (!StandardWebhookSignature.isValidSecret(secret)) {
      throw new BadDataException(Service.SIGNING_SECRET_PROBLEM);
    }

    return secret;
  }

  public static checkPageOnCallFor(value: unknown): void {
    if (value === undefined) {
      return;
    }

    if (!isHuntressSeverity(value)) {
      throw new BadDataException(Service.PAGE_ON_CALL_FOR_PROBLEM);
    }
  }

  public static checkWatchedOrganizations(value: unknown): void {
    if (value === undefined || value === null) {
      return;
    }

    if (typeof value !== "string") {
      throw new BadDataException(
        "Only These Organizations must be text: one organization name or id per line.",
      );
    }

    const problem: string | null = getHuntressOrganizationFilterProblem(value);

    if (problem) {
      throw new BadDataException(problem);
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    const data: Model = createBy.data;

    Service.checkPageOnCallFor(data.pageOnCallFor);
    Service.checkWatchedOrganizations(data.watchedOrganizations);

    const secret: string | null = Service.readSigningSecret(data.signingSecret);

    if (secret) {
      data.signingSecret = secret;
      data.isSigningSecretSet = true;
    } else {
      delete data.signingSecret;
      data.isSigningSecretSet = false;
    }

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    const data: Record<string, unknown> = updateBy.data as Record<
      string,
      unknown
    >;

    Service.checkPageOnCallFor(data["pageOnCallFor"]);
    Service.checkWatchedOrganizations(data["watchedOrganizations"]);

    const sentSecret: boolean = Object.prototype.hasOwnProperty.call(
      data,
      "signingSecret",
    );

    // Only the secret decides this, never the request.
    delete data["isSigningSecretSet"];

    if (sentSecret) {
      const secret: string | null = Service.readSigningSecret(
        data["signingSecret"],
      );

      if (secret) {
        data["signingSecret"] = secret;
        data["isSigningSecretSet"] = true;
      } else {
        // An empty secret keeps the saved one.
        delete data["signingSecret"];
      }
    }

    // Left with nothing to write: say what was meant, not "no values".
    if (Object.keys(data).length === 0) {
      throw new BadDataException(
        sentSecret
          ? "Paste the endpoint's signing secret from Huntress to save it."
          : "Signing Secret Saved follows the signing secret. Save a signing secret instead.",
      );
    }

    return { updateBy, carryForward: null };
  }
}

export default new Service();
