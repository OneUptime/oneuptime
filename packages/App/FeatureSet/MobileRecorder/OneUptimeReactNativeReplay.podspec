require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |spec|
  spec.name = "OneUptimeReactNativeReplay"
  spec.version = package["version"]
  spec.summary = package["description"]
  spec.homepage = "https://oneuptime.com"
  spec.license = package["license"]
  spec.author = package["author"]
  spec.source = {
    :git => "https://github.com/OneUptime/oneuptime.git",
    :tag => "#{spec.version}"
  }
  spec.platforms = { :ios => "13.0" }
  spec.source_files = "ios/**/*.{h,m,mm,swift}"
  spec.swift_version = "5.7"
  spec.dependency "React-Core"
end
