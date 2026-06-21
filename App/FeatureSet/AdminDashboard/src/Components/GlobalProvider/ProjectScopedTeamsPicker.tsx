import AdminModelAPI from "../../Utils/ModelAPI";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import API from "Common/UI/Utils/API/API";
import Team from "Common/Models/DatabaseModels/Team";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
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

export interface ComponentProps {
  projectId: ObjectID | undefined;
  selectedTeamIds: Array<string>;
  onChange: (teamIds: Array<string>) => void;
}

/*
 * Project-scoped multi-select for a Global SSO/OIDC attachment's default teams.
 * Rendered via the attach form's `getCustomElement`, so it reads the live form
 * values on every render and refetches whenever the chosen project changes —
 * unlike `fetchDropdownOptions`, which only re-runs on form-step changes and so
 * could miss the selected project.
 */
const ProjectScopedTeamsPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [options, setOptions] = useState<Array<DropdownOption>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const projectIdString: string = props.projectId?.toString() || "";

  useEffect(() => {
    if (!props.projectId) {
      setOptions([]);
      return undefined;
    }

    let cancelled: boolean = false;
    setIsLoading(true);
    setError("");

    AdminModelAPI.getList<Team>({
      modelType: Team,
      query: { projectId: props.projectId },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: { _id: true, name: true },
      sort: { name: SortOrder.Ascending },
    })
      .then((result: { data: Array<Team> }) => {
        if (cancelled) {
          return;
        }
        setOptions(
          result.data.map((team: Team): DropdownOption => {
            return {
              label: team.name?.toString() || "",
              value: team.id?.toString() || "",
            };
          }),
        );
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

  if (!props.projectId) {
    return (
      <p className="text-sm text-gray-500">
        Select a project first to choose its default teams.
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
      isMultiSelect={true}
      options={options}
      value={selectedOptions}
      placeholder="Select Teams"
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
