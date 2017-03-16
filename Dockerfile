FROM node:4
MAINTAINER Tokbox <ops@tokbox.com>

ENV app rtcstats-server

RUN useradd $app \
  && mkdir -p /var/log/$app /$app \
  && chown $app:$app /var/log/$app /$app
WORKDIR /$app
COPY . /$app
RUN npm install

# Generate static/rtcstats.min.js
RUN mkdir static && cd node_modules/rtcstats && npm run dist && cp min.js ../../static/rtcstats.min.js

USER $app
VOLUME ["/var/log/$app"]
EXPOSE 3000
CMD ["npm", "start"]
