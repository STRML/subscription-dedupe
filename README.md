# Subscription-Dedupe

A simple module for reference-counting subscriptions and delegating to a handler.

### Usage

This simple example shows how to dedupe subscriptions to Redis.

When creating a `SubscriptionDedupe`, you must define two methods, `addListener` and `removeListener`.
If you wish to listen to success/error, you should return a Promise.

```js
const SubscriptionDedupe = require("subscription-dedupe");
const redis = require('redis');
const Promise = require('bluebird');

const redisClient = redis.createClient({/*...*/});
const psubscribeAsync = Promise.promisify(redisClient.psubscribe, {context: redisClient});
const punsubscribeAsync = Promise.promisify(redisClient.punsubscribe, {context: redisClient});
const deduper = new SubscriptionDedupe({
  addListener(topic) {
    return psubscribeAsync(topic);
  },
  removeListener(topic) {
    return punsubscribeAsync(topic);
  }
});

//
// Usage
//

// addListener() called
await deduper.subscribe('topic');
// addListener() NOT called! The original, resolved promise is returned instead.
await deduper.subscribe('topic');

// removeListener NOT called, as there is still an open subscription.
await deduper.unsubscribe('topic');
// removeListener() called
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
