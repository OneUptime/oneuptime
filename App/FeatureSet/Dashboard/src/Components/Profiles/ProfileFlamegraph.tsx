import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { APP_API_URL } from "Common/UI/Config";
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import ProfileUtil from "../../Utils/ProfileUtil";
import FlamegraphView, {
  FlamegraphNode,
  ServerFlamegraphNode,
  normaliseServerFlamegraphNode,
} from "./FlamegraphView";

export interface ProfileFlamegraphProps {
  profileId: string;
  profileType?: string | undefined;
  unit?: string | undefined;
  /**
   * Forwarded to {@link FlamegraphView}; enables the "Callers &
   * callees" affordance on the zoomed frame.
   */
  onFocusFunction?:
    | ((frame: { functionName: string; fileName: string }) => void)
    | undefined;
}

/**
 * Fetches the pre-built flame graph tree for a single profile from the
 * server. The server merges stacks across all of the profile's samples
 * — doing that client-side would mean shipping every raw sample over
 * the wire and re-implementing the tree builder. The actual rendering
 * lives in {@link FlamegraphView}.
 */
const ProfileFlamegraph: FunctionComponent<ProfileFlamegraphProps> = (
  props: ProfileFlamegraphProps,
): ReactElement => {
  const [serverRoot, setServerRoot] = useState<ServerFlamegraphNode | null>(
    null,
  );
  const [isTruncated, setIsTruncated] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  /*
   * The selector pill stores either a category (e.g. "cpu") or a raw
   * type — expand it to the raw type strings agents actually emit so
   * the server filters with IN (...) instead of a literal equality
   * that would miss rows.
   */
  const queryProfileTypes: Array<string> | undefined =
    ProfileUtil.getQueryProfileTypes(props.profileType);

  const unit: string =
    props.unit ||
    (queryProfileTypes && queryProfileTypes.length > 0
      ? ProfileUtil.getProfileTypeUnit(queryProfileTypes[0]!)
      : "nanoseconds");

  /*
   * Generation counter guards every fetch — including manual retries —
   * so a slow stale response can never overwrite a newer one, and no
   * setState fires after the props that started it are gone.
   */
  const loadGenerationRef: React.MutableRefObject<number> = useRef<number>(0);

  const load: (generation: number) => Promise<void> = async (
    generation: number,
  ): Promise<void> => {
    try {
      setIsLoading(true);
      setError("");

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/telemetry/profiles/flamegraph",
          ),
          data: {
            profileId: props.profileId,
            profileTypes: queryProfileTypes,
          },
          headers: {
            ...ModelAPI.getCommonHeaders(),
          },
        });

      if (generation !== loadGenerationRef.current) {
        return;
      }

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      const root: ServerFlamegraphNode = response.data[
        "flamegraph"
      ] as unknown as ServerFlamegraphNode;
      setServerRoot(root);
      setIsTruncated(Boolean(response.data["truncated"]));
    } catch (err) {
      if (generation === loadGenerationRef.current) {
        setError(API.getFriendlyMessage(err));
      }
    } finally {
      if (generation === loadGenerationRef.current) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    loadGenerationRef.current += 1;
    void load(loadGenerationRef.current);
    return () => {
      // Invalidate in-flight responses when scope changes or we unmount.
      loadGenerationRef.current += 1;
    };
  }, [props.profileId, props.profileType]);

  const root: FlamegraphNode = useMemo(() => {
    return normaliseServerFlamegraphNode(serverRoot);
  }, [serverRoot]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }
  if (error) {
    return (
      <ErrorMessage
        message={error}
        onRefreshClick={() => {
          loadGenerationRef.current += 1;
          void load(loadGenerationRef.current);
        }}
      />
    );
  }

  return (
    <FlamegraphView
      root={root}
      unit={unit}
      truncated={isTruncated}
      onFocusFunction={props.onFocusFunction}
    />
  );
};

export default ProfileFlamegraph;
