# Local Development

Local development के लिए आपको docker-compose.dev.yml फ़ाइल उपयोग करनी होगी।

सुनिश्चित करें कि आपके पास है:

- Docker और Docker compose इंस्टॉल हों।
- Node.js और NPM इंस्टॉल हों।

```
# इस repo को clone करें और उसमें cd करें।
git clone https://github.com/OneUptime/oneuptime.git
cd oneuptime

# config.example.env को config.env पर Copy करें
cp config.example.env config.env

# चूंकि यह dev है, आपको config.env में किन्हीं values को edit नहीं करना है। आप कर सकते हैं, लेकिन वह वैकल्पिक है।
npm run dev
```
