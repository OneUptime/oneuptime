import {
  EmptySite,
  EmptySitesDeleted,
  deleteEmptySites,
  fetchEmptySites,
} from "./EmptySitesApi";
import {
  DELETE_EMPTY_SITES_ACTION,
  DELETE_EMPTY_SITES_BUTTON,
  DELETE_EMPTY_SITES_DESCRIPTION,
  DELETE_EMPTY_SITES_QUESTION,
  DELETE_EMPTY_SITES_TITLE,
  EMPTY_SITES_DELETED,
  EMPTY_SITES_KEPT,
  EMPTY_SITES_NOT_DELETED,
  EMPTY_SITES_NOT_LISTED,
  NO_EMPTY_SITES,
} from "./DeleteEmptySitesWords";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import DeleteItemNames from "Common/UI/Components/DeleteConfirmation/DeleteItemNames";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import Toast from "Common/UI/Utils/Toast";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * DELETE EMPTY SITES, FROM THE SITES LIST (#10188).
 *
 * An add of a Meraki organization's devices on OneUptime 16.0.0 added a
 * site for every Meraki network before it could add a device, and then
 * added none: hundreds of sites with nothing in them, to delete one by one.
 * This lists the project's empty sites - no device, no site under them, and
 * nothing that names them (Common/Server/Utils/NetworkSite/NetworkSiteUsage)
 * - names the first few, and deletes exactly the ones listed once the
 * person confirms. A site something went into since it was listed is kept,
 * and the toast says so.
 */

// The names listed under the question; the rest are counted.
export const EMPTY_SITE_NAMES_SHOWN: number = 10;

export interface ComponentProps {
  onClose: () => void;
  // After sites were deleted: the page refreshes its list, cards and tree.
  onDeleted: (deletedCount: number) => void;
}

const DeleteEmptySitesModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [sites, setSites] = useState<Array<EmptySite> | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [whatFailed, setWhatFailed] = useState<string>("");

  useEffect(() => {
    let isCurrent: boolean = true;

    fetchEmptySites()
      .then((found: Array<EmptySite>) => {
        if (isCurrent) {
          setSites(found);
        }
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          setSites([]);
          setWhatFailed(EMPTY_SITES_NOT_LISTED);
          setError(API.getFriendlyMessage(err));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  const count: number = sites?.length || 0;
  const isListed: boolean = sites !== null && !error;

  const deleteListed: () => Promise<void> = async (): Promise<void> => {
    if (!sites || sites.length === 0) {
      return;
    }

    setIsDeleting(true);
    setError("");

    try {
      const outcome: EmptySitesDeleted = await deleteEmptySites(
        sites.map((site: EmptySite): string => {
          return site.id;
        }),
      );

      Toast.success(
        translator.translatePlural(EMPTY_SITES_DELETED, outcome.deletedCount),
        {
          description:
            outcome.keptCount > 0
              ? translator.translatePlural(EMPTY_SITES_KEPT, outcome.keptCount)
              : undefined,
          dataTestId: "delete-empty-sites-toast",
        },
      );

      props.onDeleted(outcome.deletedCount);
      props.onClose();
    } catch (err) {
      setWhatFailed(EMPTY_SITES_NOT_DELETED);
      setError(API.getFriendlyMessage(err));
      setIsDeleting(false);
    }
  };

  return (
    <Modal
      title={
        isListed && count > 0
          ? translator.translatePlural(DELETE_EMPTY_SITES_TITLE, count)
          : translator.translateText(DELETE_EMPTY_SITES_ACTION) ||
            DELETE_EMPTY_SITES_ACTION
      }
      isTitleTranslated={true}
      description={
        translator.translateText(DELETE_EMPTY_SITES_DESCRIPTION) ||
        DELETE_EMPTY_SITES_DESCRIPTION
      }
      onClose={props.onClose}
      isBodyLoading={sites === null}
      // Nothing to delete, or nothing listed: nothing to press but Close.
      closeButtonText={isListed && count > 0 ? undefined : "Close"}
      submitButtonText={
        isListed && count > 0
          ? translator.translatePlural(DELETE_EMPTY_SITES_BUTTON, count)
          : undefined
      }
      submitButtonStyleType={ButtonStyleType.DANGER}
      onSubmit={
        isListed && count > 0
          ? () => {
              deleteListed().catch(() => {
                setIsDeleting(false);
              });
            }
          : undefined
      }
      isLoading={isDeleting}
      error={error || undefined}
      errorWhatFailed={
        whatFailed ? translator.translateText(whatFailed) || whatFailed : ""
      }
      modalWidth={ModalWidth.Medium}
    >
      <div className="space-y-3" data-testid="delete-empty-sites">
        {sites !== null && count === 0 && !error ? (
          <p
            className="text-sm text-gray-600"
            data-testid="delete-empty-sites-none"
          >
            {translator.translateText(NO_EMPTY_SITES) || NO_EMPTY_SITES}
          </p>
        ) : (
          <></>
        )}
        {sites !== null && count > 0 ? (
          <>
            <p
              className="text-sm text-gray-900"
              data-testid="delete-empty-sites-question"
            >
              {translator.translatePlural(DELETE_EMPTY_SITES_QUESTION, count)}
            </p>
            <DeleteItemNames
              names={sites.map((site: EmptySite): string => {
                return site.name;
              })}
              totalCount={count}
              maxShown={EMPTY_SITE_NAMES_SHOWN}
            />
          </>
        ) : (
          <></>
        )}
      </div>
    </Modal>
  );
};

export default DeleteEmptySitesModal;
