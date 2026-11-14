import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import OpenStackCloudCheck from "Common/Models/DatabaseModels/OpenStackCloudCheck";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import CollapsibleSection from "Common/UI/Components/CollapsibleSection/CollapsibleSection";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Link from "Common/UI/Components/Link/Link";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import OpenStackPartNotice from "../Part/OpenStackPartNotice";
import { getOpenStackTraceRoute } from "../Traces/OpenStackTraceARequestCard";
import { OpenStackCheckPill } from "./OpenStackApiChecksCard";
import { OpenStackLifecycleCheckFormModal } from "./OpenStackCheckFormModals";
import {
  OPENSTACK_CHECK_TONE_CLASS_NAMES,
  OPENSTACK_LIFECYCLE_CHECK_STATEMENT,
  OpenStackLifecycleRecentRow,
  OpenStackLifecycleRegionView,
  OpenStackLifecycleStepRow,
  getOpenStackLifecycleRegionViews,
} from "./OpenStackChecksView";

/*
 * Can a user boot an instance: the check that writes, so it stays off until someone turns it on and
 * says plainly what it creates. Once on, each region says what its last run came to, what each step
 * took, and when one failed, which step and what the service said.
 */

export interface ComponentProps {
  openStackCloudId: ObjectID;
  cloud: OpenStackCloud;
  check: OpenStackCloudCheck | null;
  canEdit: boolean;
  onChanged: () => void;
}

const OpenStackLifecycleRegion: FunctionComponent<{
  region: OpenStackLifecycleRegionView;
}> = (props: { region: OpenStackLifecycleRegionView }): ReactElement => {
  const translator: Translator = useTranslator();
  const { region } = props;

  return (
    <div
      className="rounded-lg border border-gray-200 p-4"
      data-testid="openstack-lifecycle-region"
      data-region={region.regionName}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-gray-900">{region.regionName}</span>
        <OpenStackCheckPill
          className={OPENSTACK_CHECK_TONE_CLASS_NAMES[region.tone]}
          text={region.headline}
        />
      </div>

      {region.isStale ? (
        <p
          className="mt-2 text-amber-800"
          data-testid="openstack-lifecycle-stale"
        >
          {translator.translateText(
            "That is the last run to finish. None has finished since, so this may no longer be so.",
          )}
        </p>
      ) : (
        <></>
      )}

      {region.attemptSentence && region.attemptTone ? (
        <p
          className="mt-2 break-words text-gray-700"
          data-testid="openstack-lifecycle-attempt"
          data-tone={region.attemptTone}
        >
          {region.attemptSentence}
        </p>
      ) : (
        <></>
      )}

      {region.finishedAt ? (
        <p
          className="mt-2 text-gray-500"
          data-testid="openstack-lifecycle-finished"
        >
          {translator.translateTemplate("Finished {{time}}, in {{duration}}.", {
            time: OneUptimeDate.fromNow(new Date(region.finishedAt)),
            duration: region.durationText || "",
          })}
        </p>
      ) : (
        <></>
      )}

      {region.failedStepTitle ? (
        <p
          className="mt-2 break-words font-medium text-red-800"
          data-testid="openstack-lifecycle-failed-step"
        >
          {translator.translateTemplate("Failed at: {{step}}", {
            step: region.failedStepTitle,
          })}
          {region.faultText ? (
            <span
              className="mt-1 block font-normal"
              data-testid="openstack-lifecycle-fault"
            >
              {region.faultText}
            </span>
          ) : (
            <></>
          )}
        </p>
      ) : (
        <></>
      )}

      {region.isBootSlow ? (
        <p
          className="mt-2 text-amber-800"
          data-testid="openstack-lifecycle-boot-slow"
        >
          {translator.translateText(
            "The server reached ACTIVE, more slowly than the line the Instance Boot Slow template reads.",
          )}
        </p>
      ) : (
        <></>
      )}

      {region.steps.length > 0 ? (
        <ul className="mt-3 space-y-2" data-testid="openstack-lifecycle-steps">
          {region.steps.map((step: OpenStackLifecycleStepRow): ReactElement => {
            return (
              <li
                key={step.id}
                data-testid={`openstack-lifecycle-step-${step.id}`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span
                    className={
                      step.status === "Failed"
                        ? "font-medium text-red-800"
                        : "text-gray-700"
                    }
                  >
                    {translator.translateText(step.title)}
                  </span>
                  <span className="text-gray-500">{step.durationText}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-gray-100">
                  <div
                    className={`h-1.5 rounded-full ${step.status === "Failed" ? "bg-red-400" : "bg-indigo-400"}`}
                    style={{ width: `${Math.max(step.share, 1)}%` }}
                  />
                </div>
                {step.traceId ? (
                  <Link
                    to={getOpenStackTraceRoute(step.traceId)}
                    className="mt-1 inline-block text-xs text-indigo-600 hover:underline"
                  >
                    <span>{translator.translateText("Open its trace")}</span>
                  </Link>
                ) : (
                  <></>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <></>
      )}

      {region.leftoverCount > 0 ? (
        <p
          className="mt-3 text-amber-800"
          data-testid="openstack-lifecycle-leftovers"
        >
          {translator.translateTemplate(
            "{{count}} things this run made would not delete. The janitor tries again once they are two intervals old.",
            { count: String(region.leftoverCount) },
          )}
        </p>
      ) : (
        <></>
      )}

      {region.removedByJanitorCount > 0 ? (
        <p
          className="mt-3 text-gray-500"
          data-testid="openstack-lifecycle-janitor"
        >
          {translator.translateTemplate(
            "The janitor removed {{count}} things an earlier run left.",
            { count: String(region.removedByJanitorCount) },
          )}
        </p>
      ) : (
        <></>
      )}

      {region.recent.length > 0 ? (
        <div className="mt-3">
          <CollapsibleSection title="Recent runs" defaultCollapsed={true}>
            <ul
              className="divide-y divide-gray-100"
              data-testid="openstack-lifecycle-recent"
            >
              {region.recent.map(
                (run: OpenStackLifecycleRecentRow): ReactElement => {
                  return (
                    <li
                      key={run.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
                    >
                      <OpenStackCheckPill
                        className={OPENSTACK_CHECK_TONE_CLASS_NAMES[run.tone]}
                        text={run.statusText}
                      />
                      <span className="text-gray-500">
                        {OneUptimeDate.fromNow(new Date(run.finishedAt))}
                      </span>
                      <span className="text-gray-500">{run.durationText}</span>
                      {run.bootText ? (
                        <span className="text-gray-500">
                          {translator.translateTemplate("boot {{time}}", {
                            time: run.bootText,
                          })}
                        </span>
                      ) : (
                        <></>
                      )}
                      {run.traceId ? (
                        <Link
                          to={getOpenStackTraceRoute(run.traceId)}
                          className="text-xs text-indigo-600 hover:underline"
                        >
                          <span>
                            {translator.translateText("Open its trace")}
                          </span>
                        </Link>
                      ) : (
                        <></>
                      )}
                      {run.sentence ? (
                        <div className="w-full break-words text-gray-500">
                          {run.sentence}
                        </div>
                      ) : (
                        <></>
                      )}
                    </li>
                  );
                },
              )}
            </ul>
          </CollapsibleSection>
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

const OpenStackLifecycleCheckCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isFormOpen, setIsFormOpen] = useState<boolean>(false);
  const [isConfirmingOff, setIsConfirmingOff] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string>("");

  const isOn: boolean = props.check?.isLifecycleCheckEnabled === true;
  const isSweeping: boolean = !isOn && props.check?.isSweepPending === true;

  const save: (data: JSONObject, after: () => void) => void = (
    data: JSONObject,
    after: () => void,
  ): void => {
    if (!props.check?.id) {
      return;
    }

    setIsSaving(true);
    setSaveError("");
    ModelAPI.updateById({
      modelType: OpenStackCloudCheck,
      id: props.check.id,
      data: data,
    })
      .then(() => {
        after();
        props.onChanged();
      })
      .catch((err: Error) => {
        setSaveError(API.getFriendlyErrorMessage(err));
      })
      .finally(() => {
        setIsSaving(false);
      });
  };

  const buttons: Array<CardButtonSchema> = [];

  if (props.canEdit && isOn) {
    buttons.push({
      title: "Turn Off",
      buttonStyle: ButtonStyleType.OUTLINE,
      icon: IconProp.Close,
      onClick: () => {
        setSaveError("");
        setIsConfirmingOff(true);
      },
    });
    buttons.push({
      title: "Edit",
      buttonStyle: ButtonStyleType.OUTLINE,
      icon: IconProp.Edit,
      onClick: () => {
        setIsFormOpen(true);
      },
    });
    buttons.push({
      title: "Run Now",
      buttonStyle: ButtonStyleType.NORMAL,
      icon: IconProp.Play,
      isLoading: isSaving,
      onClick: () => {
        save(
          { lifecycleRunRequestedAt: OneUptimeDate.getCurrentDate() },
          () => {},
        );
      },
    });
  }

  if (props.canEdit && !isOn) {
    buttons.push({
      title: "Turn On the Lifecycle Check",
      buttonStyle: ButtonStyleType.NORMAL,
      icon: IconProp.Play,
      onClick: () => {
        setIsFormOpen(true);
      },
    });
  }

  const regions: Array<OpenStackLifecycleRegionView> = isOn
    ? getOpenStackLifecycleRegionViews({
        records: props.check?.lifecycleRecords,
        intervalInMinutes: props.check?.lifecycleCheckIntervalInMinutes,
        now: OneUptimeDate.getCurrentDate(),
      })
    : [];

  return (
    <Fragment>
      <Card
        title="Instance Lifecycle Check"
        description={
          isOn
            ? "A probe boots a real server in the project you set aside, then deletes it."
            : "Can a user boot an instance? Off until you turn it on, because it writes to your cloud."
        }
        buttons={buttons}
      >
        <div
          className="space-y-4 text-sm"
          data-testid="openstack-lifecycle-check"
        >
          {saveError ? <ErrorMessage message={saveError} /> : <></>}

          {!isOn ? (
            <p
              className="text-gray-700"
              data-testid="openstack-lifecycle-statement"
            >
              {translator.translateText(OPENSTACK_LIFECYCLE_CHECK_STATEMENT)}
            </p>
          ) : (
            <></>
          )}

          {isSweeping ? (
            <OpenStackPartNotice
              testId="openstack-lifecycle-sweeping"
              tone="neutral"
              text="It is off. A probe is clearing up anything named for this check, and the credential saved for it is deleted once nothing is left."
            />
          ) : (
            <></>
          )}

          {isOn && props.check?.checkError ? (
            <OpenStackPartNotice
              testId="openstack-lifecycle-error"
              tone="warning"
            >
              {/* The server's own sentence, kept as it is. */}
              <span>{props.check.checkError}</span>
            </OpenStackPartNotice>
          ) : (
            <></>
          )}

          {isOn ? (
            <p
              className="text-gray-500"
              data-testid="openstack-lifecycle-settings"
            >
              {translator.translateTemplate(
                "In project {{project}}, every {{minutes}} minutes.",
                {
                  project: props.check?.lifecycleProjectName || "",
                  minutes: String(
                    props.check?.lifecycleCheckIntervalInMinutes || "",
                  ),
                },
              )}{" "}
              {translator.translateText(
                props.check?.isOsProfilerKeySet
                  ? "An OSProfiler key is saved, so each step's writes are signed and a slow boot has a trace."
                  : "With an OSProfiler key, a slow boot would have a trace.",
              )}
              {props.canEdit && props.check?.isOsProfilerKeySet ? (
                <>
                  {" "}
                  <button
                    type="button"
                    className="text-indigo-600 hover:underline"
                    data-testid="openstack-lifecycle-forget-key"
                    onClick={() => {
                      save({ osProfilerKey: null }, () => {});
                    }}
                  >
                    {translator.translateText("Forget the key")}
                  </button>
                </>
              ) : (
                <></>
              )}
            </p>
          ) : (
            <></>
          )}

          {isOn && regions.length === 0 ? (
            <p
              className="text-gray-500"
              data-testid="openstack-lifecycle-waiting"
            >
              {translator.translateText(
                "Waiting for the first run. It starts when the probe next asks for work, and can take several minutes.",
              )}
            </p>
          ) : (
            <></>
          )}

          {regions.map((region: OpenStackLifecycleRegionView): ReactElement => {
            return (
              <OpenStackLifecycleRegion
                key={region.regionName}
                region={region}
              />
            );
          })}
        </div>
      </Card>

      {isFormOpen ? (
        <OpenStackLifecycleCheckFormModal
          openStackCloudId={props.openStackCloudId}
          cloud={props.cloud}
          saved={props.check}
          onClose={() => {
            setIsFormOpen(false);
          }}
          onSuccess={() => {
            setIsFormOpen(false);
            props.onChanged();
          }}
        />
      ) : (
        <></>
      )}

      {isConfirmingOff ? (
        <ConfirmModal
          title="Turn Off the Lifecycle Check"
          description="No more runs start. A probe clears up anything named for this check, then its credential and OSProfiler key are deleted. API checks stay on."
          submitButtonText="Turn Off the Lifecycle Check"
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isSaving}
          error={saveError || undefined}
          onClose={() => {
            setIsConfirmingOff(false);
          }}
          onSubmit={() => {
            save({ isLifecycleCheckEnabled: false }, () => {
              setIsConfirmingOff(false);
            });
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default OpenStackLifecycleCheckCard;
