import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
}

/*
 * The version a release builds is OneUptime's own (VERSION at the
 * repository's root), passed as -PagentVersion=17.0.12. Its version code is
 * worked out from it, so every release has a higher one than the release
 * before it and anyone can tell which code a version has: major * 10,000,000
 * + minor * 10,000 + patch. A local build is 0.0.0-dev, code 1.
 */
val agentVersion: String = (findProperty("agentVersion") as String?)?.trim().orEmpty().ifEmpty { "0.0.0-dev" }

fun versionCodeOf(version: String): Int {
    val match = Regex("""^(\d+)\.(\d+)\.(\d+)$""").matchEntire(version) ?: return 1
    val (major, minor, patch) = match.destructured.toList().map { it.toInt() }
    require(major in 0..213 && minor in 0..999 && patch in 0..9_999) {
        "Version $version does not fit an Android version code (major <= 213, minor <= 999, patch <= 9999)."
    }
    return major * 10_000_000 + minor * 10_000 + patch
}

/*
 * Release signing, from the environment so no key is ever in the repository.
 * The release workflow decodes the keystore from a repository secret and sets
 * these (RELEASING.md). Without them a release build is unsigned.
 */
val releaseKeystore: String? = System.getenv("ANDROID_AGENT_KEYSTORE_FILE")?.takeIf { it.isNotBlank() }

android {
    namespace = "com.oneuptime.androidagent"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.oneuptime.androidagent"
        minSdk = 24
        targetSdk = 36
        versionCode = versionCodeOf(agentVersion)
        versionName = agentVersion
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        if (releaseKeystore != null) {
            create("release") {
                storeFile = file(releaseKeystore)
                storePassword = System.getenv("ANDROID_AGENT_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_AGENT_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_AGENT_KEY_PASSWORD")
                // Esper refuses an APK without a v1 (JAR) signature, which a
                // minSdk of 24 would otherwise leave out.
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (releaseKeystore != null) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
    }

    testOptions {
        unitTests {
            isIncludeAndroidResources = true
            all { test ->
                // GoldenPayloadTest: the OTLP requests OneUptime's ingest tests read too.
                test.systemProperty("goldenDir", file("src/test/resources/otlp").absolutePath)
                test.systemProperty("updateGoldens", (findProperty("updateGoldens") as String?) ?: "false")
            }
        }
    }

    lint {
        abortOnError = true
        warningsAsErrors = true
        checkReleaseBuilds = true
        // Whether a newer library exists changes from day to day, not with
        // this code: keep the build's answer the same for the same commit.
        disable += setOf("GradleDependency", "NewerVersionAvailable", "AndroidGradlePluginVersion", "OldTargetApi")
    }

    packaging {
        resources {
            excludes += setOf("META-INF/AL2.0", "META-INF/LGPL2.1", "META-INF/*.kotlin_module")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.work.runtime)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)

    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.androidx.test.ext.junit)
    testImplementation(libs.androidx.work.testing)
    testImplementation(libs.kotlinx.coroutines.test)

    androidTestImplementation(libs.androidx.test.core)
    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.rules)
    androidTestImplementation(libs.androidx.work.testing)
}
