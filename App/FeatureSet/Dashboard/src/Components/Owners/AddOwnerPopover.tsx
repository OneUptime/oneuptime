import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Search from "Common/Types/BaseDatabase/Search";
import Query from "Common/Types/BaseDatabase/Query";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Team from "Common/Models/DatabaseModels/Team";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import Image from "Common/UI/Components/Image/Image";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import useComponentOutsideClick from "Common/UI/Types/UseComponentOutsideClick";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const PAGE_SIZE: number = 25;
const DEBOUNCE_MS: number = 250;

export interface AddOwnerSelection {
  kind: "user" | "team";
  id: ObjectID;
  name: string;
}

interface ResultRow {
  key: string;
  kind: "user" | "team";
  id: string;
  name: string;
  email?: string | undefined;
  userId?: string | undefined;
  hasProfilePicture: boolean;
}

export interface ComponentProps {
  isOpen: boolean;
  onClose: () => void;
  takenKeys: Set<string>;
  onSelect: (selection: AddOwnerSelection) => Promise<void>;
}

const USER_PALETTE: Array<string> = [
  "bg-gradient-to-br from-indigo-500 to-violet-600",
  "bg-gradient-to-br from-sky-500 to-blue-600",
  "bg-gradient-to-br from-fuchsia-500 to-pink-600",
  "bg-gradient-to-br from-emerald-500 to-teal-600",
  "bg-gradient-to-br from-amber-500 to-orange-600",
  "bg-gradient-to-br from-rose-500 to-red-600",
  "bg-gradient-to-br from-violet-500 to-purple-600",
  "bg-gradient-to-br from-cyan-500 to-sky-600",
];

const TEAM_PALETTE: Array<string> = [
  "bg-gradient-to-br from-slate-700 to-slate-900",
  "bg-gradient-to-br from-gray-700 to-gray-900",
  "bg-gradient-to-br from-stone-700 to-stone-900",
  "bg-gradient-to-br from-zinc-700 to-zinc-900",
  "bg-gradient-to-br from-neutral-700 to-neutral-900",
];

function hashString(text: string): number {
  let hash: number = 0;
  for (let i: number = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function getInitials(name: string): string {
  const parts: Array<string> = name
    .trim()
    .split(/\s+/)
    .filter((p: string) => {
      return p.length > 0;
    });
  if (parts.length === 0) {
    return "?";
  }
  if (parts.length === 1) {
    return ((parts[0] as string)[0] || "?").toUpperCase();
  }
  const first: string = (parts[0] as string)[0] || "";
  const last: string = (parts[parts.length - 1] as string)[0] || "";
  return (first + last).toUpperCase();
}

interface RowAvatarProps {
  row: ResultRow;
}

const RowAvatar: FunctionComponent<RowAvatarProps> = (
  props: RowAvatarProps,
): ReactElement => {
  const { row } = props;

  if (row.kind === "user" && row.hasProfilePicture && row.userId) {
    return (
      <Image
        className="h-8 w-8 rounded-full object-cover ring-1 ring-gray-200 bg-gray-100"
        imageUrl={UserUtil.getProfilePictureRoute(new ObjectID(row.userId))}
        alt={row.name}
      />
    );
  }

  const palette: Array<string> =
    row.kind === "user" ? USER_PALETTE : TEAM_PALETTE;
  const bg: string = palette[hashString(row.name) % palette.length] as string;

  return (
    <div
      className={`relative h-8 w-8 rounded-full ${bg} ring-1 ring-white shadow-sm flex items-center justify-center text-xs font-semibold text-white select-none`}
    >
      {getInitials(row.name)}
      {row.kind === "team" && (
        <span
          className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-white ring-1 ring-gray-200 flex items-center justify-center"
          aria-hidden="true"
        >
          <Icon
            icon={IconProp.UserGroup}
            className="h-2 w-2 text-gray-600"
            size={SizeProp.Smaller}
          />
        </span>
      )}
    </div>
  );
};

const AddOwnerPopover: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const { isOpen, onClose, takenKeys, onSelect } = props;

  const { ref, isComponentVisible, setIsComponentVisible } =
    useComponentOutsideClick(false);

  const [searchText, setSearchText] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [rows, setRows] = useState<Array<ResultRow>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string>("");
  const [pendingKey, setPendingKey] = useState<string>("");
  const [addError, setAddError] = useState<string>("");

  const searchInputRef: React.MutableRefObject<HTMLInputElement | null> =
    useRef<HTMLInputElement | null>(null);

  // Sync visibility with parent prop.
  useEffect(() => {
    setIsComponentVisible(isOpen);
  }, [isOpen, setIsComponentVisible]);

  // Tell the parent when the user closes the popover by clicking outside.
  useEffect(() => {
    if (!isComponentVisible && isOpen) {
      onClose();
    }
  }, [isComponentVisible, isOpen, onClose]);

  // Reset internal state and focus the search input when (re-)opening.
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setSearchText("");
    setDebouncedSearch("");
    setAddError("");
    setLoadError("");
    const handle: ReturnType<typeof setTimeout> = setTimeout(() => {
      searchInputRef.current?.focus();
    }, 0);
    return () => {
      clearTimeout(handle);
    };
  }, [isOpen]);

  // Debounce the search input.
  useEffect(() => {
    const handle: ReturnType<typeof setTimeout> = setTimeout(() => {
      setDebouncedSearch(searchText);
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(handle);
    };
  }, [searchText]);

  // Fetch results from the server whenever the debounced query changes.
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    if (!projectId) {
      setRows([]);
      return;
    }

    let cancelled: boolean = false;
    setIsLoading(true);
    setLoadError("");

    const trimmed: string = debouncedSearch.trim();

    const userQuery: Query<TeamMember> = {
      projectId: projectId,
    } as Query<TeamMember>;
    const teamQuery: Query<Team> = {
      projectId: projectId,
    } as Query<Team>;

    if (trimmed) {
      (userQuery as unknown as Record<string, unknown>)["user"] = {
        name: new Search(trimmed),
      };
      (teamQuery as unknown as Record<string, unknown>)["name"] = new Search(
        trimmed,
      );
    }

    Promise.all([
      ModelAPI.getList<TeamMember>({
        modelType: TeamMember,
        query: userQuery,
        limit: PAGE_SIZE,
        skip: 0,
        select: {
          _id: true,
          user: {
            _id: true,
            name: true,
            email: true,
            profilePictureId: true,
          },
        },
        sort: {},
      }),
      ModelAPI.getList<Team>({
        modelType: Team,
        query: teamQuery,
        limit: PAGE_SIZE,
        skip: 0,
        select: {
          _id: true,
          name: true,
        },
        sort: { name: SortOrder.Ascending },
      }),
    ])
      .then(
        ([userResult, teamResult]: [
          ListResult<TeamMember>,
          ListResult<Team>,
        ]) => {
          if (cancelled) {
            return;
          }

          const next: Array<ResultRow> = [];
          const seenUsers: Set<string> = new Set<string>();

          for (const tm of userResult.data) {
            const u: User | undefined = tm.user as User | undefined;
            const uid: string | undefined = u?._id?.toString();
            if (!u || !uid || seenUsers.has(uid)) {
              continue;
            }
            seenUsers.add(uid);
            next.push({
              key: `user:${uid}`,
              kind: "user",
              id: uid,
              name: u.name?.toString() || u.email?.toString() || uid,
              email: u.email?.toString(),
              userId: uid,
              hasProfilePicture: Boolean(u.profilePictureId),
            });
          }

          for (const t of teamResult.data) {
            const tid: string | undefined = t._id?.toString();
            if (!tid) {
              continue;
            }
            next.push({
              key: `team:${tid}`,
              kind: "team",
              id: tid,
              name: t.name?.toString() || "Team",
              hasProfilePicture: false,
            });
          }

          setRows(next);
        },
      )
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        setRows([]);
        setLoadError(API.getFriendlyMessage(err));
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, debouncedSearch]);

  const visibleRows: Array<ResultRow> = useMemo(() => {
    return rows.filter((r: ResultRow) => {
      return !takenKeys.has(r.key);
    });
  }, [rows, takenKeys]);

  const peopleRows: Array<ResultRow> = useMemo(() => {
    return visibleRows.filter((r: ResultRow) => {
      return r.kind === "user";
    });
  }, [visibleRows]);

  const teamRows: Array<ResultRow> = useMemo(() => {
    return visibleRows.filter((r: ResultRow) => {
      return r.kind === "team";
    });
  }, [visibleRows]);

  const handleSelect: (row: ResultRow) => Promise<void> = useCallback(
    async (row: ResultRow): Promise<void> => {
      if (pendingKey) {
        return;
      }
      setPendingKey(row.key);
      setAddError("");
      try {
        await onSelect({
          kind: row.kind,
          id: new ObjectID(row.id),
          name: row.name,
        });
      } catch (err) {
        setAddError(API.getFriendlyMessage(err));
      } finally {
        setPendingKey("");
      }
    },
    [onSelect, pendingKey],
  );

  if (!isOpen) {
    return null;
  }

  const renderRow: (row: ResultRow) => ReactElement = (
    row: ResultRow,
  ): ReactElement => {
    const isPending: boolean = pendingKey === row.key;
    return (
      <button
        key={row.key}
        type="button"
        disabled={Boolean(pendingKey)}
        onClick={() => {
          void handleSelect(row);
        }}
        className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-gray-50 focus:bg-gray-50 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed text-left transition-colors"
      >
        <RowAvatar row={row} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-gray-900 truncate">
            {row.name}
          </div>
          {row.kind === "user" && row.email && (
            <div className="text-xs text-gray-500 truncate">{row.email}</div>
          )}
          {row.kind === "team" && (
            <div className="text-xs text-gray-500">Team</div>
          )}
        </div>
        {isPending ? (
          <Icon
            icon={IconProp.Spinner}
            className="h-4 w-4 text-gray-400 animate-spin"
            size={SizeProp.Small}
          />
        ) : (
          <Icon
            icon={IconProp.Add}
            className="h-4 w-4 text-gray-300"
            size={SizeProp.Small}
          />
        )}
      </button>
    );
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Add owner"
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          setIsComponentVisible(false);
        }
      }}
      className="absolute z-30 left-0 top-full mt-2 w-80 rounded-lg bg-white shadow-xl ring-1 ring-gray-200 overflow-hidden"
    >
      <div className="px-3 pt-3 pb-2 border-b border-gray-100">
        <div className="relative">
          <span className="absolute inset-y-0 left-2.5 flex items-center pointer-events-none text-gray-400">
            <Icon
              icon={IconProp.Search}
              className="h-4 w-4"
              size={SizeProp.Small}
            />
          </span>
          <input
            ref={searchInputRef}
            type="text"
            value={searchText}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setSearchText(e.target.value);
            }}
            placeholder="Search people or teams..."
            className="w-full pl-8 pr-3 py-1.5 text-sm rounded-md border border-gray-200 bg-gray-50 focus:bg-white focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 placeholder-gray-400"
          />
        </div>
      </div>

      <div className="max-h-72 overflow-y-auto py-1">
        {isLoading && visibleRows.length === 0 && (
          <div className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-gray-500">
            <Icon
              icon={IconProp.Spinner}
              className="h-4 w-4 animate-spin"
              size={SizeProp.Small}
            />
            <span>Searching...</span>
          </div>
        )}

        {!isLoading && loadError && (
          <div className="px-3 py-4 text-sm text-red-600 flex items-start gap-2">
            <Icon
              icon={IconProp.Alert}
              className="h-4 w-4 mt-0.5 flex-shrink-0"
              size={SizeProp.Small}
            />
            <span>{loadError}</span>
          </div>
        )}

        {!isLoading && !loadError && visibleRows.length === 0 && (
          <div className="px-3 py-6 text-sm text-gray-500 text-center">
            {debouncedSearch.trim()
              ? "No matches found."
              : "No people or teams available."}
          </div>
        )}

        {peopleRows.length > 0 && (
          <div className="px-1">
            <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              People
            </div>
            <div className="px-1 pb-1">{peopleRows.map(renderRow)}</div>
          </div>
        )}

        {teamRows.length > 0 && (
          <div className="px-1">
            <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              Teams
            </div>
            <div className="px-1 pb-1">{teamRows.map(renderRow)}</div>
          </div>
        )}
      </div>

      {addError && (
        <div className="px-3 py-2 border-t border-gray-100 text-xs text-red-600 flex items-start gap-2 bg-red-50">
          <Icon
            icon={IconProp.Alert}
            className="h-3.5 w-3.5 mt-0.5 flex-shrink-0"
            size={SizeProp.Small}
          />
          <span>{addError}</span>
        </div>
      )}
    </div>
  );
};

export default AddOwnerPopover;
