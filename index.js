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
  subscribe: (...args: any) => Promise<any>,
  unsubscribe: (...args: any) => Promise<any>,
};
type SubscriptionObject = {promise: Promise<any>, refCount: number};
type SubscriptionMap = {[key: string]: SubscriptionObject};
*/
module.exports = class SubscriptionDedupe {
  constructor(options/*: Options*/) {
    if (!options || !options.subscribe || !options.unsubscribe) {
      throw new Error("'subscribe', 'unsubscribe' required.");
    }
    this.subscriptions = {};
    this.options = options;
  }

  /*::
  options: Options;
  subscriptions: SubscriptionMap;
  */

  addSubscription(topic/*: string */) {
    let existing = this.subscriptions[topic];

    if (!existing) {
      // Nothing found, create the subscription object
      existing = this.subscriptions[topic] = {
        promise: this.options.subscribe(topic),
        refCount: 0
      };
    }

    existing.refCount++;
    return existing.promise;
  }

  removeSubscription(topic/*: string */) {
    let existing = this.subscriptions[topic];

    if (existing) {
      existing.refCount--;
      if (existing.refCount === 0) {
        this.options.unsubscribe(topic);
        delete this.subscriptions[topic];
      }
    }
  }
}
