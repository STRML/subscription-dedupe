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
      return Promise.resolve({});
    },
    onUnsubscribe() {
      return Promise.resolve();
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
        const consoleStub = this.sandbox.stub(console, 'warn');
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
        assert.deepEqual(instance.subscriptions[topic].closing, {isReopened: false});
        // We only need one of them to await
        await unsubPromise;
        assert(optionsBase.onSubscribe.callCount === 1);
        assert(optionsBase.onUnsubscribe.callCount === 1);
        // Console should have alerted us 3x
        sinon.assert.callCount(consoleStub, 3);

        assert(!(topic in instance.subscriptions));
      });

      it('recovers from over-unsubscription', async function() {
        const consoleStub = this.sandbox.stub(console, 'warn');
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

      it('does not log the over-unsubscription if silent', async function() {
        const consoleStub = this.sandbox.stub(console, 'warn');
        const topic = 'foo';
        const instance = new SubscriptionDedupe(Object.assign({}, optionsBase, {warnOnTooManyUnsubscribes: false}));

        // Subscribe a bunch of times
        await times(5, () => instance.subscribe(topic));

        // Unsubscribe, more times.
        let unsubPromise;
        for (let i = 0; i < 8; i++) {
          unsubPromise = instance.unsubscribe(topic);
        }
        await unsubPromise;

        sinon.assert.callCount(consoleStub, 0);
      });

      it("awaits subscribes before unsubscribing", async function () {
        const topic = "foo";

        let resolveSubscribe;
        const onSubscribe = () =>
          new Promise((resolve) => (resolveSubscribe = resolve));
        const instance = new SubscriptionDedupe({
          onUnsubscribe: optionsBase.onUnsubscribe,
          onSubscribe,
        });

        const pendingSubscribe = instance.subscribe(topic);
        assert(instance.subscriptions[topic].refCount === 1);
        assert(instance.subscriptions[topic].closing === null);

        const pendingUnsubscribe = instance.unsubscribe(topic);

        assert(topic in instance.subscriptions);
        assert(instance.subscriptions[topic].refCount === 0);
        assert(
          instance.subscriptions[topic].closing != null &&
            instance.subscriptions[topic].closing.isReopened === false
        );

        if (resolveSubscribe) resolveSubscribe();

        await pendingUnsubscribe;
        assert(!(topic in instance.subscriptions));

        // Make sure this resolves as well
        await pendingSubscribe;
      });

      it("allows resubscribes", async function () {
        const topic = "foo";

        let resolveSubscribe;
        let onSubscribeCallCount = 0;
        const onSubscribe = () => {
          onSubscribeCallCount++;
          return new Promise((resolve) => (resolveSubscribe = resolve));
        };
        const instance = new SubscriptionDedupe({
          onUnsubscribe: optionsBase.onUnsubscribe,
          onSubscribe,
        });

        const pendingSubscribe1 = instance.subscribe(topic);
        assert(instance.subscriptions[topic].refCount === 1);
        assert(instance.subscriptions[topic].closing === null);

        const pendingUnsubscribe = instance.unsubscribe(topic);

        assert(topic in instance.subscriptions);
        assert(instance.subscriptions[topic].refCount === 0);
        const { closing } = instance.subscriptions[topic];
        assert(closing != null && closing.isReopened === false);

        const pendingSubscribe2 = instance.subscribe(topic);

        assert(onSubscribeCallCount === 1);
        // Should have updated object
        assert(closing != null && closing.isReopened === true);
        // ...and removed it
        assert(instance.subscriptions[topic].closing === null);

        if (resolveSubscribe) resolveSubscribe();

        await pendingUnsubscribe;
        assert(topic in instance.subscriptions);

        if (resolveSubscribe) resolveSubscribe();

        await pendingSubscribe2;

        assert(topic in instance.subscriptions);
        assert(instance.subscriptions[topic].refCount === 1);
        assert(onSubscribeCallCount === 2);

        // Make sure this resolves as well
        await pendingSubscribe1;
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
        assert(instance.subscriptions[topic].closing === null);

        const pendingUnsubscribe = instance.unsubscribe(topic);

        assert(topic in instance.subscriptions);
        assert(instance.subscriptions[topic].refCount === 0);

        assert(
          instance.subscriptions[topic].closing != null &&
            instance.subscriptions[topic].closing.isReopened === false
        );

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
        assert(instance.subscriptions[topic].closing === null);

        const pendingUnsubscribe = instance.unsubscribe(topic);

        assert(topic in instance.subscriptions);
        assert(instance.subscriptions[topic].refCount === 0);
        const { closing } = instance.subscriptions[topic];
        assert(closing != null && closing.isReopened === false);

        const pendingSubscribe2 = instance.subscribe(topic);

        // Still 1: we're waiting on both the subscribe & unsubscribe to resolve
        assert(onSubscribe.callCount === 1);
        assert(instance.subscriptions[topic].refCount === 1);
        // Should have updated object
        assert(closing != null && closing.isReopened === true);
        // ...and removed it
        assert(instance.subscriptions[topic].closing === null);

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

      //
      // This is why the `closing` property exists. Without it, the following is possible:
      //
      // 1. Subscribe: Creates new subscription object. Stays pending.
      // 2. Unsubscribe: Updates object, still waiting for (1).
      // 3. Subscribe: Updates object, still waiting for (1).
      // 4. Unsubscribe: Updates object, still waiting for (1).
      // 5. Promises for (1) and (2) resolve. We remove the object in the then of (2). Promises for (3) and (4) are still pending.
      // 6. Subscribe: Recreates subscription object without waiting for previous steps to complete.
      // 7. Promises for (3) and (6) resolve.
      // 8. Promise for (4) completes, removing the subscription. We now have an entry for a subscription we don't hold anymore.
      it("does not remove state before completion", async function () {
        const topic = "foo";
        const subscribeDeferred = [];
        const unsubscribeDeferred = [];
        const instance = new SubscriptionDedupe({
          onSubscribe() {
            const deferred = Promise.defer();
            subscribeDeferred.push(deferred);
            return deferred.promise;
          },
          onUnsubscribe() {
            const deferred = Promise.defer();
            unsubscribeDeferred.push(deferred);
            return deferred.promise;
          },
        });
        // 1
        const pendingSubscribe1 = instance.subscribe(topic);
        // 2
        const pendingUnsubscribe1 = instance.unsubscribe(topic);
        // 3
        const pendingSubscribe2 = instance.subscribe(topic);
        // 4
        const pendingUnsubscribe2 = instance.unsubscribe(topic);
        // 5
        subscribeDeferred[0].resolve();
        await pendingSubscribe1;
        unsubscribeDeferred[0].resolve();
        await pendingUnsubscribe1;
        assert(topic in instance.subscriptions);
        // 6: This is backed up on pendingUnsubscribe2
        const pendingSubscribe3 = instance.subscribe(topic);
        // 7
        subscribeDeferred[1].resolve();
        assert(!subscribeDeferred[2]);
        await pendingSubscribe2;
        assert(!subscribeDeferred[2]); // does not exist because we're waiting on pendingUnsubscribe2
        // 8
        unsubscribeDeferred[1].resolve();
        await pendingUnsubscribe2;
        assert(subscribeDeferred[2]);
        subscribeDeferred[2].resolve();
        assert(topic in instance.subscriptions);
      });
    });
  });
});

async function times(count, fn) {
  for (let i = 0; i < count; i++) {
    await fn();
  }
}