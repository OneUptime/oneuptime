import User from "Common/Models/DatabaseModels/User";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import IconProp from "Common/Types/Icon/IconProp";
import { TwoFactorAuthSetup } from "Common/Types/TwoFactorAuthSetup";
import TwoFactorAuthStatus from "Common/Types/TwoFactorAuthStatus";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import UserUtil from "Common/UI/Utils/User";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  describeTwoFactorAuthSetupError,
  TwoFactorAuthSetupState,
  useTwoFactorAuthSetup,
} from "./TwoFactorAuthSetupState";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * THE TWO-FACTOR AUTHENTICATION CARD (issue #9666).
 *
 * It used to switch the setting on whatever stood behind it, so somebody
 * with no authenticator app, security key or passkey could turn it on, and
 * the card said "Enabled" in green over "No security keys added yet". The
 * server refuses that now (Types/TwoFactorAuthSetup), and the card offers
 * only what the server allows, by where the person stands
 * (GET /user/two-factor-auth-status):
 *
 *   - off, with nothing set up: Enable starts setting up a second step
 *     (onStartSetup), and turns it on at the end - nothing is turned on
 *     until the step works;
 *   - off, with a second step ready: Enable asks to confirm, then turns it on;
 *   - on: Turn off asks to confirm, then turns it off;
 *   - on with nothing set up - a master admin's requirement, or an account
 *     switched on before this - says "Setup needed", never "Enabled", and
 *     why it does not protect the account yet: Finish setup, or Turn off.
 */

export const TWO_FACTOR_STATUS_COPY: {
  enabled: string;
  notEnabled: string;
  setupNeeded: string;
  notEnabledWithNothing: string;
  notEnabledWithASecondStep: string;
  enabledWithASecondStep: string;
  setupNeededExplanation: string;
  enableAction: string;
  turnOffAction: string;
  finishSetupAction: string;
  enableQuestion: string;
  enableDescription: string;
} = {
  enabled: translationKey("Enabled"),
  notEnabled: translationKey("Not enabled"),
  setupNeeded: translationKey("Setup needed"),
  notEnabledWithNothing: translationKey(
    "Turn it on to set up an authenticator app or a security key as the second step of your sign-in.",
  ),
  notEnabledWithASecondStep: translationKey(
    "Your second step is ready. Turn on two-factor authentication to ask for it each time you sign in with a password.",
  ),
  enabledWithASecondStep: translationKey(
    "Use an authenticator app or security key for your second step.",
  ),
  setupNeededExplanation: translationKey(
    "Two-factor authentication is on, but no second step is set up yet, so it does not protect your account. Set one up now, or you will be asked to at your next sign-in.",
  ),
  enableAction: translationKey("Enable two-factor authentication"),
  turnOffAction: translationKey("Turn off two-factor authentication"),
  finishSetupAction: translationKey("Finish setup"),
  enableQuestion: translationKey("Enable two-factor authentication?"),
  enableDescription: translationKey(
    "Signing in with a password or an emailed link will then ask for your second step: an authenticator app, a security key or a passkey.",
  ),
};

export interface ComponentProps {
  /*
   * Bumped by the page when a second step is added or removed, so the card
   * reads where the person stands again.
   */
  refreshToggle?: number | undefined;
  // Told what the card read, so the page can lock what the server would refuse.
  onSetupLoaded?: ((setup: TwoFactorAuthSetup | null) => void) | undefined;
  // Enable with nothing set up, and Finish setup: the page's guided setup.
  onStartSetup?: (() => void) | undefined;
}

const TwoFactorStatus: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [ownRefresh, setOwnRefresh] = React.useState<number>(0);
  const [pendingStatus, setPendingStatus] = React.useState<boolean | null>(
    null,
  );
  const [isSaving, setIsSaving] = React.useState<boolean>(false);
  const [saveError, setSaveError] = React.useState<string>("");
  const saving: React.MutableRefObject<boolean> = React.useRef<boolean>(false);

  const state: TwoFactorAuthSetupState = useTwoFactorAuthSetup(
    (props.refreshToggle || 0) + ownRefresh,
  );
  const setup: TwoFactorAuthSetup | null = state.setup;
  /*
   * Only the first read draws the skeleton: a read again after a change
   * keeps what the card shows until the answer comes, so nothing jumps.
   */
  const isFirstLoad: boolean = state.isLoading && !setup;

  const onSetupLoaded:
    | ((setup: TwoFactorAuthSetup | null) => void)
    | undefined = props.onSetupLoaded;

  React.useEffect(() => {
    if (!state.isLoading) {
      onSetupLoaded?.(setup);
    }
  }, [setup, state.isLoading]);

  const loadError: string = state.error
    ? describeTwoFactorAuthSetupError({
        error: state.error,
        translateText: (text: string): string => {
          return translator.translateText(text) as string;
        },
        getFriendlyMessage: (error: unknown): string => {
          return API.getFriendlyMessage(error);
        },
      })
    : "";

  const updateStatus: () => Promise<void> = async (): Promise<void> => {
    if (saving.current || pendingStatus === null) {
      return;
    }

    saving.current = true;
    setIsSaving(true);
    setSaveError("");
    try {
      await ModelAPI.updateById<User>({
        modelType: User,
        id: UserUtil.getUserId(),
        data: { enableTwoFactorAuth: pendingStatus },
      });
      setPendingStatus(null);
      setOwnRefresh((value: number) => {
        return value + 1;
      });
    } catch (error) {
      setSaveError(API.getFriendlyMessage(error));
    } finally {
      saving.current = false;
      setIsSaving(false);
    }
  };

  const status: TwoFactorAuthStatus | null = setup ? setup.status : null;
  const hasASecondStep: boolean = Boolean(
    setup && setup.verifiedMethodCount > 0,
  );

  const getButtons: () => Array<CardButtonSchema> =
    (): Array<CardButtonSchema> => {
      if (isFirstLoad || loadError || !status) {
        return [];
      }

      const turnOff: CardButtonSchema = {
        title: TWO_FACTOR_STATUS_COPY.turnOffAction,
        icon: IconProp.Lock,
        buttonStyle: ButtonStyleType.NORMAL,
        onClick: () => {
          setSaveError("");
          setPendingStatus(false);
        },
      };

      if (status === TwoFactorAuthStatus.EnabledConfigured) {
        return [turnOff];
      }

      if (status === TwoFactorAuthStatus.EnabledPendingSetup) {
        return [
          {
            title: TWO_FACTOR_STATUS_COPY.finishSetupAction,
            icon: IconProp.ShieldCheck,
            buttonStyle: ButtonStyleType.PRIMARY,
            onClick: () => {
              props.onStartSetup?.();
            },
          },
          turnOff,
        ];
      }

      return [
        {
          title: TWO_FACTOR_STATUS_COPY.enableAction,
          icon: IconProp.ShieldCheck,
          buttonStyle: ButtonStyleType.PRIMARY,
          onClick: () => {
            if (hasASecondStep) {
              setSaveError("");
              setPendingStatus(true);
              return;
            }

            props.onStartSetup?.();
          },
        },
      ];
    };

  const getBadge: () => ReactElement | undefined = ():
    | ReactElement
    | undefined => {
    if (isFirstLoad || loadError || !status) {
      return undefined;
    }

    if (status === TwoFactorAuthStatus.EnabledConfigured) {
      return (
        <span data-testid="two-factor-status">
          <Pill
            text={TWO_FACTOR_STATUS_COPY.enabled}
            tone={PillTone.Success}
            icon={IconProp.ShieldCheck}
          />
        </span>
      );
    }

    if (status === TwoFactorAuthStatus.EnabledPendingSetup) {
      return (
        <span data-testid="two-factor-status">
          <Pill
            text={TWO_FACTOR_STATUS_COPY.setupNeeded}
            tone={PillTone.Warning}
            icon={IconProp.Alert}
          />
        </span>
      );
    }

    return (
      <span data-testid="two-factor-status">
        <Pill text={TWO_FACTOR_STATUS_COPY.notEnabled} tone={PillTone.Paused} />
      </span>
    );
  };

  const getExplanation: () => string = (): string => {
    if (status === TwoFactorAuthStatus.EnabledConfigured) {
      return TWO_FACTOR_STATUS_COPY.enabledWithASecondStep;
    }

    if (status === TwoFactorAuthStatus.EnabledPendingSetup) {
      return TWO_FACTOR_STATUS_COPY.setupNeededExplanation;
    }

    return hasASecondStep
      ? TWO_FACTOR_STATUS_COPY.notEnabledWithASecondStep
      : TWO_FACTOR_STATUS_COPY.notEnabledWithNothing;
  };

  const isSetupNeeded: boolean =
    status === TwoFactorAuthStatus.EnabledPendingSetup;

  return (
    <>
      <Card
        title="Two-factor authentication"
        description="Add an extra layer of security when you sign in with a password."
        rightElement={getBadge()}
        buttons={getButtons()}
      >
        {isFirstLoad ? (
          <DetailListSkeleton fields={2} columns={1} />
        ) : loadError ? (
          <div>
            <ErrorMessage message={loadError} />
            <Button
              title="Try again"
              buttonStyle={ButtonStyleType.NORMAL}
              className="mt-3"
              onClick={() => {
                setOwnRefresh((value: number) => {
                  return value + 1;
                });
              }}
            />
          </div>
        ) : (
          <div
            className={
              isSetupNeeded
                ? "flex items-start gap-3 rounded-lg bg-amber-50 px-4 py-3"
                : "flex items-start gap-3 rounded-lg bg-gray-50 px-4 py-3"
            }
            data-testid="two-factor-status-explanation"
          >
            <Icon
              icon={isSetupNeeded ? IconProp.Alert : IconProp.Lock}
              className={
                isSetupNeeded
                  ? "mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600"
                  : "mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
              }
            />
            <p
              className={
                isSetupNeeded
                  ? "text-sm leading-6 text-amber-800"
                  : "text-sm leading-6 text-gray-600"
              }
            >
              {translator.translateText(getExplanation())}
            </p>
          </div>
        )}
      </Card>
      {pendingStatus !== null && (
        <ConfirmModal
          title={
            pendingStatus
              ? TWO_FACTOR_STATUS_COPY.enableQuestion
              : "Turn off two-factor authentication?"
          }
          description={
            pendingStatus
              ? TWO_FACTOR_STATUS_COPY.enableDescription
              : "You will no longer be asked for a second step when signing in with a password. Your authenticator apps and security keys stay saved."
          }
          submitButtonText={
            pendingStatus
              ? TWO_FACTOR_STATUS_COPY.enableAction
              : TWO_FACTOR_STATUS_COPY.turnOffAction
          }
          submitButtonType={
            pendingStatus ? ButtonStyleType.PRIMARY : ButtonStyleType.DANGER
          }
          isLoading={isSaving}
          disableSubmitButton={isSaving}
          error={saveError || undefined}
          onClose={
            isSaving
              ? undefined
              : () => {
                  setPendingStatus(null);
                }
          }
          onSubmit={() => {
            void updateStatus();
          }}
        />
      )}
    </>
  );
};

export default TwoFactorStatus;
