import ProjectReferencesService from "./ProjectReferencesService";
import SecurityCaseFeedService from "./SecurityCaseFeedService";
import Model from "../../Models/DatabaseModels/SecurityCaseNote";
import { SecurityCaseFeedEventType } from "../../Models/DatabaseModels/SecurityCaseFeed";
import { OnCreate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { Gray500 } from "../../Types/BrandColors";
import { noteAddedMarkdown } from "../../Utils/SecurityCase/SecurityCaseMarkdown";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * A note shows on the case's timeline as well as on its Notes page, so the
   * timeline reads as the whole story of the case.
   */
  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (
      createdItem.projectId &&
      createdItem.securityCaseId &&
      createdItem.note
    ) {
      await SecurityCaseFeedService.createSecurityCaseFeedItem({
        projectId: createdItem.projectId,
        securityCaseId: createdItem.securityCaseId,
        feedInfoInMarkdown: noteAddedMarkdown(createdItem.note).toString(),
        eventType: SecurityCaseFeedEventType.PrivateNote,
        displayColor: Gray500,
        userId: createdItem.createdByUserId || onCreate.createBy.props.userId,
      });
    }

    return createdItem;
  }
}

export default new Service();
