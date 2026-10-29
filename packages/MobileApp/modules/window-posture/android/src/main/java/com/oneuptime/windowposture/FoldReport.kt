package com.oneuptime.windowposture

/**
 * One fold of the app's window, in the window's own pixels, as Jetpack
 * WindowManager reports it: its bounds, which way it runs, and whether it
 * splits the window (the device is half open, or the fold is a hinge between
 * two screens).
 */
internal data class FoldBounds(
  val left: Int,
  val top: Int,
  val right: Int,
  val bottom: Int,
  val vertical: Boolean,
  val separating: Boolean
)

/**
 * The report JavaScript reads (src/layout/windowPosture.ts, parseFoldReport):
 * the window's size and each fold's bounds in density-independent points,
 * the units React Native lays the app out in, with the fold's direction and
 * whether it splits the window.
 *
 * The window's size travels with the folds so JavaScript can tell a report
 * made for this window from one made a moment before a rotation or a resize.
 */
internal fun describeFolds(
  windowWidthPx: Int,
  windowHeightPx: Int,
  density: Float,
  folds: List<FoldBounds>
): Map<String, Any?> {
  val scale = if (density > 0f) density.toDouble() else 1.0
  return mapOf(
    "windowWidth" to windowWidthPx / scale,
    "windowHeight" to windowHeightPx / scale,
    "folds" to folds.map { fold ->
      mapOf(
        "x" to fold.left / scale,
        "y" to fold.top / scale,
        "width" to (fold.right - fold.left).coerceAtLeast(0) / scale,
        "height" to (fold.bottom - fold.top).coerceAtLeast(0) / scale,
        "orientation" to if (fold.vertical) "vertical" else "horizontal",
        "separating" to fold.separating
      )
    }
  )
}
