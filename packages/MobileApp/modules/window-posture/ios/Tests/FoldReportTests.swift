import Foundation
import XCTest

@testable import WindowPostureReport

/// The report JavaScript reads, from what UIKit says about the window's
/// division regions and the hinge. The JavaScript side
/// (src/layout/windowPosture.test.ts) reads these same shapes, and the
/// Android side builds them too (FoldReportTest.kt).
final class FoldReportTests: XCTestCase {
  // The iPhone Duo held open: 951 x 669 points, its fold a 40-point band down the middle.
  private let duoOpen: CGSize = CGSize(width: 951, height: 669)
  private let duoFold: CGRect = CGRect(x: 455.5, y: 0, width: 40, height: 669)

  private func folds(_ report: [String: Any]) -> [[String: Any]] {
    return report["folds"] as? [[String: Any]] ?? []
  }

  func testHalfOpenLikeABookTheFoldSplitsTheWindowTopToBottom() {
    let report: [String: Any] = describeFolds(
      windowSize: duoOpen,
      divisions: [DivisionRegion(frame: duoFold, isActive: true)],
      hinge: .partiallyOpen
    )

    XCTAssertEqual(report["windowWidth"] as? Double, 951)
    XCTAssertEqual(report["windowHeight"] as? Double, 669)
    let fold: [String: Any] = folds(report)[0]
    XCTAssertEqual(fold["x"] as? Double, 455.5)
    XCTAssertEqual(fold["y"] as? Double, 0)
    XCTAssertEqual(fold["width"] as? Double, 40)
    XCTAssertEqual(fold["height"] as? Double, 669)
    XCTAssertEqual(fold["orientation"] as? String, "vertical")
    XCTAssertEqual(fold["separating"] as? Bool, true)
  }

  func testHalfOpenOnATableTheFoldRunsSideToSide() {
    // The same phone on its side, half closed like a laptop.
    let report: [String: Any] = describeFolds(
      windowSize: CGSize(width: 669, height: 951),
      divisions: [
        DivisionRegion(
          frame: CGRect(x: 0, y: 455.5, width: 669, height: 40),
          isActive: true
        )
      ],
      hinge: .partiallyOpen
    )

    let fold: [String: Any] = folds(report)[0]
    XCTAssertEqual(fold["orientation"] as? String, "horizontal")
    XCTAssertEqual(fold["y"] as? Double, 455.5)
    XCTAssertEqual(fold["height"] as? Double, 40)
    XCTAssertEqual(fold["separating"] as? Bool, true)
  }

  func testOpenedFlatTheFoldIsKeptButNoLongerSplitsTheWindow() {
    // Inactive while the phone lies flat: kept, so the divider can settle on its line.
    let report: [String: Any] = describeFolds(
      windowSize: duoOpen,
      divisions: [DivisionRegion(frame: duoFold, isActive: false)],
      hinge: .fullyOpen
    )

    XCTAssertEqual(folds(report).count, 1)
    XCTAssertEqual(folds(report)[0]["separating"] as? Bool, false)
  }

  func testAHingeAlreadyFullyOpenOutranksARegionThatStillSaysActive() {
    // UIKit's isActive can lag the hinge by an update.
    let report: [String: Any] = describeFolds(
      windowSize: duoOpen,
      divisions: [DivisionRegion(frame: duoFold, isActive: true)],
      hinge: .fullyOpen
    )

    XCTAssertEqual(folds(report)[0]["separating"] as? Bool, false)
  }

  func testWithNoHingeReportedTheRegionAloneSays() {
    for (isActive, expected) in [(true, true), (false, false)] {
      let report: [String: Any] = describeFolds(
        windowSize: duoOpen,
        divisions: [DivisionRegion(frame: duoFold, isActive: isActive)],
        hinge: nil
      )
      XCTAssertEqual(folds(report)[0]["separating"] as? Bool, expected)
    }
  }

  func testClosedOrUnknownHingeLeavesAnActiveFoldSplitting() {
    for hinge in [HingeReading.closed, .unknown, .partiallyOpen] {
      let report: [String: Any] = describeFolds(
        windowSize: duoOpen,
        divisions: [DivisionRegion(frame: duoFold, isActive: true)],
        hinge: hinge
      )
      XCTAssertEqual(folds(report)[0]["separating"] as? Bool, true)
    }
  }

  func testAWindowThatDoesNotFoldHasNoFolds() {
    // An iPad, an iPhone: UIKit reports no division at all.
    let report: [String: Any] = describeFolds(
      windowSize: CGSize(width: 1180, height: 820),
      divisions: [],
      hinge: nil
    )

    XCTAssertEqual(report["windowWidth"] as? Double, 1180)
    XCTAssertEqual(folds(report).count, 0)
  }

  func testAFrameGivenBackwardsIsReadTheRightWayRound() {
    let report: [String: Any] = describeFolds(
      windowSize: duoOpen,
      divisions: [
        DivisionRegion(
          frame: CGRect(x: 495.5, y: 669, width: -40, height: -669),
          isActive: true
        )
      ],
      hinge: .partiallyOpen
    )

    let fold: [String: Any] = folds(report)[0]
    XCTAssertEqual(fold["x"] as? Double, 455.5)
    XCTAssertEqual(fold["y"] as? Double, 0)
    XCTAssertEqual(fold["width"] as? Double, 40)
    XCTAssertEqual(fold["height"] as? Double, 669)
  }

  func testARegionWithNoUsableFrameIsLeftOut() {
    let report: [String: Any] = describeFolds(
      windowSize: duoOpen,
      divisions: [
        DivisionRegion(
          frame: CGRect(x: CGFloat.infinity, y: 0, width: 40, height: 669),
          isActive: true
        ),
        DivisionRegion(frame: duoFold, isActive: true),
      ],
      hinge: .partiallyOpen
    )

    XCTAssertEqual(folds(report).count, 1)
    XCTAssertEqual(folds(report)[0]["x"] as? Double, 455.5)
  }

  func testTheReportHasExactlyTheKeysJavaScriptReads() {
    let report: [String: Any] = describeFolds(
      windowSize: duoOpen,
      divisions: [DivisionRegion(frame: duoFold, isActive: true)],
      hinge: .partiallyOpen
    )

    XCTAssertEqual(
      Set(report.keys),
      ["windowWidth", "windowHeight", "folds"]
    )
    XCTAssertEqual(
      Set(folds(report)[0].keys),
      ["x", "y", "width", "height", "orientation", "separating"]
    )
  }
}
