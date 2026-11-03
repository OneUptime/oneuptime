import ExpoModulesCore
import UIKit

/// Follows where the app's window folds - the division regions UIKit reports
/// for a phone like the iPhone Duo - and how the hinge is set, and keeps the
/// latest report so `getFolds()` can answer synchronously.
///
/// UIKit has said this only since the iOS 27.1 SDK, on iOS 27.1 and later:
/// built with an older SDK, or run on an older iOS, nothing is reported, and
/// JavaScript keeps the layout the window's size gives it. The guard, and the
/// way the hinge interaction is set up, are those of Expo's own `expo-hinge`.
internal final class FoldObserver {
  var onChange: (([String: Any]) -> Void)?

  private let lock = NSLock()
  private var currentReport: [String: Any]?
  private var currentHinge: HingeReading?
  private var probe: UIView?

  var report: [String: Any]? {
    lock.lock()
    defer { lock.unlock() }
    return currentReport
  }

  var hinge: HingeReading? {
    lock.lock()
    defer { lock.unlock() }
    return currentHinge
  }

  /// Starts following the key window, or the one that replaced it.
  @MainActor
  func attach() {
    #if canImport(UIKit, _version: 9127.0.85) // iOS 27.1 SDK
    guard #available(iOS 27.1, *), let window = SceneGeometry.keyWindow() else {
      return
    }
    if let probe, probe.window === window {
      return
    }
    detach()
    let probe = FoldProbeView(frame: window.bounds)
    probe.readHinge = { [weak self] in
      return self?.hinge
    }
    probe.onReport = { [weak self] report in
      self?.publish(report)
    }
    let interaction = UIHingeInteraction { [weak self] _, update in
      self?.updateHinge(update.hinge.map { hinge in HingeReading(hinge) })
    }
    probe.addInteraction(interaction)
    // Behind everything the app draws: it is never seen, touched or read aloud.
    window.insertSubview(probe, at: 0)
    probe.setNeedsUpdateConstraints()
    self.probe = probe
    #endif
  }

  @MainActor
  func detach() {
    probe?.removeFromSuperview()
    probe = nil
    lock.lock()
    currentReport = nil
    currentHinge = nil
    lock.unlock()
  }

  /// A new hinge reading: the probe reports again, on the main thread.
  private func updateHinge(_ reading: HingeReading?) {
    lock.lock()
    currentHinge = reading
    lock.unlock()
    DispatchQueue.main.async { [weak self] in
      self?.probe?.setNeedsUpdateConstraints()
    }
  }

  private func publish(_ report: [String: Any]) {
    lock.lock()
    currentReport = report
    lock.unlock()
    onChange?(report)
  }
}

#if canImport(UIKit, _version: 9127.0.85) // iOS 27.1 SDK
/// An invisible view across the whole window that reads the window's division
/// regions where Apple says to: UIKit tracks the regions a view reads in
/// `updateConstraints()`, and calls it again when they change - the phone
/// half closed, opened flat, a fold appearing in a resized window. A new
/// hinge reading or a new window size asks for a new report too.
@available(iOS 27.1, *)
private final class FoldProbeView: UIView {
  var onReport: (([String: Any]) -> Void)?
  var readHinge: (() -> HingeReading?)?
  private var reportedSize: CGSize?

  override init(frame: CGRect) {
    super.init(frame: frame)
    isUserInteractionEnabled = false
    isAccessibilityElement = false
    accessibilityElementsHidden = true
    backgroundColor = .clear
    autoresizingMask = [.flexibleWidth, .flexibleHeight]
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override class var requiresConstraintBasedLayout: Bool {
    return true
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    // Only a new size asks again: asking on every layout would never settle.
    if reportedSize != bounds.size {
      setNeedsUpdateConstraints()
    }
  }

  override func updateConstraints() {
    let divisions: [DivisionRegion] = reservedRegions(
      kind: .division,
      options: .includeInactive
    ).map { region in
      DivisionRegion(frame: region.frame, isActive: region.isActive)
    }
    reportedSize = bounds.size
    onReport?(
      describeFolds(
        windowSize: bounds.size,
        divisions: divisions,
        hinge: readHinge?()
      )
    )
    super.updateConstraints()
  }
}

@available(iOS 27.1, *)
extension HingeReading {
  init(_ hinge: UIHinge) {
    switch hinge.status {
    case .closed:
      self = .closed
    case .partiallyOpen:
      self = .partiallyOpen
    case .fullyOpen:
      self = .fullyOpen
    case .unknown:
      self = .unknown
    @unknown default:
      self = .unknown
    }
  }
}
#endif
