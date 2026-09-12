// Версии закреплены и совместимы между собой: AGP 8.7.3 требует Gradle 8.9+,
// Kotlin 2.0.21 совместим с этим AGP. Подбирать их на месте — терять часы.
plugins {
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
}
