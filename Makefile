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

debug:
	@docker run \
		-p 3000:3000 \
		-v $(PWD):/rtcstats-server \
		--entrypoint npm \
		$(REPOSITORY):$(TAG) \
		run watch:dev

push: build
	@docker push $(REGISTRY)/$(IMAGE)
