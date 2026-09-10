import User from "Common/Models/DatabaseModels/User";
import IconProp from "Common/Types/Icon/IconProp";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import UserUtil from "Common/UI/Utils/User";
import Card from "Common/UI/Components/Card/Card";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import React, { FunctionComponent, ReactElement } from "react";

const TwoFactorStatus: FunctionComponent = (): ReactElement => {
  const [isEnabled, setIsEnabled] = React.useState<boolean | null>(null);
  const [isLoading, setIsLoading] = React.useState<boolean>(true);
  const [loadError, setLoadError] = React.useState<string>("");
  const [refresh, setRefresh] = React.useState<number>(0);
  const [showEnableModal, setShowEnableModal] = React.useState<boolean>(false);
  const [isSaving, setIsSaving] = React.useState<boolean>(false);
  const [saveError, setSaveError] = React.useState<string>("");
  const saving: React.MutableRefObject<boolean> = React.useRef<boolean>(false);

  React.useEffect(() => {
    const controller: AbortController = new AbortController();
    setIsLoading(true);
    setLoadError("");

    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        const user: User | null = await ModelAPI.getItem<User>({
          modelType: User,
          id: UserUtil.getUserId(),
          select: { enableTwoFactorAuth: true },
          requestOptions: { apiRequestOptions: { signal: controller.signal } },
        });

        if (!user || typeof user.enableTwoFactorAuth !== "boolean") {
          throw new Error(
            "Your two-factor authentication status could not be loaded.",
          );
        }

        if (!controller.signal.aborted) {
          setIsEnabled(user.enableTwoFactorAuth);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setLoadError(API.getFriendlyMessage(error));
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    void load();
    return () => {
      controller.abort();
    };
  }, [refresh]);

  const enable: () => Promise<void> = async (): Promise<void> => {
    if (saving.current) {
      return;
    }

    saving.current = true;
    setIsSaving(true);
    setSaveError("");
    try {
      await ModelAPI.updateById<User>({
        modelType: User,
        id: UserUtil.getUserId(),
        data: { enableTwoFactorAuth: true },
      });
      setIsEnabled(true);
      setShowEnableModal(false);
    } catch (error) {
      setSaveError(API.getFriendlyMessage(error));
    } finally {
      saving.current = false;
      setIsSaving(false);
    }
  };

  return (
    <>
      <Card
        title="Two-factor authentication"
        description="Add an extra layer of security when you sign in with a password."
        rightElement={
          !isLoading && !loadError && isEnabled !== null ? (
            <span
              className={
                isEnabled
                  ? "inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700"
                  : "inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-600"
              }
              data-testid="two-factor-status"
            >
              <Icon
                icon={isEnabled ? IconProp.ShieldCheck : IconProp.Lock}
                className="h-4 w-4"
              />
              {isEnabled ? "Enabled" : "Not enabled"}
            </span>
          ) : undefined
        }
        buttons={
          !isLoading && !loadError && isEnabled === false
            ? [
                {
                  title: "Enable two-factor authentication",
                  icon: IconProp.ShieldCheck,
                  buttonStyle: ButtonStyleType.NORMAL,
                  onClick: () => {
                    setSaveError("");
                    setShowEnableModal(true);
                  },
                },
              ]
            : []
        }
      >
        {isLoading ? (
          <ComponentLoader />
        ) : loadError ? (
          <div>
            <ErrorMessage message={loadError} />
            <Button
              title="Try again"
              buttonStyle={ButtonStyleType.NORMAL}
              className="mt-3"
              onClick={() => {
                setRefresh((value: number) => {
                  return value + 1;
                });
              }}
            />
          </div>
        ) : (
          <div className="flex items-start gap-3 rounded-lg bg-gray-50 px-4 py-3">
            <Icon
              icon={IconProp.Lock}
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
            />
            <p className="text-sm leading-6 text-gray-600">
              {isEnabled
                ? "Use an authenticator app or security key for your second step. An administrator can turn this off for your account."
                : "Set up an authenticator app or security key below, then enable two-factor authentication for your account."}
            </p>
          </div>
        )}
      </Card>
      {showEnableModal && (
        <ConfirmModal
          title="Enable two-factor authentication?"
          description="You will need an authenticator app or security key when signing in with a password. If you have not added one yet, you will finish setup at your next sign-in. Once enabled, only an administrator can turn it off."
          submitButtonText="Enable two-factor authentication"
          isLoading={isSaving}
          disableSubmitButton={isSaving}
          error={saveError || undefined}
          onClose={
            isSaving
              ? undefined
              : () => {
                  setShowEnableModal(false);
                }
          }
          onSubmit={() => {
            void enable();
          }}
        />
      )}
    </>
  );
};

export default TwoFactorStatus;
