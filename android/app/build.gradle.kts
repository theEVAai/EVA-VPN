plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "ai.theeva.vpn"
    compileSdk = 35

    defaultConfig {
        applicationId = "ai.theeva.vpn"
        // 23 — минимум, под который собран libbox.aar (см. его манифест).
        minSdk = 23
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"

        ndk {
            // В libbox.aar сейчас только arm64 — это ~95% телефонов.
            // Для публикации ядро пересобирается с --all-arch.
            abiFilters += listOf("arm64-v8a")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        viewBinding = true
    }

    packaging {
        // libbox.so большая; сжатие в apk ей не нужно
        jniLibs.useLegacyPackaging = false
    }

    testOptions {
        unitTests.isIncludeAndroidResources = true
    }
}

dependencies {
    // Ядро sing-box, собранное скриптом scripts/build-libbox.mjs
    implementation(files("libs/libbox.aar"))

    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("androidx.lifecycle:lifecycle-service:2.8.7")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    implementation("com.google.android.material:material:1.12.0")

    // Проверки на JVM. Настоящая org.json нужна потому, что в android.jar
    // лежит заглушка, которая бросает исключение на любой вызов, —
    // без неё сборку конфигурации не проверить, не запуская телефон.
    testImplementation(kotlin("test"))
    testImplementation("org.json:json:20240303")
}
