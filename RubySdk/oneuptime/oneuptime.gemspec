require File.expand_path('lib/oneuptime/version', __dir__)

Gem::Specification.new do |spec|

    spec.name                  = OneUptime::NAME
    spec.version               = OneUptime::VERSION
    spec.authors               = ['OneUptime Limited.']
    spec.email                 = ['hello@oneuptime.com']
    spec.summary               = 'OneUptime for Logging and Tracking'
    spec.description           = 'OneUptime is a ruby package that tracks error event and send logs from your applications to your oneuptime dashboard.'
    spec.homepage              = 'https://github.com/OneUptime/app'
    spec.license               = 'MIT'
    spec.platform              = Gem::Platform::RUBY
    spec.required_ruby_version = '>= 2.5.0'

    all_files = `git ls-files`.split("\n")
    test_files = `git ls-files -- {spec}/*`.split("\n")

    spec.files = all_files - test_files
    spec.extra_rdoc_files = ['README.md']
    spec.add_dependency 'httparty', '~> 0.17'
    spec.add_dependency 'gem-release', '~> 2.2'
    spec.add_dependency 'ruby-enum', '~> 0.9'
    spec.add_development_dependency 'dotenv', '~> 2.5'
    spec.add_development_dependency 'rspec', '~> 3.6'
    spec.add_development_dependency 'rubocop', '~> 0.60'
    spec.add_development_dependency 'rubocop-performance', '~> 1.5'
    spec.add_development_dependency 'rubocop-rspec', '~> 1.37'
    spec.add_development_dependency 'faker', '~> 2.18'
    
end