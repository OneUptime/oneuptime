import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Query from "Common/Types/BaseDatabase/Query";
import type EmptyStateOptions from "Common/UI/Components/ModelTable/EmptyStateOptions";
import useFirstRecordWatch, {
  FirstRecordWatch,
} from "../Infrastructure/UseFirstRecordWatch";
import {
  getFirstRunEmptyState,
  getFirstRunTopContent,
} from "../Infrastructure/FirstRecordWatch";
import useShowcaseCreateForm, {
  ShowcaseCreateForm,
} from "../ResourceShowcase/UseShowcaseCreateForm";
import { ShowcaseAddButton } from "../ResourceShowcase/ResourceShowcaseCard";
import { getUnlockedButton } from "./ProductShowcase";

/*
 * A product list's first run (ProductOnboarding.ts), for a list whose first
 * step is its table's create form (On-Call policies, Status Pages, SLOs,
 * Services, Dashboards, Workflows, Runbooks, Forms): whether the project has
 * none yet, the table's options while it has none, and the showcase's
 * button, which opens the table's own form.
 *
 * The page is never held up by the count: it draws its table at once, and
 * the showcase joins it when the count says there is nothing yet. A count
 * that fails leaves the page as it was.
 */

export interface ProductFirstRun {
  // Whether the project has none of the list's records yet.
  isFirstRun: boolean;
  // For the table's refreshToggle: changes when the first record arrives.
  refreshToken: string;
  // For the table's onCreateSuccess: the showcase gives way at once.
  onRecordCreated: () => void;
  // For the table's showCreateForm.
  showCreateForm: boolean;
  // The showcase's button: the table's own form, for whoever may use it.
  startButton: ShowcaseAddButton | undefined;
  // The table's empty state and filter bar while there is nothing yet.
  getEmptyState: (emptyState?: EmptyStateOptions) => EmptyStateOptions;
  getTopContent: <T>(topContent: T) => T | undefined;
}

export default function useProductFirstRun<TBaseModel extends BaseModel>(data: {
  modelType: { new (): TBaseModel };
  query?: Query<TBaseModel> | undefined;
  // As the table is told them: its createVerb and singularName.
  createVerb?: string | undefined;
  singularName?: string | undefined;
}): ProductFirstRun {
  const watch: FirstRecordWatch = useFirstRecordWatch<TBaseModel>({
    modelType: data.modelType,
    query: data.query,
  });
  const createForm: ShowcaseCreateForm = useShowcaseCreateForm({
    modelType: data.modelType,
    createVerb: data.createVerb,
    singularName: data.singularName,
  });

  return {
    isFirstRun: watch.count === 0,
    refreshToken: watch.refreshToken,
    onRecordCreated: watch.onRecordCreated,
    showCreateForm: createForm.showCreateForm,
    startButton: getUnlockedButton(createForm.addButton),
    getEmptyState: (emptyState?: EmptyStateOptions): EmptyStateOptions => {
      return getFirstRunEmptyState({ emptyState, count: watch.count });
    },
    getTopContent: <T>(topContent: T): T | undefined => {
      return getFirstRunTopContent({ topContent, count: watch.count });
    },
  };
}
