/*
 * react-beautiful-dnd, for a list whose rows are dragged into order: a Table
 * or a StaticModelList with enableDragAndDrop.
 *
 * Both are drawn on far more pages than ever drag a row - the sign-in page
 * reaches Table through a form's summary step, a status page reaches
 * StaticModelList through its single sign-on page - so the library, about
 * 120 KB of script with the react-redux it runs on, is a file of its own,
 * loaded by the first list that drags (issue #5619, LazyLibrary). Until it
 * arrives the list draws its rows as they will look, grips included; they
 * drag once it is there.
 *
 * Type-only: the one place the library is loaded is the import() below.
 */
import type {
  DragDropContext,
  Draggable,
  Droppable,
} from "react-beautiful-dnd";
import { LazyLibrary, useLazyLibrary } from "../../Utils/LazyLibrary";

// What a list draws with: the context, the list and each row.
export interface DragAndDropLibrary {
  DragDropContext: typeof DragDropContext;
  Droppable: typeof Droppable;
  Draggable: typeof Draggable;
}

const dragAndDrop: LazyLibrary<DragAndDropLibrary> =
  new LazyLibrary<DragAndDropLibrary>(async (): Promise<DragAndDropLibrary> => {
    const library: DragAndDropLibrary = await import("react-beautiful-dnd");

    return {
      DragDropContext: library.DragDropContext,
      Droppable: library.Droppable,
      Draggable: library.Draggable,
    };
  });

// The library, when a list has loaded it already.
export function getLoadedDragAndDrop(): DragAndDropLibrary | null {
  return dragAndDrop.getLoaded();
}

// Loads the library, once however many lists ask; a failed load is retried.
export function loadDragAndDrop(): Promise<DragAndDropLibrary> {
  return dragAndDrop.load();
}

/*
 * The library for a list that drags its rows, once it is there: null while
 * it loads, if it cannot, and for a list whose rows stay where they are.
 */
export function useDragAndDrop(isEnabled: boolean): DragAndDropLibrary | null {
  return useLazyLibrary(dragAndDrop, isEnabled);
}
