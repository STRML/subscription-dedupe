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
  constructor(options/*: Options*/) {
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

  subscribe(topic/*: string */) {
    let existing = this.subscriptions[topic];

    if (!existing) {
      // Nothing found, create the subscription object
      existing = this.subscriptions[topic] = {
        promise: this.options.onSubscribe(topic),
        refCount: 0
      };
    }

    existing.refCount++;
    return existing.promise;
  }

  unsubscribe(topic/*: string */) {
    let existing = this.subscriptions[topic];
    let promise

    if (existing) {
      existing.refCount--;
      if (existing.refCount === 0) {
        promise = existing.promise.then(() => this.options.onUnsubscribe(topic));
        delete this.subscriptions[topic];
      }
    }
    
    return promise || Promise.resolve();
  }
}
