import Foundation

/// One division region of the app's window, as UIKit reports it
/// (`UIView.ReservedRegion` of kind `.division`): where it lies in the window,
/// in points, the margins UIKit keeps clear around the fold included, and
/// whether it divides the window right now.
struct DivisionRegion: Equatable {
  let frame: CGRect
  let isActive: Bool
}

/// The hinge, as `UIHingeInteraction` reports it.
enum HingeReading: String, Equatable {
  case closed
  case partiallyOpen
  case fullyOpen
  case unknown
}

/// The report JavaScript reads (src/layout/windowPosture.ts, parseFoldReport):
/// the window's size and each fold's bounds in points, the units React Native
/// lays the app out in, with the fold's direction and whether it splits the
/// window - the same report the Android side builds (FoldReport.kt).
///
/// - A division UIKit reports as active splits the window: the phone is half
///   open, like a book or on a table. Its `isActive` can lag the hinge by an
///   update, so once the hinge says the phone is fully open, the fold no
///   longer splits the window, whatever the region still says.
/// - An inactive division is the fold of a phone opened flat: it is kept, as
///   Android keeps a flat fold, so the divider can settle on its line.
/// - A division runs the way it is longest: top to bottom is a book's fold,
///   side to side a laptop's.
/// - A region with no usable frame is left out, as JavaScript would drop it.
///
/// The window's size travels with the folds so JavaScript can tell a report
/// made for this window from one made a moment before a rotation or a resize.
func describeFolds(
  windowSize: CGSize,
  divisions: [DivisionRegion],
  hinge: HingeReading?
) -> [String: Any] {
  let folds: [[String: Any]] = divisions.compactMap { region in
    let frame: CGRect = region.frame.standardized
    guard
      frame.origin.x.isFinite, frame.origin.y.isFinite,
      frame.size.width.isFinite, frame.size.height.isFinite
    else {
      return nil
    }
    let vertical: Bool = frame.size.height >= frame.size.width
    let separating: Bool = region.isActive && hinge != .fullyOpen
    return [
      "x": Double(frame.origin.x),
      "y": Double(frame.origin.y),
      "width": Double(frame.size.width),
      "height": Double(frame.size.height),
      "orientation": vertical ? "vertical" : "horizontal",
      "separating": separating,
    ]
  }

  return [
    "windowWidth": Double(windowSize.width),
    "windowHeight": Double(windowSize.height),
    "folds": folds,
  ]
}
