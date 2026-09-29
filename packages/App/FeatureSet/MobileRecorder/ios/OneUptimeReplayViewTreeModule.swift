import Foundation
import React
import UIKit

@objc(OneUptimeReplayViewTree)
final class OneUptimeReplayViewTreeModule: NSObject {
    private final class TraversalState {
        var visited = 0
        var truncated = 0
    }

    private let maximumTreeDepth = 64
    private let maximumTreeNodes = 5_000
    @objc var bridge: RCTBridge!

    @objc static func requiresMainQueueSetup() -> Bool {
        return true
    }

    @objc(captureViewTree:resolver:rejecter:)
    func captureViewTree(
        _ rootTag: NSNumber,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self,
                  let root = self.bridge.uiManager.view(forReactTag: rootTag) else {
                reject("E_ROOT_VIEW", "Replay root view was not found.", nil)
                return
            }

            let state = TraversalState()
            guard var serialized = self.serialize(
                root,
                relativeTo: root,
                depth: 0,
                isRoot: true,
                state: state
            ) else {
                reject("E_EMPTY_ROOT", "Replay root view could not be serialized.", nil)
                return
            }
            serialized["truncatedNodes"] = state.truncated
            resolve(serialized)
        }
    }

    @objc(getAppMetadata:rejecter:)
    func getAppMetadata(
        _ resolve: RCTPromiseResolveBlock,
        rejecter reject: RCTPromiseRejectBlock
    ) {
        let info = Bundle.main.infoDictionary ?? [:]
        resolve([
            "appName": info["CFBundleDisplayName"] as? String
                ?? info["CFBundleName"] as? String
                ?? "React Native",
            "appVersion": info["CFBundleShortVersionString"] as? String
                ?? "unknown",
            "osName": "ios",
            "osVersion": UIDevice.current.systemVersion,
        ])
    }

    @objc(isTouchTargetPrivate:replayRootTag:resolver:rejecter:)
    func isTouchTargetPrivate(
        _ targetTag: NSNumber,
        replayRootTag: NSNumber,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter _: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self,
                  let target = self.bridge.uiManager.view(forReactTag: targetTag),
                  let replayRoot = self.bridge.uiManager.view(forReactTag: replayRootTag) else {
                resolve(true)
                return
            }

            var current: UIView? = target
            while let view = current {
                if self.isReplayMask(view) || self.isOpaqueView(view) {
                    resolve(true)
                    return
                }
                if view === replayRoot {
                    resolve(false)
                    return
                }
                current = view.superview
            }

            // Stale/out-of-root event targets must never bypass privacy.
            resolve(true)
        }
    }

    private func serialize(
        _ view: UIView,
        relativeTo root: UIView,
        depth: Int,
        isRoot: Bool,
        state: TraversalState
    ) -> [String: Any]? {
        guard depth <= maximumTreeDepth, state.visited < maximumTreeNodes else {
            state.truncated += 1
            return nil
        }
        guard isRoot || (!view.isHidden && view.bounds.width > 0 && view.bounds.height > 0) else {
            return nil
        }
        state.visited += 1
        let frame = view.convert(view.bounds, to: root)
        let masked = view.accessibilityIdentifier == "oneuptime-replay-mask"
        let kind = classify(view, masked: masked)
        let opaque = masked || ["image", "webview", "canvas"].contains(kind)
        var node: [String: Any] = [
            "nativeId": view.reactTag?.intValue ?? ObjectIdentifier(view).hashValue,
            "kind": kind,
            "x": frame.origin.x,
            "y": frame.origin.y,
            "width": frame.size.width,
            "height": frame.size.height,
            "masked": masked,
            "opaque": opaque,
            "opacity": view.alpha,
            "zIndex": view.layer.zPosition,
        ]

        if isRoot {
            if let reactTouchRoot = findReactTouchRoot(from: view) {
                let touchFrame = view.convert(view.bounds, to: reactTouchRoot)
                node["touchOriginX"] = touchFrame.origin.x
                node["touchOriginY"] = touchFrame.origin.y
            }
        }

        if let background = view.backgroundColor, let css = cssColor(background) {
            node["backgroundColor"] = css
        }
        if let border = view.layer.borderColor, let css = cssColor(UIColor(cgColor: border)) {
            node["borderColor"] = css
            node["borderWidth"] = view.layer.borderWidth
        }
        if view.layer.cornerRadius > 0 {
            node["borderRadius"] = view.layer.cornerRadius
        }
        node["children"] = opaque
            ? []
            : view.subviews.compactMap {
                self.serialize(
                    $0,
                    relativeTo: view,
                    depth: depth + 1,
                    isRoot: false,
                    state: state
                )
            }
        return node
    }

    private func isReplayMask(_ view: UIView) -> Bool {
        return view.accessibilityIdentifier == "oneuptime-replay-mask"
    }

    private func isOpaqueView(_ view: UIView) -> Bool {
        return ["image", "webview", "canvas"].contains(
            classify(view, masked: false)
        )
    }

    private func findReactTouchRoot(from view: UIView) -> UIView? {
        var current: UIView? = view
        while let candidate = current {
            if let reactTag = candidate.reactTag?.intValue,
               reactTag % 10 == 1 {
                return candidate
            }
            if NSStringFromClass(type(of: candidate)).hasSuffix("RCTSurfaceView") {
                return candidate
            }
            current = candidate.superview
        }
        return nil
    }

    private func classify(_ view: UIView, masked: Bool) -> String {
        if masked { return "masked" }
        if view is UITextField || view is UITextView { return "input" }
        if view is UILabel { return "text" }
        let name = NSStringFromClass(type(of: view)).lowercased()
        if view is UIImageView || name.contains("rctimageview")
            || name.contains("imageview") { return "image" }
        if name.contains("webview") { return "webview" }
        if isNamedOpaqueSurface(name) {
            return "canvas"
        }
        if view is UIScrollView { return "scroll" }
        if view is UIControl { return "button" }
        if view.subviews.isEmpty && !isKnownStructuralView(name) {
            // Unknown leaf views may draw arbitrary private pixels themselves.
            return "canvas"
        }
        return "view"
    }

    private func isNamedOpaqueSurface(_ name: String) -> Bool {
        return [
            "skia", "metal", "opengl", "canvas", "svg", "mapview",
            "camera", "video", "player", "pdf", "signature", "drawing",
            "paint", "chart",
        ].contains { name.contains($0) }
    }

    private func isKnownStructuralView(_ name: String) -> Bool {
        return [
            "uiview", "rctview", "rctviewcomponentview",
            "rctrootcomponentview", "rctrootcontentview", "rctsurfaceview",
        ].contains { name == $0 || name.hasSuffix(".\($0)") }
    }

    private func cssColor(_ color: UIColor) -> String? {
        var red: CGFloat = 0
        var green: CGFloat = 0
        var blue: CGFloat = 0
        var alpha: CGFloat = 0
        guard color.getRed(&red, green: &green, blue: &blue, alpha: &alpha) else {
            return nil
        }
        return String(
            format: "#%02x%02x%02x%02x",
            Int(red * 255),
            Int(green * 255),
            Int(blue * 255),
            Int(alpha * 255)
        )
    }
}
