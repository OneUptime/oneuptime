package com.oneuptime.windowposture

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.launch

private const val FOLDS_CHANGE_EVENT = "foldsChange"

/**
 * Tells the app where its window folds (src/layout/postureSource.ts): Jetpack
 * WindowManager's folding features, with the window's size, in points.
 *
 * `getFolds()` returns the latest report, or null before the first one, and
 * `foldsChange` carries every later one - a fold, an unfold, the phone half
 * closed or opened flat, a rotation, a resize in split screen.
 */
class WindowPostureModule : Module() {
  private val observer = FoldObserver()

  @Volatile
  private var hasListeners = false

  override fun definition() = ModuleDefinition {
    Name("OneUptimeWindowPosture")

    Events(FOLDS_CHANGE_EVENT)

    Function("getFolds") {
      observer.report
    }

    OnCreate {
      observer.onChange = { report ->
        if (hasListeners) {
          sendEvent(FOLDS_CHANGE_EVENT, report)
        }
      }
      attach()
    }

    // The activity may not exist yet when the module is created, and is replaced if it is recreated.
    OnActivityEntersForeground {
      attach()
    }

    OnActivityEntersBackground {
      appContext.mainQueue.launch {
        observer.pause()
      }
    }

    OnDestroy {
      observer.detach()
    }

    OnStartObserving(FOLDS_CHANGE_EVENT) {
      hasListeners = true
    }

    OnStopObserving(FOLDS_CHANGE_EVENT) {
      hasListeners = false
    }
  }

  private fun attach() {
    val activity = appContext.currentActivity ?: return
    appContext.mainQueue.launch {
      observer.attach(activity, appContext.mainQueue)
    }
  }
}
