import API from "../../Utils/API/API";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import Page from "./Page";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "../../../Models/DatabaseModels/Label";
import Link from "../../../Types/Link";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import React, {
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import Select from "../../../Server/Types/Database/Select";

export interface ComponentProps<TBaseModel extends BaseModel> {
  title?: string | undefined;
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
  labels: Array<Label>;
  error: string;
}

const ModelPage: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  /*
   * Keyed on the id's string, not the ObjectID: layouts build a new ObjectID
   * from the route params on every render.
   */
  const modelIdString: string = props.modelId.toString();

  const [loadedHeader, setLoadedHeader] = useState<LoadedModelHeader | null>(
    null,
  );

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

      const modelAPI: typeof ModelAPI = props.modelAPI || ModelAPI;

      const item: TBaseModel | null = await modelAPI.getItem({
        modelType: props.modelType,
        id: modelId,
        select: select as Select<TBaseModel>,
        requestOptions: {},
      });

      if (!item) {
        const singularName: string = (
          modelInstance.singularName || "item"
        ).toLowerCase();

        header = {
          ...header,
          error: `Cannot load ${singularName}. It could be because you don't have enough permissions to read this ${singularName}.`,
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

        header = {
          ...header,
          labels: loadedLabels,
          title: `${props.title || ""} - ${
            (item as any)[props.modelNameField] as string
          }`,
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
  }, [modelIdString, props.refreshToken]);

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

  return (
    <Page
      {...props}
      labels={labels.length > 0 ? labels : undefined}
      isLoading={!isCurrentModelLoaded}
      error={isCurrentModelLoaded ? loadedHeader!.error : ""}
      title={isCurrentModelLoaded ? loadedHeader!.title : props.title}
    />
  );
};

export default ModelPage;
