import { CLOUD_RESOURCE_ENVIRONMENT_LABELS } from "Common/Types/Cloud/CloudResourceEnvironment";
import {
  CloudOffHoursPreview,
  CloudOffHoursPreviewResource,
  CloudOffHoursSkipReason,
} from "Common/Types/Cloud/CloudSavingsApiTypes";
import ObjectID from "Common/Types/ObjectID";
import EmptyState, {
  EmptyStateSize,
} from "Common/UI/Components/EmptyState/EmptyState";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import IconProp from "Common/Types/Icon/IconProp";
import API from "Common/UI/Utils/API/API";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import CloudSavingsApi from "./CloudSavingsApi";
import { getEnvironmentTone } from "./CloudSavingsApplyModal";

/*
 * WHAT A SCHEDULE PICKS (#11010): every resource its tag picks now, and
 * for each whether the schedule stops it outside working hours - or why it
 * leaves it running: production, an environment nothing says, or a
 * connection whose Savings actions are off. Read when it is opened, so a
 * person can check a schedule before its first evening.
 */

export const PREVIEW_TITLE: string = translationKey(
  "Resources This Schedule Picks",
);
export const PREVIEW_DESCRIPTION: string = translationKey(
  "Stopped outside working hours, unless the schedule says why it leaves one running.",
);
export const PREVIEW_EMPTY: string = translationKey(
  "No resource carries this schedule's tag yet.",
);
export const PREVIEW_EMPTY_DESCRIPTION: string = translationKey(
  "Put the schedule's tag on a non-production instance or database, and it is listed here.",
);
export const PREVIEW_STOPS: string = translationKey("Stopped off hours");
export const PREVIEW_LOAD_FAILED: string = translationKey(
  "What this schedule picks could not be read.",
);
export const PREVIEW_CAPPED: string = translationKey(
  "Only the first 500 resources are listed.",
);
export const SKIP_REASONS: Readonly<Record<CloudOffHoursSkipReason, string>> = {
  [CloudOffHoursSkipReason.Production]: translationKey(
    "Left running: it is production.",
  ),
  [CloudOffHoursSkipReason.EnvironmentNotKnown]: translationKey(
    "Left running: nothing says it is not production. Tag it environment=dev, or mark its account non-production.",
  ),
  [CloudOffHoursSkipReason.OnlyLabelsSayNonProduction]: translationKey(
    "Left running: only its labels say it is not production. Tag it environment=dev in your cloud, or mark its account non-production.",
  ),
  [CloudOffHoursSkipReason.SavingsActionsOff]: translationKey(
    "Left running: Savings actions are off on its account's cloud connection.",
  ),
  [CloudOffHoursSkipReason.NotScheduledKind]: translationKey(
    "Left running: this schedule does not stop this kind of resource.",
  ),
};

export interface ComponentProps {
  scheduleId: ObjectID;
  onClose: () => void;
}

const CloudOffHoursPreviewModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [preview, setPreview] = useState<CloudOffHoursPreview | null>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let ignore: boolean = false;

    CloudSavingsApi.getSchedulePreview(props.scheduleId)
      .then((found: CloudOffHoursPreview): void => {
        if (!ignore) {
          setPreview(found);
        }
      })
      .catch((err: Error): void => {
        if (!ignore) {
          setError(API.getFriendlyMessage(err));
        }
      });

    return (): void => {
      ignore = true;
    };
  }, [props.scheduleId.toString()]);

  return (
    <Modal
      title={PREVIEW_TITLE}
      description={PREVIEW_DESCRIPTION}
      onClose={props.onClose}
      modalWidth={ModalWidth.Medium}
      isBodyLoading={!preview && !error}
      error={error}
      errorWhatFailed={
        error
          ? translator.translateText(PREVIEW_LOAD_FAILED) || PREVIEW_LOAD_FAILED
          : undefined
      }
    >
      <div data-testid="cloud-off-hours-preview">
        {preview && preview.resources.length === 0 ? (
          <EmptyState
            id="cloud-off-hours-preview-empty"
            icon={IconProp.Moon}
            title={PREVIEW_EMPTY}
            description={PREVIEW_EMPTY_DESCRIPTION}
            size={EmptyStateSize.Inline}
          />
        ) : (
          <ul className="divide-y divide-gray-100">
            {(preview?.resources || []).map(
              (resource: CloudOffHoursPreviewResource): ReactElement => {
                return (
                  <li
                    key={resource.cloudResourceId}
                    className="py-3"
                    data-testid="cloud-off-hours-preview-row"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <bdi className="min-w-0 break-all text-sm font-medium text-gray-900">
                        {resource.name}
                      </bdi>
                      <Pill
                        text={
                          CLOUD_RESOURCE_ENVIRONMENT_LABELS[
                            resource.environment
                          ]
                        }
                        tone={getEnvironmentTone(resource.environment)}
                      />
                    </div>
                    <div
                      className={
                        resource.skipReason
                          ? "mt-1 text-xs text-amber-800"
                          : "mt-1 text-xs text-emerald-700"
                      }
                    >
                      {translator.translateText(
                        resource.skipReason
                          ? SKIP_REASONS[resource.skipReason]
                          : PREVIEW_STOPS,
                      )}
                    </div>
                  </li>
                );
              },
            )}
          </ul>
        )}
        {preview?.isCapped ? (
          <p className="mt-3 text-xs text-gray-500">
            {translator.translateText(PREVIEW_CAPPED)}
          </p>
        ) : (
          <></>
        )}
      </div>
    </Modal>
  );
};

export default CloudOffHoursPreviewModal;
