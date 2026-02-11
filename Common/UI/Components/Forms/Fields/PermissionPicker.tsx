import Permission, {
  PermissionGroup,
  PermissionHelper,
  PermissionProps,
} from "../../../../Types/Permission";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

export interface ComponentProps {
  onChange: (value: Permission | null) => void;
  initialValue?: Permission | undefined;
  placeholder?: string | undefined;
  onFocus?: (() => void) | undefined;
  tabIndex?: number | undefined;
  onBlur?: (() => void) | undefined;
  error?: string | undefined;
}

const PermissionPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [selectedPermission, setSelectedPermission] =
    useState<Permission | null>(props.initialValue || null);
  const [activeGroup, setActiveGroup] = useState<PermissionGroup | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");

  const allPermissions: Array<PermissionProps> = useMemo(() => {
    return PermissionHelper.getTenantPermissionProps();
  }, []);

  const groupedPermissions: Map<PermissionGroup, Array<PermissionProps>> =
    useMemo(() => {
      const map: Map<PermissionGroup, Array<PermissionProps>> = new Map();
      for (const perm of allPermissions) {
        if (!map.has(perm.group)) {
          map.set(perm.group, []);
        }
        map.get(perm.group)!.push(perm);
      }
      return map;
    }, [allPermissions]);

  const groups: Array<PermissionGroup> = useMemo(() => {
    return Array.from(groupedPermissions.keys());
  }, [groupedPermissions]);

  // Auto-select the group for the initial value
  useEffect(() => {
    if (props.initialValue && !activeGroup) {
      const match: PermissionProps | undefined = allPermissions.find(
        (p: PermissionProps) => p.permission === props.initialValue,
      );
      if (match) {
        setActiveGroup(match.group);
      }
    }
  }, [props.initialValue, allPermissions, activeGroup]);

  // Default to first group if none selected
  useEffect(() => {
    if (!activeGroup && groups.length > 0 && !props.initialValue) {
      setActiveGroup(groups[0]!);
    }
  }, [activeGroup, groups, props.initialValue]);

  const isSearching: boolean = searchQuery.trim().length > 0;
  const lowerQuery: string = searchQuery.toLowerCase();

  const filteredPermissions: Array<PermissionProps> = useMemo(() => {
    if (!isSearching) {
      return [];
    }
    return allPermissions.filter((p: PermissionProps) => {
      return (
        p.title.toLowerCase().includes(lowerQuery) ||
        p.description.toLowerCase().includes(lowerQuery)
      );
    });
  }, [allPermissions, isSearching, lowerQuery]);

  const searchMatchCountByGroup: Map<PermissionGroup, number> = useMemo(() => {
    const counts: Map<PermissionGroup, number> = new Map();
    if (!isSearching) {
      return counts;
    }
    for (const perm of filteredPermissions) {
      counts.set(perm.group, (counts.get(perm.group) || 0) + 1);
    }
    return counts;
  }, [filteredPermissions, isSearching]);

  const visiblePermissions: Array<PermissionProps> = useMemo(() => {
    if (isSearching) {
      if (activeGroup) {
        return filteredPermissions.filter(
          (p: PermissionProps) => p.group === activeGroup,
        );
      }
      return filteredPermissions;
    }
    if (!activeGroup) {
      return [];
    }
    return groupedPermissions.get(activeGroup) || [];
  }, [
    isSearching,
    activeGroup,
    filteredPermissions,
    groupedPermissions,
  ]);

  const handlePermissionClick = (perm: PermissionProps): void => {
    setSelectedPermission(perm.permission);
    props.onChange(perm.permission);
  };

  const getGroupCount = (group: PermissionGroup): number => {
    if (isSearching) {
      return searchMatchCountByGroup.get(group) || 0;
    }
    return groupedPermissions.get(group)?.length || 0;
  };

  return (
    <div
      tabIndex={props.tabIndex}
      onFocus={props.onFocus}
      onBlur={props.onBlur}
    >
      <div
        className={`border rounded-md overflow-hidden ${
          props.error ? "border-red-400" : "border-gray-300"
        }`}
        style={{ height: "400px" }}
      >
        {/* Search bar */}
        <div className="border-b border-gray-200 p-2">
          <input
            type="text"
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            placeholder={props.placeholder || "Search permissions..."}
            value={searchQuery}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setSearchQuery(e.target.value);
            }}
          />
        </div>

        <div className="flex" style={{ height: "calc(100% - 45px)" }}>
          {/* Left sidebar - groups */}
          <div
            className="border-r border-gray-200 overflow-y-auto bg-gray-50 flex-shrink-0"
            style={{ width: "200px" }}
          >
            {groups.map((group: PermissionGroup) => {
              const count: number = getGroupCount(group);
              const isActive: boolean = activeGroup === group;
              const isDimmed: boolean = isSearching && count === 0;

              return (
                <button
                  key={group}
                  type="button"
                  className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between border-b border-gray-100 transition-colors ${
                    isActive
                      ? "bg-indigo-50 text-indigo-700 font-medium"
                      : isDimmed
                        ? "text-gray-300 cursor-default"
                        : "text-gray-700 hover:bg-gray-100"
                  }`}
                  onClick={() => {
                    if (!isDimmed) {
                      setActiveGroup(group);
                    }
                  }}
                >
                  <span className="truncate">{group}</span>
                  <span
                    className={`ml-1 text-xs flex-shrink-0 ${
                      isActive ? "text-indigo-500" : "text-gray-400"
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Right panel - permissions */}
          <div className="flex-1 overflow-y-auto">
            {visiblePermissions.length === 0 && (
              <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                {isSearching
                  ? "No permissions match your search."
                  : "Select a group to view permissions."}
              </div>
            )}

            {visiblePermissions.map((perm: PermissionProps) => {
              const isSelected: boolean =
                selectedPermission === perm.permission;
              return (
                <button
                  key={perm.permission}
                  type="button"
                  className={`w-full text-left px-4 py-2.5 border-b border-gray-100 transition-colors ${
                    isSelected
                      ? "bg-indigo-50 border-l-2 border-l-indigo-500"
                      : "hover:bg-gray-50"
                  }`}
                  onClick={() => {
                    handlePermissionClick(perm);
                  }}
                >
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div
                        className={`text-sm font-medium ${
                          isSelected ? "text-indigo-700" : "text-gray-900"
                        }`}
                      >
                        {perm.title}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {perm.description}
                      </div>
                    </div>
                    {isSearching && (
                      <span className="inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600 flex-shrink-0">
                        {perm.group}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {props.error && (
        <p className="mt-1 text-sm text-red-400">{props.error}</p>
      )}
    </div>
  );
};

export default PermissionPicker;
