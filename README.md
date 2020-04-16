# Subscription-Dedupe

A simple module for reference-counting subscriptions and delegating to a handler.

### Usage

This simple example shows how to dedupe subscriptions to Redis.

When creating a `SubscriptionDedupe`, you must define two methods, `onSubscribe` and `onUnsubscribe`.
If you wish to listen to success/error, you should return a Promise.

```js
const SubscriptionDedupe = require("subscription-dedupe");
const redis = require('redis');
const Promise = require('bluebird');

const redisClient = redis.createClient({/*...*/});
const psubscribeAsync = Promise.promisify(redisClient.psubscribe, {context: redisClient});
const punsubscribeAsync = Promise.promisify(redisClient.punsubscribe, {context: redisClient});
const deduper = new SubscriptionDedupe({
  onSubscribe(topic) {
    return psubscribeAsync(topic);
  },
  onUnsubscribe(topic) {
    return punsubscribeAsync(topic);
  },
  // If `false`, will not print to console.warn if your code unsubscribes more
  // than it subscribes (which would result in a negative refCount).
  // Default `true`
  warnOnTooManyUnsubscribes: true,
});

//
// Usage
//

// onSubscribe() called
await deduper.subscribe('topic');
// onSubscribe() NOT called! The original, resolved promise is returned instead.
await deduper.subscribe('topic');

// onUnsubscribe NOT called, as there is still an open subscription.
await deduper.unsubscribe('topic');
// onUnsubscribe() called
await deduper.unsubscribe('topic');

//
// Recovering from errors
//

try {
  await deduper.subscribe('topic');
} catch (e) {
  // handle error...

  // Be sure to unsubscribe - or this will count as a subscription and new attempts will also throw!
  // This module doesn't check if the promise threw.
  await deduper.unsubscribe('topic');
}
```
