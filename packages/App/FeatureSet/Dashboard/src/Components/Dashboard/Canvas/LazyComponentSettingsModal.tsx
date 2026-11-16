/*
 * Type-only on purpose: the one place the modal is loaded is the import()
 * below, so it stays out of the first load of every page that draws a board.
 */
import type ComponentSettingsModal from "./ComponentSettingsModal";
import type { ComponentProps } from "./ComponentSettingsModal";
import ChunkLoadRecovery, {
  ChunkLoadRecoveryVariant,
} from "Common/UI/Components/NewVersion/ChunkLoadRecovery";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import {
  LazyLibrary,
  LazyLibraryLoad,
  useLazyLibraryLoad,
} from "Common/UI/Utils/LazyLibrary";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A widget's settings, as the board opens them: in edit mode, when a widget
 * is picked. A board draws without them - in view mode, and on a public
 * dashboard, which has no edit mode - yet they bring every widget's
 * arguments form, the metric query editor and the models its pickers
 * search. Statically imported, that was some 390 KB (before gzip) of what a
 * public dashboard's visitor downloaded before the board could draw
 * (packages/Common/Scripts/first-load-budgets.js). So it is a file of its
 * own, asked for as the board turns to edit mode (loadComponentSettingsModal,
 * Canvas/Index.tsx), and there from the first frame of every one opened
 * after.
 */
const componentSettingsModal: LazyLibrary<typeof ComponentSettingsModal> =
  new LazyLibrary<typeof ComponentSettingsModal>(
    async (): Promise<typeof ComponentSettingsModal> => {
      return (await import("./ComponentSettingsModal")).default;
    },
  );

// Loads the modal, once however many ask; a failed load is retried.
export const loadComponentSettingsModal: () => Promise<
  typeof ComponentSettingsModal
> = (): Promise<typeof ComponentSettingsModal> => {
  return componentSettingsModal.load();
};

const LazyComponentSettingsModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const load: LazyLibraryLoad<typeof ComponentSettingsModal> =
    useLazyLibraryLoad(componentSettingsModal, true);

  if (load.error) {
    /*
     * Its file did not arrive - usually a new version deployed while the tab
     * was open. The settings open all the same and say so in their place, as
     * every part of a page whose code will not download does
     * (ChunkLoadRecovery): the board and its unsaved changes stay behind the
     * dialog, and the way onto the new version asks before it leaves them.
     */
    return (
      <Modal
        title={props.title}
        isTitleTranslated={props.isTitleTranslated}
        modalWidth={ModalWidth.Large}
        onClose={props.onClose}
        closeButtonText="Close"
      >
        <ChunkLoadRecovery
          error={load.error}
          variant={ChunkLoadRecoveryVariant.Part}
        />
      </Modal>
    );
  }

  if (!load.library) {
    /*
     * On its way: the moment its file takes, and only if the board did not
     * ask for it as it turned to edit mode, or that is still on its way.
     */
    return <></>;
  }

  const SettingsModal: typeof ComponentSettingsModal = load.library;

  return <SettingsModal {...props} />;
};

export default LazyComponentSettingsModal;
