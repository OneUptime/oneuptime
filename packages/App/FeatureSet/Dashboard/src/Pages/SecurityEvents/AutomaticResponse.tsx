import PageComponentProps from "../PageComponentProps";
import ResellerPlanNotice from "../../Components/Billing/ResellerPlanNotice";
import {
  deleteOwnPolicy,
  readAutomaticResponseOverview,
  setAutomaticResponseMode,
} from "../../Components/SecurityEvents/AutomaticResponse/AutomaticResponseApi";
import {
  AUTOMATIC_RESPONSE_TEST_IDS,
  CREATE_POLICY,
  LIMIT_REACHED,
  OWN_POLICIES_DESCRIPTION,
  OWN_POLICIES_TITLE,
  POLICY_DELETE_DESCRIPTION,
  READ_FAILED,
  TRIAL_STARTED_TOAST,
  TURNED_OFF_TOAST,
  TURNED_ON_TOAST,
  TURN_ON,
  TURN_ON_WITHOUT_TRIAL,
  TURN_ON_WITHOUT_TRIAL_QUESTION,
} from "../../Components/SecurityEvents/AutomaticResponse/AutomaticResponseCopy";
import { getPolicyDisplayName } from "../../Components/SecurityEvents/AutomaticResponse/AutomaticResponseModel";
import AutomaticResponsePolicyCard from "../../Components/SecurityEvents/AutomaticResponse/AutomaticResponsePolicyCard";
import AutomaticResponsePolicyModal from "../../Components/SecurityEvents/AutomaticResponse/AutomaticResponsePolicyModal";
import BlocklistNotEnforcedNotice from "../../Components/SecurityEvents/Blocklist/BlocklistNotEnforcedNotice";
import SecurityAutomaticResponsePolicy from "Common/Models/DatabaseModels/SecurityAutomaticResponsePolicy";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import {
  SecurityAutomaticResponseOverviewData,
  SecurityAutomaticResponseOverviewPolicy,
} from "Common/Types/SecurityAutomaticResponse/SecurityAutomaticResponseOverview";
import {
  SecurityAutomaticResponseMode,
  SecurityAutomaticResponsePolicyKind,
} from "Common/Types/SecurityAutomaticResponse/SecurityAutomaticResponsePolicy";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import CardListSkeleton from "Common/UI/Components/Skeleton/CardListSkeleton";
import { DELETE_QUESTION_TEMPLATE } from "Common/UI/Components/DeleteConfirmation/DeleteConfirmationMessage";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import API from "Common/UI/Utils/API/API";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import Toast, { ITEM_DELETED } from "Common/UI/Utils/Toast";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * SECURITY EVENTS > PLAYBOOKS > AUTOMATIC RESPONSE (#10350): the policies
 * that challenge or block an attacking address as the detection is made,
 * before anybody triages the case - three ready ones (Scanners, Password
 * Guessing, Known-Bad Addresses), each off until someone turns it on and
 * each starting with a week of trial run, and the project's own, made from
 * the blank one. Each card says whether it is on, where its trial run
 * stands and what it would have done, what it acts on, its guardrails and
 * its time to block (Components/SecurityEvents/AutomaticResponse).
 *
 * Above them, only when it is so: that nothing enforces the blocklist (a
 * policy's block would hold nowhere), and that the hour's automatic blocks
 * are used up, so the policies stopped and paged the security owners.
 */
const SecurityAutomaticResponsePage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [overview, setOverview] =
    useState<SecurityAutomaticResponseOverviewData | null>(null);
  const [isReadFailed, setIsReadFailed] = useState<boolean>(false);
  const [refreshCount, setRefreshCount] = useState<number>(0);
  const [savingPolicyId, setSavingPolicyId] = useState<string | null>(null);
  // The policy the dialog makes or changes: null for a new one; undefined while it is closed.
  const [editing, setEditing] = useState<
    SecurityAutomaticResponseOverviewPolicy | null | undefined
  >(undefined);
  const [skipping, setSkipping] =
    useState<SecurityAutomaticResponseOverviewPolicy | null>(null);
  const [deleting, setDeleting] =
    useState<SecurityAutomaticResponseOverviewPolicy | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const refresh: () => void = (): void => {
    setRefreshCount((count: number): number => {
      return count + 1;
    });
  };

  useEffect(() => {
    let isCurrent: boolean = true;

    readAutomaticResponseOverview()
      .then((read: SecurityAutomaticResponseOverviewData) => {
        if (isCurrent) {
          setOverview(read);
          setIsReadFailed(false);
        }
      })
      .catch(() => {
        if (isCurrent) {
          setIsReadFailed(true);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [refreshCount]);

  // Same reseller-telemetry gate as every other Security Events page.
  if (props.currentProject?.reseller?.enableTelemetryFeatures === false) {
    return (
      <ResellerPlanNotice
        project={props.currentProject}
        product="Security Events"
      />
    );
  }

  const gate: PermissionGateResult = PermissionGate.check(
    new SecurityAutomaticResponsePolicy(),
    ModelAction.Update,
  );
  const canCreate: boolean = PermissionGate.check(
    new SecurityAutomaticResponsePolicy(),
    ModelAction.Create,
  ).isAllowed;

  const setMode: (
    policy: SecurityAutomaticResponseOverviewPolicy,
    mode: SecurityAutomaticResponseMode,
  ) => Promise<boolean> = async (
    policy: SecurityAutomaticResponseOverviewPolicy,
    mode: SecurityAutomaticResponseMode,
  ): Promise<boolean> => {
    const name: string = getPolicyDisplayName(policy, translator);

    setSavingPolicyId(policy.id);

    try {
      await setAutomaticResponseMode({ policyId: policy.id, mode });

      Toast.success(
        translator.translateTemplate(
          mode === SecurityAutomaticResponseMode.TrialRun
            ? TRIAL_STARTED_TOAST
            : mode === SecurityAutomaticResponseMode.On
              ? TURNED_ON_TOAST
              : TURNED_OFF_TOAST,
          { name },
        ),
      );
      refresh();
      return true;
    } catch (error) {
      Toast.error(API.getFriendlyMessage(error));
      return false;
    } finally {
      setSavingPolicyId(null);
    }
  };

  const getContent: () => ReactElement = (): ReactElement => {
    if (!overview) {
      return isReadFailed ? (
        <div data-testid={AUTOMATIC_RESPONSE_TEST_IDS.readFailed}>
          <ErrorMessage message={READ_FAILED} onRefreshClick={refresh} />
        </div>
      ) : (
        // The three ready policies' cards, as they load.
        <CardListSkeleton count={3} lines={3} />
      );
    }

    const now: Date = OneUptimeDate.getCurrentDate();
    const isAtLimit: boolean =
      overview.blocksThisHour >= overview.maxBlocksPerHour;

    return (
      <>
        {overview.destinations.length === 0 ? (
          <BlocklistNotEnforcedNotice
            cannotTell={overview.destinationsCannotTell}
          />
        ) : (
          <></>
        )}

        {isAtLimit ? (
          <Alert
            type={AlertType.WARNING}
            className="mb-5"
            dataTestId={AUTOMATIC_RESPONSE_TEST_IDS.limitNotice}
            title={translator.translatePlural(
              LIMIT_REACHED,
              overview.blocksThisHour,
            )}
          />
        ) : (
          <></>
        )}

        <div className="space-y-5">
          {overview.policies.map(
            (policy: SecurityAutomaticResponseOverviewPolicy): ReactElement => {
              const isOwn: boolean =
                policy.kind === SecurityAutomaticResponsePolicyKind.Custom;

              return (
                <AutomaticResponsePolicyCard
                  key={policy.id}
                  policy={policy}
                  destinations={overview.destinations}
                  maxBlocksPerHour={overview.maxBlocksPerHour}
                  canChange={gate.isAllowed}
                  changeRefusal={gate.disabledReason}
                  isSaving={savingPolicyId === policy.id}
                  now={now}
                  onSetMode={(mode: SecurityAutomaticResponseMode) => {
                    void setMode(policy, mode);
                  }}
                  onTurnOnWithoutTrial={() => {
                    setDialogError(null);
                    setSkipping(policy);
                  }}
                  onEdit={
                    isOwn
                      ? () => {
                          setEditing(policy);
                        }
                      : undefined
                  }
                  onDelete={
                    isOwn
                      ? () => {
                          setDialogError(null);
                          setDeleting(policy);
                        }
                      : undefined
                  }
                />
              );
            },
          )}

          {canCreate ? (
            <Card
              id={AUTOMATIC_RESPONSE_TEST_IDS.createPolicy}
              title={OWN_POLICIES_TITLE}
              description={OWN_POLICIES_DESCRIPTION}
              buttons={[
                {
                  title: CREATE_POLICY,
                  icon: IconProp.Add,
                  buttonStyle: ButtonStyleType.NORMAL,
                  onClick: () => {
                    setEditing(null);
                  },
                },
              ]}
            />
          ) : (
            <></>
          )}
        </div>
      </>
    );
  };

  return (
    <div data-testid={AUTOMATIC_RESPONSE_TEST_IDS.page}>
      {getContent()}

      {editing !== undefined ? (
        <AutomaticResponsePolicyModal
          policy={editing}
          onClose={() => {
            setEditing(undefined);
          }}
          onSaved={() => {
            setEditing(undefined);
            refresh();
          }}
        />
      ) : (
        <></>
      )}

      {skipping ? (
        <ConfirmModal
          title={TURN_ON_WITHOUT_TRIAL}
          description={translator.translateTemplate(
            TURN_ON_WITHOUT_TRIAL_QUESTION,
            { name: getPolicyDisplayName(skipping, translator) },
          )}
          submitButtonText={TURN_ON}
          isLoading={savingPolicyId === skipping.id}
          error={dialogError || undefined}
          onClose={() => {
            setSkipping(null);
          }}
          onSubmit={async () => {
            if (await setMode(skipping, SecurityAutomaticResponseMode.On)) {
              setSkipping(null);
            }
          }}
        />
      ) : (
        <></>
      )}

      {deleting ? (
        <ConfirmModal
          title="Delete Policy"
          description={
            <div className="space-y-2">
              <p>
                {translator.translateTemplate(DELETE_QUESTION_TEMPLATE, {
                  name: deleting.name,
                })}
              </p>
              <p>{translator.translateText(POLICY_DELETE_DESCRIPTION)}</p>
            </div>
          }
          submitButtonText="Delete Policy"
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={savingPolicyId === deleting.id}
          error={dialogError || undefined}
          onClose={() => {
            setDeleting(null);
          }}
          onSubmit={async () => {
            setSavingPolicyId(deleting.id);
            setDialogError(null);

            try {
              await deleteOwnPolicy(deleting.id);
              Toast.success(
                translator.translateTemplate(ITEM_DELETED, {
                  itemName: deleting.name,
                }),
              );
              setDeleting(null);
              refresh();
            } catch (error) {
              setDialogError(API.getFriendlyMessage(error));
            } finally {
              setSavingPolicyId(null);
            }
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default SecurityAutomaticResponsePage;
