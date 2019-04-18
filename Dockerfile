FROM node:10

ENV app rtcstats-server

RUN useradd $app \
  && mkdir /home/$app \
  && chown $app:$app /home/$app \
  && mkdir -p /var/log/$app /$app \
  && chown $app:$app /var/log/$app /$app
WORKDIR /$app
COPY . /$app

RUN chown -R $app:$app /$app

USER $app

RUN npm install

VOLUME ["/var/log/$app"]
EXPOSE 3000
CMD ["npm", "start"]
