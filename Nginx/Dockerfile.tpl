FROM nginx:alpine

# Install bash. 
RUN apk update && apk add bash && apk add curl