Pod::Spec.new do |s|
  s.name           = 'WindowPosture'
  s.version        = '1.0.0'
  s.summary        = 'Where the OneUptime On-Call window folds, and how the phone is held.'
  s.description    = 'The iOS side of the app-local window posture module: UIKit division regions and the hinge, reported to JavaScript as the Android side reports Jetpack WindowManager folding features.'
  s.license        = 'Apache-2.0'
  s.author         = 'OneUptime'
  s.homepage       = 'https://github.com/OneUptime/oneuptime'
  s.platforms      = {
    :ios => '16.4'
  }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/OneUptime/oneuptime.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Sources/ only: Package.swift and Tests/ test the report on their own and never ship.
  s.source_files = 'Sources/**/*.swift'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
