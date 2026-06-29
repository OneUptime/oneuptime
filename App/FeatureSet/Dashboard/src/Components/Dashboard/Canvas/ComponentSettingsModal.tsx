import DashboardViewConfig from "Common/Types/Dashboard/DashboardViewConfig";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import DashboardBaseComponent from "Common/Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import ArgumentsForm from "./ArgumentsForm";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import DashboardBaseComponentElement from "../Components/DashboardBaseComponent";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";

export interface ComponentProps {
  title: string;
  description: string;
  onClose: () => void;
  onComponentUpdate: (component: DashboardBaseComponent) => void;
  onComponentDelete: (component: DashboardBaseComponent) => void;
  onComponentDuplicate: (component: DashboardBaseComponent) => void;
  componentId: ObjectID;
  dashboardViewConfig: DashboardViewConfig;
  dashboardStartAndEndDate: RangeStartAndEndDateTime;
  totalCurrentDashboardWidthInPx: number;
  metrics: {
    metricTypes: Array<MetricType>;
    telemetryAttributes: string[];
  };
}

const ComponentSettingsModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const component: DashboardBaseComponent =
    props.dashboardViewConfig.components.find(
      (component: DashboardBaseComponent) => {
        return (
          component.componentId.toString() === props.componentId.toString()
        );
      },
    ) as DashboardBaseComponent;

  const [showDeleteConfirmation, setShowDeleteConfirmation] =
    useState<boolean>(false);

  const previewContainerRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const [previewWidth, setPreviewWidth] = useState<number>(0);

  useEffect(() => {
    const el: HTMLDivElement | null = previewContainerRef.current;
    if (!el) {
      return undefined;
    }
    setPreviewWidth(el.clientWidth);
    const ro: ResizeObserver = new ResizeObserver(
      (entries: ResizeObserverEntry[]) => {
        for (const entry of entries) {
          setPreviewWidth(entry.contentRect.width);
        }
      },
    );
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);

  const aspectRatio: number =
    (component.widthInDashboardUnits || 1) /
    (component.heightInDashboardUnits || 1);
  const previewHeight: number = Math.min(
    420,
    Math.max(240, previewWidth / aspectRatio),
  );

  return (
    <Modal
      title={props.title}
      description={props.description}
      modalWidth={ModalWidth.Large}
      onClose={() => {
        props.onComponentUpdate(component);
        props.onClose();
      }}
      closeButtonText="Done"
      leftFooterElement={
        <div className="flex items-center gap-2">
          <Button
            title={`Duplicate Widget`}
            icon={IconProp.Copy}
            buttonStyle={ButtonStyleType.NORMAL}
            onClick={() => {
              props.onComponentDuplicate(component);
            }}
          />
          <Button
            title={`Delete Widget`}
            icon={IconProp.Trash}
            buttonStyle={ButtonStyleType.DANGER_OUTLINE}
            onClick={() => {
              setShowDeleteConfirmation(true);
            }}
          />
        </div>
      }
      rightElement={
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-indigo-50 text-indigo-700 capitalize">
            {component.componentType}
          </span>
          <span className="text-xs text-gray-400">
            {component.widthInDashboardUnits} x{" "}
            {component.heightInDashboardUnits} units
          </span>
        </div>
      }
    >
      <>
        {showDeleteConfirmation && (
          <ConfirmModal
            title={`Delete Widget?`}
            description={`Are you sure you want to delete this widget? This action cannot be undone.`}
            onClose={() => {
              setShowDeleteConfirmation(false);
            }}
            submitButtonText={"Delete Widget"}
            onSubmit={() => {
              props.onComponentDelete(component);
              setShowDeleteConfirmation(false);
              props.onClose();
            }}
            submitButtonType={ButtonStyleType.DANGER}
          />
        )}

        <div className="space-y-6">
          <section>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Icon
                  icon={IconProp.Eye}
                  size={SizeProp.Regular}
                  className="text-gray-500"
                />
                <h4 className="text-sm font-semibold text-gray-800">
                  Live Preview
                </h4>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                Updates as you edit
              </div>
            </div>
            <div
              ref={previewContainerRef}
              className="rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50 to-white p-4 shadow-inner"
            >
              {previewWidth > 0 && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${
                      component.widthInDashboardUnits || 1
                    }, 1fr)`,
                    gridAutoRows: `${
                      previewHeight / (component.heightInDashboardUnits || 1)
                    }px`,
                    width: `${previewWidth - 32}px`,
                  }}
                >
                  <DashboardBaseComponentElement
                    componentId={props.componentId}
                    isEditMode={false}
                    isSelected={false}
                    key={`preview-${props.componentId.toString()}`}
                    onClick={() => {}}
                    onComponentUpdate={() => {}}
                    totalCurrentDashboardWidthInPx={
                      props.totalCurrentDashboardWidthInPx
                    }
                    dashboardCanvasTopInPx={0}
                    dashboardCanvasLeftInPx={0}
                    dashboardCanvasWidthInPx={previewWidth - 32}
                    dashboardCanvasHeightInPx={previewHeight}
                    dashboardComponentWidthInPx={previewWidth - 32}
                    dashboardComponentHeightInPx={previewHeight}
                    dashboardViewConfig={props.dashboardViewConfig}
                    dashboardStartAndEndDate={props.dashboardStartAndEndDate}
                    metricTypes={props.metrics.metricTypes}
                  />
                </div>
              )}
            </div>
          </section>

          <div className="border-t border-gray-200" />

          <section>
            <h4 className="text-sm font-semibold text-gray-800 mb-3">
              Settings
            </h4>
            <ArgumentsForm
              component={component}
              onFormChange={(component: DashboardBaseComponent) => {
                props.onComponentUpdate(component);
              }}
              metrics={props.metrics}
            />
          </section>
        </div>
      </>
    </Modal>
  );
};

export default ComponentSettingsModal;
