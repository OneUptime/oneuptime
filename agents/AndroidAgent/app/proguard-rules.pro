# The release build is shrunk with R8. The agent uses no reflection of its own:
# kotlinx.serialization is used only through JsonElement (no generated
# serializers), and WorkManager and AndroidX ship their own keep rules.

# Keep line numbers, so a crash the agent reports about itself can be read.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
