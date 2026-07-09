import ProjectUser, { ProjectUserResult } from "../../../Utils/ProjectUser";
import { getColorForUserId, getUserInitials } from "./LayerUserColors";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import OnCallDutyPolicyScheduleLayer from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  layer: OnCallDutyPolicyScheduleLayer;
  onClose: () => void;
  onUserAdded: () => void;
}

const SEARCH_DEBOUNCE_MS: number = 250;
const SEARCH_LIMIT: number = 50;

const AddLayerUserModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [searchText, setSearchText] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [results, setResults] = useState<Array<ProjectUserResult>>([]);
  const [isSearching, setIsSearching] = useState<boolean>(true);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  // Guards against out-of-order responses from overlapping searches.
  const searchSeq: React.MutableRefObject<number> = useRef<number>(0);

  useEffect(() => {
    const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
      setDebouncedSearch(searchText);
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timeout);
    };
  }, [searchText]);

  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    if (!projectId) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    const mySeq: number = searchSeq.current + 1;
    searchSeq.current = mySeq;

    setIsSearching(true);
    setError("");

    ProjectUser.searchProjectUsers(projectId, debouncedSearch, SEARCH_LIMIT)
      .then((users: Array<ProjectUserResult>) => {
        if (mySeq !== searchSeq.current) {
          return; // a newer search superseded this one
        }
        setResults(users);
        setIsSearching(false);
      })
      .catch((err: Error) => {
        if (mySeq !== searchSeq.current) {
          return;
        }
        setError(API.getFriendlyMessage(err));
        setIsSearching(false);
      });
  }, [debouncedSearch]);

  /*
   * The same user may be added to a layer more than once (e.g. to take more
   * shifts in the rotation), so results are shown as-is without excluding
   * members who are already on the layer.
   */
  const visibleUsers: Array<ProjectUserResult> = results;

  const addUser: () => Promise<void> = async (): Promise<void> => {
    if (!selectedUserId) {
      return;
    }

    setIsAdding(true);
    setError("");

    try {
      const model: OnCallDutyPolicyScheduleLayerUser =
        new OnCallDutyPolicyScheduleLayerUser();
      model.onCallDutyPolicyScheduleId =
        props.layer.onCallDutyPolicyScheduleId!;
      model.projectId = props.layer.projectId!;
      model.onCallDutyPolicyScheduleLayerId = props.layer.id!;
      model.userId = new ObjectID(selectedUserId);

      await ModelAPI.create<OnCallDutyPolicyScheduleLayerUser>({
        model: model,
        modelType: OnCallDutyPolicyScheduleLayerUser,
      });

      props.onUserAdded();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setIsAdding(false);
    }
  };

  const getResultsBody: () => ReactElement = (): ReactElement => {
    // Initial load: skeleton rows that mirror the real row geometry.
    if (isSearching && visibleUsers.length === 0) {
      return (
        <div className="divide-y divide-gray-100" aria-hidden="true">
          {["w-1/3", "w-2/5", "w-1/4", "w-1/2"].map(
            (width: string, i: number) => {
              return (
                <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                  <span className="h-8 w-8 flex-shrink-0 rounded-full bg-gray-100 motion-safe:animate-pulse" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div
                      className={`h-3 rounded bg-gray-100 motion-safe:animate-pulse ${width}`}
                    />
                    <div className="h-2.5 w-1/2 rounded bg-gray-100 motion-safe:animate-pulse" />
                  </div>
                </div>
              );
            },
          )}
        </div>
      );
    }

    if (visibleUsers.length === 0) {
      const hasSearch: boolean = debouncedSearch.trim().length > 0;
      return (
        <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-50 text-gray-400 ring-1 ring-inset ring-gray-100">
            <Icon
              icon={hasSearch ? IconProp.MagnifyingGlass : IconProp.UserGroup}
              className="h-5 w-5"
            />
          </span>
          <div className="space-y-1">
            <p className="text-sm font-medium text-gray-900">
              {hasSearch ? "No matching members" : "No project members"}
            </p>
            <p className="mx-auto max-w-[16rem] text-xs leading-relaxed text-gray-500">
              {hasSearch
                ? "No members match your search. Try a different name or email."
                : "There are no members in this project to add."}
            </p>
          </div>
        </div>
      );
    }

    return (
      <div>
        {visibleUsers.map((user: ProjectUserResult) => {
          const isSelected: boolean = selectedUserId === user.userId;
          return (
            <button
              key={user.userId}
              type="button"
              aria-pressed={isSelected}
              onClick={() => {
                setSelectedUserId(user.userId);
              }}
              className={`group relative flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
                isSelected ? "bg-indigo-50" : "hover:bg-gray-50"
              }`}
            >
              {isSelected ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 left-0 w-0.5 rounded-r-full bg-indigo-600"
                />
              ) : null}

              <span
                className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white shadow-sm ring-2 ring-white"
                style={{ backgroundColor: getColorForUserId(user.userId) }}
              >
                {getUserInitials(user.name, user.email)}
              </span>

              <div className="min-w-0 flex-1">
                <div
                  className={`truncate text-sm font-medium ${
                    isSelected ? "text-indigo-900" : "text-gray-900"
                  }`}
                >
                  {user.name || user.email || "Unknown user"}
                </div>
                {user.name && user.email ? (
                  <div className="truncate text-xs text-gray-500">
                    {user.email}
                  </div>
                ) : null}
              </div>

              <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center">
                {isSelected ? (
                  <Icon
                    icon={IconProp.CheckCircle}
                    className="h-5 w-5 text-indigo-600"
                  />
                ) : (
                  <span className="h-4 w-4 rounded-full opacity-0 ring-1 ring-inset ring-gray-300 transition-opacity duration-150 group-hover:opacity-100" />
                )}
              </span>
            </button>
          );
        })}
      </div>
    );
  };

  const showMeta: boolean = !isSearching && visibleUsers.length > 0;

  return (
    <Modal
      title="Add user"
      submitButtonText="Add to layer"
      submitButtonStyleType={ButtonStyleType.PRIMARY}
      closeButtonText="Cancel"
      onClose={props.onClose}
      onSubmit={() => {
        addUser().catch(() => {});
      }}
      isLoading={isAdding}
      disableSubmitButton={!selectedUserId || isAdding}
      error={error}
      modalWidth={ModalWidth.Normal}
    >
      <div className="pt-1">
        <p className="mb-4 text-sm leading-relaxed text-gray-500">
          Search your project members by name or email and add one to this
          layer&apos;s rotation.
        </p>

        <div className="group relative">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-gray-400 transition-colors duration-150 group-focus-within:text-indigo-500">
            <Icon icon={IconProp.Search} className="h-4 w-4" />
          </span>
          <input
            autoFocus
            type="text"
            value={searchText}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setSearchText(e.target.value);
            }}
            placeholder="Search by name or email…"
            className="h-11 w-full rounded-md border border-gray-300 bg-white pl-10 pr-10 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition duration-150 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
          <div className="absolute inset-y-0 right-2 flex items-center">
            {isSearching ? (
              <Icon
                icon={IconProp.Spinner}
                className="h-4 w-4 text-gray-300 motion-safe:animate-spin"
              />
            ) : searchText ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  setSearchText("");
                }}
                className="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <Icon icon={IconProp.Close} className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </div>

        {showMeta ? (
          <div className="mb-1.5 mt-4 flex items-center justify-between px-0.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
              Project members
            </span>
            <span className="text-[11px] font-medium tabular-nums text-gray-400">
              {selectedUserId ? "1 selected · " : ""}
              {visibleUsers.length}
            </span>
          </div>
        ) : null}

        <div
          className={`${
            showMeta ? "" : "mt-4"
          } overflow-hidden rounded-lg border border-gray-200 bg-white`}
        >
          <div className="max-h-72 divide-y divide-gray-100 overflow-y-auto">
            {getResultsBody()}
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default AddLayerUserModal;
