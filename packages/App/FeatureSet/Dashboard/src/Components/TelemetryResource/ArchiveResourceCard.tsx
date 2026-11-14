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
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { Fragment, ReactElement, useEffect, useState } from "react";
import {
  announceArchiveStateChange,
  subscribeToArchiveStateChanges,
} from "../Archive/ArchiveStateEvents";
import {
  ArchiveCardWords,
  getArchiveCardWords,
} from "../Archive/ArchiveCardWords";

export interface ComponentProps<TBaseModel extends BaseModel> {
  modelType: { new (): TBaseModel };
  modelId: ObjectID;
  /*
   * The resource's name as the card says it, in English: "service", "SLO".
   * Said in the reader's language - a key of the Dashboard's locales, as a
   * literal here is once npm run i18n:extract has run. Defaults to the
   * model's name.
   */
  singularName?: string | undefined;
  /** Where to send the user after archiving (usually the list page). */
  listRoute?: Route | undefined;
  /*
   * Copy overrides. The defaults describe a telemetry resource, which keeps
   * ingesting while it is archived. That is not true of everything that can be
   * archived - an archived SLO stops being evaluated and has its open
   * burn-rate alerts resolved - and a card promising "keeps collecting
   * telemetry" there would tell the user the opposite of what happens.
   *
   * Each is an English key (translationKey), said in the reader's language.
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
  /*
   * Under the archive confirmation's message, while it asks to archive
   * (never to unarchive): what still uses the record (UsedBy's
   * UsedByImpactForRecord, #6813). Drawn only while the dialog is open, so
   * what it reads is read only then.
   */
  archiveConfirmationContent?: ReactElement | undefined;
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
  const translator: Translator = useTranslator();

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

    /*
     * The banner at the top of the page can unarchive the resource too. Follow
     * it, so this card never offers to unarchive something that already is.
     */
    return subscribeToArchiveStateChanges({
      modelType: props.modelType,
      modelId: props.modelId,
      onChange: (newValue: boolean) => {
        setIsArchived(newValue);
      },
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

      // The banner and side-menu counts on this screen follow the change.
      announceArchiveStateChange({
        modelType: props.modelType,
        modelId: props.modelId,
        isArchived: newValue,
      });

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

  /*
   * The title, description and confirmation in the reader's language, the
   * resource's name among them (ArchiveCardWords). An empty override reads
   * as the telemetry sentence, never as a blank card or dialog.
   */
  const { title, description, confirmMessage }: ArchiveCardWords =
    getArchiveCardWords({
      singularName: singularName,
      isArchived: isArchived,
      copy: {
        archiveCardDescription: props.archiveCardDescription,
        unarchiveCardDescription: props.unarchiveCardDescription,
        archiveConfirmMessage: props.archiveConfirmMessage,
        unarchiveConfirmMessage: props.unarchiveConfirmMessage,
      },
      translator: translator,
    });

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
          submitButtonType={ButtonStyleType.PRIMARY}
          isLoading={isSaving}
          onClose={() => {
            setShowConfirm(false);
          }}
          onSubmit={() => {
            toggleArchive().catch((err: Error) => {
              setError(API.getFriendlyMessage(err));
            });
          }}
        >
          {!isArchived && props.archiveConfirmationContent
            ? props.archiveConfirmationContent
            : undefined}
        </ConfirmModal>
      )}
    </Fragment>
  );
};

export default ArchiveResourceCard;
