# These React Native APIs are accessed reflectively so the same SDK binary can
# support both the RN 0.73 legacy drawable and newer background implementations.
-keepnames class com.facebook.react.views.view.ReactViewBackgroundDrawable
-keepclassmembers class com.facebook.react.views.view.ReactViewBackgroundDrawable {
    public int getColor();
    public float getFullBorderWidth();
    public int getBorderColor(int);
    public float getFullBorderRadius();
}

-keepnames class com.facebook.react.uimanager.BackgroundStyleApplicator
-keepclassmembers class com.facebook.react.uimanager.BackgroundStyleApplicator {
    public static *** getBackgroundColor(...);
    public static *** getBorderWidth(...);
    public static *** getBorderColor(...);
    public static *** getBorderRadius(...);
}

-keep class com.facebook.react.uimanager.Spacing {
    public static int ALL;
}
-keep class com.facebook.react.uimanager.style.LogicalEdge { *; }
-keep class com.facebook.react.uimanager.style.BorderRadiusProp { *; }
-keepclassmembers class com.facebook.react.uimanager.LengthPercentage {
    public float resolve(float);
}
