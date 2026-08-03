import bulkAddStatusPageMonitors, {
  BulkAddStatusPageMonitorFailure,
  BulkAddStatusPageMonitorsResult,
} from "./BulkAddStatusPageMonitors";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import API from "Common/UI/Utils/API/API";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import ModelList from "Common/UI/Components/ModelList/ModelList";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ObjectID from "Common/Types/ObjectID";
import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";

export interface GridPlacementOptions {
  rowLabel: string;
  rowValues: Array<string>;
  columnLabel: string;
  columnValues: Array<string>;
}

export interface ComponentProps {
  projectId: ObjectID;
  statusPageId: ObjectID;
  statusPageGroupId?: ObjectID | undefined;
  gridPlacement?: GridPlacementOptions | undefined;
  onClose: () => void;
  onComplete: (result: BulkAddStatusPageMonitorsResult) => void;
}

const BulkAddStatusPageMonitorsModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [selectedMonitors, setSelectedMonitors] = useState<Array<Monitor>>([]);
  const [rowAxisValue, setRowAxisValue] = useState<string>("");
  const [columnAxisValue, setColumnAxisValue] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [result, setResult] = useState<BulkAddStatusPageMonitorsResult | null>(
    null,
  );

  const rowOptions: Array<DropdownOption> = useMemo(() => {
    return (props.gridPlacement?.rowValues || []).map((value: string) => {
      return { label: value, value };
    });
  }, [props.gridPlacement?.rowValues]);

  const columnOptions: Array<DropdownOption> = useMemo(() => {
    return (props.gridPlacement?.columnValues || []).map((value: string) => {
      return { label: value, value };
    });
  }, [props.gridPlacement?.columnValues]);

  const hasRequiredGridPlacement: boolean = props.gridPlacement
    ? Boolean(rowAxisValue && columnAxisValue)
    : true;

  const onSubmit: () => Promise<void> = async (): Promise<void> => {
    if (selectedMonitors.length === 0 || !hasRequiredGridPlacement) {
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const bulkResult: BulkAddStatusPageMonitorsResult =
        await bulkAddStatusPageMonitors({
          monitors: selectedMonitors,
          projectId: props.projectId,
          statusPageId: props.statusPageId,
          statusPageGroupId: props.statusPageGroupId,
          rowAxisValue: rowAxisValue || undefined,
          columnAxisValue: columnAxisValue || undefined,
        });

      setResult(bulkResult);
      props.onComplete(bulkResult);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  const getFailureMessage: (
    failure: BulkAddStatusPageMonitorFailure,
  ) => string = (failure: BulkAddStatusPageMonitorFailure): string => {
    return API.getFriendlyMessage(failure.error);
  };

  if (result) {
    const totalCount: number = result.succeeded.length + result.failed.length;

    return (
      <Modal
        title={
          result.failed.length > 0 ? "Monitor Add Results" : "Monitors Added"
        }
        description={`Added ${result.succeeded.length} of ${totalCount} selected monitors.`}
        closeButtonText="Done"
        closeButtonStyleType={ButtonStyleType.PRIMARY}
        onClose={props.onClose}
      >
        <div className="space-y-4">
          {result.succeeded.length > 0 ? (
            <div>
              <h4 className="text-sm font-semibold text-green-800">
                Added ({result.succeeded.length})
              </h4>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700">
                {result.succeeded.map((monitor: Monitor) => {
                  return (
                    <li key={monitor._id || monitor.name}>{monitor.name}</li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {result.failed.length > 0 ? (
            <div>
              <h4 className="text-sm font-semibold text-red-800">
                Failed ({result.failed.length})
              </h4>
              <ul className="mt-2 space-y-2 text-sm text-gray-700">
                {result.failed.map(
                  (failure: BulkAddStatusPageMonitorFailure, index: number) => {
                    return (
                      <li
                        key={`${failure.monitor._id || failure.monitor.name}-${index}`}
                        className="rounded-md bg-red-50 px-3 py-2"
                      >
                        <span className="font-medium">
                          {failure.monitor.name || "Unknown monitor"}:
                        </span>{" "}
                        {getFailureMessage(failure)}
                      </li>
                    );
                  },
                )}
              </ul>
            </div>
          ) : null}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Add Multiple Monitors"
      description="Select the monitors to add. Each status page display name and description will be copied from its monitor."
      modalWidth={ModalWidth.Medium}
      submitButtonText={
        selectedMonitors.length > 0
          ? `Add ${selectedMonitors.length} Monitor${selectedMonitors.length === 1 ? "" : "s"}`
          : "Add Monitors"
      }
      onClose={props.onClose}
      onSubmit={() => {
        onSubmit().catch((err: Error) => {
          setError(API.getFriendlyMessage(err));
        });
      }}
      isLoading={isLoading}
      error={error}
      disableSubmitButton={
        selectedMonitors.length === 0 || !hasRequiredGridPlacement
      }
    >
      <div className="space-y-5">
        {props.gridPlacement ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                {props.gridPlacement.rowLabel} (Row)
              </label>
              <Dropdown
                options={rowOptions}
                placeholder={`Select ${props.gridPlacement.rowLabel.toLowerCase()}`}
                ariaLabel={`${props.gridPlacement.rowLabel} row`}
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ) => {
                  setRowAxisValue((value as string) || "");
                }}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                {props.gridPlacement.columnLabel} (Column)
              </label>
              <Dropdown
                options={columnOptions}
                placeholder={`Select ${props.gridPlacement.columnLabel.toLowerCase()}`}
                ariaLabel={`${props.gridPlacement.columnLabel} column`}
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ) => {
                  setColumnAxisValue((value as string) || "");
                }}
              />
            </div>
          </div>
        ) : null}

        <div>
          <h4 className="text-sm font-medium text-gray-900">Monitors</h4>
          <p className="mt-1 text-sm text-gray-500">
            Choose one or more monitors. Click a selected monitor again to
            remove it.
          </p>
          <ModelList<Monitor>
            id="bulk-add-status-page-monitors"
            modelType={Monitor}
            query={{ projectId: props.projectId }}
            titleField="name"
            descriptionField="description"
            selectMultiple={true}
            isSearchEnabled={true}
            select={{ _id: true, name: true, description: true }}
            noItemsMessage="No monitors are available in this project."
            onSelectChange={(monitors: Array<Monitor>) => {
              setSelectedMonitors(monitors);
            }}
          />
        </div>
      </div>
    </Modal>
  );
};

export default BulkAddStatusPageMonitorsModal;
