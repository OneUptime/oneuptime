import { buildDisableProviderUpdate } from "./TightenOnlyUpdates";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import BadDataException from "Common/Types/Exception/BadDataException";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import ActionButtonSchema from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import React, { ReactElement, useState } from "react";

/*
 * "Disable" for an identity provider while the Enterprise license makes its
 * configuration read-only: a row action for a provider table, a confirmation,
 * and an update whose data is exactly { isEnabled: false } - the one provider
 * update the server accepts without a license (see TightenOnlyUpdates.ts).
 *
 * Offered only while configuration is read-only (the normal edit form covers
 * it otherwise) and only for a provider that is enabled. A refusal - 402 or
 * anything else - is shown in the confirmation, which stays open.
 *
 * Works for the project, status page and global providers and for a global
 * provider's project attachments: every model with an isEnabled column the
 * server lists as tighten-only.
 */

export interface DisableableModel extends BaseModel {
  isEnabled?: boolean | undefined;
}

export interface DisableConfirmationText {
  title: string;
  description: string;
}

export const DISABLE_ACTION_TITLE: string = "Disable";

export const DISABLE_PROVIDER_CONFIRMATION: DisableConfirmationText = {
  title: "Disable Provider",
  description:
    "Nobody will be able to sign in with this provider until it is turned back on, and turning it back on needs a valid Enterprise license.",
};

export const DISABLE_PROJECT_ATTACHMENT_CONFIRMATION: DisableConfirmationText =
  {
    title: "Disable Project Attachment",
    description:
      "This provider will no longer provision users into this project, or give access to it when the provider is restricted to attached projects. Turning the attachment back on needs a valid Enterprise license.",
  };

export interface DisableProviderActionOptions<
  TBaseModel extends DisableableModel,
> {
  modelType: { new (): TBaseModel };
  // AdminModelAPI on the Admin Dashboard; ModelAPI otherwise.
  modelAPI?: typeof ModelAPI | undefined;
  isReadOnly: boolean;
  confirmation?: DisableConfirmationText | undefined;
  // Called once the server has accepted the update: refresh what shows it.
  onDisabled: (id: ObjectID) => void;
}

export interface DisableProviderAction<TBaseModel extends DisableableModel> {
  // For a ModelTable's actionButtons.
  actionButton: ActionButtonSchema<TBaseModel>;
  // Whether `item` gets the action: read-only configuration, enabled provider.
  canDisable: (item: TBaseModel | null | undefined) => boolean;
  // Asks for confirmation, then disables the provider with this id.
  requestDisable: (id: ObjectID) => void;
  // The confirmation; render it once on the page.
  modal: ReactElement;
}

const getItemId: (item: DisableableModel) => ObjectID | null = (
  item: DisableableModel,
): ObjectID | null => {
  const id: unknown = item._id;

  if (id === undefined || id === null || id.toString() === "") {
    return null;
  }

  return new ObjectID(id.toString());
};

const useDisableProviderAction: <TBaseModel extends DisableableModel>(
  options: DisableProviderActionOptions<TBaseModel>,
) => DisableProviderAction<TBaseModel> = <TBaseModel extends DisableableModel>(
  options: DisableProviderActionOptions<TBaseModel>,
): DisableProviderAction<TBaseModel> => {
  const [pendingId, setPendingId] = useState<ObjectID | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const modelAPI: typeof ModelAPI = options.modelAPI || ModelAPI;
  const confirmation: DisableConfirmationText =
    options.confirmation || DISABLE_PROVIDER_CONFIRMATION;

  const canDisable: (item: TBaseModel | null | undefined) => boolean = (
    item: TBaseModel | null | undefined,
  ): boolean => {
    if (!options.isReadOnly || !item) {
      return false;
    }

    // Only the literal true: a provider that is off (or unknown) has nothing to disable.
    return item.isEnabled === true && getItemId(item) !== null;
  };

  const requestDisable: (id: ObjectID) => void = (id: ObjectID): void => {
    setError("");
    setPendingId(id);
  };

  const closeConfirmation: VoidFunction = (): void => {
    setPendingId(null);
    setError("");
  };

  const disable: () => Promise<void> = async (): Promise<void> => {
    if (!pendingId || isLoading) {
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      await modelAPI.updateById<TBaseModel>({
        modelType: options.modelType,
        id: pendingId,
        data: buildDisableProviderUpdate(),
      });

      setPendingId(null);
      options.onDisabled(pendingId);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  const actionButton: ActionButtonSchema<TBaseModel> = {
    title: DISABLE_ACTION_TITLE,
    buttonStyleType: ButtonStyleType.DANGER_OUTLINE,
    icon: IconProp.StopCircle,
    isVisible: (item: TBaseModel): boolean => {
      return canDisable(item);
    },
    onClick: (
      item: TBaseModel,
      onCompleteAction: VoidFunction,
      onError: ErrorFunction,
    ): void => {
      try {
        const id: ObjectID | null = getItemId(item);

        if (!id) {
          throw new BadDataException("This provider has no ID.");
        }

        requestDisable(id);
        onCompleteAction();
      } catch (err) {
        onError(err as Error);
      }
    },
  };

  const modal: ReactElement = pendingId ? (
    <ConfirmModal
      title={confirmation.title}
      description={confirmation.description}
      submitButtonText={DISABLE_ACTION_TITLE}
      submitButtonType={ButtonStyleType.DANGER}
      isLoading={isLoading}
      error={error || undefined}
      onClose={closeConfirmation}
      onSubmit={async () => {
        await disable();
      }}
    />
  ) : (
    <></>
  );

  return { actionButton, canDisable, requestDisable, modal };
};

export default useDisableProviderAction;
