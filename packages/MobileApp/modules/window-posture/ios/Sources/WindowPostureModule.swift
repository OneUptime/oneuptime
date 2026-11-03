import ExpoModulesCore

private let foldsChangeEvent = "foldsChange"

/// Tells the app where its window folds (src/layout/postureSource.ts): the
/// division regions UIKit reports for a phone like the iPhone Duo, with the
/// hinge and the window's size, in points - the report the Android side
/// builds from Jetpack WindowManager.
///
/// `getFolds()` returns the latest report, or nil before the first one - and
/// always on an iOS or an SDK older than 27.1 - and `foldsChange` carries
/// every later one: the phone half closed or opened flat, a rotation, a
/// resize.
public class WindowPostureModule: Module {
  private let observer = FoldObserver()
  private var hasListeners = false

  public func definition() -> ModuleDefinition {
    Name("OneUptimeWindowPosture")

    Events(foldsChangeEvent)

    Function("getFolds") { () -> [String: Any]? in
      return observer.report
    }

    OnCreate {
      observer.onChange = { [weak self] report in
        guard let self, self.hasListeners else {
          return
        }
        self.sendEvent(
          foldsChangeEvent,
          report.mapValues { value in
            Optional(value)
          }
        )
      }
      Task { @MainActor in
        observer.attach()
      }
    }

    // The key window may not exist yet when the module is created, and a scene reconnect replaces it.
    OnAppBecomesActive {
      Task { @MainActor in
        observer.attach()
      }
    }

    OnDestroy {
      Task { @MainActor in
        observer.detach()
      }
    }

    OnStartObserving(foldsChangeEvent) {
      hasListeners = true
    }

    OnStopObserving(foldsChangeEvent) {
      hasListeners = false
    }
  }
}
