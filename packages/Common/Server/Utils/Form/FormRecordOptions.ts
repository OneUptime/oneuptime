import IncidentSeverityService from "../../Services/IncidentSeverityService";
import LabelService from "../../Services/LabelService";
import MonitorService from "../../Services/MonitorService";
import StatusPageService from "../../Services/StatusPageService";
import QueryHelper from "../../Types/Database/QueryHelper";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { FormRecordOption } from "../../../Types/Form/FormPublic";
import { FormTargetOptionsSource } from "../../../Types/Form/FormTargetCatalog";
import ObjectID from "../../../Types/ObjectID";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";

/*
 * The project's records a choice question can offer on a form's public
 * page: its severities, monitors, labels or status pages. Read as root -
 * the page is anonymous - and only the name (and a color, where the record
 * has one) ever leaves here: buildPublicForm picks the ones a question
 * offers, and nothing else about a record reaches the page.
 *
 * With ids, only those records are read (a question that offers chosen
 * monitors reads those monitors, not the project's thousands); without, all
 * of the project's - which only a question that may offer every record
 * (severities) ever asks for.
 *
 * Services are imported here, not at module load of FormService's callers,
 * and are looked up when called: they sit in an import graph that loops
 * back to FormService.
 */
export default class FormRecordOptions {
  public static async load(data: {
    projectId: ObjectID;
    source: FormTargetOptionsSource;
    // Read only these; undefined reads them all.
    ids?: Array<string> | undefined;
  }): Promise<Array<FormRecordOption>> {
    const ids: Array<string> | undefined = data.ids
      ? data.ids.filter((id: string): boolean => {
          return ObjectID.isValidUUID(id);
        })
      : undefined;

    if (ids && ids.length === 0) {
      return [];
    }

    const idFilter: Record<string, unknown> = ids
      ? {
          _id: QueryHelper.any(
            ids.map((id: string): ObjectID => {
              return new ObjectID(id);
            }),
          ),
        }
      : {};

    switch (data.source) {
      case FormTargetOptionsSource.IncidentSeverity: {
        const severities: Array<IncidentSeverity> =
          await IncidentSeverityService.findBy({
            query: { projectId: data.projectId, ...idFilter },
            select: { _id: true, name: true, color: true, order: true },
            sort: { order: SortOrder.Ascending },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            props: { isRoot: true },
          });

        return FormRecordOptions.toOptions(severities);
      }

      case FormTargetOptionsSource.Monitor: {
        const monitors: Array<Monitor> = await MonitorService.findBy({
          query: { projectId: data.projectId, ...idFilter },
          select: { _id: true, name: true },
          sort: { name: SortOrder.Ascending },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: { isRoot: true },
        });

        return FormRecordOptions.toOptions(monitors);
      }

      case FormTargetOptionsSource.Label: {
        const labels: Array<Label> = await LabelService.findBy({
          query: { projectId: data.projectId, ...idFilter },
          select: { _id: true, name: true, color: true },
          sort: { name: SortOrder.Ascending },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: { isRoot: true },
        });

        return FormRecordOptions.toOptions(labels);
      }

      case FormTargetOptionsSource.StatusPage: {
        const statusPages: Array<StatusPage> = await StatusPageService.findBy({
          query: { projectId: data.projectId, ...idFilter },
          select: { _id: true, name: true },
          sort: { name: SortOrder.Ascending },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: { isRoot: true },
        });

        return FormRecordOptions.toOptions(statusPages);
      }

      default:
        return [];
    }
  }

  // Each record's id, name and color, as the public form builder takes them.
  public static toOptions(
    records: Array<{
      id?: ObjectID | null | undefined;
      name?: string | null | undefined;
      color?: { toString: () => string } | null | undefined;
    }>,
  ): Array<FormRecordOption> {
    const options: Array<FormRecordOption> = [];

    for (const record of records) {
      if (!record.id) {
        continue;
      }

      const option: FormRecordOption = {
        id: record.id.toString().toLowerCase(),
        name: record.name || "",
      };

      if (record.color) {
        option.color = record.color.toString();
      }

      options.push(option);
    }

    return options;
  }
}
