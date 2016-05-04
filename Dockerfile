FROM centos:6.6
MAINTAINER Tokbox <ops@tokbox.com>

ENV app rtcstats-server

RUN rpm -Uvh http://download.fedoraproject.org/pub/epel/6/i386/epel-release-6-8.noarch.rpm
RUN yum install -y npm && yum clean all
RUN useradd $app \
  && mkdir -p /var/log/$app /$app \
  && chown $app:$app /var/log/$app /$app
WORKDIR /$app
COPY . /$app
RUN npm install
RUN mkdir static
RUN curl https://raw.githubusercontent.com/opentok/rtcstats/master/rtcstats.js -o static/rtcstats.js && node_modules/.bin/uglifyjs static/rtcstats.js -o static/rtcstats.min.js

USER $app
VOLUME ["/var/log/$app"]
EXPOSE 3000
CMD ["npm", "start"]
