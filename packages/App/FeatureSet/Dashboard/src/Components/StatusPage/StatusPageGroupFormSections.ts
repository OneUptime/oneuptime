import StatusPageGroup from "Common/Models/DatabaseModels/StatusPageGroup";
import StatusPageGroupViewMode from "Common/Types/StatusPage/StatusPageGroupViewMode";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The status page group form (Status Page > Resources > New Group, and Edit
 * Group) is one page: the group's name and where it sits, then two folded
 * sections - Layout, and Advanced (getAdvancedFormSection) for the rest.
 *
 * Layout holds the view mode and, for a grid, its row and column axes. A
 * list is what nearly every group is, so the section starts folded and says
 * "List" under its title. A grid group cannot hold a monitor until its axes
 * exist, so on a grid group's form the section opens by itself - which is
 * also where "Set up the grid" on the Resources screen lands.
 */

export const STATUS_PAGE_GROUP_LAYOUT_SECTION_ID: string = "layout";

export const STATUS_PAGE_GROUP_LAYOUT_SECTION_TITLE: string = "Layout";

export const STATUS_PAGE_GROUP_LIST_SUMMARY: string = translationKey("List");

export const STATUS_PAGE_GROUP_GRID_SUMMARY: string = translationKey("Grid");

type IsGridViewModeFunction = (viewMode: unknown) => boolean;

/*
 * Whether a form's view mode is Grid. The dropdown can hold the option it
 * was picked as ({ label, value }) as well as the value itself.
 */
export const isGridViewMode: IsGridViewModeFunction = (
  viewMode: unknown,
): boolean => {
  const value: unknown =
    viewMode && typeof viewMode === "object" && "value" in viewMode
      ? (viewMode as { value: unknown }).value
      : viewMode;

  return value === StatusPageGroupViewMode.Grid;
};

export type GetStatusPageGroupLayoutSectionFunction =
  () => FormFieldCollapsibleSection<StatusPageGroup>;

export const getStatusPageGroupLayoutSection: GetStatusPageGroupLayoutSectionFunction =
  (): FormFieldCollapsibleSection<StatusPageGroup> => {
    return {
      id: STATUS_PAGE_GROUP_LAYOUT_SECTION_ID,
      title: STATUS_PAGE_GROUP_LAYOUT_SECTION_TITLE,
      /*
       * A grid is what opens the section: the form of a grid group shows its
       * axes without being asked (openWhenConfigured is left on).
       */
      isConfigured: (values: FormValues<StatusPageGroup>): boolean => {
        return isGridViewMode(
          (values as Record<string, unknown> | undefined)?.["viewMode"],
        );
      },
      getSummary: (values: FormValues<StatusPageGroup>): Array<string> => {
        return [
          isGridViewMode(
            (values as Record<string, unknown> | undefined)?.["viewMode"],
          )
            ? STATUS_PAGE_GROUP_GRID_SUMMARY
            : STATUS_PAGE_GROUP_LIST_SUMMARY,
        ];
      },
    };
  };

export default getStatusPageGroupLayoutSection;
