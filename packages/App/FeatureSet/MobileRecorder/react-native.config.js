module.exports = {
  dependency: {
    platforms: {
      android: {
        sourceDir: "./android",
        packageImportPath:
          "import com.oneuptime.replay.OneUptimeReplayPackage;",
        packageInstance: "new OneUptimeReplayPackage()",
      },
      ios: {
        podspecPath: "./OneUptimeReactNativeReplay.podspec",
      },
    },
  },
};
