FROM centos:6.6
MAINTAINER Tokbox <ops@tokbox.com>

ENV app snoop-server

RUN rpm -Uvh http://download.fedoraproject.org/pub/epel/6/i386/epel-release-6-8.noarch.rpm
RUN yum install -y npm && yum clean all
RUN useradd $app \
  && mkdir -p /var/log/$app /$app \
  && chown $app:$app /var/log/$app /$app
WORKDIR /$app
COPY . /$app
RUN npm install
RUN curl https://raw.githubusercontent.com/opentok/snoop/master/snoop.js > static/snoop.js

USER $app
VOLUME ["/var/log/$app"]
EXPOSE 3000
CMD ["npm", "start"]
