plugins {
    alias(libs.plugins.android.application) apply false
    /*
     * AGP 9 compiles Kotlin on its own ("built-in Kotlin"), with the Kotlin
     * Gradle plugin it depends on. Declaring the plugin here, without
     * applying it, puts a newer Kotlin on the build's classpath, and AGP
     * compiles with that one.
     */
    alias(libs.plugins.kotlin.android) apply false
}
