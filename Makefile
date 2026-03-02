test: test-unit test-e2e

test-unit:
	npm run test:unit

test-e2e:
	npm run test:e2e

docs-serve:
	npm run docs:serve

docs-build:
	npm run docs:build

.PHONY: test test-unit test-e2e docs-serve docs-build
