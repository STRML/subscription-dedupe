// @flow
const {before, beforeEach, after, afterEach, describe, it} = require('mocha');
const assert = require('power-assert');
const sinon = require('sinon');
const SubscriptionDedupe = require('../index');

describe('subscription-dedupe', () => {

  let instance;
  const optionsBase = {
    subscribe() {
      return new Promise((resolve) => setTimeout(() => resolve({}), 0));
    },
    unsubscribe() {
      return new Promise((resolve) => setTimeout(resolve, 0));
    },
  }
  beforeEach(function() {
    this.sandbox = sinon.sandbox.create();
    this.sandbox.spy(optionsBase, 'subscribe');
    this.sandbox.spy(optionsBase, 'unsubscribe');
  });

  afterEach(function() {
    this.sandbox.restore();
  });

  describe('add/remove basics', function() {

    describe('subscribe()', function() {

      it('Calls `subscribe` on add', async function() {
        const topic = 'foo';
        const instance = new SubscriptionDedupe(optionsBase);
        await instance.addSubscription(topic);
        assert(optionsBase.subscribe.callCount === 1);
      });

      it('Only calls `subscribe` once', async function() {
        const topic = 'foo';
        const instance = new SubscriptionDedupe(optionsBase);
        await instance.addSubscription(topic);
        assert(optionsBase.subscribe.callCount === 1);
        await instance.addSubscription(topic);
        assert(optionsBase.subscribe.callCount === 1);
      });
    });

    describe('unsubscribe()', function() {

      it('removes subscription at 0', async function() {
        const topic = 'foo';
        const instance = new SubscriptionDedupe(optionsBase);
        await instance.addSubscription(topic);
        assert(optionsBase.subscribe.callCount === 1);
        await instance.removeSubscription(topic);
        assert(instance.subscriptions[topic] === undefined);
        assert(optionsBase.unsubscribe.callCount === 1);
      });

      it('doesn\'t remove nonexistent', async function() {
        const topic = 'foo';
        const instance = new SubscriptionDedupe(optionsBase);
        await instance.removeSubscription(topic);
        assert(instance.subscriptions[topic] === undefined);
        assert(optionsBase.unsubscribe.callCount === 0);
      });

      it('removes subscription only once', async function() {
        const topic = 'foo';
        const instance = new SubscriptionDedupe(optionsBase);
        await times(5, () => instance.addSubscription(topic));
        assert(optionsBase.subscribe.callCount === 1);
        assert(instance.subscriptions[topic].refCount === 5);
        await times(4, () => instance.removeSubscription(topic));
        assert(optionsBase.unsubscribe.callCount === 0);
        assert(instance.subscriptions[topic].refCount === 1);
        await times(4, () => instance.removeSubscription(topic));
        assert(instance.subscriptions[topic] === undefined);
        assert(optionsBase.unsubscribe.callCount === 1);
      });
    });
  });
});

async function times(count, fn) {
  for (let i = 0; i < count; i++) {
    await fn();
  }
}
