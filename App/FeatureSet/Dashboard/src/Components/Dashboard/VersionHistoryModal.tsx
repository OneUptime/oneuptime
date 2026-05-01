import React, { FunctionComponent, ReactElement } from "react";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import DashboardVersionHistory, {
  DashboardSnapshot,
} from "Common/Utils/Dashboard/DashboardVersionHistory";
import DashboardViewConfig from "Common/Types/Dashboard/DashboardViewConfig";
import OneUptimeDate from "Common/Types/Date";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";

export interface ComponentProps {
  dashboardId: string;
  onClose: () => void;
  onRestore: (config: DashboardViewConfig) => void;
}

const VersionHistoryModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const snapshots: Array<DashboardSnapshot> = DashboardVersionHistory.list(
    props.dashboardId,
  );

  return (
    <Modal
      title="Version History"
      description="Restore a previous saved version of this dashboard. Snapshots are stored in your browser only."
      onClose={props.onClose}
      modalWidth={ModalWidth.Medium}
      submitButtonText="Close"
      submitButtonStyleType={ButtonStyleType.NORMAL}
      onSubmit={props.onClose}
    >
      <div className="space-y-2 max-h-[60vh] overflow-y-auto">
        {snapshots.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2">
            <div className="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center">
              <Icon
                icon={IconProp.ArrowUturnLeft}
                className="w-5 h-5 text-gray-300"
              />
            </div>
            <p className="text-sm text-gray-400">
              No saved versions yet. Each Save creates a snapshot.
            </p>
          </div>
        ) : (
          snapshots.map((snap: DashboardSnapshot, index: number) => {
            const date: Date = new Date(snap.savedAt);
            const isLatest: boolean = index === 0;
            return (
              <div
                key={snap.savedAt}
                className="flex items-center justify-between p-3 rounded-lg border border-gray-200/60 bg-white hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      isLatest ? "bg-emerald-400" : "bg-gray-300"
                    }`}
                  ></div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-700">
                      {OneUptimeDate.getDateAsLocalFormattedString(date, true)}
                      {isLatest && (
                        <span className="ml-2 text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-100">
                          Latest
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400">
                      {snap.config.components?.length || 0} components
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="text-xs font-medium px-3 py-1.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-100 hover:bg-indigo-100 transition-colors cursor-pointer"
                  onClick={() => {
                    props.onRestore(snap.config);
                    props.onClose();
                  }}
                >
                  Restore
                </button>
              </div>
            );
          })
        )}
      </div>
    </Modal>
  );
};

export default VersionHistoryModal;
