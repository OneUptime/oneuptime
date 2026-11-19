import Model, {
  MAX_SERVICE_AI_NOTE_LENGTH,
} from "../../Models/DatabaseModels/ServiceAINote";
import BadDataException from "../../Types/Exception/BadDataException";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ProjectReferencesService from "./ProjectReferencesService";

/*
 * What a service's team tells OneUptime AI about it (#7672;
 * Models/DatabaseModels/ServiceAINote). A note names its service, so it is
 * held to the project's own services (ProjectReferencesService), and its
 * text to what a person would write: some words, at most
 * MAX_SERVICE_AI_NOTE_LENGTH characters, with the white space around them
 * taken off.
 */

// A note's text as it is kept, or a refusal that says what to change.
export function readServiceAINoteText(value: unknown): string {
  const text: string = typeof value === "string" ? value.trim() : "";

  if (!text) {
    throw new BadDataException(
      "A note needs some words. Write what OneUptime AI should know about this service.",
    );
  }

  if (text.length > MAX_SERVICE_AI_NOTE_LENGTH) {
    throw new BadDataException(
      `A note can be at most ${MAX_SERVICE_AI_NOTE_LENGTH} characters, and this one is ${text.length}. Shorten it, or write it as two notes.`,
    );
  }

  return text;
}

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    createBy.data.note = readServiceAINoteText(createBy.data.note);

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    const data: Record<string, unknown> = updateBy.data as unknown as Record<
      string,
      unknown
    >;

    if (data["note"] !== undefined) {
      data["note"] = readServiceAINoteText(data["note"]);
    }

    return { updateBy, carryForward: null };
  }
}

export default new Service();
