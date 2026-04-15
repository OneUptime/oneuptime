import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import ProfileSample from "Common/Models/AnalyticsModels/ProfileSample";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ProfileUtil, { ParsedStackFrame } from "../../Utils/ProfileUtil";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FlamegraphView, { FlamegraphNode } from "./FlamegraphView";

export interface ProfileFlamegraphProps {
  profileId: string;
  profileType?: string | undefined;
  unit?: string | undefined;
}

/**
 * Loads samples for a single profile and builds a flame graph tree
 * client-side. The actual rendering lives in {@link FlamegraphView}.
 */
const ProfileFlamegraph: FunctionComponent<ProfileFlamegraphProps> = (
  props: ProfileFlamegraphProps,
): ReactElement => {
  const [samples, setSamples] = useState<Array<ProfileSample>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const unit: string =
    props.unit ||
    (props.profileType
      ? ProfileUtil.getProfileTypeUnit(props.profileType)
      : "nanoseconds");

  const loadSamples: () => Promise<void> = async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError("");

      const result: ListResult<ProfileSample> = await AnalyticsModelAPI.getList(
        {
          modelType: ProfileSample,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
            profileId: props.profileId,
            ...(props.profileType ? { profileType: props.profileType } : {}),
          },
          select: {
            stacktrace: true,
            frameTypes: true,
            value: true,
            profileType: true,
          },
          limit: 10000,
          skip: 0,
          sort: {
            value: SortOrder.Descending,
          },
        },
      );

      setSamples(result.data || []);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadSamples();
  }, [props.profileId, props.profileType]);

  const root: FlamegraphNode = useMemo(() => {
    return buildTreeFromSamples(samples);
  }, [samples]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }
  if (error) {
    return (
      <ErrorMessage
        message={error}
        onRefreshClick={() => {
          void loadSamples();
        }}
      />
    );
  }

  return <FlamegraphView root={root} unit={unit} />;
};

/**
 * Build a flame graph tree from raw ProfileSample records. Each
 * sample's stacktrace is walked root→leaf and merged into the shared
 * tree. Nodes with the same (name, file, line) at the same position
 * merge into one.
 */
function buildTreeFromSamples(
  samples: Array<ProfileSample>,
): FlamegraphNode {
  const root: FlamegraphNode = {
    name: "(all)",
    fileName: "",
    lineNumber: 0,
    frameType: "",
    category: "unknown",
    selfValue: 0,
    totalValue: 0,
    children: [],
  };

  // Temporary index so we can look children up in O(1) by frame string
  // during construction, without mutating the final tree shape.
  const childIndex: WeakMap<FlamegraphNode, Map<string, FlamegraphNode>> =
    new WeakMap();

  const getOrCreateChild: (
    parent: FlamegraphNode,
    frame: string,
    frameType: string,
  ) => FlamegraphNode = (
    parent: FlamegraphNode,
    frame: string,
    frameType: string,
  ): FlamegraphNode => {
    let idx: Map<string, FlamegraphNode> | undefined = childIndex.get(parent);
    if (!idx) {
      idx = new Map<string, FlamegraphNode>();
      childIndex.set(parent, idx);
    }
    const existing: FlamegraphNode | undefined = idx.get(frame);
    if (existing) {
      return existing;
    }
    const parsed: ParsedStackFrame = ProfileUtil.parseStackFrame(frame);
    const node: FlamegraphNode = {
      name: parsed.functionName,
      fileName: parsed.fileName,
      lineNumber: parsed.lineNumber,
      frameType,
      category: ProfileUtil.getModuleCategory(parsed.fileName),
      selfValue: 0,
      totalValue: 0,
      children: [],
    };
    parent.children.push(node);
    idx.set(frame, node);
    return node;
  };

  for (const sample of samples) {
    const stacktrace: Array<string> = sample.stacktrace || [];
    const frameTypes: Array<string> = sample.frameTypes || [];
    const value: number = sample.value || 0;

    root.totalValue += value;

    let currentNode: FlamegraphNode = root;
    for (let i: number = 0; i < stacktrace.length; i++) {
      const frame: string = stacktrace[i]!;
      const frameType: string =
        i < frameTypes.length ? frameTypes[i]! : "unknown";
      const child: FlamegraphNode = getOrCreateChild(
        currentNode,
        frame,
        frameType,
      );
      child.totalValue += value;
      if (i === stacktrace.length - 1) {
        child.selfValue += value;
      }
      currentNode = child;
    }
  }

  return root;
}

export default ProfileFlamegraph;
