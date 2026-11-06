import { useEffect, useState } from "react";

/*
 * Recommendations set up, dismissed or restored on a page: the
 * Recommendations badge in the side menu beside it counts again, so it
 * never says "16 to set up" over a page that just made them. A window
 * event, as the page and its menu are siblings that share no state.
 */
export const RECOMMENDATIONS_CHANGED_EVENT: string =
  "oneuptime:recommendations-changed";

export function notifyRecommendationsChanged(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(RECOMMENDATIONS_CHANGED_EVENT));
}

/*
 * How many times recommendations changed since the component mounted: a
 * dependency of the effect that counts them, so the count is read again.
 */
export function useRecommendationsChangedCount(): number {
  const [count, setCount] = useState<number>(0);

  useEffect(() => {
    const listener: () => void = (): void => {
      setCount((current: number): number => {
        return current + 1;
      });
    };

    window.addEventListener(RECOMMENDATIONS_CHANGED_EVENT, listener);

    return (): void => {
      window.removeEventListener(RECOMMENDATIONS_CHANGED_EVENT, listener);
    };
  }, []);

  return count;
}
