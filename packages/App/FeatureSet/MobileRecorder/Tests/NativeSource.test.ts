import fs from "node:fs";
import path from "node:path";

const packageRoot: string = path.resolve(__dirname, "..");
const androidModule: string = fs.readFileSync(
  path.join(
    packageRoot,
    "android/src/main/java/com/oneuptime/replay/OneUptimeReplayViewTreeModule.java",
  ),
  "utf8",
);
const androidBuild: string = fs.readFileSync(
  path.join(packageRoot, "android/build.gradle"),
  "utf8",
);
const androidConsumerRules: string = fs.readFileSync(
  path.join(packageRoot, "android/consumer-rules.pro"),
  "utf8",
);
const iosModule: string = fs.readFileSync(
  path.join(packageRoot, "ios/OneUptimeReplayViewTreeModule.swift"),
  "utf8",
);
const iosBridge: string = fs.readFileSync(
  path.join(packageRoot, "ios/OneUptimeReplayViewTreeModule.m"),
  "utf8",
);

describe("native view-tree source contracts", () => {
  test("Android supports Fabric and legacy UI managers on modern RN", () => {
    expect(androidModule).toContain("UIManagerHelper.getUIManagerForReactTag");
    expect(androidModule).toContain("com.facebook.react.bridge.UIManager");
    expect(androidModule).not.toContain(
      "getNativeModule(UIManagerModule.class)",
    );
    expect(androidBuild).toContain(
      'implementation "com.facebook.react:react-android"',
    );
    expect(androidBuild).not.toContain("react-native:+");
  });

  test("both platforms hard-cap native traversal before creating bridge maps", () => {
    expect(androidModule).toContain("MAX_TREE_DEPTH = 64");
    expect(androidModule).toContain("MAX_TREE_NODES = 5000");
    expect(androidModule).toContain('putInt("truncatedNodes"');
    expect(iosModule).toContain("maximumTreeDepth = 64");
    expect(iosModule).toContain("maximumTreeNodes = 5_000");
    expect(iosModule).toContain('serialized["truncatedNodes"]');
  });

  test("ordinary hidden/zero-size views are skipped without false overflow", () => {
    expect(androidModule).toMatch(
      /view\.getWidth\(\) <= 0[\s\S]{0,100}\{\s*return null;/u,
    );
    expect(iosModule).toMatch(
      /view\.bounds\.height > 0\) else \{\s*return nil/u,
    );
  });

  test("native code never reads text, input, pixel, or accessibility content", () => {
    expect(androidModule).not.toMatch(/\.getText\s*\(/u);
    expect(androidModule).not.toContain("getContentDescription");
    expect(androidModule).not.toContain("getDrawingCache");
    expect(iosModule).not.toMatch(/\.(text|attributedText)\b/u);
    expect(iosModule).not.toContain("drawHierarchy");
    expect(iosModule).not.toContain("accessibilityLabel");
  });

  test("mask/image/WebView/Skia are opaque and children use parent coordinates", () => {
    expect(androidModule).toContain("REPLAY_MASK_TEST_ID");
    expect(androidModule).toContain('className.contains("skia")');
    expect(androidModule).toContain('className.contains("reactimageview")');
    expect(androidModule).toContain('className.contains("draweeview")');
    expect(androidModule).toContain('"webview".equals(kind)');
    expect(androidModule).toMatch(
      /group\.getChildAt\(index\),\s*location\[0\],\s*location\[1\]/u,
    );
    expect(iosModule).toContain('"skia"');
    expect(iosModule).toContain('name.contains("rctimageview")');
    expect(iosModule).toContain("relativeTo: view");
    expect(iosModule).toContain(
      'view.accessibilityIdentifier == "oneuptime-replay-mask"',
    );
  });

  test("unknown custom leaf renderers and named visual surfaces fail opaque", () => {
    for (const surfaceName of [
      "mapview",
      "camera",
      "video",
      "svg",
      "pdf",
      "signature",
      "chart",
    ]) {
      expect(androidModule).toContain(`className.contains("${surfaceName}")`);
      expect(iosModule).toContain(`"${surfaceName}"`);
    }

    expect(androidModule).toMatch(
      /if \(!\(view instanceof ViewGroup\)\) \{[\s\S]{0,180}View\.class \? "view" : "canvas"/u,
    );
    expect(androidModule).toContain("&& !isKnownStructuralContainer(view)");
    expect(androidModule).toContain(
      '"com.facebook.react.views.view.ReactViewGroup".equals(currentName)',
    );
    expect(iosModule).toMatch(
      /if view\.subviews\.isEmpty && !isKnownStructuralView\(name\) \{[\s\S]{0,150}return "canvas"/u,
    );
    expect(iosModule).toContain('if view is UIControl { return "button" }');
    expect(iosModule).toContain('"rctviewcomponentview"');
  });

  test("native style export is a closed visual subset", () => {
    for (const field of [
      "backgroundColor",
      "borderColor",
      "borderWidth",
      "borderRadius",
      "opacity",
      "zIndex",
    ]) {
      expect(`${androidModule}\n${iosModule}`).toContain(`"${field}"`);
    }
    expect(androidModule).toContain(
      'Class.forName(\n                "com.facebook.react.uimanager.BackgroundStyleApplicator"',
    );
    expect(androidModule).toContain('getMethod("getBorderWidth"');
    expect(androidModule).toContain('getMethod("getBorderColor"');
    expect(androidModule).toContain('getMethod("getBorderRadius"');
    expect(androidModule).toContain("pixels / density");
  });

  test("Android reads legacy RN 0.73 view paint without linking its removed class", () => {
    expect(androidModule).toContain(
      '"com.facebook.react.views.view.ReactViewBackgroundDrawable"',
    );
    expect(androidModule).not.toContain(
      "import com.facebook.react.views.view.ReactViewBackgroundDrawable",
    );
    expect(androidModule).toContain('.getMethod("getColor")');
    expect(androidModule).toContain('.getMethod("getFullBorderWidth")');
    expect(androidModule).toContain('.getMethod("getBorderColor", int.class)');
    expect(androidModule).toContain('.getMethod("getFullBorderRadius")');
    expect(androidModule).toMatch(
      /double width = toDp\([\s\S]{0,150}reflectedWidth/u,
    );
    expect(androidModule).toMatch(
      /double radius = toDp\([\s\S]{0,150}reflectedRadius/u,
    );
    expect(androidBuild).toContain(
      'consumerProguardFiles "consumer-rules.pro"',
    );
    expect(androidConsumerRules).toContain(
      "com.facebook.react.views.view.ReactViewBackgroundDrawable",
    );
    expect(androidConsumerRules).toContain(
      "com.facebook.react.uimanager.BackgroundStyleApplicator",
    );
    expect(androidConsumerRules).toContain("public float getFullBorderWidth()");
  });

  test("both platforms export replay-root offsets in page touch coordinates", () => {
    expect(androidModule).toMatch(
      /if \(isRoot\) \{\s*View reactTouchRoot = findReactTouchRoot\(view\);[\s\S]{0,600}"touchOriginX"[\s\S]{0,300}location\[0\] - touchRootLocation\[0\][\s\S]{0,400}"touchOriginY"[\s\S]{0,300}location\[1\] - touchRootLocation\[1\]/u,
    );
    expect(androidModule).toContain("current instanceof RootView");
    expect(iosModule).toMatch(
      /if isRoot \{\s*if let reactTouchRoot = findReactTouchRoot\(from: view\) \{\s*let touchFrame = view\.convert\(view\.bounds, to: reactTouchRoot\)\s*node\["touchOriginX"\] = touchFrame\.origin\.x\s*node\["touchOriginY"\] = touchFrame\.origin\.y/u,
    );
    expect(iosModule).toContain("reactTag % 10 == 1");
    expect(androidModule.match(/"touchOriginX"/gu)).toHaveLength(1);
    expect(iosModule.match(/"touchOriginX"/gu)).toHaveLength(1);
    expect(androidModule).not.toContain('"screenX"');
    expect(iosModule).not.toContain('"screenX"');
  });

  test("native touch privacy walks current target ancestry and fails closed", () => {
    expect(androidModule).toContain("public void isTouchTargetPrivate(");
    expect(androidModule).toContain("View current = target;");
    expect(androidModule).toContain(
      "if (isReplayMask(current) || isOpaqueView(current))",
    );
    expect(androidModule).toContain(
      'return "image".equals(kind) || "webview".equals(kind)',
    );
    expect(androidModule).toContain('|| "canvas".equals(kind)');
    expect(androidModule).toMatch(
      /if \(target == null \|\| replayRoot == null\) \{\s*promise\.resolve\(true\)/u,
    );
    expect(androidModule).toContain("if (current == replayRoot)");
    expect(androidModule).toMatch(
      /if \(current == replayRoot\) \{\s*promise\.resolve\(false\)/u,
    );
    expect(androidModule).toMatch(
      /event target was not a descendant[\s\S]{0,100}promise\.resolve\(true\)/u,
    );

    expect(iosBridge).toContain("RCT_EXTERN_METHOD(isTouchTargetPrivate:");
    expect(iosModule).toContain("func isTouchTargetPrivate(");
    expect(iosModule).toContain("var current: UIView? = target");
    expect(iosModule).toContain(
      "if self.isReplayMask(view) || self.isOpaqueView(view)",
    );
    expect(iosModule).toContain('["image", "webview", "canvas"].contains(');
    expect(iosModule).toMatch(
      /let target = self\.bridge\.uiManager\.view[\s\S]{0,180}let replayRoot = self\.bridge\.uiManager\.view[\s\S]{0,120}resolve\(true\)/u,
    );
    expect(iosModule).toContain("if view === replayRoot");
    expect(iosModule).toMatch(/if view === replayRoot \{\s*resolve\(false\)/u);
    expect(iosModule).toMatch(
      /Stale\/out-of-root event targets[\s\S]{0,100}resolve\(true\)/u,
    );
  });
});
