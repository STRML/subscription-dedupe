// @flow
const {before, beforeEach, after, afterEach, describe, it} = require('mocha');
const assert = require('power-assert');
const sinon = require('sinon');
const SubscriptionDedupe = require('../index');

describe('subscription-dedupe', () => {

  let instance;
  const optionsBase = {
    onSubscribe() {
      return new Promise((resolve) => setTimeout(() => resolve({}), 0));
    },
    onUnsubscribe() {
      return new Promise((resolve) => setTimeout(resolve, 0));
    },
  }
  beforeEach(function() {
    this.sandbox = sinon.sandbox.create();
    this.sandbox.spy(optionsBase, 'onSubscribe');
    this.sandbox.spy(optionsBase, 'onUnsubscribe');
  });

  afterEach(function() {
    this.sandbox.restore();
  });

  describe('add/remove basics', function() {

    describe('onSubscribe()', function() {

      it('Calls `onSubscribe` on add', async function() {
        const topic = 'foo';
        const instance = new SubscriptionDedupe(optionsBase);
        await instance.subscribe(topic);
        assert(optionsBase.onSubscribe.callCount === 1);
      });

      it('Only calls `onSubscribe` once', async function() {
        const topic = 'foo';
        const instance = new SubscriptionDedupe(optionsBase);
        await instance.subscribe(topic);
        assert(optionsBase.onSubscribe.callCount === 1);
        await instance.subscribe(topic);
        assert(optionsBase.onSubscribe.callCount === 1);
      });
    });

    describe('onUnsubscribe()', function() {

      it('removes subscription at 0', async function() {
        const topic = 'foo';
        const instance = new SubscriptionDedupe(optionsBase);
        await instance.subscribe(topic);
        assert(optionsBase.onSubscribe.callCount === 1);
        await instance.unsubscribe(topic);
        assert(instance.subscriptions[topic] === undefined);
        assert(optionsBase.onUnsubscribe.callCount === 1);
      });

      it('doesn\'t remove nonexistent', async function() {
        const topic = 'foo';
        const instance = new SubscriptionDedupe(optionsBase);
        await instance.unsubscribe(topic);
        assert(instance.subscriptions[topic] === undefined);
        assert(optionsBase.onUnsubscribe.callCount === 0);
      });

      it('removes subscription only once', async function() {
        const topic = 'foo';
        const instance = new SubscriptionDedupe(optionsBase);
        await times(5, () => instance.subscribe(topic));
        assert(optionsBase.onSubscribe.callCount === 1);
        assert(instance.subscriptions[topic].refCount === 5);
        await times(4, () => instance.unsubscribe(topic));
        assert(optionsBase.onUnsubscribe.callCount === 0);
        assert(instance.subscriptions[topic].refCount === 1);
        await times(4, () => instance.unsubscribe(topic));
        assert(instance.subscriptions[topic] === undefined);
        assert(optionsBase.onUnsubscribe.callCount === 1);
      });
    });
  });
});

async function times(count, fn) {
  for (let i = 0; i < count; i++) {
    await fn();
  }
}
