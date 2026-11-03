// swift-tools-version:5.9
import PackageDescription

// The report the iOS side builds (Sources/FoldReport.swift), tested on its
// own: on a Mac with `swift test`, or anywhere Swift's toolchain runs - the
// module's README has the Docker command. The module itself is built by
// CocoaPods with the app (WindowPosture.podspec); this package never ships,
// and its target leaves out the files that need UIKit and Expo.
let package = Package(
  name: "WindowPostureReport",
  targets: [
    .target(
      name: "WindowPostureReport",
      path: "Sources",
      exclude: ["FoldObserver.swift", "WindowPostureModule.swift"],
      sources: ["FoldReport.swift"]
    ),
    .testTarget(
      name: "WindowPostureReportTests",
      dependencies: ["WindowPostureReport"],
      path: "Tests"
    ),
  ]
)
