import AdminModelAPI from "../../Utils/ModelAPI";
import { findProjectDefaultTeam } from "../../Utils/DefaultProjectTeam";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import API from "Common/UI/Utils/API/API";
import { InviteTeam } from "Common/UI/Utils/DefaultInviteTeam";
import { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Team from "Common/Models/DatabaseModels/Team";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * Resolve the selected project id from the attach-form value. The project field
 * is an entity dropdown, so the form stores the selected project's `_id` (a
 * string); we defensively also accept a DropdownOption / model-shaped value.
 */
export const resolveProjectIdFromFormValue: (
  value: unknown,
) => ObjectID | undefined = (value: unknown): ObjectID | undefined => {
  if (!value) {
    return undefined;
  }

  if (typeof value === "string") {
    return value ? new ObjectID(value) : undefined;
  }

  const idString: string | undefined =
    (value as { value?: string }).value?.toString() ||
    (value as { _id?: string })._id?.toString();

  return idString ? new ObjectID(idString) : undefined;
};

/*
 * Normalize the current `teams` form value into a flat list of team-id strings,
 * regardless of whether it is stored as ids, DropdownOptions, or model objects.
 */
export const selectedTeamIdsFromFormValue: (value: unknown) => Array<string> = (
  value: unknown,
): Array<string> => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry: unknown): string | undefined => {
      if (typeof entry === "string") {
        return entry;
      }
      return (
        (entry as { value?: string })?.value?.toString() ||
        (entry as { _id?: string })?._id?.toString()
      );
    })
    .filter((id: string | undefined): id is string => {
      return Boolean(id);
    });
};

type GetTeamIdsAfterTeamsLoadFunction = (data: {
  // What the form holds now.
  selectedTeamIds: Array<string>;
  // The teams of the project just loaded.
  availableTeamIds: Array<string>;
  // The project's members team (DefaultProjectTeam), or null.
  defaultTeamId: string | null;
}) => Array<string> | null;

/*
 * What the form should hold once the chosen project's teams are known, or
 * null when it already holds that.
 *
 *  1. Any selected team that is not a team of this project is dropped.
 *
 *     Switching projects leaves the old project's team ids in the form value.
 *     The dropdown stops *showing* them - it only shows options of the
 *     project it has loaded - so the box looks empty while the stale id is
 *     still set, and required-field validation reads the value rather than
 *     the dropdown, so the form submits. Nothing downstream catches it either:
 *     TeamMemberService checks that the team exists and that the user is not
 *     already on it, never that the team belongs to the project being
 *     written. The result is a membership whose team is in a different
 *     project than its projectId.
 *
 *  2. When nothing is left selected, the project's members team is picked:
 *     someone added to a project is there for the everyday work, which is
 *     what that team is for (Common/UI/Utils/DefaultInviteTeam). So a project
 *     just picked comes with its members team, and switching to another
 *     project swaps in that project's. A team the admin picked themselves is
 *     never replaced, and one they cleared is not put back while the project
 *     stays the same - this only runs when the project's teams load.
 *
 * Null when nothing changes, so a form the admin has not touched is not
 * rewritten (and, in a form that redraws its custom element on every change,
 * nothing loops).
 */
export const getTeamIdsAfterTeamsLoad: GetTeamIdsAfterTeamsLoadFunction =
  (data: {
    selectedTeamIds: Array<string>;
    availableTeamIds: Array<string>;
    defaultTeamId: string | null;
  }): Array<string> | null => {
    const availableTeamIds: Set<string> = new Set<string>(
      data.availableTeamIds,
    );

    const stillSelectableTeamIds: Array<string> = data.selectedTeamIds.filter(
      (teamId: string): boolean => {
        return availableTeamIds.has(teamId);
      },
    );

    const nextTeamIds: Array<string> =
      stillSelectableTeamIds.length === 0 &&
      data.defaultTeamId &&
      availableTeamIds.has(data.defaultTeamId)
        ? [data.defaultTeamId]
        : stillSelectableTeamIds;

    const isUnchanged: boolean =
      nextTeamIds.length === data.selectedTeamIds.length &&
      nextTeamIds.every((teamId: string, index: number): boolean => {
        return teamId === data.selectedTeamIds[index];
      });

    return isUnchanged ? null : nextTeamIds;
  };

export interface ComponentProps {
  projectId: ObjectID | undefined;
  selectedTeamIds: Array<string>;
  onChange: (teamIds: Array<string>) => void;
  /*
   * Defaults to multi-select, which is what the SSO/OIDC attachment forms want
   * ("provision users into these teams"). Set false where one team is the only
   * meaningful answer - adding a user to a project creates one TeamMember, so
   * the picker there must offer one team. `onChange` still reports an array in
   * both modes, empty when nothing is selected.
   */
  isMultiSelect?: boolean | undefined;
  placeholder?: string | undefined;
  noProjectMessage?: string | undefined;
}

/*
 * The teams of the project picked above it on the same form: a global SSO or
 * OIDC attachment's default teams, or the one team a user is added to.
 *
 * Rendered via the form's `getCustomElement`, so it reads the live form values
 * on every render and refetches whenever the chosen project changes - unlike
 * `fetchDropdownOptions`, which only re-runs on form-step changes and so
 * could miss the selected project. That is what lets the project and its
 * teams sit on one page: until a project is picked the picker says so, and
 * once one is, its teams load with its members team picked
 * (getTeamIdsAfterTeamsLoad).
 */
const ProjectScopedTeamsPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [options, setOptions] = useState<Array<DropdownOption>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  /*
   * The selection and the callback as they are when the teams arrive, not as
   * they were when the request went out.
   */
  const latestProps: MutableRefObject<ComponentProps> =
    useRef<ComponentProps>(props);
  latestProps.current = props;

  const projectIdString: string = props.projectId?.toString() || "";

  useEffect(() => {
    if (!props.projectId) {
      setOptions([]);
      return undefined;
    }

    let cancelled: boolean = false;
    setIsLoading(true);
    setError("");

    /*
     * The project's teams, by name, and which of them is its members team -
     * read side by side. The second never fails and gives up after a few
     * seconds (DefaultProjectTeam): without it the teams still show, with
     * nothing picked.
     */
    Promise.all([
      AdminModelAPI.getList<Team>({
        modelType: Team,
        query: { projectId: props.projectId },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: { _id: true, name: true },
        sort: { name: SortOrder.Ascending },
      }),
      findProjectDefaultTeam({ projectId: props.projectId }),
    ])
      .then(([result, defaultTeam]: [ListResult<Team>, InviteTeam | null]) => {
        if (cancelled) {
          return;
        }

        const fetchedOptions: Array<DropdownOption> = result.data.map(
          (team: Team): DropdownOption => {
            return {
              label: team.name?.toString() || "",
              value: team.id?.toString() || "",
            };
          },
        );

        setOptions(fetchedOptions);

        /*
         * On the fetch's success path only, so a failed or in-flight request
         * never discards a selection that may well still be valid.
         */
        const nextTeamIds: Array<string> | null = getTeamIdsAfterTeamsLoad({
          selectedTeamIds: latestProps.current.selectedTeamIds,
          availableTeamIds: fetchedOptions.map((option: DropdownOption) => {
            return option.value.toString();
          }),
          defaultTeamId: defaultTeam?.id || null,
        });

        if (nextTeamIds) {
          latestProps.current.onChange(nextTeamIds);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(API.getFriendlyMessage(err as Error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
    // Refetch only when the selected project changes.
  }, [projectIdString]);

  const isMultiSelect: boolean = props.isMultiSelect !== false;

  if (!props.projectId) {
    return (
      <p className="text-sm text-gray-500">
        {props.noProjectMessage ||
          "Select a project first to choose its default teams."}
      </p>
    );
  }

  if (isLoading) {
    return <p className="text-sm text-gray-500">Loading teams...</p>;
  }

  if (error) {
    return <p className="text-sm text-red-500">{error}</p>;
  }

  if (options.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        This project has no teams to choose from.
      </p>
    );
  }

  const selectedOptions: Array<DropdownOption> = options.filter(
    (option: DropdownOption) => {
      return props.selectedTeamIds.includes(option.value.toString());
    },
  );

  return (
    <Dropdown
      isMultiSelect={isMultiSelect}
      options={options}
      value={isMultiSelect ? selectedOptions : selectedOptions[0]}
      placeholder={
        props.placeholder || (isMultiSelect ? "Select Teams" : "Select Team")
      }
      onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
        const ids: Array<string> = Array.isArray(value)
          ? value.map((entry: DropdownValue) => {
              return entry.toString();
            })
          : value !== null && value !== undefined
            ? [value.toString()]
            : [];
        props.onChange(ids);
      }}
    />
  );
};

export default ProjectScopedTeamsPicker;
