import CloudSavingsAction from "Common/Models/DatabaseModels/CloudSavingsAction";
import Route from "Common/Types/API/Route";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  CLOUD_RESOURCE_ENVIRONMENT_LABELS,
  CloudResourceEnvironment,
} from "Common/Types/Cloud/CloudResourceEnvironment";
import {
  CLOUD_SAVINGS_ACTION_SENTENCES,
  CLOUD_SAVINGS_ACTION_STATUS_LABELS,
  CLOUD_SAVINGS_ACTION_TITLES,
  CLOUD_SAVINGS_MEASUREMENT_LABELS,
  CLOUD_SAVINGS_UNDO_SENTENCES,
  CloudSavingsActionKind,
  CloudSavingsActionOrigin,
  CloudSavingsActionStatus,
  CloudSavingsActionUndo,
  CloudSavingsMeasurement,
  isCloudSavingsActionInEffect,
} from "Common/Types/Cloud/CloudSavingsAction";
import { CloudSavingsActionResult } from "Common/Types/Cloud/CloudSavingsApiTypes";
import { joinWithArrowsOn } from "Common/Types/DirectionArrow";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ActionButtonPlacement } from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import Toast from "Common/UI/Utils/Toast";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import AppLink from "../../AppLink/AppLink";
import { formatCloudMoney } from "../CloudCostWords";
import CloudSavingsApi from "./CloudSavingsApi";
import { getEnvironmentTone } from "./CloudSavingsApplyModal";

/*
 * THE APPROVAL CARDS, AND WHAT WAS DONE (#11010).
 *
 * Waiting for approval: every change asked for - by a person who may not
 * approve it, or by an AI rule for savings - that waits for an owner of
 * its resource (or a project admin, for one nobody owns), with Approve and
 * Dismiss. Approve makes it at once, as the person approving, through the
 * account's connection.
 *
 * Changes made: what OneUptime changed for a saving, who approved it (or
 * which AI rule made it), whether it can be undone - Undo, where it can -
 * and what the bill showed it saved: realised, never estimated. An
 * off-hours schedule's stops are counted on its own page.
 */

export const WAITING_TITLE: string = translationKey("Waiting for Approval");
export const WAITING_DESCRIPTION: string = translationKey(
  "Changes asked for by people and AI rules. An owner of each resource approves it, or a project admin for one nobody owns.",
);
export const WAITING_EMPTY: string = translationKey(
  "No changes are waiting for approval yet.",
);
export const CHANGES_TITLE: string = translationKey("Changes Made");
export const CHANGES_DESCRIPTION: string = translationKey(
  "What OneUptime changed in your clouds for a saving, who approved it, and what the bill showed it saved.",
);
export const CHANGES_EMPTY: string = translationKey(
  "No changes made yet. Apply a saving above, and it is listed here.",
);
export const APPROVE: string = translationKey("Approve");
export const DISMISS: string = translationKey("Dismiss");
export const UNDO: string = translationKey("Undo");
export const APPROVE_TITLE: string = translationKey("Approve This Change?");
export const DISMISS_TITLE: string = translationKey("Dismiss This Change?");
export const DISMISS_DESCRIPTION: string = translationKey(
  "Say why: the person who asked for it and the resource's timeline see it.",
);
export const DISMISS_REASON: string = translationKey("Reason");
export const DISMISS_REASON_PLACEHOLDER: string = translationKey(
  "This server runs the nightly batch.",
);
export const UNDO_TITLE: string = translationKey("Undo This Change?");
export const APPROVED_TOAST: string = translationKey(
  "Approved. It is on the resource's timeline.",
);
export const FIRST_APPROVAL_TOAST: string = translationKey(
  "Your approval is recorded. A second person's is needed.",
);
export const DISMISSED_TOAST: string = translationKey("Dismissed.");
export const UNDONE_TOAST: string = translationKey(
  "Undone. It is on the resource's timeline.",
);
export const UNDER_WAY_TOAST: string = translationKey(
  "Under way: it takes a few minutes.",
);
export const ASKED_BY_RULE: string = translationKey("AI rule: {{rule}}");
export const ASKED_BY_DEFAULTS: string = translationKey("OneUptime AI");
export const MADE_BY_SCHEDULE: string = translationKey("Off-hours schedule");
export const SAVES_A_MONTH: string = translationKey("{{amount}} a month");
export const REALISED_A_MONTH: string = translationKey(
  "{{amount}} a month, as billed",
);

/*
 * How a change is taken back, in a sentence: what the Undo dialog says
 * before anything happens.
 */
export const CLOUD_SAVINGS_UNDO_ACTION_SENTENCES: Readonly<
  Record<CloudSavingsActionKind, string>
> = {
  [CloudSavingsActionKind.StopInstance]: translationKey(
    "Starts {{resource}} again.",
  ),
  [CloudSavingsActionKind.StopDatabase]: translationKey(
    "Starts {{resource}} again.",
  ),
  [CloudSavingsActionKind.ChangeVolumeType]: translationKey(
    "Changes {{resource}} back to {{from}}. EBS allows it six hours after the last change.",
  ),
  [CloudSavingsActionKind.DeleteVolume]: translationKey(
    "Makes the disk again from its final snapshot, as a new disk in its zone. Attach it where it was used.",
  ),
  [CloudSavingsActionKind.DeleteSnapshot]: translationKey("Cannot be undone."),
  [CloudSavingsActionKind.DeleteImage]: translationKey("Cannot be undone."),
  [CloudSavingsActionKind.ReleaseAddress]: translationKey("Cannot be undone."),
  [CloudSavingsActionKind.ResizeInstance]: translationKey(
    "Resizes {{resource}} back to {{from}}. It restarts, so it is down for a few minutes.",
  ),
  [CloudSavingsActionKind.ResizeDatabase]: translationKey(
    "Resizes {{resource}} back to {{from}}. It restarts, so it is down for a few minutes.",
  ),
};

export const CLOUD_SAVINGS_STATUS_TONES: Readonly<
  Record<CloudSavingsActionStatus, PillTone>
> = {
  [CloudSavingsActionStatus.Proposed]: PillTone.Warning,
  [CloudSavingsActionStatus.Applying]: PillTone.Info,
  [CloudSavingsActionStatus.Applied]: PillTone.Success,
  [CloudSavingsActionStatus.AppliedWithoutAsking]: PillTone.Success,
  [CloudSavingsActionStatus.Failed]: PillTone.Danger,
  [CloudSavingsActionStatus.Dismissed]: PillTone.Paused,
  [CloudSavingsActionStatus.Undoing]: PillTone.Info,
  [CloudSavingsActionStatus.Undone]: PillTone.Paused,
  [CloudSavingsActionStatus.Expired]: PillTone.Neutral,
  [CloudSavingsActionStatus.Ended]: PillTone.Success,
};

// The fields a row of either card reads.
export const CLOUD_SAVINGS_ACTION_ROW_SELECT: JSONObject = {
  kind: true,
  status: true,
  origin: true,
  environment: true,
  resourceName: true,
  resourceId: true,
  resourceType: true,
  region: true,
  cloudResourceId: true,
  fromConfiguration: true,
  toConfiguration: true,
  undo: true,
  monthlySavings: true,
  realisedMonthlySavings: true,
  measurement: true,
  currency: true,
  summary: true,
  failureMessage: true,
  autoRemediationRuleName: true,
  appliedAt: true,
  requestedByUser: { name: true, email: true },
  approvedByUser: { name: true, email: true },
  firstApprovedByUser: { name: true, email: true },
};

// "Stop Instance · m5.2xlarge → m5.xlarge": the change, as a card's first line says it.
export function getCloudSavingsChangeLine(
  action: CloudSavingsAction,
  translator: Translator,
): { title: string; change: string } {
  const kind: CloudSavingsActionKind | undefined = action.kind;

  return {
    title: kind
      ? translator.translateText(CLOUD_SAVINGS_ACTION_TITLES[kind]) ||
        CLOUD_SAVINGS_ACTION_TITLES[kind]
      : "",
    change: joinWithArrowsOn(
      [action.fromConfiguration || "", action.toConfiguration || ""].filter(
        (part: string): boolean => {
          return part.length > 0;
        },
      ),
      translator.language,
    ),
  };
}

// Who asked or made it: a person, an AI rule, the defaults, a schedule.
export function getCloudSavingsByWhom(
  action: CloudSavingsAction,
  translator: Translator,
): string {
  if (action.origin === CloudSavingsActionOrigin.Schedule) {
    return translator.translateText(MADE_BY_SCHEDULE) || MADE_BY_SCHEDULE;
  }

  const person: string =
    action.approvedByUser?.name?.toString() ||
    action.approvedByUser?.email?.toString() ||
    action.requestedByUser?.name?.toString() ||
    action.requestedByUser?.email?.toString() ||
    "";

  if (person) {
    return person;
  }

  return action.autoRemediationRuleName
    ? translator.translateTemplate(ASKED_BY_RULE, {
        rule: action.autoRemediationRuleName,
      })
    : translator.translateText(ASKED_BY_DEFAULTS) || ASKED_BY_DEFAULTS;
}

// The change and its resource: the first column of both cards.
const ChangeCell: FunctionComponent<{ action: CloudSavingsAction }> = (props: {
  action: CloudSavingsAction;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const line: { title: string; change: string } = getCloudSavingsChangeLine(
    props.action,
    translator,
  );
  const resource: string =
    props.action.resourceName || props.action.resourceId || "";

  return (
    <div className="min-w-0" data-testid="cloud-savings-action-row">
      <div className="break-words text-sm font-medium text-gray-900">
        {line.title}
      </div>
      {line.change ? (
        <div className="mt-0.5 break-words text-xs text-gray-500">
          {line.change}
        </div>
      ) : (
        <></>
      )}
      {resource ? (
        <div className="mt-0.5 text-xs">
          {props.action.cloudResourceId ? (
            <AppLink
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.CLOUD_RESOURCE_VIEW] as Route,
                {
                  modelId: new ObjectID(
                    props.action.cloudResourceId.toString(),
                  ),
                },
              )}
              className="text-indigo-600 hover:text-indigo-700"
            >
              <bdi className="break-all">{resource}</bdi>
            </AppLink>
          ) : (
            <bdi className="break-all text-gray-500">{resource}</bdi>
          )}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

// What the bill showed a change saved, or where it is in reading it.
export const MeasurementCell: FunctionComponent<{
  action: CloudSavingsAction;
}> = (props: { action: CloudSavingsAction }): ReactElement => {
  const translator: Translator = useTranslator();
  const action: CloudSavingsAction = props.action;
  const money: (amount: number) => string = (amount: number): string => {
    return formatCloudMoney({
      amount,
      currency: action.currency || "USD",
      translator,
    });
  };

  if (action.measurement === CloudSavingsMeasurement.Realised) {
    return (
      <span
        className="text-sm font-semibold tabular-nums text-emerald-700"
        data-testid="cloud-savings-realised"
      >
        <bdi>
          {translator.translateTemplate(REALISED_A_MONTH, {
            amount: money(Number(action.realisedMonthlySavings) || 0),
          })}
        </bdi>
      </span>
    );
  }

  return (
    <div className="text-sm">
      <div className="tabular-nums text-gray-900">
        <bdi>
          {translator.translateTemplate(SAVES_A_MONTH, {
            amount: money(Number(action.monthlySavings) || 0),
          })}
        </bdi>
      </div>
      {action.measurement ? (
        <div
          className={
            action.measurement === CloudSavingsMeasurement.NotSeen
              ? "text-xs text-amber-700"
              : "text-xs text-gray-500"
          }
        >
          {translator.translateText(
            CLOUD_SAVINGS_MEASUREMENT_LABELS[action.measurement],
          )}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export interface CloudSavingsActionDialogs {
  approve: (action: CloudSavingsAction) => void;
  dismiss: (action: CloudSavingsAction) => void;
  undo: (action: CloudSavingsAction) => void;
  dialogs: ReactElement;
}

// Approve, Dismiss and Undo, each asked first: one press at a time.
export function useCloudSavingsActionDialogs(
  onChanged: () => void,
): CloudSavingsActionDialogs {
  const translator: Translator = useTranslator();
  const [approving, setApproving] = useState<CloudSavingsAction | null>(null);
  const [dismissing, setDismissing] = useState<CloudSavingsAction | null>(null);
  const [undoing, setUndoing] = useState<CloudSavingsAction | null>(null);
  const [error, setError] = useState<string>("");
  const [isActing, setIsActing] = useState<boolean>(false);

  const close: () => void = (): void => {
    setApproving(null);
    setDismissing(null);
    setUndoing(null);
    setError("");
  };

  const act: (
    press: () => Promise<CloudSavingsActionResult>,
    done: string,
  ) => Promise<void> = async (
    press: () => Promise<CloudSavingsActionResult>,
    done: string,
  ): Promise<void> => {
    if (isActing) {
      return;
    }

    setIsActing(true);
    setError("");

    try {
      const result: CloudSavingsActionResult = await press();

      if (result.status === CloudSavingsActionStatus.Failed) {
        setError(result.summary || "");
        onChanged();
      } else {
        Toast.success(
          translator.translateText(
            result.waitsForSecondApproval
              ? FIRST_APPROVAL_TOAST
              : result.status === CloudSavingsActionStatus.Applying ||
                  result.status === CloudSavingsActionStatus.Undoing
                ? UNDER_WAY_TOAST
                : done,
          ) || done,
        );
        close();
        onChanged();
      }
    } catch (caught) {
      setError(API.getFriendlyMessage(caught));
    }

    setIsActing(false);
  };

  const describe: (action: CloudSavingsAction) => ReactElement = (
    action: CloudSavingsAction,
  ): ReactElement => {
    const kind: CloudSavingsActionKind = action.kind!;

    return (
      <div className="space-y-2 text-sm text-gray-700">
        <p>
          {translator.translateTemplate(CLOUD_SAVINGS_ACTION_SENTENCES[kind], {
            resource: action.resourceName || action.resourceId || "",
            from: action.fromConfiguration || "",
            to: action.toConfiguration || "",
          })}
        </p>
        <p className="text-gray-500">
          {translator.translateText(
            CLOUD_SAVINGS_UNDO_SENTENCES[
              action.undo || CloudSavingsActionUndo.Never
            ],
          )}
        </p>
      </div>
    );
  };

  const dialogs: ReactElement = (
    <>
      {approving?._id ? (
        <ConfirmModal
          title={APPROVE_TITLE}
          description={describe(approving)}
          submitButtonText={APPROVE}
          isLoading={isActing}
          error={error || undefined}
          onClose={close}
          onSubmit={() => {
            void act(async (): Promise<CloudSavingsActionResult> => {
              return await CloudSavingsApi.approve(
                new ObjectID(approving._id!.toString()),
              );
            }, APPROVED_TOAST);
          }}
        />
      ) : (
        <></>
      )}

      {dismissing?._id ? (
        <BasicFormModal<JSONObject>
          title={DISMISS_TITLE}
          description={DISMISS_DESCRIPTION}
          submitButtonText={DISMISS}
          isSubmitting={isActing}
          error={error || undefined}
          onClose={close}
          formProps={{
            name: "Dismiss savings change",
            initialValues: {},
            fields: [
              {
                field: { reason: true },
                title: DISMISS_REASON,
                fieldType: FormFieldSchemaType.LongText,
                placeholder: DISMISS_REASON_PLACEHOLDER,
                required: true,
              },
            ],
          }}
          onSubmit={async (values: FormValues<JSONObject>) => {
            await act(async (): Promise<CloudSavingsActionResult> => {
              return await CloudSavingsApi.dismiss(
                new ObjectID(dismissing._id!.toString()),
                String((values as JSONObject)["reason"] || ""),
              );
            }, DISMISSED_TOAST);
          }}
        />
      ) : (
        <></>
      )}

      {undoing?._id ? (
        <ConfirmModal
          title={UNDO_TITLE}
          description={translator.translateTemplate(
            CLOUD_SAVINGS_UNDO_ACTION_SENTENCES[undoing.kind!],
            {
              resource: undoing.resourceName || undoing.resourceId || "",
              from: undoing.fromConfiguration || "",
            },
          )}
          submitButtonText={UNDO}
          isLoading={isActing}
          error={error || undefined}
          onClose={close}
          onSubmit={() => {
            void act(async (): Promise<CloudSavingsActionResult> => {
              return await CloudSavingsApi.undo(
                new ObjectID(undoing._id!.toString()),
              );
            }, UNDONE_TOAST);
          }}
        />
      ) : (
        <></>
      )}
    </>
  );

  return {
    approve: (action: CloudSavingsAction): void => {
      close();
      setApproving(action);
    },
    dismiss: (action: CloudSavingsAction): void => {
      close();
      setDismissing(action);
    },
    undo: (action: CloudSavingsAction): void => {
      close();
      setUndoing(action);
    },
    dialogs,
  };
}

export interface CardProps {
  // A list's refresh: pressed after a change.
  refreshToggle: string;
  dialogs: CloudSavingsActionDialogs;
  // One account's; every account's when absent.
  cloudAccountId?: ObjectID | undefined;
}

// Waiting for approval: Approve and Dismiss on each.
export const CloudSavingsWaitingCard: FunctionComponent<CardProps> = (
  props: CardProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <ModelTable<CloudSavingsAction>
      modelType={CloudSavingsAction}
      id="cloud-savings-waiting"
      userPreferencesKey="cloud-savings-waiting"
      name="Cloud > Savings > Waiting for approval"
      query={{
        status: CloudSavingsActionStatus.Proposed,
        ...(props.cloudAccountId
          ? { cloudAccountId: props.cloudAccountId }
          : {}),
      }}
      refreshToggle={props.refreshToggle}
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      isViewable={false}
      showRefreshButton={true}
      filters={[]}
      sortBy="monthlySavings"
      sortOrder={SortOrder.Descending}
      cardProps={{ title: WAITING_TITLE, description: WAITING_DESCRIPTION }}
      noItemsMessage={WAITING_EMPTY}
      selectMoreFields={CLOUD_SAVINGS_ACTION_ROW_SELECT}
      actionButtons={[
        {
          title: APPROVE,
          icon: IconProp.Check,
          buttonStyleType: ButtonStyleType.NORMAL,
          placement: ActionButtonPlacement.Primary,
          onClick: (
            item: CloudSavingsAction,
            onCompleteAction: VoidFunction,
          ) => {
            props.dialogs.approve(item);
            onCompleteAction();
          },
        },
        {
          title: DISMISS,
          icon: IconProp.Close,
          buttonStyleType: ButtonStyleType.NORMAL,
          onClick: (
            item: CloudSavingsAction,
            onCompleteAction: VoidFunction,
          ) => {
            props.dialogs.dismiss(item);
            onCompleteAction();
          },
        },
      ]}
      columns={[
        {
          field: { kind: true },
          title: "Change",
          type: FieldType.Element,
          isNotCustomizable: true,
          wrapContent: true,
          getElement: (item: CloudSavingsAction): ReactElement => {
            return <ChangeCell action={item} />;
          },
        },
        {
          field: { monthlySavings: true },
          title: "Saves",
          type: FieldType.Element,
          getElement: (item: CloudSavingsAction): ReactElement => {
            return (
              <span className="text-sm font-semibold tabular-nums text-emerald-700">
                <bdi>
                  {translator.translateTemplate(SAVES_A_MONTH, {
                    amount: formatCloudMoney({
                      amount: Number(item.monthlySavings) || 0,
                      currency: item.currency || "USD",
                      translator,
                    }),
                  })}
                </bdi>
              </span>
            );
          },
        },
        {
          field: { environment: true },
          title: "Environment",
          type: FieldType.Element,
          hideOnMobile: true,
          getElement: (item: CloudSavingsAction): ReactElement => {
            const environment: CloudResourceEnvironment =
              item.environment || CloudResourceEnvironment.Unknown;

            return (
              <Pill
                text={CLOUD_RESOURCE_ENVIRONMENT_LABELS[environment]}
                tone={getEnvironmentTone(environment)}
              />
            );
          },
        },
        {
          field: { origin: true },
          title: "Asked By",
          type: FieldType.Element,
          hideOnMobile: true,
          getElement: (item: CloudSavingsAction): ReactElement => {
            return (
              <span className="text-sm text-gray-700">
                <bdi>{getCloudSavingsByWhom(item, translator)}</bdi>
              </span>
            );
          },
        },
      ]}
    />
  );
};

// Changes made: Undo where a change can be undone.
export const CloudSavingsChangesCard: FunctionComponent<CardProps> = (
  props: CardProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <ModelTable<CloudSavingsAction>
      modelType={CloudSavingsAction}
      id="cloud-savings-changes"
      userPreferencesKey="cloud-savings-changes"
      name="Cloud > Savings > Changes made"
      query={{
        status: new IncludesNone([CloudSavingsActionStatus.Proposed]),
        origin: new NotEqual(CloudSavingsActionOrigin.Schedule),
        ...(props.cloudAccountId
          ? { cloudAccountId: props.cloudAccountId }
          : {}),
      }}
      refreshToggle={props.refreshToggle}
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      isViewable={false}
      showRefreshButton={true}
      filters={[]}
      sortBy="createdAt"
      sortOrder={SortOrder.Descending}
      cardProps={{ title: CHANGES_TITLE, description: CHANGES_DESCRIPTION }}
      noItemsMessage={CHANGES_EMPTY}
      selectMoreFields={CLOUD_SAVINGS_ACTION_ROW_SELECT}
      actionButtons={[
        {
          title: UNDO,
          icon: IconProp.ArrowUturnLeft,
          buttonStyleType: ButtonStyleType.NORMAL,
          placement: ActionButtonPlacement.Primary,
          isVisible: (item: CloudSavingsAction): boolean => {
            return (
              isCloudSavingsActionInEffect(item.status) &&
              item.undo !== CloudSavingsActionUndo.Never
            );
          },
          onClick: (
            item: CloudSavingsAction,
            onCompleteAction: VoidFunction,
          ) => {
            props.dialogs.undo(item);
            onCompleteAction();
          },
        },
      ]}
      columns={[
        {
          field: { kind: true },
          title: "Change",
          type: FieldType.Element,
          isNotCustomizable: true,
          wrapContent: true,
          getElement: (item: CloudSavingsAction): ReactElement => {
            return <ChangeCell action={item} />;
          },
        },
        {
          field: { status: true },
          title: "Status",
          type: FieldType.Element,
          getElement: (item: CloudSavingsAction): ReactElement => {
            const status: CloudSavingsActionStatus =
              item.status || CloudSavingsActionStatus.Applying;
            const why: string =
              status === CloudSavingsActionStatus.Failed
                ? item.failureMessage || ""
                : "";

            return (
              <div className="min-w-0">
                <Pill
                  text={CLOUD_SAVINGS_ACTION_STATUS_LABELS[status]}
                  tone={CLOUD_SAVINGS_STATUS_TONES[status]}
                />
                {why ? (
                  <div className="mt-1 break-words text-xs text-red-700">
                    <bdi>{why}</bdi>
                  </div>
                ) : (
                  <></>
                )}
              </div>
            );
          },
        },
        {
          field: { realisedMonthlySavings: true },
          title: "Saved",
          type: FieldType.Element,
          getElement: (item: CloudSavingsAction): ReactElement => {
            return <MeasurementCell action={item} />;
          },
        },
        {
          field: { origin: true },
          title: "Approved By",
          type: FieldType.Element,
          hideOnMobile: true,
          getElement: (item: CloudSavingsAction): ReactElement => {
            return (
              <span className="text-sm text-gray-700">
                <bdi>{getCloudSavingsByWhom(item, translator)}</bdi>
              </span>
            );
          },
        },
        {
          field: { appliedAt: true },
          title: "Made",
          type: FieldType.DateTime,
          hideOnMobile: true,
        },
      ]}
    />
  );
};
