/*
 * Type-only on purpose: the one place the modal is loaded is the import()
 * below, so it stays out of the first load of every page that draws a board.
 */
import type ComponentSettingsModal from "./ComponentSettingsModal";
import type { ComponentProps } from "./ComponentSettingsModal";
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
 * own, loaded the first time a widget's settings open, and there from the
 * first frame of every one opened after.
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
     * was open. Thrown, as a lazily loaded component's error is, so the part
     * of the page it opens from says so and offers the new version
     * (ContainedErrorBoundary, ChunkLoadRecovery).
     */
    throw load.error;
  }

  if (!load.library) {
    // On its way: the moment its file takes, the first time only.
    return <></>;
  }

  const Modal: typeof ComponentSettingsModal = load.library;

  return <Modal {...props} />;
};

export default LazyComponentSettingsModal;
