import UserUtil from "../../Utils/User";
import React, {
  FunctionComponent,
  ReactElement,
  SyntheticEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * Private inline images (pasted into notes, postmortems, runbooks) are served
 * from this route, and only to a request that carries a session.
 */
export const PRIVATE_IMAGE_ROUTE_SEGMENT: string = "/image/access-token/";

export const isPrivateImageUrl: (src: unknown) => boolean = (
  src: unknown,
): boolean => {
  return typeof src === "string" && src.includes(PRIVATE_IMAGE_ROUTE_SEGMENT);
};

export const withCacheBuster: (src: string, value: string) => string = (
  src: string,
  value: string,
): string => {
  return `${src}${src.includes("?") ? "&" : "?"}sessionRetry=${encodeURIComponent(value)}`;
};

export type RefreshSessionFunction = () => Promise<boolean>;

/*
 * Which session an image may refresh is the app's decision, not this
 * component's: the same markdown renders on status pages and public
 * dashboards, where a failed dashboard refresh would log the reader out and
 * send them to the dashboard's login page - and on a status page served from
 * the OneUptime host that shares the dashboard's storage, "signed in" in local
 * storage does not tell the two apart. So nothing is refreshed unless the app
 * has registered its refresh here (the Dashboard and Admin Dashboard do, at
 * startup) or the caller passes one.
 */
let appRefreshSession: RefreshSessionFunction | null = null;

export const enablePrivateImageSessionRefresh: (
  refreshSession: RefreshSessionFunction | null,
) => void = (refreshSession: RefreshSessionFunction | null): void => {
  appRefreshSession = refreshSession;
};

export interface ComponentProps
  extends React.ImgHTMLAttributes<HTMLImageElement> {
  refreshSession?: RefreshSessionFunction | undefined;
  isSignedIn?: (() => boolean) | undefined;
}

/*
 * An <img> cannot refresh an expired session the way a request through the API
 * class does: once the access-token cookie lapses, a private image comes back
 * 404 and stays broken until something else happens to refresh the session.
 * So on the first failure of a private image, refresh once and load it again -
 * where the app has opted in (see enablePrivateImageSessionRefresh) and the
 * user is signed in.
 */
const SessionAwareImage: FunctionComponent<ComponentProps> = ({
  refreshSession,
  isSignedIn,
  onError,
  src,
  ...imageProps
}: ComponentProps): ReactElement => {
  const [currentSrc, setCurrentSrc] = useState<string | undefined>(src);
  const hasRetriedRef: React.MutableRefObject<boolean> = useRef(false);

  // A new source is a new image, with its own one retry.
  useEffect(() => {
    setCurrentSrc(src);
    hasRetriedRef.current = false;
  }, [src]);

  const handleError: (event: SyntheticEvent<HTMLImageElement>) => void =
    useCallback(
      (event: SyntheticEvent<HTMLImageElement>): void => {
        const signedIn: boolean = isSignedIn
          ? isSignedIn()
          : UserUtil.isLoggedIn();

        const refresh: RefreshSessionFunction | null =
          refreshSession || appRefreshSession;

        if (
          !refresh ||
          hasRetriedRef.current ||
          !isPrivateImageUrl(src) ||
          !signedIn
        ) {
          onError?.(event);
          return;
        }

        hasRetriedRef.current = true;

        void refresh()
          .then((refreshed: boolean) => {
            if (refreshed && typeof src === "string") {
              setCurrentSrc(withCacheBuster(src, Date.now().toString()));
              return;
            }

            onError?.(event);
          })
          .catch(() => {
            onError?.(event);
          });
      },
      [src, onError, refreshSession, isSignedIn],
    );

  return <img {...imageProps} src={currentSrc} onError={handleError} />;
};

export default SessionAwareImage;
