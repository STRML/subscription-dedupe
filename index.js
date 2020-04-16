// @flow

//
// Class for deduping subscriptions. If a subscription is already open, we return the resolved promise
// with the emitter.
//
// One complication is the following:
// 1. User opens subscription to 'instrument:XBTUSD'
// 2. Another user opens subscription to 'instrument', which supersedes
// 3. User unsubscribes from 'instrument:XBTUSD' - because of higher-priority sub, despite refcount being 0, no action
//
// Can we do this programmatically so this module doesn't have to know much about the above (like some bool-returning
// hook)?
//

/*::
type Options = {
  onSubscribe: (...args: any) => Promise<any>,
  onUnsubscribe: (...args: any) => Promise<any>,
};
type SubscriptionObject = {promise: Promise<any>, refCount: number};
type SubscriptionMap = {[key: string]: SubscriptionObject};
*/
module.exports = class SubscriptionDedupe {
  constructor(options /*: Options*/) {
    if (!options || !options.onSubscribe || !options.onUnsubscribe) {
      throw new Error("'onSubscribe', 'onUnsubscribe' required.");
    }
    this.subscriptions = {};
    this.options = options;
  }

  /*::
  options: Options;
  subscriptions: SubscriptionMap;
  */

  subscribe(topic /*: string */) {
    let existing = this.subscriptions[topic];

    if (!existing) {
      // Nothing found, create the subscription object
      existing = this.subscriptions[topic] = {
        promise: this.options.onSubscribe(topic),
        refCount: 0,
      };
    } else if (existing && existing.refCount === 0) {
      // This connection was closing, but did not finish. If it had,
      // we wouldn't have found the subscription. 
      existing.promise = existing.promise.then(() =>
        this.options.onSubscribe(topic)
      );
    }

    existing.refCount++;
    return existing.promise;
  }

  unsubscribe(topic /*: string */) {
    let existing = this.subscriptions[topic];
    let promise;

    if (existing) {
      if (existing.refCount > 1) {
        existing.refCount--;
      } else if (existing.refCount === 0) {
        // Will happen if you unsubscribe too many times.
        console.warn(`Attempted to close dedupe subscription for topic "${topic}", but it was already closing.`);
        return existing.promise;
      } else {
        // No more references. Close down the connection.
        existing.refCount = 0;

        // When reopening a connection, the first one will wait for the close before reopening.
        // This way, multiple reopens will wait for each other.

        // $FlowFixMe
        promise = existing.promise = existing.promise
          .then(() => this.options.onUnsubscribe(topic))
          .then(() => {
            if (existing.refCount <= 0) {
              delete this.subscriptions[topic];
            }
          });
      }
    }

    return promise || Promise.resolve();
  }
};
