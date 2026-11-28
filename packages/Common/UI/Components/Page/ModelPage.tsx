import API from "../../Utils/API/API";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import Page, { PageRecordHeading, PageRecordTitle } from "./Page";
import { PAGE_RECORD_TITLE_SENTENCE } from "./PageRecordTitle";
import { subscribeToModelHeaderChanged } from "./ModelHeaderEvents";
import { nameRecordInTrail } from "./RecordNameInTrail";
import { translatableTerm, Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import PermissionGate, { ModelLabelLock } from "../../Utils/PermissionGate";
import {
  RecordAccessScope,
  RecordAccessScopeContext,
  useRecordAccessScope,
} from "../../Utils/RecordAccessScope";
import {
  getRecordLabelAccessScope,
  getRecordLabelIds,
  mergeRecordAccessScopes,
  useLabelNames,
} from "../../Utils/RecordLabelLock";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "../../../Models/DatabaseModels/Label";
import Link from "../../../Types/Link";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import {
  RecordNumberColumns,
  getRecordNumber,
  getRecordNumberColumns,
} from "../../../Utils/Project/RecordNumber";
import React, {
  MutableRefObject,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Select from "../../../Server/Types/Database/Select";

export interface ComponentProps<TBaseModel extends BaseModel> {
  // In English, looked up once - unless isTitleTranslated says otherwise.
  title?: string | undefined;
  /*
   * The title is in the reader's words already - the Admin Dashboard's
   * "pages.users.title" key: drawn as given in the heading, the browser tab
   * and the record's heading ("Usuarios - jane"), never looked up again
   * (Page's isTitleTranslated, #8224).
   */
  isTitleTranslated?: boolean | undefined;
  breadcrumbLinks?: Array<Link> | undefined;
  children: Array<ReactElement> | ReactElement;
  sideMenu?: undefined | ReactElement;
  className?: string | undefined;
  modelType: { new (): TBaseModel };
  modelId: ObjectID;
  modelNameField: string;
  modelAPI?: typeof ModelAPI | undefined;
  /*
   * Bump to read the header again for the same model, after an edit to its
   * name or labels, say. The page below stays mounted while it reloads, and a
   * refresh that fails keeps the header already on screen rather than
   * replacing the whole page with an error.
   */
  refreshToken?: number | undefined;
}

/*
 * What the header shows for one model: its title, its labels, or why it could
 * not be read. Stamped with the id it was read for, so it can never be shown
 * for a different model.
 */
interface LoadedModelHeader {
  modelId: string;
  title: string | undefined;
  // The record's own name, for the crumb that stands for it.
  recordName?: string | undefined;
  // The record's name as the heading shows it, once read.
  headingName?: string | undefined;
  /*
   * A numbered record's number, "INC-18" (Utils/Project/RecordNumber):
   * before its name in the heading, the trail and the browser tab.
   */
  recordNumber?: string | undefined;
  labels: Array<Label>;
  /*
   * The ids of the labels the record was read with, or null when it was
   * read without them: a model with no labels, or a reader the server
   * leaves them out for. What its labels lock is said only of these.
   */
  labelIds?: Array<string> | null | undefined;
  error: string;
}

// The heading's text, and whether it is in the reader's words already.
interface PageTitle {
  title: string | undefined;
  isTitleTranslated: boolean | undefined;
}

const ModelPage: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  const translator: Translator = useTranslator();
  /*
   * Keyed on the id's string, not the ObjectID: layouts build a new ObjectID
   * from the route params on every render.
   */
  const modelIdString: string = props.modelId.toString();

  const [loadedHeader, setLoadedHeader] = useState<LoadedModelHeader | null>(
    null,
  );

  /*
   * Bumped when a tab below saves this record's name or labels
   * (ModelHeaderEvents) - a refresh like a refreshToken bump, for the
   * layouts that do not pass one.
   */
  const [headerChangeCount, setHeaderChangeCount] = useState<number>(0);

  useEffect(() => {
    return subscribeToModelHeaderChanged({
      modelType: props.modelType,
      modelId: props.modelId,
      onChanged: (): void => {
        setHeaderChangeCount((count: number): number => {
          return count + 1;
        });
      },
    });
  }, [modelIdString]);

  /*
   * Mirrors loadedHeader, so a read that finishes can see what is on screen
   * now rather than what was on screen when the read started.
   */
  const loadedHeaderRef: MutableRefObject<LoadedModelHeader | null> =
    useRef<LoadedModelHeader | null>(null);

  type ShowHeaderFunction = (header: LoadedModelHeader) => void;

  const showHeader: ShowHeaderFunction = (header: LoadedModelHeader): void => {
    loadedHeaderRef.current = header;
    setLoadedHeader(header);
  };

  type IsShowingHeaderForFunction = (modelId: string) => boolean;

  /*
   * Whether a failed read of this model is a refresh of a header already on
   * screen, which it must then leave alone. A refresh that fails - a network
   * blip, a timeout - would otherwise replace the title, the labels and the
   * whole page below them with an error, for a model the reader could see a
   * moment ago. Only a header that loaded without an error counts, so a page
   * showing an error still recovers on the next refresh.
   */
  const isShowingHeaderFor: IsShowingHeaderForFunction = (
    modelId: string,
  ): boolean => {
    const headerOnScreen: LoadedModelHeader | null = loadedHeaderRef.current;

    return (
      headerOnScreen !== null &&
      headerOnScreen.modelId === modelId &&
      !headerOnScreen.error
    );
  };

  /*
   * Bumped by every fetch, when the model changes and on unmount. A response
   * only lands while no newer fetch has started, so a slow read of the model
   * the reader already left can never put its title back on the page.
   */
  const latestRequestRef: MutableRefObject<number> = useRef<number>(0);

  type FetchItemFunction = (modelId: ObjectID) => Promise<void>;

  const fetchItem: FetchItemFunction = async (
    modelId: ObjectID,
  ): Promise<void> => {
    const requestNumber: number = latestRequestRef.current + 1;
    latestRequestRef.current = requestNumber;

    const requestedModelId: string = modelId.toString();

    let header: LoadedModelHeader = {
      modelId: requestedModelId,
      title: props.title,
      labels: [],
      error: "",
    };

    try {
      const modelInstance: TBaseModel = new props.modelType();
      const labelsColumn: string | null =
        modelInstance.getAccessControlColumn();

      const select: JSONObject = {
        [props.modelNameField]: true,
      };

      if (labelsColumn) {
        select[labelsColumn] = {
          _id: true,
          name: true,
          color: true,
        } as Select<TBaseModel>;
      }

      /*
       * A record its project numbers - an incident, an alert, a scheduled
       * maintenance event, an episode - is headed by its number too, read
       * with its name: whoever may read the one may read the other
       * (RecordNumberColumnsReadLikeTheirName).
       */
      const numberColumns: RecordNumberColumns | null =
        getRecordNumberColumns(modelInstance);

      if (numberColumns) {
        select[numberColumns.numberColumn] = true;
        select[numberColumns.numberWithPrefixColumn] = true;
      }

      const modelAPI: typeof ModelAPI = props.modelAPI || ModelAPI;

      const item: TBaseModel | null = await modelAPI.getItem({
        modelType: props.modelType,
        id: modelId,
        select: select as Select<TBaseModel>,
        requestOptions: {},
      });

      if (!item) {
        header = {
          ...header,
          error: translator.translateTemplate(
            "Cannot load {{itemName}}. It could be because you don't have enough permissions to read this {{itemName}}.",
            {
              itemName: translatableTerm(modelInstance.singularName || "item", {
                inSentence: true,
              }),
            },
          ),
        };
      } else {
        let loadedLabels: Array<Label> = [];

        if (labelsColumn) {
          const columnValue: Array<Label> | null = (
            item as BaseModel
          ).getColumnValue(labelsColumn) as Array<Label> | null;

          loadedLabels =
            columnValue || ((item as any)[labelsColumn] as Array<Label>) || [];
        }

        const recordName: unknown = (item as any)[props.modelNameField];

        header = {
          ...header,
          labels: loadedLabels,
          labelIds: labelsColumn ? getRecordLabelIds(item, labelsColumn) : null,
          headingName: `${recordName as string}`,
          recordName: typeof recordName === "string" ? recordName : undefined,
          recordNumber: getRecordNumber(item, numberColumns),
        };
      }
    } catch (err) {
      header = {
        ...header,
        labels: [],
        error: API.getFriendlyMessage(err),
      };
    }

    // The reader moved to another model (or left) while this was in flight.
    if (requestNumber !== latestRequestRef.current) {
      return;
    }

    if (header.error && isShowingHeaderFor(requestedModelId)) {
      return;
    }

    showHeader(header);
  };

  /*
   * A refreshToken bump reads the same model again. The header keeps its id
   * stamp while it does, so the page below is never unmounted by a refresh;
   * only a different id takes the page back to the loader.
   */
  useEffect(() => {
    fetchItem(props.modelId).catch((err: Error) => {
      if (isShowingHeaderFor(modelIdString)) {
        return;
      }

      showHeader({
        modelId: modelIdString,
        title: props.title,
        labels: [],
        error: API.getFriendlyMessage(err),
      });
    });

    return () => {
      latestRequestRef.current++;
    };
  }, [modelIdString, props.refreshToken, headerChangeCount]);

  /*
   * Decided at render time, not in an effect: the very first render for a
   * different model already shows the loader, so the children (which read the
   * id from the route) are unmounted before they can render or fetch for the
   * new model under the old one's header. Layouts keep ModelPage mounted when
   * the reader follows a link to another record on the same route, so this is
   * the only place that can notice.
   */
  const isCurrentModelLoaded: boolean =
    loadedHeader !== null && loadedHeader.modelId === modelIdString;

  const labels: Array<Label> = isCurrentModelLoaded ? loadedHeader!.labels : [];

  /*
   * "Network Device - sw-core-01": the page's title in the reader's
   * language, then the record's name as typed. The two used to be glued
   * into one English string that no locale could look up, so every record
   * page's heading read English in every language ("Network Device" in
   * German). Put together when drawn, so it follows a change of language.
   *
   * Looked up once (#8224): the title is looked up here, in the sentence -
   * or put in it as given, when the page says it is in the reader's words
   * already - and Page is told the sentence is translated, as it is the
   * record's name alone, which is drawn as typed. Page looked the whole
   * sentence up again, and a record's name with it.
   */
  const getLoadedTitle: (header: LoadedModelHeader) => PageTitle = (
    header: LoadedModelHeader,
  ): PageTitle => {
    if (header.headingName === undefined) {
      return {
        title: header.title,
        isTitleTranslated: props.isTitleTranslated,
      };
    }

    if (!props.title) {
      return { title: header.headingName, isTitleTranslated: true };
    }

    return {
      title: translator.translateTemplate(PAGE_RECORD_TITLE_SENTENCE, {
        title: props.isTitleTranslated
          ? props.title
          : translatableTerm(props.title),
        name: header.headingName,
      }),
      isTitleTranslated: true,
    };
  };

  const pageTitle: PageTitle = isCurrentModelLoaded
    ? getLoadedTitle(loadedHeader!)
    : { title: props.title, isTitleTranslated: props.isTitleTranslated };

  const shownHeader: LoadedModelHeader | null =
    isCurrentModelLoaded && !loadedHeader!.error ? loadedHeader : null;

  /*
   * "INC-18 Manually declared": a numbered record's page is headed by its
   * number and its name, the number first, in place of "Incident -
   * Manually declared" - two incidents can share a title, never a number.
   * Without a number (a record from before numbers) it reads as before.
   */
  const recordHeading: PageRecordHeading | undefined =
    shownHeader &&
    shownHeader.recordNumber &&
    shownHeader.recordName &&
    shownHeader.recordName.trim()
      ? { number: shownHeader.recordNumber, name: shownHeader.recordName }
      : undefined;

  /*
   * "Cloud Environment - prod-eu-1": drawn with the name set apart from
   * the title around it (Page's recordTitle), so a Persian heading keeps
   * the name's digits in their place. Its text is getLoadedTitle's.
   */
  const recordTitle: PageRecordTitle | undefined =
    !recordHeading &&
    shownHeader &&
    props.title &&
    shownHeader.headingName !== undefined &&
    shownHeader.headingName.trim()
      ? {
          title: props.title,
          isTitleTranslated: props.isTitleTranslated,
          name: shownHeader.headingName,
        }
      : undefined;

  /*
   * "Project > Monitors > Website: acme.com", not "> View Monitor": the crumb
   * that stands for this record, and the browser tab, name it once it is
   * read (RecordNameInTrail) - a numbered record by its number and its name,
   * "Project > Incidents > INC-18 Manually declared".
   */
  const breadcrumbLinks: Array<Link> | undefined = nameRecordInTrail({
    links: props.breadcrumbLinks,
    recordId: modelIdString,
    recordName: shownHeader ? shownHeader.recordName : undefined,
    recordNumber: shownHeader ? shownHeader.recordNumber : undefined,
  });

  /*
   * WHAT THE RECORD'S LABELS LOCK ON ITS PAGES (#11259): a reader whose
   * permission to change or delete records of this kind is limited to some
   * labels, or blocked on some, sees the record's Edit and Delete - and
   * every other gate on its pages that asks about the record
   * (usePrivateRecordGateOptions) - locked where the server would refuse
   * them, with why (Utils/RecordLabelLock). Read with the header, which
   * reads the labels already; asked again with it when the record's labels
   * are saved (ModelHeaderEvents). An answer the server gave for the record
   * (RecordAccessScopeProvider, around an incident's pages) stands for the
   * tables it answers.
   */
  const pageModel: TBaseModel = new props.modelType();
  const labelLock: ModelLabelLock | null =
    PermissionGate.getLabelLock(pageModel);
  const lockLabelNames: ReadonlyMap<string, string> = useLabelNames(
    labelLock ? labelLock.labelIds : [],
  );
  const outerRecordAccess: RecordAccessScope | null = useRecordAccessScope();

  const labelAccess: RecordAccessScope | null = getRecordLabelAccessScope({
    tableName: pageModel.tableName,
    recordId: modelIdString,
    lock: labelLock,
    recordLabelIds: shownHeader ? shownHeader.labelIds || null : null,
    nouns: {
      singularName: pageModel.singularName || "",
      pluralName: pageModel.pluralName || "",
    },
    labelNames: lockLabelNames,
    translator: translator,
  });

  /*
   * The same object while what it says stays the same, so a gate that keeps
   * what it worked out from it (usePrivateRecordGateOptions) keeps it.
   */
  const labelAccessKey: string = labelAccess
    ? JSON.stringify(labelAccess.tables)
    : "";

  const recordAccess: RecordAccessScope | null = useMemo(() => {
    return mergeRecordAccessScopes(outerRecordAccess, labelAccess);
  }, [outerRecordAccess, labelAccessKey]);

  return (
    <Page
      {...props}
      breadcrumbLinks={breadcrumbLinks}
      labels={labels.length > 0 ? labels : undefined}
      isLoading={!isCurrentModelLoaded}
      error={isCurrentModelLoaded ? loadedHeader!.error : ""}
      title={pageTitle.title}
      isTitleTranslated={pageTitle.isTitleTranslated}
      recordHeading={recordHeading}
      recordTitle={recordTitle}
    >
      <RecordAccessScopeContext.Provider value={recordAccess}>
        {props.children}
      </RecordAccessScopeContext.Provider>
    </Page>
  );
};

export default ModelPage;
