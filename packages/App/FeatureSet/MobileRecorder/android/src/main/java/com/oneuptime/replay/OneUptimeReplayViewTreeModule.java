package com.oneuptime.replay;

import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.view.SurfaceView;
import android.view.TextureView;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.UIManager;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.UiThreadUtil;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.uimanager.RootView;
import com.facebook.react.uimanager.UIManagerHelper;

import java.lang.reflect.Method;
import java.util.Locale;

public final class OneUptimeReplayViewTreeModule extends ReactContextBaseJavaModule {
    private static final String REPLAY_MASK_TEST_ID = "oneuptime-replay-mask";
    private static final int MAX_TREE_DEPTH = 64;
    private static final int MAX_TREE_NODES = 5000;

    private static final class TraversalState {
        int visited = 0;
        int truncated = 0;
    }

    OneUptimeReplayViewTreeModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @NonNull
    @Override
    public String getName() {
        return "OneUptimeReplayViewTree";
    }

    @ReactMethod
    public void captureViewTree(double rootTagValue, Promise promise) {
        final int rootTag = (int) rootTagValue;
        UiThreadUtil.runOnUiThread(() -> {
            try {
                UIManager uiManager = UIManagerHelper.getUIManagerForReactTag(
                    getReactApplicationContext(),
                    rootTag
                );
                if (uiManager == null) {
                    promise.reject("E_UI_MANAGER", "React Native UIManager is unavailable.");
                    return;
                }

                View root = uiManager.resolveView(rootTag);
                if (root == null) {
                    promise.reject("E_ROOT_VIEW", "Replay root view was not found.");
                    return;
                }

                int[] rootLocation = new int[2];
                root.getLocationOnScreen(rootLocation);
                TraversalState state = new TraversalState();
                WritableMap serialized = serializeView(
                    root,
                    rootLocation[0],
                    rootLocation[1],
                    0,
                    true,
                    state
                );
                if (serialized == null) {
                    promise.reject("E_EMPTY_ROOT", "Replay root view could not be serialized.");
                    return;
                }
                serialized.putInt("truncatedNodes", state.truncated);
                promise.resolve(serialized);
            } catch (Throwable exception) {
                promise.reject("E_CAPTURE", "Unable to serialize the native view tree.", exception);
            }
        });
    }

    @ReactMethod
    public void getAppMetadata(Promise promise) {
        try {
            android.content.pm.PackageInfo packageInfo = getReactApplicationContext()
                .getPackageManager()
                .getPackageInfo(getReactApplicationContext().getPackageName(), 0);
            android.content.pm.ApplicationInfo applicationInfo =
                getReactApplicationContext().getApplicationInfo();
            WritableMap metadata = Arguments.createMap();
            metadata.putString(
                "appName",
                getReactApplicationContext().getPackageManager()
                    .getApplicationLabel(applicationInfo).toString()
            );
            metadata.putString(
                "appVersion",
                packageInfo.versionName == null ? "unknown" : packageInfo.versionName
            );
            metadata.putString("osName", "android");
            metadata.putString("osVersion", Build.VERSION.RELEASE);
            promise.resolve(metadata);
        } catch (Throwable exception) {
            promise.reject("E_METADATA", "Unable to read application metadata.", exception);
        }
    }

    @ReactMethod
    public void isTouchTargetPrivate(
        double targetTagValue,
        double replayRootTagValue,
        Promise promise
    ) {
        if (!isReactTag(targetTagValue) || !isReactTag(replayRootTagValue)) {
            promise.resolve(true);
            return;
        }

        final int targetTag = (int) targetTagValue;
        final int replayRootTag = (int) replayRootTagValue;
        UiThreadUtil.runOnUiThread(() -> {
            try {
                View target = resolveView(targetTag);
                View replayRoot = resolveView(replayRootTag);
                if (target == null || replayRoot == null) {
                    promise.resolve(true);
                    return;
                }

                View current = target;
                while (current != null) {
                    if (isReplayMask(current) || isOpaqueView(current)) {
                        promise.resolve(true);
                        return;
                    }
                    if (current == replayRoot) {
                        promise.resolve(false);
                        return;
                    }

                    android.view.ViewParent parent = current.getParent();
                    current = parent instanceof View ? (View) parent : null;
                }

                /* The event target was not a descendant of this replay root. */
                promise.resolve(true);
            } catch (Throwable ignored) {
                /* Privacy decisions fail closed on stale tags or renderer errors. */
                promise.resolve(true);
            }
        });
    }

    private WritableMap serializeView(
        View view,
        int rootX,
        int rootY,
        int depth,
        boolean isRoot,
        TraversalState state
    ) {
        if (depth > MAX_TREE_DEPTH || state.visited >= MAX_TREE_NODES) {
            state.truncated += 1;
            return null;
        }
        if (!isRoot && (view.getVisibility() != View.VISIBLE
            || view.getWidth() <= 0 || view.getHeight() <= 0)) {
            return null;
        }
        state.visited += 1;
        int[] location = new int[2];
        view.getLocationOnScreen(location);
        boolean masked = isReplayMask(view);
        String kind = classify(view, masked);
        boolean opaque = masked || "image".equals(kind) || "webview".equals(kind)
            || "canvas".equals(kind);

        WritableMap node = Arguments.createMap();
        node.putInt(
            "nativeId",
            view.getId() == View.NO_ID ? System.identityHashCode(view) : view.getId()
        );
        node.putString("kind", kind);
        node.putDouble("x", toDp(view, location[0] - rootX));
        node.putDouble("y", toDp(view, location[1] - rootY));
        node.putDouble("width", toDp(view, view.getWidth()));
        node.putDouble("height", toDp(view, view.getHeight()));
        node.putBoolean("masked", masked);
        node.putBoolean("opaque", opaque);
        if (isRoot) {
            View reactTouchRoot = findReactTouchRoot(view);
            if (reactTouchRoot != null) {
                int[] touchRootLocation = new int[2];
                reactTouchRoot.getLocationOnScreen(touchRootLocation);
                node.putDouble(
                    "touchOriginX",
                    toDp(view, location[0] - touchRootLocation[0])
                );
                node.putDouble(
                    "touchOriginY",
                    toDp(view, location[1] - touchRootLocation[1])
                );
            }
        }
        node.putDouble("opacity", view.getAlpha());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            node.putDouble("zIndex", view.getZ());
        }
        putVisualStyles(view, node);

        WritableArray children = Arguments.createArray();
        if (!opaque && view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int index = 0; index < group.getChildCount(); index += 1) {
                WritableMap child = serializeView(
                    group.getChildAt(index),
                    location[0],
                    location[1],
                    depth + 1,
                    false,
                    state
                );
                if (child != null) {
                    children.pushMap(child);
                }
            }
        }
        node.putArray("children", children);
        return node;
    }

    private boolean isReplayMask(View view) {
        Object testId = view.getTag(com.facebook.react.R.id.react_test_id);
        return REPLAY_MASK_TEST_ID.equals(testId);
    }

    private boolean isOpaqueView(View view) {
        String kind = classify(view, false);
        return "image".equals(kind) || "webview".equals(kind)
            || "canvas".equals(kind);
    }

    private View resolveView(int reactTag) {
        UIManager uiManager = UIManagerHelper.getUIManagerForReactTag(
            getReactApplicationContext(),
            reactTag
        );
        return uiManager == null ? null : uiManager.resolveView(reactTag);
    }

    private boolean isReactTag(double value) {
        return Double.isFinite(value) && value > 0 && value <= Integer.MAX_VALUE
            && value == Math.rint(value);
    }

    private View findReactTouchRoot(View view) {
        View current = view;
        while (current != null) {
            if (current instanceof RootView) {
                return current;
            }
            android.view.ViewParent parent = current.getParent();
            current = parent instanceof View ? (View) parent : null;
        }
        return null;
    }

    private String classify(View view, boolean masked) {
        if (masked) {
            return "masked";
        }
        if (view instanceof EditText) {
            return "input";
        }
        if (view instanceof Button) {
            return "button";
        }
        if (view instanceof TextView) {
            return "text";
        }
        String className = view.getClass().getName().toLowerCase(Locale.US);
        if (view instanceof ImageView || className.contains("reactimageview")
            || className.contains("draweeview")) {
            return "image";
        }
        if (view instanceof WebView || view.getClass().getName().contains("WebView")) {
            return "webview";
        }

        if (view instanceof SurfaceView || view instanceof TextureView
            || isNamedOpaqueSurface(className)) {
            return "canvas";
        }
        if (view instanceof ScrollView) {
            return "scroll";
        }
        if (!(view instanceof ViewGroup)) {
            /* Unknown leaf views may draw arbitrary private pixels themselves. */
            return view.getClass() == View.class ? "view" : "canvas";
        }
        if (((ViewGroup) view).getChildCount() == 0
            && !isKnownStructuralContainer(view)) {
            return "canvas";
        }
        return "view";
    }

    private boolean isNamedOpaqueSurface(String className) {
        return className.contains("skia") || className.contains("opengl")
            || className.contains("canvas") || className.contains("svg")
            || className.contains("mapview") || className.contains("camera")
            || className.contains("video") || className.contains("player")
            || className.contains("pdf") || className.contains("signature")
            || className.contains("drawing") || className.contains("paint")
            || className.contains("chart");
    }

    private boolean isKnownStructuralContainer(View view) {
        if (view instanceof RootView) {
            return true;
        }
        String className = view.getClass().getName();
        if (className.startsWith("android.") || className.startsWith("androidx.")) {
            return true;
        }

        Class<?> current = view.getClass();
        while (current != null) {
            String currentName = current.getName();
            if ("com.facebook.react.views.view.ReactViewGroup".equals(currentName)
                || "com.facebook.react.ReactRootView".equals(currentName)) {
                return true;
            }
            current = current.getSuperclass();
        }
        return false;
    }

    private String cssColor(int color) {
        return String.format(
            Locale.US,
            "#%02x%02x%02x%02x",
            Color.red(color),
            Color.green(color),
            Color.blue(color),
            Color.alpha(color)
        );
    }

    /*
     * RN 0.81 moved backgrounds and borders out of ColorDrawable. Reflection
     * keeps this library binary-compatible with 0.73-0.80 while using the
     * public 0.81+ BackgroundStyleApplicator getters when they are present.
     * Only visual paint values are requested; no props or content are read.
     */
    private void putVisualStyles(View view, WritableMap node) {
        Integer backgroundColor = null;
        if (view.getBackground() instanceof ColorDrawable) {
            backgroundColor = ((ColorDrawable) view.getBackground()).getColor();
        }

        Integer legacyBackgroundColor = readLegacyReactBackground(view, node);
        if (legacyBackgroundColor != null) {
            backgroundColor = legacyBackgroundColor;
        }

        try {
            Class<?> applicator = Class.forName(
                "com.facebook.react.uimanager.BackgroundStyleApplicator"
            );
            Method getBackgroundColor = applicator.getMethod(
                "getBackgroundColor",
                View.class
            );
            Object reflectedBackground = getBackgroundColor.invoke(null, view);
            if (reflectedBackground instanceof Number) {
                backgroundColor = ((Number) reflectedBackground).intValue();
            }

            Class<?> logicalEdge = Class.forName(
                "com.facebook.react.uimanager.style.LogicalEdge"
            );
            Object allEdges = enumConstant(logicalEdge, "ALL");
            if (allEdges != null) {
                Object reflectedWidth = applicator
                    .getMethod("getBorderWidth", View.class, logicalEdge)
                    .invoke(null, view, allEdges);
                if (reflectedWidth instanceof Number) {
                    double width = ((Number) reflectedWidth).doubleValue();
                    if (Double.isFinite(width) && width > 0) {
                        node.putDouble("borderWidth", width);
                        Object reflectedColor = applicator
                            .getMethod("getBorderColor", View.class, logicalEdge)
                            .invoke(null, view, allEdges);
                        if (reflectedColor instanceof Number) {
                            node.putString(
                                "borderColor",
                                cssColor(((Number) reflectedColor).intValue())
                            );
                        }
                    }
                }
            }

            Class<?> radiusProperty = Class.forName(
                "com.facebook.react.uimanager.style.BorderRadiusProp"
            );
            Object allCorners = enumConstant(radiusProperty, "BORDER_RADIUS");
            if (allCorners != null) {
                Object radius = applicator
                    .getMethod("getBorderRadius", View.class, radiusProperty)
                    .invoke(null, view, allCorners);
                if (radius != null) {
                    Object reflectedRadius = radius
                        .getClass()
                        .getMethod("resolve", float.class)
                        .invoke(
                            radius,
                            (float) toDp(
                                view,
                                Math.min(view.getWidth(), view.getHeight())
                            )
                        );
                    if (reflectedRadius instanceof Number) {
                        double radiusPx = ((Number) reflectedRadius).doubleValue();
                        if (Double.isFinite(radiusPx) && radiusPx > 0) {
                            node.putDouble("borderRadius", radiusPx);
                        }
                    }
                }
            }
        } catch (ReflectiveOperationException | LinkageError | RuntimeException ignored) {
            /* RN before the style getter API uses the legacy drawable fallback. */
        }

        if (backgroundColor != null) {
            node.putString("backgroundColor", cssColor(backgroundColor));
        }
    }

    /*
     * RN 0.73-0.80 stores normal React view paint in
     * ReactViewBackgroundDrawable. Referencing that class directly would make
     * this package fail to load once RN removes it, so the compatibility path
     * checks the exact class name and calls only its public visual getters.
     */
    private Integer readLegacyReactBackground(View view, WritableMap node) {
        Object background = view.getBackground();
        if (background == null || !(
            "com.facebook.react.views.view.ReactViewBackgroundDrawable"
        ).equals(background.getClass().getName())) {
            return null;
        }

        try {
            Class<?> legacyDrawable = background.getClass();
            Object reflectedBackground = legacyDrawable
                .getMethod("getColor")
                .invoke(background);

            Object reflectedWidth = legacyDrawable
                .getMethod("getFullBorderWidth")
                .invoke(background);
            if (reflectedWidth instanceof Number) {
                double width = toDp(
                    view,
                    ((Number) reflectedWidth).doubleValue()
                );
                if (Double.isFinite(width) && width > 0) {
                    node.putDouble("borderWidth", width);

                    Class<?> spacing = Class.forName(
                        "com.facebook.react.uimanager.Spacing"
                    );
                    int allEdges = spacing.getField("ALL").getInt(null);
                    Object reflectedColor = legacyDrawable
                        .getMethod("getBorderColor", int.class)
                        .invoke(background, allEdges);
                    if (reflectedColor instanceof Number) {
                        node.putString(
                            "borderColor",
                            cssColor(((Number) reflectedColor).intValue())
                        );
                    }
                }
            }

            Object reflectedRadius = legacyDrawable
                .getMethod("getFullBorderRadius")
                .invoke(background);
            if (reflectedRadius instanceof Number) {
                double radius = toDp(
                    view,
                    ((Number) reflectedRadius).doubleValue()
                );
                if (Double.isFinite(radius) && radius > 0) {
                    node.putDouble("borderRadius", radius);
                }
            }

            return reflectedBackground instanceof Number
                ? ((Number) reflectedBackground).intValue()
                : null;
        } catch (ReflectiveOperationException | LinkageError | RuntimeException ignored) {
            return null;
        }
    }

    private Object enumConstant(Class<?> enumClass, String name) {
        Object[] constants = enumClass.getEnumConstants();
        if (constants == null) {
            return null;
        }
        for (Object constant : constants) {
            if (name.equals(constant.toString())) {
                return constant;
            }
        }
        return null;
    }

    private double toDp(View view, double pixels) {
        float density = view.getResources().getDisplayMetrics().density;
        return density > 0 ? pixels / density : pixels;
    }
}
