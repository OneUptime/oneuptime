import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { RUNBOOK_URL } from "Common/UI/Config";
import ProjectUtil from "Common/UI/Utils/Project";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  isOpen: boolean;
  onClose: () => void;
  onStarted?: (() => void) | undefined;
  incidentId?: ObjectID | undefined;
  alertId?: ObjectID | undefined;
  scheduledMaintenanceId?: ObjectID | undefined;
}

const RunbookPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [error, setError] = useState<string>("");
  const [startingRunbookId, setStartingRunbookId] = useState<string | null>(
    null,
  );
  const [availableRunbooks, setAvailableRunbooks] = useState<Runbook[]>([]);
  const [isLoadingRunbooks, setIsLoadingRunbooks] = useState<boolean>(false);
  const [pickerSearch, setPickerSearch] = useState<string>("");

  const linkagePayload: Record<string, string> = {};
  if (props.incidentId) {
    linkagePayload["incidentId"] = props.incidentId.toString();
  }
  if (props.alertId) {
    linkagePayload["alertId"] = props.alertId.toString();
  }
  if (props.scheduledMaintenanceId) {
    linkagePayload["scheduledMaintenanceId"] =
      props.scheduledMaintenanceId.toString();
  }

  const loadRunbooks: () => Promise<void> = async (): Promise<void> => {
    setIsLoadingRunbooks(true);
    setPickerSearch("");
    try {
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
      if (!projectId) {
        setAvailableRunbooks([]);
        return;
      }
      const result: ListResult<Runbook> = await ModelAPI.getList<Runbook>({
        modelType: Runbook,
        query: { projectId, isEnabled: true },
        limit: 200,
        skip: 0,
        select: { _id: true, name: true, description: true },
        sort: { name: "asc" as any },
      });
      setAvailableRunbooks(result.data);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsLoadingRunbooks(false);
    }
  };

  useEffect(() => {
    if (props.isOpen) {
      void loadRunbooks();
    }
  }, [props.isOpen]);

  const startRunbook: (runbookId: string) => Promise<void> = async (
    runbookId: string,
  ): Promise<void> => {
    setStartingRunbookId(runbookId);
    setError("");
    try {
      const result: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post<JSONObject>({
          url: URL.fromString(RUNBOOK_URL.toString()).addRoute(
            "/run/" + runbookId,
          ),
          data: linkagePayload,
          headers: ModelAPI.getCommonHeaders({}),
        });
      if (result instanceof HTTPErrorResponse) {
        throw result;
      }
      props.onClose();
      if (props.onStarted) {
        props.onStarted();
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setStartingRunbookId(null);
    }
  };

  const filteredRunbooks: Runbook[] = pickerSearch.trim()
    ? availableRunbooks.filter((rb: Runbook) => {
        return (rb.name || "")
          .toLowerCase()
          .includes(pickerSearch.toLowerCase().trim());
      })
    : availableRunbooks;

  if (!props.isOpen) {
    return error ? (
      <ConfirmModal
        title="Could not start runbook"
        description={error}
        submitButtonText="Close"
        submitButtonType={ButtonStyleType.NORMAL}
        onSubmit={() => {
          setError("");
        }}
      />
    ) : (
      <Fragment />
    );
  }

  return (
    <Fragment>
      <Modal
        title="Run a Runbook"
        description="Pick a runbook to run. It will be attached to this event so you can track it from here."
        isLoading={false}
        modalWidth={ModalWidth.Large}
        onClose={() => {
          props.onClose();
        }}
        submitButtonText="Cancel"
        submitButtonStyleType={ButtonStyleType.OUTLINE}
        onSubmit={() => {
          props.onClose();
        }}
      >
        <div className="space-y-3">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
              <Icon
                icon={IconProp.Search}
                size={SizeProp.Regular}
                className="text-gray-400"
              />
            </span>
            <input
              type="text"
              placeholder="Search runbooks..."
              value={pickerSearch}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setPickerSearch(e.target.value);
              }}
              className="block w-full rounded-md border border-gray-300 bg-white pl-10 pr-3 py-2 text-sm placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {isLoadingRunbooks ? (
            <div className="flex justify-center py-6">
              <PageLoader isVisible={true} />
            </div>
          ) : filteredRunbooks.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-6 py-8 text-center">
              <div className="mx-auto h-10 w-10 rounded-full bg-white border border-gray-200 flex items-center justify-center mb-3">
                <Icon
                  icon={IconProp.BookOpen}
                  size={SizeProp.Regular}
                  className="text-gray-400"
                />
              </div>
              <p className="text-sm font-medium text-gray-900">
                {availableRunbooks.length === 0
                  ? "No runbooks yet"
                  : "No matches"}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {availableRunbooks.length === 0
                  ? "Create a runbook first, then come back to attach one."
                  : "Try a different search term."}
              </p>
            </div>
          ) : (
            <ul className="space-y-2 max-h-96 overflow-y-auto">
              {filteredRunbooks.map((rb: Runbook) => {
                const rbId: string = rb._id?.toString() || "";
                const isStarting: boolean = startingRunbookId === rbId;
                return (
                  <li key={rbId}>
                    <div className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 hover:border-indigo-300 hover:shadow-sm transition">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Icon
                            icon={IconProp.BookOpen}
                            size={SizeProp.Regular}
                            className="text-indigo-500 shrink-0"
                          />
                          <span className="text-sm font-semibold text-gray-900 truncate">
                            {rb.name || "Untitled runbook"}
                          </span>
                        </div>
                        {rb.description && (
                          <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                            {rb.description}
                          </p>
                        )}
                      </div>
                      <Button
                        title={isStarting ? "Starting..." : "Run"}
                        buttonStyle={ButtonStyleType.PRIMARY}
                        buttonSize={ButtonSize.Small}
                        icon={IconProp.Play}
                        onClick={() => {
                          void startRunbook(rbId);
                        }}
                        disabled={startingRunbookId !== null}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Modal>

      {error ? (
        <ConfirmModal
          title="Could not start runbook"
          description={error}
          submitButtonText="Close"
          submitButtonType={ButtonStyleType.NORMAL}
          onSubmit={() => {
            setError("");
          }}
        />
      ) : null}
    </Fragment>
  );
};

export default RunbookPicker;
