FROM node:4
MAINTAINER Tokbox <ops@tokbox.com>

ENV app rtcstats-server

RUN useradd $app \
  && mkdir -p /var/log/$app /$app \
  && chown $app:$app /var/log/$app /$app
WORKDIR /$app
COPY . /$app
RUN npm install
RUN curl https://raw.githubusercontent.com/opentok/rtcstats/master/rtcstats.js -o static/rtcstats.js && node_modules/.bin/uglifyjs static/rtcstats.js -o static/rtcstats.min.js

USER $app
VOLUME ["/var/log/$app"]
EXPOSE 3000
CMD ["npm", "start"]
