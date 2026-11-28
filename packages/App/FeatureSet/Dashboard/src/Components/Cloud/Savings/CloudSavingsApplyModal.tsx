import Route from "Common/Types/API/Route";
import {
  CLOUD_RESOURCE_ENVIRONMENT_LABELS,
  CloudEnvironmentSource,
  CloudResourceEnvironment,
  isNonProductionOnlyByLabels,
} from "Common/Types/Cloud/CloudResourceEnvironment";
import {
  CLOUD_SAVINGS_ACTION_SENTENCES,
  CLOUD_SAVINGS_ACTION_TITLES,
  CLOUD_SAVINGS_NOT_OFFERED_SENTENCES,
  CLOUD_SAVINGS_UNDO_SENTENCES,
  CloudSavingsActionStatus,
  CloudSavingsActionUndo,
} from "Common/Types/Cloud/CloudSavingsAction";
import {
  CloudSavingsActionResult,
  CloudSavingsConnectionState,
  CloudSavingsFixInCodeResult,
  CloudSavingsOffer,
  CloudSavingsPerson,
  CloudSavingsTeam,
} from "Common/Types/Cloud/CloudSavingsApiTypes";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import API from "Common/UI/Utils/API/API";
import Toast from "Common/UI/Utils/Toast";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import AppLink from "../../AppLink/AppLink";
import { formatCloudMoney } from "../CloudCostWords";
import CloudSavingsApi from "./CloudSavingsApi";

/*
 * APPLY, ON A SAVING (#11010): the one dialog between a saving and a change
 * in a customer's cloud.
 *
 * It says, before anything happens, what changes ("Deletes vol-0abc, which
 * nothing is attached to."), what it saves a month, whether it can be
 * undone, whether the resource is production, and who approves it - its
 * owners, or the project's admins for a resource nobody owns - and whether
 * that is the reader, in which case it runs at once, as them. A disk is
 * deleted after a final snapshot unless the reader switches it off.
 *
 * A resource declared in infrastructure code gets a pull request first,
 * since the next deploy would undo a change made in the console; applying
 * in the cloud stays one press away. A saving OneUptime cannot make from
 * here, or one its connection does not allow, says why and what to do
 * instead - a commitment links to its cloud's purchase page.
 */

export const APPLY_SAVES: string = translationKey("Saves {{amount}} a month");
export const APPLY_PRODUCTION: string = translationKey(
  "This resource is production: an owner approves every change to it, and no AI rule makes one.",
);
/*
 * Only a label calls it non-production (#11347): you may still apply, but
 * nothing that acts with nobody asked reads a label so.
 */
export const APPLY_ONLY_LABELS: string = translationKey(
  "Only its labels say it is not production, so no off-hours schedule stops it and no AI rule changes it without asking. Tag it in your cloud, or mark its account non-production.",
);
export const APPLY_ENVIRONMENT_FROM: Readonly<
  Record<CloudEnvironmentSource, string>
> = {
  [CloudEnvironmentSource.Tag]: translationKey("from its environment tag"),
  [CloudEnvironmentSource.Account]: translationKey("from its account"),
  [CloudEnvironmentSource.Label]: translationKey("from its labels"),
  [CloudEnvironmentSource.None]: translationKey(
    "nothing says, so it is treated as production",
  ),
};
export const APPLY_OWNERS_APPROVE: string = translationKey(
  "Its owners approve it: {{owners}}.",
);
export const APPLY_ADMINS_APPROVE: string = translationKey(
  "Nobody owns this resource, so a Project Owner or Project Admin approves it.",
);
export const APPLY_YOU_APPROVE: string = translationKey(
  "You can approve it, so it runs as soon as you apply it.",
);
export const APPLY_WAITS: string = translationKey(
  "It waits on Cloud > Savings for an owner to approve it.",
);
export const APPLY_TWO_APPROVALS: string = translationKey(
  "It cannot be undone, so two people approve it: your approval is the first.",
);
export const APPLY_FINAL_SNAPSHOT: string = translationKey(
  "Take a final snapshot first",
);
export const APPLY_FINAL_SNAPSHOT_DESCRIPTION: string = translationKey(
  "The disk can be made again from it. A snapshot costs a fraction of the disk.",
);
export const APPLY_FINAL_SNAPSHOT_ALWAYS: string = translationKey(
  "A final snapshot is taken first, and the disk can be made again from it.",
);
export const APPLY_DECLARED_IN_CODE: string = translationKey(
  "Declared in {{tool}}: change it in code, or the next deploy puts it back. OneUptime AI opens a pull request in {{repository}}.",
);
export const APPLY_DECLARED_IN_CODE_NO_REPOSITORY: string = translationKey(
  "Declared in {{tool}}: change it in code, or the next deploy puts it back. Connect the repository that declares it to open a pull request from here.",
);
export const APPLY_CONNECTION_STATES: Readonly<
  Record<CloudSavingsConnectionState, string>
> = {
  [CloudSavingsConnectionState.Ready]: "",
  [CloudSavingsConnectionState.NoConnection]: translationKey(
    "This account was found through no cloud connection, so OneUptime cannot change it.",
  ),
  [CloudSavingsConnectionState.ConnectionOff]: translationKey(
    "The account's cloud connection is gone or turned off, so OneUptime cannot change it.",
  ),
  [CloudSavingsConnectionState.SavingsActionsOff]: translationKey(
    "Turn on Savings actions on the account's cloud connection and run its updated setup command. It adds only the access these changes need.",
  ),
  [CloudSavingsConnectionState.ResizeNotGranted]: translationKey(
    "Resizing restarts the resource, so it is granted on its own: set the connection's Savings actions to resize too, and run its updated setup command.",
  ),
};
export const APPLY_ALREADY_OPEN: string = translationKey(
  "This change is already waiting for approval or under way. Its card is on Cloud > Savings.",
);
export const APPLY_BUY_IN_CONSOLE: string = translationKey(
  "Buy It in Your Cloud's Console",
);
export const APPLY_OPEN_CONNECTIONS: string = translationKey(
  "Open Cloud Connections",
);
export const APPLY_BUTTON: string = translationKey("Apply");
export const APPLY_ASK_BUTTON: string = translationKey("Ask for Approval");
export const APPLY_PULL_REQUEST_BUTTON: string =
  translationKey("Open Pull Request");
export const APPLY_IN_CLOUD_BUTTON: string = translationKey(
  "Apply in the Cloud Instead",
);
export const APPLY_DONE: string = translationKey(
  "Done. It is on the resource's timeline, with how to undo it.",
);
export const APPLY_UNDER_WAY: string = translationKey(
  "Under way: it takes a few minutes. Cloud > Savings shows when it is done.",
);
export const APPLY_ASKED: string = translationKey(
  "Asked the owners to approve it.",
);
export const APPLY_FIRST_APPROVAL: string = translationKey(
  "Your approval is recorded. A second person's is needed.",
);
export const APPLY_PULL_REQUEST_STARTED: string = translationKey(
  "OneUptime AI is opening a pull request in {{repository}}.",
);
export const APPLY_LOAD_FAILED: string = translationKey(
  "What this change would do could not be read.",
);

export interface ComponentProps {
  cloudCostRecommendationId: ObjectID;
  onClose: () => void;
  // After something changed: the lists refresh.
  onDone: () => void;
}

// "Alice, Bob and Team Search": who approves, as one list.
function getApproverList(
  people: Array<CloudSavingsPerson>,
  teams: Array<CloudSavingsTeam>,
): string {
  return [
    ...people.map((person: CloudSavingsPerson): string => {
      return person.name;
    }),
    ...teams.map((team: CloudSavingsTeam): string => {
      return team.name;
    }),
  ]
    .filter(Boolean)
    .join(", ");
}

export function getEnvironmentTone(
  environment: CloudResourceEnvironment,
): PillTone {
  switch (environment) {
    case CloudResourceEnvironment.Production:
      return PillTone.Warning;
    case CloudResourceEnvironment.NonProduction:
      return PillTone.Info;
    default:
      return PillTone.Neutral;
  }
}

const CloudSavingsApplyModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [offer, setOffer] = useState<CloudSavingsOffer | null>(null);
  const [loadError, setLoadError] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [isWorking, setIsWorking] = useState<boolean>(false);
  const [finalSnapshot, setFinalSnapshot] = useState<boolean>(true);

  useEffect(() => {
    let ignore: boolean = false;

    CloudSavingsApi.getOffer(props.cloudCostRecommendationId)
      .then((found: CloudSavingsOffer): void => {
        if (!ignore) {
          setOffer(found);
        }
      })
      .catch((err: Error): void => {
        if (!ignore) {
          setLoadError(API.getFriendlyMessage(err));
        }
      });

    return (): void => {
      ignore = true;
    };
  }, [props.cloudCostRecommendationId.toString()]);

  const money: (amount: number) => string = (amount: number): string => {
    return formatCloudMoney({
      amount,
      currency: offer?.currency || "USD",
      translator,
    });
  };

  const isReady: boolean = Boolean(
    offer &&
      offer.kind &&
      offer.connectionState === CloudSavingsConnectionState.Ready &&
      offer.canRequest &&
      !offer.openActionId,
  );
  const declared: boolean = Boolean(isReady && offer?.declaredInCode);
  const canOpenPullRequest: boolean = Boolean(
    declared && offer?.declaredInCode?.codeRepositoryId,
  );

  const apply: () => Promise<void> = async (): Promise<void> => {
    if (!offer) {
      return;
    }

    setIsWorking(true);
    setError("");

    try {
      const result: CloudSavingsActionResult = await CloudSavingsApi.apply({
        cloudCostRecommendationId: props.cloudCostRecommendationId,
        finalSnapshot,
      });

      if (result.status === CloudSavingsActionStatus.Failed) {
        setError(result.summary || "");
        setIsWorking(false);
        props.onDone();
        return;
      }

      Toast.success(
        result.waitsForSecondApproval
          ? translator.translateText(APPLY_FIRST_APPROVAL) ||
              APPLY_FIRST_APPROVAL
          : result.status === CloudSavingsActionStatus.Proposed
            ? translator.translateText(APPLY_ASKED) || APPLY_ASKED
            : result.status === CloudSavingsActionStatus.Applying
              ? translator.translateText(APPLY_UNDER_WAY) || APPLY_UNDER_WAY
              : translator.translateText(APPLY_DONE) || APPLY_DONE,
      );
      props.onDone();
      props.onClose();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setIsWorking(false);
    }
  };

  const openPullRequest: () => Promise<void> = async (): Promise<void> => {
    setIsWorking(true);
    setError("");

    try {
      const result: CloudSavingsFixInCodeResult =
        await CloudSavingsApi.fixInCode({
          cloudCostRecommendationId: props.cloudCostRecommendationId,
        });

      Toast.success(
        translator.translateTemplate(APPLY_PULL_REQUEST_STARTED, {
          repository: result.codeRepositoryName,
        }),
      );
      props.onClose();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setIsWorking(false);
    }
  };

  const title: string =
    offer?.kind !== undefined
      ? CLOUD_SAVINGS_ACTION_TITLES[offer.kind]
      : translationKey("Act on a Saving");

  return (
    <Modal
      title={title}
      description={
        offer ? (
          <bdi className="break-all">
            {[offer.resourceName, offer.region].filter(Boolean).join(" · ")}
          </bdi>
        ) : undefined
      }
      onClose={props.onClose}
      modalWidth={ModalWidth.Medium}
      isBodyLoading={!offer && !loadError}
      isLoading={isWorking}
      error={error || loadError}
      errorWhatFailed={
        loadError
          ? translator.translateText(APPLY_LOAD_FAILED) || APPLY_LOAD_FAILED
          : undefined
      }
      {...(isReady
        ? {
            submitButtonText: canOpenPullRequest
              ? APPLY_PULL_REQUEST_BUTTON
              : offer?.canApprove
                ? APPLY_BUTTON
                : APPLY_ASK_BUTTON,
            submitButtonStyleType: ButtonStyleType.PRIMARY,
            onSubmit: (): void => {
              void (canOpenPullRequest ? openPullRequest() : apply());
            },
            ...(canOpenPullRequest
              ? {
                  secondaryButton: {
                    title: APPLY_IN_CLOUD_BUTTON,
                    onClick: (): void => {
                      void apply();
                    },
                    dataTestId: "cloud-savings-apply-in-cloud",
                  },
                }
              : {}),
          }
        : {})}
    >
      <div className="space-y-4" data-testid="cloud-savings-apply">
        {offer ? (
          <CloudSavingsOfferBody
            offer={offer}
            finalSnapshot={finalSnapshot}
            onFinalSnapshotChange={setFinalSnapshot}
            money={money}
          />
        ) : (
          <></>
        )}
      </div>
    </Modal>
  );
};

export interface OfferBodyProps {
  offer: CloudSavingsOffer;
  finalSnapshot: boolean;
  onFinalSnapshotChange: (value: boolean) => void;
  money: (amount: number) => string;
}

// What the dialog says of a saving: exported for the tests.
export const CloudSavingsOfferBody: FunctionComponent<OfferBodyProps> = (
  props: OfferBodyProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const offer: CloudSavingsOffer = props.offer;

  // A saving OneUptime does not make: why, and where to make it.
  if (!offer.kind) {
    return (
      <div data-testid="cloud-savings-not-offered">
        <p className="text-sm text-gray-700">
          {translator.translateText(
            CLOUD_SAVINGS_NOT_OFFERED_SENTENCES[offer.notOffered!],
          )}
        </p>
        {offer.purchaseUrl ? (
          <a
            href={offer.purchaseUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-block text-sm font-medium text-indigo-600 hover:text-indigo-700"
            data-testid="cloud-savings-purchase-link"
          >
            {translator.translateText(APPLY_BUY_IN_CONSOLE)}
          </a>
        ) : (
          <></>
        )}
      </div>
    );
  }

  const undo: CloudSavingsActionUndo =
    offer.kind && offer.finalSnapshot === "offered" && !props.finalSnapshot
      ? CloudSavingsActionUndo.Never
      : offer.undo || CloudSavingsActionUndo.Never;
  const approvers: string = getApproverList(offer.owners, offer.ownerTeams);

  return (
    <>
      <p
        className="text-sm font-medium text-gray-900"
        data-testid="cloud-savings-apply-sentence"
      >
        {translator.translateTemplate(
          CLOUD_SAVINGS_ACTION_SENTENCES[offer.kind],
          {
            resource: offer.resourceName,
            from: offer.from || "",
            to: offer.to || "",
          },
        )}
      </p>

      <dl className="grid grid-cols-1 gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm sm:grid-cols-2">
        <div>
          <dd
            className="font-semibold tabular-nums text-emerald-700"
            data-testid="cloud-savings-apply-saves"
          >
            {translator.translateTemplate(APPLY_SAVES, {
              amount: props.money(offer.monthlySavings),
            })}
          </dd>
        </div>
        <div>
          <dd
            className={
              undo === CloudSavingsActionUndo.Never
                ? "text-amber-800"
                : "text-gray-700"
            }
            data-testid="cloud-savings-apply-undo"
          >
            {translator.translateText(CLOUD_SAVINGS_UNDO_SENTENCES[undo])}
          </dd>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <Pill
            text={CLOUD_RESOURCE_ENVIRONMENT_LABELS[offer.environment]}
            tone={getEnvironmentTone(offer.environment)}
          />
          <span className="text-xs text-gray-500">
            {translator.translateText(
              APPLY_ENVIRONMENT_FROM[offer.environmentSource],
            )}
          </span>
        </div>
      </dl>

      {offer.environment === CloudResourceEnvironment.Production ? (
        <p className="text-sm text-gray-700">
          {translator.translateText(APPLY_PRODUCTION)}
        </p>
      ) : (
        <></>
      )}

      {isNonProductionOnlyByLabels({
        environment: offer.environment,
        source: offer.environmentSource,
      }) ? (
        <p
          className="text-sm text-gray-700"
          data-testid="cloud-savings-apply-only-labels"
        >
          {translator.translateText(APPLY_ONLY_LABELS)}
        </p>
      ) : (
        <></>
      )}

      {offer.finalSnapshot === "offered" ? (
        <Toggle
          title={APPLY_FINAL_SNAPSHOT}
          description={APPLY_FINAL_SNAPSHOT_DESCRIPTION}
          value={props.finalSnapshot}
          onChange={props.onFinalSnapshotChange}
          dataTestId="cloud-savings-final-snapshot"
        />
      ) : offer.finalSnapshot === "always" ? (
        <p className="text-sm text-gray-700">
          {translator.translateText(APPLY_FINAL_SNAPSHOT_ALWAYS)}
        </p>
      ) : (
        <></>
      )}

      <div
        className="space-y-1 text-sm text-gray-700"
        data-testid="cloud-savings-apply-approvers"
      >
        <p>
          {offer.approvedBy === "owners"
            ? translator.translateTemplate(APPLY_OWNERS_APPROVE, {
                owners: approvers,
              })
            : translator.translateText(APPLY_ADMINS_APPROVE)}
        </p>
        <p className="text-gray-500">
          {translator.translateText(
            offer.needsTwoApprovals && offer.canApprove
              ? APPLY_TWO_APPROVALS
              : offer.canApprove
                ? APPLY_YOU_APPROVE
                : APPLY_WAITS,
          )}
        </p>
      </div>

      {offer.openActionId ? (
        <Alert type={AlertType.INFO} title={APPLY_ALREADY_OPEN} />
      ) : offer.connectionState !== CloudSavingsConnectionState.Ready ? (
        <div data-testid="cloud-savings-connection-state">
          <Alert
            type={AlertType.WARNING}
            title={APPLY_CONNECTION_STATES[offer.connectionState]}
          />
          {offer.cloudConnectionId ? (
            <AppLink
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.CLOUD_CONNECT] as Route,
              )}
              className="mt-2 inline-block text-sm font-medium text-indigo-600 hover:text-indigo-700"
            >
              {translator.translateText(APPLY_OPEN_CONNECTIONS) ||
                APPLY_OPEN_CONNECTIONS}
            </AppLink>
          ) : (
            <></>
          )}
        </div>
      ) : offer.declaredInCode ? (
        <Alert
          type={AlertType.INFO}
          title={translator.translateTemplate(
            offer.declaredInCode.codeRepositoryName
              ? APPLY_DECLARED_IN_CODE
              : APPLY_DECLARED_IN_CODE_NO_REPOSITORY,
            {
              tool: offer.declaredInCode.managedAs,
              repository: offer.declaredInCode.codeRepositoryName || "",
            },
          )}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default CloudSavingsApplyModal;
