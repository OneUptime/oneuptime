FROM nginx:1.23.3-alpine

# Install bash. 
RUN apk update && apk add bash && apk add curl