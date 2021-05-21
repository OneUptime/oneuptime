require_relative 'lib/fyipe'

# instance=Fyipe.config do |c|
#     c.applicationLogId = 'Testing'
# end 

# puts Fyipe.applicationLogId

obj = FyipeLogger.new(
    'http://localhost:3002/api',
    '5eeba14a3b0014dfbe07124a',                    
    '0292c716-089c-491e-8f30-b8a0ce4e0250'
)

obj.display()

# obj.log("heyy")
# obj.log(64)
# obj.log(['content', 'here'])
obj.log({'content'=> 'here'})
obj.warning('heyy')
obj.error({'content'=> 'another try'})
# obj.log({:sk => "here"})

# puts logger