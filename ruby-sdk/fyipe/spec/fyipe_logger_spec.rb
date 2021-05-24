# spec/fyipe_logger_spec.rb
require_relative '../lib/fyipe'
require 'faker'

RSpec.configure do |config|
    config.before(:suite){
        # using $ registers the variable as a global variable
        # ref: https://stackoverflow.com/a/19167379/6800815
        $logger = FyipeLogger.new()
        $apiUrl = 'http://localhost:3002/api';


    }
end
RSpec.describe FyipeLogger do
  context "#world" do
    it { expect($logger.world).to eql 'hello world' }
    puts Faker::Name.name
  end
end