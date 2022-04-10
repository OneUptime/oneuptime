/* eslint no-console: off */
module.exports = function createProgressReporter(options) {
  let lastReported = 0
  let lastFile
  let shouldHookExit = options && options.hookExit
  const stats = []
  const eslintPlugin = {
    rules: {
      activate: {
        create(context) {
          if (shouldHookExit) {
            shouldHookExit = false
            process.on('exit', printStats)
          }
          const now = Date.now()
          if (now > lastReported + 15000) {
            lastReported = now
            console.error(
              `* [${new Date().toJSON()}] Processed ${stats.length} files...`
            )
          }
          if (lastFile) {
            lastFile.finish = now
            lastFile.duration = now - lastFile.start
            stats.push(lastFile)
          }
          lastFile = {
            name: context.getFilename(),
            start: now
          }
          return {}
        }
      }
    }
  }
  function printStats() {
    const totalTime = stats.map(s => s.duration).reduce((a, b) => a + b, 0)
    const minutes = (totalTime / 60000).toFixed(1)
    console.log()
    console.log('ESLint Stats Report')
    console.log('===================')
    console.log()
    console.log(`${stats.length} files processed in ${minutes} minutes.`)
    stats.sort((a, b) => b.duration - a.duration)
    console.log()
    const slow = stats.slice(0, 20)
    console.log(`## Slowest ${slow.length} files`)
    for (const file of stats.slice(0, 20)) {
      console.log(` * ${file.name} (${file.duration} ms)`)
    }
  }
  return {
    eslintPlugin,
    printStats,
    stats
  }
}
