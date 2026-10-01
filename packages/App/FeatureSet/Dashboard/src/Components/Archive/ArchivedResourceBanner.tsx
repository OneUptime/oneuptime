import {
  announceArchiveStateChange,
  subscribeToArchiveStateChanges,
} from "./ArchiveStateEvents";
import { ResourceArchiveCopy } from "./ResourceArchiveCopy";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import AlertBanner, {
  AlertBannerType,
} from "Common/UI/Components/AlertBanner/AlertBanner";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import React, { Fragment, ReactElement, useEffect, useState } from "react";

export interface ComponentProps<TBaseModel extends BaseModel> {
  modelType: { new (): TBaseModel };
  modelId: ObjectID;
  copy: ResourceArchiveCopy;
}

/**
 * Says, across the top of every page of an archived resource, that it is
 * archived and what that means - and offers to unarchive it right there.
 *
 * An archived workflow refuses to run, an archived monitor shows a frozen
 * status, an archived status page answers "not found". Someone who reaches
 * one of those pages from the Archived list, a bookmark or a search should
 * not have to work out why; the banner tells them and puts the way back one
 * click away, so they do not have to go looking for the Settings page.
 *
 * It reads the resource itself (only `isArchived`), so a layout can render it
 * with nothing but the id. It renders nothing while loading, when the
 * resource is not archived, and when the read fails: the page's own error
 * handling owns failures, and a banner that guessed would be worse than none.
 * It follows changes made elsewhere on the page (the Settings card) through
 * ArchiveStateEvents.
 */
const ArchivedResourceBanner: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  const [isArchived, setIsArchived] = useState<boolean>(false);
  const [showConfirm, setShowConfirm] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const modelIdString: string = props.modelId.toString();

  useEffect(() => {
    let cancelled: boolean = false;

    // A banner for the resource the reader just left must not linger.
    setIsArchived(false);
    setError("");

    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        const item: TBaseModel | null = await ModelAPI.getItem<TBaseModel>({
          modelType: props.modelType,
          id: props.modelId,
          select: {
            isArchived: true,
          } as any,
        });

        if (!cancelled) {
          setIsArchived(Boolean((item as any)?.isArchived));
        }
      } catch {
        if (!cancelled) {
          setIsArchived(false);
        }
      }
    };

    load().catch(() => {
      // load() handles its own failures.
    });

    const unsubscribe: () => void = subscribeToArchiveStateChanges({
      modelType: props.modelType,
      modelId: props.modelId,
      onChange: (newValue: boolean) => {
        if (!cancelled) {
          setIsArchived(newValue);
        }
      },
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [modelIdString]);

  if (!isArchived) {
    return <Fragment />;
  }

  // Unarchiving is an update, so it needs update permission.
  const updateGate: PermissionGateResult = PermissionGate.check(
    new props.modelType(),
    ModelAction.Update,
    { singularName: props.copy.singularName },
  );

  const unarchive: () => Promise<void> = async (): Promise<void> => {
    setIsSaving(true);
    setError("");

    try {
      await ModelAPI.updateById<TBaseModel>({
        modelType: props.modelType,
        id: props.modelId,
        data: {
          isArchived: false,
        } as any,
      });

      setShowConfirm(false);
      setIsArchived(false);

      announceArchiveStateChange({
        modelType: props.modelType,
        modelId: props.modelId,
        isArchived: false,
      });
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setShowConfirm(false);
    }

    setIsSaving(false);
  };

  return (
    <Fragment>
      <AlertBanner
        type={AlertBannerType.Info}
        icon={IconProp.Archive}
        title={props.copy.bannerTitle}
        dataTestId="archived-resource-banner"
        rightElement={
          <Button
            title="Unarchive"
            icon={IconProp.Unarchive}
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            dataTestId="archived-resource-banner-unarchive"
            disabled={!updateGate.isAllowed}
            tooltip={updateGate.disabledReason}
            onClick={() => {
              if (!updateGate.isAllowed) {
                return;
              }

              setShowConfirm(true);
            }}
          />
        }
      >
        <Fragment>
          <p>{props.copy.bannerBody}</p>
          {error ? (
            <p
              className="mt-1 text-sm text-red-600"
              data-testid="archived-resource-banner-error"
            >
              {error}
            </p>
          ) : (
            <></>
          )}
        </Fragment>
      </AlertBanner>
      {showConfirm ? (
        <ConfirmModal
          title={`Unarchive ${props.copy.singularName}`}
          description={props.copy.unarchiveConfirmMessage}
          submitButtonText="Unarchive"
          submitButtonType={ButtonStyleType.PRIMARY}
          isLoading={isSaving}
          onClose={() => {
            setShowConfirm(false);
          }}
          onSubmit={() => {
            unarchive().catch((err: Error) => {
              setError(API.getFriendlyMessage(err));
            });
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default ArchivedResourceBanner;
