FROM node:10.15.3-alpine

RUN apk add --no-cache git && \
  rm -rf /var/lib/apt/lists/* /var/cache/apk /usr/share/man /tmp/*


ENV app rtcstats-server

WORKDIR /$app

RUN adduser --disabled-password $app
RUN chown -R $app:$app /$app

USER $app

COPY --chown=$app:$app . /$app

RUN npm install


HEALTHCHECK --interval=10s --timeout=5s --start-period=10s \
  CMD curl --silent --fail http://localhost:3000/healthcheck \
  || exit 1

EXPOSE 3000

ENTRYPOINT [ "npm" ]

CMD [ "start" ]
