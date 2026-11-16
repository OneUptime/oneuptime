import { HelpContent } from "Common/UI/Components/Help/HelpContent";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * HOW TO READ A FLAME GRAPH, FOR SOMEONE WHO HAS NEVER READ ONE (#9118).
 *
 * The help dialog's shape (Docs/ux/README.md#help-dialogs): what a flame
 * graph is in short, then one topic per question a newcomer asks, the one
 * they need to act on first. Every sentence is checked against what the
 * flame graph draws (FlamegraphView, Utils/ProfileFlameTree): the colours
 * are its legend's, "No symbols" is its grouped frame, and the window and
 * the comparison are the page's own controls.
 */
export const PROFILE_FLAME_HELP: HelpContent = {
  title: translationKey("How to read a flame graph"),
  description: translationKey(
    "Where the time goes, what to fix first, and what the colours mean.",
  ),
  markdown: `A flame graph merges every profile in the window into one picture of where your code spends its time. Each bar is a function: the wider it is, the bigger its share, and the bars under it are the functions it calls.

## Find what to fix first

Look for wide bars with little or nothing under them: those are the functions doing the work themselves. An orange one is your own code, which you can change directly. A blue (library) or grey (runtime) one is code you call: change how often, or with what, your code calls it. Clicking a function in **Functions** under the graph opens who calls it, what it calls, and **Fix with AI** where it applies.

## Self and total

**Self** is the time spent in a function's own code. **Total** adds everything it calls. A function with a large total and a small self is a doorway, such as a request handler: the time is spent further down. A function with a large self is where the work happens.

## The colours

- **Your code** (orange): the application's own files.
- **Library** (blue): packages your application depends on.
- **Runtime** (grey): the language runtime and its standard library.
- **System** (purple): the kernel and shared system libraries.
- **No symbols** (light grey): code built without symbols.

The hotter a frame of your own code, the deeper its orange.

## No symbols

Native code built without symbols reaches the profiler as bare addresses. The graph groups them into one **No symbols** frame under the function that called them, so they do not hide the code you can read. When a large share of the graph has no symbols, build that binary with debug symbols, or keep its symbol files where the profiler can read them, to see its functions by name.

## Zoom, search and compare

Click a bar to zoom into it, and press Esc to zoom back out. Type in the search box to highlight the functions or files that match. **Compare with** at the top of the page shows what changed against an earlier period or a deploy: red bars take a bigger share after, green ones a smaller one.`,
};
