// @flow
const {before, beforeEach, after, afterEach, describe, it} = require('mocha');
const assert = require('power-assert');
const sinon = require('sinon');
const SubscriptionDedupe = require('../index');

describe('subscription-dedupe', () => {

  let instance;
  const optionsBase = {
    delimiter: ':',
    addListener() {
      return new Promise((resolve) => setTimeout(() => resolve({}), 0));
    },
    removeListener() {
      return new Promise((resolve) => setTimeout(resolve, 0));
    },
    levels: 1,
  }
  beforeEach(function() {
    this.sandbox = sinon.sandbox.create();
    this.sandbox.spy(optionsBase, 'addListener');
    this.sandbox.spy(optionsBase, 'removeListener');
  });

  afterEach(function() {
    this.sandbox.restore();
  });

  describe('add/remove basics', function() {

    describe('addListener()', function() {

      it('Calls `addListener` on add', async function() {
        const topic = 'foo';
        const instance = new SubscriptionDedupe(optionsBase);
        await instance.addSubscription(topic);
        assert(optionsBase.addListener.callCount === 1);
      });

      it('Only calls `addListener` once', async function() {
        const topic = 'foo';
        const instance = new SubscriptionDedupe(optionsBase);
        await instance.addSubscription(topic);
        assert(optionsBase.addListener.callCount === 1);
        await instance.addSubscription(topic);
        assert(optionsBase.addListener.callCount === 1);
      });
    });

    describe('removeListener()', function() {

      it('removes subscription at 0', async function() {
        const topic = 'foo';
        const instance = new SubscriptionDedupe(optionsBase);
        await instance.addSubscription(topic);
        assert(optionsBase.addListener.callCount === 1);
        await instance.removeSubscription(topic);
        assert(instance.subscriptions[topic] === undefined);
        assert(optionsBase.removeListener.callCount === 1);
      });

      it('doesn\'t remove nonexistent', async function() {
        const topic = 'foo';
        const instance = new SubscriptionDedupe(optionsBase);
        await instance.removeSubscription(topic);
        assert(instance.subscriptions[topic] === undefined);
        assert(optionsBase.removeListener.callCount === 0);
      });

      it('removes subscription only once', async function() {
        const topic = 'foo';
        const instance = new SubscriptionDedupe(optionsBase);
        await times(5, () => instance.addSubscription(topic));
        assert(optionsBase.addListener.callCount === 1);
        assert(instance.subscriptions[topic].refCount === 5);
        await times(4, () => instance.removeSubscription(topic));
        assert(optionsBase.removeListener.callCount === 0);
        assert(instance.subscriptions[topic].refCount === 1);
        await times(4, () => instance.removeSubscription(topic));
        assert(instance.subscriptions[topic] === undefined);
        assert(optionsBase.removeListener.callCount === 1);
      });
    });
  });

  describe('wildcard stack', function() {

    it('Doesn\'t call addListener up the stack', async function() {
      const instance = new SubscriptionDedupe(Object.assign({}, optionsBase, {
        levels: 2
      }));
      await instance.addSubscription('foo:*');
      assert(optionsBase.addListener.firstCall.args[0] === 'foo:*');
      assert(optionsBase.addListener.callCount === 1);
      await instance.addSubscription('foo:bar');
      assert(optionsBase.addListener.callCount === 1);
    });

    it('Doesn\'t call addListener up the stack (mid wildcard)', async function() {
      const instance = new SubscriptionDedupe(Object.assign({}, optionsBase, {
        levels: 5
      }));
      await instance.addSubscription('foo:*:*:*:*');
      assert(optionsBase.addListener.firstCall.args[0] === 'foo:*:*:*:*');
      assert(optionsBase.addListener.callCount === 1);
      await instance.addSubscription('foo:boo:bar:baz:biff');
      assert(optionsBase.addListener.callCount === 1);
      await instance.addSubscription('foo:*:bar:baz:biff'); // another wildcard shouldn't either
      assert(optionsBase.addListener.callCount === 1);
      await instance.addSubscription('foo:*:bar:baz:*');
      assert(optionsBase.addListener.callCount === 1);
      await instance.addSubscription('foo:*:bar:*:biff');
      assert(optionsBase.addListener.callCount === 1);
      await instance.addSubscription('foo:*:*:*:biff');
      assert(optionsBase.addListener.callCount === 1);
      await instance.addSubscription('foo:*:*:*:*');
      assert(optionsBase.addListener.callCount === 1);
    });

    it('Will call if different base wildcard', async function() {
      const instance = new SubscriptionDedupe(Object.assign({}, optionsBase, {
        levels: 5
      }));
      await instance.addSubscription('foo:*:*:*:*');
      assert(optionsBase.addListener.firstCall.args[0] === 'foo:*:*:*:*');
      assert(optionsBase.addListener.callCount === 1);
      await instance.addSubscription('bar:*:*:*:*');
      assert(optionsBase.addListener.secondCall.args[0] === 'bar:*:*:*:*');
      assert(optionsBase.addListener.callCount === 2);
    });

    it('Supersedes if higher wildcard appears', async function() {
      const instance = new SubscriptionDedupe(Object.assign({}, optionsBase, {
        levels: 3
      }));
      await instance.addSubscription('1:foo:*');
      await instance.addSubscription('1:bar:*');
      await instance.addSubscription('1:baz:*');
      assert(optionsBase.addListener.callCount === 3);
      await instance.addSubscription('1:*:*');
      assert(optionsBase.addListener.callCount === 4);
      await instance.addSubscription('1:biff:*');
      assert(optionsBase.addListener.callCount === 4);
      await instance.addSubscription('*:*:*');
      assert(optionsBase.addListener.callCount === 5);
      await instance.addSubscription('2:foo:*')
      await instance.addSubscription('2:bar:*')
      await instance.addSubscription('2:*:*')
      assert(optionsBase.addListener.callCount === 5);
    });
  });
});

async function times(count, fn) {
  for (let i = 0; i < count; i++) {
    await fn();
  }
}
