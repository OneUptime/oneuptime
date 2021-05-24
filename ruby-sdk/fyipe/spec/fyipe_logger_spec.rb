# spec/fyipe_logger_spec.rb
require_relative '../lib/fyipe'
require_relative 'helper'

RSpec.configure do |config|
    config.before(:suite){
        # using $ registers the variable as a global variable
        # ref: https://stackoverflow.com/a/19167379/6800815
        # $logger = FyipeLogger.new()
        $apiUrl = 'http://localhost:3002/api';
        $helper = Helper.new()
        $helper.getSampleUser()
    }
end
RSpec.describe FyipeLogger do
  context "#world" do
    it { expect('hello world').to eql 'hello world' }
  end
end