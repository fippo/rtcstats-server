REGISTRY:=juandebravo
IMAGE:=rtcstats-server
REPOSITORY:=$(REGISTRY)/$(IMAGE)
TAG:=latest

build:
	@docker build -t $(REPOSITORY) .

run:
	@docker run \
		-p 3000:3000 \
		$(REPOSITORY):$(TAG)

push: build
	@docker push $(REGISTRY)/$(IMAGE)
