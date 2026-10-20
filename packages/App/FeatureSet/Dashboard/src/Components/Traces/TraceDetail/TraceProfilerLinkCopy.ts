import { translationKey } from "Common/UI/Utils/TranslateTemplate";

// How far either side of a trace the Profiler link reads.
export const TRACE_PROFILER_WINDOW_MINUTES: number = 15;

export const TRACE_PROFILER_LINK_NAMED: string = translationKey(
  "See where {{service}} spent its time around this trace",
);

export const TRACE_PROFILER_LINK: string = translationKey(
  "See where the service spent its time around this trace",
);
