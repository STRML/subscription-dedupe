// @flow
const { before, beforeEach, after, afterEach, describe, it } = require("mocha");
const Promise = require('bluebird');
const assert = require("power-assert");
const sinon = require("sinon");
const SubscriptionDedupe = require("../index");

describe("subscription-dedupe", () => {
  let instance;
  const optionsBase = {
    onSubscribe() {
      return new Promise((resolve) => setTimeout(() => resolve({}), 0));
    },
    onUnsubscribe() {
      return new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
  beforeEach(function () {
    this.sandbox = sinon.sandbox.create();
    this.sandbox.spy(optionsBase, "onSubscribe");
    this.sandbox.spy(optionsBase, "onUnsubscribe");
  });

  afterEach(function () {
    this.sandbox.restore();
  });

  describe("add/remove basics", function () {
    describe("onSubscribe()", function () {
      it("Calls `onSubscribe` on add", async function () {
        const topic = "foo";
        const instance = new SubscriptionDedupe(optionsBase);
        await instance.subscribe(topic);
        assert(optionsBase.onSubscribe.callCount === 1);
      });

      it("Only calls `onSubscribe` once", async function () {
        const topic = "foo";
        const instance = new SubscriptionDedupe(optionsBase);
        await instance.subscribe(topic);
        assert(optionsBase.onSubscribe.callCount === 1);
        await instance.subscribe(topic);
        assert(optionsBase.onSubscribe.callCount === 1);
        assert(instance.subscriptions[topic].refCount === 2);
      });
    });

    describe("onUnsubscribe()", function () {
      it("removes subscription at 0", async function () {
        const topic = "foo";
        const instance = new SubscriptionDedupe(optionsBase);
        await instance.subscribe(topic);
        assert(optionsBase.onSubscribe.callCount === 1);
        await instance.unsubscribe(topic);
        assert(instance.subscriptions[topic] === undefined);
        assert(optionsBase.onUnsubscribe.callCount === 1);
      });

      it("doesn't remove nonexistent", async function () {
        const topic = "foo";
        const instance = new SubscriptionDedupe(optionsBase);
        await instance.unsubscribe(topic);
        assert(instance.subscriptions[topic] === undefined);
        assert(optionsBase.onUnsubscribe.callCount === 0);
      });

      it("removes subscription only once", async function () {
        const topic = "foo";
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

      it('does not allow refCount to go negative', async function() {
        const topic = 'foo';
        const instance = new SubscriptionDedupe(optionsBase);

        // Subscribe a bunch of times
        await times(5, () => instance.subscribe(topic));
        assert(optionsBase.onSubscribe.callCount === 1);
        assert(instance.subscriptions[topic].refCount === 5);

        await times(2, () => instance.unsubscribe(topic));
        assert(instance.subscriptions[topic].refCount === 3);

        // Unsub 5x, which would go negative if there were a bug
        await times(5, () => instance.unsubscribe(topic));
        assert(optionsBase.onUnsubscribe.callCount === 1);
        assert(instance.subscriptions[topic] === undefined);

        // Resub. This should trigger a sub
        await times(1, () => instance.subscribe(topic));
        assert(instance.subscriptions[topic].refCount === 1);
        assert(optionsBase.onUnsubscribe.callCount === 1);
        assert(optionsBase.onSubscribe.callCount === 2);
      });

      it('does not allow refCount to go negative even when synchronously called', async function() {
        const consoleStub = sinon.stub(console, 'warn');
        const topic = 'foo';
        const instance = new SubscriptionDedupe(optionsBase);

        // Subscribe a bunch of times
        await times(5, () => instance.subscribe(topic));

        // Unsubscribe, more times.
        let unsubPromise;
        for (let i = 0; i < 8; i++) {
          unsubPromise = instance.unsubscribe(topic); 
        }
        // in limbo; we know we're closing
        assert(instance.subscriptions[topic].refCount === 0);
        // We only need one of them to await
        await unsubPromise;
        assert(optionsBase.onUnsubscribe.callCount === 1);
        // Console should have alerted us 3x
        sinon.assert.callCount(consoleStub, 3);

        assert(!(topic in instance.subscriptions));
      });

      it('recovers from over-unsubscription', async function() {
        const topic = 'foo';
        const instance = new SubscriptionDedupe(optionsBase);

        // Subscribe a bunch of times
        await times(5, () => instance.subscribe(topic));

        // Unsubscribe, more times.
        for (let i = 0; i < 8; i++) {
          instance.unsubscribe(topic); 
        }

        // Now, synchronously subscribe a few times
        let subPromise;
        for (let i = 0; i < 2; i++){
          subPromise = instance.subscribe(topic);
        }
        await subPromise;
        assert(optionsBase.onUnsubscribe.callCount === 1);
        assert(optionsBase.onSubscribe.callCount === 2);
        assert(instance.subscriptions[topic].refCount === 2);
      });


      // subscribe -> unsubscribe in single tick
      // Should await the subscribe
      it("awaits subscribes before unsubscribing", async function () {
        const topic = "foo";

        const subscribeDeferred = Promise.defer();
        const instance = new SubscriptionDedupe({
          onUnsubscribe: optionsBase.onUnsubscribe,
          onSubscribe: () => subscribeDeferred.promise,
        });

        const pendingSubscribe = instance.subscribe(topic);
        assert(instance.subscriptions[topic].refCount === 1);

        const pendingUnsubscribe = instance.unsubscribe(topic);

        assert(topic in instance.subscriptions);
        assert(instance.subscriptions[topic].refCount === 0);

        subscribeDeferred.resolve();

        await pendingUnsubscribe;
        assert(!(topic in instance.subscriptions));

        // Make sure this resolves as well. It was first, so it won't change state.
        await pendingSubscribe;
        assert(!(topic in instance.subscriptions));
      });

      // subscribe -> unsubscribe -> subscribe, in single tick
      // Should await each in turn
      it("allows resubscribes", async function () {
        const topic = "foo";

        const subscribeDeferred = Promise.defer();
        const onSubscribe = sinon.stub().resolves(subscribeDeferred.promise);
        const instance = new SubscriptionDedupe({
          onUnsubscribe: optionsBase.onUnsubscribe,
          onSubscribe
        });

        const pendingSubscribe1 = instance.subscribe(topic);
        assert(instance.subscriptions[topic].refCount === 1);
        assert(onSubscribe.callCount === 1);

        const pendingUnsubscribe = instance.unsubscribe(topic);

        assert(topic in instance.subscriptions);
        assert(instance.subscriptions[topic].refCount === 0);

        const pendingSubscribe2 = instance.subscribe(topic);

        // Still 1: we're waiting on both the subscribe & unsubscribe to resolve
        assert(onSubscribe.callCount === 1);
        assert(instance.subscriptions[topic].refCount === 1);

        // Resolve the subscription.
        subscribeDeferred.resolve();

        // Finish unsubscription. But the topic should still be there, because it realized
        // the refCount is > 0.
        await pendingUnsubscribe;
        assert(topic in instance.subscriptions);

        // Now we're fully subscribed and out of limbo.
        await pendingSubscribe2;

        assert(topic in instance.subscriptions);
        assert(instance.subscriptions[topic].refCount === 1);
        assert(onSubscribe.callCount === 2);

        // Make sure this resolves as well
        await pendingSubscribe1;
      });
    });
  });
});

async function times(count, fn) {
  for (let i = 0; i < count; i++) {
    await fn();
  }
}
