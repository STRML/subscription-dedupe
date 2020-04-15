// @flow
const { before, beforeEach, after, afterEach, describe, it } = require("mocha");
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
    });
  });
});

async function times(count, fn) {
  for (let i = 0; i < count; i++) {
    await fn();
  }
}
