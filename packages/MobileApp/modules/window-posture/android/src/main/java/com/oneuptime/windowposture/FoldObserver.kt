package com.oneuptime.windowposture

import android.app.Activity
import androidx.annotation.MainThread
import androidx.window.layout.FoldingFeature
import androidx.window.layout.WindowInfoTracker
import androidx.window.layout.WindowLayoutInfo
import androidx.window.layout.WindowMetricsCalculator
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import java.lang.ref.WeakReference

/**
 * Follows the folding features of the current activity's window through
 * Jetpack WindowManager, and keeps the latest report so `getFolds()` can
 * answer synchronously. WindowManager reports a fold only while the window
 * spans it - never on a closed phone's cover screen - and reports the
 * window's current features as soon as collection starts, so the first
 * report arrives right after the activity is attached.
 */
internal class FoldObserver {
  var onChange: ((Map<String, Any?>) -> Unit)? = null

  @Volatile
  var report: Map<String, Any?>? = null
    private set

  private var activity: WeakReference<Activity>? = null
  private var windowLayoutJob: Job? = null

  @MainThread
  fun attach(activity: Activity, scope: CoroutineScope) {
    if (windowLayoutJob?.isActive == true && this.activity?.get() === activity) {
      return
    }
    pause()
    this.activity = WeakReference(activity)
    windowLayoutJob = scope.launch {
      WindowInfoTracker.getOrCreate(activity).windowLayoutInfo(activity).collect { layoutInfo ->
        publish(activity, layoutInfo)
      }
    }
  }

  /** Stops following the window but keeps the last report; attaching again reports afresh. */
  fun pause() {
    windowLayoutJob?.cancel()
    windowLayoutJob = null
    activity = null
  }

  fun detach() {
    pause()
    report = null
  }

  private fun publish(activity: Activity, layoutInfo: WindowLayoutInfo) {
    val windowBounds = WindowMetricsCalculator.getOrCreate()
      .computeCurrentWindowMetrics(activity)
      .bounds
    val folds = layoutInfo.displayFeatures
      .filterIsInstance<FoldingFeature>()
      .map { feature ->
        FoldBounds(
          left = feature.bounds.left,
          top = feature.bounds.top,
          right = feature.bounds.right,
          bottom = feature.bounds.bottom,
          vertical = feature.orientation == FoldingFeature.Orientation.VERTICAL,
          separating = feature.isSeparating
        )
      }
    val next = describeFolds(
      windowBounds.width(),
      windowBounds.height(),
      activity.resources.displayMetrics.density,
      folds
    )
    report = next
    onChange?.invoke(next)
  }
}
