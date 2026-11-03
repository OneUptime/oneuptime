import Project from "Common/Models/DatabaseModels/Project";
import NetworkTopologyLayout, {
  NetworkTopologyLayoutUtil,
} from "Common/Types/NetworkDevice/NetworkTopologyLayout";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";

/*
 * The layout every network topology map in the project opens on (issue
 * #5378), kept on the project (Project.defaultNetworkTopologyLayout) so the
 * whole team sees the network the same way. A Project Owner or Admin sets it
 * from the map's own options; nobody else sees the controls.
 */

export const DEFAULT_LAYOUT_COLUMN: string = "defaultNetworkTopologyLayout";

/*
 * The project's default, read fresh each time a map opens, so a default set a
 * moment ago in another tab counts. null when the project has chosen none:
 * the map then opens on its own default, as it always did. Throws when it
 * cannot be read; the map treats that as no default rather than not opening.
 */
export async function fetchProjectDefaultLayout(): Promise<NetworkTopologyLayout | null> {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    return null;
  }

  const project: Project | null = await ModelAPI.getItem<Project>({
    modelType: Project,
    id: projectId,
    select: {
      defaultNetworkTopologyLayout: true,
    },
  });

  return NetworkTopologyLayoutUtil.parse(project?.defaultNetworkTopologyLayout);
}

/*
 * Make a layout the project's default, or clear it with null so every map
 * opens on its own default again. The server refuses it from anyone who is
 * not a Project Owner or Admin, and anything that is not a layout.
 */
export async function saveProjectDefaultLayout(
  layout: NetworkTopologyLayout | null,
): Promise<void> {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    throw new Error("No project is selected.");
  }

  await ModelAPI.updateById<Project>({
    modelType: Project,
    id: projectId,
    data: {
      [DEFAULT_LAYOUT_COLUMN]: layout,
    },
  });
}

/*
 * Whether this reader may change the project's default: the column's own
 * update permissions (Project Owner, Project Admin), not the project's,
 * which also let the billing roles in. Hidden rather than refused while the
 * permission snapshot has not landed yet, as every gate is.
 */
export function canChangeProjectDefaultLayout(): boolean {
  return PermissionGate.checkColumnUpdate(new Project(), DEFAULT_LAYOUT_COLUMN)
    .isAllowed;
}
