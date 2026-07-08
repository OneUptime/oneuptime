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
  // User ids already in the layer — excluded from the results.
  existingUserIds: Array<string>;
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

  const existingUserIdSet: Set<string> = new Set<string>(props.existingUserIds);
  const visibleUsers: Array<ProjectUserResult> = results.filter(
    (user: ProjectUserResult) => {
      return !existingUserIdSet.has(user.userId);
    },
  );

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
    if (isSearching && visibleUsers.length === 0) {
      return (
        <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-gray-400">
          <Icon icon={IconProp.Spinner} className="h-4 w-4 animate-spin" />
          Searching…
        </div>
      );
    }

    if (visibleUsers.length === 0) {
      return (
        <div className="px-4 py-8 text-center text-sm text-gray-500">
          {debouncedSearch.trim()
            ? "No matching users found."
            : "No project users available to add."}
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
              onClick={() => {
                setSelectedUserId(user.userId);
              }}
              className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                isSelected ? "bg-indigo-50" : "hover:bg-gray-50"
              }`}
            >
              <span
                className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                style={{ backgroundColor: getColorForUserId(user.userId) }}
              >
                {getUserInitials(user.name, user.email)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-gray-900">
                  {user.name || user.email || "Unknown user"}
                </div>
                {user.name && user.email ? (
                  <div className="truncate text-xs text-gray-500">
                    {user.email}
                  </div>
                ) : null}
              </div>
              {isSelected ? (
                <Icon
                  icon={IconProp.CheckCircle}
                  className="h-5 w-5 flex-shrink-0 text-indigo-600"
                />
              ) : null}
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <Modal
      title="Add User"
      submitButtonText="Add User to Layer"
      submitButtonStyleType={ButtonStyleType.PRIMARY}
      closeButtonText="Cancel"
      onClose={props.onClose}
      onSubmit={() => {
        addUser().catch(() => {});
      }}
      isLoading={isAdding}
      disableSubmitButton={!selectedUserId || isAdding}
      error={error}
      icon={IconProp.User}
      modalWidth={ModalWidth.Normal}
    >
      <div>
        <p className="mb-3 text-sm text-gray-500">
          Search your project members by name or email and add one to this
          layer&apos;s rotation.
        </p>

        <div className="relative">
          <Icon
            icon={IconProp.Search}
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
          />
          <input
            autoFocus
            type="text"
            value={searchText}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setSearchText(e.target.value);
            }}
            placeholder="Search by name or email…"
            className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <div className="mt-3 max-h-72 divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200">
          {getResultsBody()}
        </div>
      </div>
    </Modal>
  );
};

export default AddLayerUserModal;
