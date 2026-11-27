import StatusPageIncidentCategoryService from "../../Services/StatusPageIncidentCategoryService";
import Incident from "../../../Models/DatabaseModels/Incident";
import Label from "../../../Models/DatabaseModels/Label";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageIncidentCategory from "../../../Models/DatabaseModels/StatusPageIncidentCategory";
import ObjectID from "../../../Types/ObjectID";

export default async function getIncidentNotificationCategoryIds(
  incident: Incident,
  statusPage: StatusPage,
): Promise<Array<ObjectID>> {
  if (
    !statusPage.allowSubscribersToChooseIncidentCategories ||
    !statusPage.id
  ) {
    return [];
  }

  const labelIds: Array<ObjectID> = (incident.labels || []).flatMap(
    (label: Label): Array<ObjectID> => {
      return label.id ? [label.id] : [];
    },
  );
  if (labelIds.length === 0) {
    return [];
  }

  const categories: Array<StatusPageIncidentCategory> =
    await StatusPageIncidentCategoryService.getCategoriesForIncidentLabels({
      statusPageId: statusPage.id,
      labelIds,
    });

  return categories.map((category: StatusPageIncidentCategory): ObjectID => {
    return category.id!;
  });
}
