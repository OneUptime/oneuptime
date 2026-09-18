import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import Route from "Common/Types/API/Route";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import React, { Fragment, ReactElement, useEffect, useState } from "react";

export interface ComponentProps<TBaseModel extends BaseModel> {
  modelType: { new (): TBaseModel };
  modelId: ObjectID;
  /** Singular label used in copy, e.g. "service". Defaults to model name. */
  singularName?: string | undefined;
  /** Where to send the user after archiving (usually the list page). */
  listRoute?: Route | undefined;
  /*
   * Copy overrides. The defaults describe a telemetry resource, which keeps
   * ingesting while it is archived. That is not true of everything that can be
   * archived - an archived SLO stops being evaluated and has its open
   * burn-rate alerts resolved - and a card promising "keeps collecting
   * telemetry" there would tell the user the opposite of what happens.
   */
  /** Card description while the resource is NOT archived. */
  archiveCardDescription?: string | undefined;
  /** Card description while the resource IS archived. */
  unarchiveCardDescription?: string | undefined;
  /** Confirmation body shown before archiving. */
  archiveConfirmMessage?: string | undefined;
  /** Confirmation body shown before unarchiving. */
  unarchiveConfirmMessage?: string | undefined;
  /*
   * Called with the new state once the server has accepted an archive or
   * unarchive - never while the save is pending, and never when it fails.
   * For pages that show the archive state somewhere besides this card (the
   * SLO Settings page's notice banner says "This SLO is archived") and have
   * to re-read it, or the page contradicts itself until a reload.
   */
  onArchiveChange?: ((isArchived: boolean) => void) | undefined;
}

/**
 * Self-contained card for the per-resource Settings page that lets a user
 * archive or unarchive a single resource. By default it describes archiving as
 * a visibility flag only — telemetry continues to be ingested — and callers
 * whose archive does more pass their own copy. The client sends
 * `{ isArchived }`; the server stamps `archivedAt` / `archivedByUserId`.
 */
const ArchiveResourceCard: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  const [isArchived, setIsArchived] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [showConfirm, setShowConfirm] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const model: TBaseModel = new props.modelType();
  const singularName: string =
    props.singularName || model.singularName || "resource";

  /*
   * Archiving flips a column on the record, so it needs update permission.
   * Without it the button stays put and says which permission is missing,
   * rather than opening a confirmation the API will refuse.
   */
  const updateGate: PermissionGateResult = PermissionGate.check(
    model,
    ModelAction.Update,
    { singularName: props.singularName },
  );

  const loadState: () => Promise<void> = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const item: TBaseModel | null = await ModelAPI.getItem<TBaseModel>({
        modelType: props.modelType,
        id: props.modelId,
        select: {
          isArchived: true,
        } as any,
      });
      setIsArchived(Boolean((item as any)?.isArchived));
      setError("");
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    loadState().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  const toggleArchive: () => Promise<void> = async (): Promise<void> => {
    setIsSaving(true);
    try {
      const newValue: boolean = !isArchived;
      await ModelAPI.updateById<TBaseModel>({
        modelType: props.modelType,
        id: props.modelId,
        data: {
          isArchived: newValue,
        } as any,
      });
      setIsArchived(newValue);
      setShowConfirm(false);
      setIsSaving(false);

      /*
       * Told before navigating away, so a caller reacts to the change on the
       * page where it was made rather than racing the route change.
       */
      if (props.onArchiveChange) {
        props.onArchiveChange(newValue);
      }

      // After archiving, send the user back to the list (the resource is now hidden there).
      if (newValue && props.listRoute) {
        Navigation.navigate(props.listRoute);
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setIsSaving(false);
      setShowConfirm(false);
    }
  };

  if (isLoading) {
    return (
      <Card title="Archive" description="Loading…">
        <ComponentLoader />
      </Card>
    );
  }

  if (error) {
    return (
      <Card title="Archive">
        <ErrorMessage message={error} />
      </Card>
    );
  }

  const title: string = isArchived
    ? `Unarchive ${singularName}`
    : `Archive ${singularName}`;

  /*
   * `||` rather than `??`: an empty override is a caller mistake, and a blank
   * card or a confirmation with no body is worse than the generic copy.
   */
  const description: string = isArchived
    ? props.unarchiveCardDescription ||
      `This ${singularName} is archived and hidden from lists. It is still collecting telemetry. Unarchive it to make it visible again.`
    : props.archiveCardDescription ||
      `Archive this ${singularName} to hide it from lists while it keeps collecting telemetry. You can unarchive it anytime.`;

  const confirmMessage: string = isArchived
    ? props.unarchiveConfirmMessage ||
      `Are you sure you want to unarchive this ${singularName}? It will reappear in the main list.`
    : props.archiveConfirmMessage ||
      `Are you sure you want to archive this ${singularName}? It will be hidden from the list but will keep collecting telemetry.`;

  return (
    <Fragment>
      <Card
        title={title}
        description={description}
        buttons={[
          {
            title: isArchived ? "Unarchive" : "Archive",
            icon: isArchived ? IconProp.Unarchive : IconProp.Archive,
            buttonStyle: ButtonStyleType.NORMAL,
            disabled: !updateGate.isAllowed,
            tooltip: updateGate.disabledReason,
            onClick: () => {
              if (!updateGate.isAllowed) {
                return;
              }

              setShowConfirm(true);
            },
          },
        ]}
      />
      {showConfirm && (
        <ConfirmModal
          title={title}
          description={confirmMessage}
          submitButtonText={isArchived ? "Unarchive" : "Archive"}
          submitButtonType={ButtonStyleType.NORMAL}
          isLoading={isSaving}
          onClose={() => {
            setShowConfirm(false);
          }}
          onSubmit={() => {
            toggleArchive().catch((err: Error) => {
              setError(API.getFriendlyMessage(err));
            });
          }}
        />
      )}
    </Fragment>
  );
};

export default ArchiveResourceCard;
