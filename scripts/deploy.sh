#!/bin/bash
set -e

SHOULD_PUSH_IMAGE=$1

if [[ -z "$SHOULD_PUSH_IMAGE" ]]; then
  echo "No instruction to push or not to push specified, exiting."
  echo "please use: ./deploy.sh true/false dev/prod version"
  exit 1
fi

VERSION=$(cat package.json \
  | grep version \
  | head -1 \
  | awk -F: '{ print $2 }' \
  | sed 's/[",]//g' \
  | tr -d '[[:space:]]')

if [[ -z "$RTCSTATS_REPOSITORY" ]]; then
  echo "Please provide a RTCSTATS_REPOSITORY env variable."
  exit 1
fi

ACCOUNT_ID=$(echo $RTCSTATS_REPOSITORY | cut -d. -f1)
REGION=$(echo $RTCSTATS_REPOSITORY | cut -d. -f4)
REPOSITORY=${RTCSTATS_REPOSITORY}:rtcstats-server-${VERSION}

docker build -t $REPOSITORY .

if [[ ${SHOULD_PUSH_IMAGE} == true ]]
  then
    echo "push docker image to ecr"
    # aws --version
    # aws-cli/2.2.30 Python/3.8.8 Linux/5.10.16.3-microsoft-standard-WSL2 exe/x86_64.ubuntu.20 prompt/off
    if [ $(aws --version|cut -d' ' -f1|cut -d/ -f2 | cut -d. -f1) -gt 1 ]
    then
      aws ecr get-login-password --region $REGION | docker login \
          --username AWS \
          --password-stdin $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com
    else
        $(aws ecr get-login --region $REGION --no-include-email)
    fi
    docker push $REPOSITORY
fi
